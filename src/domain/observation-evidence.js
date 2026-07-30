import { createHash } from "node:crypto";

import {
  EvidenceIntegrityError,
  EvidenceValidationError,
} from "./errors.js";

export const EVIDENCE_SCHEMA_VERSION = 1;
export const REDACTION_MARKER = "[REDACTED]";

export const ObservationKind = Object.freeze({
  COMMAND_EXIT_RESULT: "command-exit-result",
  FILE_EXISTENCE: "file-existence",
  FILE_CONTENT_HASH: "file-content-hash",
  STRUCTURED_TEST_RESULT: "structured-test-result",
  RUNTIME_READINESS_RESULT: "runtime-readiness-result",
  HTTP_RESPONSE_RESULT: "http-response-result",
  FILE_CONTENT: "file-content",
  FILE_LISTING: "file-listing",
  WORK_UNIT_RESULT: "work-unit-result",
  MODEL_CALL_RESULT: "model-call-result",
  RUNTIME_PROCESS_RESULT: "runtime-process-result",
  BROWSER_INTERACTION_RESULT: "browser-interaction-result",
  BROWSER_ERROR_RESULT: "browser-error-result",
  REPAIR_DIAGNOSIS_RESULT: "repair-diagnosis-result",
  REPAIR_ATTEMPT_RESULT: "repair-attempt-result",
  REPAIR_FINDING: "repair-finding",
});

export const OBSERVATION_KINDS = Object.freeze(Object.values(ObservationKind));

export const RedactionStatus = Object.freeze({
  NOT_REDACTED: "not-redacted",
  REDACTED: "redacted",
});

const observationKindSet = new Set(OBSERVATION_KINDS);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_PATTERN =
  /(?:password|passwd|secret|token|authorization|api[-_]?key|cookie|private[-_]?key)/iu;
const RECORD_KEYS = Object.freeze([
  "captureMethod",
  "commandReference",
  "contentHash",
  "evidenceId",
  "kind",
  "metadata",
  "missionId",
  "obligationReference",
  "payload",
  "payloadReference",
  "producingSubsystem",
  "recordHash",
  "redactionStatus",
  "schemaVersion",
  "timestamp",
  "verificationRequestReference",
  "workUnitReference",
  "workspaceCheckpointReference",
]);

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new EvidenceValidationError(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new EvidenceValidationError(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EvidenceValidationError(`${label} must be a non-empty string.`);
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new EvidenceValidationError(
      `${label} must be 1-128 characters using letters, numbers, dots, underscores, or hyphens.`,
    );
  }
}

function normalizeNullableReference(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  assertIdentifier(value, label);
  return value;
}

function normalizeJsonValue(value, label, seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new EvidenceValidationError(`${label} contains a non-finite number.`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new EvidenceValidationError(`${label} must not contain cycles.`);
    }
    seen.add(value);
    const normalized = value.map((entry, index) =>
      normalizeJsonValue(entry, `${label}[${index}]`, seen),
    );
    seen.delete(value);
    return normalized;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    if (seen.has(value)) {
      throw new EvidenceValidationError(`${label} must not contain cycles.`);
    }
    seen.add(value);
    const normalized = {};
    for (const [key, entry] of Object.entries(value)) {
      normalized[key] = normalizeJsonValue(entry, `${label}.${key}`, seen);
    }
    seen.delete(value);
    return normalized;
  }
  throw new EvidenceValidationError(
    `${label} must contain only JSON-compatible values.`,
  );
}

export function canonicalizeEvidenceValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeEvidenceValue).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeEvidenceValue(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function normalizeSensitiveValues(sensitiveValues) {
  if (sensitiveValues === undefined) {
    return [];
  }
  if (!Array.isArray(sensitiveValues)) {
    throw new EvidenceValidationError("sensitiveValues must be an array.");
  }
  const values = sensitiveValues.map((value, index) => {
    assertNonEmptyString(value, `sensitiveValues[${index}]`);
    return value;
  });
  return [...new Set(values)].sort((left, right) => right.length - left.length);
}

function redactValue(value, sensitiveValues, state, keyName = null) {
  if (keyName !== null && SENSITIVE_KEY_PATTERN.test(keyName)) {
    state.redacted = true;
    return REDACTION_MARKER;
  }

  if (typeof value === "string") {
    let result = value;
    for (const sensitiveValue of sensitiveValues) {
      if (result.includes(sensitiveValue)) {
        result = result.split(sensitiveValue).join(REDACTION_MARKER);
        state.redacted = true;
      }
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((entry) =>
      redactValue(entry, sensitiveValues, state),
    );
  }
  if (value !== null && typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const redactedKey = redactValue(key, sensitiveValues, state);
      result[redactedKey] = redactValue(
        entry,
        sensitiveValues,
        state,
        key,
      );
    }
    return result;
  }
  return value;
}

function validateCommandExitPayload(payload) {
  assertExactKeys(payload, ["exitCode", "stdout", "stderr"], "payload");
  if (!Number.isSafeInteger(payload.exitCode)) {
    throw new EvidenceValidationError("payload.exitCode must be an integer.");
  }
  if (typeof payload.stdout !== "string" || typeof payload.stderr !== "string") {
    throw new EvidenceValidationError(
      "payload.stdout and payload.stderr must be strings.",
    );
  }
}

function validateFileExistencePayload(payload) {
  assertExactKeys(payload, ["path", "exists"], "payload");
  assertNonEmptyString(payload.path, "payload.path");
  if (typeof payload.exists !== "boolean") {
    throw new EvidenceValidationError("payload.exists must be a boolean.");
  }
}

function validateFileHashPayload(payload) {
  assertExactKeys(
    payload,
    [
      "path",
      "algorithm",
      "contentHash",
      "expectedHash",
      "matches",
    ],
    "payload",
  );
  assertNonEmptyString(payload.path, "payload.path");
  if (payload.algorithm !== "sha256") {
    throw new EvidenceValidationError("payload.algorithm must be sha256.");
  }
  if (!HASH_PATTERN.test(payload.contentHash)) {
    throw new EvidenceValidationError(
      "payload.contentHash must be a lowercase SHA-256 hash.",
    );
  }
  if (
    payload.expectedHash !== null &&
    (typeof payload.expectedHash !== "string" ||
      !HASH_PATTERN.test(payload.expectedHash))
  ) {
    throw new EvidenceValidationError(
      "payload.expectedHash must be null or a lowercase SHA-256 hash.",
    );
  }
  if (
    payload.matches !== null &&
    typeof payload.matches !== "boolean"
  ) {
    throw new EvidenceValidationError(
      "payload.matches must be null or a boolean.",
    );
  }
  if (
    payload.expectedHash === null !== (payload.matches === null) ||
    (payload.expectedHash !== null &&
      payload.matches !== (payload.contentHash === payload.expectedHash))
  ) {
    throw new EvidenceValidationError(
      "payload.matches must accurately compare contentHash and expectedHash.",
    );
  }
}

function validateStructuredTestPayload(payload) {
  assertExactKeys(
    payload,
    ["suiteName", "passedCount", "failedCount", "skippedCount"],
    "payload",
  );
  assertNonEmptyString(payload.suiteName, "payload.suiteName");
  for (const field of ["passedCount", "failedCount", "skippedCount"]) {
    if (!Number.isSafeInteger(payload[field]) || payload[field] < 0) {
      throw new EvidenceValidationError(
        `payload.${field} must be a non-negative integer.`,
      );
    }
  }
}

function validateReadinessPayload(payload) {
  assertExactKeys(payload, ["ready", "detail"], "payload");
  if (typeof payload.ready !== "boolean") {
    throw new EvidenceValidationError("payload.ready must be a boolean.");
  }
  assertNonEmptyString(payload.detail, "payload.detail");
}

function validateHttpResponsePayload(payload) {
  assertExactKeys(
    payload,
    ["statusCode", "headers", "body"],
    "payload",
  );
  if (
    !Number.isSafeInteger(payload.statusCode) ||
    payload.statusCode < 100 ||
    payload.statusCode > 599
  ) {
    throw new EvidenceValidationError(
      "payload.statusCode must be an HTTP status code.",
    );
  }
  assertPlainObject(payload.headers, "payload.headers");
  for (const [header, value] of Object.entries(payload.headers)) {
    assertNonEmptyString(header, "payload header name");
    if (typeof value !== "string") {
      throw new EvidenceValidationError(
        `HTTP header "${header}" must have a string value.`,
      );
    }
  }
  if (typeof payload.body !== "string") {
    throw new EvidenceValidationError("payload.body must be a string.");
  }
}

function validateFileContentPayload(payload) {
  assertExactKeys(
    payload,
    ["path", "encoding", "content", "contentHash"],
    "payload",
  );
  assertNonEmptyString(payload.path, "payload.path");
  if (payload.encoding !== "utf8" || typeof payload.content !== "string") {
    throw new EvidenceValidationError(
      "File-content evidence must contain utf8 string content.",
    );
  }
  if (!HASH_PATTERN.test(payload.contentHash)) {
    throw new EvidenceValidationError(
      "payload.contentHash must be a lowercase SHA-256 hash.",
    );
  }
  if (
    createHash("sha256").update(payload.content, "utf8").digest("hex") !==
    payload.contentHash
  ) {
    throw new EvidenceValidationError(
      "payload.contentHash does not match payload.content.",
    );
  }
}

function validateFileListingPayload(payload) {
  assertExactKeys(payload, ["path", "entries"], "payload");
  assertNonEmptyString(payload.path, "payload.path");
  if (
    !Array.isArray(payload.entries) ||
    payload.entries.some(
      (entry) => typeof entry !== "string" || entry.length === 0,
    )
  ) {
    throw new EvidenceValidationError(
      "payload.entries must be an array of non-empty paths.",
    );
  }
}

function validateWorkUnitPayload(payload) {
  assertExactKeys(
    payload,
    ["actionType", "status", "detail"],
    "payload",
  );
  assertNonEmptyString(payload.actionType, "payload.actionType");
  assertNonEmptyString(payload.status, "payload.status");
  assertNonEmptyString(payload.detail, "payload.detail");
}

function validateModelCallPayload(payload) {
  assertExactKeys(
    payload,
    ["requestId", "status", "structuredOutput", "detail"],
    "payload",
  );
  assertIdentifier(payload.requestId, "payload.requestId");
  assertNonEmptyString(payload.status, "payload.status");
  assertNonEmptyString(payload.detail, "payload.detail");
}

function validateRuntimeProcessPayload(payload) {
  assertExactKeys(
    payload,
    [
      "sessionId",
      "status",
      "exitCode",
      "signal",
      "stdout",
      "stderr",
      "detail",
    ],
    "payload",
  );
  assertIdentifier(payload.sessionId, "payload.sessionId");
  assertNonEmptyString(payload.status, "payload.status");
  assertNonEmptyString(payload.detail, "payload.detail");
  if (
    payload.exitCode !== null &&
    !Number.isSafeInteger(payload.exitCode)
  ) {
    throw new EvidenceValidationError(
      "payload.exitCode must be null or an integer.",
    );
  }
  if (
    payload.signal !== null &&
    typeof payload.signal !== "string"
  ) {
    throw new EvidenceValidationError(
      "payload.signal must be null or a string.",
    );
  }
  if (
    typeof payload.stdout !== "string" ||
    typeof payload.stderr !== "string"
  ) {
    throw new EvidenceValidationError(
      "Runtime stdout and stderr must be strings.",
    );
  }
}

function validateBrowserInteractionPayload(payload) {
  assertExactKeys(payload, ["checks"], "payload");
  assertPlainObject(payload.checks, "payload.checks");
  const checks = Object.entries(payload.checks);
  if (
    checks.length === 0 ||
    checks.some(
      ([name, value]) =>
        !IDENTIFIER_PATTERN.test(name) || typeof value !== "boolean",
    )
  ) {
    throw new EvidenceValidationError(
      "Browser interaction checks are malformed.",
    );
  }
}

function validateBrowserErrorPayload(payload) {
  assertExactKeys(
    payload,
    ["captureProbeErrors", "consoleErrors", "pageErrors"],
    "payload",
  );
  if (
    !Array.isArray(payload.captureProbeErrors) ||
    !Array.isArray(payload.consoleErrors) ||
    !Array.isArray(payload.pageErrors) ||
    [
      ...payload.captureProbeErrors,
      ...payload.consoleErrors,
      ...payload.pageErrors,
    ].some(
      (entry) => typeof entry !== "string",
    )
  ) {
    throw new EvidenceValidationError(
      "Browser console and page errors must be string arrays.",
    );
  }
}

function validateRepairPayload(payload) {
  assertExactKeys(payload, ["record", "recordType"], "repair payload");
  assertIdentifier(payload.recordType, "repair payload recordType");
  assertPlainObject(payload.record, "repair payload record");
}

function validateObservationPayload(kind, payload) {
  const validators = {
    [ObservationKind.COMMAND_EXIT_RESULT]: validateCommandExitPayload,
    [ObservationKind.FILE_EXISTENCE]: validateFileExistencePayload,
    [ObservationKind.FILE_CONTENT_HASH]: validateFileHashPayload,
    [ObservationKind.STRUCTURED_TEST_RESULT]: validateStructuredTestPayload,
    [ObservationKind.RUNTIME_READINESS_RESULT]: validateReadinessPayload,
    [ObservationKind.HTTP_RESPONSE_RESULT]: validateHttpResponsePayload,
    [ObservationKind.FILE_CONTENT]: validateFileContentPayload,
    [ObservationKind.FILE_LISTING]: validateFileListingPayload,
    [ObservationKind.WORK_UNIT_RESULT]: validateWorkUnitPayload,
    [ObservationKind.MODEL_CALL_RESULT]: validateModelCallPayload,
    [ObservationKind.RUNTIME_PROCESS_RESULT]: validateRuntimeProcessPayload,
    [ObservationKind.BROWSER_INTERACTION_RESULT]:
      validateBrowserInteractionPayload,
    [ObservationKind.BROWSER_ERROR_RESULT]: validateBrowserErrorPayload,
    [ObservationKind.REPAIR_DIAGNOSIS_RESULT]: validateRepairPayload,
    [ObservationKind.REPAIR_ATTEMPT_RESULT]: validateRepairPayload,
    [ObservationKind.REPAIR_FINDING]: validateRepairPayload,
  };
  validators[kind](payload);
}

export function computeEvidenceContentHash(payload, payloadReference) {
  return sha256(
    canonicalizeEvidenceValue({ payload, payloadReference }),
  );
}

export function computeEvidenceRecordHash(recordWithoutHash) {
  return sha256(canonicalizeEvidenceValue(recordWithoutHash));
}

export function normalizeEvidenceInput(input) {
  assertPlainObject(input, "evidence");
  assertIdentifier(input.evidenceId, "evidence.evidenceId");
  assertIdentifier(input.missionId, "evidence.missionId");
  if (!observationKindSet.has(input.kind)) {
    throw new EvidenceValidationError(
      `evidence.kind must be one of: ${OBSERVATION_KINDS.join(", ")}.`,
    );
  }
  assertNonEmptyString(input.captureMethod, "evidence.captureMethod");
  assertNonEmptyString(
    input.producingSubsystem,
    "evidence.producingSubsystem",
  );
  assertNonEmptyString(input.timestamp, "evidence.timestamp");
  if (Number.isNaN(Date.parse(input.timestamp))) {
    throw new EvidenceValidationError(
      "evidence.timestamp must be an ISO-compatible timestamp.",
    );
  }

  const hasPayload = input.payload !== undefined && input.payload !== null;
  const hasPayloadReference =
    input.payloadReference !== undefined && input.payloadReference !== null;
  if (hasPayload === hasPayloadReference) {
    throw new EvidenceValidationError(
      "Evidence must contain exactly one of payload or payloadReference.",
    );
  }

  const normalizedPayload = hasPayload
    ? normalizeJsonValue(input.payload, "evidence.payload")
    : null;
  const normalizedPayloadReference = hasPayloadReference
    ? input.payloadReference
    : null;
  if (normalizedPayloadReference !== null) {
    assertNonEmptyString(
      normalizedPayloadReference,
      "evidence.payloadReference",
    );
  }
  const metadata = normalizeJsonValue(input.metadata ?? {}, "evidence.metadata");
  assertPlainObject(metadata, "evidence.metadata");

  const sensitiveValues = normalizeSensitiveValues(input.sensitiveValues);
  const workspaceCheckpointReference = normalizeNullableReference(
    input.workspaceCheckpointReference,
    "evidence.workspaceCheckpointReference",
  );
  const obligationReference = normalizeNullableReference(
    input.obligationReference,
    "evidence.obligationReference",
  );
  const verificationRequestReference = normalizeNullableReference(
    input.verificationRequestReference,
    "evidence.verificationRequestReference",
  );
  const commandReference = normalizeNullableReference(
    input.commandReference,
    "evidence.commandReference",
  );
  const workUnitReference = normalizeNullableReference(
    input.workUnitReference,
    "evidence.workUnitReference",
  );
  for (const [label, value] of [
    ["evidence.evidenceId", input.evidenceId],
    ["evidence.missionId", input.missionId],
    ["evidence.timestamp", input.timestamp],
    [
      "evidence.workspaceCheckpointReference",
      workspaceCheckpointReference,
    ],
    ["evidence.obligationReference", obligationReference],
    [
      "evidence.verificationRequestReference",
      verificationRequestReference,
    ],
    ["evidence.commandReference", commandReference],
    ["evidence.workUnitReference", workUnitReference],
  ]) {
    if (
      value !== null &&
      sensitiveValues.some((sensitiveValue) => value.includes(sensitiveValue))
    ) {
      throw new EvidenceValidationError(
        `${label} must never contain a sensitive value.`,
      );
    }
  }

  const redactionState = { redacted: false };
  const payload = redactValue(
    normalizedPayload,
    sensitiveValues,
    redactionState,
  );
  const payloadReference = redactValue(
    normalizedPayloadReference,
    sensitiveValues,
    redactionState,
  );
  const redactedMetadata = redactValue(
    metadata,
    sensitiveValues,
    redactionState,
  );
  const captureMethod = redactValue(
    input.captureMethod.trim(),
    sensitiveValues,
    redactionState,
  );
  const producingSubsystem = redactValue(
    input.producingSubsystem.trim(),
    sensitiveValues,
    redactionState,
  );

  if (
    input.kind === ObservationKind.FILE_CONTENT &&
    redactionState.redacted &&
    typeof payload?.content === "string"
  ) {
    payload.contentHash = sha256(payload.content);
  }
  if (payload !== null) {
    validateObservationPayload(input.kind, payload);
  }

  const recordWithoutHashes = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    missionId: input.missionId,
    kind: input.kind,
    captureMethod,
    producingSubsystem,
    timestamp: input.timestamp,
    payload,
    payloadReference,
    redactionStatus: redactionState.redacted
      ? RedactionStatus.REDACTED
      : RedactionStatus.NOT_REDACTED,
    workspaceCheckpointReference,
    obligationReference,
    verificationRequestReference,
    commandReference,
    workUnitReference,
    metadata: redactedMetadata,
  };
  const contentHash = computeEvidenceContentHash(payload, payloadReference);
  const recordWithoutHash = { ...recordWithoutHashes, contentHash };
  return {
    ...recordWithoutHash,
    recordHash: computeEvidenceRecordHash(recordWithoutHash),
  };
}

export function validateEvidenceRecord(record, expectedEvidenceId = null) {
  try {
    assertExactKeys(record, RECORD_KEYS, "evidence record");
    if (record.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
      throw new EvidenceValidationError(
        `Unsupported evidence schema version ${record.schemaVersion}.`,
      );
    }
    if (
      expectedEvidenceId !== null &&
      record.evidenceId !== expectedEvidenceId
    ) {
      throw new EvidenceIntegrityError(
        expectedEvidenceId,
        "the file contains a different evidence ID",
      );
    }

    const normalized = normalizeEvidenceInput({
      evidenceId: record.evidenceId,
      missionId: record.missionId,
      kind: record.kind,
      captureMethod: record.captureMethod,
      producingSubsystem: record.producingSubsystem,
      timestamp: record.timestamp,
      payload: record.payload,
      payloadReference: record.payloadReference,
      workspaceCheckpointReference: record.workspaceCheckpointReference,
      obligationReference: record.obligationReference,
      verificationRequestReference: record.verificationRequestReference,
      commandReference: record.commandReference,
      workUnitReference: record.workUnitReference,
      metadata: record.metadata,
      sensitiveValues:
        record.redactionStatus === RedactionStatus.REDACTED
          ? [REDACTION_MARKER]
          : [],
    });
    if (normalized.redactionStatus !== record.redactionStatus) {
      throw new EvidenceIntegrityError(
        record.evidenceId,
        "redaction status is inconsistent with persisted content",
      );
    }
    if (
      computeEvidenceContentHash(record.payload, record.payloadReference) !==
      record.contentHash
    ) {
      throw new EvidenceIntegrityError(
        record.evidenceId,
        "the payload content hash does not match",
      );
    }
    const { recordHash, ...recordWithoutHash } = record;
    if (computeEvidenceRecordHash(recordWithoutHash) !== recordHash) {
      throw new EvidenceIntegrityError(
        record.evidenceId,
        "the full record hash does not match",
      );
    }
    return deepFreeze(structuredClone(record));
  } catch (error) {
    if (error instanceof EvidenceIntegrityError) {
      throw error;
    }
    if (error instanceof EvidenceValidationError) {
      throw new EvidenceIntegrityError(
        expectedEvidenceId ?? record?.evidenceId ?? "unknown",
        "the persisted record is malformed",
        { cause: error },
      );
    }
    throw error;
  }
}

export function freezeEvidenceRecord(record) {
  return deepFreeze(structuredClone(record));
}
