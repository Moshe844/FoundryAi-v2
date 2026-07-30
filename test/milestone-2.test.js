import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CONTRACT_AMENDED_EVENT,
  CONTRACT_CREATED_EVENT,
  ContractRequiredError,
  ContractStateError,
  ContractValidationError,
  InvalidContractAmendmentError,
  MissionState,
  ObligationOrigin,
  openMissionControl,
} from "../src/index.js";

const CREATED_AT = "2026-02-01T00:00:00.000Z";
const AMENDED_AT = "2026-02-02T00:00:00.000Z";

function temporaryLedger(t) {
  const directory = mkdtempSync(join(tmpdir(), "foundry-v2-contract-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function createMission(control, missionId) {
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    occurredAt: CREATED_AT,
    reason: "Inventory mission intent received.",
  });
}

function obligation({
  obligationId,
  statement,
  origin = ObligationOrigin.CUSTOMER_STATED,
  acceptanceCondition,
  requiredEvidenceKinds = ["behavior-observation"],
  dependencyObligationIds = [],
  contractVersion = 1,
}) {
  return {
    obligationId,
    statement,
    origin,
    acceptanceCondition,
    requiredEvidenceKinds,
    dependencyObligationIds,
    contractVersion,
  };
}

function sampleInventoryObligations(version = 1) {
  return [
    obligation({
      obligationId: "create-product",
      statement: "A user can create a product with a name and stock quantity.",
      acceptanceCondition:
        "Submitting a product name and stock quantity records that product.",
      contractVersion: version,
    }),
    obligation({
      obligationId: "inventory-list",
      statement: "A created product appears in the inventory list.",
      acceptanceCondition:
        "After product creation, the inventory list displays its name and stock quantity.",
      dependencyObligationIds: ["create-product"],
      contractVersion: version,
    }),
    obligation({
      obligationId: "change-stock",
      statement: "A user can change an existing product's stock quantity.",
      acceptanceCondition:
        "Submitting a new quantity for an existing product records the new quantity.",
      dependencyObligationIds: ["create-product"],
      contractVersion: version,
    }),
    obligation({
      obligationId: "updated-stock",
      statement: "The updated stock quantity is displayed.",
      acceptanceCondition:
        "After a stock change, the inventory list displays the submitted quantity.",
      dependencyObligationIds: ["change-stock"],
      contractVersion: version,
    }),
    obligation({
      obligationId: "persistence-refresh",
      statement: "Product and stock data remain after application refresh.",
      acceptanceCondition:
        "After creating and updating a product, refreshing and reopening the application displays the same product and quantity.",
      requiredEvidenceKinds: [
        "behavior-observation",
        "persistence-observation",
      ],
      dependencyObligationIds: ["create-product", "change-stock"],
      contractVersion: version,
    }),
    obligation({
      obligationId: "build-success",
      statement: "The application builds successfully.",
      origin: ObligationOrigin.FOUNDRY_DERIVED,
      acceptanceCondition:
        "The real project build command exits successfully and produces its expected artifact.",
      requiredEvidenceKinds: ["build-result"],
      contractVersion: version,
    }),
    obligation({
      obligationId: "application-ready",
      statement: "The application starts and becomes ready.",
      origin: ObligationOrigin.FOUNDRY_DERIVED,
      acceptanceCondition:
        "The built application starts and its readiness observation succeeds.",
      requiredEvidenceKinds: ["runtime-readiness-observation"],
      dependencyObligationIds: ["build-success"],
      contractVersion: version,
    }),
    obligation({
      obligationId: "workflow-without-blocking-errors",
      statement:
        "The primary inventory workflow can be exercised without blocking runtime errors.",
      origin: ObligationOrigin.FOUNDRY_DERIVED,
      acceptanceCondition:
        "Creating a product, changing its quantity, and refreshing completes while runtime observation records no blocking error.",
      requiredEvidenceKinds: [
        "behavior-observation",
        "runtime-error-observation",
      ],
      dependencyObligationIds: [
        "inventory-list",
        "updated-stock",
        "persistence-refresh",
        "application-ready",
      ],
      contractVersion: version,
    }),
  ];
}

function createSampleContract(control, missionId) {
  return control.contracts.createContract({
    missionId,
    eventId: `${missionId}-contract-v1`,
    causationId: `${missionId}-contract-decision`,
    occurredAt: CREATED_AT,
    contractVersion: 1,
    obligations: sampleInventoryObligations(),
  });
}

function validAmendment() {
  return {
    amendmentId: "inventory-amendment-1",
    previousContractVersion: 1,
    newContractVersion: 2,
    obligationsAdded: [
      obligation({
        obligationId: "reject-negative-stock",
        statement: "Negative stock quantities are rejected.",
        origin: ObligationOrigin.FOUNDRY_DERIVED,
        acceptanceCondition:
          "Submitting a negative stock quantity is rejected and the stored quantity remains unchanged.",
        requiredEvidenceKinds: ["validation-observation"],
        dependencyObligationIds: ["create-product"],
        contractVersion: 2,
      }),
    ],
    obligationsChanged: [
      obligation({
        obligationId: "updated-stock",
        statement: "The updated stock quantity is displayed immediately.",
        acceptanceCondition:
          "After a stock change, the inventory list displays the submitted quantity without application refresh.",
        dependencyObligationIds: ["change-stock"],
        contractVersion: 2,
      }),
    ],
    obligationsRemoved: [],
    reason: "Make update visibility explicit and bind quantity validation.",
    affectedExistingObligationIds: ["updated-stock"],
    timestamp: AMENDED_AT,
  };
}

test("creates the sample inventory Requirement Contract with verifiable obligations", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "valid-contract";
  createMission(control, missionId);

  const contract = createSampleContract(control, missionId);

  assert.equal(contract.contractVersion, 1);
  assert.equal(contract.obligations.length, 8);
  assert(contract.obligations.every((item) => item.acceptanceCondition));
  assert(contract.obligations.every((item) => item.requiredEvidenceKinds.length));
  assert(contract.obligations.every((item) => item.contractVersion === 1));
  assert(Object.isFrozen(contract));
  assert(Object.isFrozen(contract.obligations));
});

test("rejects an empty Requirement Contract", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "empty-contract";
  createMission(control, missionId);

  assert.throws(
    () =>
      control.contracts.createContract({
        missionId,
        eventId: "empty-contract-event",
        causationId: "empty-contract-command",
        occurredAt: CREATED_AT,
        contractVersion: 1,
        obligations: [],
      }),
    ContractValidationError,
  );
  assert.equal(control.ledger.listEvents(missionId).length, 1);
});

test("rejects missing and explicitly vague acceptance conditions", (t) => {
  const vagueConditions = [
    "",
    "Make it good",
    "Use best practices.",
    "Make it professional",
  ];

  vagueConditions.forEach((acceptanceCondition, index) => {
    const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
    const missionId = `vague-contract-${index}`;
    createMission(control, missionId);

    assert.throws(
      () =>
        control.contracts.createContract({
          missionId,
          eventId: `${missionId}-contract`,
          causationId: `${missionId}-command`,
          occurredAt: CREATED_AT,
          contractVersion: 1,
          obligations: [
            obligation({
              obligationId: "quality",
              statement: "Make the inventory application good.",
              acceptanceCondition,
            }),
          ],
        }),
      ContractValidationError,
    );
  });
});

test("supports customer-stated obligations", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "customer-origin";
  createMission(control, missionId);
  const contract = createSampleContract(control, missionId);

  const customerObligation = contract.obligations.find(
    (item) => item.obligationId === "create-product",
  );
  assert.equal(customerObligation.origin, ObligationOrigin.CUSTOMER_STATED);
});

test("supports binding Foundry-derived obligations", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "derived-origin";
  createMission(control, missionId);
  const contract = createSampleContract(control, missionId);

  assert.deepEqual(
    contract.obligations
      .filter((item) => item.origin === ObligationOrigin.FOUNDRY_DERIVED)
      .map((item) => item.obligationId),
    [
      "build-success",
      "application-ready",
      "workflow-without-blocking-errors",
    ],
  );
});

test("validates obligation dependencies, including missing IDs and cycles", (t) => {
  const directory = temporaryLedger(t);
  const control = openMissionControl({ ledgerDirectory: directory });

  createMission(control, "missing-dependency");
  assert.throws(
    () =>
      control.contracts.createContract({
        missionId: "missing-dependency",
        eventId: "missing-dependency-contract",
        causationId: "missing-dependency-command",
        occurredAt: CREATED_AT,
        contractVersion: 1,
        obligations: [
          obligation({
            obligationId: "dependent",
            statement: "A dependent behavior exists.",
            acceptanceCondition:
              "Exercising the dependent behavior produces its expected result.",
            dependencyObligationIds: ["absent"],
          }),
        ],
      }),
    ContractValidationError,
  );

  createMission(control, "cyclic-dependency");
  assert.throws(
    () =>
      control.contracts.createContract({
        missionId: "cyclic-dependency",
        eventId: "cyclic-dependency-contract",
        causationId: "cyclic-dependency-command",
        occurredAt: CREATED_AT,
        contractVersion: 1,
        obligations: [
          obligation({
            obligationId: "first",
            statement: "The first behavior exists.",
            acceptanceCondition:
              "Exercising the first behavior produces its expected result.",
            dependencyObligationIds: ["second"],
          }),
          obligation({
            obligationId: "second",
            statement: "The second behavior exists.",
            acceptanceCondition:
              "Exercising the second behavior produces its expected result.",
            dependencyObligationIds: ["first"],
          }),
        ],
      }),
    ContractValidationError,
  );
});

test("rejects duplicate obligation IDs", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "duplicate-obligation";
  createMission(control, missionId);
  const duplicate = obligation({
    obligationId: "same-id",
    statement: "A product can be created.",
    acceptanceCondition:
      "Submitting valid product data records the new product.",
  });

  assert.throws(
    () =>
      control.contracts.createContract({
        missionId,
        eventId: "duplicate-obligation-contract",
        causationId: "duplicate-obligation-command",
        occurredAt: CREATED_AT,
        contractVersion: 1,
        obligations: [duplicate, { ...duplicate }],
      }),
    ContractValidationError,
  );
});

test("persists contract creation through the Mission Ledger", (t) => {
  const directory = temporaryLedger(t);
  const control = openMissionControl({ ledgerDirectory: directory });
  const missionId = "contract-persistence";
  createMission(control, missionId);
  const expected = createSampleContract(control, missionId);

  const contractEvent = control.ledger
    .listEvents(missionId)
    .find((event) => event.type === CONTRACT_CREATED_EVENT);
  assert.equal(contractEvent.source, "REQUIREMENT_CONTRACT_SERVICE");
  assert.equal(contractEvent.contract.contractVersion, 1);

  const reopened = openMissionControl({ ledgerDirectory: directory });
  assert.deepEqual(reopened.contracts.getContract(missionId), expected);
});

test("contract replay is deterministic for identical Ledger events", (t) => {
  const firstDirectory = temporaryLedger(t);
  const secondDirectory = temporaryLedger(t);
  const missionId = "deterministic-contract";

  for (const directory of [firstDirectory, secondDirectory]) {
    const control = openMissionControl({ ledgerDirectory: directory });
    createMission(control, missionId);
    createSampleContract(control, missionId);
    control.contracts.amendContract({
      missionId,
      eventId: `${missionId}-contract-v2`,
      causationId: `${missionId}-amendment-command`,
      amendment: validAmendment(),
    });
  }

  const first = openMissionControl({ ledgerDirectory: firstDirectory });
  const second = openMissionControl({ ledgerDirectory: secondDirectory });
  assert.deepEqual(
    first.contracts.getContract(missionId),
    second.contracts.getContract(missionId),
  );
  assert.deepEqual(
    first.ledger.listEvents(missionId),
    second.ledger.listEvents(missionId),
  );
});

test("the contract cannot be mutated or replaced after execution begins", (t) => {
  const directory = temporaryLedger(t);
  const control = openMissionControl({ ledgerDirectory: directory });
  const missionId = "immutable-contract";
  createMission(control, missionId);
  createSampleContract(control, missionId);
  control.orchestrator.transition({
    missionId,
    eventId: "immutable-contracted",
    causationId: "immutable-contract-command",
    occurredAt: CREATED_AT,
    to: MissionState.CONTRACTED,
    reason: "Valid contract recorded.",
  });
  control.orchestrator.transition({
    missionId,
    eventId: "immutable-provisioning",
    causationId: "immutable-provision-command",
    occurredAt: CREATED_AT,
    to: MissionState.PROVISIONING,
    reason: "Provisioning phase entered.",
  });
  control.workspaces.provisionWorkspace({
    missionId,
    workspaceId: "immutable-contract-workspace",
    baselineCheckpointId: "immutable-contract-baseline",
    evidenceId: "immutable-contract-provision-evidence",
    eventId: "immutable-contract-workspace-event",
    causationId: "immutable-contract-workspace-command",
    reason: "Provision deterministic contract test workspace.",
    occurredAt: CREATED_AT,
  });
  control.orchestrator.transition({
    missionId,
    eventId: "immutable-executing",
    causationId: "immutable-execution-command",
    occurredAt: CREATED_AT,
    to: MissionState.EXECUTING,
    reason: "Execution phase entered.",
  });

  const before = readFileSync(join(directory, `${missionId}.jsonl`), "utf8");
  const projected = control.contracts.getContract(missionId);
  assert.throws(() => {
    projected.obligations[0].statement = "Overwritten";
  }, TypeError);
  assert.equal(control.contracts.replaceContract, undefined);
  assert.throws(
    () =>
      control.contracts.createContract({
        missionId,
        eventId: "replacement-contract",
        causationId: "replacement-command",
        occurredAt: AMENDED_AT,
        contractVersion: 1,
        obligations: sampleInventoryObligations(),
      }),
    ContractStateError,
  );
  assert.equal(
    readFileSync(join(directory, `${missionId}.jsonl`), "utf8"),
    before,
  );
});

test("records a valid contract amendment and advances every current obligation version", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "valid-amendment";
  createMission(control, missionId);
  createSampleContract(control, missionId);

  const amended = control.contracts.amendContract({
    missionId,
    eventId: "valid-amendment-event",
    causationId: "valid-amendment-command",
    amendment: validAmendment(),
  });

  assert.equal(amended.contractVersion, 2);
  assert.equal(amended.obligations.length, 9);
  assert(amended.obligations.every((item) => item.contractVersion === 2));
  assert.equal(amended.amendments.length, 1);
  assert.equal(amended.amendments[0].previousContractVersion, 1);
  assert.equal(amended.amendments[0].newContractVersion, 2);
  assert(
    control.ledger
      .listEvents(missionId)
      .some((event) => event.type === CONTRACT_AMENDED_EVENT),
  );
});

test("preserves every historical contract version without overwriting bytes", (t) => {
  const directory = temporaryLedger(t);
  const control = openMissionControl({ ledgerDirectory: directory });
  const missionId = "amendment-history";
  createMission(control, missionId);
  createSampleContract(control, missionId);
  const ledgerPath = join(directory, `${missionId}.jsonl`);
  const beforeAmendment = readFileSync(ledgerPath, "utf8");

  control.contracts.amendContract({
    missionId,
    eventId: "history-amendment-event",
    causationId: "history-amendment-command",
    amendment: validAmendment(),
  });

  const afterAmendment = readFileSync(ledgerPath, "utf8");
  const history = control.contracts.getHistory(missionId);
  assert(afterAmendment.startsWith(beforeAmendment));
  assert.equal(history.length, 2);
  assert.equal(history[0].contract.contractVersion, 1);
  assert.equal(history[1].contract.contractVersion, 2);
  assert.equal(
    history[0].contract.obligations.find(
      (item) => item.obligationId === "updated-stock",
    ).statement,
    "The updated stock quantity is displayed.",
  );
});

test("rejects invalid amendments without appending an event", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "invalid-amendment";
  createMission(control, missionId);
  createSampleContract(control, missionId);
  const before = control.ledger.listEvents(missionId);
  const invalid = {
    ...validAmendment(),
    previousContractVersion: 2,
    newContractVersion: 3,
  };

  assert.throws(
    () =>
      control.contracts.amendContract({
        missionId,
        eventId: "invalid-amendment-event",
        causationId: "invalid-amendment-command",
        amendment: invalid,
      }),
    InvalidContractAmendmentError,
  );
  assert.deepEqual(control.ledger.listEvents(missionId), before);
});

test("allows INTAKE to CONTRACTED only after a valid contract is recorded", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "guard-allows-contract";
  createMission(control, missionId);
  createSampleContract(control, missionId);

  control.orchestrator.transition({
    missionId,
    eventId: "guard-allows-transition",
    causationId: "guard-allows-command",
    occurredAt: CREATED_AT,
    to: MissionState.CONTRACTED,
    reason: "The binding Requirement Contract exists.",
  });

  assert.equal(control.orchestrator.state(missionId).state, MissionState.CONTRACTED);
});

test("moves INTAKE to CLARIFYING and rejects contract creation while ambiguity is unresolved", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "architectural-clarification";
  createMission(control, missionId);

  control.orchestrator.transition({
    missionId,
    eventId: "clarification-transition",
    causationId: "clarification-decision",
    occurredAt: CREATED_AT,
    to: MissionState.CLARIFYING,
    reason: "An answer would materially change the architecture.",
  });

  assert.equal(control.orchestrator.state(missionId).state, MissionState.CLARIFYING);
  assert.throws(
    () => createSampleContract(control, missionId),
    ContractStateError,
  );
  assert.equal(
    control.ledger
      .listEvents(missionId)
      .some((event) => event.type === CONTRACT_CREATED_EVENT),
    false,
  );
});

test("CONTRACTED remains unreachable without a recorded valid contract", (t) => {
  const control = openMissionControl({ ledgerDirectory: temporaryLedger(t) });
  const missionId = "guard-rejects-no-contract";
  createMission(control, missionId);
  const before = control.ledger.listEvents(missionId);

  assert.throws(
    () =>
      control.orchestrator.transition({
        missionId,
        eventId: "unguarded-transition",
        causationId: "unguarded-command",
        occurredAt: CREATED_AT,
        to: MissionState.CONTRACTED,
        reason: "Attempt to skip the Requirement Contract.",
      }),
    ContractRequiredError,
  );
  assert.deepEqual(control.ledger.listEvents(missionId), before);
  assert.equal(control.orchestrator.state(missionId).state, MissionState.INTAKE);
});

test("stores no mutable contract projection outside the Mission Ledger", (t) => {
  const directory = temporaryLedger(t);
  const control = openMissionControl({ ledgerDirectory: directory });
  const missionId = "no-contract-state-store";
  createMission(control, missionId);
  createSampleContract(control, missionId);

  assert.deepEqual(readdirSync(directory), [`${missionId}.jsonl`]);
  assert.deepEqual(Object.keys(control.ledger).sort(), [
    "listEvents",
    "projectState",
    "reportEvents",
  ]);
  assert.equal(control.ledger.appendContract, undefined);
  assert.equal(control.ledger.saveContract, undefined);
});

test("restart reconstructs the amended contract exactly from Ledger events", (t) => {
  const directory = temporaryLedger(t);
  const missionId = "contract-recovery";
  let control = openMissionControl({ ledgerDirectory: directory });
  createMission(control, missionId);
  createSampleContract(control, missionId);
  const versionOne = control.contracts.getContract(missionId);

  control = openMissionControl({ ledgerDirectory: directory });
  assert.deepEqual(control.contracts.getContract(missionId), versionOne);
  const versionTwo = control.contracts.amendContract({
    missionId,
    eventId: "recovery-amendment-event",
    causationId: "recovery-amendment-command",
    amendment: validAmendment(),
  });

  control = openMissionControl({ ledgerDirectory: directory });
  assert.deepEqual(control.contracts.getContract(missionId), versionTwo);
  assert.equal(control.contracts.getHistory(missionId).length, 2);
});
