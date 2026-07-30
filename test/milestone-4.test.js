import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AcceptanceConditionType,
  COMPLETION_VERDICT_EVENT,
  CompletionResult,
  CompletionVerdictIntegrityError,
  CompletionVerdictRequiredError,
  ContractValidationError,
  EvidenceReferenceError,
  MissionState,
  ObligationOrigin,
  ObligationVerdictResult,
  ObservationKind,
  VerificationStateError,
  VerificationValidationError,
  createCompletionVerdict,
  openMissionControl,
  validateCompletionVerdict,
} from "../src/index.js";

const OBSERVED_AT = "2026-04-01T12:00:00.000Z";
const AMENDED_AT = "2026-04-01T13:00:00.000Z";
const CHECKPOINT = "checkpoint-current";

function temporaryStores(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-v2-verification-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    ledgerDirectory: join(root, "ledger"),
    evidenceDirectory: join(root, "evidence"),
  };
}

function openControl(stores) {
  return openMissionControl({
    ledgerDirectory: stores.ledgerDirectory,
    evidenceDirectory: stores.evidenceDirectory,
    clock: () => OBSERVED_AT,
  });
}

function obligation({
  obligationId,
  kind,
  acceptanceCondition,
  contractVersion = 1,
}) {
  return {
    obligationId,
    statement: `Deterministically verify ${obligationId}.`,
    origin: ObligationOrigin.FOUNDRY_DERIVED,
    acceptanceCondition,
    requiredEvidenceKinds: [kind],
    dependencyObligationIds: [],
    contractVersion,
  };
}

function successfulObligations() {
  return [
    obligation({
      obligationId: "build",
      kind: ObservationKind.COMMAND_EXIT_RESULT,
      acceptanceCondition: {
        type: AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS,
        expectedExitCode: 0,
      },
    }),
    obligation({
      obligationId: "required-file",
      kind: ObservationKind.FILE_EXISTENCE,
      acceptanceCondition: {
        type: AcceptanceConditionType.FILE_EXISTS,
        path: "dist/index.html",
        expectedExists: true,
      },
    }),
    obligation({
      obligationId: "tests",
      kind: ObservationKind.STRUCTURED_TEST_RESULT,
      acceptanceCondition: {
        type: AcceptanceConditionType.STRUCTURED_TEST_COUNTS,
        suiteName: "inventory",
        minimumPassedCount: 3,
        maximumFailedCount: 0,
        maximumSkippedCount: 0,
      },
    }),
    obligation({
      obligationId: "ready",
      kind: ObservationKind.RUNTIME_READINESS_RESULT,
      acceptanceCondition: {
        type: AcceptanceConditionType.RUNTIME_READINESS_EQUALS,
        expectedReady: true,
      },
    }),
    obligation({
      obligationId: "http",
      kind: ObservationKind.HTTP_RESPONSE_RESULT,
      acceptanceCondition: {
        type: AcceptanceConditionType.HTTP_STATUS_EQUALS,
        expectedStatus: 200,
      },
    }),
  ];
}

function createVerifyingMission(
  control,
  missionId,
  obligations = successfulObligations(),
) {
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    occurredAt: OBSERVED_AT,
    reason: "Accept deterministic verification test mission.",
  });
  control.contracts.createContract({
    missionId,
    eventId: `${missionId}-contract`,
    causationId: `${missionId}-contract-command`,
    occurredAt: OBSERVED_AT,
    contractVersion: 1,
    obligations,
  });
  for (const [index, state] of [
    MissionState.CONTRACTED,
    MissionState.PROVISIONING,
    MissionState.EXECUTING,
    MissionState.VERIFYING,
  ].entries()) {
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-transition-${index + 1}`,
      causationId: `${missionId}-advance-${index + 1}`,
      occurredAt: OBSERVED_AT,
      to: state,
      reason: `Enter ${state}.`,
    });
    if (state === MissionState.PROVISIONING) {
      control.workspaces.provisionWorkspace({
        missionId,
        workspaceId: `${missionId}-workspace`,
        baselineCheckpointId: `${missionId}-baseline`,
        evidenceId: `${missionId}-provision-evidence`,
        eventId: `${missionId}-workspace-event`,
        causationId: `${missionId}-workspace-command`,
        reason: "Provision deterministic verification test workspace.",
        occurredAt: OBSERVED_AT,
      });
    }
  }
}

function payloadFor(kind, overrides = {}) {
  const payloads = {
    [ObservationKind.COMMAND_EXIT_RESULT]: {
      exitCode: 0,
      stdout: "build complete",
      stderr: "",
    },
    [ObservationKind.FILE_EXISTENCE]: {
      path: "dist/index.html",
      exists: true,
    },
    [ObservationKind.FILE_CONTENT_HASH]: {
      path: "dist/index.html",
      algorithm: "sha256",
      contentHash: "a".repeat(64),
      expectedHash: "a".repeat(64),
      matches: true,
    },
    [ObservationKind.STRUCTURED_TEST_RESULT]: {
      suiteName: "inventory",
      passedCount: 3,
      failedCount: 0,
      skippedCount: 0,
    },
    [ObservationKind.RUNTIME_READINESS_RESULT]: {
      ready: true,
      detail: "ready",
    },
    [ObservationKind.HTTP_RESPONSE_RESULT]: {
      statusCode: 200,
      headers: {},
      body: "ok",
    },
  };
  return { ...payloads[kind], ...overrides };
}

function captureEvidence(
  control,
  {
    missionId,
    obligationId,
    kind,
    evidenceId = `${missionId}-${obligationId}-evidence`,
    checkpoint,
    payload = payloadFor(kind),
    verificationRequestReference = null,
  },
) {
  const resolvedCheckpoint =
    checkpoint ??
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  return control.evidence.capture({
    evidenceId,
    missionId,
    kind,
    captureMethod: "deterministic-test-fixture",
    producingSubsystem: "MILESTONE_4_TEST",
    timestamp: OBSERVED_AT,
    payload,
    workspaceCheckpointReference: resolvedCheckpoint,
    obligationReference: obligationId,
    verificationRequestReference,
    commandReference: null,
    workUnitReference: null,
    metadata: { fixture: true },
  });
}

function captureSuccessfulEvidence(control, missionId) {
  const selections = {};
  for (const item of control.contracts.getContract(missionId).obligations) {
    const record = captureEvidence(control, {
      missionId,
      obligationId: item.obligationId,
      kind: item.requiredEvidenceKinds[0],
    });
    selections[item.obligationId] = [record.evidenceId];
  }
  return selections;
}

function verify(control, missionId, evidenceByObligation, suffix = "one") {
  let checkpointId = null;
  try {
    checkpointId =
      control.workspaces.getWorkspace(missionId).currentCheckpointId;
  } catch {
    // The Verification Authority performs the authoritative state check.
  }
  return control.verification.verify({
    missionId,
    verdictId: `${missionId}-verdict-${suffix}`,
    eventId: `${missionId}-verdict-event-${suffix}`,
    causationId: `${missionId}-verify-${suffix}`,
    verificationTimestamp: OBSERVED_AT,
    workspaceCheckpointReference: checkpointId,
    evidenceByObligation,
  });
}

test("issues valid SATISFIED verdicts for every active obligation and COMPLETE only by conjunction", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "complete-verdict";
  createVerifyingMission(control, missionId);

  const verdict = verify(
    control,
    missionId,
    captureSuccessfulEvidence(control, missionId),
  );

  assert.equal(verdict.overallResult, CompletionResult.COMPLETE);
  assert.equal(verdict.obligationVerdicts.length, 5);
  assert.equal(
    new Set(verdict.obligationVerdicts.map((item) => item.obligationId)).size,
    5,
  );
  assert(
    verdict.obligationVerdicts.every(
      (item) =>
        item.result === ObligationVerdictResult.SATISFIED &&
        item.evidenceReferences.length > 0,
    ),
  );
  assert.deepEqual(verdict.deficiencies, []);
  assert.deepEqual(verdict.unverifiableConditions, []);
  assert(Object.isFrozen(verdict));
  assert(Object.isFrozen(verdict.obligationVerdicts));
  const persisted = control.ledger.listEvents(missionId).at(-1);
  assert.equal(persisted.type, COMPLETION_VERDICT_EVENT);
  assert.equal(persisted.source, "VERIFICATION_AUTHORITY");
  assert(Object.isFrozen(persisted.completionVerdict));
});

test("valid evidence demonstrating failure yields NOT_SATISFIED and prevents COMPLETE", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "negative-verdict";
  const obligations = [successfulObligations()[0]];
  createVerifyingMission(control, missionId, obligations);
  const evidence = captureEvidence(control, {
    missionId,
    obligationId: "build",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    payload: payloadFor(ObservationKind.COMMAND_EXIT_RESULT, {
      exitCode: 1,
      stderr: "build failed",
    }),
  });

  const verdict = verify(control, missionId, { build: [evidence.evidenceId] });

  assert.equal(
    verdict.obligationVerdicts[0].result,
    ObligationVerdictResult.NOT_SATISFIED,
  );
  assert.equal(verdict.overallResult, CompletionResult.INCOMPLETE);
  assert.equal(verdict.deficiencies.length, 1);
});

test("missing or insufficient observations yield UNVERIFIABLE and never COMPLETE", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "unverifiable-verdict";
  createVerifyingMission(control, missionId, [successfulObligations()[3]]);

  const verdict = verify(control, missionId, {});

  assert.equal(
    verdict.obligationVerdicts[0].result,
    ObligationVerdictResult.UNVERIFIABLE,
  );
  assert.equal(verdict.overallResult, CompletionResult.INCOMPLETE);
  assert.equal(verdict.unverifiableConditions.length, 1);
  assert.equal(verdict.obligationVerdicts[0].evidenceReferences.length, 0);
});

test("Completion Verdict validation rejects missing, duplicate, and evidence-free SATISFIED obligation verdicts", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "verdict-shape";
  createVerifyingMission(control, missionId);
  const verdict = verify(
    control,
    missionId,
    captureSuccessfulEvidence(control, missionId),
  );
  const contract = control.contracts.getContract(missionId);

  const missing = structuredClone(verdict);
  missing.obligationVerdicts.pop();
  assert.throws(
    () => validateCompletionVerdict(missing, { missionId, contract }),
    CompletionVerdictIntegrityError,
  );

  const duplicate = structuredClone(verdict);
  duplicate.obligationVerdicts[1] = structuredClone(
    duplicate.obligationVerdicts[0],
  );
  assert.throws(
    () => validateCompletionVerdict(duplicate, { missionId, contract }),
    CompletionVerdictIntegrityError,
  );

  const noEvidence = structuredClone(verdict);
  noEvidence.obligationVerdicts[0].evidenceReferences = [];
  assert.throws(
    () => validateCompletionVerdict(noEvidence, { missionId, contract }),
    CompletionVerdictIntegrityError,
  );
});

test("missing and malformed evidence references are rejected, not converted to success", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "missing-evidence";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);

  assert.throws(
    () => verify(control, missionId, { build: ["not-present"] }),
    EvidenceReferenceError,
  );
  assert.throws(
    () => verify(control, missionId, { build: ["bad id"] }, "malformed"),
    VerificationValidationError,
  );
});

test("corrupted evidence is rejected before a Completion Verdict is appended", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "corrupt-evidence";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);
  const record = captureEvidence(control, {
    missionId,
    obligationId: "build",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
  });
  const path = join(stores.evidenceDirectory, "records", `${record.evidenceId}.json`);
  const persisted = JSON.parse(readFileSync(path, "utf8"));
  persisted.payload.exitCode = 1;
  writeFileSync(path, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  assert.throws(
    () => verify(control, missionId, { build: [record.evidenceId] }),
    EvidenceReferenceError,
  );
  assert.equal(
    control.ledger
      .listEvents(missionId)
      .filter((event) => event.type === COMPLETION_VERDICT_EVENT).length,
    0,
  );
});

test("cross-mission evidence is rejected", (t) => {
  const control = openControl(temporaryStores(t));
  createVerifyingMission(control, "evidence-owner", [
    successfulObligations()[0],
  ]);
  createVerifyingMission(control, "evidence-consumer", [
    successfulObligations()[0],
  ]);
  const record = captureEvidence(control, {
    missionId: "evidence-owner",
    obligationId: "build",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
  });

  assert.throws(
    () =>
      verify(control, "evidence-consumer", {
        build: [record.evidenceId],
      }),
    EvidenceReferenceError,
  );
});

test("stale checkpoint evidence and verdict checkpoint mismatches are rejected", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "stale-checkpoint";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);
  const olderCheckpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  const record = captureEvidence(control, {
    missionId,
    obligationId: "build",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    checkpoint: olderCheckpointId,
  });
  control.workspaces.createCheckpoint({
    missionId,
    workspaceId: `${missionId}-workspace`,
    checkpointId: `${missionId}-current`,
    evidenceId: `${missionId}-current-evidence`,
    eventId: `${missionId}-current-event`,
    causationId: `${missionId}-current-command`,
    reason: "Advance beyond the evidence checkpoint.",
    occurredAt: OBSERVED_AT,
  });

  assert.throws(
    () => verify(control, missionId, { build: [record.evidenceId] }),
    EvidenceReferenceError,
  );
});

test("explicitly checkpoint-independent acceptance conditions can use older evidence", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "checkpoint-independent";
  const item = obligation({
    obligationId: "portable-build",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    acceptanceCondition: {
      type: AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS,
      expectedExitCode: 0,
      checkpointIndependent: true,
    },
  });
  createVerifyingMission(control, missionId, [item]);
  const olderCheckpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  const record = captureEvidence(control, {
    missionId,
    obligationId: "portable-build",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    checkpoint: olderCheckpointId,
  });
  control.workspaces.createCheckpoint({
    missionId,
    workspaceId: `${missionId}-workspace`,
    checkpointId: `${missionId}-current`,
    evidenceId: `${missionId}-current-evidence`,
    eventId: `${missionId}-current-event`,
    causationId: `${missionId}-current-command`,
    reason: "Advance to a newer deterministic checkpoint.",
    occurredAt: OBSERVED_AT,
  });

  const verdict = verify(control, missionId, {
    "portable-build": [record.evidenceId],
  });
  assert.equal(verdict.overallResult, CompletionResult.COMPLETE);
});

test("wrong evidence kinds and file existence for a behavioral obligation are rejected", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "wrong-kind";
  const behavior = obligation({
    obligationId: "behavior",
    kind: ObservationKind.STRUCTURED_TEST_RESULT,
    acceptanceCondition: {
      type: AcceptanceConditionType.STRUCTURED_TEST_COUNTS,
      suiteName: "inventory",
      minimumPassedCount: 1,
      maximumFailedCount: 0,
      maximumSkippedCount: 0,
    },
  });
  createVerifyingMission(control, missionId, [behavior]);
  const record = captureEvidence(control, {
    missionId,
    obligationId: "behavior",
    kind: ObservationKind.FILE_EXISTENCE,
  });

  assert.throws(
    () => verify(control, missionId, { behavior: [record.evidenceId] }),
    EvidenceReferenceError,
  );
});

test("absence of errors and an unrun test suite do not satisfy behavior", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "absence-is-not-evidence";
  const behavior = obligation({
    obligationId: "behavior",
    kind: ObservationKind.STRUCTURED_TEST_RESULT,
    acceptanceCondition: {
      type: AcceptanceConditionType.STRUCTURED_TEST_COUNTS,
      suiteName: "inventory",
      minimumPassedCount: 1,
      maximumFailedCount: 0,
      maximumSkippedCount: 0,
    },
  });
  createVerifyingMission(control, missionId, [behavior]);

  const verdict = verify(control, missionId, {});
  assert.equal(
    verdict.obligationVerdicts[0].result,
    ObligationVerdictResult.UNVERIFIABLE,
  );
});

test("unsupported acceptance-condition types are rejected without inference", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "unsupported-condition";
  control.orchestrator.createMission({
    missionId,
    eventId: "unsupported-created",
    causationId: "unsupported-intent",
    occurredAt: OBSERVED_AT,
  });

  assert.throws(
    () =>
      control.contracts.createContract({
        missionId,
        eventId: "unsupported-contract",
        causationId: "unsupported-command",
        occurredAt: OBSERVED_AT,
        contractVersion: 1,
        obligations: [
          obligation({
            obligationId: "unknown",
            kind: ObservationKind.COMMAND_EXIT_RESULT,
            acceptanceCondition: { type: "model-opinion" },
          }),
        ],
      }),
    ContractValidationError,
  );
});

test("all-of and explicitly permitted any-of are deterministic; implicit any-of is rejected", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "composite-condition";
  const composite = obligation({
    obligationId: "composite",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    acceptanceCondition: {
      type: AcceptanceConditionType.ALL_OF,
      conditions: [
        {
          type: AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS,
          expectedExitCode: 0,
        },
        {
          type: AcceptanceConditionType.EVIDENCE_KIND_PRESENT,
          evidenceKind: ObservationKind.COMMAND_EXIT_RESULT,
        },
      ],
    },
  });
  createVerifyingMission(control, missionId, [composite]);
  const record = captureEvidence(control, {
    missionId,
    obligationId: "composite",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
  });
  assert.equal(
    verify(control, missionId, { composite: [record.evidenceId] }).overallResult,
    CompletionResult.COMPLETE,
  );

  const second = openControl(temporaryStores(t));
  second.orchestrator.createMission({
    missionId: "implicit-any",
    eventId: "implicit-any-created",
    causationId: "implicit-any-intent",
    occurredAt: OBSERVED_AT,
  });
  assert.throws(
    () =>
      second.contracts.createContract({
        missionId: "implicit-any",
        eventId: "implicit-any-contract",
        causationId: "implicit-any-command",
        occurredAt: OBSERVED_AT,
        contractVersion: 1,
        obligations: [
          obligation({
            obligationId: "any",
            kind: ObservationKind.COMMAND_EXIT_RESULT,
            acceptanceCondition: {
              type: AcceptanceConditionType.ANY_OF,
              conditions: [
                {
                  type: AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS,
                  expectedExitCode: 0,
                },
                {
                  type: AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS,
                  expectedExitCode: 1,
                },
              ],
            },
          }),
        ],
      }),
    ContractValidationError,
  );
});

test("file-hash-equals and explicitly permitted any-of conditions evaluate from positive evidence", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "hash-and-any";
  const items = [
    obligation({
      obligationId: "hash",
      kind: ObservationKind.FILE_CONTENT_HASH,
      acceptanceCondition: {
        type: AcceptanceConditionType.FILE_HASH_EQUALS,
        path: "dist/index.html",
        expectedHash: "a".repeat(64),
      },
    }),
    obligation({
      obligationId: "explicit-any",
      kind: ObservationKind.COMMAND_EXIT_RESULT,
      acceptanceCondition: {
        type: AcceptanceConditionType.ANY_OF,
        explicitlyAllowed: true,
        conditions: [
          {
            type: AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS,
            expectedExitCode: 0,
          },
          {
            type: AcceptanceConditionType.COMMAND_EXIT_CODE_EQUALS,
            expectedExitCode: 2,
          },
        ],
      },
    }),
  ];
  createVerifyingMission(control, missionId, items);
  const hash = captureEvidence(control, {
    missionId,
    obligationId: "hash",
    kind: ObservationKind.FILE_CONTENT_HASH,
  });
  const any = captureEvidence(control, {
    missionId,
    obligationId: "explicit-any",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
  });

  const verdict = verify(control, missionId, {
    hash: [hash.evidenceId],
    "explicit-any": [any.evidenceId],
  });
  assert.equal(verdict.overallResult, CompletionResult.COMPLETE);
});

test("verification is permitted only in VERIFYING", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "wrong-verification-state";
  control.orchestrator.createMission({
    missionId,
    eventId: "wrong-state-created",
    causationId: "wrong-state-intent",
    occurredAt: OBSERVED_AT,
  });

  assert.throws(
    () => verify(control, missionId, {}),
    VerificationStateError,
  );
});

test("VERIFYING to SUCCEEDED requires a current valid COMPLETE verdict", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "success-gate";
  createVerifyingMission(control, missionId);

  assert.throws(
    () =>
      control.orchestrator.transition({
        missionId,
        eventId: "unguarded-success",
        causationId: "unguarded-success-command",
        occurredAt: OBSERVED_AT,
        to: MissionState.SUCCEEDED,
        reason: "Attempt direct success.",
      }),
    CompletionVerdictRequiredError,
  );

  verify(control, missionId, captureSuccessfulEvidence(control, missionId));
  control.orchestrator.transition({
    missionId,
    eventId: "guarded-success",
    causationId: "guarded-success-command",
    occurredAt: OBSERVED_AT,
    to: MissionState.SUCCEEDED,
    reason: "Act on the COMPLETE verdict.",
  });
  assert.equal(control.orchestrator.state(missionId).state, MissionState.SUCCEEDED);
});

test("VERIFYING to REPAIRING is allowed only for a valid INCOMPLETE verdict", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "repair-gate";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);

  assert.throws(
    () =>
      control.orchestrator.transition({
        missionId,
        eventId: "unguarded-repair",
        causationId: "unguarded-repair-command",
        occurredAt: OBSERVED_AT,
        to: MissionState.REPAIRING,
        reason: "Attempt repair without a verdict.",
      }),
    CompletionVerdictRequiredError,
  );
  const failedBuild = captureEvidence(control, {
    missionId,
    obligationId: "build",
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    payload: payloadFor(ObservationKind.COMMAND_EXIT_RESULT, {
      exitCode: 1,
      stderr: "repairable build failure",
    }),
  });
  verify(control, missionId, { build: [failedBuild.evidenceId] });
  control.orchestrator.transition({
    missionId,
    eventId: "guarded-repair",
    causationId: "guarded-repair-command",
    occurredAt: OBSERVED_AT,
    to: MissionState.REPAIRING,
    reason: "Act on the INCOMPLETE verdict.",
  });
  assert.equal(control.orchestrator.state(missionId).state, MissionState.REPAIRING);
});

test("a verdict for an older contract version cannot complete an amended contract", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "stale-contract";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);
  verify(control, missionId, captureSuccessfulEvidence(control, missionId));
  control.contracts.amendContract({
    missionId,
    eventId: "stale-contract-amendment-event",
    causationId: "stale-contract-amendment-command",
    amendment: {
      amendmentId: "stale-contract-amendment",
      previousContractVersion: 1,
      newContractVersion: 2,
      obligationsAdded: [
        obligation({
          obligationId: "new-check",
          kind: ObservationKind.HTTP_RESPONSE_RESULT,
          acceptanceCondition: {
            type: AcceptanceConditionType.HTTP_STATUS_EQUALS,
            expectedStatus: 200,
          },
          contractVersion: 2,
        }),
      ],
      obligationsChanged: [],
      obligationsRemoved: [],
      reason: "Add a newly binding verification obligation.",
      affectedExistingObligationIds: [],
      timestamp: AMENDED_AT,
    },
  });

  assert.throws(
    () =>
      control.orchestrator.transition({
        missionId,
        eventId: "stale-contract-success",
        causationId: "stale-contract-success-command",
        occurredAt: AMENDED_AT,
        to: MissionState.SUCCEEDED,
        reason: "Attempt success with stale verdict.",
      }),
    CompletionVerdictRequiredError,
  );
});

test("Completion Verdict contract mismatch and integrity tampering are detected", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "verdict-integrity";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);
  const verdict = verify(
    control,
    missionId,
    captureSuccessfulEvidence(control, missionId),
  );
  const contract = control.contracts.getContract(missionId);

  const wrongVersion = structuredClone(verdict);
  wrongVersion.contractVersion = 2;
  assert.throws(
    () => validateCompletionVerdict(wrongVersion, { missionId, contract }),
    CompletionVerdictIntegrityError,
  );

  const wrongMission = structuredClone(verdict);
  wrongMission.missionId = "another-mission";
  assert.throws(
    () => validateCompletionVerdict(wrongMission, { missionId, contract }),
    CompletionVerdictIntegrityError,
  );

  const tampered = structuredClone(verdict);
  tampered.integrityHash = "0".repeat(64);
  assert.throws(
    () => validateCompletionVerdict(tampered, { missionId, contract }),
    CompletionVerdictIntegrityError,
  );
});

test("Completion Verdicts are immutable and no other subsystem has append authority", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "single-authority";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);
  const verdict = verify(
    control,
    missionId,
    captureSuccessfulEvidence(control, missionId),
  );

  assert(Object.isFrozen(verdict));
  assert.throws(() => {
    verdict.overallResult = CompletionResult.INCOMPLETE;
  }, TypeError);
  assert.equal(control.ledger.appendCompletionVerdict, undefined);
  assert.equal(control.orchestrator.appendCompletionVerdict, undefined);
  assert.equal(control.contracts.appendCompletionVerdict, undefined);
  assert.equal(control.facts.appendCompletionVerdict, undefined);
  assert.deepEqual(
    Object.keys(control).filter((key) => key === "verification"),
    ["verification"],
  );
});

test("deterministic replay and restart recover the exact persisted Completion Verdict", (t) => {
  const stores = temporaryStores(t);
  const first = openControl(stores);
  const missionId = "verdict-restart";
  createVerifyingMission(first, missionId, [successfulObligations()[0]]);
  const expected = verify(
    first,
    missionId,
    captureSuccessfulEvidence(first, missionId),
  );
  const bytesBefore = readFileSync(
    join(stores.ledgerDirectory, `${missionId}.jsonl`),
    "utf8",
  );

  const restarted = openControl(stores);
  assert.deepEqual(restarted.verification.getLatestVerdict(missionId), expected);
  assert.deepEqual(restarted.verification.getLatestVerdict(missionId), expected);
  assert.equal(
    readFileSync(
      join(stores.ledgerDirectory, `${missionId}.jsonl`),
      "utf8",
    ),
    bytesBefore,
  );
  restarted.orchestrator.transition({
    missionId,
    eventId: "restart-success",
    causationId: "restart-success-command",
    occurredAt: OBSERVED_AT,
    to: MissionState.SUCCEEDED,
    reason: "Act on replayed COMPLETE verdict.",
  });
  assert.equal(restarted.orchestrator.state(missionId).state, MissionState.SUCCEEDED);
});

test("verification-request-bound evidence is accepted for the same request only", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "request-binding";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);
  const checkpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  const record = control.evidence.capture({
    evidenceId: "request-bound-evidence",
    missionId,
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    captureMethod: "deterministic-test-fixture",
    producingSubsystem: "MILESTONE_4_TEST",
    timestamp: OBSERVED_AT,
    payload: payloadFor(ObservationKind.COMMAND_EXIT_RESULT),
    workspaceCheckpointReference: checkpointId,
    obligationReference: null,
    verificationRequestReference: "verification-request-one",
    commandReference: null,
    workUnitReference: null,
    metadata: {},
  });

  assert.throws(
    () =>
      control.verification.verify({
        missionId,
        verdictId: "wrong-request-verdict",
        eventId: "wrong-request-event",
        causationId: "wrong-request-command",
        verificationTimestamp: OBSERVED_AT,
        workspaceCheckpointReference: checkpointId,
        verificationRequestReference: "verification-request-two",
        evidenceByObligation: { build: [record.evidenceId] },
      }),
    EvidenceReferenceError,
  );
  const verdict = control.verification.verify({
    missionId,
    verdictId: "right-request-verdict",
    eventId: "right-request-event",
    causationId: "right-request-command",
    verificationTimestamp: OBSERVED_AT,
    workspaceCheckpointReference: checkpointId,
    verificationRequestReference: "verification-request-one",
    evidenceByObligation: { build: [record.evidenceId] },
  });
  assert.equal(verdict.overallResult, CompletionResult.COMPLETE);
});

test("fabricated Completion Verdict construction does not grant Ledger append authority", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "fabricated-verdict";
  createVerifyingMission(control, missionId, [successfulObligations()[0]]);
  const fabricated = createCompletionVerdict({
    verdictId: "fabricated",
    missionId,
    contractVersion: 1,
    verificationTimestamp: OBSERVED_AT,
    workspaceCheckpointReference: CHECKPOINT,
    obligationVerdicts: [
      {
        obligationId: "build",
        result: ObligationVerdictResult.UNVERIFIABLE,
        evidenceReferences: [],
        deficiency: null,
        unverifiableCondition: "No observation was made.",
      },
    ],
  });

  assert.equal(fabricated.overallResult, CompletionResult.INCOMPLETE);
  assert.equal(control.ledger.appendCompletionVerdict, undefined);
  assert.equal(
    control.ledger
      .listEvents(missionId)
      .some((event) => event.type === COMPLETION_VERDICT_EVENT),
    false,
  );
});
