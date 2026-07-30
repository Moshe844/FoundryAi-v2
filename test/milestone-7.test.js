import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CERTIFIED_STACK_ID,
  CERTIFIED_STACK_VERSION,
  ExecutionInterruptionError,
  LatencyProfile,
  MissionState,
  ModelCallIdempotencyError,
  ModelContextSecretError,
  ModelOutputValidationError,
  ModelProviderError,
  ModelTaskClass,
  ObservationKind,
  ResultFactValidationError,
  StackCertificationStatus,
  StackSelectionMode,
  WEB_STACK_MANIFEST,
  WorkUnitAction,
  WorkUnitEvidenceRequiredError,
  WorkUnitIdempotencyError,
  WorkUnitStatus,
  createDeterministicLocalModelProvider,
  normalizeWorkUnitRecord,
  openMissionControl,
  WorkspaceIsolationError,
} from "../src/index.js";
import { rankRoutesByPersistedTaskHistory } from "../src/work-plane/model-gateway.js";

const TIME = "2026-07-01T12:00:00.000Z";
const HELLO = "Hello Foundry.";

function temporaryStores(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-v2-execution-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    ledgerDirectory: join(root, "ledger"),
    evidenceDirectory: join(root, "evidence"),
    workspaceDirectory: join(root, "workspaces"),
    registryDirectory: join(root, "registry"),
  };
}

function goodToolProbe(toolId) {
  const versions = {
    browser: "Chromium 125.0.6422",
    git: "git version 2.46.0.windows.1",
    node: process.version,
    npm: "10.9.2",
  };
  return {
    available: true,
    version: versions[toolId],
    executable: `${toolId}-fixture`,
    detail: `${toolId} deterministic fixture is available.`,
  };
}

function openControl(stores, extra = {}) {
  return openMissionControl({
    ...stores,
    clock: () => TIME,
    toolProbe: goodToolProbe,
    ...extra,
  });
}

function persistedText(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      readFileSync(join(entry.parentPath, entry.name), "utf8"),
    )
    .join("\n");
}

function obligation() {
  return {
    obligationId: "hello-file",
    statement: "The exact required greeting exists in hello.txt.",
    origin: "customer-stated",
    acceptanceCondition: {
      type: "file-content-equals",
      path: "hello.txt",
      expectedContent: HELLO,
    },
    requiredEvidenceKinds: [ObservationKind.FILE_CONTENT],
    dependencyObligationIds: [],
    contractVersion: 1,
  };
}

function prepareExecutingMission(
  control,
  missionId,
  { registerStack = true } = {},
) {
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    occurredAt: TIME,
    reason: "Accept deterministic Milestone 7 mission.",
  });
  if (registerStack) {
    control.toolchains.registerStack({
      missionId,
      manifest: WEB_STACK_MANIFEST,
      registryEventId: `${missionId}-registry-register`,
      eventId: `${missionId}-ledger-register`,
      causationId: `${missionId}-register-command`,
      evidenceId: `${missionId}-register-evidence`,
      occurredAt: TIME,
    });
  }
  control.toolchains.checkEnvironment({
    missionId,
    environmentCheckId: `${missionId}-environment`,
    registryEventId: `${missionId}-registry-environment`,
    eventId: `${missionId}-ledger-environment`,
    causationId: `${missionId}-environment-command`,
    evidenceId: `${missionId}-environment-evidence`,
    occurredAt: TIME,
  });
  const selection = control.toolchains.selectStackForCertification({
    missionId,
    selectionId: `${missionId}-selection`,
    stackId: CERTIFIED_STACK_ID,
    stackVersion: CERTIFIED_STACK_VERSION,
    environmentCheckId: `${missionId}-environment`,
    requestedPlatform: "web",
    requiredCapabilities: ["create-records"],
    registryEventId: `${missionId}-registry-selection`,
    eventId: `${missionId}-ledger-selection`,
    causationId: `${missionId}-selection-command`,
    occurredAt: TIME,
  });
  assert.equal(selection.selectionMode, StackSelectionMode.CERTIFICATION);
  assert.equal(
    control.toolchains.getStack(
      CERTIFIED_STACK_ID,
      CERTIFIED_STACK_VERSION,
    ).certificationStatus,
    StackCertificationStatus.PROVISIONAL,
  );
  control.contracts.createContract({
    missionId,
    eventId: `${missionId}-contract`,
    causationId: `${missionId}-contract-command`,
    occurredAt: TIME,
    contractVersion: 1,
    obligations: [obligation()],
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-contracted`,
    causationId: `${missionId}-contracted-command`,
    occurredAt: TIME,
    to: MissionState.CONTRACTED,
    reason: "Contract recorded.",
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-provisioning`,
    causationId: `${missionId}-provisioning-command`,
    occurredAt: TIME,
    to: MissionState.PROVISIONING,
    reason: "Prepare isolated execution workspace.",
  });
  const workspace = control.workspaces.provisionWorkspace({
    missionId,
    workspaceId: `${missionId}-workspace`,
    baselineCheckpointId: `${missionId}-baseline`,
    evidenceId: `${missionId}-provision-evidence`,
    eventId: `${missionId}-provision-event`,
    causationId: `${missionId}-provision-command`,
    reason: "Provision deterministic execution workspace.",
    occurredAt: TIME,
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-executing`,
    causationId: `${missionId}-executing-command`,
    occurredAt: TIME,
    to: MissionState.EXECUTING,
    reason: "Begin bounded certification execution.",
  });
  return workspace;
}

function workRequest(missionId, suffix, actionType, inputs) {
  return {
    workUnitId: `${missionId}-${suffix}`,
    missionId,
    workspaceId: `${missionId}-workspace`,
    targetObligationIds: ["hello-file"],
    actionType,
    inputs,
    preWorkCheckpointId: `${missionId}-${suffix}-pre`,
    postWorkCheckpointId: `${missionId}-${suffix}-post`,
    idempotencyKey: `${missionId}-${suffix}-key`,
  };
}

function modelInput(missionId, suffix = "one") {
  return {
    requestId: `${missionId}-model-${suffix}`,
    missionId,
    workUnitId: `${missionId}-planned-work`,
    purpose: "Produce one deterministic file plan.",
    taskClass: ModelTaskClass.STRUCTURED_TRANSFORMATION,
    contextReferences: [{ kind: "contract", id: `${missionId}-contract` }],
    expectedStructuredOutputSchema: {
      type: "object",
      properties: {
        content: { type: "string" },
        path: { type: "string" },
      },
      required: ["content", "path"],
      additionalProperties: false,
    },
    idempotencyKey: `${missionId}-model-${suffix}-key`,
    sensitiveValues: [],
  };
}

test("performs real allowlisted file actions with pre/post checkpoints and immutable evidence", async (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "real-file-actions";
  const workspace = prepareExecutingMission(control, missionId);

  const write = await control.execution.executeWorkUnit(
    workRequest(missionId, "write", WorkUnitAction.WRITE_FILE, {
      path: "hello.txt",
      content: HELLO,
    }),
  );
  assert.equal(write.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(readFileSync(join(workspace.rootPath, "hello.txt"), "utf8"), HELLO);
  assert.equal(write.evidenceReferences.length, 4);
  assert(
    write.evidenceReferences.every(
      (reference) =>
        reference.workspaceCheckpointReference === write.postWorkCheckpointId,
    ),
  );
  const writeEvidence = control.evidence.findByWorkUnit(write.workUnitId);
  assert(writeEvidence.every((record) => Object.isFrozen(record)));
  assert.throws(() => {
    writeEvidence[0].payload.status = WorkUnitStatus.FAILED;
  }, TypeError);

  await control.execution.executeWorkUnit(
    workRequest(missionId, "mkdir", WorkUnitAction.CREATE_DIRECTORY, {
      path: "nested",
    }),
  );
  await control.execution.executeWorkUnit(
    workRequest(missionId, "replace", WorkUnitAction.REPLACE_FILE, {
      path: "hello.txt",
      content: "replacement\n",
    }),
  );
  const inspect = await control.execution.executeWorkUnit(
    workRequest(missionId, "inspect", WorkUnitAction.INSPECT_FILE, {
      path: "hello.txt",
    }),
  );
  const listing = await control.execution.executeWorkUnit(
    workRequest(missionId, "list", WorkUnitAction.LIST_FILES, {
      path: ".",
    }),
  );
  const deleted = await control.execution.executeWorkUnit(
    workRequest(missionId, "delete", WorkUnitAction.DELETE_FILE, {
      path: "hello.txt",
    }),
  );
  const bundle = await control.execution.executeWorkUnit(
    workRequest(
      missionId,
      "bundle",
      WorkUnitAction.APPLY_FILE_BUNDLE,
      {
        files: [
          { path: "app/page.tsx", content: "export default function Page() { return null; }\n" },
          { path: "app/api/health/route.ts", content: "export const dynamic = 'force-static';\n" },
        ],
      },
    ),
  );

  assert.equal(inspect.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(listing.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(deleted.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(bundle.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(
    readFileSync(join(workspace.rootPath, "app/page.tsx"), "utf8"),
    "export default function Page() { return null; }\n",
  );
  assert.equal(
    control.evidence
      .findByWorkUnit(bundle.workUnitId)
      .some((record) => record.kind === "file-listing"),
    true,
  );
  assert.equal(existsSync(join(workspace.rootPath, "hello.txt")), false);
  assert(existsSync(join(workspace.rootPath, "nested")));
});

test("enforces idempotency and rejects an idempotency key reused for different work", async (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "work-idempotency";
  prepareExecutingMission(control, missionId);
  const request = workRequest(
    missionId,
    "write",
    WorkUnitAction.WRITE_FILE,
    { path: "hello.txt", content: HELLO },
  );

  const first = await control.execution.executeWorkUnit(request);
  const eventCount = control.ledger.listEvents(missionId).length;
  const second = await control.execution.executeWorkUnit(request);
  assert.deepEqual(second, first);
  assert.equal(control.ledger.listEvents(missionId).length, eventCount);

  await assert.rejects(
    control.execution.executeWorkUnit({
      ...request,
      inputs: { path: "different.txt", content: HELLO },
    }),
    WorkUnitIdempotencyError,
  );
});

test("rejects traversal and cross-workspace mutation before unsafe bytes are written", async (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const firstMission = "workspace-boundary-one";
  const secondMission = "workspace-boundary-two";
  const firstWorkspace = prepareExecutingMission(control, firstMission);
  const secondWorkspace = prepareExecutingMission(control, secondMission, {
    registerStack: false,
  });

  const traversal = await control.execution.executeWorkUnit(
    workRequest(firstMission, "traversal", WorkUnitAction.WRITE_FILE, {
      path: "../escaped.txt",
      content: "unsafe",
    }),
  );
  assert.equal(traversal.status, WorkUnitStatus.FAILED);
  assert.equal(existsSync(join(firstWorkspace.rootPath, "..", "escaped.txt")), false);

  await assert.rejects(
    control.execution.executeWorkUnit({
      ...workRequest(
        firstMission,
        "cross-workspace",
        WorkUnitAction.WRITE_FILE,
        { path: "intrusion.txt", content: "unsafe" },
      ),
      workspaceId: secondWorkspace.workspaceId,
    }),
    WorkspaceIsolationError,
  );
  assert.equal(existsSync(join(secondWorkspace.rootPath, "intrusion.txt")), false);
});

test("rejects any completed work-unit projection that has no evidence", () => {
  assert.throws(
    () =>
      normalizeWorkUnitRecord({
        workUnitId: "evidence-free-work",
        missionId: "evidence-free-mission",
        workspaceId: "evidence-free-workspace",
        targetObligationIds: ["hello-file"],
        actionType: WorkUnitAction.INSPECT_FILE,
        inputs: { path: "hello.txt" },
        preWorkCheckpointId: "evidence-free-pre",
        postWorkCheckpointId: "evidence-free-post",
        startTimestamp: TIME,
        endTimestamp: TIME,
        status: WorkUnitStatus.SUCCEEDED,
        evidenceReferences: [],
        idempotencyKey: "evidence-free-key",
      }),
    WorkUnitEvidenceRequiredError,
  );
});

test("recovers an interrupted real file mutation without repeating or losing it", async (t) => {
  const stores = temporaryStores(t);
  let interrupt = true;
  const first = openControl(stores, {
    executionFaultInjector(phase) {
      if (phase === "after-action" && interrupt) {
        interrupt = false;
        throw new ExecutionInterruptionError("Injected interruption.");
      }
    },
  });
  const missionId = "interruption-recovery";
  const workspace = prepareExecutingMission(first, missionId);
  const request = workRequest(
    missionId,
    "write",
    WorkUnitAction.WRITE_FILE,
    { path: "hello.txt", content: HELLO },
  );

  await assert.rejects(
    first.execution.executeWorkUnit(request),
    ExecutionInterruptionError,
  );
  assert.equal(readFileSync(join(workspace.rootPath, "hello.txt"), "utf8"), HELLO);
  assert.equal(first.execution.listWorkUnits(missionId).length, 0);

  const restarted = openControl(stores);
  const recovered = await restarted.execution.executeWorkUnit(request);
  assert.equal(recovered.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(restarted.execution.listWorkUnits(missionId).length, 1);
  assert.equal(readFileSync(join(workspace.rootPath, "hello.txt"), "utf8"), HELLO);
});

test("does not blindly repeat a command interrupted before durable command evidence", async (t) => {
  const stores = temporaryStores(t);
  let interrupt = true;
  const first = openControl(stores, {
    executionFaultInjector(phase) {
      if (phase === "after-action" && interrupt) {
        interrupt = false;
        throw new ExecutionInterruptionError(
          "Interrupt after the child process closes.",
        );
      }
    },
  });
  const missionId = "command-interruption";
  prepareExecutingMission(first, missionId);
  const request = workRequest(
    missionId,
    "command",
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "commandSuccessProbe",
      timeoutMs: 2_000,
      outputLimitBytes: 4_096,
    },
  );
  await assert.rejects(
    first.execution.executeWorkUnit(request),
    ExecutionInterruptionError,
  );

  const restarted = openControl(stores);
  const recovered = await restarted.execution.executeWorkUnit(request);
  assert.equal(recovered.status, WorkUnitStatus.FAILED);
  assert.equal(
    restarted.evidence
      .findByWorkUnit(request.workUnitId)
      .some((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT),
    false,
  );
  assert(
    restarted.evidence
      .findByWorkUnit(request.workUnitId)
      .some(
        (record) =>
          record.kind === ObservationKind.WORK_UNIT_RESULT &&
          record.metadata.interrupted === true,
      ),
  );
});

test("runs only manifest-declared commands and records complete stdout, stderr, exit, and timing evidence", async (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "controlled-command";
  const workspace = prepareExecutingMission(control, missionId);
  await control.execution.executeWorkUnit(
    workRequest(missionId, "preserved-write", WorkUnitAction.WRITE_FILE, {
      path: "hello.txt",
      content: HELLO,
    }),
  );

  const success = await control.execution.executeWorkUnit(
    workRequest(missionId, "command-ok", WorkUnitAction.RUN_COMMAND, {
      procedureName: "commandSuccessProbe",
      workingDirectory: ".",
      environment: {},
      timeoutMs: 2_000,
      outputLimitBytes: 4_096,
    }),
  );
  const successEvidence = control.evidence
    .findByWorkUnit(success.workUnitId)
    .find((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT);
  assert.equal(success.status, WorkUnitStatus.SUCCEEDED);
  assert.deepEqual(successEvidence.payload, {
    exitCode: 0,
    stdout: "command-ok\n",
    stderr: "command-note\n",
  });
  assert.equal(successEvidence.metadata.declaredExecutable, "node");
  assert.equal(successEvidence.metadata.timeoutMs, 2_000);
  assert.equal(typeof successEvidence.metadata.startTimestamp, "string");
  assert.equal(typeof successEvidence.metadata.endTimestamp, "string");

  const failed = await control.execution.executeWorkUnit(
    workRequest(missionId, "command-fail", WorkUnitAction.RUN_COMMAND, {
      procedureName: "commandFailureProbe",
      timeoutMs: 2_000,
      outputLimitBytes: 4_096,
    }),
  );
  assert.equal(failed.status, WorkUnitStatus.FAILED);
  assert.equal(readFileSync(join(workspace.rootPath, "hello.txt"), "utf8"), HELLO);
  assert.equal(control.orchestrator.state(missionId).state, MissionState.EXECUTING);

  const undeclared = await control.execution.executeWorkUnit(
    workRequest(missionId, "command-denied", WorkUnitAction.RUN_COMMAND, {
      procedureName: "arbitraryShellCommand",
    }),
  );
  assert.equal(undeclared.status, WorkUnitStatus.FAILED);
});

test("enforces timeout, cancellation, output limits, environment filtering, and secret-safe persistence", async (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "command-controls";
  prepareExecutingMission(control, missionId);

  const timedOut = await control.execution.executeWorkUnit(
    workRequest(missionId, "timeout", WorkUnitAction.RUN_COMMAND, {
      procedureName: "longRunningProbe",
      timeoutMs: 50,
      outputLimitBytes: 4_096,
    }),
  );
  assert.equal(timedOut.status, WorkUnitStatus.TIMED_OUT);

  const tree = await control.execution.executeWorkUnit(
    workRequest(missionId, "tree-timeout", WorkUnitAction.RUN_COMMAND, {
      procedureName: "processTreeProbe",
      timeoutMs: 200,
      outputLimitBytes: 4_096,
    }),
  );
  assert.equal(tree.status, WorkUnitStatus.TIMED_OUT);
  const treeEvidence = control.evidence
    .findByWorkUnit(tree.workUnitId)
    .find((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT);
  const descendantPid = Number.parseInt(treeEvidence.payload.stdout.trim(), 10);
  assert(Number.isSafeInteger(descendantPid));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.throws(() => process.kill(descendantPid, 0));

  const abort = new AbortController();
  abort.abort();
  const cancelled = await control.execution.executeWorkUnit(
    workRequest(missionId, "cancel", WorkUnitAction.RUN_COMMAND, {
      procedureName: "longRunningProbe",
      timeoutMs: 2_000,
      outputLimitBytes: 4_096,
    }),
    { cancellationSignal: abort.signal },
  );
  assert.equal(cancelled.status, WorkUnitStatus.CANCELLED);

  const bounded = await control.execution.executeWorkUnit(
    workRequest(missionId, "bounded", WorkUnitAction.RUN_COMMAND, {
      procedureName: "outputLimitProbe",
      timeoutMs: 2_000,
      outputLimitBytes: 128,
    }),
  );
  assert.equal(bounded.status, WorkUnitStatus.OUTPUT_LIMIT_EXCEEDED);
  const boundedEvidence = control.evidence
    .findByWorkUnit(bounded.workUnitId)
    .find((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT);
  assert(Buffer.byteLength(boundedEvidence.payload.stdout) <= 128);

  const secret = "do-not-persist-this-value";
  const filtered = await control.execution.executeWorkUnit(
    workRequest(missionId, "environment", WorkUnitAction.RUN_COMMAND, {
      procedureName: "environmentFilterProbe",
      environment: { FOUNDRY_TEST_VALUE: secret },
      timeoutMs: 2_000,
      outputLimitBytes: 4_096,
    }),
  );
  assert.equal(filtered.status, WorkUnitStatus.SUCCEEDED);
  const environmentEvidence = control.evidence
    .findByWorkUnit(filtered.workUnitId)
    .find((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT);
  assert.equal(environmentEvidence.payload.stdout, "present");
  assert(
    environmentEvidence.metadata.environmentVariableNames.includes(
      "FOUNDRY_TEST_VALUE",
    ),
  );
  assert(
    environmentEvidence.metadata.environmentVariableNames.every((name) =>
      [
        "APPDATA",
        "ComSpec",
        "FOUNDRY_TEST_VALUE",
        "LOCALAPPDATA",
        "PATH",
        "PATHEXT",
        "SystemRoot",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "WINDIR",
      ].includes(name),
    ),
  );
  assert(!readFileSync(join(stores.ledgerDirectory, `${missionId}.jsonl`), "utf8").includes(secret));
  const persistedEvidence = persistedText(stores.evidenceDirectory);
  assert(!persistedEvidence.includes(secret));
});

test("records structured model calls, deterministic routing, bounded failover, cost, and idempotency", async (t) => {
  const stores = temporaryStores(t);
  let firstAttempts = 0;
  let secondAttempts = 0;
  const firstProvider = createDeterministicLocalModelProvider({
    providerId: "fixture-failing",
    handler() {
      firstAttempts += 1;
      throw new Error("deterministic transient failure");
    },
  });
  const secondProvider = createDeterministicLocalModelProvider({
    providerId: "fixture-success",
    handler() {
      secondAttempts += 1;
      return {
        output: { path: "hello.txt", content: HELLO },
        usage: { inputTokens: 11, outputTokens: 4, costUsd: 0.0015 },
      };
    },
  });
  const control = openControl(stores, {
    modelProviders: [firstProvider, secondProvider],
    maxModelProviderAttempts: 2,
  });
  const missionId = "model-gateway";
  const workspace = prepareExecutingMission(control, missionId);
  const input = modelInput(missionId);

  const result = await control.models.request(input);
  assert.deepEqual(result.structuredOutput, {
    path: "hello.txt",
    content: HELLO,
  });
  assert.deepEqual(result.tokenMetadata, { inputTokens: 11, outputTokens: 4 });
  assert.deepEqual(result.costMetadata, { attemptCount: 2, costUsd: 0.0015 });
  assert.equal(firstAttempts, 1);
  assert.equal(secondAttempts, 1);
  assert.equal("provider" in result, false);
  const generated = await control.execution.executeWorkUnit(
    workRequest(
      missionId,
      "planned-work",
      WorkUnitAction.WRITE_FILE,
      result.structuredOutput,
    ),
  );
  assert.equal(generated.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(readFileSync(join(workspace.rootPath, "hello.txt"), "utf8"), HELLO);

  const repeated = await control.models.request(input);
  assert.deepEqual(repeated, result);
  assert.equal(firstAttempts, 1);
  assert.equal(secondAttempts, 1);
  const persisted = control.models.listCalls(missionId)[0];
  assert.equal(persisted.provider, "fixture-success");
  assert.equal(persisted.modelTier, "MECHANICAL");
  assert.equal(persisted.costMetadata.costUsd, 0.0015);

  await assert.rejects(
    control.models.request({
      ...input,
      purpose: "Different work under the same key.",
    }),
    ModelCallIdempotencyError,
  );
});

test("semantic structured-output validation fails over before a repair is persisted", async (t) => {
  const attempts = [];
  const invalidProvider = createDeterministicLocalModelProvider({
    providerId: "semantic-a-invalid",
    handler() {
      attempts.push("invalid");
      return {
        output: { path: "hello.txt", content: "repeat-old-hypothesis" },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      };
    },
  });
  const validProvider = createDeterministicLocalModelProvider({
    providerId: "semantic-b-valid",
    handler() {
      attempts.push("valid");
      return {
        output: { path: "hello.txt", content: HELLO },
        usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 },
      };
    },
  });
  const control = openControl(temporaryStores(t), {
    modelProviders: [invalidProvider, validProvider],
    maxModelProviderAttempts: 2,
  });
  const missionId = "semantic-model-failover";
  prepareExecutingMission(control, missionId);

  const result = await control.models.request({
    ...modelInput(missionId),
    structuredOutputValidator(output) {
      if (output.content !== HELLO) {
        throw new Error("The proposed repair is not applicable.");
      }
    },
  });

  assert.deepEqual(attempts, ["invalid", "valid"]);
  assert.equal(result.structuredOutput.content, HELLO);
  assert.equal(result.costMetadata.attemptCount, 2);
  assert.equal(control.models.listCalls(missionId)[0].provider, "semantic-b-valid");
});

test("routes normal application generation to a balanced model instead of a thorough model", async (t) => {
  const attempts = [];
  const provider = (providerId, latencyProfile) =>
    createDeterministicLocalModelProvider({
      providerId,
      modelId: `${providerId}-model`,
      latencyProfile,
      observedPerformance:
        latencyProfile === LatencyProfile.THOROUGH ? 100 : 80,
      handler() {
        attempts.push(providerId);
        return {
          output: { path: "hello.txt", content: HELLO },
          usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 },
        };
      },
    });
  const control = openControl(temporaryStores(t), {
    modelProviders: [
      provider("fast-provider", LatencyProfile.FAST),
      provider("balanced-provider", LatencyProfile.BALANCED),
      provider("thorough-provider", LatencyProfile.THOROUGH),
    ],
  });
  const missionId = "task-tier-routing";
  prepareExecutingMission(control, missionId);
  await control.models.request({
    ...modelInput(missionId),
    taskClass: ModelTaskClass.FILE_GENERATION,
  });
  assert.deepEqual(attempts, ["balanced-provider"]);
  const [call] = control.models.listCalls(missionId);
  assert.equal(call.modelId, "balanced-provider-model");
  assert.equal(call.modelTier, "STANDARD_ENGINEERING");
  const route = control.evidence
    .findByMission(missionId)
    .find((record) => record.captureMethod === "model-gateway-route-dispatch");
  assert.match(route.metadata.routingReason, /prefers BALANCED models/u);
});

test("rejects malformed model output and prevents secrets from entering model context or logs", async (t) => {
  let attempts = 0;
  const provider = createDeterministicLocalModelProvider({
    handler(request) {
      attempts += 1;
      if (request.requestId.includes("provider-failure")) {
        throw new Error("deterministic provider outage");
      }
      return {
        output: { unexpected: true },
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      };
    },
  });
  const stores = temporaryStores(t);
  const control = openControl(stores, {
    modelProviders: [provider],
    maxModelProviderAttempts: 1,
  });
  const missionId = "model-validation";
  prepareExecutingMission(control, missionId);

  await assert.rejects(
    control.models.request(modelInput(missionId, "bad-output")),
    ModelOutputValidationError,
  );
  assert.equal(control.models.listCalls(missionId)[0].status, "FAILED");
  const callsAfterFailure = attempts;
  await assert.rejects(
    control.models.request(modelInput(missionId, "bad-output")),
  );
  assert.equal(attempts, callsAfterFailure);

  await assert.rejects(
    control.models.request(modelInput(missionId, "provider-failure")),
    ModelProviderError,
  );
  assert.equal(
    control.models
      .listCalls(missionId)
      .find((call) => call.requestId.includes("provider-failure")).status,
    "FAILED",
  );

  const secret = "model-secret-never-persist";
  await assert.rejects(
    control.models.request({
      ...modelInput(missionId, "secret"),
      purpose: `Leak ${secret}`,
      sensitiveValues: [secret],
    }),
    ModelContextSecretError,
  );
  assert(!readFileSync(join(stores.ledgerDirectory, `${missionId}.jsonl`), "utf8").includes(secret));
});

test("keeps mutation authority private and reconstructs work/model history only from persisted facts", async (t) => {
  const provider = createDeterministicLocalModelProvider({
    handler() {
      return {
        output: { path: "hello.txt", content: HELLO },
        usage: { inputTokens: 2, outputTokens: 1, costUsd: 0 },
      };
    },
  });
  const stores = temporaryStores(t);
  const control = openControl(stores, { modelProviders: [provider] });
  const missionId = "execution-replay";
  prepareExecutingMission(control, missionId);
  const request = workRequest(
    missionId,
    "write",
    WorkUnitAction.WRITE_FILE,
    { path: "hello.txt", content: HELLO },
  );
  await control.execution.executeWorkUnit(request);
  await control.models.request(modelInput(missionId));

  assert.deepEqual(Object.keys(control.workspaces).sort(), [
    "createCheckpoint",
    "getLatestCheckpoint",
    "getLatestVerifiedCheckpoint",
    "getWorkspace",
    "listMissionCheckpoints",
    "markCheckpointVerified",
    "provisionWorkspace",
    "readFile",
    "releaseWorkspace",
    "restoreCheckpoint",
  ]);
  assert.equal("writeFile" in control.workspaces, false);
  assert.equal("transition" in control.execution, false);
  assert.equal("transition" in control.models, false);
  assert.throws(
    () =>
      control.facts.recordResultFact({
        missionId,
        eventId: `${missionId}-forged-execution`,
        causationId: `${missionId}-forged-command`,
        producingSubsystem: "EXECUTION_ENGINE",
        statement: "Attempt to forge execution history.",
        evidenceReferences: [],
        workspaceCheckpointReference: null,
        workUnitReference: null,
        metadata: { executionRecord: {} },
        occurredAt: TIME,
      }),
    ResultFactValidationError,
  );

  const restarted = openControl(stores, { modelProviders: [provider] });
  assert.deepEqual(restarted.execution.listWorkUnits(missionId), control.execution.listWorkUnits(missionId));
  assert.deepEqual(restarted.models.listCalls(missionId), control.models.listCalls(missionId));
  assert.equal(restarted.orchestrator.state(missionId).state, MissionState.EXECUTING);
});

test("completes the required real hello-file path through Verification Authority and restart", async (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "hello-full-path";
  const workspace = prepareExecutingMission(control, missionId);
  const work = await control.execution.executeWorkUnit(
    workRequest(missionId, "write", WorkUnitAction.WRITE_FILE, {
      path: "hello.txt",
      content: HELLO,
    }),
  );
  const contentEvidence = control.evidence
    .findByWorkUnit(work.workUnitId)
    .find((record) => record.kind === ObservationKind.FILE_CONTENT);

  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-verifying`,
    causationId: `${missionId}-verifying-command`,
    occurredAt: TIME,
    to: MissionState.VERIFYING,
    reason: "Verify exact observed file content.",
  });
  const verdict = control.verification.verify({
    missionId,
    verdictId: `${missionId}-verdict`,
    eventId: `${missionId}-verdict-event`,
    causationId: `${missionId}-verification`,
    verificationTimestamp: TIME,
    workspaceCheckpointReference: work.postWorkCheckpointId,
    evidenceByObligation: {
      "hello-file": [contentEvidence.evidenceId],
    },
  });
  assert.equal(verdict.overallResult, "COMPLETE");
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-succeeded`,
    causationId: `${missionId}-succeeded-command`,
    occurredAt: TIME,
    to: MissionState.SUCCEEDED,
    reason: "Completion Verdict is COMPLETE.",
  });

  const restarted = openControl(stores);
  assert.equal(restarted.orchestrator.state(missionId).state, MissionState.SUCCEEDED);
  assert.equal(
    restarted.workspaces.readFile({
      missionId,
      workspaceId: workspace.workspaceId,
      relativePath: "hello.txt",
    }).toString("utf8"),
    HELLO,
  );
  assert.deepEqual(restarted.execution.listWorkUnits(missionId), [work]);
  assert.equal(
    restarted.toolchains.getStack(
      CERTIFIED_STACK_ID,
      CERTIFIED_STACK_VERSION,
    ).certificationStatus,
    StackCertificationStatus.PROVISIONAL,
  );
});

test("persisted task-specific outcomes move a reliable live route ahead of repeated failures", () => {
  const routes = [
    { providerId: "anthropic" },
    { providerId: "google-gemini" },
    { providerId: "openai" },
  ];
  const history = [
    {
      kind: "route",
      requestId: "generation-1",
      providerId: "anthropic",
      taskClass: ModelTaskClass.FILE_GENERATION,
      routeAttempt: 1,
    },
    {
      kind: "route",
      requestId: "generation-1",
      providerId: "google-gemini",
      taskClass: ModelTaskClass.FILE_GENERATION,
      routeAttempt: 2,
    },
    {
      kind: "route",
      requestId: "generation-1",
      providerId: "openai",
      taskClass: ModelTaskClass.FILE_GENERATION,
      routeAttempt: 3,
    },
    {
      kind: "result",
      requestId: "generation-1",
      providerId: "openai",
      taskClass: ModelTaskClass.FILE_GENERATION,
      status: "SUCCEEDED",
    },
  ];
  assert.deepEqual(
    rankRoutesByPersistedTaskHistory(
      routes,
      history,
      ModelTaskClass.FILE_GENERATION,
    ).map((route) => route.providerId),
    ["openai", "anthropic", "google-gemini"],
  );
  assert.deepEqual(
    rankRoutesByPersistedTaskHistory(
      routes,
      history,
      ModelTaskClass.REPAIR_IMPLEMENTATION,
    ).map((route) => route.providerId),
    routes.map((route) => route.providerId),
  );
});
