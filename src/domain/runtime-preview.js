import {
  BrowserObservationError,
  RuntimeValidationError,
} from "./errors.js";
import {
  canonicalizeExecutionValue,
  freezeExecutionValue,
} from "./execution.js";

export const RUNTIME_PREVIEW_SOURCE = "RUNTIME_PREVIEW_SERVICE";

export const RuntimeStatus = Object.freeze({
  READY: "READY",
  STARTUP_FAILED: "STARTUP_FAILED",
  HEALTHY: "HEALTHY",
  CRASHED: "CRASHED",
  STOPPED: "STOPPED",
});

export const RuntimeEventType = Object.freeze({
  STARTUP: "STARTUP",
  HEALTH: "HEALTH",
  SHUTDOWN: "SHUTDOWN",
  BROWSER_OBSERVATION: "BROWSER_OBSERVATION",
});

// Browser checks are supplied by the project-specific verification plan.
// This empty compatibility export deliberately carries no domain vocabulary.
export const BROWSER_CHECKS = Object.freeze([]);

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const STATUS = new Set(Object.values(RuntimeStatus));
const EVENT_TYPES = new Set(Object.values(RuntimeEventType));
const KEYS = Object.freeze([
  "checkpointId",
  "completedAt",
  "evidenceReferences",
  "eventType",
  "idempotencyKey",
  "missionId",
  "observationId",
  "port",
  "previewUrl",
  "procedureName",
  "processId",
  "sessionId",
  "startedAt",
  "status",
  "workUnitReference",
  "workspaceId",
]);

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    throw new RuntimeValidationError(`${label} is malformed.`);
  }
}

function exact(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new RuntimeValidationError(`${label} must be a plain object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new RuntimeValidationError(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function timestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RuntimeValidationError(`${label} is not a timestamp.`);
  }
}

export function normalizeRuntimeRecord(input) {
  exact(input, KEYS, "runtime record");
  for (const [label, value] of [
    ["observationId", input.observationId],
    ["sessionId", input.sessionId],
    ["missionId", input.missionId],
    ["workspaceId", input.workspaceId],
    ["checkpointId", input.checkpointId],
    ["procedureName", input.procedureName],
    ["idempotencyKey", input.idempotencyKey],
    ["workUnitReference", input.workUnitReference],
  ]) {
    assertIdentifier(value, `runtime ${label}`);
  }
  if (!STATUS.has(input.status) || !EVENT_TYPES.has(input.eventType)) {
    throw new RuntimeValidationError(
      "runtime status or eventType is invalid.",
    );
  }
  if (
    !Number.isSafeInteger(input.port) ||
    input.port < 1 ||
    input.port > 65535 ||
    typeof input.previewUrl !== "string" ||
    input.previewUrl !== `http://127.0.0.1:${input.port}`
  ) {
    throw new RuntimeValidationError(
      "runtime port and previewUrl binding is invalid.",
    );
  }
  if (
    input.processId !== null &&
    (!Number.isSafeInteger(input.processId) || input.processId <= 0)
  ) {
    throw new RuntimeValidationError("runtime processId is invalid.");
  }
  timestamp(input.startedAt, "runtime startedAt");
  timestamp(input.completedAt, "runtime completedAt");
  if (Date.parse(input.completedAt) < Date.parse(input.startedAt)) {
    throw new RuntimeValidationError(
      "runtime completedAt precedes startedAt.",
    );
  }
  if (
    !Array.isArray(input.evidenceReferences) ||
    input.evidenceReferences.length === 0
  ) {
    throw new RuntimeValidationError(
      "runtime observations require evidence.",
    );
  }
  const ids = new Set();
  const evidenceReferences = input.evidenceReferences.map((reference) => {
    exact(
      reference,
      ["evidenceId", "workspaceCheckpointReference"],
      "runtime evidence reference",
    );
    assertIdentifier(reference.evidenceId, "runtime evidenceId");
    if (
      reference.workspaceCheckpointReference !== input.checkpointId ||
      ids.has(reference.evidenceId)
    ) {
      throw new RuntimeValidationError(
        "runtime evidence must be unique and bound to its checkpoint.",
      );
    }
    ids.add(reference.evidenceId);
    return { ...reference };
  });
  return freezeExecutionValue({ ...input, evidenceReferences });
}

export function projectRuntimeHistory(records, missionId) {
  const events = [];
  const observationIds = new Set();
  const startupKeys = new Set();
  for (const event of records) {
    const raw = event.fact?.metadata?.runtimeRecord;
    if (raw === undefined) {
      continue;
    }
    const record = normalizeRuntimeRecord(raw);
    if (
      event.source !== RUNTIME_PREVIEW_SOURCE ||
      record.missionId !== missionId ||
      event.fact.workUnitReference !== record.workUnitReference ||
      event.fact.workspaceCheckpointReference !== record.checkpointId ||
      canonicalizeExecutionValue(event.fact.evidenceReferences) !==
        canonicalizeExecutionValue(record.evidenceReferences)
    ) {
      throw new RuntimeValidationError(
        "runtime record is not bound to its authoritative fact.",
      );
    }
    if (observationIds.has(record.observationId)) {
      throw new RuntimeValidationError(
        "runtime replay contains a duplicate observation.",
      );
    }
    if (
      record.eventType === RuntimeEventType.STARTUP &&
      startupKeys.has(record.idempotencyKey)
    ) {
      throw new RuntimeValidationError(
        "runtime replay contains a duplicate startup key.",
      );
    }
    observationIds.add(record.observationId);
    if (record.eventType === RuntimeEventType.STARTUP) {
      startupKeys.add(record.idempotencyKey);
    }
    events.push(record);
  }
  return freezeExecutionValue(events);
}

export function parseBrowserResult(stdout, { allowEmptyChecks = false } = {}) {
  if (typeof stdout !== "string") {
    throw new BrowserObservationError(
      "Browser command stdout is unavailable.",
    );
  }
  const marker = "FOUNDRY_BROWSER_RESULT:";
  const line = stdout
    .split(/\r?\n/u)
    .map((entry) => entry.trimStart())
    .find((entry) => entry.startsWith(marker));
  if (line === undefined) {
    throw new BrowserObservationError(
      "Browser verification did not emit a structured result marker.",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(line.slice(marker.length));
  } catch (error) {
    throw new BrowserObservationError(
      "Browser result marker contains invalid JSON.",
      { cause: error },
    );
  }
  const hasDiagnostics = Object.hasOwn(parsed, "diagnostics");
  exact(
    parsed,
    [
      "captureProbeErrors",
      "checks",
      "consoleErrors",
      ...(hasDiagnostics ? ["diagnostics"] : []),
      "pageErrors",
    ],
    "browser result",
  );
  if (
    parsed.checks === null ||
    typeof parsed.checks !== "object" ||
    Array.isArray(parsed.checks) ||
    Object.getPrototypeOf(parsed.checks) !== Object.prototype
  ) {
    throw new BrowserObservationError(
      "Browser result checks must be a plain object.",
    );
  }
  const checkNames = Object.keys(parsed.checks);
  const diagnostics = hasDiagnostics ? parsed.diagnostics : {};
  const diagnosticsAreValid =
    diagnostics !== null &&
    typeof diagnostics === "object" &&
    !Array.isArray(diagnostics) &&
    Object.getPrototypeOf(diagnostics) === Object.prototype &&
    Object.entries(diagnostics).every(
      ([checkId, subchecks]) =>
        IDENTIFIER.test(checkId) &&
        subchecks !== null &&
        typeof subchecks === "object" &&
        !Array.isArray(subchecks) &&
        Object.getPrototypeOf(subchecks) === Object.prototype &&
        Object.entries(subchecks).every(
          ([name, passed]) => IDENTIFIER.test(name) && typeof passed === "boolean",
        ),
    );
  if (
    (!allowEmptyChecks && checkNames.length === 0) ||
    checkNames.some(
      (check) =>
        !IDENTIFIER.test(check) ||
        typeof parsed.checks[check] !== "boolean",
    ) ||
    !Array.isArray(parsed.consoleErrors) ||
    !Array.isArray(parsed.pageErrors) ||
    !Array.isArray(parsed.captureProbeErrors) ||
    !diagnosticsAreValid ||
    [
      ...parsed.captureProbeErrors,
      ...parsed.consoleErrors,
      ...parsed.pageErrors,
    ].some(
      (entry) => typeof entry !== "string",
    )
  ) {
    throw new BrowserObservationError(
      "Browser result contains malformed checks or errors.",
    );
  }
  return freezeExecutionValue({
    ...parsed,
    diagnostics: Object.fromEntries(
      Object.entries(diagnostics)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([checkId, subchecks]) => [
          checkId,
          Object.fromEntries(
            Object.entries(subchecks).sort(([left], [right]) =>
              left.localeCompare(right)
            ),
          ),
        ]),
    ),
    checks: Object.fromEntries(
      checkNames
        .sort((left, right) => left.localeCompare(right))
        .map((check) => [check, parsed.checks[check]]),
    ),
  });
}
