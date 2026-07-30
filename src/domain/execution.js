import {
  ExecutionValidationError,
  ModelGatewayValidationError,
  WorkUnitEvidenceRequiredError,
} from "./errors.js";

export const EXECUTION_ENGINE_SOURCE = "EXECUTION_ENGINE";
export const MODEL_GATEWAY_SOURCE = "MODEL_GATEWAY";

export const WorkUnitAction = Object.freeze({
  WRITE_FILE: "write-file",
  APPLY_FILE_BUNDLE: "apply-file-bundle",
  REPLACE_FILE: "replace-file",
  DELETE_FILE: "delete-file",
  CREATE_DIRECTORY: "create-directory",
  RUN_COMMAND: "run-command",
  INSPECT_FILE: "inspect-file",
  LIST_FILES: "list-files",
});

export const WorkUnitStatus = Object.freeze({
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  TIMED_OUT: "TIMED_OUT",
  CANCELLED: "CANCELLED",
  OUTPUT_LIMIT_EXCEEDED: "OUTPUT_LIMIT_EXCEEDED",
});

export const ModelTaskClass = Object.freeze({
  PROJECT_UNDERSTANDING: "PROJECT_UNDERSTANDING",
  FILE_GENERATION: "FILE_GENERATION",
  STRUCTURED_TRANSFORMATION: "STRUCTURED_TRANSFORMATION",
  WORK_DECOMPOSITION: "WORK_DECOMPOSITION",
  REPAIR_DIAGNOSIS: "REPAIR_DIAGNOSIS",
  REPAIR_IMPLEMENTATION: "REPAIR_IMPLEMENTATION",
});

export const ModelTier = Object.freeze({
  MECHANICAL: "MECHANICAL",
  STANDARD_ENGINEERING: "STANDARD_ENGINEERING",
  DEEP_REASONING: "DEEP_REASONING",
  ARCHITECTURE: "ARCHITECTURE",
  EXCEPTIONAL_REASONING: "EXCEPTIONAL_REASONING",
});

const IDENTIFIER_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const actionSet = new Set(Object.values(WorkUnitAction));
const workStatusSet = new Set(Object.values(WorkUnitStatus));
const taskClassSet = new Set(Object.values(ModelTaskClass));
const tierSet = new Set(Object.values(ModelTier));
const WORK_UNIT_KEYS = Object.freeze([
  "actionType",
  "endTimestamp",
  "evidenceReferences",
  "idempotencyKey",
  "inputs",
  "missionId",
  "postWorkCheckpointId",
  "preWorkCheckpointId",
  "startTimestamp",
  "status",
  "targetObligationIds",
  "workUnitId",
  "workspaceId",
]);
const MODEL_CALL_KEYS = Object.freeze([
  "contextReferences",
  "costMetadata",
  "depthLevel",
  "endTimestamp",
  "expectedStructuredOutputSchema",
  "idempotencyKey",
  "missionId",
  "modelId",
  "modelTier",
  "provider",
  "providerFamily",
  "purpose",
  "requestId",
  "routingReason",
  "startTimestamp",
  "status",
  "structuredOutput",
  "taskClass",
  "tokenMetadata",
  "workUnitId",
]);
const EVIDENCE_REFERENCE_KEYS = Object.freeze([
  "evidenceId",
  "workspaceCheckpointReference",
]);

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function freezeExecutionValue(value) {
  return deepFreeze(structuredClone(value));
}

export function canonicalizeExecutionValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeExecutionValue).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeExecutionValue(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, keys, label, ErrorType) {
  if (!isPlainObject(value)) {
    throw new ErrorType(`${label} must be a plain object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ErrorType(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

export function assertExecutionIdentifier(
  value,
  label,
  ErrorType = ExecutionValidationError,
) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new ErrorType(`${label} is malformed.`);
  }
}

function assertTimestamp(value, label, ErrorType) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new ErrorType(`${label} must be an ISO-compatible timestamp.`);
  }
}

function normalizeJson(value, label, ErrorType, seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ErrorType(`${label} contains a non-finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new ErrorType(`${label} contains a cycle.`);
    }
    seen.add(value);
    const result = value.map((entry, index) =>
      normalizeJson(entry, `${label}[${index}]`, ErrorType, seen),
    );
    seen.delete(value);
    return result;
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) {
      throw new ErrorType(`${label} contains a cycle.`);
    }
    seen.add(value);
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      result[key] = normalizeJson(
        entry,
        `${label}.${key}`,
        ErrorType,
        seen,
      );
    }
    seen.delete(value);
    return result;
  }
  throw new ErrorType(`${label} must contain only JSON-compatible values.`);
}

function normalizeIdentifierArray(value, label, ErrorType, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new ErrorType(`${label} must be a non-empty array.`);
  }
  const normalized = value.map((entry, index) => {
    assertExecutionIdentifier(entry, `${label}[${index}]`, ErrorType);
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new ErrorType(`${label} contains duplicates.`);
  }
  return normalized;
}

function normalizeEvidenceReferences(value, workUnitId) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new WorkUnitEvidenceRequiredError(workUnitId);
  }
  const ids = new Set();
  return value.map((reference) => {
    assertExactKeys(
      reference,
      EVIDENCE_REFERENCE_KEYS,
      "work-unit evidence reference",
      ExecutionValidationError,
    );
    assertExecutionIdentifier(
      reference.evidenceId,
      "work-unit evidenceId",
    );
    assertExecutionIdentifier(
      reference.workspaceCheckpointReference,
      "work-unit evidence checkpoint",
    );
    if (ids.has(reference.evidenceId)) {
      throw new ExecutionValidationError(
        `Evidence "${reference.evidenceId}" is duplicated.`,
      );
    }
    ids.add(reference.evidenceId);
    return {
      evidenceId: reference.evidenceId,
      workspaceCheckpointReference:
        reference.workspaceCheckpointReference,
    };
  });
}

export function normalizeWorkUnitRecord(record) {
  assertExactKeys(
    record,
    WORK_UNIT_KEYS,
    "work unit",
    ExecutionValidationError,
  );
  for (const [label, value] of [
    ["workUnitId", record.workUnitId],
    ["missionId", record.missionId],
    ["workspaceId", record.workspaceId],
    ["preWorkCheckpointId", record.preWorkCheckpointId],
    ["postWorkCheckpointId", record.postWorkCheckpointId],
    ["idempotencyKey", record.idempotencyKey],
  ]) {
    assertExecutionIdentifier(value, `work unit ${label}`);
  }
  if (!actionSet.has(record.actionType)) {
    throw new ExecutionValidationError("work unit actionType is invalid.");
  }
  if (!workStatusSet.has(record.status)) {
    throw new ExecutionValidationError("work unit status is invalid.");
  }
  assertTimestamp(
    record.startTimestamp,
    "work unit startTimestamp",
    ExecutionValidationError,
  );
  assertTimestamp(
    record.endTimestamp,
    "work unit endTimestamp",
    ExecutionValidationError,
  );
  if (Date.parse(record.endTimestamp) < Date.parse(record.startTimestamp)) {
    throw new ExecutionValidationError(
      "work unit endTimestamp precedes startTimestamp.",
    );
  }
  const evidenceReferences = normalizeEvidenceReferences(
    record.evidenceReferences,
    record.workUnitId,
  );
  if (
    evidenceReferences.some(
      (reference) =>
        reference.workspaceCheckpointReference !==
        record.postWorkCheckpointId,
    )
  ) {
    throw new ExecutionValidationError(
      "Every work-unit evidence reference must cite its post-work checkpoint.",
    );
  }
  return freezeExecutionValue({
    workUnitId: record.workUnitId,
    missionId: record.missionId,
    workspaceId: record.workspaceId,
    targetObligationIds: normalizeIdentifierArray(
      record.targetObligationIds,
      "work unit targetObligationIds",
      ExecutionValidationError,
    ),
    actionType: record.actionType,
    inputs: normalizeJson(
      record.inputs,
      "work unit inputs",
      ExecutionValidationError,
    ),
    preWorkCheckpointId: record.preWorkCheckpointId,
    postWorkCheckpointId: record.postWorkCheckpointId,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    status: record.status,
    evidenceReferences,
    idempotencyKey: record.idempotencyKey,
  });
}

export function normalizeModelCallRecord(record) {
  assertExactKeys(
    record,
    MODEL_CALL_KEYS,
    "model call",
    ModelGatewayValidationError,
  );
  for (const [label, value] of [
    ["requestId", record.requestId],
    ["missionId", record.missionId],
    ["workUnitId", record.workUnitId],
    ["modelId", record.modelId],
    ["provider", record.provider],
    ["idempotencyKey", record.idempotencyKey],
  ]) {
    assertExecutionIdentifier(
      value,
      `model call ${label}`,
      ModelGatewayValidationError,
    );
  }
  if (typeof record.purpose !== "string" || record.purpose.trim().length === 0) {
    throw new ModelGatewayValidationError(
      "model call purpose must be non-empty.",
    );
  }
  if (!taskClassSet.has(record.taskClass) || !tierSet.has(record.modelTier)) {
    throw new ModelGatewayValidationError(
      "model call taskClass or modelTier is invalid.",
    );
  }
  if (
    (record.depthLevel !== null &&
      (!Number.isSafeInteger(record.depthLevel) ||
        record.depthLevel < 1 ||
        record.depthLevel > 5)) ||
    (record.routingReason !== null &&
      (typeof record.routingReason !== "string" ||
        record.routingReason.trim() === "")) ||
    (record.providerFamily !== null &&
      !["GPT", "Claude", "Gemini"].includes(record.providerFamily))
  ) {
    throw new ModelGatewayValidationError(
      "model call repair routing metadata is invalid.",
    );
  }
  if (record.status !== "SUCCEEDED" && record.status !== "FAILED") {
    throw new ModelGatewayValidationError("model call status is invalid.");
  }
  assertTimestamp(
    record.startTimestamp,
    "model call startTimestamp",
    ModelGatewayValidationError,
  );
  assertTimestamp(
    record.endTimestamp,
    "model call endTimestamp",
    ModelGatewayValidationError,
  );
  if (Date.parse(record.endTimestamp) < Date.parse(record.startTimestamp)) {
    throw new ModelGatewayValidationError(
      "model call endTimestamp precedes startTimestamp.",
    );
  }
  const contextReferences = normalizeJson(
    record.contextReferences,
    "model call contextReferences",
    ModelGatewayValidationError,
  );
  if (!Array.isArray(contextReferences)) {
    throw new ModelGatewayValidationError(
      "model call contextReferences must be an array.",
    );
  }
  for (const reference of contextReferences) {
    assertExactKeys(
      reference,
      ["id", "kind"],
      "model context reference",
      ModelGatewayValidationError,
    );
    assertExecutionIdentifier(
      reference.id,
      "model context reference id",
      ModelGatewayValidationError,
    );
    assertExecutionIdentifier(
      reference.kind,
      "model context reference kind",
      ModelGatewayValidationError,
    );
  }
  const tokenMetadata = normalizeJson(
    record.tokenMetadata,
    "model call tokenMetadata",
    ModelGatewayValidationError,
  );
  assertExactKeys(
    tokenMetadata,
    ["inputTokens", "outputTokens"],
    "model token metadata",
    ModelGatewayValidationError,
  );
  for (const value of Object.values(tokenMetadata)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new ModelGatewayValidationError(
        "model token counts must be non-negative integers.",
      );
    }
  }
  const costMetadata = normalizeJson(
    record.costMetadata,
    "model call costMetadata",
    ModelGatewayValidationError,
  );
  assertExactKeys(
    costMetadata,
    ["attemptCount", "costUsd"],
    "model cost metadata",
    ModelGatewayValidationError,
  );
  if (
    !Number.isSafeInteger(costMetadata.attemptCount) ||
    costMetadata.attemptCount < 1 ||
    typeof costMetadata.costUsd !== "number" ||
    !Number.isFinite(costMetadata.costUsd) ||
    costMetadata.costUsd < 0
  ) {
    throw new ModelGatewayValidationError("model cost metadata is invalid.");
  }
  return freezeExecutionValue({
    requestId: record.requestId,
    missionId: record.missionId,
    workUnitId: record.workUnitId,
    purpose: record.purpose.trim(),
    taskClass: record.taskClass,
    modelId: record.modelId,
    modelTier: record.modelTier,
    provider: record.provider,
    providerFamily: record.providerFamily,
    depthLevel: record.depthLevel,
    routingReason:
      record.routingReason === null ? null : record.routingReason.trim(),
    idempotencyKey: record.idempotencyKey,
    contextReferences,
    expectedStructuredOutputSchema: normalizeJson(
      record.expectedStructuredOutputSchema,
      "model expected schema",
      ModelGatewayValidationError,
    ),
    structuredOutput: normalizeJson(
      record.structuredOutput,
      "model structured output",
      ModelGatewayValidationError,
    ),
    tokenMetadata,
    costMetadata,
    startTimestamp: record.startTimestamp,
    endTimestamp: record.endTimestamp,
    status: record.status,
  });
}

export function projectExecutionHistory(records, missionId) {
  const workUnits = [];
  const modelCalls = [];
  const workUnitIds = new Set();
  const workUnitKeys = new Set();
  const modelRequestIds = new Set();
  const modelKeys = new Set();

  for (const event of records) {
    const workUnit = event.fact?.metadata?.executionRecord;
    if (workUnit !== undefined) {
      const normalized = normalizeWorkUnitRecord(workUnit);
      if (
        event.source !== EXECUTION_ENGINE_SOURCE ||
        event.fact.workUnitReference !== normalized.workUnitId ||
        event.fact.workspaceCheckpointReference !==
          normalized.postWorkCheckpointId ||
        canonicalizeExecutionValue(event.fact.evidenceReferences) !==
          canonicalizeExecutionValue(normalized.evidenceReferences)
      ) {
        throw new ExecutionValidationError(
          "Persisted work unit is not bound to its authoritative execution fact.",
        );
      }
      if (normalized.missionId !== missionId) {
        throw new ExecutionValidationError(
          "Persisted work unit belongs to another mission.",
        );
      }
      if (
        workUnitIds.has(normalized.workUnitId) ||
        workUnitKeys.has(normalized.idempotencyKey)
      ) {
        throw new ExecutionValidationError(
          "Work-unit replay contains a duplicate identity.",
        );
      }
      workUnitIds.add(normalized.workUnitId);
      workUnitKeys.add(normalized.idempotencyKey);
      workUnits.push(normalized);
    }
    const modelCall = event.fact?.metadata?.modelCallRecord;
    if (modelCall !== undefined) {
      const normalized = normalizeModelCallRecord(modelCall);
      if (
        event.source !== MODEL_GATEWAY_SOURCE ||
        event.fact.workUnitReference !== normalized.workUnitId
      ) {
        throw new ModelGatewayValidationError(
          "Persisted model call is not bound to its authoritative gateway fact.",
        );
      }
      if (normalized.missionId !== missionId) {
        throw new ModelGatewayValidationError(
          "Persisted model call belongs to another mission.",
        );
      }
      if (
        modelRequestIds.has(normalized.requestId) ||
        modelKeys.has(normalized.idempotencyKey)
      ) {
        throw new ModelGatewayValidationError(
          "Model-call replay contains a duplicate identity.",
        );
      }
      modelRequestIds.add(normalized.requestId);
      modelKeys.add(normalized.idempotencyKey);
      modelCalls.push(normalized);
    }
  }
  return freezeExecutionValue({ workUnits, modelCalls });
}
