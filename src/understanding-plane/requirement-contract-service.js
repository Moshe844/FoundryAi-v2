import {
  ContractAlreadyExistsError,
  ContractNotFoundError,
  ContractStateError,
} from "../domain/errors.js";
import { MissionState, isTerminalMissionState } from "../domain/lifecycle.js";
import {
  applyContractAmendment,
  normalizeContractCreation,
  projectContractHistory,
  projectRequirementContract,
} from "../domain/requirement-contract.js";

export function createRequirementContractService({ ledger, clock }) {
  function readContract(missionId) {
    return projectRequirementContract(ledger.listEvents(missionId), missionId);
  }

  return Object.freeze({
    createContract({
      missionId,
      eventId,
      causationId,
      contractVersion,
      obligations,
      occurredAt = clock(),
    }) {
      const state = ledger.projectState(missionId).state;
      if (state !== MissionState.INTAKE) {
        throw new ContractStateError(missionId, state, "create");
      }
      if (readContract(missionId) !== null) {
        throw new ContractAlreadyExistsError(missionId);
      }

      const contract = normalizeContractCreation({
        contractVersion,
        obligations,
      });
      ledger.appendContractCreation({
        missionId,
        eventId,
        causationId,
        occurredAt,
        contract,
      });
      return readContract(missionId);
    },

    amendContract({
      missionId,
      eventId,
      causationId,
      amendment,
    }) {
      const state = ledger.projectState(missionId).state;
      if (isTerminalMissionState(state)) {
        throw new ContractStateError(missionId, state, "amend");
      }

      const current = readContract(missionId);
      if (current === null) {
        throw new ContractNotFoundError(missionId);
      }

      const normalized = applyContractAmendment(current, amendment).amendment;
      ledger.appendContractAmendment({
        missionId,
        eventId,
        causationId,
        occurredAt: normalized.timestamp,
        amendment: normalized,
      });
      return readContract(missionId);
    },

    getContract(missionId) {
      const contract = readContract(missionId);
      if (contract === null) {
        throw new ContractNotFoundError(missionId);
      }
      return contract;
    },

    getHistory(missionId) {
      const records = ledger.listEvents(missionId);
      const history = projectContractHistory(records, missionId);
      if (history.length === 0) {
        throw new ContractNotFoundError(missionId);
      }
      return history;
    },
  });
}

