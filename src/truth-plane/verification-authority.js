import {
  EvidenceReferenceError,
  VerificationStateError,
  VerificationValidationError,
} from "../domain/errors.js";
import { MissionState } from "../domain/lifecycle.js";
import {
  ObligationVerdictResult,
  COMPLETION_VERDICT_EVENT,
  acceptanceConditionIsCheckpointIndependent,
  createCompletionVerdict,
  evaluateAcceptanceCondition,
  normalizeAcceptanceCondition,
} from "../domain/verification.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

// The work plane records an accepted design shortfall as a finding: a build
// delivered with every behavioural obligation proven but the approved design
// not reproduced in some measured aspect. The verdict must carry it, so it is
// read back here from the mission's own evidence.
function acceptedDesignShortfall(evidence, missionId) {
  const record = (evidence.findByMission(missionId) ?? [])
    .filter(
      (candidate) =>
        candidate.payload?.recordType === "design-fidelity-shortfall" &&
        candidate.payload?.record?.accepted === true,
    )
    .at(-1);
  if (record === undefined) return null;
  const failedAspects = (record.payload.record.failedAspects ?? []).filter(
    (aspect) => typeof aspect === "string" && aspect.trim() !== "",
  );
  // A shortfall was accepted, so something fell short. If the aspect names did
  // not survive, say so rather than reporting a clean verdict.
  return {
    comparedViewports: record.payload.record.comparedViewports ?? null,
    failedAspects:
      failedAspects.length > 0 ? failedAspects : ["unnamed design aspects"],
    reason:
      typeof record.payload.record.reason === "string" &&
      record.payload.record.reason.trim() !== ""
        ? record.payload.record.reason
        : "The approved design was not fully reproduced.",
  };
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new VerificationValidationError(`${label} is malformed.`);
  }
}

function normalizeNullableIdentifier(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  assertIdentifier(value, label);
  return value;
}

function normalizeEvidenceSelections(input, obligationIds) {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new VerificationValidationError(
      "evidenceByObligation must be a plain object.",
    );
  }
  const activeIds = new Set(obligationIds);
  for (const obligationId of Object.keys(input)) {
    if (!activeIds.has(obligationId)) {
      throw new VerificationValidationError(
        `Evidence was supplied for inactive obligation "${obligationId}".`,
      );
    }
    if (!Array.isArray(input[obligationId])) {
      throw new VerificationValidationError(
        `Evidence selection for "${obligationId}" must be an array.`,
      );
    }
    const ids = new Set();
    for (const evidenceId of input[obligationId]) {
      assertIdentifier(
        evidenceId,
        `evidenceByObligation.${obligationId} evidence ID`,
      );
      if (ids.has(evidenceId)) {
        throw new VerificationValidationError(
          `Evidence "${evidenceId}" is duplicated for obligation "${obligationId}".`,
        );
      }
      ids.add(evidenceId);
    }
  }
  return input;
}

function loadApplicableEvidence({
  evidence,
  evidenceIds,
  missionId,
  obligation,
  activeObligations,
  verificationRequestReference,
  workspaceCheckpointReference,
}) {
  const checkpointIndependent = acceptanceConditionIsCheckpointIndependent(
    obligation.acceptanceCondition,
  );

  return evidenceIds.map((evidenceId) => {
    let record;
    try {
      record = evidence.getById(evidenceId);
    } catch (error) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" is missing or failed integrity validation.`,
        evidenceId,
        { cause: error },
      );
    }
    if (record.missionId !== missionId) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" belongs to another mission.`,
        evidenceId,
      );
    }
    const directlyBound =
      record.obligationReference === obligation.obligationId;
    const requestBound =
      verificationRequestReference !== null &&
      record.verificationRequestReference === verificationRequestReference;
    const equivalentObligationBound = activeObligations.some(
      (candidate) =>
        candidate.obligationId === record.obligationReference &&
        JSON.stringify(
          normalizeAcceptanceCondition(candidate.acceptanceCondition),
        ) ===
          JSON.stringify(
            normalizeAcceptanceCondition(obligation.acceptanceCondition),
          ) &&
        JSON.stringify([...candidate.requiredEvidenceKinds].sort()) ===
          JSON.stringify([...obligation.requiredEvidenceKinds].sort()),
    );
    if (!directlyBound && !requestBound && !equivalentObligationBound) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" is not bound to obligation "${obligation.obligationId}" or this verification request.`,
        evidenceId,
      );
    }
    if (!obligation.requiredEvidenceKinds.includes(record.kind)) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" has kind "${record.kind}", which is not required by obligation "${obligation.obligationId}".`,
        evidenceId,
      );
    }
    if (
      !checkpointIndependent &&
      record.workspaceCheckpointReference !== workspaceCheckpointReference
    ) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" is bound to a stale or different workspace checkpoint.`,
        evidenceId,
      );
    }
    return record;
  });
}

function evaluateObligation(obligation, records) {
  normalizeAcceptanceCondition(obligation.acceptanceCondition);
  const availableKinds = new Set(records.map((record) => record.kind));
  const missingKinds = obligation.requiredEvidenceKinds.filter(
    (kind) => !availableKinds.has(kind),
  );
  const evaluation =
    missingKinds.length > 0
      ? {
          result: ObligationVerdictResult.UNVERIFIABLE,
          evidenceIds: [],
          detail: `Required evidence kind(s) unavailable: ${missingKinds.join(", ")}.`,
        }
      : evaluateAcceptanceCondition(obligation.acceptanceCondition, records);
  const evidenceReferences = records
    .map((record) => ({
      evidenceId: record.evidenceId,
      verificationRequestReference: record.verificationRequestReference,
      workspaceCheckpointReference: record.workspaceCheckpointReference,
    }))
    .sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));

  return {
    obligationId: obligation.obligationId,
    result: evaluation.result,
    evidenceReferences,
    deficiency:
      evaluation.result === ObligationVerdictResult.NOT_SATISFIED
        ? evaluation.detail
        : null,
    unverifiableCondition:
      evaluation.result === ObligationVerdictResult.UNVERIFIABLE
        ? evaluation.detail
        : null,
  };
}

export function createVerificationAuthority({
  ledger,
  evidence,
  contracts,
  clock,
}) {
  return Object.freeze({
    verify({
      missionId,
      verdictId,
      eventId,
      causationId,
      evidenceByObligation = {},
      workspaceCheckpointReference = null,
      verificationRequestReference = null,
      verificationTimestamp = clock(),
    }) {
      assertIdentifier(verdictId, "verdictId");
      assertIdentifier(eventId, "eventId");
      assertIdentifier(causationId, "causationId");
      const checkpoint = normalizeNullableIdentifier(
        workspaceCheckpointReference,
        "workspaceCheckpointReference",
      );
      const requestReference = normalizeNullableIdentifier(
        verificationRequestReference,
        "verificationRequestReference",
      );
      if (
        typeof verificationTimestamp !== "string" ||
        Number.isNaN(Date.parse(verificationTimestamp))
      ) {
        throw new VerificationValidationError(
          "verificationTimestamp must be an ISO-compatible timestamp.",
        );
      }

      const state = ledger.projectState(missionId).state;
      if (state !== MissionState.VERIFYING) {
        throw new VerificationStateError(missionId, state);
      }
      const contract = contracts.getContract(missionId);
      const selections = normalizeEvidenceSelections(
        evidenceByObligation,
        contract.obligations.map((obligation) => obligation.obligationId),
      );
      const obligationVerdicts = contract.obligations.map((obligation) => {
        const records = loadApplicableEvidence({
          evidence,
          evidenceIds: selections[obligation.obligationId] ?? [],
          missionId,
          obligation,
          activeObligations: contract.obligations,
          verificationRequestReference: requestReference,
          workspaceCheckpointReference: checkpoint,
        });
        return evaluateObligation(obligation, records);
      });
      const completionVerdict = createCompletionVerdict({
        verdictId,
        missionId,
        contractVersion: contract.contractVersion,
        verificationTimestamp,
        workspaceCheckpointReference: checkpoint,
        obligationVerdicts,
        // Read from the mission's own evidence rather than accepted from the
        // caller, so a delivered shortfall cannot be omitted by whoever asks
        // for the verdict. Before this, the record existed and nothing read it:
        // a build that missed the approved design on three aspects was reported
        // as fourteen of fourteen satisfied, with the shortfall nowhere.
        designShortfall: acceptedDesignShortfall(evidence, missionId),
      });
      ledger.appendCompletionVerdict({
        missionId,
        eventId,
        causationId,
        occurredAt: verificationTimestamp,
        completionVerdict,
      });
      return completionVerdict;
    },

    getLatestVerdict(missionId) {
      const event = ledger
        .listEvents(missionId)
        .findLast((record) => record.type === COMPLETION_VERDICT_EVENT);
      return event === undefined
        ? null
        : Object.freeze(structuredClone(event.completionVerdict));
    },
  });
}
