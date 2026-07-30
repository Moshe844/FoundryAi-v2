import {
  ContractValidationError,
  InvalidContractAmendmentError,
} from "./errors.js";
import { normalizeAcceptanceCondition } from "./verification.js";

export const CONTRACT_CREATED_EVENT = "REQUIREMENT_CONTRACT_CREATED";
export const CONTRACT_AMENDED_EVENT = "REQUIREMENT_CONTRACT_AMENDED";
export const CONTRACT_SERVICE_SOURCE = "REQUIREMENT_CONTRACT_SERVICE";

export const ObligationOrigin = Object.freeze({
  CUSTOMER_STATED: "customer-stated",
  FOUNDRY_DERIVED: "foundry-derived",
});

export const OBLIGATION_ORIGINS = Object.freeze(
  Object.values(ObligationOrigin),
);

const obligationOriginSet = new Set(OBLIGATION_ORIGINS);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const OBLIGATION_KEYS = new Set([
  "obligationId",
  "statement",
  "origin",
  "acceptanceCondition",
  "requiredEvidenceKinds",
  "dependencyObligationIds",
  "contractVersion",
]);
const CONTRACT_CREATION_KEYS = new Set(["contractVersion", "obligations"]);
const AMENDMENT_KEYS = new Set([
  "amendmentId",
  "previousContractVersion",
  "newContractVersion",
  "obligationsAdded",
  "obligationsChanged",
  "obligationsRemoved",
  "reason",
  "affectedExistingObligationIds",
  "timestamp",
]);
const VAGUE_ACCEPTANCE_CONDITIONS = new Set([
  "make it good",
  "use best practices",
  "make it professional",
  "good",
  "best practices",
  "professional",
]);

function assertPlainObject(value, label, ErrorType = ContractValidationError) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ErrorType(`${label} must be an object.`);
  }
}

function assertKnownKeys(
  value,
  allowedKeys,
  label,
  ErrorType = ContractValidationError,
) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new ErrorType(`${label} contains unsupported field "${key}".`);
    }
  }
}

function assertNonEmptyString(
  value,
  label,
  ErrorType = ContractValidationError,
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ErrorType(`${label} must be a non-empty string.`);
  }
}

function assertIdentifier(
  value,
  label,
  ErrorType = ContractValidationError,
) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new ErrorType(
      `${label} must be 1-128 characters using letters, numbers, dots, underscores, or hyphens.`,
    );
  }
}

function assertPositiveVersion(
  value,
  label,
  ErrorType = ContractValidationError,
) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ErrorType(`${label} must be a positive integer.`);
  }
}

function normalizeComparableText(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/u, "")
    .replace(/\s+/gu, " ");
}

function normalizeUniqueStringArray(
  value,
  label,
  { allowEmpty, identifier = false, ErrorType = ContractValidationError },
) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new ErrorType(
      `${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`,
    );
  }

  const normalized = value.map((entry, index) => {
    if (identifier) {
      assertIdentifier(entry, `${label}[${index}]`, ErrorType);
      return entry;
    }
    assertNonEmptyString(entry, `${label}[${index}]`, ErrorType);
    return entry.trim();
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new ErrorType(`${label} must not contain duplicates.`);
  }
  return normalized;
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

function validateDependencyGraph(obligations, ErrorType = ContractValidationError) {
  const obligationsById = new Map(
    obligations.map((obligation) => [obligation.obligationId, obligation]),
  );

  for (const obligation of obligations) {
    for (const dependencyId of obligation.dependencyObligationIds) {
      if (dependencyId === obligation.obligationId) {
        throw new ErrorType(
          `Obligation "${obligation.obligationId}" cannot depend on itself.`,
        );
      }
      if (!obligationsById.has(dependencyId)) {
        throw new ErrorType(
          `Obligation "${obligation.obligationId}" depends on unknown obligation "${dependencyId}".`,
        );
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();

  function visit(obligationId) {
    if (visiting.has(obligationId)) {
      throw new ErrorType(
        `Obligation dependencies contain a cycle involving "${obligationId}".`,
      );
    }
    if (visited.has(obligationId)) {
      return;
    }

    visiting.add(obligationId);
    for (const dependencyId of obligationsById.get(obligationId)
      .dependencyObligationIds) {
      visit(dependencyId);
    }
    visiting.delete(obligationId);
    visited.add(obligationId);
  }

  for (const obligationId of obligationsById.keys()) {
    visit(obligationId);
  }
}

export function normalizeObligation(
  obligation,
  expectedVersion,
  ErrorType = ContractValidationError,
) {
  assertPlainObject(obligation, "obligation", ErrorType);
  assertKnownKeys(obligation, OBLIGATION_KEYS, "obligation", ErrorType);
  assertIdentifier(obligation.obligationId, "obligation.obligationId", ErrorType);
  assertNonEmptyString(obligation.statement, "obligation.statement", ErrorType);
  if (!obligationOriginSet.has(obligation.origin)) {
    throw new ErrorType(
      `obligation.origin must be one of: ${OBLIGATION_ORIGINS.join(", ")}.`,
    );
  }
  let acceptanceCondition;
  if (typeof obligation.acceptanceCondition === "string") {
    assertNonEmptyString(
      obligation.acceptanceCondition,
      "obligation.acceptanceCondition",
      ErrorType,
    );
    if (
      VAGUE_ACCEPTANCE_CONDITIONS.has(
        normalizeComparableText(obligation.acceptanceCondition),
      )
    ) {
      throw new ErrorType(
        `Obligation "${obligation.obligationId}" must replace vague language with an observable acceptance condition.`,
      );
    }
    acceptanceCondition = obligation.acceptanceCondition.trim();
  } else {
    try {
      acceptanceCondition = normalizeAcceptanceCondition(
        obligation.acceptanceCondition,
      );
    } catch (error) {
      throw new ErrorType(
        `Obligation "${obligation.obligationId}" has an invalid acceptance condition: ${error.message}`,
      );
    }
  }
  assertPositiveVersion(
    obligation.contractVersion,
    "obligation.contractVersion",
    ErrorType,
  );
  if (obligation.contractVersion !== expectedVersion) {
    throw new ErrorType(
      `Obligation "${obligation.obligationId}" must use contract version ${expectedVersion}.`,
    );
  }

  const requiredEvidenceKinds = normalizeUniqueStringArray(
    obligation.requiredEvidenceKinds,
    `obligation "${obligation.obligationId}" requiredEvidenceKinds`,
    { allowEmpty: false, ErrorType },
  );
  const dependencyObligationIds = normalizeUniqueStringArray(
    obligation.dependencyObligationIds ?? [],
    `obligation "${obligation.obligationId}" dependencyObligationIds`,
    { allowEmpty: true, identifier: true, ErrorType },
  );

  return {
    obligationId: obligation.obligationId,
    statement: obligation.statement.trim(),
    origin: obligation.origin,
    acceptanceCondition,
    requiredEvidenceKinds,
    dependencyObligationIds,
    contractVersion: obligation.contractVersion,
  };
}

function normalizeObligationSet(
  obligations,
  version,
  ErrorType = ContractValidationError,
) {
  if (!Array.isArray(obligations) || obligations.length === 0) {
    throw new ErrorType("A Requirement Contract must contain obligations.");
  }

  const normalized = obligations.map((obligation) =>
    normalizeObligation(obligation, version, ErrorType),
  );
  const ids = normalized.map((obligation) => obligation.obligationId);
  if (new Set(ids).size !== ids.length) {
    throw new ErrorType("Obligation IDs must be unique within a contract.");
  }
  validateDependencyGraph(normalized, ErrorType);
  return normalized;
}

export function normalizeContractCreation(contract) {
  assertPlainObject(contract, "contract");
  assertKnownKeys(contract, CONTRACT_CREATION_KEYS, "contract");
  assertPositiveVersion(contract.contractVersion, "contract.contractVersion");
  if (contract.contractVersion !== 1) {
    throw new ContractValidationError(
      "An initial Requirement Contract must have version 1.",
    );
  }

  return {
    contractVersion: 1,
    obligations: normalizeObligationSet(contract.obligations, 1),
  };
}

function normalizeAmendmentShape(amendment) {
  const ErrorType = InvalidContractAmendmentError;
  assertPlainObject(amendment, "amendment", ErrorType);
  assertKnownKeys(amendment, AMENDMENT_KEYS, "amendment", ErrorType);
  assertIdentifier(amendment.amendmentId, "amendment.amendmentId", ErrorType);
  assertPositiveVersion(
    amendment.previousContractVersion,
    "amendment.previousContractVersion",
    ErrorType,
  );
  assertPositiveVersion(
    amendment.newContractVersion,
    "amendment.newContractVersion",
    ErrorType,
  );
  assertNonEmptyString(amendment.reason, "amendment.reason", ErrorType);
  assertNonEmptyString(amendment.timestamp, "amendment.timestamp", ErrorType);
  if (Number.isNaN(Date.parse(amendment.timestamp))) {
    throw new ErrorType("amendment.timestamp must be an ISO-compatible timestamp.");
  }

  if (
    !Array.isArray(amendment.obligationsAdded) ||
    !Array.isArray(amendment.obligationsChanged)
  ) {
    throw new ErrorType(
      "amendment obligationsAdded and obligationsChanged must be arrays.",
    );
  }

  const obligationsAdded = amendment.obligationsAdded.map((obligation) =>
    normalizeObligation(obligation, amendment.newContractVersion, ErrorType),
  );
  const obligationsChanged = amendment.obligationsChanged.map((obligation) =>
    normalizeObligation(obligation, amendment.newContractVersion, ErrorType),
  );
  const obligationsRemoved = normalizeUniqueStringArray(
    amendment.obligationsRemoved,
    "amendment.obligationsRemoved",
    { allowEmpty: true, identifier: true, ErrorType },
  );
  const affectedExistingObligationIds = normalizeUniqueStringArray(
    amendment.affectedExistingObligationIds,
    "amendment.affectedExistingObligationIds",
    { allowEmpty: true, identifier: true, ErrorType },
  );

  const changedIds = obligationsChanged.map(
    (obligation) => obligation.obligationId,
  );
  const addedIds = obligationsAdded.map(
    (obligation) => obligation.obligationId,
  );
  const allMutationIds = [...addedIds, ...changedIds, ...obligationsRemoved];
  if (new Set(allMutationIds).size !== allMutationIds.length) {
    throw new ErrorType(
      "An obligation may appear in only one amendment operation.",
    );
  }
  if (allMutationIds.length === 0) {
    throw new ErrorType("A contract amendment must make at least one change.");
  }

  return {
    amendmentId: amendment.amendmentId,
    previousContractVersion: amendment.previousContractVersion,
    newContractVersion: amendment.newContractVersion,
    obligationsAdded,
    obligationsChanged,
    obligationsRemoved,
    reason: amendment.reason.trim(),
    affectedExistingObligationIds,
    timestamp: amendment.timestamp,
  };
}

export function applyContractAmendment(currentContract, amendment) {
  if (currentContract === null) {
    throw new InvalidContractAmendmentError(
      "A contract amendment requires an existing Requirement Contract.",
    );
  }

  const normalized = normalizeAmendmentShape(amendment);
  if (
    normalized.previousContractVersion !== currentContract.contractVersion ||
    normalized.newContractVersion !== currentContract.contractVersion + 1
  ) {
    throw new InvalidContractAmendmentError(
      `Amendment versions must advance contract version ${currentContract.contractVersion} to ${currentContract.contractVersion + 1}.`,
    );
  }
  if (
    currentContract.amendments.some(
      (existing) => existing.amendmentId === normalized.amendmentId,
    )
  ) {
    throw new InvalidContractAmendmentError(
      `Amendment ID "${normalized.amendmentId}" has already been recorded.`,
    );
  }

  const previousById = new Map(
    currentContract.obligations.map((obligation) => [
      obligation.obligationId,
      obligation,
    ]),
  );
  const addedIds = normalized.obligationsAdded.map(
    (obligation) => obligation.obligationId,
  );
  const changedIds = normalized.obligationsChanged.map(
    (obligation) => obligation.obligationId,
  );

  for (const addedId of addedIds) {
    if (previousById.has(addedId)) {
      throw new InvalidContractAmendmentError(
        `Added obligation "${addedId}" already exists.`,
      );
    }
  }
  for (const existingId of [
    ...changedIds,
    ...normalized.obligationsRemoved,
    ...normalized.affectedExistingObligationIds,
  ]) {
    if (!previousById.has(existingId)) {
      throw new InvalidContractAmendmentError(
        `Amendment references unknown existing obligation "${existingId}".`,
      );
    }
  }

  const requiredAffectedIds = [
    ...changedIds,
    ...normalized.obligationsRemoved,
  ];
  for (const affectedId of requiredAffectedIds) {
    if (!normalized.affectedExistingObligationIds.includes(affectedId)) {
      throw new InvalidContractAmendmentError(
        `Affected existing obligations must include "${affectedId}".`,
      );
    }
  }

  const nextById = new Map();
  for (const obligation of currentContract.obligations) {
    if (!normalized.obligationsRemoved.includes(obligation.obligationId)) {
      nextById.set(obligation.obligationId, {
        ...structuredClone(obligation),
        contractVersion: normalized.newContractVersion,
      });
    }
  }
  for (const obligation of normalized.obligationsChanged) {
    nextById.set(obligation.obligationId, structuredClone(obligation));
  }
  for (const obligation of normalized.obligationsAdded) {
    nextById.set(obligation.obligationId, structuredClone(obligation));
  }

  const nextObligations = [...nextById.values()];
  if (nextObligations.length === 0) {
    throw new InvalidContractAmendmentError(
      "A contract amendment cannot remove every obligation.",
    );
  }
  validateDependencyGraph(nextObligations, InvalidContractAmendmentError);

  return {
    amendment: normalized,
    contract: {
      missionId: currentContract.missionId,
      contractVersion: normalized.newContractVersion,
      obligations: nextObligations,
      createdAt: currentContract.createdAt,
      amendments: [...currentContract.amendments, normalized],
    },
  };
}

export function projectRequirementContract(records, missionId) {
  let current = null;

  for (const record of records) {
    if (record.type === CONTRACT_CREATED_EVENT) {
      if (current !== null) {
        throw new ContractValidationError(
          `Mission "${missionId}" contains more than one initial Requirement Contract.`,
        );
      }
      const created = normalizeContractCreation(record.contract);
      current = {
        missionId,
        contractVersion: created.contractVersion,
        obligations: created.obligations,
        createdAt: record.occurredAt,
        amendments: [],
      };
    } else if (record.type === CONTRACT_AMENDED_EVENT) {
      current = applyContractAmendment(current, record.amendment).contract;
    }
  }

  return current === null
    ? null
    : deepFreeze(structuredClone(current));
}

export function projectContractHistory(records, missionId) {
  const history = [];
  let current = null;

  for (const record of records) {
    if (record.type === CONTRACT_CREATED_EVENT) {
      if (current !== null) {
        throw new ContractValidationError(
          `Mission "${missionId}" contains more than one initial Requirement Contract.`,
        );
      }
      const created = normalizeContractCreation(record.contract);
      current = {
        missionId,
        contractVersion: created.contractVersion,
        obligations: created.obligations,
        createdAt: record.occurredAt,
        amendments: [],
      };
      history.push({
        eventId: record.eventId,
        eventType: record.type,
        timestamp: record.occurredAt,
        contract: structuredClone(current),
      });
    } else if (record.type === CONTRACT_AMENDED_EVENT) {
      current = applyContractAmendment(current, record.amendment).contract;
      history.push({
        eventId: record.eventId,
        eventType: record.type,
        timestamp: record.amendment.timestamp,
        contract: structuredClone(current),
      });
    }
  }

  return deepFreeze(history);
}
