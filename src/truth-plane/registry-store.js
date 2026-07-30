import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  DuplicateRegistryEventError,
  DuplicateStackVersionError,
  RegistryCorruptionError,
  StackCertificationError,
  StackSelectionValidationError,
  UnknownStackError,
} from "../domain/errors.js";
import {
  RegistryOperation,
  STACK_REGISTRY_SCHEMA_VERSION,
  StackCertificationStatus,
  StackSelectionMode,
  assertRegistryIdentifier,
  canonicalizeStackValue,
  evaluateStackEligibility,
  freezeStackValue,
  normalizeEnvironmentDetection,
  normalizeStackManifest,
} from "../domain/toolchain-stack.js";

const EVENT_KEYS = Object.freeze([
  "evidenceReference",
  "hash",
  "missionId",
  "occurredAt",
  "operation",
  "payload",
  "previousHash",
  "registryEventId",
  "schemaVersion",
  "sequence",
]);
const EVIDENCE_REFERENCE_KEYS = Object.freeze([
  "evidenceId",
  "workspaceCheckpointReference",
]);
const CERTIFICATION_KEYS = Object.freeze([
  "certificationBasis",
  "newStatus",
  "previousStatus",
  "reason",
  "stackId",
  "stackVersion",
  "validUntil",
]);
const SELECTION_KEYS = Object.freeze([
  "environmentCheckId",
  "rationale",
  "requiredCapabilities",
  "requestedPlatform",
  "selectionId",
  "selectionMode",
  "stackId",
  "stackVersion",
]);
const operationSet = new Set(Object.values(RegistryOperation));
const statusSet = new Set(Object.values(StackCertificationStatus));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hasExactKeys(value, expectedKeys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function assertTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new RegistryCorruptionError(
      `${label} must be an ISO-compatible timestamp`,
    );
  }
}

function stackKey(stackId, stackVersion) {
  return `${stackId}\u0000${stackVersion}`;
}

function decorateStack(stack, asOf) {
  assertTimestamp(asOf, "registry projection time");
  const stale =
    stack.declaredCertificationStatus ===
      StackCertificationStatus.CERTIFIED &&
    stack.certificationValidUntil !== null &&
    Date.parse(asOf) >= Date.parse(stack.certificationValidUntil);
  return freezeStackValue({
    ...stack,
    certificationStatus: stale
      ? StackCertificationStatus.DECERTIFIED
      : stack.declaredCertificationStatus,
    certificationStale: stale,
  });
}

function normalizeEvidenceReference(reference) {
  if (!hasExactKeys(reference, EVIDENCE_REFERENCE_KEYS)) {
    throw new RegistryCorruptionError(
      "registry evidence reference has an invalid shape",
    );
  }
  assertRegistryIdentifier(reference.evidenceId, "registry evidenceId");
  if (
    reference.workspaceCheckpointReference !== null &&
    reference.workspaceCheckpointReference !== undefined
  ) {
    assertRegistryIdentifier(
      reference.workspaceCheckpointReference,
      "registry workspace checkpoint reference",
    );
  }
  return {
    evidenceId: reference.evidenceId,
    workspaceCheckpointReference:
      reference.workspaceCheckpointReference ?? null,
  };
}

function normalizeCertificationPayload(payload) {
  if (!hasExactKeys(payload, CERTIFICATION_KEYS)) {
    throw new StackCertificationError(
      `Certification change must contain exactly: ${CERTIFICATION_KEYS.join(", ")}.`,
    );
  }
  assertRegistryIdentifier(payload.stackId, "certification stackId");
  assertRegistryIdentifier(payload.stackVersion, "certification stackVersion");
  if (
    !statusSet.has(payload.previousStatus) ||
    !statusSet.has(payload.newStatus) ||
    payload.newStatus === StackCertificationStatus.UNREGISTERED
  ) {
    throw new StackCertificationError(
      "Certification change contains an invalid status.",
    );
  }
  if (payload.previousStatus === payload.newStatus) {
    throw new StackCertificationError(
      "Certification change must change the declared status.",
    );
  }
  if (typeof payload.reason !== "string" || payload.reason.trim().length === 0) {
    throw new StackCertificationError(
      "Certification change reason must be non-empty.",
    );
  }
  if (
    typeof payload.certificationBasis !== "string" ||
    payload.certificationBasis.trim().length === 0
  ) {
    throw new StackCertificationError(
      "Certification basis must be non-empty.",
    );
  }
  if (payload.newStatus === StackCertificationStatus.CERTIFIED) {
    assertTimestamp(payload.validUntil, "certification validUntil");
  } else if (payload.validUntil !== null) {
    throw new StackCertificationError(
      "Only CERTIFIED status may have a validUntil timestamp.",
    );
  }
  return {
    stackId: payload.stackId,
    stackVersion: payload.stackVersion,
    previousStatus: payload.previousStatus,
    newStatus: payload.newStatus,
    reason: payload.reason.trim(),
    validUntil: payload.validUntil,
    certificationBasis: payload.certificationBasis.trim(),
  };
}

function normalizeSelectionPayload(payload) {
  if (!hasExactKeys(payload, SELECTION_KEYS)) {
    throw new StackSelectionValidationError(
      `Stack selection must contain exactly: ${SELECTION_KEYS.join(", ")}.`,
    );
  }
  for (const [label, value] of [
    ["selectionId", payload.selectionId],
    ["stackId", payload.stackId],
    ["stackVersion", payload.stackVersion],
    ["environmentCheckId", payload.environmentCheckId],
  ]) {
    assertRegistryIdentifier(value, `selection ${label}`);
  }
  if (
    typeof payload.requestedPlatform !== "string" ||
    payload.requestedPlatform.trim().length === 0
  ) {
    throw new StackSelectionValidationError(
      "Selection requestedPlatform must be non-empty.",
    );
  }
  if (!Object.values(StackSelectionMode).includes(payload.selectionMode)) {
    throw new StackSelectionValidationError(
      "Selection selectionMode is invalid.",
    );
  }
  for (const [label, values] of [
    ["requiredCapabilities", payload.requiredCapabilities],
    ["rationale", payload.rationale],
  ]) {
    if (
      !Array.isArray(values) ||
      values.some(
        (value) => typeof value !== "string" || value.trim().length === 0,
      )
    ) {
      throw new StackSelectionValidationError(
        `Selection ${label} must be an array of non-empty strings.`,
      );
    }
  }
  const requiredCapabilities = payload.requiredCapabilities.map((value) =>
    value.trim(),
  );
  const sorted = [...requiredCapabilities].sort();
  if (
    new Set(requiredCapabilities).size !== requiredCapabilities.length ||
    requiredCapabilities.some((value, index) => value !== sorted[index])
  ) {
    throw new StackSelectionValidationError(
      "Selection requiredCapabilities must be unique and sorted.",
    );
  }
  return {
    selectionId: payload.selectionId,
    selectionMode: payload.selectionMode,
    stackId: payload.stackId,
    stackVersion: payload.stackVersion,
    environmentCheckId: payload.environmentCheckId,
    requestedPlatform: payload.requestedPlatform.trim().toLowerCase(),
    requiredCapabilities,
    rationale: payload.rationale.map((value) => value.trim()),
  };
}

function projectRegistry(records, asOf) {
  const stacks = new Map();
  const environmentChecks = new Map();
  const selections = new Map();

  for (const record of records) {
    switch (record.operation) {
      case RegistryOperation.STACK_REGISTERED: {
        const manifest = normalizeStackManifest(record.payload);
        const key = stackKey(manifest.stackId, manifest.stackVersion);
        if (stacks.has(key)) {
          throw new DuplicateStackVersionError(
            manifest.stackId,
            manifest.stackVersion,
          );
        }
        stacks.set(key, {
          manifest,
          registeredAt: record.occurredAt,
          registrationMissionId: record.missionId,
          registrationEvidenceReference: record.evidenceReference,
          declaredCertificationStatus: manifest.certificationStatus,
          certificationStatus: manifest.certificationStatus,
          certificationStale: false,
          certificationValidUntil: null,
          certificationHistory: [],
        });
        break;
      }
      case RegistryOperation.CERTIFICATION_CHANGED: {
        const change = normalizeCertificationPayload(record.payload);
        const key = stackKey(change.stackId, change.stackVersion);
        const stack = stacks.get(key);
        if (stack === undefined) {
          throw new UnknownStackError(change.stackId, change.stackVersion);
        }
        if (stack.declaredCertificationStatus !== change.previousStatus) {
          throw new StackCertificationError(
            "Certification history does not continue from the replayed status.",
          );
        }
        if (
          change.newStatus === StackCertificationStatus.CERTIFIED &&
          Date.parse(change.validUntil) <= Date.parse(record.occurredAt)
        ) {
          throw new StackCertificationError(
            "Certification validUntil must be later than certification time.",
          );
        }
        stack.declaredCertificationStatus = change.newStatus;
        stack.certificationStatus = change.newStatus;
        stack.certificationStale = false;
        stack.certificationValidUntil = change.validUntil;
        stack.certificationHistory.push({
          registryEventId: record.registryEventId,
          missionId: record.missionId,
          occurredAt: record.occurredAt,
          evidenceReference: record.evidenceReference,
          ...change,
        });
        break;
      }
      case RegistryOperation.ENVIRONMENT_CHECKED: {
        const environment = normalizeEnvironmentDetection(record.payload);
        if (environment.missionId !== record.missionId) {
          throw new RegistryCorruptionError(
            "environment check belongs to another mission",
          );
        }
        if (environmentChecks.has(environment.environmentCheckId)) {
          throw new RegistryCorruptionError(
            `environment check "${environment.environmentCheckId}" is duplicated`,
          );
        }
        environmentChecks.set(environment.environmentCheckId, {
          ...environment,
          registryEventId: record.registryEventId,
          evidenceReference: record.evidenceReference,
        });
        break;
      }
      case RegistryOperation.STACK_SELECTED: {
        const selection = normalizeSelectionPayload(record.payload);
        if (selections.has(selection.selectionId)) {
          throw new StackSelectionValidationError(
            `Selection "${selection.selectionId}" is duplicated.`,
          );
        }
        const stack = stacks.get(
          stackKey(selection.stackId, selection.stackVersion),
        );
        if (stack === undefined) {
          throw new UnknownStackError(
            selection.stackId,
            selection.stackVersion,
          );
        }
        const environment = environmentChecks.get(
          selection.environmentCheckId,
        );
        if (
          environment === undefined ||
          environment.missionId !== record.missionId
        ) {
          throw new StackSelectionValidationError(
            "Selection environment check is missing or belongs to another mission.",
          );
        }
        const effectiveStack = decorateStack(stack, record.occurredAt);
        const statusAllowed =
          selection.selectionMode === StackSelectionMode.PRODUCTION
            ? effectiveStack.certificationStatus ===
              StackCertificationStatus.CERTIFIED
            : effectiveStack.certificationStatus ===
              StackCertificationStatus.PROVISIONAL;
        if (!statusAllowed) {
          throw new StackSelectionValidationError(
            "Persisted selection cites a stack with an invalid certification status for its mode.",
          );
        }
        const eligibility = evaluateStackEligibility({
          stack: effectiveStack,
          requestedPlatform: selection.requestedPlatform,
          requiredCapabilities: selection.requiredCapabilities,
          environment,
          asOf: record.occurredAt,
          selectionMode: selection.selectionMode,
        });
        if (
          canonicalizeStackValue(selection.rationale) !==
          canonicalizeStackValue(eligibility.rationale)
        ) {
          throw new StackSelectionValidationError(
            "Persisted selection rationale is not deterministic.",
          );
        }
        selections.set(selection.selectionId, {
          ...selection,
          missionId: record.missionId,
          selectedAt: record.occurredAt,
          registryEventId: record.registryEventId,
          evidenceReference: record.evidenceReference,
        });
        break;
      }
      default:
        throw new RegistryCorruptionError(
          `unsupported operation "${record.operation}"`,
        );
    }
  }

  return {
    stacks: new Map(
      [...stacks].map(([key, stack]) => [key, decorateStack(stack, asOf)]),
    ),
    environmentChecks: new Map(
      [...environmentChecks].map(([key, value]) => [
        key,
        freezeStackValue(value),
      ]),
    ),
    selections: new Map(
      [...selections].map(([key, value]) => [
        key,
        freezeStackValue(value),
      ]),
    ),
  };
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function createRegistryStore({
  registryDirectory,
  validateEvidenceReference,
  clock,
}) {
  const root = resolve(registryDirectory);
  const registryPath = resolve(root, "registry-events.jsonl");
  const lockPath = `${registryPath}.lock`;

  function readRecords() {
    if (!existsSync(registryPath)) {
      return [];
    }
    const text = readFileSync(registryPath, "utf8");
    if (text.length === 0) {
      throw new RegistryCorruptionError("registry event log is empty");
    }
    const lines = text.endsWith("\n")
      ? text.slice(0, -1).split("\n")
      : text.split("\n");
    let records;
    try {
      records = lines.map((line) => JSON.parse(line));
    } catch (error) {
      throw new RegistryCorruptionError(
        "registry event log is not valid JSON Lines",
        { cause: error },
      );
    }
    let previousHash = null;
    let previousTimestamp = null;
    const eventIds = new Set();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!hasExactKeys(record, EVENT_KEYS)) {
        throw new RegistryCorruptionError(
          `record ${index + 1} has an unexpected shape`,
        );
      }
      if (
        record.schemaVersion !== STACK_REGISTRY_SCHEMA_VERSION ||
        record.sequence !== index + 1 ||
        !operationSet.has(record.operation)
      ) {
        throw new RegistryCorruptionError(
          `record ${index + 1} has invalid attribution`,
        );
      }
      assertRegistryIdentifier(
        record.registryEventId,
        "registryEventId",
      );
      assertRegistryIdentifier(record.missionId, "registry missionId");
      assertTimestamp(record.occurredAt, "registry occurredAt");
      if (
        previousTimestamp !== null &&
        Date.parse(record.occurredAt) < Date.parse(previousTimestamp)
      ) {
        throw new RegistryCorruptionError(
          `record ${index + 1} is chronologically earlier than its predecessor`,
        );
      }
      if (eventIds.has(record.registryEventId)) {
        throw new RegistryCorruptionError(
          `registry event "${record.registryEventId}" is duplicated`,
        );
      }
      eventIds.add(record.registryEventId);
      if (record.previousHash !== previousHash) {
        throw new RegistryCorruptionError(
          `record ${index + 1} breaks the hash chain`,
        );
      }
      const { hash, ...withoutHash } = record;
      if (
        typeof hash !== "string" ||
        hash !== sha256(canonicalizeStackValue(withoutHash))
      ) {
        throw new RegistryCorruptionError(
          `record ${index + 1} failed its integrity check`,
        );
      }
      const evidenceReference = normalizeEvidenceReference(
        record.evidenceReference,
      );
      try {
        validateEvidenceReference({
          evidenceId: evidenceReference.evidenceId,
          missionId: record.missionId,
          workspaceCheckpointReference:
            evidenceReference.workspaceCheckpointReference,
          workUnitReference: null,
        });
      } catch (error) {
        throw new RegistryCorruptionError(
          `record ${index + 1} has invalid evidence`,
          { cause: error },
        );
      }
      previousHash = hash;
      previousTimestamp = record.occurredAt;
    }
    try {
      projectRegistry(records, clock());
    } catch (error) {
      if (error instanceof RegistryCorruptionError) {
        throw error;
      }
      throw new RegistryCorruptionError(
        "registry event history cannot be replayed",
        { cause: error },
      );
    }
    return records;
  }

  function acquireLock() {
    mkdirSync(root, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = openSync(lockPath, "wx");
        try {
          writeFileSync(descriptor, String(process.pid), "utf8");
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        return;
      } catch (error) {
        if (error?.code !== "EEXIST" || attempt > 0) {
          throw error;
        }
        let pid = null;
        try {
          pid = Number(readFileSync(lockPath, "utf8"));
        } catch {
          pid = null;
        }
        if (isProcessAlive(pid)) {
          throw error;
        }
        unlinkSync(lockPath);
      }
    }
  }

  function appendEvent({
    registryEventId,
    missionId,
    occurredAt,
    operation,
    evidenceReference,
    payload,
  }) {
    assertRegistryIdentifier(registryEventId, "registryEventId");
    assertRegistryIdentifier(missionId, "registry missionId");
    assertTimestamp(occurredAt, "registry occurredAt");
    if (!operationSet.has(operation)) {
      throw new RegistryCorruptionError("registry operation is invalid");
    }
    const normalizedReference = normalizeEvidenceReference(evidenceReference);
    validateEvidenceReference({
      evidenceId: normalizedReference.evidenceId,
      missionId,
      workspaceCheckpointReference:
        normalizedReference.workspaceCheckpointReference,
      workUnitReference: null,
    });

    acquireLock();
    try {
      const records = readRecords();
      if (
        records.length > 0 &&
        Date.parse(occurredAt) < Date.parse(records.at(-1).occurredAt)
      ) {
        throw new RegistryCorruptionError(
          "new registry event is chronologically earlier than the current tail",
        );
      }
      const existing = records.find(
        (record) => record.registryEventId === registryEventId,
      );
      if (existing !== undefined) {
        const expected = {
          missionId,
          occurredAt,
          operation,
          evidenceReference: normalizedReference,
          payload,
        };
        const actual = {
          missionId: existing.missionId,
          occurredAt: existing.occurredAt,
          operation: existing.operation,
          evidenceReference: existing.evidenceReference,
          payload: existing.payload,
        };
        if (
          canonicalizeStackValue(actual) ===
          canonicalizeStackValue(expected)
        ) {
          return freezeStackValue(existing);
        }
        throw new DuplicateRegistryEventError(registryEventId);
      }

      const withoutHash = {
        schemaVersion: STACK_REGISTRY_SCHEMA_VERSION,
        registryEventId,
        sequence: records.length + 1,
        operation,
        missionId,
        occurredAt,
        evidenceReference: normalizedReference,
        payload: freezeStackValue(payload),
        previousHash: records.at(-1)?.hash ?? null,
      };
      const record = {
        ...withoutHash,
        hash: sha256(canonicalizeStackValue(withoutHash)),
      };
      const candidate = [...records, record];
      projectRegistry(candidate, occurredAt);
      const descriptor = openSync(registryPath, "a");
      try {
        appendFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return freezeStackValue(record);
    } finally {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    }
  }

  function projection(asOf = clock()) {
    return projectRegistry(readRecords(), asOf);
  }

  return Object.freeze({
    appendEvent,
    listEvents() {
      return freezeStackValue(readRecords());
    },
    getStack(stackId, stackVersion, asOf = clock()) {
      assertRegistryIdentifier(stackId, "stackId");
      assertRegistryIdentifier(stackVersion, "stackVersion");
      const stack = projection(asOf).stacks.get(
        stackKey(stackId, stackVersion),
      );
      if (stack === undefined) {
        throw new UnknownStackError(stackId, stackVersion);
      }
      return stack;
    },
    listStacks(asOf = clock()) {
      return freezeStackValue(
        [...projection(asOf).stacks.values()].sort((left, right) =>
          `${left.manifest.stackId}@${left.manifest.stackVersion}`.localeCompare(
            `${right.manifest.stackId}@${right.manifest.stackVersion}`,
          ),
        ),
      );
    },
    getEnvironmentCheck(environmentCheckId, asOf = clock()) {
      assertRegistryIdentifier(environmentCheckId, "environmentCheckId");
      return projection(asOf).environmentChecks.get(environmentCheckId) ?? null;
    },
    getSelection(selectionId, asOf = clock()) {
      assertRegistryIdentifier(selectionId, "selectionId");
      return projection(asOf).selections.get(selectionId) ?? null;
    },
    listSelections(asOf = clock()) {
      return freezeStackValue([...projection(asOf).selections.values()]);
    },
    path: registryPath,
  });
}
