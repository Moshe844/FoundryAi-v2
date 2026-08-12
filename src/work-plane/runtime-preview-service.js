import { spawn } from "node:child_process";
import { createServer } from "node:net";

import {
  BrowserObservationError,
  RuntimeIdempotencyError,
  RuntimeNotFoundError,
  RuntimePortConflictError,
  RuntimeStateError,
  RuntimeValidationError,
} from "../domain/errors.js";
import { MissionState } from "../domain/lifecycle.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import {
  RUNTIME_PREVIEW_SOURCE,
  RuntimeEventType,
  RuntimeStatus,
  normalizeRuntimeRecord,
  parseBrowserResult,
  projectRuntimeHistory,
} from "../domain/runtime-preview.js";
import {
  awaitProcessTreeExit,
  controlledProcedureArguments,
  createSafeCommandEnvironment,
  resolveControlledExecutable,
  terminateProcessTree,
} from "./command-runner.js";

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new RuntimeValidationError(`${label} is malformed.`);
  }
}

function appendBounded(target, chunk, limit = 65_536) {
  const value = Buffer.from(chunk);
  const remaining = Math.max(0, limit - target.size);
  if (remaining > 0) {
    target.chunks.push(value.subarray(0, remaining));
    target.size += Math.min(remaining, value.length);
  }
}

function text(target) {
  return Buffer.concat(target.chunks).toString("utf8");
}

// This proves the running application source did not change under an
// observation. Anything the observation itself produces is an output, not
// source: screenshots written to evidence/ by the very Playwright run being
// verified made the post-observation checkpoint differ from the artifact the
// runtime started, so a build whose fidelity fully passed was still rejected
// as if its source had been swapped.
export function runtimeSourceManifest(checkpoint) {
  return JSON.stringify(
    checkpoint.contentManifest.filter(
      (entry) =>
        !entry.path.startsWith("data/") &&
        !entry.path.startsWith("tests/") &&
        !entry.path.startsWith("evidence/") &&
        entry.path !== "playwright.config.ts",
    ),
  );
}

export function browserCertificationCheckpoint({
  startedCheckpoint,
  observedCheckpoint,
  currentCheckpoint,
}) {
  const checkpoints = [
    startedCheckpoint,
    observedCheckpoint,
    currentCheckpoint,
  ];
  const sourceManifests = checkpoints.map((checkpoint) =>
    checkpoint === undefined ? null : runtimeSourceManifest(checkpoint),
  );
  if (
    sourceManifests.some((manifest) => manifest === null) ||
    new Set(sourceManifests).size !== 1
  ) {
    throw new BrowserObservationError(
      "Browser command checkpoint differs from the running artifact.",
    );
  }
  return currentCheckpoint.checkpointId;
}

export function resolveAuthoritativeBrowserChecks(
  rawChecks,
  authoritativeCheckOverrides = {},
) {
  if (
    rawChecks === null ||
    typeof rawChecks !== "object" ||
    Array.isArray(rawChecks) ||
    authoritativeCheckOverrides === null ||
    typeof authoritativeCheckOverrides !== "object" ||
    Array.isArray(authoritativeCheckOverrides)
  ) {
    throw new RuntimeValidationError(
      "Browser checks and authoritativeCheckOverrides must be check-to-boolean objects.",
    );
  }
  for (const [checkId, passed] of Object.entries(
    authoritativeCheckOverrides,
  )) {
    if (!Object.hasOwn(rawChecks, checkId) || passed !== true) {
      throw new RuntimeValidationError(
        "Authoritative browser overrides may only promote an observed check to true.",
      );
    }
  }
  return Object.freeze({
    ...rawChecks,
    ...authoritativeCheckOverrides,
  });
}

async function allocatePort(requestedPort) {
  if (
    requestedPort !== null &&
    (!Number.isSafeInteger(requestedPort) ||
      requestedPort < 1024 ||
      requestedPort > 65535)
  ) {
    throw new RuntimeValidationError(
      "requestedPort must be null or an integer from 1024 through 65535.",
    );
  }
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        reject(new RuntimePortConflictError(requestedPort, { cause: error }));
      } else {
        reject(error);
      }
    });
    server.listen(
      { host: "127.0.0.1", port: requestedPort ?? 0, exclusive: true },
      () => {
        const address = server.address();
        const port = typeof address === "object" ? address.port : null;
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve(port);
          }
        });
      },
    );
  });
}

async function observeHttp(url, timeoutMs, processState) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = "No HTTP response was observed.";
  while (Date.now() < deadline) {
    if (processState.exited) {
      return { ready: false, response: null, detail: "Runtime process exited." };
    }
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.min(5_000, timeoutMs)),
      });
      const body = (await response.text()).slice(0, 16_384);
      const headers = {};
      for (const [name, value] of response.headers.entries()) {
        headers[name] = value;
      }
      if (response.status >= 200 && response.status < 500) {
        return {
          ready: true,
          response: { statusCode: response.status, headers, body },
          detail: `Observed HTTP ${response.status} from the running artifact.`,
        };
      }
      lastDetail = `Observed HTTP ${response.status}.`;
    } catch (error) {
      lastDetail = `HTTP observation pending: ${error.message}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return { ready: false, response: null, detail: lastDetail };
}

function evidenceReference(record, checkpointId) {
  return {
    evidenceId: record.evidenceId,
    workspaceCheckpointReference: checkpointId,
  };
}

export function createRuntimePreviewService({
  ledger,
  contracts,
  evidence,
  facts,
  toolchains,
  workspaces,
  workspaceExecutionAuthority,
  clock,
}) {
  const processes = new Map();

  function history(missionId) {
    return projectRuntimeHistory(ledger.listEvents(missionId), missionId);
  }

  function latestSession(missionId, sessionId) {
    const record = history(missionId).findLast(
      (entry) => entry.sessionId === sessionId,
    );
    if (record === undefined) {
      throw new RuntimeNotFoundError(sessionId);
    }
    return record;
  }

  function assertExecuting(missionId) {
    const state = ledger.projectState(missionId).state;
    if (state !== MissionState.EXECUTING) {
      throw new RuntimeStateError(
        `Runtime actions require EXECUTING, not ${state}.`,
      );
    }
  }

  function appendRuntimeFact(record, statement, causationId) {
    facts.recordResultFact({
      missionId: record.missionId,
      eventId: `${record.observationId}.fact`,
      causationId,
      occurredAt: record.completedAt,
      producingSubsystem: RUNTIME_PREVIEW_SOURCE,
      statement,
      evidenceReferences: record.evidenceReferences,
      workspaceCheckpointReference: record.checkpointId,
      workUnitReference: record.workUnitReference,
      metadata: { runtimeRecord: record },
    });
  }

  async function start(input) {
    const required = [
      "causationId",
      "checkpointId",
      "evidencePrefix",
      "idempotencyKey",
      "missionId",
      "observationId",
      "procedureName",
      "readinessPath",
      "requestedPort",
      "sessionId",
      "timeoutMs",
      "verificationRequestReference",
      "workspaceId",
    ];
    const optional = ["environment"];
    if (
      input === null ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      required.some((field) => !(field in input)) ||
      Object.keys(input).some(
        (field) => !required.includes(field) && !optional.includes(field),
      )
    ) {
      throw new RuntimeValidationError(
        `Runtime start input must contain exactly: ${required.join(", ")}.`,
      );
    }
    for (const field of [
      "causationId",
      "checkpointId",
      "evidencePrefix",
      "idempotencyKey",
      "missionId",
      "observationId",
      "procedureName",
      "sessionId",
      "verificationRequestReference",
      "workspaceId",
    ]) {
      assertIdentifier(input[field], field);
    }
    if (
      typeof input.readinessPath !== "string" ||
      !input.readinessPath.startsWith("/") ||
      !Number.isSafeInteger(input.timeoutMs) ||
      input.timeoutMs < 100 ||
      input.timeoutMs > 120_000
    ) {
      throw new RuntimeValidationError(
        "Runtime readinessPath or timeoutMs is invalid.",
      );
    }
    assertExecuting(input.missionId);
    contracts.getContract(input.missionId);
    const prior = history(input.missionId).find(
      (entry) =>
        entry.eventType === RuntimeEventType.STARTUP &&
        entry.idempotencyKey === input.idempotencyKey,
    );
    if (prior !== undefined) {
      if (
        prior.sessionId !== input.sessionId ||
        prior.workspaceId !== input.workspaceId ||
        prior.checkpointId !== input.checkpointId ||
        prior.procedureName !== input.procedureName
      ) {
        throw new RuntimeIdempotencyError(input.idempotencyKey);
      }
      return prior;
    }
    const workspace = workspaceExecutionAuthority.workspace(
      input.missionId,
      input.workspaceId,
    );
    if (workspace.currentCheckpointId !== input.checkpointId) {
      throw new RuntimeStateError(
        "Runtime must start from the current workspace checkpoint.",
      );
    }
    const selection = toolchains.getMissionSelection(input.missionId);
    const stack = toolchains.getStack(
      selection.stackId,
      selection.stackVersion,
    );
    const procedure = stack.manifest.procedures[input.procedureName];
    if (procedure === undefined) {
      throw new RuntimeValidationError(
        `Runtime procedure "${input.procedureName}" is not declared by the selected stack.`,
      );
    }
    let port;
    try {
      port = await allocatePort(input.requestedPort);
    } catch (error) {
      if (
        !(error instanceof RuntimePortConflictError) ||
        !Number.isSafeInteger(input.requestedPort)
      ) {
        throw error;
      }
      const timestamp = clock();
      const previewUrl = `http://127.0.0.1:${input.requestedPort}`;
      const conflictEvidence = evidence.capture({
        evidenceId: `${input.evidencePrefix}.process`,
        missionId: input.missionId,
        kind: ObservationKind.RUNTIME_PROCESS_RESULT,
        captureMethod: "runtime-port-allocation-conflict",
        producingSubsystem: RUNTIME_PREVIEW_SOURCE,
        timestamp,
        payload: {
          sessionId: input.sessionId,
          status: RuntimeStatus.STARTUP_FAILED,
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: "",
          detail: `Requested port ${input.requestedPort} is already in use.`,
        },
        sensitiveValues: [],
        workspaceCheckpointReference: input.checkpointId,
        obligationReference: null,
        verificationRequestReference: input.verificationRequestReference,
        commandReference: input.procedureName,
        workUnitReference: input.sessionId,
        metadata: { port: input.requestedPort, previewUrl },
      });
      const conflictRecord = normalizeRuntimeRecord({
        observationId: input.observationId,
        sessionId: input.sessionId,
        missionId: input.missionId,
        workspaceId: input.workspaceId,
        checkpointId: input.checkpointId,
        procedureName: input.procedureName,
        port: input.requestedPort,
        previewUrl,
        processId: null,
        startedAt: timestamp,
        completedAt: timestamp,
        status: RuntimeStatus.STARTUP_FAILED,
        eventType: RuntimeEventType.STARTUP,
        evidenceReferences: [
          evidenceReference(conflictEvidence, input.checkpointId),
        ],
        idempotencyKey: input.idempotencyKey,
        workUnitReference: input.sessionId,
      });
      appendRuntimeFact(
        conflictRecord,
        `Runtime session "${input.sessionId}" could not allocate its requested port.`,
        input.causationId,
      );
      throw error;
    }
    const previewUrl = `http://127.0.0.1:${port}`;
    const workingDirectory =
      workspaceExecutionAuthority.resolveWorkingDirectory({
        missionId: input.missionId,
        workspaceId: input.workspaceId,
        relativePath: ".",
      });
    const executable = resolveControlledExecutable(procedure.executable);
    const safeEnvironment = createSafeCommandEnvironment(
      input.environment ?? {},
    );
    const environment = {
      ...safeEnvironment.environment,
      HOSTNAME: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
    };
    const startedAt = clock();
    const stdout = { chunks: [], size: 0 };
    const stderr = { chunks: [], size: 0 };
    const state = {
      child: null,
      exited: false,
      exitCode: null,
      signal: null,
      stdout,
      stderr,
      sensitiveValues: safeEnvironment.sensitiveValues,
    };
    const child = spawn(executable, controlledProcedureArguments(procedure), {
      cwd: workingDirectory,
      env: environment,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    state.child = child;
    child.stdout.on("data", (chunk) => appendBounded(stdout, chunk));
    child.stderr.on("data", (chunk) => appendBounded(stderr, chunk));
    child.once("error", (error) => {
      appendBounded(stderr, Buffer.from(error.message));
    });
    child.once("close", (code, signal) => {
      state.exited = true;
      state.exitCode = Number.isSafeInteger(code) ? code : null;
      state.signal = signal ?? null;
    });
    processes.set(input.sessionId, state);

    const observation = await observeHttp(
      `${previewUrl}${input.readinessPath}`,
      input.timeoutMs,
      state,
    );
    const completedAt = clock();
    const runtimeStatus = observation.ready
      ? RuntimeStatus.READY
      : RuntimeStatus.STARTUP_FAILED;
    if (!observation.ready && !state.exited) {
      terminateProcessTree(child);
      await new Promise((resolve) => child.once("close", resolve));
    }
    const common = {
      missionId: input.missionId,
      producingSubsystem: RUNTIME_PREVIEW_SOURCE,
      timestamp: completedAt,
      sensitiveValues: state.sensitiveValues,
      workspaceCheckpointReference: input.checkpointId,
      obligationReference: null,
      verificationRequestReference: input.verificationRequestReference,
      commandReference: input.procedureName,
      workUnitReference: input.sessionId,
      metadata: {
        port,
        previewUrl,
        processId: child.pid ?? null,
        startTimestamp: startedAt,
        endTimestamp: completedAt,
      },
    };
    const processEvidence = evidence.capture({
      ...common,
      evidenceId: `${input.evidencePrefix}.process`,
      kind: ObservationKind.RUNTIME_PROCESS_RESULT,
      captureMethod: "supervised-runtime-process",
      payload: {
        sessionId: input.sessionId,
        status: runtimeStatus,
        exitCode: state.exitCode,
        signal: state.signal,
        stdout: text(stdout),
        stderr: text(stderr),
        detail: observation.detail,
      },
    });
    const readinessEvidence = evidence.capture({
      ...common,
      evidenceId: `${input.evidencePrefix}.readiness`,
      kind: ObservationKind.RUNTIME_READINESS_RESULT,
      captureMethod: "active-http-readiness-observation",
      payload: {
        ready: observation.ready,
        detail: observation.detail,
      },
    });
    const evidenceRecords = [processEvidence, readinessEvidence];
    if (observation.response !== null) {
      evidenceRecords.push(
        evidence.capture({
          ...common,
          evidenceId: `${input.evidencePrefix}.http`,
          kind: ObservationKind.HTTP_RESPONSE_RESULT,
          captureMethod: "actual-http-request",
          payload: observation.response,
        }),
      );
    }
    const record = normalizeRuntimeRecord({
      observationId: input.observationId,
      sessionId: input.sessionId,
      missionId: input.missionId,
      workspaceId: input.workspaceId,
      checkpointId: input.checkpointId,
      procedureName: input.procedureName,
      port,
      previewUrl,
      processId: child.pid ?? null,
      startedAt,
      completedAt,
      status: runtimeStatus,
      eventType: RuntimeEventType.STARTUP,
      evidenceReferences: evidenceRecords.map((entry) =>
        evidenceReference(entry, input.checkpointId),
      ),
      idempotencyKey: input.idempotencyKey,
      workUnitReference: input.sessionId,
    });
    appendRuntimeFact(
      record,
      `Runtime session "${input.sessionId}" completed startup observation as ${runtimeStatus}.`,
      input.causationId,
    );
    if (!observation.ready) {
      processes.delete(input.sessionId);
    }
    return record;
  }

  async function observeHealth(input) {
    for (const field of [
      "missionId",
      "sessionId",
      "observationId",
      "evidenceId",
      "causationId",
      "idempotencyKey",
      "verificationRequestReference",
    ]) {
      assertIdentifier(input[field], field);
    }
    assertExecuting(input.missionId);
    const prior = latestSession(input.missionId, input.sessionId);
    const state = processes.get(input.sessionId);
    let response = null;
    if (state !== undefined && !state.exited) {
      const result = await observeHttp(prior.previewUrl, 2_000, state);
      response = result.response;
    }
    const healthy = state !== undefined && !state.exited && response !== null;
    const status = healthy ? RuntimeStatus.HEALTHY : RuntimeStatus.CRASHED;
    const completedAt = clock();
    const common = {
      missionId: input.missionId,
      producingSubsystem: RUNTIME_PREVIEW_SOURCE,
      timestamp: completedAt,
      sensitiveValues: state?.sensitiveValues ?? [],
      workspaceCheckpointReference: prior.checkpointId,
      obligationReference: null,
      verificationRequestReference: input.verificationRequestReference,
      commandReference: prior.procedureName,
      workUnitReference: input.sessionId,
      metadata: { previewUrl: prior.previewUrl },
    };
    const recordEvidence = evidence.capture({
      ...common,
      evidenceId: input.evidenceId,
      kind: ObservationKind.RUNTIME_PROCESS_RESULT,
      captureMethod: "runtime-process-health-observation",
      payload: {
        sessionId: input.sessionId,
        status,
        exitCode: state?.exitCode ?? null,
        signal: state?.signal ?? null,
        stdout: state === undefined ? "" : text(state.stdout),
        stderr: state === undefined ? "" : text(state.stderr),
        detail: healthy
          ? "Runtime process and HTTP surface are healthy."
          : "Runtime process is unavailable or has crashed.",
      },
    });
    const healthEvidence = [recordEvidence];
    if (healthy) {
      healthEvidence.push(
        evidence.capture({
          ...common,
          evidenceId: `${input.evidenceId}.readiness`,
          kind: ObservationKind.RUNTIME_READINESS_RESULT,
          captureMethod: "active-http-health-readiness",
          payload: {
            ready: true,
            detail: "Runtime remained ready under an actual HTTP observation.",
          },
        }),
        evidence.capture({
          ...common,
          evidenceId: `${input.evidenceId}.http`,
          kind: ObservationKind.HTTP_RESPONSE_RESULT,
          captureMethod: "actual-http-health-request",
          payload: response,
        }),
      );
    }
    const record = normalizeRuntimeRecord({
      ...prior,
      observationId: input.observationId,
      completedAt,
      status,
      eventType: RuntimeEventType.HEALTH,
      evidenceReferences: healthEvidence.map((entry) =>
        evidenceReference(entry, prior.checkpointId),
      ),
      idempotencyKey: input.idempotencyKey,
      workUnitReference: input.sessionId,
    });
    appendRuntimeFact(
      record,
      `Runtime health observation for "${input.sessionId}" was ${status}.`,
      input.causationId,
    );
    if (!healthy) {
      processes.delete(input.sessionId);
    }
    return record;
  }

  function captureBrowserVerification(input) {
    for (const field of [
      "missionId",
      "sessionId",
      "commandWorkUnitId",
      "observationId",
      "evidencePrefix",
      "causationId",
      "idempotencyKey",
      "verificationRequestReference",
    ]) {
      assertIdentifier(input[field], field);
    }
    assertExecuting(input.missionId);
    const session = latestSession(input.missionId, input.sessionId);
    const commandEvidence = evidence
      .findByWorkUnit(input.commandWorkUnitId)
      .find(
        (record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT,
      );
    if (
      commandEvidence === undefined ||
      commandEvidence.missionId !== input.missionId
    ) {
      throw new BrowserObservationError(
        "Browser command evidence is missing or bound to another state.",
      );
    }
    const observedCheckpointId =
      commandEvidence.workspaceCheckpointReference;
    // Browser checks are intentionally isolated: they may create accounts,
    // rows, screenshots, and other observation output. The production mission
    // restores the clean pre-check checkpoint before it certifies or hands the
    // preview to the customer. Keep the command's post-check checkpoint as
    // immutable audit provenance, but bind the derived verdict to the current
    // clean checkpoint only after proving that all three states contain the
    // same runtime source.
    const currentCheckpointId =
      workspaces.getWorkspace(input.missionId).currentCheckpointId;
    const checkpoints = workspaces.listMissionCheckpoints(input.missionId);
    const checkpointById = new Map(
      checkpoints.map((checkpoint) => [checkpoint.checkpointId, checkpoint]),
    );
    const startedCheckpoint = checkpointById.get(session.checkpointId);
    const observedCheckpoint = checkpointById.get(observedCheckpointId);
    const currentCheckpoint = checkpointById.get(currentCheckpointId);
    const targetCheckpoint = browserCertificationCheckpoint({
      startedCheckpoint,
      observedCheckpoint,
      currentCheckpoint,
    });
    const allowEmptyChecks = input.allowEmptyChecks === true;
    const result = parseBrowserResult(commandEvidence.payload.stdout, {
      allowEmptyChecks,
    });
    const authoritativeCheckOverrides =
      input.authoritativeCheckOverrides === undefined
        ? {}
        : input.authoritativeCheckOverrides;
    const resolvedChecks = resolveAuthoritativeBrowserChecks(
      result.checks,
      authoritativeCheckOverrides,
    );
    const timestamp = clock();
    const common = {
      missionId: input.missionId,
      producingSubsystem: RUNTIME_PREVIEW_SOURCE,
      timestamp,
      sensitiveValues: [],
      workspaceCheckpointReference: targetCheckpoint,
      obligationReference: null,
      verificationRequestReference: input.verificationRequestReference,
      commandReference: "browserVerification",
      workUnitReference: input.commandWorkUnitId,
      metadata: {
        sessionId: input.sessionId,
        previewUrl: session.previewUrl,
        sourceCommandEvidenceId: commandEvidence.evidenceId,
        observedCommandCheckpoint: observedCheckpointId,
        certifiedCurrentCheckpoint: targetCheckpoint,
        rawChecks: result.checks,
        authoritativeCheckOverrides,
      },
    };
    const interaction =
      Object.keys(resolvedChecks).length === 0
        ? null
        : evidence.capture({
            ...common,
            evidenceId: `${input.evidencePrefix}.interactions`,
            kind: ObservationKind.BROWSER_INTERACTION_RESULT,
            captureMethod: "playwright-browser-observation",
            payload: { checks: resolvedChecks },
          });
    const errors = evidence.capture({
      ...common,
      evidenceId: `${input.evidencePrefix}.errors`,
      kind: ObservationKind.BROWSER_ERROR_RESULT,
      captureMethod: "playwright-console-and-page-error-observation",
      payload: {
        captureProbeErrors: result.captureProbeErrors,
        consoleErrors: result.consoleErrors,
        pageErrors: result.pageErrors,
      },
    });
    const checkValues = Object.values(resolvedChecks);
    const passedCount =
      checkValues.filter(Boolean).length +
      (checkValues.length === 0 && commandEvidence.payload.exitCode === 0
        ? 1
        : 0);
    const failedCount =
      checkValues.filter((passed) => !passed).length +
      (commandEvidence.payload.exitCode === 0 ? 0 : 1) +
      result.consoleErrors.length +
      result.pageErrors.length +
      result.captureProbeErrors.length;
    const structured = evidence.capture({
      ...common,
      evidenceId: `${input.evidencePrefix}.suite`,
      kind: ObservationKind.STRUCTURED_TEST_RESULT,
      captureMethod: "playwright-structured-test-result",
      payload: {
        suiteName: "project-browser-verification",
        passedCount,
        failedCount,
        skippedCount: 0,
      },
    });
    const evidenceRecords = [interaction, errors, structured].filter(Boolean);
    const record = normalizeRuntimeRecord({
      ...session,
      checkpointId: targetCheckpoint,
      observationId: input.observationId,
      completedAt: timestamp,
      status:
        passedCount === Object.values(resolvedChecks).length &&
        result.consoleErrors.length === 0 &&
        result.pageErrors.length === 0
          ? RuntimeStatus.HEALTHY
          : RuntimeStatus.CRASHED,
      eventType: RuntimeEventType.BROWSER_OBSERVATION,
      evidenceReferences: evidenceRecords.map((entry) =>
        evidenceReference(entry, targetCheckpoint),
      ),
      idempotencyKey: input.idempotencyKey,
      workUnitReference: input.commandWorkUnitId,
    });
    appendRuntimeFact(
      record,
      `Captured real browser observations for runtime "${input.sessionId}".`,
      input.causationId,
    );
    return Object.freeze({ record, evidence: evidenceRecords });
  }

  async function stop(input) {
    for (const field of [
      "missionId",
      "sessionId",
      "observationId",
      "evidenceId",
      "causationId",
      "idempotencyKey",
    ]) {
      assertIdentifier(input[field], field);
    }
    const prior = latestSession(input.missionId, input.sessionId);
    const state = processes.get(input.sessionId);
    if (state !== undefined && !state.exited) {
      terminateProcessTree(state.child);
      await Promise.race([
        new Promise((resolve) => state.child.once("close", resolve)),
        new Promise((resolve) => setTimeout(resolve, 5_000)),
      ]);
      // The dev server spawns its own workers, and "close" on the parent says
      // nothing about them. On Windows a worker that is still exiting keeps a
      // handle on the build cache inside the workspace, and the checkpoint
      // restore that follows this stop cannot rename a directory anyone holds.
      // Wait for the tree to actually disappear before returning.
      await awaitProcessTreeExit(state.child.pid);
    } else if (
      Number.isSafeInteger(prior.processId) &&
      prior.processId > 0 &&
      prior.status !== RuntimeStatus.STOPPED
    ) {
      terminateProcessTree({
        pid: prior.processId,
        kill(signal) {
          try {
            process.kill(prior.processId, signal);
          } catch {
            // A recovered process may have exited between replay and cleanup.
          }
        },
      });
    }
    processes.delete(input.sessionId);
    const completedAt = clock();
    const stoppedCheckpointId =
      workspaces.getWorkspace(input.missionId).currentCheckpointId;
    const recordEvidence = evidence.capture({
      evidenceId: input.evidenceId,
      missionId: input.missionId,
      kind: ObservationKind.RUNTIME_PROCESS_RESULT,
      captureMethod: "deterministic-runtime-shutdown",
      producingSubsystem: RUNTIME_PREVIEW_SOURCE,
      timestamp: completedAt,
      payload: {
        sessionId: input.sessionId,
        status: RuntimeStatus.STOPPED,
        exitCode: state?.exitCode ?? null,
        signal: state?.signal ?? null,
        stdout: state === undefined ? "" : text(state.stdout),
        stderr: state === undefined ? "" : text(state.stderr),
        detail: "Runtime process tree was stopped.",
      },
      sensitiveValues: state?.sensitiveValues ?? [],
      workspaceCheckpointReference: stoppedCheckpointId,
      obligationReference: null,
      verificationRequestReference: null,
      commandReference: prior.procedureName,
      workUnitReference: input.sessionId,
      metadata: { previewUrl: prior.previewUrl },
    });
    const record = normalizeRuntimeRecord({
      ...prior,
      checkpointId: stoppedCheckpointId,
      observationId: input.observationId,
      completedAt,
      status: RuntimeStatus.STOPPED,
      eventType: RuntimeEventType.SHUTDOWN,
      evidenceReferences: [
        evidenceReference(recordEvidence, stoppedCheckpointId),
      ],
      idempotencyKey: input.idempotencyKey,
      workUnitReference: input.sessionId,
    });
    appendRuntimeFact(
      record,
      `Stopped runtime session "${input.sessionId}".`,
      input.causationId,
    );
    return record;
  }

  // A preview server outlives the mission that started it unless something
  // ends it, and nothing did when Foundry itself went away. Seventeen of them
  // from three days of missions were still running, each holding a port and a
  // Next.js server, having survived every restart. A child that is only ever
  // stopped on the happy path is not stopped at all.
  function stopEveryRuntime() {
    for (const [sessionId, state] of processes) {
      if (state?.exited === true) continue;
      try {
        terminateProcessTree(state.child);
      } catch {
        // Shutdown is best effort; one unkillable child must not strand the rest.
      }
      processes.delete(sessionId);
    }
  }

  return Object.freeze({
    start,
    observeHealth,
    captureBrowserVerification,
    stop,
    stopEveryRuntime,
    getSession: latestSession,
    listSessions: history,
    getPreviewUrl(missionId, sessionId) {
      const record = latestSession(missionId, sessionId);
      const state = processes.get(sessionId);
      if (
        state === undefined &&
        Number.isSafeInteger(record.processId) &&
        record.processId > 0 &&
        record.status !== RuntimeStatus.STOPPED
      ) {
        try {
          process.kill(record.processId, 0);
          return record.previewUrl;
        } catch {
          // The persisted process identity no longer resolves after restart.
        }
      }
      if (
        state === undefined ||
        state.exited ||
        record.status === RuntimeStatus.STOPPED
      ) {
        throw new RuntimeStateError(
          `Preview for runtime "${sessionId}" is not live.`,
        );
      }
      return record.previewUrl;
    },
  });
}
