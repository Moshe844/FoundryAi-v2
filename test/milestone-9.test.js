import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CERTIFIED_STACK_ID,
  CERTIFIED_STACK_VERSION,
  CertificationEvidenceScope,
  FailureClassification,
  ExternalBlockerRejectedError,
  MissionState,
  ModelTaskClass,
  NonNovelRepairStrategyError,
  ObservationKind,
  RepairRoutingError,
  RepairExhaustionRejectedError,
  RepairStrategyFamily,
  RuntimeStatus,
  StackCertificationStatus,
  WorkUnitAction,
  WorkUnitStatus,
  createDeterministicLocalModelProvider,
  openMissionControl,
} from "../src/index.js";
import {
  commandEvidence,
  createMissionThroughExecuting,
  generateInventory,
  inventoryObligations,
  inventorySources,
  workFactory,
} from "./milestone-8.test.js";

const VERIFY_REQUEST = "milestone9-repair-verification";

function phase(missionId, name) {
  const path = process.env.FOUNDRY_M9_PHASE_LOG_PATH;
  if (path !== undefined) {
    appendFileSync(
      path,
      `${JSON.stringify({
        missionId,
        phase: name,
        timestamp: new Date().toISOString(),
      })}\n`,
    );
  }
}

function temporaryStores(t, prefix = "foundry-v2-repair-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    ledgerDirectory: join(root, "ledger"),
    evidenceDirectory: join(root, "evidence"),
    workspaceDirectory: join(root, "workspaces"),
    registryDirectory: join(root, "registry"),
  };
}

function usage(content, costUsd = 0.0001) {
  return {
    inputTokens: 40,
    outputTokens: Math.max(1, Math.ceil(content.length / 4)),
    costUsd,
  };
}

function createRepairProvider({
  defects = new Map(),
  providerId = "repair-gpt",
  providerFamily = "GPT",
  modelId = "repair-standard",
  maxRepairDepth = 5,
  inputCostPerMillionTokensUsd = 1,
  outputCostPerMillionTokensUsd = 2,
  observedPerformance = 0.9,
  failRepair = false,
} = {}) {
  const correct = inventorySources();
  return createDeterministicLocalModelProvider({
    providerId,
    providerFamily,
    modelId,
    maxRepairDepth,
    inputCostPerMillionTokensUsd,
    outputCostPerMillionTokensUsd,
    observedPerformance,
    handler(request) {
      const generationPrefix = "Generate project file ";
      if (request.purpose.startsWith(generationPrefix)) {
        const path = request.purpose.slice(generationPrefix.length);
        const selected = defects.get(request.missionId)?.[path] ?? correct[path];
        if (selected === undefined) throw new Error(`Unknown source ${path}.`);
        return { output: { path, content: selected }, usage: usage(selected) };
      }
      if (request.purpose.startsWith("Repair project file ")) {
        if (failRepair) throw new Error("deterministic provider outage");
        const path = request.purpose.slice("Repair project file ".length);
        const content = correct[path];
        if (content === undefined) throw new Error(`Unknown repair ${path}.`);
        return { output: { path, content }, usage: usage(content, 0.0002) };
      }
      throw new Error(`Unsupported purpose ${request.purpose}.`);
    },
  });
}

function falseReadinessEvidence(control, missionId, suffix = "failure") {
  const checkpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  return control.evidence.capture({
    evidenceId: `${missionId}-${suffix}-readiness`,
    missionId,
    kind: ObservationKind.RUNTIME_READINESS_RESULT,
    captureMethod: "deterministic-real-failure-fixture",
    producingSubsystem: "MILESTONE_9_TEST",
    payload: { ready: false, detail: "Runtime readiness failed." },
    sensitiveValues: [],
    workspaceCheckpointReference: checkpointId,
    obligationReference: "runtime-ready",
    verificationRequestReference: VERIFY_REQUEST,
    commandReference: null,
    workUnitReference: null,
    metadata: {},
  });
}

function moveToRepairing(control, missionId, evidenceId) {
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-initial-verifying`,
    causationId: `${missionId}-initial-verifying-command`,
    to: MissionState.VERIFYING,
    reason: "Verify the observed injected failure.",
  });
  const checkpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  const verdict = control.verification.verify({
    missionId,
    verdictId: `${missionId}-initial-incomplete`,
    eventId: `${missionId}-initial-incomplete-event`,
    causationId: `${missionId}-initial-verification`,
    workspaceCheckpointReference: checkpointId,
    verificationRequestReference: VERIFY_REQUEST,
    evidenceByObligation: { "runtime-ready": [evidenceId] },
  });
  assert.equal(verdict.overallResult, "INCOMPLETE");
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-repairing`,
    causationId: `${missionId}-repairing-command`,
    to: MissionState.REPAIRING,
    reason: "Diagnose the evidence-backed incomplete verdict.",
  });
  return verdict;
}

function semanticSignature(overrides = {}) {
  return {
    architecturalApproachKey: null,
    dependencySolutionKey: null,
    hypothesisKey: "readiness-process-does-not-start",
    implementationTechniqueKey: "correct-start-command",
    runtimeApproachKey: "manifest-production-runtime",
    verificationBehaviorKey: "http-readiness-probe",
    ...overrides,
  };
}

function proposal(missionId, evidenceId, overrides = {}) {
  const suffix = overrides.suffix ?? "one";
  const proposalOverrides = { ...overrides };
  delete proposalOverrides.suffix;
  return {
    admissionId: `${missionId}-admission-${suffix}`,
    repairAttemptId: `${missionId}-attempt-${suffix}`,
    missionId,
    targetObligationIds: ["runtime-ready"],
    evidenceIds: [evidenceId],
    rootCauseHypothesis:
      "The selected runtime process exits before HTTP readiness.",
    confidence: 0.9,
    strategyId: `${missionId}-strategy-${suffix}`,
    strategyFamily: RepairStrategyFamily.RUNTIME,
    approachDescription:
      "Correct the runtime entry point and observe the health route.",
    filesExpectedToChange: ["package.json"],
    commandsExpectedToRerun: ["productionBuild", "productionRun"],
    depthLevel: 2,
    estimatedInputTokens: 1_000,
    estimatedOutputTokens: 500,
    routingReason: "Ordinary startup failure needs focused engineering.",
    escalationEvidenceIds: [],
    semanticSignature: semanticSignature(),
    diagnosisEvidenceId: `${missionId}-diagnosis-${suffix}`,
    eventId: `${missionId}-admission-event-${suffix}`,
    causationId: `${missionId}-admission-command-${suffix}`,
    ...proposalOverrides,
  };
}

test("diagnosis requires evidence, routes by capability and cost, and rejects equivalent strategies", (t) => {
  const cheapGemini = createRepairProvider({
    providerId: "cheap-gemini",
    providerFamily: "Gemini",
    modelId: "gemini-mechanical",
    maxRepairDepth: 3,
    inputCostPerMillionTokensUsd: 0.1,
    outputCostPerMillionTokensUsd: 0.2,
  });
  const standardGpt = createRepairProvider({
    providerId: "standard-gpt",
    providerFamily: "GPT",
    modelId: "gpt-standard",
    inputCostPerMillionTokensUsd: 1,
    outputCostPerMillionTokensUsd: 2,
  });
  const stores = temporaryStores(t);
  const control = openMissionControl({
    ...stores,
    modelProviders: [standardGpt, cheapGemini],
  });
  const missionId = "repair-novelty-routing";
  createMissionThroughExecuting(control, missionId, {
    registerStack: true,
    fullContract: false,
  });
  const failure = falseReadinessEvidence(control, missionId);
  moveToRepairing(control, missionId, failure.evidenceId);

  assert.throws(
    () =>
      control.repair.classifyEvidence({
        missionId,
        evidenceIds: [],
      }),
  );
  assert.equal(
    control.repair.classifyEvidence({
      missionId,
      evidenceIds: [failure.evidenceId],
    }),
    FailureClassification.STARTUP_READINESS_FAILURE,
  );
  const admitted = control.repair.admitStrategy(
    proposal(missionId, failure.evidenceId),
  );
  assert.equal(
    admitted.modelRoutingDecision.providerId,
    "cheap-gemini",
  );

  const gptOnlyRestart = openMissionControl({
    ...stores,
    modelProviders: [standardGpt],
  });
  assert.throws(
    () =>
      gptOnlyRestart.repair.admitStrategy(
        proposal(missionId, failure.evidenceId, {
          suffix: "different-provider",
          approachDescription:
            "Use a differently worded description with the GPT provider.",
          routingReason: "Try another provider for the identical edit.",
        }),
      ),
    NonNovelRepairStrategyError,
  );

  const different = control.repair.admitStrategy(
    proposal(missionId, failure.evidenceId, {
      suffix: "different",
      strategyFamily: RepairStrategyFamily.CONFIGURATION,
      approachDescription:
        "Replace the runtime script configuration instead of correcting application code.",
      semanticSignature: semanticSignature({
        hypothesisKey: "package-script-points-to-invalid-entry",
        implementationTechniqueKey: "replace-package-runtime-script",
      }),
    }),
  );
  assert.notEqual(different.strategyId, admitted.strategyId);
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-repair-executing`,
    causationId: `${missionId}-repair-executing-command`,
    to: MissionState.EXECUTING,
    reason: "Execute the latest admitted novel strategy.",
  });
});

test("repair model routing records bounded failover and requires evidence for depth escalation", async (t) => {
  const failing = createRepairProvider({
    providerId: "cheap-failing-gpt",
    providerFamily: "GPT",
    modelId: "gpt-cheap",
    inputCostPerMillionTokensUsd: 0,
    outputCostPerMillionTokensUsd: 0,
    failRepair: true,
  });
  const succeeding = createRepairProvider({
    providerId: "claude-failover",
    providerFamily: "Claude",
    modelId: "claude-standard",
    inputCostPerMillionTokensUsd: 1,
    outputCostPerMillionTokensUsd: 1,
  });
  const control = openMissionControl({
    ...temporaryStores(t),
    modelProviders: [failing, succeeding],
    maxModelProviderAttempts: 2,
  });
  const missionId = "repair-provider-failover";
  createMissionThroughExecuting(control, missionId, {
    registerStack: true,
    fullContract: false,
  });
  const failure = falseReadinessEvidence(control, missionId);
  moveToRepairing(control, missionId, failure.evidenceId);
  control.repair.admitStrategy(
    proposal(missionId, failure.evidenceId),
  );
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-executing-repair`,
    causationId: `${missionId}-executing-repair-command`,
    to: MissionState.EXECUTING,
    reason: "Execute the evidence-grounded novel repair.",
  });
  const result = await control.models.request({
    requestId: `${missionId}-model`,
    missionId,
    workUnitId: `${missionId}-attempt-one`,
    purpose: "Repair project file src/app/page.tsx",
    taskClass: ModelTaskClass.REPAIR_IMPLEMENTATION,
    depthLevel: 2,
    routingReason: "A focused source repair is standard engineering.",
    contextReferences: [
      { kind: "evidence", id: failure.evidenceId },
    ],
    expectedStructuredOutputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    sensitiveValues: [],
    idempotencyKey: `${missionId}-model-key`,
  });
  assert.equal(result.costMetadata.attemptCount, 2);
  const call = control.models.listCalls(missionId).at(-1);
  assert.equal(call.provider, "claude-failover");
  assert.equal(call.modelId, "claude-standard");
  assert.equal(call.providerFamily, "Claude");
  assert.equal(call.depthLevel, 2);

  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-verifying-again`,
    causationId: `${missionId}-verifying-again-command`,
    to: MissionState.VERIFYING,
    reason: "Create another incomplete verdict for escalation validation.",
  });
  const checkpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  control.verification.verify({
    missionId,
    verdictId: `${missionId}-second-incomplete`,
    eventId: `${missionId}-second-incomplete-event`,
    causationId: `${missionId}-second-verification`,
    workspaceCheckpointReference: checkpointId,
    verificationRequestReference: VERIFY_REQUEST,
    evidenceByObligation: { "runtime-ready": [failure.evidenceId] },
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-repairing-again`,
    causationId: `${missionId}-repairing-again-command`,
    to: MissionState.REPAIRING,
    reason: "Evaluate a depth escalation.",
  });
  assert.throws(
    () =>
      control.repair.admitStrategy(
        proposal(missionId, failure.evidenceId, {
          suffix: "depth-three",
          depthLevel: 3,
          routingReason: "Cross-module runtime diagnosis is required.",
          semanticSignature: semanticSignature({
            hypothesisKey: "cross-module-runtime-initialization",
            architecturalApproachKey: "lazy-runtime-initialization",
          }),
        }),
      ),
    RepairRoutingError,
  );
});

async function completeLightweightFailedAttempt({
  control,
  missionId,
  failure,
  suffix = "one",
}) {
  const admitted = control.repair.admitStrategy(
    proposal(missionId, failure.evidenceId, { suffix }),
  );
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-${suffix}-executing`,
    causationId: `${missionId}-${suffix}-executing-command`,
    to: MissionState.EXECUTING,
    reason: "Execute the admitted repair through the Execution Engine.",
  });
  const workspace = control.workspaces.getWorkspace(missionId);
  const work = workFactory(control, missionId, workspace.workspaceId);
  const changed = await work(
    WorkUnitAction.WRITE_FILE,
    {
      path: `preserved-${suffix}.txt`,
      content: `verified repair scope ${suffix}\n`,
    },
    "runtime-ready",
    `repair-${suffix}`,
  );
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-${suffix}-verifying`,
    causationId: `${missionId}-${suffix}-verifying-command`,
    to: MissionState.VERIFYING,
    reason: "Independently verify the repair result.",
  });
  const verdict = control.verification.verify({
    missionId,
    verdictId: `${missionId}-${suffix}-incomplete`,
    eventId: `${missionId}-${suffix}-incomplete-event`,
    causationId: `${missionId}-${suffix}-verification`,
    workspaceCheckpointReference: changed.postWorkCheckpointId,
    verificationRequestReference: VERIFY_REQUEST,
    evidenceByObligation: {},
  });
  assert.equal(verdict.overallResult, "INCOMPLETE");
  const attempt = control.repair.completeAttempt({
    missionId,
    repairAttemptId: admitted.repairAttemptId,
    actualResult: {
      status: "FAILED",
      workUnitIds: [changed.workUnitId],
      costUsd: 0.25,
      inputTokens: 100,
      outputTokens: 50,
      elapsedMs: 10,
      detail: "The scoped change completed but readiness remains unverifiable.",
    },
    attemptEvidenceId: `${missionId}-${suffix}-attempt-evidence`,
    eventId: `${missionId}-${suffix}-attempt-event`,
    causationId: `${missionId}-${suffix}-attempt-command`,
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-${suffix}-repairing`,
    causationId: `${missionId}-${suffix}-repairing-command`,
    to: MissionState.REPAIRING,
    reason: "Consider a materially different strategy.",
  });
  return { attempt, changed, workspace };
}

test("budget, exhaustion, blocker, and preservation findings are evidence-backed", async (t) => {
  const provider = createRepairProvider();
  const stores = temporaryStores(t);
  const control = openMissionControl({
    ...stores,
    modelProviders: [provider],
    repairBudget: {
      maxAttemptsPerFailureFamily: 1,
      maxCostUsd: 1,
      maxElapsedMs: 60_000,
      maxTotalAttempts: 1,
    },
  });
  const missionId = "repair-budget-preservation";
  createMissionThroughExecuting(control, missionId, {
    registerStack: true,
    fullContract: false,
  });
  const failure = falseReadinessEvidence(control, missionId);
  moveToRepairing(control, missionId, failure.evidenceId);
  const completed = await completeLightweightFailedAttempt({
    control,
    missionId,
    failure,
  });
  assert.equal(
    control.workspaces.readFile({
      missionId,
      workspaceId: completed.workspace.workspaceId,
      relativePath: "preserved-one.txt",
    }),
    "verified repair scope one\n",
  );
  const budgetFinding = control.repair.recordBudgetExhaustion({
    missionId,
    findingId: `${missionId}-budget-finding`,
    evidenceIds: [failure.evidenceId],
    smallestAdditionalBudget: {
      attempts: 1,
      costUsd: 0.25,
      elapsedMs: 1_000,
    },
    detail:
      "One additional materially different attempt requires authorization.",
    findingEvidenceId: `${missionId}-budget-finding-evidence`,
    eventId: `${missionId}-budget-finding-event`,
    causationId: `${missionId}-budget-finding-command`,
  });
  assert.equal(budgetFinding.findingType, "BUDGET_EXHAUSTED");
  assert.equal(
    budgetFinding.consumed.stalledAttempts,
    1,
    "an attempt with no newly verified obligation is detected as stalled",
  );
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-exhausted`,
    causationId: `${missionId}-exhausted-command`,
    to: MissionState.EXHAUSTED,
    reason: "The approved repair budget is exhausted.",
  });
  assert.equal(
    control.orchestrator.state(missionId).state,
    MissionState.EXHAUSTED,
  );

  const blockerId = "repair-external-blocker";
  createMissionThroughExecuting(control, blockerId, {
    fullContract: false,
  });
  const ordinary = falseReadinessEvidence(control, blockerId);
  moveToRepairing(control, blockerId, ordinary.evidenceId);
  assert.throws(() =>
    control.orchestrator.transition({
      missionId: blockerId,
      eventId: `${blockerId}-premature-blocked`,
      causationId: `${blockerId}-premature-blocked-command`,
      to: MissionState.BLOCKED,
      reason: "An ordinary runtime failure cannot justify blocking.",
    }),
  );
  assert.throws(
    () =>
      control.repair.recordExternalBlocker({
        missionId: blockerId,
        findingId: `${blockerId}-rejected`,
        evidenceIds: [ordinary.evidenceId],
        externality: true,
        irreducibility: true,
        detail: "A runtime failure is not external.",
        findingEvidenceId: `${blockerId}-rejected-evidence`,
        eventId: `${blockerId}-rejected-event`,
        causationId: `${blockerId}-rejected-command`,
      }),
    ExternalBlockerRejectedError,
  );
  const checkpointId =
    control.workspaces.getWorkspace(blockerId).currentCheckpointId;
  const externalEvidence = control.evidence.capture({
    evidenceId: `${blockerId}-proof`,
    missionId: blockerId,
    kind: ObservationKind.FILE_EXISTENCE,
    captureMethod: "external-resource-observation",
    producingSubsystem: "MILESTONE_9_TEST",
    payload: { path: "customer-owned-credential", exists: false },
    sensitiveValues: [],
    workspaceCheckpointReference: checkpointId,
    obligationReference: null,
    verificationRequestReference: VERIFY_REQUEST,
    commandReference: null,
    workUnitReference: null,
    metadata: {
      externalBlockerProof: {
        externality: true,
        irreducibility: true,
      },
    },
  });
  const blocker = control.repair.recordExternalBlocker({
    missionId: blockerId,
    findingId: `${blockerId}-accepted`,
    evidenceIds: [externalEvidence.evidenceId],
    externality: true,
    irreducibility: true,
    detail:
      "A customer-owned credential is absent and cannot be created by Foundry.",
    findingEvidenceId: `${blockerId}-accepted-evidence`,
    eventId: `${blockerId}-accepted-event`,
    causationId: `${blockerId}-accepted-command`,
  });
  assert.equal(blocker.findingType, "EXTERNAL_BLOCKER");
  control.orchestrator.transition({
    missionId: blockerId,
    eventId: `${blockerId}-blocked`,
    causationId: `${blockerId}-blocked-command`,
    to: MissionState.BLOCKED,
    reason: "Stored evidence proves an irreducible external dependency.",
  });
  assert.equal(
    control.orchestrator.state(blockerId).state,
    MissionState.BLOCKED,
  );
});

test("strategy exhaustion is rejected while a materially different configured approach remains", async (t) => {
  const catalogEntry = {
    strategyFamily: RepairStrategyFamily.RUNTIME,
    semanticSignature: semanticSignature(),
  };
  const control = openMissionControl({
    ...temporaryStores(t),
    modelProviders: [createRepairProvider()],
    repairStrategyCatalog: {
      [FailureClassification.STARTUP_READINESS_FAILURE]: [catalogEntry],
    },
  });
  const missionId = "repair-strategy-exhaustion";
  createMissionThroughExecuting(control, missionId, {
    registerStack: true,
    fullContract: false,
  });
  const failure = falseReadinessEvidence(control, missionId);
  moveToRepairing(control, missionId, failure.evidenceId);
  const findingInput = {
    missionId,
    findingId: `${missionId}-finding`,
    failureClassification:
      FailureClassification.STARTUP_READINESS_FAILURE,
    evidenceIds: [failure.evidenceId],
    detail:
      "Every configured materially different runtime approach was evaluated.",
    findingEvidenceId: `${missionId}-finding-evidence`,
    eventId: `${missionId}-finding-event`,
    causationId: `${missionId}-finding-command`,
  };
  assert.throws(
    () => control.repair.recordStrategyExhaustion(findingInput),
    RepairExhaustionRejectedError,
  );
  assert.throws(() =>
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-premature-failed`,
      causationId: `${missionId}-premature-failed-command`,
      to: MissionState.FAILED,
      reason: "A novel configured strategy remains available.",
    }),
  );
  await completeLightweightFailedAttempt({
    control,
    missionId,
    failure,
  });
  const finding = control.repair.recordStrategyExhaustion(findingInput);
  assert.equal(finding.findingType, "STRATEGIES_EXHAUSTED");
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-failed`,
    causationId: `${missionId}-failed-command`,
    to: MissionState.FAILED,
    reason: "Every configured materially different strategy was evaluated.",
  });
  assert.equal(control.orchestrator.state(missionId).state, MissionState.FAILED);
});

test("startup and port failures select safe different runtime strategies without orphaned processes", async (t) => {
  const control = openMissionControl({
    ...temporaryStores(t),
    modelProviders: [createRepairProvider()],
  });
  for (const [index, failureType] of ["startup", "port"].entries()) {
    const missionId = `repair-${failureType}-runtime`;
    const workspace = createMissionThroughExecuting(control, missionId, {
      registerStack: index === 0,
      fullContract: false,
    });
    let failureEvidence;
    if (failureType === "startup") {
      const failed = await control.runtime.start({
        sessionId: `${missionId}-failed`,
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId:
          control.workspaces.getWorkspace(missionId).currentCheckpointId,
        procedureName: "runtimeStartupFailureProbe",
        readinessPath: "/",
        requestedPort: null,
        timeoutMs: 5_000,
        idempotencyKey: `${missionId}-failed-key`,
        observationId: `${missionId}-failed-observation`,
        evidencePrefix: `${missionId}-failed-evidence`,
        causationId: `${missionId}-failed-command`,
        verificationRequestReference: VERIFY_REQUEST,
      });
      assert.equal(failed.status, RuntimeStatus.STARTUP_FAILED);
      failureEvidence = control.evidence.getById(
        `${missionId}-failed-evidence.readiness`,
      );
    } else {
      const occupied = createServer();
      await new Promise((resolve) =>
        occupied.listen(0, "127.0.0.1", resolve),
      );
      const port = occupied.address().port;
      await assert.rejects(
        control.runtime.start({
          sessionId: `${missionId}-failed`,
          missionId,
          workspaceId: workspace.workspaceId,
          checkpointId:
            control.workspaces.getWorkspace(missionId).currentCheckpointId,
          procedureName: "runtimeCrashProbe",
          readinessPath: "/",
          requestedPort: port,
          timeoutMs: 5_000,
          idempotencyKey: `${missionId}-failed-key`,
          observationId: `${missionId}-failed-observation`,
          evidencePrefix: `${missionId}-failed-evidence`,
          causationId: `${missionId}-failed-command`,
          verificationRequestReference: VERIFY_REQUEST,
        }),
      );
      await new Promise((resolve) => occupied.close(resolve));
      failureEvidence = control.evidence.getById(
        `${missionId}-failed-evidence.process`,
      );
    }
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-verifying`,
      causationId: `${missionId}-verifying-command`,
      to: MissionState.VERIFYING,
      reason: "Verify the real runtime failure.",
    });
    control.verification.verify({
      missionId,
      verdictId: `${missionId}-incomplete`,
      eventId: `${missionId}-incomplete-event`,
      causationId: `${missionId}-incomplete-verification`,
      workspaceCheckpointReference:
        control.workspaces.getWorkspace(missionId).currentCheckpointId,
      verificationRequestReference: VERIFY_REQUEST,
      evidenceByObligation:
        failureType === "startup"
          ? { "runtime-ready": [failureEvidence.evidenceId] }
          : {},
    });
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-repairing`,
      causationId: `${missionId}-repairing-command`,
      to: MissionState.REPAIRING,
      reason: "Admit a materially different runtime strategy.",
    });
    const expectedClassification =
      failureType === "startup"
        ? FailureClassification.STARTUP_READINESS_FAILURE
        : FailureClassification.PORT_PROCESS_CONFLICT;
    assert.equal(
      control.repair.classifyEvidence({
        missionId,
        evidenceIds: [failureEvidence.evidenceId],
      }),
      expectedClassification,
      JSON.stringify(failureEvidence),
    );
    const admitted = control.repair.admitStrategy({
      ...proposal(missionId, failureEvidence.evidenceId),
      failureClassification: expectedClassification,
      strategyId: `${missionId}-allocate-and-probe`,
      admissionId: `${missionId}-admission`,
      repairAttemptId: `${missionId}-attempt`,
      diagnosisEvidenceId: `${missionId}-diagnosis`,
      eventId: `${missionId}-admission-event`,
      causationId: `${missionId}-admission-command`,
      semanticSignature: semanticSignature({
        hypothesisKey:
          failureType === "startup"
            ? "declared-runtime-command-exits-before-readiness"
            : "requested-port-is-owned-by-another-process",
        implementationTechniqueKey: "record-runtime-strategy-marker",
        runtimeApproachKey: "allocate-new-port-and-http-probe",
      }),
    });
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-repair-executing`,
      causationId: `${missionId}-repair-executing-command`,
      to: MissionState.EXECUTING,
      reason: "Execute the alternate runtime strategy.",
    });
    const work = workFactory(control, missionId, workspace.workspaceId);
    const marker = await work(
      WorkUnitAction.WRITE_FILE,
      {
        path: "runtime-strategy.txt",
        content: "allocate a fresh port and observe HTTP readiness\n",
      },
      "runtime-ready",
      "runtime-strategy",
    );
    const repaired = await control.runtime.start({
      sessionId: `${missionId}-repaired`,
      missionId,
      workspaceId: workspace.workspaceId,
      checkpointId: marker.postWorkCheckpointId,
      procedureName: "runtimeCrashProbe",
      readinessPath: "/",
      requestedPort: null,
      timeoutMs: 5_000,
      idempotencyKey: `${missionId}-repaired-key`,
      observationId: `${missionId}-repaired-observation`,
      evidencePrefix: `${missionId}-repaired-evidence`,
      causationId: `${missionId}-repaired-command`,
      verificationRequestReference: VERIFY_REQUEST,
    });
    assert.equal(repaired.status, RuntimeStatus.READY);
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-final-verifying`,
      causationId: `${missionId}-final-verifying-command`,
      to: MissionState.VERIFYING,
      reason: "Reverify readiness using the fresh-port strategy.",
    });
    const verdict = control.verification.verify({
      missionId,
      verdictId: `${missionId}-complete`,
      eventId: `${missionId}-complete-event`,
      causationId: `${missionId}-complete-verification`,
      workspaceCheckpointReference: marker.postWorkCheckpointId,
      verificationRequestReference: VERIFY_REQUEST,
      evidenceByObligation: {
        "runtime-ready": [
          `${missionId}-repaired-evidence.readiness`,
        ],
      },
    });
    assert.equal(verdict.overallResult, "COMPLETE");
    control.repair.completeAttempt({
      missionId,
      repairAttemptId: admitted.repairAttemptId,
      actualResult: {
        status: "SUCCEEDED",
        workUnitIds: [marker.workUnitId],
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        elapsedMs: 1,
        detail: "Fresh port allocation reached actual HTTP readiness.",
      },
      attemptEvidenceId: `${missionId}-attempt-evidence`,
      eventId: `${missionId}-attempt-event`,
      causationId: `${missionId}-attempt-command`,
    });
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-succeeded`,
      causationId: `${missionId}-succeeded-command`,
      to: MissionState.SUCCEEDED,
      reason: "The runtime repair passed the completion gate.",
    });
    await control.runtime.stop({
      missionId,
      sessionId: repaired.sessionId,
      observationId: `${missionId}-stop`,
      evidenceId: `${missionId}-stop-evidence`,
      causationId: `${missionId}-stop-command`,
      idempotencyKey: `${missionId}-stop-key`,
    });
    await assert.rejects(
      fetch(repaired.previewUrl, { signal: AbortSignal.timeout(2_000) }),
    );
  }
});

function defectSources() {
  const correct = inventorySources();
  const page = correct["src/app/page.tsx"];
  return {
    compile: {
      "src/app/page.tsx": `import MissingInventoryModule from "@/missing-inventory-module";
${page}
const injectedCompileFailure: number = MissingInventoryModule;\n`,
    },
    browser: {
      "src/app/page.tsx": page.replace(
        'method: "POST",',
        'method: "PUT",',
      ),
    },
    persistence: {
      "src/app/page.tsx": page
        .replace(
          "setProducts(await response.json() as Product[]);",
          `const loaded = await response.json() as Product[];
    setProducts(sessionStorage.getItem("drop-after-stock-save") === "1" ? [] : loaded);`,
        )
        .replace(
          "await load();\n  }\n\n  return (",
          `await load();
    sessionStorage.setItem("drop-after-stock-save", "1");
  }

  return (`,
        ),
    },
  };
}

async function runCommand(work, procedureName, obligationId, name) {
  return work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName,
      environment: {},
      timeoutMs: 600_000,
      outputLimitBytes: 1_048_576,
    },
    obligationId,
    name,
  );
}

function commandMap(control, commands) {
  return Object.fromEntries(
    commands
      .filter(([, workUnit]) => workUnit !== null)
      .map(([obligationId, workUnit]) => [
        obligationId,
        [commandEvidence(control, workUnit).evidenceId],
      ]),
  );
}

function commandFailureDetail(control, workUnit) {
  const record = commandEvidence(control, workUnit);
  return JSON.stringify({
    missionId: workUnit.missionId,
    workUnitId: workUnit.workUnitId,
    payload: record?.payload ?? null,
  });
}

function assertWorkStatus(control, workUnit, expectedStatus) {
  if (workUnit.status !== expectedStatus) {
    assert.equal(
      workUnit.status,
      expectedStatus,
      commandFailureDetail(control, workUnit),
    );
  }
}

async function stopRuntime(control, missionId, runtime, suffix) {
  if (runtime === null) return;
  try {
    control.runtime.getPreviewUrl(missionId, runtime.sessionId);
  } catch {
    return;
  }
  await control.runtime.stop({
    missionId,
    sessionId: runtime.sessionId,
    observationId: `${missionId}-${suffix}-runtime-stop`,
    evidenceId: `${missionId}-${suffix}-runtime-stop-evidence`,
    causationId: `${missionId}-${suffix}-runtime-stop-command`,
    idempotencyKey: `${missionId}-${suffix}-runtime-stop-key`,
  });
}

async function browserRun(control, work, missionId, workspace, suffix) {
  const checkpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  phase(missionId, `${suffix}-runtime-start-requested`);
  const runtime = await control.runtime.start({
    sessionId: `${missionId}-${suffix}-runtime`,
    missionId,
    workspaceId: workspace.workspaceId,
    checkpointId,
    procedureName: "productionRun",
    readinessPath: "/api/health",
    requestedPort: null,
    timeoutMs: 120_000,
    idempotencyKey: `${missionId}-${suffix}-runtime-key`,
    observationId: `${missionId}-${suffix}-runtime-start`,
    evidencePrefix: `${missionId}-${suffix}-runtime-start-evidence`,
    causationId: `${missionId}-${suffix}-runtime-start-command`,
    verificationRequestReference: VERIFY_REQUEST,
  });
  phase(missionId, `${suffix}-runtime-start-complete`);
  assert.equal(runtime.status, RuntimeStatus.READY);
  phase(missionId, `${suffix}-browser-command-requested`);
  const browser = await work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "browserVerification",
      environment: { FOUNDRY_PREVIEW_URL: runtime.previewUrl },
      timeoutMs: 300_000,
      outputLimitBytes: 1_048_576,
    },
    "page-loads",
    `${suffix}-browser`,
  );
  phase(missionId, `${suffix}-browser-command-committed`);
  return { runtime, browser };
}

function repairProposalFor(missionId, evidenceId, defect) {
  const classification = {
    compile: FailureClassification.COMPILE_TYPE_ERROR,
    browser: FailureClassification.BROWSER_UI_BEHAVIOR_FAILURE,
    persistence: FailureClassification.PERSISTENCE_FAILURE,
  }[defect];
  const family = {
    compile: RepairStrategyFamily.CODE_CORRECTION,
    browser: RepairStrategyFamily.BROWSER_BEHAVIOR,
    persistence: RepairStrategyFamily.PERSISTENCE,
  }[defect];
  return {
    admissionId: `${missionId}-repair-admission`,
    repairAttemptId: `${missionId}-repair-attempt`,
    missionId,
    targetObligationIds:
      defect === "compile"
        ? ["type-checks"]
        : defect === "browser"
          ? ["product-created"]
          : ["refresh-persists"],
    evidenceIds: [evidenceId],
    failureClassification: classification,
    rootCauseHypothesis: {
      compile: "The generated page contains an invalid TypeScript assignment.",
      browser: "The generated product form calls an unsupported HTTP method.",
      persistence: "The generated page discards persisted data after the stock workflow.",
    }[defect],
    confidence: 0.98,
    strategyId: `${missionId}-correct-page-source`,
    strategyFamily: family,
    approachDescription:
      "Replace the affected generated page with a corrected provider-produced implementation.",
    filesExpectedToChange: ["src/app/page.tsx"],
    commandsExpectedToRerun: [
      "typeCheck",
      "lint",
      "productionBuild",
      "productionRun",
      "browserVerification",
    ],
    depthLevel: defect === "persistence" ? 3 : 2,
    estimatedInputTokens: 2_000,
    estimatedOutputTokens: 1_500,
    routingReason:
      defect === "persistence"
        ? "Refresh-state loss needs cross-layer state reasoning."
        : "A focused generated-source correction is standard engineering.",
    escalationEvidenceIds: [],
    semanticSignature: {
      hypothesisKey: `${defect}-generated-page-defect`,
      architecturalApproachKey: null,
      implementationTechniqueKey: `${defect}-replace-page-implementation`,
      dependencySolutionKey: null,
      runtimeApproachKey: null,
      verificationBehaviorKey: `${defect}-rerun-full-browser-contract`,
    },
    diagnosisEvidenceId: `${missionId}-repair-diagnosis`,
    eventId: `${missionId}-repair-admission-event`,
    causationId: `${missionId}-repair-admission-command`,
  };
}

async function runRepairMission(control, missionId, defect, registerStack) {
  phase(missionId, "mission-start");
  const workspace = createMissionThroughExecuting(control, missionId, {
    registerStack,
  });
  const work = workFactory(control, missionId, workspace.workspaceId);
  await generateInventory(control, missionId, workspace.workspaceId, work);
  phase(missionId, "generation-complete");
  const lock = await runCommand(
    work,
    "dependencyLock",
    "dependencies-install",
    "initial-lock",
  );
  const install = await runCommand(
    work,
    "install",
    "dependencies-install",
    "initial-install",
  );
  assert.equal(lock.status, WorkUnitStatus.SUCCEEDED);
  assert.equal(install.status, WorkUnitStatus.SUCCEEDED);
  phase(missionId, "installation-complete");

  let typeCheck = await runCommand(
    work,
    "typeCheck",
    "type-checks",
    "initial-type",
  );
  let lint = null;
  let build = null;
  let failedBrowser = null;
  let failedRuntime = null;
  if (defect === "compile") {
    assert.equal(typeCheck.status, WorkUnitStatus.FAILED);
    phase(missionId, "initial-compile-failure-observed");
  } else {
    assert.equal(typeCheck.status, WorkUnitStatus.SUCCEEDED);
    lint = await runCommand(work, "lint", "lint-passes", "initial-lint");
    build = await runCommand(
      work,
      "productionBuild",
      "production-build",
      "initial-build",
    );
    assertWorkStatus(control, lint, WorkUnitStatus.SUCCEEDED);
    assertWorkStatus(control, build, WorkUnitStatus.SUCCEEDED);
    const initialBrowser = await browserRun(
      control,
      work,
      missionId,
      workspace,
      "initial",
    );
    failedRuntime = initialBrowser.runtime;
    failedBrowser = initialBrowser.browser;
    assertWorkStatus(control, failedBrowser, WorkUnitStatus.FAILED);
    phase(missionId, "initial-browser-failure-observed");
    await stopRuntime(control, missionId, failedRuntime, "initial");
    phase(missionId, "initial-runtime-stopped");
  }

  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-failure-verifying`,
    causationId: `${missionId}-failure-verifying-command`,
    to: MissionState.VERIFYING,
    reason: "Verify the deliberately injected real production failure.",
  });
  const failureEvidence =
    defect === "compile"
      ? commandEvidence(control, typeCheck)
      : commandEvidence(control, failedBrowser);
  const initialEvidence = commandMap(control, [
    ["dependencies-install", install],
    ["type-checks", typeCheck],
    ["lint-passes", lint],
    ["production-build", build],
  ]);
  const initialVerdict = control.verification.verify({
    missionId,
    verdictId: `${missionId}-incomplete-verdict`,
    eventId: `${missionId}-incomplete-verdict-event`,
    causationId: `${missionId}-incomplete-verification`,
    workspaceCheckpointReference:
      control.workspaces.getWorkspace(missionId).currentCheckpointId,
    verificationRequestReference: VERIFY_REQUEST,
    evidenceByObligation: initialEvidence,
  });
  assert.equal(initialVerdict.overallResult, "INCOMPLETE");
  phase(missionId, "incomplete-verdict-recorded");
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-repairing`,
    causationId: `${missionId}-repairing-command`,
    to: MissionState.REPAIRING,
    reason: "Diagnose and repair the injected failure.",
  });

  const admitted = control.repair.admitStrategy(
    repairProposalFor(missionId, failureEvidence.evidenceId, defect),
  );
  phase(missionId, "repair-strategy-admitted");
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-repair-executing`,
    causationId: `${missionId}-repair-executing-command`,
    to: MissionState.EXECUTING,
    reason: "Execute the admitted materially different repair.",
  });
  const model = await control.models.request({
    requestId: `${missionId}-repair-model`,
    missionId,
    workUnitId: admitted.repairAttemptId,
    purpose: "Repair project file src/app/page.tsx",
    taskClass: ModelTaskClass.REPAIR_IMPLEMENTATION,
    depthLevel: admitted.depthLevel,
    routingReason: admitted.modelRoutingDecision.reason,
    contextReferences: [
      { kind: "evidence", id: failureEvidence.evidenceId },
      { kind: "checkpoint", id: admitted.preRepairCheckpoint },
    ],
    expectedStructuredOutputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    sensitiveValues: [],
    idempotencyKey: `${missionId}-repair-model-key`,
  });
  phase(missionId, "repair-model-call-complete");
  const repairWork = await work(
    WorkUnitAction.REPLACE_FILE,
    model.structuredOutput,
    admitted.targetObligationIds[0],
    "repair-page",
  );
  assert.equal(repairWork.status, WorkUnitStatus.SUCCEEDED);
  phase(missionId, "repair-work-unit-complete");

  typeCheck = await runCommand(
    work,
    "typeCheck",
    "type-checks",
    "repair-type",
  );
  lint = await runCommand(work, "lint", "lint-passes", "repair-lint");
  build = await runCommand(
    work,
    "productionBuild",
    "production-build",
    "repair-build",
  );
  assertWorkStatus(control, typeCheck, WorkUnitStatus.SUCCEEDED);
  assertWorkStatus(control, lint, WorkUnitStatus.SUCCEEDED);
  assertWorkStatus(control, build, WorkUnitStatus.SUCCEEDED);
  phase(missionId, "repair-rebuild-complete");

  const repairedBrowser = await browserRun(
    control,
    work,
    missionId,
    workspace,
    "repaired",
  );
  if (repairedBrowser.browser.status !== WorkUnitStatus.SUCCEEDED) {
    await stopRuntime(
      control,
      missionId,
      repairedBrowser.runtime,
      "repaired-failure",
    );
  }
  assert.equal(repairedBrowser.browser.status, WorkUnitStatus.SUCCEEDED);
  phase(missionId, "repaired-browser-complete");
  const browserObservation = control.runtime.captureBrowserVerification({
    missionId,
    sessionId: repairedBrowser.runtime.sessionId,
    commandWorkUnitId: repairedBrowser.browser.workUnitId,
    observationId: `${missionId}-repaired-browser-observation`,
    evidencePrefix: `${missionId}-repaired-browser-evidence`,
    causationId: `${missionId}-repaired-browser-capture`,
    idempotencyKey: `${missionId}-repaired-browser-key`,
    verificationRequestReference: VERIFY_REQUEST,
  });
  const health = await control.runtime.observeHealth({
    missionId,
    sessionId: repairedBrowser.runtime.sessionId,
    observationId: `${missionId}-repaired-health`,
    evidenceId: `${missionId}-repaired-health-evidence`,
    causationId: `${missionId}-repaired-health-command`,
    idempotencyKey: `${missionId}-repaired-health-key`,
    verificationRequestReference: VERIFY_REQUEST,
  });
  assert.equal(health.status, RuntimeStatus.HEALTHY);

  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-final-verifying`,
    causationId: `${missionId}-final-verifying-command`,
    to: MissionState.VERIFYING,
    reason: "Independently reverify the complete affected contract.",
  });
  const interaction = browserObservation.evidence.find(
    (record) => record.kind === ObservationKind.BROWSER_INTERACTION_RESULT,
  );
  const errors = browserObservation.evidence.find(
    (record) => record.kind === ObservationKind.BROWSER_ERROR_RESULT,
  );
  const readiness = control.evidence
    .findByWorkUnit(repairedBrowser.runtime.sessionId)
    .findLast(
      (record) =>
        record.kind === ObservationKind.RUNTIME_READINESS_RESULT &&
        record.workspaceCheckpointReference === health.checkpointId,
    );
  const verdict = control.verification.verify({
    missionId,
    verdictId: `${missionId}-complete-verdict`,
    eventId: `${missionId}-complete-verdict-event`,
    causationId: `${missionId}-complete-verification`,
    workspaceCheckpointReference: health.checkpointId,
    verificationRequestReference: VERIFY_REQUEST,
    evidenceByObligation: {
      "page-loads": [interaction.evidenceId],
      "product-created": [interaction.evidenceId],
      "starting-stock": [interaction.evidenceId],
      "stock-edited": [interaction.evidenceId],
      "refresh-persists": [interaction.evidenceId],
      "dependencies-install": [commandEvidence(control, install).evidenceId],
      "type-checks": [commandEvidence(control, typeCheck).evidenceId],
      "lint-passes": [commandEvidence(control, lint).evidenceId],
      "production-build": [commandEvidence(control, build).evidenceId],
      "runtime-ready": [readiness.evidenceId],
      "no-browser-errors": [errors.evidenceId],
    },
  });
  assert.equal(verdict.overallResult, "COMPLETE");
  phase(missionId, "complete-verdict-recorded");
  const attempt = control.repair.completeAttempt({
    missionId,
    repairAttemptId: admitted.repairAttemptId,
    actualResult: {
      status: "SUCCEEDED",
      workUnitIds: [repairWork.workUnitId],
      costUsd: model.costMetadata.costUsd,
      inputTokens: model.tokenMetadata.inputTokens,
      outputTokens: model.tokenMetadata.outputTokens,
      elapsedMs: 1,
      detail: "Provider-produced repair applied and full verification passed.",
    },
    attemptEvidenceId: `${missionId}-repair-attempt-evidence`,
    eventId: `${missionId}-repair-attempt-event`,
    causationId: `${missionId}-repair-attempt-command`,
  });
  assert.equal(attempt.verificationResult.overallResult, "COMPLETE");
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-succeeded`,
    causationId: `${missionId}-succeeded-command`,
    to: MissionState.SUCCEEDED,
    reason: "The repaired mission passed the existing completion gate.",
  });
  await stopRuntime(
    control,
    missionId,
    repairedBrowser.runtime,
    "repaired",
  );
  phase(missionId, "repaired-runtime-stopped");
  assert.equal(
    control.orchestrator.state(missionId).state,
    MissionState.SUCCEEDED,
  );
  const runEvidence = control.evidence.capture({
    evidenceId: `${missionId}-clean-repair-run-evidence`,
    missionId,
    kind: ObservationKind.STRUCTURED_TEST_RESULT,
    captureMethod: "real-clean-end-to-end-repair-run",
    producingSubsystem: "MILESTONE_9_REPAIR_CERTIFICATION",
    payload: {
      suiteName: "diagnose-repair-build-run-test-observe",
      passedCount: 5,
      failedCount: 0,
      skippedCount: 0,
    },
    workspaceCheckpointReference: health.checkpointId,
    obligationReference: null,
    verificationRequestReference: null,
    commandReference: null,
    workUnitReference: admitted.repairAttemptId,
    metadata: {
      cleanWorkspace: true,
      workspaceId: workspace.workspaceId,
      stackId: CERTIFIED_STACK_ID,
      stackVersion: CERTIFIED_STACK_VERSION,
      certificationScope: CertificationEvidenceScope.END_TO_END_MISSION,
      certificationCapabilities: {
        built: true,
        generated: true,
        observed: true,
        ran: true,
        tested: true,
      },
    },
  });
  phase(missionId, "mission-complete");
  return { missionId, attempt, admitted, workspace, runEvidence };
}

test(
  "three clean real missions repair compile, browser, and persistence defects through Foundry",
  { timeout: 2_400_000 },
  async (t) => {
    const diagnosticDefect =
      process.env.FOUNDRY_M9_DIAGNOSTIC_DEFECT ?? null;
    assert(
      diagnosticDefect === null ||
        ["compile", "browser", "persistence"].includes(diagnosticDefect),
      "FOUNDRY_M9_DIAGNOSTIC_DEFECT must name a supported fixture.",
    );
    const requestedDefects =
      diagnosticDefect === null
        ? ["compile", "browser", "persistence"]
        : [diagnosticDefect];
    const defectsByMission = new Map();
    const variants = defectSources();
    for (const defect of requestedDefects) {
      defectsByMission.set(`repair-${defect}`, variants[defect]);
    }
    const provider = createRepairProvider({ defects: defectsByMission });
    const stores = temporaryStores(t, "foundry-v2-repair-certification-");
    const control = openMissionControl({
      ...stores,
      modelProviders: [provider],
      repairBudget: {
        maxAttemptsPerFailureFamily: 3,
        maxCostUsd: 1,
        maxElapsedMs: 2_000_000,
        maxTotalAttempts: 6,
      },
    });
    const runs = [];
    for (const [index, defect] of requestedDefects.entries()) {
      runs.push(
        await runRepairMission(
          control,
          `repair-${defect}`,
          defect,
          index === 0,
        ),
      );
    }
    assert.equal(
      new Set(runs.map((run) => run.workspace.workspaceId)).size,
      requestedDefects.length,
    );
    assert(
      runs.every(
        (run) =>
          run.attempt.verificationResult.overallResult === "COMPLETE" &&
          control.orchestrator.state(run.missionId).state ===
            MissionState.SUCCEEDED,
      ),
    );
    if (diagnosticDefect !== null) {
      return;
    }
    const finalRun = runs.at(-1);
    const aggregate = control.evidence.capture({
      evidenceId: "repair-three-run-certification",
      missionId: finalRun.missionId,
      kind: ObservationKind.STRUCTURED_TEST_RESULT,
      captureMethod: "three-clean-production-repair-mission-aggregation",
      producingSubsystem: "MILESTONE_9_REPAIR_CERTIFICATION",
      payload: {
        suiteName: "three-clean-stack-repair-certification",
        passedCount: 5,
        failedCount: 0,
        skippedCount: 0,
      },
      workspaceCheckpointReference:
        control.workspaces.getWorkspace(finalRun.missionId)
          .currentCheckpointId,
      obligationReference: null,
      verificationRequestReference: null,
      commandReference: null,
      workUnitReference: null,
      metadata: {
        stackId: CERTIFIED_STACK_ID,
        stackVersion: CERTIFIED_STACK_VERSION,
        certificationScope: CertificationEvidenceScope.END_TO_END_MISSION,
        cleanRunMissionIds: runs.map((run) => run.missionId),
        cleanRunEvidenceIds: runs.map((run) => run.runEvidence.evidenceId),
        certificationCapabilities: {
          built: true,
          generated: true,
          observed: true,
          ran: true,
          tested: true,
        },
      },
    });
    const certified = control.toolchains.changeCertification({
      missionId: finalRun.missionId,
      stackId: CERTIFIED_STACK_ID,
      stackVersion: CERTIFIED_STACK_VERSION,
      newStatus: StackCertificationStatus.CERTIFIED,
      validUntil: new Date(
        Date.now() + 30 * 24 * 60 * 60 * 1_000,
      ).toISOString(),
      reason:
        "Three isolated repair missions completed the real production gate.",
      certificationEvidenceId: aggregate.evidenceId,
      registryEventId: "repair-real-certification-registry",
      eventId: "repair-real-certification-ledger",
      causationId: "repair-real-certification-command",
    });
    assert.equal(
      certified.certificationStatus,
      StackCertificationStatus.CERTIFIED,
    );
    const restarted = openMissionControl({
      ...stores,
      modelProviders: [provider],
    });
    assert(
      runs.every(
        (run) =>
          restarted.repair.listHistory(run.missionId).attempts.length === 1 &&
          restarted.orchestrator.state(run.missionId).state ===
            MissionState.SUCCEEDED,
      ),
    );
    assert.equal(
      restarted.toolchains.getStack(
        CERTIFIED_STACK_ID,
        CERTIFIED_STACK_VERSION,
      ).certificationStatus,
      StackCertificationStatus.CERTIFIED,
    );
  },
);
