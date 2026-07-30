import {
  ExternalBlockerRejectedError,
  NonNovelRepairStrategyError,
  RepairBudgetExceededError,
  RepairEvidenceRequiredError,
  RepairExhaustionRejectedError,
  RepairRoutingError,
  RepairStateError,
  RepairValidationError,
} from "../domain/errors.js";
import { MissionState } from "../domain/lifecycle.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import {
  ModelTaskClass,
  projectExecutionHistory,
} from "../domain/execution.js";
import {
  DIAGNOSIS_REPAIR_SOURCE,
  FailureClassification,
  REPAIR_DEPTHS,
  REPAIR_PROVIDER_FAMILIES,
  RepairFindingType,
  classifyFailureEvidence,
  normalizeRepairAdmission,
  normalizeRepairAttempt,
  normalizeRepairFinding,
  projectRepairHistory,
  strategyNoveltyFingerprint,
} from "../domain/repair.js";

const DEFAULT_BUDGET = Object.freeze({
  maxAttemptsPerFailureFamily: 3,
  maxCostUsd: 5,
  maxElapsedMs: 60 * 60 * 1_000,
  maxTotalAttempts: 10,
});

function plain(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertIdentifier(value, label) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u.test(value)
  ) {
    throw new RepairValidationError(`${label} is malformed.`);
  }
}

function normalizeBudget(value = DEFAULT_BUDGET) {
  if (!plain(value)) {
    throw new RepairValidationError("repairBudget must be an object.");
  }
  const normalized = { ...DEFAULT_BUDGET, ...value };
  for (const key of [
    "maxAttemptsPerFailureFamily",
    "maxElapsedMs",
    "maxTotalAttempts",
  ]) {
    if (!Number.isSafeInteger(normalized[key]) || normalized[key] < 1) {
      throw new RepairValidationError(`${key} must be a positive integer.`);
    }
  }
  if (
    typeof normalized.maxCostUsd !== "number" ||
    !Number.isFinite(normalized.maxCostUsd) ||
    normalized.maxCostUsd < 0
  ) {
    throw new RepairValidationError(
      "maxCostUsd must be a non-negative finite number.",
    );
  }
  return Object.freeze(normalized);
}

function normalizeProvider(provider) {
  if (
    !plain(provider) ||
    !REPAIR_PROVIDER_FAMILIES.includes(provider.providerFamily) ||
    !REPAIR_DEPTHS.includes(provider.maxRepairDepth) ||
    typeof provider.available !== "boolean"
  ) {
    throw new RepairRoutingError(
      "Repair providers require a supported family, availability, and maximum depth.",
    );
  }
  for (const key of ["providerId", "modelId"]) {
    assertIdentifier(provider[key], `repair provider ${key}`);
  }
  for (const key of [
    "inputCostPerMillionTokensUsd",
    "outputCostPerMillionTokensUsd",
    "observedPerformance",
  ]) {
    if (
      typeof provider[key] !== "number" ||
      !Number.isFinite(provider[key]) ||
      provider[key] < 0
    ) {
      throw new RepairRoutingError(`Repair provider ${key} is invalid.`);
    }
  }
  return {
    providerId: provider.providerId,
    providerFamily: provider.providerFamily,
    modelId: provider.modelId,
    maxRepairDepth: provider.maxRepairDepth,
    available: provider.available,
    inputCostPerMillionTokensUsd: provider.inputCostPerMillionTokensUsd,
    outputCostPerMillionTokensUsd: provider.outputCostPerMillionTokensUsd,
    observedPerformance: provider.observedPerformance,
  };
}

function estimatedCost(provider, inputTokens, outputTokens) {
  return (
    (inputTokens / 1_000_000) * provider.inputCostPerMillionTokensUsd +
    (outputTokens / 1_000_000) * provider.outputCostPerMillionTokensUsd
  );
}

function selectRoute(catalog, {
  depthLevel,
  estimatedInputTokens,
  estimatedOutputTokens,
  routingReason,
}) {
  if (
    !REPAIR_DEPTHS.includes(depthLevel) ||
    !Number.isSafeInteger(estimatedInputTokens) ||
    estimatedInputTokens < 0 ||
    !Number.isSafeInteger(estimatedOutputTokens) ||
    estimatedOutputTokens < 0 ||
    typeof routingReason !== "string" ||
    routingReason.trim() === ""
  ) {
    throw new RepairRoutingError(
      "Repair routing requires depth, token estimates, and a technical reason.",
    );
  }
  const candidates = catalog
    .filter(
      (provider) =>
        provider.available && provider.maxRepairDepth >= depthLevel,
    )
    .map((provider) => ({
      ...provider,
      estimatedCostUsd: estimatedCost(
        provider,
        estimatedInputTokens,
        estimatedOutputTokens,
      ),
    }))
    .sort(
      (left, right) =>
        left.estimatedCostUsd - right.estimatedCostUsd ||
        right.observedPerformance - left.observedPerformance ||
        left.providerId.localeCompare(right.providerId),
    );
  const selected = candidates[0];
  if (selected === undefined) {
    throw new RepairRoutingError(
      `No configured provider is available for repair depth ${depthLevel}.`,
    );
  }
  return Object.freeze({
    depthLevel,
    estimatedCostUsd: selected.estimatedCostUsd,
    modelId: selected.modelId,
    providerFamily: selected.providerFamily,
    providerId: selected.providerId,
    reason: routingReason.trim(),
  });
}

function latestVerdict(events) {
  return events.findLast(
    (event) => event.completionVerdict !== undefined,
  )?.completionVerdict ?? null;
}

function consumption(history, now) {
  const attempts = history.attempts;
  const first = attempts[0]?.timestamp ?? now;
  let priorProgress = "";
  let stalledAttempts = 0;
  for (const attempt of attempts) {
    const progress = [...attempt.verificationResult.verifiedObligationIds]
      .sort()
      .join("\u0000");
    stalledAttempts = progress === priorProgress ? stalledAttempts + 1 : 0;
    priorProgress = progress;
  }
  return {
    attempts: attempts.length,
    costUsd: attempts.reduce(
      (total, attempt) => total + attempt.actualResult.costUsd,
      0,
    ),
    elapsedMs: Math.max(0, Date.parse(now) - Date.parse(first)),
    inputTokens: attempts.reduce(
      (total, attempt) => total + attempt.actualResult.inputTokens,
      0,
    ),
    outputTokens: attempts.reduce(
      (total, attempt) => total + attempt.actualResult.outputTokens,
      0,
    ),
    stalledAttempts,
  };
}

function checkBudget(history, budget, classification, route, now) {
  const used = consumption(history, now);
  if (used.attempts >= budget.maxTotalAttempts) {
    throw new RepairBudgetExceededError("maximum total attempts");
  }
  if (
    history.attempts.filter(
      (attempt) => attempt.failureClassification === classification,
    ).length >= budget.maxAttemptsPerFailureFamily
  ) {
    throw new RepairBudgetExceededError(
      "maximum attempts for the failure family",
    );
  }
  if (used.elapsedMs >= budget.maxElapsedMs) {
    throw new RepairBudgetExceededError("maximum elapsed repair time");
  }
  if (used.costUsd + route.estimatedCostUsd > budget.maxCostUsd) {
    throw new RepairBudgetExceededError("maximum repair cost");
  }
}

function findingEvidence({
  evidence,
  finding,
  checkpointId,
  evidenceId,
}) {
  return evidence.capture({
    evidenceId,
    missionId: finding.missionId,
    kind: ObservationKind.REPAIR_FINDING,
    captureMethod: "deterministic-repair-finding",
    producingSubsystem: DIAGNOSIS_REPAIR_SOURCE,
    timestamp: finding.timestamp,
    payload: { recordType: "repair-finding", record: finding },
    sensitiveValues: [],
    workspaceCheckpointReference: checkpointId,
    obligationReference: null,
    verificationRequestReference: null,
    commandReference: finding.findingId,
    workUnitReference: finding.findingId,
    metadata: {},
  });
}

export function createDiagnosisRepairStrategist({
  ledger,
  evidence,
  facts,
  workspaces,
  execution,
  providerCatalog = [],
  repairBudget,
  strategyCatalog = {},
  clock,
}) {
  const budget = normalizeBudget(repairBudget);
  const providers = providerCatalog.map(normalizeProvider);

  function history(missionId) {
    return projectRepairHistory(ledger.listEvents(missionId), missionId);
  }

  function requireState(missionId, expected, action) {
    const state = ledger.projectState(missionId).state;
    if (state !== expected) {
      throw new RepairStateError(missionId, state, action);
    }
  }

  function loadFailureEvidence(missionId, evidenceIds) {
    if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) {
      throw new RepairEvidenceRequiredError();
    }
    return evidenceIds.map((evidenceId) => {
      assertIdentifier(evidenceId, "failure evidenceId");
      const record = evidence.getById(evidenceId);
      if (record.missionId !== missionId) {
        throw new RepairValidationError(
          `Evidence "${evidenceId}" belongs to another mission.`,
        );
      }
      return record;
    });
  }

  function admitStrategy(input) {
    if (!plain(input)) {
      throw new RepairValidationError("Repair proposal must be an object.");
    }
    requireState(input.missionId, MissionState.REPAIRING, "admit a strategy");
    const events = ledger.listEvents(input.missionId);
    const verdict = latestVerdict(events);
    if (verdict?.overallResult !== "INCOMPLETE") {
      throw new RepairValidationError(
        "Repair strategy admission requires the current INCOMPLETE verdict.",
      );
    }
    const records = loadFailureEvidence(input.missionId, input.evidenceIds);
    const classification = classifyFailureEvidence(records);
    if (
      input.failureClassification !== undefined &&
      input.failureClassification !== classification
    ) {
      throw new RepairValidationError(
        "Proposed failure classification contradicts stored evidence.",
      );
    }
    const prior = history(input.missionId);
    const timestamp = input.timestamp ?? clock();
    if (
      input.depthLevel > 1 &&
      prior.admissions.length > 0 &&
      input.depthLevel >
        Math.max(...prior.admissions.map((entry) => entry.depthLevel)) &&
      (!Array.isArray(input.escalationEvidenceIds) ||
        input.escalationEvidenceIds.length === 0)
    ) {
      throw new RepairRoutingError(
        "Depth escalation requires recorded technical evidence.",
      );
    }
    if (input.depthLevel === 5) {
      const lowerDepths = new Set(prior.attempts.map((entry) => entry.depthLevel));
      if (![1, 2, 3, 4].every((depth) => lowerDepths.has(depth))) {
        throw new RepairRoutingError(
          "Depth 5 requires materially different failed attempts at every lower depth.",
        );
      }
    }
    if (
      Array.isArray(input.escalationEvidenceIds) &&
      input.escalationEvidenceIds.length > 0
    ) {
      loadFailureEvidence(input.missionId, input.escalationEvidenceIds);
    }
    const route = selectRoute(providers, {
      depthLevel: input.depthLevel,
      estimatedInputTokens: input.estimatedInputTokens,
      estimatedOutputTokens: input.estimatedOutputTokens,
      routingReason: input.routingReason,
    });
    checkBudget(prior, budget, classification, route, timestamp);
    const workspace = workspaces.getWorkspace(input.missionId);
    const admission = normalizeRepairAdmission({
      admissionId: input.admissionId,
      repairAttemptId: input.repairAttemptId,
      missionId: input.missionId,
      targetObligationIds: input.targetObligationIds,
      failureClassification: classification,
      evidenceIds: input.evidenceIds,
      rootCauseHypothesis: input.rootCauseHypothesis,
      confidence: input.confidence,
      strategyId: input.strategyId,
      strategyFamily: input.strategyFamily,
      approachDescription: input.approachDescription,
      filesExpectedToChange: input.filesExpectedToChange,
      commandsExpectedToRerun: input.commandsExpectedToRerun,
      preRepairCheckpoint: workspace.currentCheckpointId,
      modelRoutingDecision: route,
      depthLevel: input.depthLevel,
      costEstimate: route.estimatedCostUsd,
      semanticSignature: input.semanticSignature,
      timestamp,
    });
    const fingerprint = strategyNoveltyFingerprint(admission);
    if (
      prior.admissions.some(
        (entry) => strategyNoveltyFingerprint(entry) === fingerprint,
      )
    ) {
      throw new NonNovelRepairStrategyError(admission.strategyId);
    }
    const diagnosisEvidence = evidence.capture({
      evidenceId: input.diagnosisEvidenceId,
      missionId: input.missionId,
      kind: ObservationKind.REPAIR_DIAGNOSIS_RESULT,
      captureMethod: "stored-evidence-root-cause-diagnosis",
      producingSubsystem: DIAGNOSIS_REPAIR_SOURCE,
      timestamp,
      payload: { recordType: "repair-admission", record: admission },
      sensitiveValues: [],
      workspaceCheckpointReference: workspace.currentCheckpointId,
      obligationReference: null,
      verificationRequestReference: verdict.verdictId,
      commandReference: admission.strategyId,
      workUnitReference: admission.repairAttemptId,
      metadata: {
        failureEvidenceIds: [...admission.evidenceIds],
        noveltyFingerprint: fingerprint,
      },
    });
    facts.recordResultFact({
      missionId: input.missionId,
      eventId: input.eventId,
      causationId: input.causationId,
      occurredAt: timestamp,
      producingSubsystem: DIAGNOSIS_REPAIR_SOURCE,
      statement: `Admitted novel repair strategy "${admission.strategyId}" for ${classification}.`,
      evidenceReferences: [{
        evidenceId: diagnosisEvidence.evidenceId,
        workspaceCheckpointReference: workspace.currentCheckpointId,
      }],
      workspaceCheckpointReference: workspace.currentCheckpointId,
      workUnitReference: admission.repairAttemptId,
      metadata: { repairAdmission: admission },
    });
    return admission;
  }

  function completeAttempt(input) {
    requireState(
      input.missionId,
      MissionState.VERIFYING,
      "complete a repair attempt",
    );
    const repairHistory = history(input.missionId);
    const admission = repairHistory.admissions.find(
      (entry) => entry.repairAttemptId === input.repairAttemptId,
    );
    if (admission === undefined) {
      throw new RepairValidationError("Unknown repair attempt admission.");
    }
    if (
      repairHistory.attempts.some(
        (entry) => entry.repairAttemptId === input.repairAttemptId,
      )
    ) {
      throw new RepairValidationError("Repair attempt is already complete.");
    }
    const workUnits = execution.listWorkUnits(input.missionId);
    for (const workUnitId of input.actualResult.workUnitIds) {
      if (!workUnits.some((entry) => entry.workUnitId === workUnitId)) {
        throw new RepairValidationError(
          `Repair result references unknown work unit "${workUnitId}".`,
        );
      }
    }
    const workspace = workspaces.getWorkspace(input.missionId);
    const events = ledger.listEvents(input.missionId);
    const verdict = latestVerdict(events);
    if (
      verdict === null ||
      !["COMPLETE", "INCOMPLETE"].includes(verdict.overallResult)
    ) {
      throw new RepairValidationError(
        "A completed repair attempt requires an independent Completion Verdict.",
      );
    }
    const verifiedObligationIds = verdict.obligationVerdicts
      .filter((entry) => entry.result === "SATISFIED")
      .map((entry) => entry.obligationId);
    const actualModelCall = projectExecutionHistory(
      events,
      input.missionId,
    ).modelCalls.findLast(
      (entry) =>
        entry.workUnitId === admission.repairAttemptId &&
        [
          ModelTaskClass.REPAIR_DIAGNOSIS,
          ModelTaskClass.REPAIR_IMPLEMENTATION,
        ].includes(entry.taskClass),
    );
    const actualRoutingDecision =
      actualModelCall === undefined
        ? admission.modelRoutingDecision
        : {
            depthLevel: actualModelCall.depthLevel,
            estimatedCostUsd:
              admission.modelRoutingDecision.estimatedCostUsd,
            modelId: actualModelCall.modelId,
            providerFamily: actualModelCall.providerFamily,
            providerId: actualModelCall.provider,
            reason: actualModelCall.routingReason,
          };
    const attempt = normalizeRepairAttempt({
      ...admission,
      modelRoutingDecision: actualRoutingDecision,
      postRepairCheckpoint: workspace.currentCheckpointId,
      actualResult: input.actualResult,
      verificationResult: {
        overallResult: verdict.overallResult,
        verdictId: verdict.verdictId,
        verifiedObligationIds,
      },
    });
    const timestamp = input.timestamp ?? clock();
    const attemptEvidence = evidence.capture({
      evidenceId: input.attemptEvidenceId,
      missionId: input.missionId,
      kind: ObservationKind.REPAIR_ATTEMPT_RESULT,
      captureMethod: "execution-and-independent-verification-repair-result",
      producingSubsystem: DIAGNOSIS_REPAIR_SOURCE,
      timestamp,
      payload: { recordType: "repair-attempt", record: attempt },
      sensitiveValues: [],
      workspaceCheckpointReference: workspace.currentCheckpointId,
      obligationReference: null,
      verificationRequestReference: verdict.verdictId,
      commandReference: attempt.strategyId,
      workUnitReference: attempt.repairAttemptId,
      metadata: {},
    });
    facts.recordResultFact({
      missionId: input.missionId,
      eventId: input.eventId,
      causationId: input.causationId,
      occurredAt: timestamp,
      producingSubsystem: DIAGNOSIS_REPAIR_SOURCE,
      statement: `Repair attempt "${attempt.repairAttemptId}" independently verified as ${verdict.overallResult}.`,
      evidenceReferences: [{
        evidenceId: attemptEvidence.evidenceId,
        workspaceCheckpointReference: workspace.currentCheckpointId,
      }],
      workspaceCheckpointReference: workspace.currentCheckpointId,
      workUnitReference: attempt.repairAttemptId,
      metadata: { repairAttempt: attempt },
    });
    return attempt;
  }

  function recordBudgetExhaustion(input) {
    requireState(
      input.missionId,
      MissionState.REPAIRING,
      "record budget exhaustion",
    );
    const repairHistory = history(input.missionId);
    const now = input.timestamp ?? clock();
    const used = consumption(repairHistory, now);
    const perFamily = Math.max(
      0,
      ...Object.values(
        repairHistory.attempts.reduce((counts, attempt) => {
          counts[attempt.failureClassification] =
            (counts[attempt.failureClassification] ?? 0) + 1;
          return counts;
        }, {}),
      ),
    );
    const exceeded =
      used.attempts >= budget.maxTotalAttempts ||
      used.costUsd >= budget.maxCostUsd ||
      used.elapsedMs >= budget.maxElapsedMs ||
      perFamily >= budget.maxAttemptsPerFailureFamily;
    if (!exceeded) {
      throw new RepairExhaustionRejectedError(
        "Repair budget has not been exhausted.",
      );
    }
    const workspace = workspaces.getWorkspace(input.missionId);
    const finding = normalizeRepairFinding({
      findingId: input.findingId,
      findingType: RepairFindingType.BUDGET_EXHAUSTED,
      missionId: input.missionId,
      evidenceIds: input.evidenceIds,
      strategiesAttempted: repairHistory.attempts.map(
        (entry) => entry.strategyId,
      ),
      verifiedProgress: [
        ...new Set(
          repairHistory.attempts.flatMap(
            (entry) => entry.verificationResult.verifiedObligationIds,
          ),
        ),
      ],
      consumed: used,
      smallestAdditionalBudget: input.smallestAdditionalBudget,
      detail: input.detail,
      timestamp: now,
    });
    loadFailureEvidence(input.missionId, finding.evidenceIds);
    const findingRecord = findingEvidence({
      evidence,
      finding,
      checkpointId: workspace.currentCheckpointId,
      evidenceId: input.findingEvidenceId,
    });
    facts.recordResultFact({
      missionId: input.missionId,
      eventId: input.eventId,
      causationId: input.causationId,
      occurredAt: now,
      producingSubsystem: DIAGNOSIS_REPAIR_SOURCE,
      statement: "Repair budget exhausted; additional authorization is required.",
      evidenceReferences: [{
        evidenceId: findingRecord.evidenceId,
        workspaceCheckpointReference: workspace.currentCheckpointId,
      }],
      workspaceCheckpointReference: workspace.currentCheckpointId,
      workUnitReference: finding.findingId,
      metadata: { repairFinding: finding },
    });
    return finding;
  }

  function recordStrategyExhaustion(input) {
    requireState(
      input.missionId,
      MissionState.REPAIRING,
      "record strategy exhaustion",
    );
    const repairHistory = history(input.missionId);
    const expected = strategyCatalog[input.failureClassification] ?? [];
    if (expected.length === 0) {
      throw new RepairExhaustionRejectedError(
        "No configured strategy catalogue exists for this failure family.",
      );
    }
    const attempted = new Set(
      repairHistory.attempts
        .filter(
          (entry) =>
            entry.failureClassification === input.failureClassification,
        )
        .map(strategyNoveltyFingerprint),
    );
    const missing = expected
      .map((entry) =>
        strategyNoveltyFingerprint({
          failureClassification: input.failureClassification,
          strategyFamily: entry.strategyFamily,
          semanticSignature: entry.semanticSignature,
        }),
      )
      .filter((fingerprint) => !attempted.has(fingerprint));
    if (missing.length > 0) {
      throw new RepairExhaustionRejectedError(
        "A materially different configured strategy remains untried.",
      );
    }
    return recordFinding(input, RepairFindingType.STRATEGIES_EXHAUSTED);
  }

  function recordFinding(input, findingType) {
    const repairHistory = history(input.missionId);
    const now = input.timestamp ?? clock();
    const workspace = workspaces.getWorkspace(input.missionId);
    loadFailureEvidence(input.missionId, input.evidenceIds);
    const finding = normalizeRepairFinding({
      findingId: input.findingId,
      findingType,
      missionId: input.missionId,
      evidenceIds: input.evidenceIds,
      strategiesAttempted: repairHistory.attempts.map(
        (entry) => entry.strategyId,
      ),
      verifiedProgress: [
        ...new Set(
          repairHistory.attempts.flatMap(
            (entry) => entry.verificationResult.verifiedObligationIds,
          ),
        ),
      ],
      consumed: consumption(repairHistory, now),
      smallestAdditionalBudget: input.smallestAdditionalBudget ?? {
        attempts: 0,
        costUsd: 0,
        elapsedMs: 0,
      },
      detail: input.detail,
      timestamp: now,
    });
    const record = findingEvidence({
      evidence,
      finding,
      checkpointId: workspace.currentCheckpointId,
      evidenceId: input.findingEvidenceId,
    });
    facts.recordResultFact({
      missionId: input.missionId,
      eventId: input.eventId,
      causationId: input.causationId,
      occurredAt: now,
      producingSubsystem: DIAGNOSIS_REPAIR_SOURCE,
      statement: `Recorded repair finding ${findingType}.`,
      evidenceReferences: [{
        evidenceId: record.evidenceId,
        workspaceCheckpointReference: workspace.currentCheckpointId,
      }],
      workspaceCheckpointReference: workspace.currentCheckpointId,
      workUnitReference: finding.findingId,
      metadata: { repairFinding: finding },
    });
    return finding;
  }

  function recordExternalBlocker(input) {
    requireState(
      input.missionId,
      MissionState.REPAIRING,
      "record an external blocker",
    );
    if (
      input.externality !== true ||
      input.irreducibility !== true ||
      !Array.isArray(input.evidenceIds) ||
      input.evidenceIds.length === 0
    ) {
      throw new ExternalBlockerRejectedError(
        "Externality, irreducibility, and evidence are all required.",
      );
    }
    const records = loadFailureEvidence(input.missionId, input.evidenceIds);
    const ordinary = classifyFailureEvidence(records);
    if (
      ordinary !== FailureClassification.UNCLASSIFIED_FAILURE &&
      ordinary !== FailureClassification.UNSUPPORTED_CAPABILITY &&
      ordinary !== FailureClassification.CANDIDATE_EXTERNAL_BLOCKER
    ) {
      throw new ExternalBlockerRejectedError(
        `Ordinary ${ordinary} is not an external blocker.`,
      );
    }
    if (
      !records.some(
        (record) =>
          record.metadata?.externalBlockerProof?.externality === true &&
          record.metadata?.externalBlockerProof?.irreducibility === true,
      )
    ) {
      throw new ExternalBlockerRejectedError(
        "Stored evidence does not prove externality and irreducibility.",
      );
    }
    return recordFinding(input, RepairFindingType.EXTERNAL_BLOCKER);
  }

  return Object.freeze({
    admitStrategy,
    completeAttempt,
    recordBudgetExhaustion,
    recordStrategyExhaustion,
    recordExternalBlocker,
    classifyEvidence({ missionId, evidenceIds }) {
      return classifyFailureEvidence(
        loadFailureEvidence(missionId, evidenceIds),
      );
    },
    listHistory: history,
    getBudget() {
      return budget;
    },
  });
}
