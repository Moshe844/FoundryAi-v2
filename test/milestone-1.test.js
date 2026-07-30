import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as publicApi from "../src/index.js";
import {
  ACTIVE_MISSION_STATES,
  ContractNotFoundError,
  DuplicateEventError,
  IllegalTransitionError,
  LEGAL_TRANSITIONS,
  LedgerCorruptionError,
  MISSION_STATES,
  MissionState,
  TERMINAL_MISSION_STATES,
  TerminalStateError,
  WorkspaceNotFoundError,
  openMissionControl,
} from "../src/index.js";

const FIXED_TIME = "2026-01-01T00:00:00.000Z";

function temporaryLedger(t) {
  const directory = mkdtempSync(join(tmpdir(), "foundry-v2-ledger-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function input(missionId, eventNumber, to) {
  return {
    missionId,
    eventId: `${missionId}-event-${eventNumber}`,
    causationId: `${missionId}-command-${eventNumber}`,
    occurredAt: FIXED_TIME,
    reason: `Advance ${missionId} to ${to}.`,
    to,
  };
}

function transition(control, transitionInput) {
  if (
    transitionInput.to === MissionState.CONTRACTED &&
    control.orchestrator.state(transitionInput.missionId).state ===
      MissionState.INTAKE
  ) {
    try {
      control.contracts.getContract(transitionInput.missionId);
    } catch (error) {
      if (!(error instanceof ContractNotFoundError)) {
        throw error;
      }
      control.contracts.createContract({
        missionId: transitionInput.missionId,
        eventId: `${transitionInput.eventId}-contract`,
        causationId: `${transitionInput.causationId}-contract`,
        occurredAt: transitionInput.occurredAt,
        contractVersion: 1,
        obligations: [
          {
            obligationId: "lifecycle-obligation",
            statement: "The mission follows the permanent lifecycle.",
            origin: "foundry-derived",
            acceptanceCondition: {
              type: "command-exit-code-equals",
              expectedExitCode: 0,
            },
            requiredEvidenceKinds: ["command-exit-result"],
            dependencyObligationIds: [],
            contractVersion: 1,
          },
        ],
      });
    }
  }
  const currentState = control.orchestrator.state(
    transitionInput.missionId,
  ).state;
  if (
    currentState === MissionState.PROVISIONING &&
    transitionInput.to === MissionState.EXECUTING
  ) {
    try {
      control.workspaces.getWorkspace(transitionInput.missionId);
    } catch (error) {
      if (!(error instanceof WorkspaceNotFoundError)) {
        throw error;
      }
      control.workspaces.provisionWorkspace({
        missionId: transitionInput.missionId,
        workspaceId: `${transitionInput.missionId}-workspace`,
        baselineCheckpointId: `${transitionInput.missionId}-baseline`,
        evidenceId: `${transitionInput.missionId}-provision-evidence`,
        eventId: `${transitionInput.eventId}-workspace`,
        causationId: `${transitionInput.causationId}-workspace`,
        reason: "Provision deterministic lifecycle fixture workspace.",
        occurredAt: transitionInput.occurredAt,
      });
    }
  }
  if (
    currentState === MissionState.VERIFYING &&
    (transitionInput.to === MissionState.SUCCEEDED ||
      transitionInput.to === MissionState.REPAIRING)
  ) {
    const evidenceByObligation = {};
    const checkpointId = control.workspaces.getWorkspace(
      transitionInput.missionId,
    ).currentCheckpointId;
    if (transitionInput.to === MissionState.SUCCEEDED) {
      const evidenceId = `${transitionInput.eventId}-evidence`;
      control.evidence.capture({
        evidenceId,
        missionId: transitionInput.missionId,
        kind: "command-exit-result",
        captureMethod: "deterministic lifecycle fixture",
        producingSubsystem: "MILESTONE_1_TEST",
        timestamp: transitionInput.occurredAt,
        payload: { exitCode: 0, stdout: "ok", stderr: "" },
        obligationReference: "lifecycle-obligation",
        workspaceCheckpointReference: checkpointId,
        commandReference: null,
        workUnitReference: null,
        metadata: {},
      });
      evidenceByObligation["lifecycle-obligation"] = [evidenceId];
    }
    control.verification.verify({
      missionId: transitionInput.missionId,
      verdictId: `${transitionInput.eventId}-verdict`,
      eventId: `${transitionInput.eventId}-verification`,
      causationId: `${transitionInput.causationId}-verification`,
      verificationTimestamp: transitionInput.occurredAt,
      workspaceCheckpointReference: checkpointId,
      evidenceByObligation,
    });
  }
  return control.orchestrator.transition(transitionInput);
}

const pathToActiveState = Object.freeze({
  [MissionState.INTAKE]: [],
  [MissionState.CLARIFYING]: [MissionState.CLARIFYING],
  [MissionState.CONTRACTED]: [MissionState.CONTRACTED],
  [MissionState.PROVISIONING]: [
    MissionState.CONTRACTED,
    MissionState.PROVISIONING,
  ],
  [MissionState.EXECUTING]: [
    MissionState.CONTRACTED,
    MissionState.PROVISIONING,
    MissionState.EXECUTING,
  ],
  [MissionState.VERIFYING]: [
    MissionState.CONTRACTED,
    MissionState.PROVISIONING,
    MissionState.EXECUTING,
    MissionState.VERIFYING,
  ],
  [MissionState.REPAIRING]: [
    MissionState.CONTRACTED,
    MissionState.PROVISIONING,
    MissionState.EXECUTING,
    MissionState.VERIFYING,
    MissionState.REPAIRING,
  ],
});

function createAtActiveState(control, missionId, targetState) {
  control.orchestrator.createMission({
    ...input(missionId, 1, MissionState.INTAKE),
    reason: "Create mission.",
  });

  let eventNumber = 2;
  for (const state of pathToActiveState[targetState]) {
    transition(control, input(missionId, eventNumber, state));
    eventNumber += 1;
  }
  return eventNumber;
}

test("the lifecycle contains exactly the twelve permanent states", () => {
  assert.deepEqual(MISSION_STATES, [
    "INTAKE",
    "CLARIFYING",
    "CONTRACTED",
    "PROVISIONING",
    "EXECUTING",
    "VERIFYING",
    "REPAIRING",
    "SUCCEEDED",
    "FAILED",
    "BLOCKED",
    "EXHAUSTED",
    "CANCELLED",
  ]);
  assert.equal(new Set(MISSION_STATES).size, 12);
});

test("every declared legal state transition succeeds or reaches its later milestone guard", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  let missionNumber = 0;

  for (const from of ACTIVE_MISSION_STATES) {
    for (const to of LEGAL_TRANSITIONS[from]) {
      missionNumber += 1;
      const missionId = `valid-${missionNumber}`;
      const eventNumber = createAtActiveState(control, missionId, from);

      if (
        from === MissionState.REPAIRING &&
        [
          MissionState.EXECUTING,
          MissionState.FAILED,
          MissionState.BLOCKED,
          MissionState.EXHAUSTED,
        ].includes(to)
      ) {
        assert.throws(() =>
          transition(control, input(missionId, eventNumber, to)),
        );
        assert.equal(
          control.orchestrator.state(missionId).state,
          MissionState.REPAIRING,
        );
        continue;
      }
      transition(control, input(missionId, eventNumber, to));

      assert.equal(control.orchestrator.state(missionId).state, to);
    }
  }
});

test("every undeclared transition from an active state is rejected without an append", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  let missionNumber = 0;

  for (const from of ACTIVE_MISSION_STATES) {
    for (const to of MISSION_STATES) {
      if (LEGAL_TRANSITIONS[from].includes(to)) {
        continue;
      }

      missionNumber += 1;
      const missionId = `invalid-${missionNumber}`;
      const eventNumber = createAtActiveState(control, missionId, from);
      const before = control.ledger.listEvents(missionId);

      assert.throws(
        () =>
          transition(control, input(missionId, eventNumber, to)),
        IllegalTransitionError,
      );
      assert.deepEqual(control.ledger.listEvents(missionId), before);
      assert.equal(control.orchestrator.state(missionId).state, from);
    }
  }
});

test("all terminal states reject every further transition", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const terminalPaths = {
    [MissionState.SUCCEEDED]: [
      MissionState.CONTRACTED,
      MissionState.PROVISIONING,
      MissionState.EXECUTING,
      MissionState.VERIFYING,
      MissionState.SUCCEEDED,
    ],
    [MissionState.FAILED]: [
      MissionState.CONTRACTED,
      MissionState.PROVISIONING,
      MissionState.FAILED,
    ],
    [MissionState.BLOCKED]: [
      MissionState.CLARIFYING,
      MissionState.BLOCKED,
    ],
    [MissionState.EXHAUSTED]: [MissionState.EXHAUSTED],
    [MissionState.CANCELLED]: [MissionState.CANCELLED],
  };

  for (const terminalState of TERMINAL_MISSION_STATES) {
    const missionId = `terminal-${terminalState.toLowerCase()}`;
    control.orchestrator.createMission({
      ...input(missionId, 1, MissionState.INTAKE),
      reason: "Create mission.",
    });
    let eventNumber = 2;
    for (const state of terminalPaths[terminalState]) {
      transition(control, input(missionId, eventNumber, state));
      eventNumber += 1;
    }

    for (const target of MISSION_STATES) {
      assert.throws(
        () =>
          transition(
            control,
            input(missionId, eventNumber, target),
          ),
        TerminalStateError,
      );
    }
    assert.equal(control.orchestrator.state(missionId).state, terminalState);
  }
});

test("an event ID cannot be appended twice, including after restart", (t) => {
  const directory = temporaryLedger(t);
  const firstProcess = openMissionControl({ ledgerDirectory: directory });
  const missionId = "duplicate-event";
  createAtActiveState(firstProcess, missionId, MissionState.CONTRACTED);
  const original = firstProcess.ledger.listEvents(missionId);
  const duplicateEventId = original.at(-1).eventId;

  const restartedProcess = openMissionControl({ ledgerDirectory: directory });
  assert.throws(
    () =>
      transition(restartedProcess, {
        ...input(missionId, 3, MissionState.PROVISIONING),
        eventId: duplicateEventId,
      }),
    DuplicateEventError,
  );

  assert.deepEqual(restartedProcess.ledger.listEvents(missionId), original);
  assert.equal(
    restartedProcess.orchestrator.state(missionId).state,
    MissionState.CONTRACTED,
  );
});

test("replaying identical persisted events is deterministic", (t) => {
  const firstDirectory = temporaryLedger(t);
  const secondDirectory = temporaryLedger(t);
  const missionId = "deterministic-replay";
  const targets = [
    MissionState.CONTRACTED,
    MissionState.PROVISIONING,
    MissionState.EXECUTING,
    MissionState.VERIFYING,
    MissionState.REPAIRING,
    MissionState.CANCELLED,
  ];

  for (const directory of [firstDirectory, secondDirectory]) {
    const control = openMissionControl({ ledgerDirectory: directory });
    control.orchestrator.createMission({
      ...input(missionId, 1, MissionState.INTAKE),
      reason: "Create mission.",
    });
    targets.forEach((target, index) => {
      transition(control, input(missionId, index + 2, target));
    });
  }

  const first = openMissionControl({ ledgerDirectory: firstDirectory });
  const second = openMissionControl({ ledgerDirectory: secondDirectory });
  const portableEvents = (events) =>
    events.map(({ hash, previousHash, ...event }) => ({
      ...event,
      ...(event.workspaceFact === undefined
        ? {}
        : {
            workspaceFact: {
              ...event.workspaceFact,
              rootPath:
                event.workspaceFact.rootPath === null
                  ? null
                  : "<assigned-workspace-root>",
            },
          }),
    }));
  assert.deepEqual(
    portableEvents(first.ledger.listEvents(missionId)),
    portableEvents(second.ledger.listEvents(missionId)),
  );
  assert.deepEqual(
    first.orchestrator.state(missionId),
    second.orchestrator.state(missionId),
  );
});

test("restart reconstructs the exact state after every completed transition", (t) => {
  const directory = temporaryLedger(t);
  const missionId = "restart-every-boundary";
  const states = [
    MissionState.INTAKE,
    MissionState.CONTRACTED,
    MissionState.PROVISIONING,
    MissionState.EXECUTING,
    MissionState.VERIFYING,
    MissionState.REPAIRING,
    MissionState.CANCELLED,
  ];

  let control = openMissionControl({ ledgerDirectory: directory });
  control.orchestrator.createMission({
    ...input(missionId, 1, MissionState.INTAKE),
    reason: "Create mission.",
  });

  states.forEach((expectedState, index) => {
    control = openMissionControl({ ledgerDirectory: directory });
    assert.equal(control.orchestrator.state(missionId).state, expectedState);
    assert.equal(
      control.ledger
        .listEvents(missionId)
        .filter((event) => event.type === "MISSION_TRANSITION").length,
      index + 1,
    );
    if (index + 1 < states.length) {
      transition(
        control,
        input(missionId, index + 2, states[index + 1]),
      );
    }
  });
});

test("restart removes an abandoned writer lock and resumes from persisted events", (t) => {
  const directory = temporaryLedger(t);
  const missionId = "abandoned-lock";
  const firstProcess = openMissionControl({ ledgerDirectory: directory });
  createAtActiveState(firstProcess, missionId, MissionState.CONTRACTED);

  writeFileSync(
    join(directory, `${missionId}.jsonl.lock`),
    `${JSON.stringify({ pid: 999_999_999 })}\n`,
    "utf8",
  );

  const restartedProcess = openMissionControl({ ledgerDirectory: directory });
  transition(
    restartedProcess,
    input(missionId, 3, MissionState.PROVISIONING),
  );
  assert.equal(
    restartedProcess.orchestrator.state(missionId).state,
    MissionState.PROVISIONING,
  );
});

test("only the Orchestrator exposes transition authority", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });

  assert.deepEqual(Object.keys(control.ledger).sort(), [
    "listEvents",
    "projectState",
    "reportEvents",
  ]);
  assert.equal(control.ledger.append, undefined);
  assert.equal(control.ledger.appendTransition, undefined);
  assert.equal(publicApi.MissionLedger, undefined);
  assert.equal(publicApi.appendTransition, undefined);
  assert(Object.isFrozen(control));
  assert(Object.isFrozen(control.ledger));
  assert(Object.isFrozen(control.orchestrator));
});

test("mission state is a replayed projection, never a mutable authoritative field", (t) => {
  const directory = temporaryLedger(t);
  const missionId = "projection-only";
  const firstReader = openMissionControl({ ledgerDirectory: directory });
  firstReader.orchestrator.createMission({
    ...input(missionId, 1, MissionState.INTAKE),
    reason: "Create mission.",
  });
  const oldProjection = firstReader.orchestrator.state(missionId);

  const independentWriter = openMissionControl({ ledgerDirectory: directory });
  transition(
    independentWriter,
    input(missionId, 2, MissionState.CONTRACTED),
  );

  assert.equal(oldProjection.state, MissionState.INTAKE);
  assert(Object.isFrozen(oldProjection));
  assert.equal(
    firstReader.orchestrator.state(missionId).state,
    MissionState.CONTRACTED,
  );

  const files = readdirSync(directory);
  assert.deepEqual(files, [`${missionId}.jsonl`]);
  for (const event of firstReader.ledger.listEvents(missionId)) {
    assert.equal(Object.hasOwn(event, "state"), false);
    assert(Object.isFrozen(event));
    assert(Object.isFrozen(event.transition));
  }
});

test("the persisted Ledger is append-only and detects tampering", (t) => {
  const directory = temporaryLedger(t);
  const missionId = "append-only-integrity";
  const control = openMissionControl({ ledgerDirectory: directory });
  control.orchestrator.createMission({
    ...input(missionId, 1, MissionState.INTAKE),
    reason: "Create mission.",
  });
  const ledgerPath = join(directory, `${missionId}.jsonl`);
  const originalBytes = readFileSync(ledgerPath, "utf8");

  transition(
    control,
    input(missionId, 2, MissionState.CONTRACTED),
  );
  const appendedBytes = readFileSync(ledgerPath, "utf8");
  assert(appendedBytes.startsWith(originalBytes));

  writeFileSync(
    ledgerPath,
    appendedBytes.replace('"to":"CONTRACTED"', '"to":"SUCCEEDED"'),
    "utf8",
  );
  assert.throws(
    () => control.ledger.projectState(missionId),
    LedgerCorruptionError,
  );
});
