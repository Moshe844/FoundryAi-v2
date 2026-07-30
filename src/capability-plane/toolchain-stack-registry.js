import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  DuplicateEventError,
  DuplicateRegistryEventError,
  DuplicateStackVersionError,
  EnvironmentCheckNotFoundError,
  EvidenceNotFoundError,
  EvidenceReferenceError,
  StackCertificationError,
  StackSelectionValidationError,
  StaleCertificationError,
  UncertifiedStackError,
  UnknownStackError,
} from "../domain/errors.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import { MissionState } from "../domain/lifecycle.js";
import {
  CertificationEvidenceScope,
  RegistryOperation,
  StackCertificationStatus,
  StackSelectionMode,
  TOOLCHAIN_STACK_REGISTRY_SOURCE,
  WEB_STACK_MANIFEST,
  assertRegistryIdentifier,
  canonicalizeStackValue,
  evaluateStackEligibility,
  freezeStackValue,
  normalizeEnvironmentDetection,
  normalizeStackManifest,
} from "../domain/toolchain-stack.js";

const CERTIFICATION_CAPABILITIES = Object.freeze([
  "built",
  "generated",
  "observed",
  "ran",
  "tested",
]);

function commandVersion(executable, args) {
  const output = execFileSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 5_000,
  }).trim();
  if (output.length === 0) {
    throw new Error("version command returned no output");
  }
  return output;
}

function browserCandidates() {
  if (process.platform === "win32") {
    return [
      process.env.PROGRAMFILES
        ? join(
            process.env.PROGRAMFILES,
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe",
          )
        : null,
      process.env["PROGRAMFILES(X86)"]
        ? join(
            process.env["PROGRAMFILES(X86)"],
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe",
          )
        : null,
      process.env.PROGRAMFILES
        ? join(
            process.env.PROGRAMFILES,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          )
        : null,
      process.env.LOCALAPPDATA
        ? join(
            process.env.LOCALAPPDATA,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          )
        : null,
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
}

function browserVersion(executable) {
  if (process.platform !== "win32") {
    return commandVersion(executable, ["--version"]);
  }
  const escaped = executable.replaceAll("'", "''");
  return commandVersion("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `(Get-Item -LiteralPath '${escaped}').VersionInfo.ProductVersion`,
  ]);
}

function npmVersion() {
  if (typeof process.env.npm_execpath === "string") {
    return commandVersion(process.execPath, [
      process.env.npm_execpath,
      "--version",
    ]);
  }
  if (process.platform === "win32") {
    return commandVersion("cmd.exe", [
      "/d",
      "/s",
      "/c",
      "npm.cmd --version",
    ]);
  }
  return commandVersion("npm", ["--version"]);
}

export function probeLocalTool(toolId) {
  try {
    if (toolId === "node") {
      return {
        available: true,
        version: process.version,
        executable: process.execPath,
        detail: "Node.js is the current Foundry host process.",
      };
    }
    if (toolId === "npm") {
      const executable = process.platform === "win32" ? "npm.cmd" : "npm";
      return {
        available: true,
        version: npmVersion(),
        executable,
        detail: "npm version command completed without installing dependencies.",
      };
    }
    if (toolId === "git") {
      return {
        available: true,
        version: commandVersion("git", ["--version"]),
        executable: "git",
        detail: "Git version command completed.",
      };
    }
    if (toolId === "browser") {
      const executable = browserCandidates().find((candidate) =>
        existsSync(candidate),
      );
      if (executable === undefined) {
        return {
          available: false,
          version: null,
          executable: null,
          detail:
            "No supported Chromium-family browser executable was found.",
        };
      }
      return {
        available: true,
        version: browserVersion(executable),
        executable,
        detail:
          "A Chromium-family browser executable is present for future Playwright use; no browser session was started.",
      };
    }
    return {
      available: false,
      version: null,
      executable: null,
      detail: `Unknown environment capability "${toolId}".`,
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      executable: null,
      detail: `${toolId} version detection failed: ${error.message}`,
    };
  }
}

export function detectLocalEnvironment({
  missionId,
  environmentCheckId,
  capturedAt,
  toolProbe = probeLocalTool,
  hostPlatform = process.platform,
}) {
  if (typeof toolProbe !== "function") {
    throw new StackSelectionValidationError("toolProbe must be a function.");
  }
  const tools = {};
  for (const toolId of ["browser", "git", "node", "npm"]) {
    let result;
    try {
      result = toolProbe(toolId);
    } catch (error) {
      result = {
        available: false,
        version: null,
        executable: null,
        detail: `${toolId} detection failed: ${error.message}`,
      };
    }
    tools[toolId] = result;
  }
  return normalizeEnvironmentDetection({
    environmentCheckId,
    missionId,
    capturedAt,
    hostPlatform,
    tools,
  });
}

function evidenceReference(evidence) {
  return {
    evidenceId: evidence.evidenceId,
    workspaceCheckpointReference:
      evidence.workspaceCheckpointReference,
  };
}

function captureOrReuseEvidence(evidence, input) {
  try {
    const existing = evidence.getById(input.evidenceId);
    const expected = {
      missionId: input.missionId,
      kind: input.kind,
      captureMethod: input.captureMethod,
      producingSubsystem: input.producingSubsystem,
      timestamp: input.timestamp,
      payload: input.payload,
      workspaceCheckpointReference:
        input.workspaceCheckpointReference ?? null,
      obligationReference: input.obligationReference ?? null,
      verificationRequestReference:
        input.verificationRequestReference ?? null,
      commandReference: input.commandReference ?? null,
      workUnitReference: input.workUnitReference ?? null,
      metadata: input.metadata ?? {},
    };
    const actual = {
      missionId: existing.missionId,
      kind: existing.kind,
      captureMethod: existing.captureMethod,
      producingSubsystem: existing.producingSubsystem,
      timestamp: existing.timestamp,
      payload: existing.payload,
      workspaceCheckpointReference:
        existing.workspaceCheckpointReference,
      obligationReference: existing.obligationReference,
      verificationRequestReference:
        existing.verificationRequestReference,
      commandReference: existing.commandReference,
      workUnitReference: existing.workUnitReference,
      metadata: existing.metadata,
    };
    if (
      canonicalizeStackValue(actual) !== canonicalizeStackValue(expected)
    ) {
      throw new EvidenceReferenceError(
        `Existing evidence "${input.evidenceId}" does not match the recoverable registry observation.`,
        input.evidenceId,
      );
    }
    return existing;
  } catch (error) {
    if (!(error instanceof EvidenceNotFoundError)) {
      throw error;
    }
  }
  return evidence.capture(input);
}

function resultFactShape({
  statement,
  evidenceRecord,
  metadata,
}) {
  return {
    statement,
    resultBearing: true,
    evidenceReferences: [evidenceReference(evidenceRecord)],
    workspaceCheckpointReference:
      evidenceRecord.workspaceCheckpointReference,
    workUnitReference: null,
    metadata,
  };
}

function recordFactOrReuse({
  ledger,
  facts,
  missionId,
  eventId,
  causationId,
  occurredAt,
  statement,
  evidenceRecord,
  metadata,
}) {
  const desired = resultFactShape({
    statement,
    evidenceRecord,
    metadata,
  });
  const existing = ledger
    .listEvents(missionId)
    .find((event) => event.eventId === eventId);
  if (existing !== undefined) {
    if (
      existing.type === "RESULT_FACT_RECORDED" &&
      existing.source === TOOLCHAIN_STACK_REGISTRY_SOURCE &&
      existing.causationId === causationId &&
      existing.occurredAt === occurredAt &&
      canonicalizeStackValue(existing.fact) ===
        canonicalizeStackValue(desired)
    ) {
      return existing;
    }
    throw new DuplicateEventError(missionId, eventId);
  }
  return facts.recordResultFact({
    missionId,
    eventId,
    causationId,
    occurredAt,
    producingSubsystem: TOOLCHAIN_STACK_REGISTRY_SOURCE,
    statement,
    evidenceReferences: desired.evidenceReferences,
    workspaceCheckpointReference:
      desired.workspaceCheckpointReference,
    workUnitReference: null,
    metadata,
  });
}

function normalizeCapabilities(value) {
  if (!Array.isArray(value)) {
    throw new StackSelectionValidationError(
      "requiredCapabilities must be an array.",
    );
  }
  if (
    value.some(
      (entry) => typeof entry !== "string" || entry.trim().length === 0,
    )
  ) {
    throw new StackSelectionValidationError(
      "requiredCapabilities must contain non-empty strings.",
    );
  }
  const normalized = value.map((entry) => entry.trim());
  if (new Set(normalized).size !== normalized.length) {
    throw new StackSelectionValidationError(
      "requiredCapabilities must not contain duplicates.",
    );
  }
  return normalized.sort();
}

function validateCertificationEvidence({
  record,
  stackId,
  stackVersion,
  allowDeterministicCertificationFixtures,
  evidence,
  ledger,
}) {
  if (
    record.kind !== ObservationKind.STRUCTURED_TEST_RESULT ||
    record.payload?.passedCount !== 5 ||
    record.payload?.failedCount !== 0 ||
    record.payload?.skippedCount !== 0 ||
    record.metadata?.stackId !== stackId ||
    record.metadata?.stackVersion !== stackVersion
  ) {
    throw new StackCertificationError(
      "Certification evidence must record all five stack capabilities as passed.",
    );
  }
  const capabilities = record.metadata?.certificationCapabilities;
  if (
    capabilities === null ||
    typeof capabilities !== "object" ||
    Array.isArray(capabilities) ||
    CERTIFICATION_CAPABILITIES.some(
      (capability) => capabilities[capability] !== true,
    ) ||
    Object.keys(capabilities).sort().join(",") !==
      CERTIFICATION_CAPABILITIES.join(",")
  ) {
    throw new StackCertificationError(
      "Certification evidence must attest generate, build, run, test, and observe capabilities.",
    );
  }
  const scope = record.metadata?.certificationScope;
  if (
    scope === CertificationEvidenceScope.DETERMINISTIC_TEST_FIXTURE &&
    allowDeterministicCertificationFixtures
  ) {
    return scope;
  }
  if (scope === CertificationEvidenceScope.END_TO_END_MISSION) {
    const missionIds = record.metadata?.cleanRunMissionIds;
    const evidenceIds = record.metadata?.cleanRunEvidenceIds;
    if (
      !Array.isArray(missionIds) ||
      !Array.isArray(evidenceIds) ||
      missionIds.length !== 3 ||
      evidenceIds.length !== 3 ||
      new Set(missionIds).size !== 3 ||
      new Set(evidenceIds).size !== 3
    ) {
      throw new StackCertificationError(
        "Production certification requires exactly three distinct clean mission runs.",
      );
    }
    const workspaceIds = new Set();
    for (let index = 0; index < 3; index += 1) {
      let runEvidence;
      try {
        runEvidence = evidence.getById(evidenceIds[index]);
      } catch (error) {
        throw new StackCertificationError(
          "A clean-run certification evidence reference is invalid.",
          { cause: error },
        );
      }
      const runCapabilities =
        runEvidence.metadata?.certificationCapabilities;
      if (
        runEvidence.missionId !== missionIds[index] ||
        ledger.projectState(missionIds[index]).state !==
          MissionState.SUCCEEDED ||
        runEvidence.kind !== ObservationKind.STRUCTURED_TEST_RESULT ||
        runEvidence.payload?.passedCount !== 5 ||
        runEvidence.payload?.failedCount !== 0 ||
        runEvidence.metadata?.cleanWorkspace !== true ||
        runEvidence.metadata?.stackId !== stackId ||
        runEvidence.metadata?.stackVersion !== stackVersion ||
        CERTIFICATION_CAPABILITIES.some(
          (capability) => runCapabilities?.[capability] !== true,
        ) ||
        typeof runEvidence.metadata?.workspaceId !== "string"
      ) {
        throw new StackCertificationError(
          "A referenced clean run did not complete all five real stack capabilities.",
        );
      }
      workspaceIds.add(runEvidence.metadata.workspaceId);
    }
    if (workspaceIds.size !== 3) {
      throw new StackCertificationError(
        "Production certification requires three isolated workspaces.",
      );
    }
    return scope;
  }
  throw new StackCertificationError(
    "Deterministic certification fixtures are accepted only by an explicitly test-configured registry.",
  );
}

export function createToolchainStackRegistry({
  ledger,
  evidence,
  facts,
  store,
  clock,
  toolProbe = probeLocalTool,
  allowDeterministicCertificationFixtures = false,
}) {
  function assertMission(missionId) {
    ledger.projectState(missionId);
  }

  function appendOperation({
    missionId,
    registryEventId,
    eventId,
    causationId,
    occurredAt,
    operation,
    payload,
    statement,
    evidenceRecord,
    metadata,
  }) {
    assertRegistryIdentifier(registryEventId, "registryEventId");
    const existingRegistryEvent = store
      .listEvents()
      .find((entry) => entry.registryEventId === registryEventId);
    if (existingRegistryEvent !== undefined) {
      const expected = {
        missionId,
        occurredAt,
        operation,
        evidenceReference: evidenceReference(evidenceRecord),
        payload,
      };
      const actual = {
        missionId: existingRegistryEvent.missionId,
        occurredAt: existingRegistryEvent.occurredAt,
        operation: existingRegistryEvent.operation,
        evidenceReference: existingRegistryEvent.evidenceReference,
        payload: existingRegistryEvent.payload,
      };
      if (
        canonicalizeStackValue(actual) !==
        canonicalizeStackValue(expected)
      ) {
        throw new DuplicateRegistryEventError(registryEventId);
      }
      const existingFact = ledger
        .listEvents(missionId)
        .find(
          (entry) =>
            entry.fact?.metadata?.registryEventId === registryEventId,
        );
      if (
        existingFact !== undefined &&
        existingFact.eventId !== eventId
      ) {
        throw new DuplicateRegistryEventError(registryEventId);
      }
    }
    recordFactOrReuse({
      ledger,
      facts,
      missionId,
      eventId,
      causationId,
      occurredAt,
      statement,
      evidenceRecord,
      metadata,
    });
    if (existingRegistryEvent !== undefined) {
      return existingRegistryEvent;
    }
    return store.appendEvent({
      registryEventId,
      missionId,
      occurredAt,
      operation,
      evidenceReference: evidenceReference(evidenceRecord),
      payload,
    });
  }

  return Object.freeze({
    manifestTemplate: WEB_STACK_MANIFEST,

    registerStack({
      missionId,
      manifest = WEB_STACK_MANIFEST,
      registryEventId,
      eventId,
      causationId,
      evidenceId,
      workspaceCheckpointReference = null,
      occurredAt = clock(),
    }) {
      assertMission(missionId);
      const normalizedManifest = normalizeStackManifest(manifest);
      try {
        store.getStack(
          normalizedManifest.stackId,
          normalizedManifest.stackVersion,
          occurredAt,
        );
        const retry = store
          .listEvents()
          .find((entry) => entry.registryEventId === registryEventId);
        if (
          retry !== undefined &&
          retry.operation === RegistryOperation.STACK_REGISTERED &&
          canonicalizeStackValue(retry.payload) ===
            canonicalizeStackValue(normalizedManifest)
        ) {
          return store.getStack(
            normalizedManifest.stackId,
            normalizedManifest.stackVersion,
            occurredAt,
          );
        }
        throw new DuplicateStackVersionError(
          normalizedManifest.stackId,
          normalizedManifest.stackVersion,
        );
      } catch (error) {
        if (!(error instanceof UnknownStackError)) {
          throw error;
        }
      }
      const observation = captureOrReuseEvidence(evidence, {
        evidenceId,
        missionId,
        kind: ObservationKind.STRUCTURED_TEST_RESULT,
        captureMethod: "deterministic-stack-manifest-validation",
        producingSubsystem: TOOLCHAIN_STACK_REGISTRY_SOURCE,
        timestamp: occurredAt,
        payload: {
          suiteName: "stack-manifest-validation",
          passedCount: 1,
          failedCount: 0,
          skippedCount: 0,
        },
        workspaceCheckpointReference,
        obligationReference: null,
        verificationRequestReference: null,
        commandReference: null,
        workUnitReference: null,
        metadata: {
          manifestHash: normalizedManifest.manifestHash,
          stackId: normalizedManifest.stackId,
          stackVersion: normalizedManifest.stackVersion,
        },
      });
      appendOperation({
        missionId,
        registryEventId,
        eventId,
        causationId,
        occurredAt,
        operation: RegistryOperation.STACK_REGISTERED,
        payload: normalizedManifest,
        statement: `Registered provisional stack ${normalizedManifest.stackId}@${normalizedManifest.stackVersion}.`,
        evidenceRecord: observation,
        metadata: {
          registryOperation: RegistryOperation.STACK_REGISTERED,
          registryEventId,
          manifestHash: normalizedManifest.manifestHash,
          stackId: normalizedManifest.stackId,
          stackVersion: normalizedManifest.stackVersion,
        },
      });
      return store.getStack(
        normalizedManifest.stackId,
        normalizedManifest.stackVersion,
        occurredAt,
      );
    },

    changeCertification({
      missionId,
      stackId,
      stackVersion,
      newStatus,
      validUntil = null,
      reason,
      certificationEvidenceId,
      registryEventId,
      eventId,
      causationId,
      occurredAt = clock(),
    }) {
      assertMission(missionId);
      const stack = store.getStack(stackId, stackVersion, occurredAt);
      if (
        !Object.values(StackCertificationStatus).includes(newStatus) ||
        newStatus === StackCertificationStatus.UNREGISTERED
      ) {
        throw new StackCertificationError(
          "Certification target status is invalid.",
        );
      }
      if (stack.declaredCertificationStatus === newStatus) {
        throw new StackCertificationError(
          "Certification change must change the declared status.",
        );
      }
      if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new StackCertificationError(
          "Certification change reason must be non-empty.",
        );
      }
      if (newStatus === StackCertificationStatus.CERTIFIED) {
        if (
          typeof validUntil !== "string" ||
          Number.isNaN(Date.parse(validUntil)) ||
          Date.parse(validUntil) <= Date.parse(occurredAt)
        ) {
          throw new StackCertificationError(
            "Certification validUntil must be later than certification time.",
          );
        }
      } else if (validUntil !== null) {
        throw new StackCertificationError(
          "Only CERTIFIED status may have a validUntil timestamp.",
        );
      }
      let certificationEvidence;
      try {
        certificationEvidence = evidence.getById(certificationEvidenceId);
      } catch (error) {
        throw new StackCertificationError(
          "A valid certification-evidence record is required.",
          { cause: error },
        );
      }
      if (certificationEvidence.missionId !== missionId) {
        throw new EvidenceReferenceError(
          `Certification evidence "${certificationEvidenceId}" belongs to another mission.`,
          certificationEvidenceId,
        );
      }
      let certificationBasis = "STATUS_CHANGE_EVIDENCE";
      if (newStatus === StackCertificationStatus.CERTIFIED) {
        certificationBasis = validateCertificationEvidence({
          record: certificationEvidence,
          stackId,
          stackVersion,
          allowDeterministicCertificationFixtures,
          evidence,
          ledger,
        });
      }
      const payload = {
        stackId,
        stackVersion,
        previousStatus: stack.declaredCertificationStatus,
        newStatus,
        reason: reason.trim(),
        validUntil:
          newStatus === StackCertificationStatus.CERTIFIED
            ? validUntil
            : null,
        certificationBasis,
      };
      appendOperation({
        missionId,
        registryEventId,
        eventId,
        causationId,
        occurredAt,
        operation: RegistryOperation.CERTIFICATION_CHANGED,
        payload,
        statement: `Changed stack ${stackId}@${stackVersion} certification from ${payload.previousStatus} to ${newStatus}.`,
        evidenceRecord: certificationEvidence,
        metadata: {
          registryOperation: RegistryOperation.CERTIFICATION_CHANGED,
          registryEventId,
          stackId,
          stackVersion,
          previousStatus: payload.previousStatus,
          newStatus,
          validUntil: payload.validUntil,
          reason,
          certificationBasis,
        },
      });
      return store.getStack(stackId, stackVersion, occurredAt);
    },

    checkEnvironment({
      missionId,
      environmentCheckId,
      registryEventId,
      eventId,
      causationId,
      evidenceId,
      workspaceCheckpointReference = null,
      occurredAt = clock(),
    }) {
      assertMission(missionId);
      const environment = detectLocalEnvironment({
        missionId,
        environmentCheckId,
        capturedAt: occurredAt,
        toolProbe,
      });
      const toolResults = Object.values(environment.tools);
      const observation = captureOrReuseEvidence(evidence, {
        evidenceId,
        missionId,
        kind: ObservationKind.STRUCTURED_TEST_RESULT,
        captureMethod: "read-only-local-tool-version-detection",
        producingSubsystem: TOOLCHAIN_STACK_REGISTRY_SOURCE,
        timestamp: occurredAt,
        payload: {
          suiteName: "local-environment-capability-detection",
          passedCount: toolResults.filter((tool) => tool.available).length,
          failedCount: toolResults.filter((tool) => !tool.available).length,
          skippedCount: 0,
        },
        workspaceCheckpointReference,
        obligationReference: null,
        verificationRequestReference: null,
        commandReference: null,
        workUnitReference: null,
        metadata: {
          environmentCheckId,
          hostPlatform: environment.hostPlatform,
          tools: environment.tools,
        },
      });
      appendOperation({
        missionId,
        registryEventId,
        eventId,
        causationId,
        occurredAt,
        operation: RegistryOperation.ENVIRONMENT_CHECKED,
        payload: environment,
        statement: `Observed local Node.js, npm, Git, and browser capabilities for environment check ${environmentCheckId}.`,
        evidenceRecord: observation,
        metadata: {
          registryOperation: RegistryOperation.ENVIRONMENT_CHECKED,
          registryEventId,
          environmentCheckId,
          hostPlatform: environment.hostPlatform,
          tools: environment.tools,
        },
      });
      return store.getEnvironmentCheck(environmentCheckId, occurredAt);
    },

    selectStack({
      missionId,
      selectionId,
      stackId,
      stackVersion,
      environmentCheckId,
      requestedPlatform,
      requiredCapabilities,
      registryEventId,
      eventId,
      causationId,
      occurredAt = clock(),
    }) {
      assertMission(missionId);
      assertRegistryIdentifier(selectionId, "selectionId");
      const existingSelection = store.getSelection(selectionId, occurredAt);
      if (existingSelection !== null) {
        throw new StackSelectionValidationError(
          `Selection "${selectionId}" already exists.`,
        );
      }
      const stack = store.getStack(stackId, stackVersion, occurredAt);
      if (stack.certificationStale) {
        throw new StaleCertificationError(
          stackId,
          stackVersion,
          stack.certificationValidUntil,
        );
      }
      if (
        stack.certificationStatus !== StackCertificationStatus.CERTIFIED
      ) {
        throw new UncertifiedStackError(
          stackId,
          stackVersion,
          stack.certificationStatus,
        );
      }
      const environment = store.getEnvironmentCheck(
        environmentCheckId,
        occurredAt,
      );
      if (environment === null) {
        throw new EnvironmentCheckNotFoundError(environmentCheckId);
      }
      if (environment.missionId !== missionId) {
        throw new EvidenceReferenceError(
          `Environment selection evidence "${environment.evidenceReference.evidenceId}" belongs to another mission.`,
          environment.evidenceReference.evidenceId,
        );
      }
      const capabilities = normalizeCapabilities(requiredCapabilities);
      const eligibility = evaluateStackEligibility({
        stack,
        requestedPlatform,
        requiredCapabilities: capabilities,
        environment,
        asOf: occurredAt,
        selectionMode: StackSelectionMode.PRODUCTION,
      });
      const payload = {
        selectionId,
        selectionMode: StackSelectionMode.PRODUCTION,
        stackId,
        stackVersion,
        environmentCheckId,
        requestedPlatform: requestedPlatform.trim().toLowerCase(),
        requiredCapabilities: capabilities,
        rationale: eligibility.rationale,
      };
      const selectionEvidence = evidence.getById(
        environment.evidenceReference.evidenceId,
      );
      appendOperation({
        missionId,
        registryEventId,
        eventId,
        causationId,
        occurredAt,
        operation: RegistryOperation.STACK_SELECTED,
        payload,
        statement: `Selected stack ${stackId}@${stackVersion} for mission ${missionId}.`,
        evidenceRecord: selectionEvidence,
        metadata: {
          registryOperation: RegistryOperation.STACK_SELECTED,
          registryEventId,
          selectionId,
          selectionMode: StackSelectionMode.PRODUCTION,
          stackId,
          stackVersion,
          environmentCheckId,
          requestedPlatform: payload.requestedPlatform,
          requiredCapabilities: capabilities,
          rationale: eligibility.rationale,
        },
      });
      return store.getSelection(selectionId, occurredAt);
    },

    selectStackForCertification({
      missionId,
      selectionId,
      stackId,
      stackVersion,
      environmentCheckId,
      requestedPlatform,
      requiredCapabilities,
      registryEventId,
      eventId,
      causationId,
      occurredAt = clock(),
    }) {
      assertMission(missionId);
      assertRegistryIdentifier(selectionId, "selectionId");
      if (store.getSelection(selectionId, occurredAt) !== null) {
        throw new StackSelectionValidationError(
          `Selection "${selectionId}" already exists.`,
        );
      }
      const stack = store.getStack(stackId, stackVersion, occurredAt);
      if (
        stack.certificationStatus !== StackCertificationStatus.PROVISIONAL
      ) {
        throw new UncertifiedStackError(
          stackId,
          stackVersion,
          stack.certificationStatus,
        );
      }
      const environment = store.getEnvironmentCheck(
        environmentCheckId,
        occurredAt,
      );
      if (environment === null) {
        throw new EnvironmentCheckNotFoundError(environmentCheckId);
      }
      if (environment.missionId !== missionId) {
        throw new EvidenceReferenceError(
          `Environment selection evidence "${environment.evidenceReference.evidenceId}" belongs to another mission.`,
          environment.evidenceReference.evidenceId,
        );
      }
      const capabilities = normalizeCapabilities(requiredCapabilities);
      const eligibility = evaluateStackEligibility({
        stack,
        requestedPlatform,
        requiredCapabilities: capabilities,
        environment,
        asOf: occurredAt,
        selectionMode: StackSelectionMode.CERTIFICATION,
      });
      const payload = {
        selectionId,
        selectionMode: StackSelectionMode.CERTIFICATION,
        stackId,
        stackVersion,
        environmentCheckId,
        requestedPlatform: requestedPlatform.trim().toLowerCase(),
        requiredCapabilities: capabilities,
        rationale: eligibility.rationale,
      };
      const selectionEvidence = evidence.getById(
        environment.evidenceReference.evidenceId,
      );
      appendOperation({
        missionId,
        registryEventId,
        eventId,
        causationId,
        occurredAt,
        operation: RegistryOperation.STACK_SELECTED,
        payload,
        statement: `Selected provisional stack ${stackId}@${stackVersion} for isolated certification work in mission ${missionId}.`,
        evidenceRecord: selectionEvidence,
        metadata: {
          registryOperation: RegistryOperation.STACK_SELECTED,
          registryEventId,
          selectionId,
          selectionMode: StackSelectionMode.CERTIFICATION,
          stackId,
          stackVersion,
          environmentCheckId,
          requestedPlatform: payload.requestedPlatform,
          requiredCapabilities: capabilities,
          rationale: eligibility.rationale,
        },
      });
      return store.getSelection(selectionId, occurredAt);
    },

    getStack(stackId, stackVersion, asOf = clock()) {
      return store.getStack(stackId, stackVersion, asOf);
    },

    listStacks(asOf = clock()) {
      return store.listStacks(asOf);
    },

    getCertificationHistory(stackId, stackVersion, asOf = clock()) {
      return freezeStackValue(
        store.getStack(stackId, stackVersion, asOf).certificationHistory,
      );
    },

    getEnvironmentCheck(environmentCheckId, asOf = clock()) {
      const check = store.getEnvironmentCheck(environmentCheckId, asOf);
      if (check === null) {
        throw new EnvironmentCheckNotFoundError(environmentCheckId);
      }
      return check;
    },

    getSelection(selectionId, asOf = clock()) {
      const selection = store.getSelection(selectionId, asOf);
      if (selection === null) {
        throw new StackSelectionValidationError(
          `Selection "${selectionId}" does not exist.`,
        );
      }
      return selection;
    },

    getMissionSelection(missionId, asOf = clock()) {
      assertMission(missionId);
      const selections = store
        .listSelections(asOf)
        .filter((selection) => selection.missionId === missionId);
      if (selections.length === 0) {
        throw new StackSelectionValidationError(
          `Mission "${missionId}" does not have a stack selection.`,
        );
      }
      return selections.at(-1);
    },

    listRegistryEvents() {
      return store.listEvents();
    },
  });
}
