import { createHash } from "node:crypto";

import {
  CompletionVerdictIntegrityError,
  UnsupportedAcceptanceConditionError,
  VerificationValidationError,
} from "./errors.js";
import { ObservationKind } from "./observation-evidence.js";

export const COMPLETION_VERDICT_EVENT = "COMPLETION_VERDICT_RECORDED";
export const VERIFICATION_AUTHORITY_SOURCE = "VERIFICATION_AUTHORITY";

export const ObligationVerdictResult = Object.freeze({
  SATISFIED: "SATISFIED",
  NOT_SATISFIED: "NOT_SATISFIED",
  UNVERIFIABLE: "UNVERIFIABLE",
});

export const CompletionResult = Object.freeze({
  COMPLETE: "COMPLETE",
  INCOMPLETE: "INCOMPLETE",
});

export const AcceptanceConditionType = Object.freeze({
  EVIDENCE_KIND_PRESENT: "evidence-kind-present",
  COMMAND_EXIT_CODE_EQUALS: "command-exit-code-equals",
  FILE_EXISTS: "file-exists",
  FILE_HASH_EQUALS: "file-hash-equals",
  FILE_CONTENT_EQUALS: "file-content-equals",
  BROWSER_CHECK_EQUALS: "browser-check-equals",
  BROWSER_ERROR_COUNTS: "browser-error-counts",
  STRUCTURED_TEST_COUNTS: "structured-test-counts",
  HTTP_STATUS_EQUALS: "http-status-equals",
  RUNTIME_READINESS_EQUALS: "runtime-readiness-equals",
  ALL_OF: "all-of",
  ANY_OF: "any-of",
});

const supportedTypes = new Set(Object.values(AcceptanceConditionType));
const verdictResults = new Set(Object.values(ObligationVerdictResult));
const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const VERDICT_KEYS = [
  "contractVersion",
  "deficiencies",
  "designShortfall",
  "integrityHash",
  "missionId",
  "obligationVerdicts",
  "overallResult",
  "unverifiableConditions",
  "verdictId",
  "verificationTimestamp",
  "workspaceCheckpointReference",
];
const DESIGN_SHORTFALL_KEYS = ["comparedViewports", "failedAspects", "reason"];
const OBLIGATION_VERDICT_KEYS = [
  "deficiency",
  "evidenceReferences",
  "obligationId",
  "result",
  "unverifiableCondition",
];
const EVIDENCE_REFERENCE_KEYS = [
  "evidenceId",
  "verificationRequestReference",
  "workspaceCheckpointReference",
];

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new VerificationValidationError(`${label} must be an object.`);
  }
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new VerificationValidationError(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function assertAllowedKeys(value, keys, label) {
  assertObject(value, label);
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new VerificationValidationError(
        `${label} contains unsupported field "${key}".`,
      );
    }
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new VerificationValidationError(`${label} is malformed.`);
  }
}

function normalizeCheckpoint(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  assertIdentifier(value, label);
  return value;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VerificationValidationError(`${label} must be non-empty.`);
  }
}

function commonCondition(condition, allowedKeys) {
  assertAllowedKeys(
    condition,
    ["type", "checkpointIndependent", ...allowedKeys],
    "acceptanceCondition",
  );
  if (!supportedTypes.has(condition.type)) {
    throw new UnsupportedAcceptanceConditionError(condition.type);
  }
  if (
    condition.checkpointIndependent !== undefined &&
    typeof condition.checkpointIndependent !== "boolean"
  ) {
    throw new VerificationValidationError(
      "acceptanceCondition.checkpointIndependent must be a boolean.",
    );
  }
  return condition.checkpointIndependent ?? false;
}

export function normalizeAcceptanceCondition(condition) {
  assertObject(condition, "acceptanceCondition");
  if (!supportedTypes.has(condition.type)) {
    throw new UnsupportedAcceptanceConditionError(condition.type);
  }

  switch (condition.type) {
    case AcceptanceConditionType.EVIDENCE_KIND_PRESENT: {
      const checkpointIndependent = commonCondition(condition, ["evidenceKind"]);
      assertNonEmptyString(condition.evidenceKind, "acceptanceCondition.evidenceKind");
      return {
        type: condition.type,
        evidenceKind: condition.evidenceKind,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS: {
      const checkpointIndependent = commonCondition(condition, [
        "expectedExitCode",
      ]);
      if (!Number.isSafeInteger(condition.expectedExitCode)) {
        throw new VerificationValidationError(
          "acceptanceCondition.expectedExitCode must be an integer.",
        );
      }
      return {
        type: condition.type,
        expectedExitCode: condition.expectedExitCode,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.FILE_EXISTS: {
      const checkpointIndependent = commonCondition(condition, [
        "path",
        "expectedExists",
      ]);
      assertNonEmptyString(condition.path, "acceptanceCondition.path");
      if (typeof condition.expectedExists !== "boolean") {
        throw new VerificationValidationError(
          "acceptanceCondition.expectedExists must be a boolean.",
        );
      }
      return {
        type: condition.type,
        path: condition.path,
        expectedExists: condition.expectedExists,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.FILE_HASH_EQUALS: {
      const checkpointIndependent = commonCondition(condition, [
        "path",
        "expectedHash",
      ]);
      assertNonEmptyString(condition.path, "acceptanceCondition.path");
      if (
        typeof condition.expectedHash !== "string" ||
        !HASH_PATTERN.test(condition.expectedHash)
      ) {
        throw new VerificationValidationError(
          "acceptanceCondition.expectedHash must be a SHA-256 hash.",
        );
      }
      return {
        type: condition.type,
        path: condition.path,
        expectedHash: condition.expectedHash,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.FILE_CONTENT_EQUALS: {
      const checkpointIndependent = commonCondition(condition, [
        "path",
        "expectedContent",
      ]);
      assertNonEmptyString(condition.path, "acceptanceCondition.path");
      if (typeof condition.expectedContent !== "string") {
        throw new VerificationValidationError(
          "acceptanceCondition.expectedContent must be a string.",
        );
      }
      return {
        type: condition.type,
        path: condition.path,
        expectedContent: condition.expectedContent,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.BROWSER_CHECK_EQUALS: {
      const checkpointIndependent = commonCondition(condition, [
        "check",
        "expected",
      ]);
      if (
        typeof condition.check !== "string" ||
        !IDENTIFIER_PATTERN.test(condition.check) ||
        typeof condition.expected !== "boolean"
      ) {
        throw new VerificationValidationError(
          "Browser-check acceptance requires a valid verification-plan check ID and boolean expected value.",
        );
      }
      return {
        type: condition.type,
        check: condition.check,
        expected: condition.expected,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.BROWSER_ERROR_COUNTS: {
      const checkpointIndependent = commonCondition(condition, [
        "maxConsoleErrors",
        "maxPageErrors",
      ]);
      if (
        !Number.isSafeInteger(condition.maxConsoleErrors) ||
        condition.maxConsoleErrors < 0 ||
        !Number.isSafeInteger(condition.maxPageErrors) ||
        condition.maxPageErrors < 0
      ) {
        throw new VerificationValidationError(
          "Browser-error acceptance limits must be non-negative integers.",
        );
      }
      return {
        type: condition.type,
        maxConsoleErrors: condition.maxConsoleErrors,
        maxPageErrors: condition.maxPageErrors,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.STRUCTURED_TEST_COUNTS: {
      const checkpointIndependent = commonCondition(condition, [
        "suiteName",
        "minimumPassedCount",
        "maximumFailedCount",
        "maximumSkippedCount",
      ]);
      assertNonEmptyString(condition.suiteName, "acceptanceCondition.suiteName");
      for (const field of [
        "minimumPassedCount",
        "maximumFailedCount",
        "maximumSkippedCount",
      ]) {
        if (!Number.isSafeInteger(condition[field]) || condition[field] < 0) {
          throw new VerificationValidationError(
            `acceptanceCondition.${field} must be a non-negative integer.`,
          );
        }
      }
      return {
        type: condition.type,
        suiteName: condition.suiteName,
        minimumPassedCount: condition.minimumPassedCount,
        maximumFailedCount: condition.maximumFailedCount,
        maximumSkippedCount: condition.maximumSkippedCount,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.HTTP_STATUS_EQUALS: {
      const checkpointIndependent = commonCondition(condition, [
        "expectedStatus",
      ]);
      if (
        !Number.isSafeInteger(condition.expectedStatus) ||
        condition.expectedStatus < 100 ||
        condition.expectedStatus > 599
      ) {
        throw new VerificationValidationError(
          "acceptanceCondition.expectedStatus must be an HTTP status code.",
        );
      }
      return {
        type: condition.type,
        expectedStatus: condition.expectedStatus,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.RUNTIME_READINESS_EQUALS: {
      const checkpointIndependent = commonCondition(condition, [
        "expectedReady",
      ]);
      if (typeof condition.expectedReady !== "boolean") {
        throw new VerificationValidationError(
          "acceptanceCondition.expectedReady must be a boolean.",
        );
      }
      return {
        type: condition.type,
        expectedReady: condition.expectedReady,
        checkpointIndependent,
      };
    }
    case AcceptanceConditionType.ALL_OF:
    case AcceptanceConditionType.ANY_OF: {
      const checkpointIndependent = commonCondition(condition, [
        "conditions",
        ...(condition.type === AcceptanceConditionType.ANY_OF
          ? ["explicitlyAllowed"]
          : []),
      ]);
      if (!Array.isArray(condition.conditions) || condition.conditions.length < 2) {
        throw new VerificationValidationError(
          "Composite acceptance conditions require at least two conditions.",
        );
      }
      if (
        condition.type === AcceptanceConditionType.ANY_OF &&
        condition.explicitlyAllowed !== true
      ) {
        throw new VerificationValidationError(
          "any-of requires explicitlyAllowed: true in the contract.",
        );
      }
      return {
        type: condition.type,
        conditions: condition.conditions.map(normalizeAcceptanceCondition),
        ...(condition.type === AcceptanceConditionType.ANY_OF
          ? { explicitlyAllowed: true }
          : {}),
        checkpointIndependent,
      };
    }
    default:
      throw new UnsupportedAcceptanceConditionError(condition.type);
  }
}

function evaluation(result, evidence, detail) {
  return {
    result,
    evidenceIds: [...new Set(evidence.map((record) => record.evidenceId))].sort(),
    detail,
  };
}

function atomicEvaluation(records, predicate, description) {
  if (records.length === 0) {
    return evaluation(
      ObligationVerdictResult.UNVERIFIABLE,
      [],
      `Required ${description} evidence is unavailable.`,
    );
  }
  const matching = records.filter(predicate);
  if (matching.length > 0) {
    return evaluation(
      ObligationVerdictResult.SATISFIED,
      matching,
      null,
    );
  }
  return evaluation(
    ObligationVerdictResult.NOT_SATISFIED,
    records,
    `Observed ${description} evidence did not meet the acceptance condition.`,
  );
}

export function evaluateAcceptanceCondition(conditionInput, evidenceRecords) {
  const condition = normalizeAcceptanceCondition(conditionInput);
  switch (condition.type) {
    case AcceptanceConditionType.EVIDENCE_KIND_PRESENT:
      return atomicEvaluation(
        evidenceRecords.filter((record) => record.kind === condition.evidenceKind),
        () => true,
        condition.evidenceKind,
      );
    case AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT,
        ),
        (record) => record.payload?.exitCode === condition.expectedExitCode,
        "command exit",
      );
    case AcceptanceConditionType.FILE_EXISTS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) =>
            record.kind === ObservationKind.FILE_EXISTENCE &&
            record.payload?.path === condition.path,
        ),
        (record) => record.payload.exists === condition.expectedExists,
        "file existence",
      );
    case AcceptanceConditionType.FILE_HASH_EQUALS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) =>
            record.kind === ObservationKind.FILE_CONTENT_HASH &&
            record.payload?.path === condition.path,
        ),
        (record) => record.payload.contentHash === condition.expectedHash,
        "file hash",
      );
    case AcceptanceConditionType.FILE_CONTENT_EQUALS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) =>
            record.kind === ObservationKind.FILE_CONTENT &&
            record.payload?.path === condition.path,
        ),
        (record) => record.payload.content === condition.expectedContent,
        "file content",
      );
    case AcceptanceConditionType.BROWSER_CHECK_EQUALS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) =>
            record.kind === ObservationKind.BROWSER_INTERACTION_RESULT,
        ),
        (record) =>
          record.payload.checks?.[condition.check] === condition.expected,
        `browser check ${condition.check}`,
      );
    case AcceptanceConditionType.BROWSER_ERROR_COUNTS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) => record.kind === ObservationKind.BROWSER_ERROR_RESULT,
        ),
        (record) =>
          record.payload.consoleErrors.length <=
            condition.maxConsoleErrors &&
          record.payload.pageErrors.length <= condition.maxPageErrors,
        "browser error counts",
      );
    case AcceptanceConditionType.STRUCTURED_TEST_COUNTS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) =>
            record.kind === ObservationKind.STRUCTURED_TEST_RESULT &&
            record.payload?.suiteName === condition.suiteName,
        ),
        (record) =>
          record.payload.passedCount >= condition.minimumPassedCount &&
          record.payload.failedCount <= condition.maximumFailedCount &&
          record.payload.skippedCount <= condition.maximumSkippedCount,
        "structured test",
      );
    case AcceptanceConditionType.HTTP_STATUS_EQUALS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) => record.kind === ObservationKind.HTTP_RESPONSE_RESULT,
        ),
        (record) => record.payload?.statusCode === condition.expectedStatus,
        "HTTP response",
      );
    case AcceptanceConditionType.RUNTIME_READINESS_EQUALS:
      return atomicEvaluation(
        evidenceRecords.filter(
          (record) =>
            record.kind === ObservationKind.RUNTIME_READINESS_RESULT,
        ),
        (record) => record.payload?.ready === condition.expectedReady,
        "runtime readiness",
      );
    case AcceptanceConditionType.ALL_OF: {
      const results = condition.conditions.map((child) =>
        evaluateAcceptanceCondition(child, evidenceRecords),
      );
      const notSatisfied = results.find(
        (result) => result.result === ObligationVerdictResult.NOT_SATISFIED,
      );
      const unverifiable = results.find(
        (result) => result.result === ObligationVerdictResult.UNVERIFIABLE,
      );
      return {
        result: notSatisfied
          ? ObligationVerdictResult.NOT_SATISFIED
          : unverifiable
            ? ObligationVerdictResult.UNVERIFIABLE
            : ObligationVerdictResult.SATISFIED,
        evidenceIds: [...new Set(results.flatMap((result) => result.evidenceIds))].sort(),
        detail: notSatisfied?.detail ?? unverifiable?.detail ?? null,
      };
    }
    case AcceptanceConditionType.ANY_OF: {
      const results = condition.conditions.map((child) =>
        evaluateAcceptanceCondition(child, evidenceRecords),
      );
      const satisfied = results.find(
        (result) => result.result === ObligationVerdictResult.SATISFIED,
      );
      const unverifiable = results.find(
        (result) => result.result === ObligationVerdictResult.UNVERIFIABLE,
      );
      return {
        result: satisfied
          ? ObligationVerdictResult.SATISFIED
          : unverifiable
            ? ObligationVerdictResult.UNVERIFIABLE
            : ObligationVerdictResult.NOT_SATISFIED,
        evidenceIds: [...new Set(results.flatMap((result) => result.evidenceIds))].sort(),
        detail:
          satisfied?.detail ??
          unverifiable?.detail ??
          "No explicitly allowed alternative met the acceptance condition.",
      };
    }
    default:
      throw new UnsupportedAcceptanceConditionError(condition.type);
  }
}

export function acceptanceConditionIsCheckpointIndependent(condition) {
  return normalizeAcceptanceCondition(condition).checkpointIndependent;
}

export function computeCompletionVerdictIntegrityHash(verdictWithoutHash) {
  return hash(verdictWithoutHash);
}

// A build may be delivered with an accepted design shortfall: every behavioural
// obligation proven, but the approved design not reproduced in some measured
// aspect. That fact used to live only in an unattached evidence record, so a
// build whose approved design was missed on surface-order, hierarchy and
// navigation recorded SATISFIED for all fourteen obligations and nothing else,
// and the customer was told fourteen of fourteen. Delivering imperfect work is
// allowed; describing it as unqualified success is not. The shortfall travels
// on the verdict, inside the integrity hash, so no reader can miss it.
export function normalizeDesignShortfall(value, label = "designShortfall") {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CompletionVerdictIntegrityError(`${label} must be an object or null.`);
  }
  assertExactKeys(value, DESIGN_SHORTFALL_KEYS, label);
  if (
    !Array.isArray(value.failedAspects) ||
    value.failedAspects.length === 0 ||
    value.failedAspects.some(
      (aspect) => typeof aspect !== "string" || aspect.trim() === "",
    )
  ) {
    throw new CompletionVerdictIntegrityError(
      `${label}.failedAspects must list at least one named aspect. A shortfall with nothing named is not a disclosure.`,
    );
  }
  assertNonEmptyString(value.reason, `${label}.reason`);
  if (
    value.comparedViewports !== null &&
    !Number.isSafeInteger(value.comparedViewports)
  ) {
    throw new CompletionVerdictIntegrityError(
      `${label}.comparedViewports must be an integer or null.`,
    );
  }
  return deepFreeze({
    comparedViewports: value.comparedViewports ?? null,
    failedAspects: [...value.failedAspects],
    reason: value.reason,
  });
}

export function createCompletionVerdict({
  verdictId,
  missionId,
  contractVersion,
  verificationTimestamp,
  workspaceCheckpointReference,
  obligationVerdicts,
  designShortfall = null,
}) {
  const deficiencies = obligationVerdicts
    .filter((verdict) => verdict.result === ObligationVerdictResult.NOT_SATISFIED)
    .map((verdict) => ({
      obligationId: verdict.obligationId,
      detail: verdict.deficiency,
    }));
  const unverifiableConditions = obligationVerdicts
    .filter((verdict) => verdict.result === ObligationVerdictResult.UNVERIFIABLE)
    .map((verdict) => ({
      obligationId: verdict.obligationId,
      detail: verdict.unverifiableCondition,
    }));
  const verdictWithoutHash = {
    verdictId,
    missionId,
    contractVersion,
    verificationTimestamp,
    workspaceCheckpointReference: workspaceCheckpointReference ?? null,
    obligationVerdicts,
    overallResult: obligationVerdicts.every(
      (verdict) => verdict.result === ObligationVerdictResult.SATISFIED,
    )
      ? CompletionResult.COMPLETE
      : CompletionResult.INCOMPLETE,
    deficiencies,
    // overallResult stays a statement about the obligations, because the
    // SUCCEEDED transition is gated on it: making a shortfall INCOMPLETE sent
    // proven builds back to repair and destroyed them. The shortfall is
    // disclosed alongside it instead, and the customer-facing claim is required
    // to reflect it.
    designShortfall: normalizeDesignShortfall(designShortfall),
    unverifiableConditions,
  };
  return deepFreeze({
    ...verdictWithoutHash,
    integrityHash: computeCompletionVerdictIntegrityHash(verdictWithoutHash),
  });
}

export function validateCompletionVerdict(verdict, { missionId, contract }) {
  assertExactKeys(verdict, VERDICT_KEYS, "completionVerdict");
  assertIdentifier(verdict.verdictId, "completionVerdict.verdictId");
  if (verdict.missionId !== missionId) {
    throw new CompletionVerdictIntegrityError(
      "Completion Verdict belongs to another mission.",
    );
  }
  if (verdict.contractVersion !== contract.contractVersion) {
    throw new CompletionVerdictIntegrityError(
      "Completion Verdict contract version is stale or invalid.",
    );
  }
  assertNonEmptyString(
    verdict.verificationTimestamp,
    "completionVerdict.verificationTimestamp",
  );
  if (Number.isNaN(Date.parse(verdict.verificationTimestamp))) {
    throw new CompletionVerdictIntegrityError(
      "Completion Verdict timestamp is invalid.",
    );
  }
  normalizeCheckpoint(
    verdict.workspaceCheckpointReference,
    "completionVerdict.workspaceCheckpointReference",
  );
  if (!Array.isArray(verdict.obligationVerdicts)) {
    throw new CompletionVerdictIntegrityError(
      "Completion Verdict obligation verdicts must be an array.",
    );
  }
  normalizeDesignShortfall(
    verdict.designShortfall,
    "completionVerdict.designShortfall",
  );

  const activeIds = contract.obligations.map((item) => item.obligationId).sort();
  const verdictIds = verdict.obligationVerdicts
    .map((item) => item.obligationId)
    .sort();
  if (
    verdictIds.length !== activeIds.length ||
    verdictIds.some((id, index) => id !== activeIds[index]) ||
    new Set(verdictIds).size !== verdictIds.length
  ) {
    throw new CompletionVerdictIntegrityError(
      "Completion Verdict must contain exactly one verdict for every active obligation.",
    );
  }

  for (const obligationVerdict of verdict.obligationVerdicts) {
    assertExactKeys(
      obligationVerdict,
      OBLIGATION_VERDICT_KEYS,
      "obligationVerdict",
    );
    if (!verdictResults.has(obligationVerdict.result)) {
      throw new CompletionVerdictIntegrityError(
        "Obligation verdict result is invalid.",
      );
    }
    if (!Array.isArray(obligationVerdict.evidenceReferences)) {
      throw new CompletionVerdictIntegrityError(
        "Obligation evidence references must be an array.",
      );
    }
    const evidenceIds = new Set();
    for (const reference of obligationVerdict.evidenceReferences) {
      assertExactKeys(reference, EVIDENCE_REFERENCE_KEYS, "evidenceReference");
      assertIdentifier(reference.evidenceId, "evidenceReference.evidenceId");
      normalizeCheckpoint(
        reference.verificationRequestReference,
        "evidenceReference.verificationRequestReference",
      );
      normalizeCheckpoint(
        reference.workspaceCheckpointReference,
        "evidenceReference.workspaceCheckpointReference",
      );
      if (evidenceIds.has(reference.evidenceId)) {
        throw new CompletionVerdictIntegrityError(
          "An obligation verdict contains duplicate evidence references.",
        );
      }
      evidenceIds.add(reference.evidenceId);
    }
    if (
      obligationVerdict.result === ObligationVerdictResult.SATISFIED &&
      obligationVerdict.evidenceReferences.length === 0
    ) {
      throw new CompletionVerdictIntegrityError(
        "SATISFIED requires evidence.",
      );
    }
    if (
      obligationVerdict.result === ObligationVerdictResult.NOT_SATISFIED &&
      (typeof obligationVerdict.deficiency !== "string" ||
        obligationVerdict.deficiency.length === 0)
    ) {
      throw new CompletionVerdictIntegrityError(
        "NOT_SATISFIED requires a deficiency.",
      );
    }
    if (
      obligationVerdict.result === ObligationVerdictResult.UNVERIFIABLE &&
      (typeof obligationVerdict.unverifiableCondition !== "string" ||
        obligationVerdict.unverifiableCondition.length === 0)
    ) {
      throw new CompletionVerdictIntegrityError(
        "UNVERIFIABLE requires a condition.",
      );
    }
    if (
      obligationVerdict.result === ObligationVerdictResult.SATISFIED &&
      (obligationVerdict.deficiency !== null ||
        obligationVerdict.unverifiableCondition !== null)
    ) {
      throw new CompletionVerdictIntegrityError(
        "SATISFIED cannot contain a deficiency or unverifiable condition.",
      );
    }
    if (
      obligationVerdict.result === ObligationVerdictResult.NOT_SATISFIED &&
      obligationVerdict.unverifiableCondition !== null
    ) {
      throw new CompletionVerdictIntegrityError(
        "NOT_SATISFIED cannot contain an unverifiable condition.",
      );
    }
    if (
      obligationVerdict.result === ObligationVerdictResult.UNVERIFIABLE &&
      obligationVerdict.deficiency !== null
    ) {
      throw new CompletionVerdictIntegrityError(
        "UNVERIFIABLE cannot contain a deficiency.",
      );
    }
  }

  const expected = createCompletionVerdict({
    verdictId: verdict.verdictId,
    missionId: verdict.missionId,
    contractVersion: verdict.contractVersion,
    verificationTimestamp: verdict.verificationTimestamp,
    workspaceCheckpointReference: verdict.workspaceCheckpointReference,
    obligationVerdicts: verdict.obligationVerdicts,
  });
  if (
    verdict.overallResult !== expected.overallResult ||
    canonicalize(verdict.deficiencies) !== canonicalize(expected.deficiencies) ||
    canonicalize(verdict.unverifiableConditions) !==
      canonicalize(expected.unverifiableConditions) ||
    verdict.integrityHash !== expected.integrityHash
  ) {
    throw new CompletionVerdictIntegrityError(
      "Completion Verdict conjunction or integrity hash is invalid.",
    );
  }
  return deepFreeze(structuredClone(verdict));
}
