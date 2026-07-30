import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import {
  CheckpointAlreadyVerifiedError,
  CheckpointIntegrityError,
  CheckpointParentError,
  DuplicateCheckpointError,
  WorkspaceAlreadyExistsError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
} from "./errors.js";
import { isTerminalMissionState } from "./lifecycle.js";

export const WORKSPACE_FACT_EVENT = "WORKSPACE_FACT_RECORDED";
export const WORKSPACE_SERVICE_SOURCE = "WORKSPACE_SERVICE";

export const WorkspaceOperation = Object.freeze({
  PROVISIONED: "PROVISIONED",
  CHECKPOINT_CREATED: "CHECKPOINT_CREATED",
  CHECKPOINT_RESTORED: "CHECKPOINT_RESTORED",
  CHECKPOINT_VERIFIED: "CHECKPOINT_VERIFIED",
  WORKSPACE_RELEASED: "WORKSPACE_RELEASED",
});

export const CheckpointVerificationStatus = Object.freeze({
  UNVERIFIED: "UNVERIFIED",
  VERIFIED: "VERIFIED",
});

export const WorkspaceLifecycleStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  TERMINAL_RETAINED: "TERMINAL_RETAINED",
  RELEASED: "RELEASED",
});

export const WorkspaceRetentionState = Object.freeze({
  RETAINED: "RETAINED",
  VERIFIED_RETAINED: "VERIFIED_RETAINED",
  RELEASED: "RELEASED",
});

export const CHECKPOINT_SCHEMA_VERSION = 1;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const CHECKPOINT_KEYS = Object.freeze([
  "checkpointId",
  "contentHashes",
  "contentManifest",
  "creationTimestamp",
  "integrityHash",
  "manifestHash",
  "missionId",
  "parentCheckpointId",
  "reason",
  "schemaVersion",
  "verificationStatus",
  "workspaceId",
]);
const MANIFEST_ENTRY_KEYS = Object.freeze(["contentHash", "path", "size"]);
const CONTENT_HASH_KEYS = Object.freeze(["contentHash", "path"]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const operationSet = new Set(Object.values(WorkspaceOperation));
const FACT_KEYS = Object.freeze([
  "authorizationId",
  "checkpointId",
  "evidenceReferences",
  "operation",
  "parentCheckpointId",
  "preserveVerifiedCheckpoint",
  "reason",
  "rootPath",
  "workspaceId",
]);
const EVIDENCE_REFERENCE_KEYS = Object.freeze([
  "evidenceId",
  "workspaceCheckpointReference",
]);

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new WorkspaceValidationError(`${label} must be a plain object.`);
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
    throw new WorkspaceValidationError(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new WorkspaceValidationError(`${label} is malformed.`);
  }
}

function nullableIdentifier(value, label) {
  if (value === null) {
    return null;
  }
  assertIdentifier(value, label);
  return value;
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSafeManifestPath(value, label) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new WorkspaceValidationError(`${label} is not a safe relative path.`);
  }
}

function normalizeManifest(contentManifest) {
  if (!Array.isArray(contentManifest)) {
    throw new WorkspaceValidationError(
      "checkpoint.contentManifest must be an array.",
    );
  }
  const paths = new Set();
  const normalized = contentManifest.map((entry) => {
    assertExactKeys(entry, MANIFEST_ENTRY_KEYS, "checkpoint manifest entry");
    assertSafeManifestPath(entry.path, "checkpoint manifest path");
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new WorkspaceValidationError(
        "checkpoint manifest size must be a non-negative integer.",
      );
    }
    if (typeof entry.contentHash !== "string" ||
        !HASH_PATTERN.test(entry.contentHash)) {
      throw new WorkspaceValidationError(
        "checkpoint manifest contentHash must be SHA-256.",
      );
    }
    if (paths.has(entry.path)) {
      throw new WorkspaceValidationError(
        `Checkpoint manifest path "${entry.path}" is duplicated.`,
      );
    }
    paths.add(entry.path);
    return {
      path: entry.path,
      size: entry.size,
      contentHash: entry.contentHash,
    };
  });
  const sorted = [...normalized].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (
    normalized.some((entry, index) => entry.path !== sorted[index].path)
  ) {
    throw new WorkspaceValidationError(
      "checkpoint.contentManifest must be sorted by path.",
    );
  }
  return normalized;
}

export function computeCheckpointManifestHash(contentManifest) {
  return sha256(canonicalize(contentManifest));
}

export function computeCheckpointIntegrityHash(checkpointWithoutHash) {
  return sha256(canonicalize(checkpointWithoutHash));
}

export function createCheckpointRecord({
  checkpointId,
  workspaceId,
  missionId,
  parentCheckpointId,
  creationTimestamp,
  reason,
  contentManifest,
}) {
  assertIdentifier(checkpointId, "checkpoint.checkpointId");
  assertIdentifier(workspaceId, "checkpoint.workspaceId");
  assertIdentifier(missionId, "checkpoint.missionId");
  const parent = nullableIdentifier(
    parentCheckpointId,
    "checkpoint.parentCheckpointId",
  );
  if (
    typeof creationTimestamp !== "string" ||
    Number.isNaN(Date.parse(creationTimestamp))
  ) {
    throw new WorkspaceValidationError(
      "checkpoint.creationTimestamp must be an ISO-compatible timestamp.",
    );
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new WorkspaceValidationError(
      "checkpoint.reason must be non-empty.",
    );
  }
  const manifest = normalizeManifest(contentManifest);
  const contentHashes = manifest.map(({ path, contentHash }) => ({
    path,
    contentHash,
  }));
  const recordWithoutHash = {
    schemaVersion: CHECKPOINT_SCHEMA_VERSION,
    checkpointId,
    workspaceId,
    missionId,
    parentCheckpointId: parent,
    creationTimestamp,
    reason: reason.trim(),
    verificationStatus: CheckpointVerificationStatus.UNVERIFIED,
    contentManifest: manifest,
    contentHashes,
    manifestHash: computeCheckpointManifestHash(manifest),
  };
  return deepFreeze({
    ...recordWithoutHash,
    integrityHash: computeCheckpointIntegrityHash(recordWithoutHash),
  });
}

export function validateCheckpointRecord(record, expectedCheckpointId = null) {
  try {
    assertExactKeys(record, CHECKPOINT_KEYS, "checkpoint record");
    if (record.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) {
      throw new WorkspaceValidationError(
        "Unsupported checkpoint schema version.",
      );
    }
    if (
      expectedCheckpointId !== null &&
      record.checkpointId !== expectedCheckpointId
    ) {
      throw new WorkspaceValidationError(
        "Checkpoint file contains a different checkpoint ID.",
      );
    }
    if (
      record.verificationStatus !==
      CheckpointVerificationStatus.UNVERIFIED
    ) {
      throw new WorkspaceValidationError(
        "Persisted checkpoint verification status must remain UNVERIFIED; verification marks live in the Ledger.",
      );
    }
    const normalized = createCheckpointRecord({
      checkpointId: record.checkpointId,
      workspaceId: record.workspaceId,
      missionId: record.missionId,
      parentCheckpointId: record.parentCheckpointId,
      creationTimestamp: record.creationTimestamp,
      reason: record.reason,
      contentManifest: record.contentManifest,
    });
    if (
      canonicalize(record.contentHashes) !==
        canonicalize(normalized.contentHashes) ||
      record.manifestHash !== normalized.manifestHash ||
      record.integrityHash !== normalized.integrityHash
    ) {
      throw new WorkspaceValidationError(
        "Checkpoint hashes or integrity hash do not match.",
      );
    }
    for (const contentHash of record.contentHashes) {
      assertExactKeys(
        contentHash,
        CONTENT_HASH_KEYS,
        "checkpoint content hash",
      );
    }
    return deepFreeze(structuredClone(record));
  } catch (error) {
    if (error instanceof CheckpointIntegrityError) {
      throw error;
    }
    throw new CheckpointIntegrityError(
      expectedCheckpointId ?? record?.checkpointId ?? "unknown",
      error.message,
      { cause: error },
    );
  }
}

export function freezeWorkspaceValue(value) {
  return deepFreeze(structuredClone(value));
}

export function normalizeWorkspaceFact(fact) {
  assertExactKeys(fact, FACT_KEYS, "workspaceFact");
  if (!operationSet.has(fact.operation)) {
    throw new WorkspaceValidationError("workspaceFact.operation is invalid.");
  }
  assertIdentifier(fact.workspaceId, "workspaceFact.workspaceId");
  const checkpointId = nullableIdentifier(
    fact.checkpointId,
    "workspaceFact.checkpointId",
  );
  const parentCheckpointId = nullableIdentifier(
    fact.parentCheckpointId,
    "workspaceFact.parentCheckpointId",
  );
  const authorizationId = nullableIdentifier(
    fact.authorizationId,
    "workspaceFact.authorizationId",
  );
  if (typeof fact.reason !== "string" || fact.reason.trim().length === 0) {
    throw new WorkspaceValidationError(
      "workspaceFact.reason must be non-empty.",
    );
  }
  if (typeof fact.preserveVerifiedCheckpoint !== "boolean") {
    throw new WorkspaceValidationError(
      "workspaceFact.preserveVerifiedCheckpoint must be a boolean.",
    );
  }
  if (!Array.isArray(fact.evidenceReferences) ||
      fact.evidenceReferences.length === 0) {
    throw new WorkspaceValidationError(
      "Every workspace fact requires evidence.",
    );
  }
  const evidenceIds = new Set();
  const evidenceReferences = fact.evidenceReferences.map((reference) => {
    assertExactKeys(reference, EVIDENCE_REFERENCE_KEYS, "workspace evidence reference");
    assertIdentifier(reference.evidenceId, "workspace evidence ID");
    const checkpointReference = nullableIdentifier(
      reference.workspaceCheckpointReference,
      "workspace evidence checkpoint",
    );
    if (evidenceIds.has(reference.evidenceId)) {
      throw new WorkspaceValidationError(
        `Workspace evidence "${reference.evidenceId}" is duplicated.`,
      );
    }
    evidenceIds.add(reference.evidenceId);
    return {
      evidenceId: reference.evidenceId,
      workspaceCheckpointReference: checkpointReference,
    };
  });

  const rootPath = fact.rootPath;
  if (
    fact.operation === WorkspaceOperation.PROVISIONED &&
    (typeof rootPath !== "string" || !isAbsolute(rootPath))
  ) {
    throw new WorkspaceValidationError(
      "Provisioned workspace rootPath must be absolute.",
    );
  }
  if (
    fact.operation !== WorkspaceOperation.PROVISIONED &&
    rootPath !== null
  ) {
    throw new WorkspaceValidationError(
      "Only provisioning may record a workspace rootPath.",
    );
  }
  if (
    fact.operation === WorkspaceOperation.PROVISIONED &&
    (checkpointId === null || parentCheckpointId !== null)
  ) {
    throw new WorkspaceValidationError(
      "Provisioning requires a parentless baseline checkpoint.",
    );
  }
  if (
    fact.operation === WorkspaceOperation.CHECKPOINT_CREATED &&
    (checkpointId === null || parentCheckpointId === null)
  ) {
    throw new WorkspaceValidationError(
      "Checkpoint creation requires checkpoint and parent IDs.",
    );
  }
  if (
    (fact.operation === WorkspaceOperation.CHECKPOINT_RESTORED ||
      fact.operation === WorkspaceOperation.CHECKPOINT_VERIFIED ||
      fact.operation === WorkspaceOperation.WORKSPACE_RELEASED) &&
    checkpointId === null
  ) {
    throw new WorkspaceValidationError(
      `${fact.operation} requires a checkpoint ID.`,
    );
  }
  if (
    fact.operation !== WorkspaceOperation.CHECKPOINT_CREATED &&
    parentCheckpointId !== null
  ) {
    throw new WorkspaceValidationError(
      "Only checkpoint creation may record a parent checkpoint.",
    );
  }
  if (
    fact.operation === WorkspaceOperation.WORKSPACE_RELEASED
      ? authorizationId === null
      : authorizationId !== null
  ) {
    throw new WorkspaceValidationError(
      "Only release requires an authorization ID.",
    );
  }
  if (
    fact.operation !== WorkspaceOperation.WORKSPACE_RELEASED &&
    fact.preserveVerifiedCheckpoint
  ) {
    throw new WorkspaceValidationError(
      "Only release may preserve a verified checkpoint copy.",
    );
  }
  for (const reference of evidenceReferences) {
    if (reference.workspaceCheckpointReference !== checkpointId) {
      throw new WorkspaceValidationError(
        "Workspace evidence must cite the operation's exact checkpoint.",
      );
    }
  }

  return {
    operation: fact.operation,
    workspaceId: fact.workspaceId,
    checkpointId,
    parentCheckpointId,
    rootPath,
    reason: fact.reason.trim(),
    authorizationId,
    preserveVerifiedCheckpoint: fact.preserveVerifiedCheckpoint,
    evidenceReferences,
  };
}

export function projectWorkspace(records, missionId, missionState = null) {
  let workspace = null;
  const checkpointIds = new Set();
  const verifiedIds = new Set();

  for (const record of records) {
    if (record.type !== WORKSPACE_FACT_EVENT) {
      continue;
    }
    const fact = normalizeWorkspaceFact(record.workspaceFact);
    if (fact.operation === WorkspaceOperation.PROVISIONED) {
      if (workspace !== null) {
        throw new WorkspaceAlreadyExistsError(missionId);
      }
      workspace = {
        workspaceId: fact.workspaceId,
        missionId,
        rootPath: fact.rootPath,
        creationTimestamp: record.occurredAt,
        baselineCheckpointId: fact.checkpointId,
        currentCheckpointId: fact.checkpointId,
        checkpointChain: [fact.checkpointId],
        verifiedCheckpointIds: [],
        lifecycleStatus: WorkspaceLifecycleStatus.ACTIVE,
        retentionState: WorkspaceRetentionState.RETAINED,
        provisioningEvidenceReferences: fact.evidenceReferences,
      };
      checkpointIds.add(fact.checkpointId);
      continue;
    }
    if (workspace === null) {
      throw new WorkspaceNotFoundError(missionId);
    }
    if (workspace.workspaceId !== fact.workspaceId) {
      throw new WorkspaceValidationError(
        "A mission's workspace ID cannot change.",
      );
    }
    if (workspace.lifecycleStatus === WorkspaceLifecycleStatus.RELEASED) {
      throw new WorkspaceValidationError(
        "No workspace operation may follow release.",
      );
    }

    switch (fact.operation) {
      case WorkspaceOperation.CHECKPOINT_CREATED:
        if (checkpointIds.has(fact.checkpointId)) {
          throw new DuplicateCheckpointError(fact.checkpointId);
        }
        if (fact.parentCheckpointId !== workspace.currentCheckpointId) {
          throw new CheckpointParentError(
            fact.checkpointId,
            fact.parentCheckpointId,
          );
        }
        checkpointIds.add(fact.checkpointId);
        workspace.checkpointChain.push(fact.checkpointId);
        workspace.currentCheckpointId = fact.checkpointId;
        break;
      case WorkspaceOperation.CHECKPOINT_RESTORED:
        if (!checkpointIds.has(fact.checkpointId)) {
          throw new WorkspaceValidationError(
            `Cannot restore unknown checkpoint "${fact.checkpointId}".`,
          );
        }
        workspace.currentCheckpointId = fact.checkpointId;
        break;
      case WorkspaceOperation.CHECKPOINT_VERIFIED:
        if (!checkpointIds.has(fact.checkpointId)) {
          throw new WorkspaceValidationError(
            `Cannot verify unknown checkpoint "${fact.checkpointId}".`,
          );
        }
        if (verifiedIds.has(fact.checkpointId)) {
          throw new CheckpointAlreadyVerifiedError(fact.checkpointId);
        }
        verifiedIds.add(fact.checkpointId);
        workspace.verifiedCheckpointIds.push(fact.checkpointId);
        workspace.retentionState =
          WorkspaceRetentionState.VERIFIED_RETAINED;
        break;
      case WorkspaceOperation.WORKSPACE_RELEASED:
        if (fact.checkpointId !== workspace.currentCheckpointId) {
          throw new WorkspaceValidationError(
            "Release must cite the current checkpoint.",
          );
        }
        workspace.lifecycleStatus = WorkspaceLifecycleStatus.RELEASED;
        workspace.retentionState = WorkspaceRetentionState.RELEASED;
        break;
      default:
        throw new WorkspaceValidationError("Unsupported workspace operation.");
    }
  }

  if (
    workspace !== null &&
    workspace.lifecycleStatus !== WorkspaceLifecycleStatus.RELEASED &&
    missionState !== null &&
    isTerminalMissionState(missionState)
  ) {
    workspace.lifecycleStatus = WorkspaceLifecycleStatus.TERMINAL_RETAINED;
  }
  return workspace === null
    ? null
    : deepFreeze(structuredClone(workspace));
}
