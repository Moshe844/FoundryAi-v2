export const MissionState = Object.freeze({
  INTAKE: "INTAKE",
  CLARIFYING: "CLARIFYING",
  CONTRACTED: "CONTRACTED",
  PROVISIONING: "PROVISIONING",
  EXECUTING: "EXECUTING",
  VERIFYING: "VERIFYING",
  REPAIRING: "REPAIRING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  BLOCKED: "BLOCKED",
  EXHAUSTED: "EXHAUSTED",
  CANCELLED: "CANCELLED",
});

export const MISSION_STATES = Object.freeze(Object.values(MissionState));

export const ACTIVE_MISSION_STATES = Object.freeze([
  MissionState.INTAKE,
  MissionState.CLARIFYING,
  MissionState.CONTRACTED,
  MissionState.PROVISIONING,
  MissionState.EXECUTING,
  MissionState.VERIFYING,
  MissionState.REPAIRING,
]);

export const TERMINAL_MISSION_STATES = Object.freeze([
  MissionState.SUCCEEDED,
  MissionState.FAILED,
  MissionState.BLOCKED,
  MissionState.EXHAUSTED,
  MissionState.CANCELLED,
]);

const forcedTerminalTargets = [
  MissionState.EXHAUSTED,
  MissionState.CANCELLED,
];

export const LEGAL_TRANSITIONS = Object.freeze({
  [MissionState.INTAKE]: Object.freeze([
    MissionState.CLARIFYING,
    MissionState.CONTRACTED,
    ...forcedTerminalTargets,
  ]),
  [MissionState.CLARIFYING]: Object.freeze([
    MissionState.INTAKE,
    MissionState.BLOCKED,
    ...forcedTerminalTargets,
  ]),
  [MissionState.CONTRACTED]: Object.freeze([
    MissionState.PROVISIONING,
    ...forcedTerminalTargets,
  ]),
  [MissionState.PROVISIONING]: Object.freeze([
    MissionState.EXECUTING,
    MissionState.FAILED,
    ...forcedTerminalTargets,
  ]),
  [MissionState.EXECUTING]: Object.freeze([
    MissionState.VERIFYING,
    MissionState.FAILED,
    ...forcedTerminalTargets,
  ]),
  [MissionState.VERIFYING]: Object.freeze([
    MissionState.SUCCEEDED,
    MissionState.REPAIRING,
    MissionState.FAILED,
    ...forcedTerminalTargets,
  ]),
  [MissionState.REPAIRING]: Object.freeze([
    MissionState.EXECUTING,
    MissionState.FAILED,
    MissionState.BLOCKED,
    ...forcedTerminalTargets,
  ]),
  [MissionState.SUCCEEDED]: Object.freeze([]),
  [MissionState.FAILED]: Object.freeze([]),
  [MissionState.BLOCKED]: Object.freeze([]),
  [MissionState.EXHAUSTED]: Object.freeze([]),
  [MissionState.CANCELLED]: Object.freeze([]),
});

const missionStateSet = new Set(MISSION_STATES);
const terminalMissionStateSet = new Set(TERMINAL_MISSION_STATES);

export function isMissionState(value) {
  return missionStateSet.has(value);
}

export function isTerminalMissionState(value) {
  return terminalMissionStateSet.has(value);
}

export function isLegalTransition(from, to) {
  return isMissionState(from) && isMissionState(to)
    ? LEGAL_TRANSITIONS[from].includes(to)
    : false;
}
