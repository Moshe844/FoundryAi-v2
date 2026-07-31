import {
  APPROVED_PROJECT_CONTRACT_SOURCE,
  createApprovedProjectContract,
  normalizeApprovedProjectContract,
} from "../domain/approved-project-contract.js";
import { MissionState } from "../domain/lifecycle.js";

function history(ledger, missionId) {
  return ledger.listEvents(missionId)
    .map((record) => record.fact?.metadata?.approvedProjectContract)
    .filter(Boolean)
    .map(normalizeApprovedProjectContract);
}

function latestUnderstandingSupport(ledger, missionId) {
  const fact = [...ledger.listEvents(missionId)]
    .reverse()
    .find((record) => record.fact?.metadata?.projectDesign !== undefined)
    ?.fact;
  return {
    evidenceReferences: fact?.evidenceReferences ?? [],
    workUnitReference: fact?.workUnitReference ?? null,
  };
}

export function createApprovedProjectContractService({ ledger, facts, clock }) {
  return Object.freeze({
    approve({
      missionId,
      eventId,
      causationId,
      contract,
      evidenceReferences = null,
      workUnitReference = null,
    }) {
      const support = latestUnderstandingSupport(ledger, missionId);
      const supportingEvidence = evidenceReferences ?? support.evidenceReferences;
      const supportingWorkUnit = workUnitReference ?? support.workUnitReference;
      const state = ledger.projectState(missionId).state;
      if (state !== MissionState.INTAKE) throw new TypeError(`An ApprovedProjectContract can be approved only during INTAKE, not ${state}.`);
      const existing = history(ledger, missionId);
      const expectedVersion = (existing.at(-1)?.contractVersion ?? 0) + 1;
      if (contract.contractVersion !== expectedVersion) throw new TypeError(`ApprovedProjectContract version must advance to ${expectedVersion}.`);
      const approved = createApprovedProjectContract({
        ...contract,
        missionId,
        approvalTimestamp: contract.approvalTimestamp ?? clock(),
      });
      facts.recordResultFact({
        missionId,
        eventId,
        causationId,
        occurredAt: approved.approvalTimestamp,
        producingSubsystem: APPROVED_PROJECT_CONTRACT_SOURCE,
        statement: `Approved project contract version ${approved.contractVersion} was frozen.`,
        evidenceReferences: supportingEvidence,
        workUnitReference: supportingWorkUnit,
        metadata: { approvedProjectContract: approved },
      });
      return history(ledger, missionId).at(-1);
    },

    latest(missionId) {
      return history(ledger, missionId).at(-1) ?? null;
    },

    history(missionId) {
      return Object.freeze(history(ledger, missionId));
    },
  });
}
