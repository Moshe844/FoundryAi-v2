import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  fsyncSync,
  statSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  ContractAlreadyExistsError,
  ContractNotFoundError,
  ContractRequiredError,
  ContractStateError,
  ContractValidationError,
  CompletionVerdictIntegrityError,
  CompletionVerdictRequiredError,
  DuplicateEventError,
  EvidenceReferenceError,
  IllegalTransitionError,
  InvalidInputError,
  LedgerBusyError,
  LedgerCorruptionError,
  MissionAlreadyExistsError,
  MissionNotFoundError,
  ResultFactValidationError,
  RepairValidationError,
  TerminalStateError,
  VerificationValidationError,
} from "../domain/errors.js";
import {
  MissionState,
  isLegalTransition,
  isMissionState,
  isTerminalMissionState,
} from "../domain/lifecycle.js";
import {
  CONTRACT_AMENDED_EVENT,
  CONTRACT_CREATED_EVENT,
  CONTRACT_SERVICE_SOURCE,
  applyContractAmendment,
  normalizeContractCreation,
  projectRequirementContract,
} from "../domain/requirement-contract.js";
import { createObservationEvidenceStore } from "../truth-plane/observation-evidence-store.js";
import { createWorkspaceStore } from "../truth-plane/workspace-store.js";
import { createRegistryStore } from "../truth-plane/registry-store.js";
import { createAiRegistryStore } from "../truth-plane/ai-registry-store.js";
import { createVerificationAuthority } from "../truth-plane/verification-authority.js";
import { createRequirementContractService } from "../understanding-plane/requirement-contract-service.js";
import { createProjectProfileService } from "../understanding-plane/project-profile-service.js";
import { createProjectUnderstandingService } from "../understanding-plane/project-understanding-service.js";
import { createApprovedProjectContractService } from "../understanding-plane/approved-project-contract-service.js";
import {
  createWorkspaceLedgerValidator,
  createWorkspaceService,
} from "../capability-plane/workspace-service.js";
import { createToolchainStackRegistry } from "../capability-plane/toolchain-stack-registry.js";
import { createEnvironmentService } from "../capability-plane/environment-service.js";
import { createAiProviderRegistry } from "../capability-plane/ai-provider-registry.js";
import { createExecutionEngine } from "../work-plane/execution-engine.js";
import {
  classifyModelRouteFailure,
  createModelGateway,
} from "../work-plane/model-gateway.js";
import {
  createContextBuilder,
  createModelRouter,
  createPromptBuilder,
} from "../work-plane/model-routing-foundation.js";
import { createModelResponseValidator } from "../work-plane/model-response-validator.js";
import { createRuntimePreviewService } from "../work-plane/runtime-preview-service.js";
import { createProductionMissionService } from "../work-plane/production-mission-service.js";
import { createDiagnosisRepairStrategist } from "../recovery-plane/diagnosis-repair-strategist.js";
import {
  EXECUTION_ENGINE_SOURCE,
  MODEL_GATEWAY_SOURCE,
  projectExecutionHistory,
} from "../domain/execution.js";
import {
  RUNTIME_PREVIEW_SOURCE,
  projectRuntimeHistory,
} from "../domain/runtime-preview.js";
import {
  DIAGNOSIS_REPAIR_SOURCE,
  RepairFindingType,
  projectRepairHistory,
} from "../domain/repair.js";
import {
  COMPLETION_VERDICT_EVENT,
  CompletionResult,
  VERIFICATION_AUTHORITY_SOURCE,
  acceptanceConditionIsCheckpointIndependent,
  evaluateAcceptanceCondition,
  normalizeAcceptanceCondition,
  validateCompletionVerdict,
} from "../domain/verification.js";
import {
  WORKSPACE_FACT_EVENT,
  WORKSPACE_SERVICE_SOURCE,
  normalizeWorkspaceFact,
  projectWorkspace,
} from "../domain/workspace.js";

const SCHEMA_VERSION = 1;
const TRANSITION_EVENT = "MISSION_TRANSITION";
export const RESULT_FACT_EVENT = "RESULT_FACT_RECORDED";
const ORCHESTRATOR_SOURCE = "MISSION_ORCHESTRATOR";
const MISSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,127})$/;
const REFERENCE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const TRANSITION_RECORD_KEYS = Object.freeze([
  "causationId",
  "eventId",
  "hash",
  "missionId",
  "occurredAt",
  "previousHash",
  "schemaVersion",
  "sequence",
  "source",
  "transition",
  "type",
]);
const CONTRACT_CREATED_RECORD_KEYS = Object.freeze([
  "causationId",
  "contract",
  "eventId",
  "hash",
  "missionId",
  "occurredAt",
  "previousHash",
  "schemaVersion",
  "sequence",
  "source",
  "type",
]);
const CONTRACT_AMENDED_RECORD_KEYS = Object.freeze([
  "amendment",
  "causationId",
  "eventId",
  "hash",
  "missionId",
  "occurredAt",
  "previousHash",
  "schemaVersion",
  "sequence",
  "source",
  "type",
]);
const RESULT_FACT_RECORD_KEYS = Object.freeze([
  "causationId",
  "eventId",
  "fact",
  "hash",
  "missionId",
  "occurredAt",
  "previousHash",
  "schemaVersion",
  "sequence",
  "source",
  "type",
]);
const COMPLETION_VERDICT_RECORD_KEYS = Object.freeze([
  "causationId",
  "completionVerdict",
  "eventId",
  "hash",
  "missionId",
  "occurredAt",
  "previousHash",
  "schemaVersion",
  "sequence",
  "source",
  "type",
]);
const WORKSPACE_FACT_RECORD_KEYS = Object.freeze([
  "causationId",
  "eventId",
  "hash",
  "missionId",
  "occurredAt",
  "previousHash",
  "schemaVersion",
  "sequence",
  "source",
  "type",
  "workspaceFact",
]);
const TRANSITION_KEYS = Object.freeze(["from", "reason", "to"]);
const RESULT_FACT_KEYS = Object.freeze([
  "evidenceReferences",
  "metadata",
  "resultBearing",
  "statement",
  "workUnitReference",
  "workspaceCheckpointReference",
]);
const EVIDENCE_REFERENCE_KEYS = Object.freeze([
  "evidenceId",
  "workspaceCheckpointReference",
]);

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InvalidInputError(`${fieldName} must be a non-empty string.`);
  }
}

function assertMissionId(missionId) {
  if (typeof missionId !== "string" || !MISSION_ID_PATTERN.test(missionId)) {
    throw new InvalidInputError(
      "missionId must be 1-128 characters using only letters, numbers, underscores, and hyphens.",
    );
  }
}

function assertOccurredAt(occurredAt) {
  assertNonEmptyString(occurredAt, "occurredAt");
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new InvalidInputError("occurredAt must be an ISO-compatible timestamp.");
  }
}

function assertNullableReference(value, fieldName, ErrorType) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || !REFERENCE_PATTERN.test(value)) {
    throw new ErrorType(
      `${fieldName} must be null or a 1-128 character identifier.`,
    );
  }
  return value;
}

function normalizeFactMetadata(value) {
  const seen = new Set();

  function normalize(entry, label) {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "boolean"
    ) {
      return entry;
    }
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        throw new ResultFactValidationError(
          `${label} contains a non-finite number.`,
        );
      }
      return entry;
    }
    if (Array.isArray(entry)) {
      if (seen.has(entry)) {
        throw new ResultFactValidationError(`${label} contains a cycle.`);
      }
      seen.add(entry);
      const result = entry.map((child, index) =>
        normalize(child, `${label}[${index}]`),
      );
      seen.delete(entry);
      return result;
    }
    if (
      typeof entry === "object" &&
      entry !== null &&
      Object.getPrototypeOf(entry) === Object.prototype
    ) {
      if (seen.has(entry)) {
        throw new ResultFactValidationError(`${label} contains a cycle.`);
      }
      seen.add(entry);
      const result = {};
      for (const [key, child] of Object.entries(entry)) {
        result[key] = normalize(child, `${label}.${key}`);
      }
      seen.delete(entry);
      return result;
    }
    throw new ResultFactValidationError(
      `${label} must contain only JSON-compatible values.`,
    );
  }

  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ResultFactValidationError(
      "fact.metadata must be a plain object.",
    );
  }
  return normalize(value, "fact.metadata");
}

function normalizeResultFact(fact) {
  if (
    fact === null ||
    typeof fact !== "object" ||
    Array.isArray(fact)
  ) {
    throw new ResultFactValidationError("fact must be an object.");
  }
  const actualKeys = Object.keys(fact).sort();
  if (
    actualKeys.length !== RESULT_FACT_KEYS.length ||
    actualKeys.some((key, index) => key !== RESULT_FACT_KEYS[index])
  ) {
    throw new ResultFactValidationError(
      `fact must contain exactly: ${RESULT_FACT_KEYS.join(", ")}.`,
    );
  }
  if (
    typeof fact.statement !== "string" ||
    fact.statement.trim().length === 0
  ) {
    throw new ResultFactValidationError(
      "fact.statement must be a non-empty string.",
    );
  }
  if (fact.resultBearing !== true) {
    throw new ResultFactValidationError(
      "A result fact must declare resultBearing as true.",
    );
  }
  if (
    !Array.isArray(fact.evidenceReferences) ||
    fact.evidenceReferences.length === 0
  ) {
    throw new ResultFactValidationError(
      "A result-bearing fact requires at least one evidence reference.",
    );
  }

  const workspaceCheckpointReference = assertNullableReference(
    fact.workspaceCheckpointReference,
    "fact.workspaceCheckpointReference",
    ResultFactValidationError,
  );
  const workUnitReference = assertNullableReference(
    fact.workUnitReference,
    "fact.workUnitReference",
    ResultFactValidationError,
  );
  const seenEvidenceIds = new Set();
  const evidenceReferences = fact.evidenceReferences.map(
    (reference, index) => {
      if (
        reference === null ||
        typeof reference !== "object" ||
        Array.isArray(reference) ||
        !hasExactKeys(reference, EVIDENCE_REFERENCE_KEYS)
      ) {
        throw new ResultFactValidationError(
          `fact.evidenceReferences[${index}] is malformed.`,
        );
      }
      if (
        typeof reference.evidenceId !== "string" ||
        !REFERENCE_PATTERN.test(reference.evidenceId)
      ) {
        throw new ResultFactValidationError(
          `fact.evidenceReferences[${index}].evidenceId is malformed.`,
        );
      }
      const referenceCheckpoint = assertNullableReference(
        reference.workspaceCheckpointReference,
        `fact.evidenceReferences[${index}].workspaceCheckpointReference`,
        ResultFactValidationError,
      );
      if (referenceCheckpoint !== workspaceCheckpointReference) {
        throw new ResultFactValidationError(
          "Every evidence reference must name the fact's exact checkpoint.",
        );
      }
      if (seenEvidenceIds.has(reference.evidenceId)) {
        throw new ResultFactValidationError(
          `Evidence "${reference.evidenceId}" is referenced more than once.`,
        );
      }
      seenEvidenceIds.add(reference.evidenceId);
      return {
        evidenceId: reference.evidenceId,
        workspaceCheckpointReference: referenceCheckpoint,
      };
    },
  );

  return {
    statement: fact.statement.trim(),
    resultBearing: true,
    evidenceReferences,
    workspaceCheckpointReference,
    workUnitReference,
    metadata: normalizeFactMetadata(fact.metadata),
  };
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

function computeRecordHash(recordWithoutHash) {
  return createHash("sha256")
    .update(canonicalize(recordWithoutHash))
    .digest("hex");
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

function hasExactKeys(value, expectedKeys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index])
  );
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function removeAbandonedLock(lockPath) {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    if (isProcessAlive(lock.pid)) {
      return false;
    }
    unlinkSync(lockPath);
    return true;
  } catch {
    return false;
  }
}

function acquireMissionLock(lockPath, missionId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx");
      writeFileSync(
        descriptor,
        `${JSON.stringify({
          pid: process.pid,
          token: randomUUID(),
          acquiredAt: new Date().toISOString(),
        })}\n`,
        "utf8",
      );
      fsyncSync(descriptor);
      closeSync(descriptor);
      return;
    } catch (error) {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
      if (
        error?.code === "EEXIST" &&
        attempt === 0 &&
        removeAbandonedLock(lockPath)
      ) {
        continue;
      }
      if (error?.code === "EEXIST") {
        throw new LedgerBusyError(missionId, { cause: error });
      }
      throw error;
    }
  }
}

function assertPersistedRecordShape(record, missionId, expectedSequence) {
  const expectedKeys =
    record?.type === TRANSITION_EVENT
      ? TRANSITION_RECORD_KEYS
      : record?.type === CONTRACT_CREATED_EVENT
        ? CONTRACT_CREATED_RECORD_KEYS
      : record?.type === CONTRACT_AMENDED_EVENT
          ? CONTRACT_AMENDED_RECORD_KEYS
          : record?.type === COMPLETION_VERDICT_EVENT
            ? COMPLETION_VERDICT_RECORD_KEYS
            : record?.type === WORKSPACE_FACT_EVENT
              ? WORKSPACE_FACT_RECORD_KEYS
          : record?.type === RESULT_FACT_EVENT
            ? RESULT_FACT_RECORD_KEYS
          : null;

  if (expectedKeys === null || !hasExactKeys(record, expectedKeys)) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} has an unexpected shape`,
    );
  }
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} has unsupported schema version`,
    );
  }
  if (record.missionId !== missionId) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} belongs to another mission`,
    );
  }
  if (record.sequence !== expectedSequence) {
    throw new LedgerCorruptionError(
      missionId,
      `expected sequence ${expectedSequence}, found ${record.sequence}`,
    );
  }
  const hasValidSource =
    (record.type === TRANSITION_EVENT &&
      record.source === ORCHESTRATOR_SOURCE) ||
    ((record.type === CONTRACT_CREATED_EVENT ||
      record.type === CONTRACT_AMENDED_EVENT) &&
      record.source === CONTRACT_SERVICE_SOURCE) ||
    (record.type === COMPLETION_VERDICT_EVENT &&
      record.source === VERIFICATION_AUTHORITY_SOURCE) ||
    (record.type === WORKSPACE_FACT_EVENT &&
      record.source === WORKSPACE_SERVICE_SOURCE) ||
    (record.type === RESULT_FACT_EVENT &&
      typeof record.source === "string" &&
      record.source.trim().length > 0);
  if (!hasValidSource) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} has an invalid event authority`,
    );
  }
  if (
    (record.type === TRANSITION_EVENT &&
      !hasExactKeys(record.transition, TRANSITION_KEYS)) ||
    (record.type === TRANSITION_EVENT &&
      ((record.transition.from !== null &&
        !isMissionState(record.transition.from)) ||
        !isMissionState(record.transition.to)))
  ) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} has an invalid transition`,
    );
  }
  if (
    typeof record.eventId !== "string" ||
    record.eventId.length === 0 ||
    typeof record.causationId !== "string" ||
    record.causationId.length === 0 ||
    (record.type === TRANSITION_EVENT &&
      (typeof record.transition.reason !== "string" ||
        record.transition.reason.length === 0)) ||
    typeof record.occurredAt !== "string" ||
    Number.isNaN(Date.parse(record.occurredAt))
  ) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} is missing required attribution`,
    );
  }
  if (
    record.previousHash !== null &&
    (typeof record.previousHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(record.previousHash))
  ) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} has an invalid previous hash`,
    );
  }
  if (typeof record.hash !== "string" || !/^[a-f0-9]{64}$/.test(record.hash)) {
    throw new LedgerCorruptionError(
      missionId,
      `record ${expectedSequence} has an invalid hash`,
    );
  }
}

function latestCompletionVerdict(records) {
  return records.findLast(
    (record) => record.type === COMPLETION_VERDICT_EVENT,
  )?.completionVerdict ?? null;
}

function latestUnconsumedRepairAdmission(records, missionId) {
  const index = records.findLastIndex(
    (record) => record.fact?.metadata?.repairAdmission !== undefined,
  );
  if (index < 0) {
    return null;
  }
  if (
    records.slice(index + 1).some(
      (record) =>
        record.transition?.from === MissionState.REPAIRING &&
        record.transition?.to === MissionState.EXECUTING,
    )
  ) {
    return null;
  }
  const admission = projectRepairHistory(
    records.slice(0, index + 1),
    missionId,
  ).admissions.at(-1);
  const workspace = projectWorkspace(
    records,
    missionId,
    MissionState.REPAIRING,
  );
  return admission?.preRepairCheckpoint === workspace?.currentCheckpointId
    ? admission
    : null;
}

function hasCurrentRepairFinding(records, missionId, findingType) {
  const history = projectRepairHistory(records, missionId);
  const finding = history.findings.at(-1);
  return finding?.findingType === findingType;
}

function validateRepairTerminalTransition(records, missionId, from, to) {
  if (from !== MissionState.REPAIRING) {
    return;
  }
  const requiredFinding = new Map([
    [MissionState.FAILED, RepairFindingType.STRATEGIES_EXHAUSTED],
    [MissionState.BLOCKED, RepairFindingType.EXTERNAL_BLOCKER],
    [MissionState.EXHAUSTED, RepairFindingType.BUDGET_EXHAUSTED],
  ]).get(to);
  if (
    requiredFinding !== undefined &&
    !hasCurrentRepairFinding(records, missionId, requiredFinding)
  ) {
    throw new RepairValidationError(
      `REPAIRING to ${to} requires a current ${requiredFinding} finding.`,
    );
  }
}

function validateCompletionEvidence({
  completionVerdict,
  contract,
  missionId,
  getEvidenceById,
  workspaceLedgerValidator,
  workspaceRecords,
}) {
  validateCompletionVerdict(completionVerdict, { missionId, contract });
  workspaceLedgerValidator.validateCheckpointReference({
    records: workspaceRecords,
    missionId,
    checkpointId: completionVerdict.workspaceCheckpointReference,
    requireCurrent: true,
  });
  const obligations = new Map(
    contract.obligations.map((obligation) => [
      obligation.obligationId,
      obligation,
    ]),
  );

  for (const obligationVerdict of completionVerdict.obligationVerdicts) {
    const obligation = obligations.get(obligationVerdict.obligationId);
    const checkpointIndependent =
      acceptanceConditionIsCheckpointIndependent(
        obligation.acceptanceCondition,
      );
    const records = obligationVerdict.evidenceReferences.map((reference) => {
      let evidenceRecord;
      try {
        evidenceRecord = getEvidenceById(reference.evidenceId);
      } catch (error) {
        throw new EvidenceReferenceError(
          `Completion Verdict references missing or invalid evidence "${reference.evidenceId}".`,
          reference.evidenceId,
          { cause: error },
        );
      }
      if (evidenceRecord.missionId !== missionId) {
        throw new EvidenceReferenceError(
          `Evidence "${reference.evidenceId}" belongs to another mission.`,
          reference.evidenceId,
        );
      }
      const directlyBound =
        evidenceRecord.obligationReference === obligation.obligationId;
      const requestBound =
        reference.verificationRequestReference !== null &&
        evidenceRecord.verificationRequestReference ===
          reference.verificationRequestReference;
      const evidenceBoundObligation = obligations.get(
        evidenceRecord.obligationReference,
      );
      const equivalentObligationBound =
        evidenceBoundObligation !== undefined &&
        JSON.stringify(
          normalizeAcceptanceCondition(
            evidenceBoundObligation.acceptanceCondition,
          ),
        ) ===
          JSON.stringify(
            normalizeAcceptanceCondition(obligation.acceptanceCondition),
          ) &&
        JSON.stringify(
          [...evidenceBoundObligation.requiredEvidenceKinds].sort(),
        ) ===
          JSON.stringify([...obligation.requiredEvidenceKinds].sort());
      if (!directlyBound && !requestBound && !equivalentObligationBound) {
        throw new EvidenceReferenceError(
          `Evidence "${reference.evidenceId}" is not bound to its obligation or verification request.`,
          reference.evidenceId,
        );
      }
      if (!obligation.requiredEvidenceKinds.includes(evidenceRecord.kind)) {
        throw new EvidenceReferenceError(
          `Evidence "${reference.evidenceId}" has the wrong kind for obligation "${obligation.obligationId}".`,
          reference.evidenceId,
        );
      }
      if (
        evidenceRecord.workspaceCheckpointReference !==
          reference.workspaceCheckpointReference ||
        (!checkpointIndependent &&
          evidenceRecord.workspaceCheckpointReference !==
            completionVerdict.workspaceCheckpointReference)
      ) {
        throw new EvidenceReferenceError(
          `Evidence "${reference.evidenceId}" has an invalid checkpoint binding.`,
          reference.evidenceId,
        );
      }
      workspaceLedgerValidator.validateCheckpointReference({
        records: workspaceRecords,
        missionId,
        checkpointId: evidenceRecord.workspaceCheckpointReference,
        requireCurrent: !checkpointIndependent,
      });
      return evidenceRecord;
    });

    const evaluation = evaluateAcceptanceCondition(
      obligation.acceptanceCondition,
      records,
    );
    const availableKinds = new Set(records.map((record) => record.kind));
    const missingKinds = obligation.requiredEvidenceKinds.filter(
      (kind) => !availableKinds.has(kind),
    );
    const expectedResult =
      missingKinds.length > 0 ? "UNVERIFIABLE" : evaluation.result;
    const expectedDetail =
      missingKinds.length > 0
        ? `Required evidence kind(s) unavailable: ${missingKinds.join(", ")}.`
        : evaluation.detail;
    if (
      obligationVerdict.result !== expectedResult ||
      (expectedResult === "NOT_SATISFIED" &&
        obligationVerdict.deficiency !== expectedDetail) ||
      (expectedResult === "UNVERIFIABLE" &&
        obligationVerdict.unverifiableCondition !== expectedDetail)
    ) {
      throw new CompletionVerdictIntegrityError(
        `Obligation "${obligation.obligationId}" verdict is not supported by its evidence.`,
      );
    }
  }
}

function validateAndReplay(
  records,
  missionId,
  validateEvidenceReference,
  getEvidenceById,
  workspaceLedgerValidator,
) {
  let state = null;
  let previousHash = null;
  const eventIds = new Set();
  const verdictIds = new Set();
  let contractCreated = false;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const sequence = index + 1;
    assertPersistedRecordShape(record, missionId, sequence);

    if (eventIds.has(record.eventId)) {
      throw new LedgerCorruptionError(
        missionId,
        `event "${record.eventId}" appears more than once`,
      );
    }
    eventIds.add(record.eventId);

    if (record.previousHash !== previousHash) {
      throw new LedgerCorruptionError(
        missionId,
        `record ${sequence} breaks the hash chain`,
      );
    }

    const { hash, ...recordWithoutHash } = record;
    if (computeRecordHash(recordWithoutHash) !== hash) {
      throw new LedgerCorruptionError(
        missionId,
        `record ${sequence} failed its integrity check`,
      );
    }

    if (record.type === TRANSITION_EVENT) {
      if (record.transition.from !== state) {
        throw new LedgerCorruptionError(
          missionId,
          `record ${sequence} does not continue from the replayed state`,
        );
      }

      if (state === null) {
        if (record.transition.to !== MissionState.INTAKE) {
          throw new LedgerCorruptionError(
            missionId,
            "the first transition must initialize the mission in INTAKE",
          );
        }
      } else if (
        isTerminalMissionState(state) ||
        !isLegalTransition(state, record.transition.to)
      ) {
        throw new LedgerCorruptionError(
          missionId,
          `record ${sequence} contains an illegal transition`,
        );
      }
      if (
        record.transition.to === MissionState.CONTRACTED &&
        !contractCreated
      ) {
        throw new LedgerCorruptionError(
          missionId,
          "CONTRACTED is unreachable without a recorded Requirement Contract",
        );
      }
      if (
        state === MissionState.VERIFYING &&
        (record.transition.to === MissionState.SUCCEEDED ||
          record.transition.to === MissionState.REPAIRING)
      ) {
        const verdict = latestCompletionVerdict(records.slice(0, index));
        const requiredResult =
          record.transition.to === MissionState.SUCCEEDED
            ? CompletionResult.COMPLETE
            : CompletionResult.INCOMPLETE;
        const contract = projectRequirementContract(
          records.slice(0, index),
          missionId,
        );
        if (
          verdict === null ||
          verdict.overallResult !== requiredResult ||
          contract === null ||
          verdict.contractVersion !== contract.contractVersion
        ) {
          throw new LedgerCorruptionError(
            missionId,
            `${record.transition.to} requires a current ${requiredResult} Completion Verdict`,
          );
        }
      }
      if (
        state === MissionState.REPAIRING &&
        record.transition.to === MissionState.EXECUTING &&
        latestUnconsumedRepairAdmission(
          records.slice(0, index),
          missionId,
        ) === null
      ) {
        throw new LedgerCorruptionError(
          missionId,
          "REPAIRING to EXECUTING requires an unconsumed novel repair strategy",
        );
      }
      try {
        validateRepairTerminalTransition(
          records.slice(0, index),
          missionId,
          state,
          record.transition.to,
        );
      } catch (error) {
        throw new LedgerCorruptionError(
          missionId,
          error.message,
          { cause: error },
        );
      }
      if (
        state === MissionState.PROVISIONING &&
        record.transition.to === MissionState.EXECUTING
      ) {
        try {
          workspaceLedgerValidator.validateProvisioning(
            records.slice(0, index),
            missionId,
            {
              requireLiveWorkspace: false,
            },
          );
        } catch (error) {
          throw new LedgerCorruptionError(
            missionId,
            "EXECUTING requires a valid provisioned workspace, baseline checkpoint, and provisioning evidence",
            { cause: error },
          );
        }
      }
      state = record.transition.to;
    } else {
      if (state === null) {
        throw new LedgerCorruptionError(
          missionId,
          `record ${sequence} precedes mission creation`,
        );
      }
      if (
        record.type === CONTRACT_CREATED_EVENT &&
        state !== MissionState.INTAKE
      ) {
        throw new LedgerCorruptionError(
          missionId,
          "a Requirement Contract may only be created during INTAKE",
        );
      }
      if (
        record.type === CONTRACT_AMENDED_EVENT &&
        isTerminalMissionState(state)
      ) {
        throw new LedgerCorruptionError(
          missionId,
          "a terminal mission cannot amend its Requirement Contract",
        );
      }
      if (
        record.type === CONTRACT_AMENDED_EVENT &&
        record.amendment.timestamp !== record.occurredAt
      ) {
        throw new LedgerCorruptionError(
          missionId,
          "a contract amendment timestamp must match its Ledger attribution timestamp",
        );
      }
      if (record.type === CONTRACT_CREATED_EVENT) {
        contractCreated = true;
      }
      if (record.type === COMPLETION_VERDICT_EVENT) {
        if (state !== MissionState.VERIFYING) {
          throw new LedgerCorruptionError(
            missionId,
            "a Completion Verdict may only be recorded during VERIFYING",
          );
        }
        const contract = projectRequirementContract(
          records.slice(0, index),
          missionId,
        );
        if (contract === null) {
          throw new LedgerCorruptionError(
            missionId,
            "a Completion Verdict requires a Requirement Contract",
          );
        }
        if (
          record.completionVerdict?.verificationTimestamp !==
          record.occurredAt
        ) {
          throw new LedgerCorruptionError(
            missionId,
            "a Completion Verdict timestamp must match its Ledger attribution timestamp",
          );
        }
        if (verdictIds.has(record.completionVerdict?.verdictId)) {
          throw new LedgerCorruptionError(
            missionId,
            `Completion Verdict "${record.completionVerdict.verdictId}" appears more than once`,
          );
        }
        try {
          validateCompletionEvidence({
            completionVerdict: record.completionVerdict,
            contract,
            missionId,
            getEvidenceById,
            workspaceLedgerValidator,
            workspaceRecords: records.slice(0, index),
          });
        } catch (error) {
          if (
            error instanceof VerificationValidationError ||
            error instanceof EvidenceReferenceError
          ) {
            throw new LedgerCorruptionError(
              missionId,
              `Completion Verdict in record ${sequence} is invalid`,
              { cause: error },
            );
          }
          throw error;
        }
        verdictIds.add(record.completionVerdict.verdictId);
      }
      if (record.type === WORKSPACE_FACT_EVENT) {
        try {
          workspaceLedgerValidator.validateFact({
            record,
            priorRecords: records.slice(0, index),
            missionId,
            missionState: state,
          });
        } catch (error) {
          throw new LedgerCorruptionError(
            missionId,
            `workspace fact in record ${sequence} is invalid`,
            { cause: error },
          );
        }
      }
      if (record.type === RESULT_FACT_EVENT) {
        let fact;
        try {
          fact = normalizeResultFact(record.fact);
          for (const reference of fact.evidenceReferences) {
            validateEvidenceReference({
              evidenceId: reference.evidenceId,
              missionId,
              workspaceCheckpointReference:
                reference.workspaceCheckpointReference,
              workUnitReference: fact.workUnitReference,
            });
            const workspaceAtFact = projectWorkspace(
              records.slice(0, index),
              missionId,
            );
            if (
              workspaceAtFact !== null &&
              reference.workspaceCheckpointReference === null
            ) {
              throw new EvidenceReferenceError(
                "Result evidence for a provisioned mission must cite a checkpoint.",
                reference.evidenceId,
              );
            }
            if (workspaceAtFact !== null) {
              workspaceLedgerValidator.validateCheckpointReference({
                records: records.slice(0, index),
                missionId,
                checkpointId:
                  reference.workspaceCheckpointReference,
              });
            }
          }
        } catch (error) {
          if (
            error instanceof ResultFactValidationError ||
            error instanceof EvidenceReferenceError
          ) {
            throw new LedgerCorruptionError(
              missionId,
              `result fact in record ${sequence} has invalid evidence`,
              { cause: error },
            );
          }
          throw error;
        }
      }
    }
    previousHash = record.hash;
  }

  try {
    projectRequirementContract(records, missionId);
  } catch (error) {
    if (error instanceof ContractValidationError) {
      throw new LedgerCorruptionError(
        missionId,
        "the Requirement Contract event history is invalid",
        { cause: error },
      );
    }
    throw error;
  }
  try {
    projectWorkspace(records, missionId, state);
  } catch (error) {
    throw new LedgerCorruptionError(
      missionId,
      "the workspace event history is invalid",
      { cause: error },
    );
  }
  try {
    projectExecutionHistory(records, missionId);
  } catch (error) {
    throw new LedgerCorruptionError(
      missionId,
      "the execution or model-call event history is invalid",
      { cause: error },
    );
  }
  try {
    projectRuntimeHistory(records, missionId);
  } catch (error) {
    throw new LedgerCorruptionError(
      missionId,
      "the runtime and preview event history is invalid",
      { cause: error },
    );
  }
  try {
    projectRepairHistory(records, missionId);
  } catch (error) {
    throw new LedgerCorruptionError(
      missionId,
      "the diagnosis and repair event history is invalid",
      { cause: error },
    );
  }

  return { state, eventIds, previousHash };
}

function validateReportingReplay(records, missionId) {
  let state = null;
  let previousHash = null;
  const eventIds = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const sequence = index + 1;
    assertPersistedRecordShape(record, missionId, sequence);
    if (eventIds.has(record.eventId)) {
      throw new LedgerCorruptionError(
        missionId,
        `event "${record.eventId}" appears more than once`,
      );
    }
    eventIds.add(record.eventId);
    if (record.previousHash !== previousHash) {
      throw new LedgerCorruptionError(
        missionId,
        `record ${sequence} breaks the hash chain`,
      );
    }
    const { hash, ...recordWithoutHash } = record;
    if (computeRecordHash(recordWithoutHash) !== hash) {
      throw new LedgerCorruptionError(
        missionId,
        `record ${sequence} failed its integrity check`,
      );
    }
    if (record.type === TRANSITION_EVENT) {
      if (record.transition.from !== state) {
        throw new LedgerCorruptionError(
          missionId,
          `record ${sequence} does not continue from the replayed state`,
        );
      }
      if (
        (state === null &&
          record.transition.to !== MissionState.INTAKE) ||
        (state !== null &&
          (isTerminalMissionState(state) ||
            !isLegalTransition(state, record.transition.to)))
      ) {
        throw new LedgerCorruptionError(
          missionId,
          `record ${sequence} contains an illegal transition`,
        );
      }
      state = record.transition.to;
    }
    previousHash = record.hash;
  }
  return { state, eventIds, previousHash };
}

function parseLedger(text, missionId) {
  if (text.length === 0) {
    throw new LedgerCorruptionError(missionId, "the ledger file is empty");
  }

  const lines = text.endsWith("\n")
    ? text.slice(0, -1).split("\n")
    : text.split("\n");

  if (lines.some((line) => line.trim().length === 0)) {
    throw new LedgerCorruptionError(missionId, "the ledger contains a blank record");
  }

  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new LedgerCorruptionError(
        missionId,
        `record ${index + 1} is not valid JSON`,
        { cause: error },
      );
    }
  });
}

function createMissionLedger(
  ledgerDirectory,
  validateEvidenceReference,
  getEvidenceById,
  workspaceLedgerValidator,
  dependencyFingerprint,
) {
  const root = resolve(ledgerDirectory);
  mkdirSync(root, { recursive: true });
  const validatedReplayCache = new Map();

  function ledgerPathFor(missionId) {
    assertMissionId(missionId);
    return resolve(root, `${missionId}.jsonl`);
  }

  function referencedDependencies(records) {
    const evidenceIds = new Set();
    const checkpointIds = new Set();
    function visit(value, key = "") {
      if (Array.isArray(value)) {
        for (const entry of value) visit(entry);
        return;
      }
      if (value === null || typeof value !== "object") {
        if (typeof value !== "string") return;
        if (key === "evidenceId") evidenceIds.add(value);
        if (
          key === "checkpointId" ||
          key === "parentCheckpointId" ||
          key === "workspaceCheckpointReference"
        ) {
          checkpointIds.add(value);
        }
        return;
      }
      for (const [childKey, childValue] of Object.entries(value)) {
        visit(childValue, childKey);
      }
    }
    for (const record of records) visit(record);
    return {
      evidenceIds: [...evidenceIds],
      checkpointIds: [...checkpointIds],
    };
  }

  function readRecords(
    missionId,
    { allowMissing = false, validate = true } = {},
  ) {
    const ledgerPath = ledgerPathFor(missionId);
    if (!existsSync(ledgerPath)) {
      if (allowMissing) {
        return [];
      }
      throw new MissionNotFoundError(missionId);
    }

    const ledgerText = readFileSync(ledgerPath, "utf8");
    const ledgerContentHash = createHash("sha256")
      .update(ledgerText)
      .digest("hex");
    if (!validate) {
      return parseLedger(ledgerText, missionId);
    }
    const cached = validatedReplayCache.get(missionId);
    const dependencyRecords =
      cached?.ledgerContentHash === ledgerContentHash
        ? cached.records
        : parseLedger(ledgerText, missionId);
    const currentDependencyFingerprint = dependencyFingerprint(
      missionId,
      referencedDependencies(dependencyRecords),
    );
    if (
      cached?.ledgerContentHash === ledgerContentHash &&
      cached.dependencyFingerprint === currentDependencyFingerprint
    ) {
      return cached.records;
    }
    const records = dependencyRecords;
    const replay = validateAndReplay(
      records,
      missionId,
      validateEvidenceReference,
      getEvidenceById,
      workspaceLedgerValidator,
    );
    validatedReplayCache.set(missionId, {
      ledgerContentHash,
      dependencyFingerprint: currentDependencyFingerprint,
      records,
      replay,
    });
    return records;
  }

  function appendRecord({
    missionId,
    eventId,
    causationId,
    occurredAt,
    type,
    source,
    fieldName,
    fieldValue,
    validateCurrent,
  }) {
    assertMissionId(missionId);
    assertNonEmptyString(eventId, "eventId");
    assertNonEmptyString(causationId, "causationId");
    assertOccurredAt(occurredAt);

    const ledgerPath = ledgerPathFor(missionId);
    const lockPath = `${ledgerPath}.lock`;
    acquireMissionLock(lockPath, missionId);

    try {
      const records = readRecords(missionId, {
        allowMissing: true,
        validate: true,
      });
      const cached = validatedReplayCache.get(missionId);
      const replay =
        cached?.records === records
          ? cached.replay
          : validateAndReplay(
              records,
              missionId,
              validateEvidenceReference,
              getEvidenceById,
              workspaceLedgerValidator,
            );

      if (replay.eventIds.has(eventId)) {
        throw new DuplicateEventError(missionId, eventId);
      }
      validateCurrent(records, replay);

      const recordWithoutHash = {
        schemaVersion: SCHEMA_VERSION,
        eventId,
        missionId,
        sequence: records.length + 1,
        type,
        source,
        causationId,
        occurredAt,
        [fieldName]: fieldValue,
        previousHash: replay.previousHash,
      };
      const record = {
        ...recordWithoutHash,
        hash: computeRecordHash(recordWithoutHash),
      };

      const descriptor = openSync(ledgerPath, "a");
      try {
        appendFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      const nextEventIds = new Set(replay.eventIds);
      nextEventIds.add(eventId);
      const nextRecords = [...records, record];
      const nextLedgerText = readFileSync(ledgerPath, "utf8");
      validatedReplayCache.set(missionId, {
        ledgerContentHash: createHash("sha256")
          .update(nextLedgerText)
          .digest("hex"),
        dependencyFingerprint: dependencyFingerprint(
          missionId,
          referencedDependencies(nextRecords),
        ),
        records: nextRecords,
        replay: {
          state:
            type === TRANSITION_EVENT ? fieldValue.to : replay.state,
          eventIds: nextEventIds,
          previousHash: record.hash,
        },
      });

      return deepFreeze(structuredClone(record));
    } finally {
      unlinkSync(lockPath);
    }
  }

  function appendTransition({
    missionId,
    eventId,
    causationId,
    occurredAt,
    from,
    to,
    reason,
  }) {
    assertNonEmptyString(reason, "reason");
    if (from !== null && !isMissionState(from)) {
      throw new InvalidInputError(`Unknown source mission state: ${from}.`);
    }
    if (!isMissionState(to)) {
      throw new InvalidInputError(`Unknown target mission state: ${to}.`);
    }

    return appendRecord({
      missionId,
      eventId,
      causationId,
      occurredAt,
      type: TRANSITION_EVENT,
      source: ORCHESTRATOR_SOURCE,
      fieldName: "transition",
      fieldValue: { from, to, reason },
      validateCurrent(records, replay) {
        if (replay.state !== from) {
          throw new IllegalTransitionError(missionId, replay.state, to);
        }
        if (
          to === MissionState.CONTRACTED &&
          projectRequirementContract(records, missionId) === null
        ) {
          throw new ContractRequiredError(missionId);
        }
        if (
          from === MissionState.VERIFYING &&
          (to === MissionState.SUCCEEDED ||
            to === MissionState.REPAIRING)
        ) {
          const requiredResult =
            to === MissionState.SUCCEEDED
              ? CompletionResult.COMPLETE
              : CompletionResult.INCOMPLETE;
          const verdict = latestCompletionVerdict(records);
          const contract = projectRequirementContract(records, missionId);
          if (
            verdict === null ||
            verdict.overallResult !== requiredResult ||
            contract === null ||
            verdict.contractVersion !== contract.contractVersion
          ) {
            throw new CompletionVerdictRequiredError(
              missionId,
              requiredResult,
            );
          }
        }
        if (
          from === MissionState.PROVISIONING &&
          to === MissionState.EXECUTING
        ) {
          workspaceLedgerValidator.validateProvisioning(records, missionId);
        }
        if (
          from === MissionState.REPAIRING &&
          to === MissionState.EXECUTING &&
          latestUnconsumedRepairAdmission(records, missionId) === null
        ) {
          throw new RepairValidationError(
            "REPAIRING to EXECUTING requires an unconsumed novel repair strategy.",
          );
        }
        validateRepairTerminalTransition(records, missionId, from, to);
      },
    });
  }

  function appendWorkspaceFact({
    missionId,
    eventId,
    causationId,
    occurredAt,
    workspaceFact,
  }) {
    const normalizedFact = normalizeWorkspaceFact(workspaceFact);
    for (const reference of normalizedFact.evidenceReferences) {
      validateEvidenceReference({
        evidenceId: reference.evidenceId,
        missionId,
        workspaceCheckpointReference:
          reference.workspaceCheckpointReference,
        workUnitReference: null,
      });
    }
    return appendRecord({
      missionId,
      eventId,
      causationId,
      occurredAt,
      type: WORKSPACE_FACT_EVENT,
      source: WORKSPACE_SERVICE_SOURCE,
      fieldName: "workspaceFact",
      fieldValue: normalizedFact,
      validateCurrent(records, replay) {
        workspaceLedgerValidator.validateFact({
          record: {
            type: WORKSPACE_FACT_EVENT,
            occurredAt,
            workspaceFact: normalizedFact,
          },
          priorRecords: records,
          missionId,
          missionState: replay.state,
        });
      },
    });
  }

  function appendCompletionVerdict({
    missionId,
    eventId,
    causationId,
    occurredAt,
    completionVerdict,
  }) {
    return appendRecord({
      missionId,
      eventId,
      causationId,
      occurredAt,
      type: COMPLETION_VERDICT_EVENT,
      source: VERIFICATION_AUTHORITY_SOURCE,
      fieldName: "completionVerdict",
      fieldValue: completionVerdict,
      validateCurrent(records, replay) {
        if (replay.state !== MissionState.VERIFYING) {
          throw new VerificationValidationError(
            `A Completion Verdict may only be recorded in VERIFYING, not ${replay.state}.`,
          );
        }
        const contract = projectRequirementContract(records, missionId);
        if (contract === null) {
          throw new ContractRequiredError(missionId);
        }
        if (
          records.some(
            (record) =>
              record.type === COMPLETION_VERDICT_EVENT &&
              record.completionVerdict.verdictId ===
                completionVerdict.verdictId,
          )
        ) {
          throw new VerificationValidationError(
            `Completion Verdict "${completionVerdict.verdictId}" already exists.`,
          );
        }
        validateCompletionEvidence({
          completionVerdict,
          contract,
          missionId,
          getEvidenceById,
          workspaceLedgerValidator,
          workspaceRecords: records,
        });
      },
    });
  }

  function appendContractCreation({
    missionId,
    eventId,
    causationId,
    occurredAt,
    contract,
  }) {
    const normalizedContract = normalizeContractCreation(contract);
    return appendRecord({
      missionId,
      eventId,
      causationId,
      occurredAt,
      type: CONTRACT_CREATED_EVENT,
      source: CONTRACT_SERVICE_SOURCE,
      fieldName: "contract",
      fieldValue: normalizedContract,
      validateCurrent(records, replay) {
        if (records.length === 0) {
          throw new MissionNotFoundError(missionId);
        }
        if (replay.state !== MissionState.INTAKE) {
          throw new ContractStateError(missionId, replay.state, "create");
        }
        if (projectRequirementContract(records, missionId) !== null) {
          throw new ContractAlreadyExistsError(missionId);
        }
      },
    });
  }

  function appendContractAmendment({
    missionId,
    eventId,
    causationId,
    occurredAt,
    amendment,
  }) {
    return appendRecord({
      missionId,
      eventId,
      causationId,
      occurredAt,
      type: CONTRACT_AMENDED_EVENT,
      source: CONTRACT_SERVICE_SOURCE,
      fieldName: "amendment",
      fieldValue: amendment,
      validateCurrent(records, replay) {
        if (isTerminalMissionState(replay.state)) {
          throw new ContractStateError(missionId, replay.state, "amend");
        }
        const current = projectRequirementContract(records, missionId);
        if (current === null) {
          throw new ContractNotFoundError(missionId);
        }
        applyContractAmendment(current, amendment);
      },
    });
  }

  function appendResultFact({
    missionId,
    eventId,
    causationId,
    occurredAt,
    producingSubsystem,
    fact,
  }) {
    assertNonEmptyString(producingSubsystem, "producingSubsystem");
    const normalizedFact = normalizeResultFact(fact);
    for (const reference of normalizedFact.evidenceReferences) {
      validateEvidenceReference({
        evidenceId: reference.evidenceId,
        missionId,
        workspaceCheckpointReference:
          reference.workspaceCheckpointReference,
        workUnitReference: normalizedFact.workUnitReference,
      });
    }

    return appendRecord({
      missionId,
      eventId,
      causationId,
      occurredAt,
      type: RESULT_FACT_EVENT,
      source: producingSubsystem.trim(),
      fieldName: "fact",
      fieldValue: normalizedFact,
      validateCurrent(records) {
        if (records.length === 0) {
          throw new MissionNotFoundError(missionId);
        }
        for (const reference of normalizedFact.evidenceReferences) {
          validateEvidenceReference({
            evidenceId: reference.evidenceId,
            missionId,
            workspaceCheckpointReference:
              reference.workspaceCheckpointReference,
            workUnitReference: normalizedFact.workUnitReference,
          });
          const activeWorkspace = projectWorkspace(records, missionId);
          if (
            activeWorkspace !== null &&
            reference.workspaceCheckpointReference === null
          ) {
            throw new EvidenceReferenceError(
              "Result evidence for a provisioned mission must cite a checkpoint.",
              reference.evidenceId,
            );
          }
          if (activeWorkspace !== null) {
            workspaceLedgerValidator.validateCheckpointReference({
              records,
              missionId,
              checkpointId:
                reference.workspaceCheckpointReference,
            });
          }
        }
      },
    });
  }

  function appendCatalogueDeletionFact({
    missionId,
    eventId,
    causationId,
    occurredAt,
    producingSubsystem,
    fact,
  }) {
    assertMissionId(missionId);
    assertNonEmptyString(eventId, "eventId");
    assertNonEmptyString(causationId, "causationId");
    assertOccurredAt(occurredAt);
    assertNonEmptyString(producingSubsystem, "producingSubsystem");
    const normalizedFact = normalizeResultFact(fact);
    if (
      normalizedFact.metadata?.projectCatalogueOperation?.operation !==
      "DELETED"
    ) {
      throw new ResultFactValidationError(
        "The catalogue deletion append path accepts only DELETED project catalogue facts.",
      );
    }
    for (const reference of normalizedFact.evidenceReferences) {
      validateEvidenceReference({
        evidenceId: reference.evidenceId,
        missionId,
        workspaceCheckpointReference:
          reference.workspaceCheckpointReference,
        workUnitReference: normalizedFact.workUnitReference,
      });
    }

    const ledgerPath = ledgerPathFor(missionId);
    const lockPath = `${ledgerPath}.lock`;
    acquireMissionLock(lockPath, missionId);
    try {
      const records = readRecords(missionId, {
        allowMissing: false,
        validate: false,
      });
      const replay = validateReportingReplay(records, missionId);
      if (replay.eventIds.has(eventId)) {
        throw new DuplicateEventError(missionId, eventId);
      }

      const recordWithoutHash = {
        schemaVersion: SCHEMA_VERSION,
        eventId,
        missionId,
        sequence: records.length + 1,
        type: RESULT_FACT_EVENT,
        source: producingSubsystem.trim(),
        causationId,
        occurredAt,
        fact: normalizedFact,
        previousHash: replay.previousHash,
      };
      const record = {
        ...recordWithoutHash,
        hash: computeRecordHash(recordWithoutHash),
      };
      const descriptor = openSync(ledgerPath, "a");
      try {
        appendFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      validatedReplayCache.delete(missionId);
      return deepFreeze(structuredClone(record));
    } finally {
      unlinkSync(lockPath);
    }
  }

  const publicLedger = Object.freeze({
    reportEvents(missionId) {
      const records = readRecords(missionId, { validate: false });
      validateReportingReplay(records, missionId);
      return deepFreeze(structuredClone(records));
    },

    listEvents(missionId) {
      return deepFreeze(structuredClone(readRecords(missionId)));
    },

    projectState(missionId) {
      const records = readRecords(missionId);
      const replay = validatedReplayCache.get(missionId).replay;
      return Object.freeze({
        missionId,
        state: replay.state,
        eventCount: records.length,
        lastSequence: records.at(-1).sequence,
        lastEventId: records.at(-1).eventId,
      });
    },
  });

  return {
    publicLedger,
    appendTransition,
    appendContractCreation,
    appendContractAmendment,
    appendCompletionVerdict,
    appendWorkspaceFact,
    appendResultFact,
    appendCatalogueDeletionFact,
    validateWorkspaceProvisioning:
      workspaceLedgerValidator.validateProvisioning,
  };
}

function createMissionOrchestrator(ledger, clock) {
  return Object.freeze({
    createMission({
      missionId,
      eventId,
      causationId,
      reason = "Mission accepted into intake.",
      occurredAt = clock(),
    }) {
      assertMissionId(missionId);
      if (existsSync(ledger.pathFor(missionId))) {
        throw new MissionAlreadyExistsError(missionId);
      }

      return ledger.appendTransition({
        missionId,
        eventId,
        causationId,
        occurredAt,
        from: null,
        to: MissionState.INTAKE,
        reason,
      });
    },

    transition({
      missionId,
      eventId,
      causationId,
      to,
      reason,
      occurredAt = clock(),
    }) {
      assertMissionId(missionId);
      if (!isMissionState(to)) {
        throw new InvalidInputError(`Unknown target mission state: ${to}.`);
      }

      assertNonEmptyString(eventId, "eventId");
      const existingEvents = ledger.publicLedger.listEvents(missionId);
      if (existingEvents.some((event) => event.eventId === eventId)) {
        throw new DuplicateEventError(missionId, eventId);
      }

      const projection = ledger.publicLedger.projectState(missionId);
      const from = projection.state;

      if (isTerminalMissionState(from)) {
        throw new TerminalStateError(missionId, from, to);
      }
      if (!isLegalTransition(from, to)) {
        throw new IllegalTransitionError(missionId, from, to);
      }
      if (
        from === MissionState.INTAKE &&
        to === MissionState.CONTRACTED &&
        projectRequirementContract(existingEvents, missionId) === null
      ) {
        throw new ContractRequiredError(missionId);
      }
      if (
        from === MissionState.VERIFYING &&
        (to === MissionState.SUCCEEDED ||
          to === MissionState.REPAIRING)
      ) {
        const requiredResult =
          to === MissionState.SUCCEEDED
            ? CompletionResult.COMPLETE
            : CompletionResult.INCOMPLETE;
        const verdict = latestCompletionVerdict(existingEvents);
        const contract = projectRequirementContract(
          existingEvents,
          missionId,
        );
        if (
          verdict === null ||
          verdict.overallResult !== requiredResult ||
          contract === null ||
          verdict.contractVersion !== contract.contractVersion
        ) {
          throw new CompletionVerdictRequiredError(
            missionId,
            requiredResult,
          );
        }
      }
      if (
        from === MissionState.PROVISIONING &&
        to === MissionState.EXECUTING
      ) {
        ledger.validateWorkspaceProvisioning(existingEvents, missionId);
      }
      if (
        from === MissionState.REPAIRING &&
        to === MissionState.EXECUTING &&
        latestUnconsumedRepairAdmission(existingEvents, missionId) === null
      ) {
        throw new RepairValidationError(
          "REPAIRING to EXECUTING requires an unconsumed novel repair strategy.",
        );
      }
      validateRepairTerminalTransition(existingEvents, missionId, from, to);

      return ledger.appendTransition({
        missionId,
        eventId,
        causationId,
        occurredAt,
        from,
        to,
        reason,
      });
    },

    state(missionId) {
      return ledger.publicLedger.projectState(missionId);
    },
  });
}

function createResultFactService(
  ledger,
  clock,
  { allowExecutionAuthorities = false } = {},
) {
  return Object.freeze({
    recordResultFact({
      missionId,
      eventId,
      causationId,
      producingSubsystem,
      statement,
      evidenceReferences,
      workspaceCheckpointReference = null,
      workUnitReference = null,
      metadata = {},
      occurredAt = clock(),
    }) {
      const containsReservedExecutionMetadata =
        metadata !== null &&
        typeof metadata === "object" &&
        (metadata.executionStart !== undefined ||
          metadata.executionRecord !== undefined ||
          metadata.modelCallRecord !== undefined ||
          metadata.runtimeRecord !== undefined ||
          metadata.repairAdmission !== undefined ||
          metadata.repairAttempt !== undefined ||
          metadata.repairFinding !== undefined);
      const usesReservedExecutionSource =
        producingSubsystem === EXECUTION_ENGINE_SOURCE ||
        producingSubsystem === MODEL_GATEWAY_SOURCE ||
        producingSubsystem === RUNTIME_PREVIEW_SOURCE ||
        producingSubsystem === DIAGNOSIS_REPAIR_SOURCE;
      if (
        !allowExecutionAuthorities &&
        (containsReservedExecutionMetadata || usesReservedExecutionSource)
      ) {
        throw new ResultFactValidationError(
          "Execution Engine and Model Gateway facts may be recorded only by their private authorities.",
        );
      }
      return ledger.appendResultFact({
        missionId,
        eventId,
        causationId,
        occurredAt,
        producingSubsystem,
        fact: {
          statement,
          resultBearing: true,
          evidenceReferences,
          workspaceCheckpointReference,
          workUnitReference,
          metadata,
        },
      });
    },
  });
}

export function openMissionControl({
  ledgerDirectory,
  evidenceDirectory,
  workspaceDirectory,
  registryDirectory,
  toolProbe,
  allowDeterministicCertificationFixtures = false,
  modelProviders = [],
  environmentVariables = process.env,
  aiDiscoveryAdapters = {},
  maxModelProviderAttempts = 2,
  repairBudget,
  repairStrategyCatalog = {},
  executionFaultInjector = null,
  requireProductBlueprintApproval = false,
  clock = () => new Date().toISOString(),
}) {
  if (typeof ledgerDirectory !== "string" || ledgerDirectory.length === 0) {
    throw new InvalidInputError("ledgerDirectory must be a non-empty path.");
  }
  if (typeof clock !== "function") {
    throw new InvalidInputError("clock must be a function.");
  }
  const resolvedEvidenceDirectory =
    evidenceDirectory ?? resolve(ledgerDirectory, "evidence");
  const resolvedWorkspaceDirectory =
    workspaceDirectory ?? resolve(ledgerDirectory, "workspaces");
  const resolvedRegistryDirectory =
    registryDirectory ?? resolve(ledgerDirectory, "registry");
  if (
    typeof resolvedEvidenceDirectory !== "string" ||
    resolvedEvidenceDirectory.length === 0
  ) {
    throw new InvalidInputError(
      "evidenceDirectory must be a non-empty path.",
    );
  }
  if (
    typeof resolvedWorkspaceDirectory !== "string" ||
    resolvedWorkspaceDirectory.length === 0
  ) {
    throw new InvalidInputError(
      "workspaceDirectory must be a non-empty path.",
    );
  }
  if (
    typeof resolvedRegistryDirectory !== "string" ||
    resolvedRegistryDirectory.length === 0
  ) {
    throw new InvalidInputError(
      "registryDirectory must be a non-empty path.",
    );
  }
  if (toolProbe !== undefined && typeof toolProbe !== "function") {
    throw new InvalidInputError("toolProbe must be a function.");
  }
  if (typeof allowDeterministicCertificationFixtures !== "boolean") {
    throw new InvalidInputError(
      "allowDeterministicCertificationFixtures must be a boolean.",
    );
  }
  if (!Array.isArray(modelProviders)) {
    throw new InvalidInputError("modelProviders must be an array.");
  }
  if (
    environmentVariables === null ||
    typeof environmentVariables !== "object" ||
    Array.isArray(environmentVariables)
  ) {
    throw new InvalidInputError(
      "environmentVariables must be an object.",
    );
  }
  if (
    aiDiscoveryAdapters === null ||
    typeof aiDiscoveryAdapters !== "object" ||
    Array.isArray(aiDiscoveryAdapters)
  ) {
    throw new InvalidInputError(
      "aiDiscoveryAdapters must be an object.",
    );
  }
  if (
    !Number.isSafeInteger(maxModelProviderAttempts) ||
    maxModelProviderAttempts < 1 ||
    maxModelProviderAttempts > 4
  ) {
    throw new InvalidInputError(
      "maxModelProviderAttempts must be from 1 through 4.",
    );
  }
  if (
    executionFaultInjector !== null &&
    typeof executionFaultInjector !== "function"
  ) {
    throw new InvalidInputError(
      "executionFaultInjector must be null or a function.",
    );
  }

  const internalEvidence = createObservationEvidenceStore({
    evidenceDirectory: resolvedEvidenceDirectory,
  });
  const internalWorkspaceStore = createWorkspaceStore({
    workspaceDirectory: resolvedWorkspaceDirectory,
  });
  const internalRegistryStore = createRegistryStore({
    registryDirectory: resolvedRegistryDirectory,
    validateEvidenceReference: internalEvidence.validateReference,
    clock,
  });
  const internalAiRegistryStore = createAiRegistryStore({
    registryDirectory: resolve(resolvedRegistryDirectory, "ai"),
    clock,
  });
  const environment = createEnvironmentService({
    environment: environmentVariables,
  });
  const aiRegistry = createAiProviderRegistry({
    store: internalAiRegistryStore,
    environment,
    discoveryAdapters: aiDiscoveryAdapters,
    executionAdapters: modelProviders,
    clock,
  });
  const ai = Object.freeze({
    environment,
    providers: aiRegistry.providers,
    models: aiRegistry.models,
    capabilities: aiRegistry.capabilities,
    router: createModelRouter({
      registry: aiRegistry,
      clock,
      routeHistory: persistedModelRouteHistory,
    }),
    prompts: createPromptBuilder(),
    context: createContextBuilder(),
    responses: createModelResponseValidator(),
    listRegistryEvents: aiRegistry.listEvents,
    registryPath: aiRegistry.path,
  });
  const workspaceLedgerValidator = createWorkspaceLedgerValidator({
    store: internalWorkspaceStore,
    validateEvidenceReference: internalEvidence.validateReference,
    getEvidenceById: internalEvidence.getById,
  });
  const internalLedger = createMissionLedger(
    ledgerDirectory,
    internalEvidence.validateReference,
    internalEvidence.getById,
    workspaceLedgerValidator,
    (_missionId, dependencies) =>
      createHash("sha256")
        .update(
          internalEvidence.integrityFingerprint(dependencies.evidenceIds),
        )
        .update(
          internalWorkspaceStore.integrityFingerprint(
            dependencies.checkpointIds,
          ),
        )
        .digest("hex"),
  );
  const ledgerBridge = Object.freeze({
    publicLedger: internalLedger.publicLedger,
    appendTransition: internalLedger.appendTransition,
    validateWorkspaceProvisioning:
      internalLedger.validateWorkspaceProvisioning,
    pathFor(missionId) {
      assertMissionId(missionId);
      return resolve(ledgerDirectory, `${missionId}.jsonl`);
    },
  });
  const orchestrator = createMissionOrchestrator(ledgerBridge, clock);
  const contracts = createRequirementContractService({
    ledger: Object.freeze({
      ...internalLedger.publicLedger,
      appendContractCreation: internalLedger.appendContractCreation,
      appendContractAmendment: internalLedger.appendContractAmendment,
    }),
    clock,
  });
  const profiles = createProjectProfileService();
  const evidence = Object.freeze({
    capture(input) {
      if (
        input === null ||
        typeof input !== "object" ||
        Array.isArray(input)
      ) {
        throw new InvalidInputError("evidence input must be an object.");
      }
      internalLedger.publicLedger.projectState(input.missionId);
      const missionRecords = internalLedger.publicLedger.listEvents(
        input.missionId,
      );
      if (
        projectWorkspace(missionRecords, input.missionId) !== null
      ) {
        if (
          input.workspaceCheckpointReference === undefined ||
          input.workspaceCheckpointReference === null
        ) {
          throw new EvidenceReferenceError(
            "Evidence for a provisioned mission must cite a workspace checkpoint.",
            input.evidenceId,
          );
        }
        workspaceLedgerValidator.validateCheckpointReference({
          records: missionRecords,
          missionId: input.missionId,
          checkpointId: input.workspaceCheckpointReference,
          requireCurrent: true,
        });
      }
      return internalEvidence.capture({
        ...input,
        timestamp: input.timestamp ?? clock(),
      });
    },
    captureCatalogueDeletion(input) {
      if (
        input === null ||
        typeof input !== "object" ||
        Array.isArray(input)
      ) {
        throw new InvalidInputError("evidence input must be an object.");
      }
      if (
        input.producingSubsystem !== "LOCAL_API" ||
        input.captureMethod !== "local-customer-project-deletion" ||
        input.kind !== "http-response-result" ||
        (input.workspaceCheckpointReference !== undefined &&
          input.workspaceCheckpointReference !== null)
      ) {
        throw new InvalidInputError(
          "The catalogue deletion evidence path accepts only checkpoint-independent LOCAL_API deletion observations.",
        );
      }
      internalLedger.publicLedger.reportEvents(input.missionId);
      return internalEvidence.capture({
        ...input,
        workspaceCheckpointReference: null,
        timestamp: input.timestamp ?? clock(),
      });
    },
    getById: internalEvidence.getById,
    findByMission: internalEvidence.findByMission,
    findByKind: internalEvidence.findByKind,
    findByWorkUnit: internalEvidence.findByWorkUnit,
    findByCheckpoint: internalEvidence.findByCheckpoint,
  });
  const facts = createResultFactService(
    Object.freeze({
      appendResultFact: internalLedger.appendResultFact,
    }),
    clock,
  );
  const approvedContracts = createApprovedProjectContractService({
    ledger: internalLedger.publicLedger,
    facts,
    clock,
  });
  const executionFacts = createResultFactService(
    Object.freeze({
      appendResultFact: internalLedger.appendResultFact,
    }),
    clock,
    { allowExecutionAuthorities: true },
  );
  const verification = createVerificationAuthority({
    ledger: Object.freeze({
      ...internalLedger.publicLedger,
      appendCompletionVerdict: internalLedger.appendCompletionVerdict,
    }),
    evidence,
    contracts,
    clock,
  });
  const workspaceServices = createWorkspaceService({
    ledger: Object.freeze({
      ...internalLedger.publicLedger,
      appendWorkspaceFact: internalLedger.appendWorkspaceFact,
    }),
    evidence: internalEvidence,
    store: internalWorkspaceStore,
    clock,
  });
  const workspaces = workspaceServices.publicWorkspaceService;
  const toolchains = createToolchainStackRegistry({
    ledger: internalLedger.publicLedger,
    evidence,
    facts,
    store: internalRegistryStore,
    clock,
    toolProbe,
    allowDeterministicCertificationFixtures,
  });
  const persistedModelRouteFileCache = new Map();
  function persistedModelRouteHistory() {
    const names = readdirSync(ledgerDirectory)
      .filter((name) => name.endsWith(".jsonl"));
    const currentNames = new Set(names);
    for (const cachedName of persistedModelRouteFileCache.keys()) {
      if (!currentNames.has(cachedName)) {
        persistedModelRouteFileCache.delete(cachedName);
      }
    }
    return names.flatMap((name) => {
        const file = resolve(ledgerDirectory, name);
        const statistics = statSync(file);
        const signature = `${statistics.size}:${statistics.mtimeMs}`;
        const cached = persistedModelRouteFileCache.get(name);
        if (cached?.signature === signature) return cached.history;
        const missionId = name.slice(0, -6);
        const history = internalLedger.publicLedger
          .reportEvents(missionId)
          .flatMap((record) => {
            const route = record.fact?.metadata?.modelRouteStart;
            if (route !== undefined) {
              const separator = record.eventId.lastIndexOf(".route-");
              return [
                {
                  kind: "route",
                  requestId:
                    separator === -1
                      ? record.eventId
                      : record.eventId.slice(0, separator),
                   providerId: route.provider,
                   modelId: route.modelId,
                   taskClass: route.taskClass,
                  routeAttempt: route.routeAttempt,
                },
              ];
            }
            const failed = record.fact?.metadata?.modelRouteFailure;
            if (failed !== undefined) {
              let disposition = {
                category: failed.failureCategory,
                retryable: failed.retryable,
              };
              if (
                typeof disposition.category !== "string" ||
                typeof disposition.retryable !== "boolean" ||
                disposition.category === "TRANSIENT_PROVIDER_FAILURE"
              ) {
                const evidenceId =
                  record.fact?.evidenceReferences?.[0]?.evidenceId;
                let detail = "";
                if (typeof evidenceId === "string") {
                  try {
                    detail =
                      internalEvidence.getById(evidenceId)?.payload?.detail ??
                      "";
                  } catch {
                    detail = "";
                  }
                }
                const currentDisposition =
                  classifyModelRouteFailure(detail);
                if (
                  typeof disposition.category !== "string" ||
                  typeof disposition.retryable !== "boolean" ||
                  currentDisposition.category !==
                    "TRANSIENT_PROVIDER_FAILURE"
                ) {
                  disposition = currentDisposition;
                }
              }
              return [
                {
                  kind: "failure",
                  requestId: failed.requestId,
                  providerId: failed.provider,
                  modelId: failed.modelId,
                  taskClass: failed.taskClass,
                  routeAttempt: failed.routeAttempt,
                  failureCategory: disposition.category,
                  retryable: disposition.retryable,
                  executionStage: failed.executionStage ?? null,
                },
              ];
            }
            const result = record.fact?.metadata?.modelCallRecord;
            return result === undefined
              ? []
              : [
                  {
                    kind: "result",
                    requestId: result.requestId,
                     providerId: result.provider,
                     modelId: result.modelId,
                     taskClass: result.taskClass,
                    status: result.status,
                  },
                  ];
          });
        persistedModelRouteFileCache.set(name, { signature, history });
        return history;
      });
  }
  function persistedProductTypeDiscoveryHistory() {
    return readdirSync(ledgerDirectory)
      .filter((name) => name.endsWith(".jsonl"))
      .flatMap((name) => {
        const missionId = name.slice(0, -6);
        const records = internalLedger.publicLedger.reportEvents(missionId);
        for (let index = records.length - 1; index >= 0; index -= 1) {
          const discovery = records[index]?.fact?.metadata?.productTypeDiscovery;
          if (discovery !== undefined) return [discovery];
        }
        return [];
      });
  }
  const models = createModelGateway({
    ledger: internalLedger.publicLedger,
    evidence,
    facts: executionFacts,
    workspaces,
    providerRegistry: aiRegistry.execution,
    modelRouter: ai.router,
    routeHistory: persistedModelRouteHistory,
    maxProviderAttempts: maxModelProviderAttempts,
    clock,
  });
  const execution = createExecutionEngine({
    ledger: internalLedger.publicLedger,
    contracts,
    facts: executionFacts,
    evidence: internalEvidence,
    workspaces,
    workspaceExecutionAuthority: workspaceServices.executionAuthority,
    toolchains,
    clock,
    faultInjector: executionFaultInjector,
  });
  const runtime = createRuntimePreviewService({
    ledger: internalLedger.publicLedger,
    contracts,
    evidence,
    facts: executionFacts,
    toolchains,
    workspaces,
    workspaceExecutionAuthority: workspaceServices.executionAuthority,
    clock,
  });
  const repair = createDiagnosisRepairStrategist({
    ledger: internalLedger.publicLedger,
    evidence,
    facts: executionFacts,
    workspaces,
    execution,
    providerCatalog: aiRegistry.execution.list(),
    repairBudget,
    strategyCatalog: repairStrategyCatalog,
    clock,
  });
  const understanding = createProjectUnderstandingService({
    ledger: internalLedger.publicLedger,
    orchestrator,
    profiles,
    contracts,
    approvedContracts,
    evidence,
    facts,
    modelFacts: executionFacts,
    router: ai.router,
    providerRegistry: aiRegistry.execution,
    routeHistory: persistedModelRouteHistory,
    productTypeDiscoveryHistory: persistedProductTypeDiscoveryHistory,
    requireProductBlueprintApproval,
    clock,
  });
  const production = createProductionMissionService({
    ledger: internalLedger.publicLedger,
    orchestrator,
    understanding,
    contracts,
    approvedContracts,
    toolchains,
    workspaces,
    models,
    execution,
    runtime,
    evidence,
    verification,
    allowLegacyCertificationExecution:
      allowDeterministicCertificationFixtures,
  });
  const catalogue = Object.freeze({
    listMissionIds() {
      return Object.freeze(
        readdirSync(ledgerDirectory)
          .filter((name) => name.endsWith(".jsonl"))
          .map((name) => name.slice(0, -6))
          .sort(),
      );
    },
    recordDeletionFact(input) {
      return internalLedger.appendCatalogueDeletionFact(input);
    },
    modelRouteHistory() {
      return Object.freeze(persistedModelRouteHistory());
    },
  });

  return Object.freeze({
    ledger: internalLedger.publicLedger,
    orchestrator,
    contracts,
    approvedContracts,
    profiles,
    understanding,
    production,
    catalogue,
    evidence,
    facts,
    verification,
    workspaces,
    toolchains,
    models,
    execution,
    runtime,
    repair,
    ai,
  });
}
