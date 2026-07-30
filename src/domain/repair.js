import {
  RepairValidationError,
} from "./errors.js";
import {
  canonicalizeExecutionValue,
  freezeExecutionValue,
} from "./execution.js";

export const DIAGNOSIS_REPAIR_SOURCE = "DIAGNOSIS_REPAIR_STRATEGIST";

export const FailureClassification = Object.freeze({
  GENERATED_CODE_DEFECT: "generated-code defect",
  COMPILE_TYPE_ERROR: "compile/type error",
  LINT_FAILURE: "lint failure",
  DEPENDENCY_CONFIGURATION_ERROR: "dependency/configuration error",
  RUNTIME_EXCEPTION: "runtime exception",
  STARTUP_READINESS_FAILURE: "startup/readiness failure",
  BROWSER_UI_BEHAVIOR_FAILURE: "browser/UI behavior failure",
  PERSISTENCE_FAILURE: "persistence failure",
  TEST_FAILURE: "test failure",
  PORT_PROCESS_CONFLICT: "port/process conflict",
  TOOLCHAIN_ENVIRONMENT_FAILURE: "toolchain/environment failure",
  PROVIDER_MODEL_FAILURE: "provider/model failure",
  UNSUPPORTED_CAPABILITY: "unsupported capability",
  CANDIDATE_EXTERNAL_BLOCKER: "candidate external blocker",
  UNCLASSIFIED_FAILURE: "unclassified failure",
});

export const FAILURE_CLASSIFICATIONS = Object.freeze(
  Object.values(FailureClassification),
);

export const RepairStrategyFamily = Object.freeze({
  CODE_CORRECTION: "code-correction",
  IMPORT_RESOLUTION: "import-resolution",
  CONFIGURATION: "configuration",
  DEPENDENCY: "dependency",
  RUNTIME: "runtime",
  BROWSER_BEHAVIOR: "browser-behavior",
  PERSISTENCE: "persistence",
  ARCHITECTURE: "architecture",
  ENVIRONMENT: "environment",
});

export const RepairAttemptStatus = Object.freeze({
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

export const RepairVerificationResult = Object.freeze({
  COMPLETE: "COMPLETE",
  INCOMPLETE: "INCOMPLETE",
});

export const RepairFindingType = Object.freeze({
  BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED",
  STRATEGIES_EXHAUSTED: "STRATEGIES_EXHAUSTED",
  EXTERNAL_BLOCKER: "EXTERNAL_BLOCKER",
});

export const REPAIR_DEPTHS = Object.freeze([1, 2, 3, 4, 5]);
export const REPAIR_PROVIDER_FAMILIES = Object.freeze([
  "GPT",
  "Claude",
  "Gemini",
]);

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const classificationSet = new Set(FAILURE_CLASSIFICATIONS);
const familySet = new Set(Object.values(RepairStrategyFamily));
const attemptStatusSet = new Set(Object.values(RepairAttemptStatus));
const verificationSet = new Set(Object.values(RepairVerificationResult));
const findingSet = new Set(Object.values(RepairFindingType));
const providerFamilySet = new Set(REPAIR_PROVIDER_FAMILIES);

const ADMISSION_KEYS = Object.freeze([
  "admissionId",
  "approachDescription",
  "commandsExpectedToRerun",
  "confidence",
  "costEstimate",
  "depthLevel",
  "evidenceIds",
  "failureClassification",
  "filesExpectedToChange",
  "missionId",
  "modelRoutingDecision",
  "preRepairCheckpoint",
  "repairAttemptId",
  "rootCauseHypothesis",
  "semanticSignature",
  "strategyFamily",
  "strategyId",
  "targetObligationIds",
  "timestamp",
]);

const ATTEMPT_KEYS = Object.freeze([
  ...ADMISSION_KEYS,
  "actualResult",
  "postRepairCheckpoint",
  "verificationResult",
]);

function plain(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exact(value, keys, label) {
  if (!plain(value)) {
    throw new RepairValidationError(`${label} must be a plain object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new RepairValidationError(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new RepairValidationError(`${label} is malformed.`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RepairValidationError(`${label} must be non-empty.`);
  }
  return value.trim();
}

function identifiers(value, label, { allowEmpty = false } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    new Set(value).size !== value.length
  ) {
    throw new RepairValidationError(
      `${label} must be a unique identifier array.`,
    );
  }
  return value.map((entry) => identifier(entry, `${label} entry`)).sort();
}

function strings(value, label, { allowEmpty = true } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    throw new RepairValidationError(
      `${label} must be an array of non-empty strings.`,
    );
  }
  return [...new Set(value.map((entry) => entry.trim()))].sort();
}

function timestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RepairValidationError(`${label} must be a timestamp.`);
  }
  return value;
}

function finite(value, label, minimum = 0) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    throw new RepairValidationError(
      `${label} must be a finite number of at least ${minimum}.`,
    );
  }
  return value;
}

function normalizeSemanticSignature(value) {
  exact(
    value,
    [
      "architecturalApproachKey",
      "dependencySolutionKey",
      "hypothesisKey",
      "implementationTechniqueKey",
      "runtimeApproachKey",
      "verificationBehaviorKey",
    ],
    "semanticSignature",
  );
  const normalized = {};
  for (const [key, entry] of Object.entries(value)) {
    normalized[key] =
      entry === null ? null : identifier(entry, `semanticSignature.${key}`);
  }
  if (Object.values(normalized).every((entry) => entry === null)) {
    throw new RepairValidationError(
      "semanticSignature must identify at least one material strategy dimension.",
    );
  }
  return normalized;
}

function normalizeRouting(value) {
  exact(
    value,
    [
      "depthLevel",
      "estimatedCostUsd",
      "modelId",
      "providerFamily",
      "providerId",
      "reason",
    ],
    "modelRoutingDecision",
  );
  if (
    !REPAIR_DEPTHS.includes(value.depthLevel) ||
    !providerFamilySet.has(value.providerFamily)
  ) {
    throw new RepairValidationError(
      "modelRoutingDecision has an unsupported depth or provider family.",
    );
  }
  return {
    depthLevel: value.depthLevel,
    estimatedCostUsd: finite(
      value.estimatedCostUsd,
      "modelRoutingDecision.estimatedCostUsd",
    ),
    modelId: identifier(value.modelId, "modelRoutingDecision.modelId"),
    providerFamily: value.providerFamily,
    providerId: identifier(value.providerId, "modelRoutingDecision.providerId"),
    reason: text(value.reason, "modelRoutingDecision.reason"),
  };
}

export function strategyNoveltyFingerprint({
  failureClassification,
  strategyFamily,
  semanticSignature,
}) {
  if (!classificationSet.has(failureClassification)) {
    throw new RepairValidationError("failureClassification is invalid.");
  }
  if (!familySet.has(strategyFamily)) {
    throw new RepairValidationError("strategyFamily is invalid.");
  }
  return canonicalizeExecutionValue({
    failureClassification,
    strategyFamily,
    semanticSignature: normalizeSemanticSignature(semanticSignature),
  });
}

export function normalizeRepairAdmission(input) {
  exact(input, ADMISSION_KEYS, "repair admission");
  if (
    !classificationSet.has(input.failureClassification) ||
    !familySet.has(input.strategyFamily) ||
    !REPAIR_DEPTHS.includes(input.depthLevel)
  ) {
    throw new RepairValidationError(
      "repair admission classification, family, or depth is invalid.",
    );
  }
  if (
    typeof input.confidence !== "number" ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1
  ) {
    throw new RepairValidationError(
      "repair admission confidence must be between 0 and 1.",
    );
  }
  const semanticSignature = normalizeSemanticSignature(input.semanticSignature);
  const routing = normalizeRouting(input.modelRoutingDecision);
  if (routing.depthLevel !== input.depthLevel) {
    throw new RepairValidationError(
      "repair admission depth must match its routing decision.",
    );
  }
  return freezeExecutionValue({
    admissionId: identifier(input.admissionId, "admissionId"),
    repairAttemptId: identifier(input.repairAttemptId, "repairAttemptId"),
    missionId: identifier(input.missionId, "missionId"),
    targetObligationIds: identifiers(
      input.targetObligationIds,
      "targetObligationIds",
    ),
    failureClassification: input.failureClassification,
    evidenceIds: identifiers(input.evidenceIds, "evidenceIds"),
    rootCauseHypothesis: text(
      input.rootCauseHypothesis,
      "rootCauseHypothesis",
    ),
    confidence: input.confidence,
    strategyId: identifier(input.strategyId, "strategyId"),
    strategyFamily: input.strategyFamily,
    approachDescription: text(
      input.approachDescription,
      "approachDescription",
    ),
    filesExpectedToChange: strings(
      input.filesExpectedToChange,
      "filesExpectedToChange",
    ),
    commandsExpectedToRerun: strings(
      input.commandsExpectedToRerun,
      "commandsExpectedToRerun",
    ),
    preRepairCheckpoint: identifier(
      input.preRepairCheckpoint,
      "preRepairCheckpoint",
    ),
    modelRoutingDecision: routing,
    depthLevel: input.depthLevel,
    costEstimate: finite(input.costEstimate, "costEstimate"),
    semanticSignature,
    timestamp: timestamp(input.timestamp, "timestamp"),
  });
}

function normalizeActualResult(value) {
  exact(
    value,
    [
      "costUsd",
      "detail",
      "elapsedMs",
      "inputTokens",
      "outputTokens",
      "status",
      "workUnitIds",
    ],
    "actualResult",
  );
  if (!attemptStatusSet.has(value.status)) {
    throw new RepairValidationError("actualResult.status is invalid.");
  }
  for (const key of ["elapsedMs", "inputTokens", "outputTokens"]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0) {
      throw new RepairValidationError(
        `actualResult.${key} must be a non-negative integer.`,
      );
    }
  }
  return {
    status: value.status,
    workUnitIds: identifiers(value.workUnitIds, "actualResult.workUnitIds"),
    costUsd: finite(value.costUsd, "actualResult.costUsd"),
    inputTokens: value.inputTokens,
    outputTokens: value.outputTokens,
    elapsedMs: value.elapsedMs,
    detail: text(value.detail, "actualResult.detail"),
  };
}

function normalizeVerificationResult(value) {
  exact(
    value,
    ["overallResult", "verifiedObligationIds", "verdictId"],
    "verificationResult",
  );
  if (!verificationSet.has(value.overallResult)) {
    throw new RepairValidationError(
      "verificationResult.overallResult is invalid.",
    );
  }
  return {
    overallResult: value.overallResult,
    verdictId: identifier(value.verdictId, "verificationResult.verdictId"),
    verifiedObligationIds: identifiers(
      value.verifiedObligationIds,
      "verificationResult.verifiedObligationIds",
      { allowEmpty: true },
    ),
  };
}

export function normalizeRepairAttempt(input) {
  exact(input, ATTEMPT_KEYS, "repair attempt");
  const admission = normalizeRepairAdmission(
    Object.fromEntries(ADMISSION_KEYS.map((key) => [key, input[key]])),
  );
  const postRepairCheckpoint = identifier(
    input.postRepairCheckpoint,
    "postRepairCheckpoint",
  );
  if (postRepairCheckpoint === admission.preRepairCheckpoint) {
    throw new RepairValidationError(
      "A completed repair attempt requires a new post-repair checkpoint.",
    );
  }
  return freezeExecutionValue({
    ...admission,
    postRepairCheckpoint,
    actualResult: normalizeActualResult(input.actualResult),
    verificationResult: normalizeVerificationResult(input.verificationResult),
  });
}

export function normalizeRepairFinding(input) {
  exact(
    input,
    [
      "consumed",
      "detail",
      "evidenceIds",
      "findingId",
      "findingType",
      "missionId",
      "smallestAdditionalBudget",
      "strategiesAttempted",
      "timestamp",
      "verifiedProgress",
    ],
    "repair finding",
  );
  if (!findingSet.has(input.findingType)) {
    throw new RepairValidationError("repair finding type is invalid.");
  }
  exact(
    input.consumed,
    [
      "attempts",
      "costUsd",
      "elapsedMs",
      "inputTokens",
      "outputTokens",
      "stalledAttempts",
    ],
    "repair finding consumed",
  );
  exact(
    input.smallestAdditionalBudget,
    ["attempts", "costUsd", "elapsedMs"],
    "repair finding smallestAdditionalBudget",
  );
  return freezeExecutionValue({
    findingId: identifier(input.findingId, "findingId"),
    findingType: input.findingType,
    missionId: identifier(input.missionId, "missionId"),
    evidenceIds: identifiers(input.evidenceIds, "finding evidenceIds"),
    strategiesAttempted: identifiers(
      input.strategiesAttempted,
      "strategiesAttempted",
      { allowEmpty: true },
    ),
    verifiedProgress: identifiers(
      input.verifiedProgress,
      "verifiedProgress",
      { allowEmpty: true },
    ),
    consumed: {
      attempts: finite(input.consumed.attempts, "consumed.attempts"),
      costUsd: finite(input.consumed.costUsd, "consumed.costUsd"),
      elapsedMs: finite(input.consumed.elapsedMs, "consumed.elapsedMs"),
      inputTokens: finite(input.consumed.inputTokens, "consumed.inputTokens"),
      outputTokens: finite(input.consumed.outputTokens, "consumed.outputTokens"),
      stalledAttempts: finite(
        input.consumed.stalledAttempts,
        "consumed.stalledAttempts",
      ),
    },
    smallestAdditionalBudget: {
      attempts: finite(
        input.smallestAdditionalBudget.attempts,
        "smallestAdditionalBudget.attempts",
      ),
      costUsd: finite(
        input.smallestAdditionalBudget.costUsd,
        "smallestAdditionalBudget.costUsd",
      ),
      elapsedMs: finite(
        input.smallestAdditionalBudget.elapsedMs,
        "smallestAdditionalBudget.elapsedMs",
      ),
    },
    detail: text(input.detail, "finding detail"),
    timestamp: timestamp(input.timestamp, "finding timestamp"),
  });
}

export function classifyFailureEvidence(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new RepairValidationError(
      "Failure classification requires stored evidence.",
    );
  }
  const combined = records
    .map((record) =>
      canonicalizeExecutionValue({
        kind: record.kind,
        payload: record.payload,
        metadata: record.metadata,
      }),
    )
    .join("\n")
    .toLowerCase();
  const has = (...patterns) => patterns.some((pattern) => combined.includes(pattern));
  if (
    has(
      "eaddrinuse",
      "port conflict",
      "address already in use",
      "already in use",
    )
  ) {
    return FailureClassification.PORT_PROCESS_CONFLICT;
  }
  if (has("cannot find module", "module not found", "missing import")) {
    return FailureClassification.COMPILE_TYPE_ERROR;
  }
  if (has("typescript", "tsc", "type error", "compiled with errors")) {
    return FailureClassification.COMPILE_TYPE_ERROR;
  }
  if (has("eslint", "lint")) {
    return FailureClassification.LINT_FAILURE;
  }
  if (has("npm err", "dependency", "package-lock", "configuration")) {
    return FailureClassification.DEPENDENCY_CONFIGURATION_ERROR;
  }
  if (has("foundry_browser_phase:persistence", "persistence-refresh")) {
    return FailureClassification.PERSISTENCE_FAILURE;
  }
  if (
    has(
      "foundry_browser_phase:",
      "browser",
      "playwright",
      "interaction check",
      "browser-interaction-result",
    )
  ) {
    return FailureClassification.BROWSER_UI_BEHAVIOR_FAILURE;
  }
  if (has("persistence", "refresh", "sqlite", "database")) {
    return FailureClassification.PERSISTENCE_FAILURE;
  }
  if (has("startup_failed", "startup failed", "readiness", "\"ready\":false")) {
    return FailureClassification.STARTUP_READINESS_FAILURE;
  }
  if (has("provider", "model call", "model output")) {
    return FailureClassification.PROVIDER_MODEL_FAILURE;
  }
  if (has("runtime", "exception", "crashed")) {
    return FailureClassification.RUNTIME_EXCEPTION;
  }
  if (has("test", "failedcount")) {
    return FailureClassification.TEST_FAILURE;
  }
  return FailureClassification.UNCLASSIFIED_FAILURE;
}

export function projectRepairHistory(events, missionId) {
  const admissions = [];
  const attempts = [];
  const findings = [];
  const ids = new Set();
  for (const event of events) {
    const metadata = event.fact?.metadata;
    let record;
    let target;
    if (metadata?.repairAdmission !== undefined) {
      record = normalizeRepairAdmission(metadata.repairAdmission);
      target = admissions;
    } else if (metadata?.repairAttempt !== undefined) {
      record = normalizeRepairAttempt(metadata.repairAttempt);
      target = attempts;
    } else if (metadata?.repairFinding !== undefined) {
      record = normalizeRepairFinding(metadata.repairFinding);
      target = findings;
    } else {
      continue;
    }
    if (
      event.source !== DIAGNOSIS_REPAIR_SOURCE ||
      record.missionId !== missionId ||
      ids.has(event.eventId)
    ) {
      throw new RepairValidationError(
        "Repair history is not bound to its authoritative Ledger fact.",
      );
    }
    ids.add(event.eventId);
    target.push(record);
  }
  return freezeExecutionValue({ admissions, attempts, findings });
}
