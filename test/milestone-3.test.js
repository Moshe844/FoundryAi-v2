import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DuplicateEvidenceError,
  EvidenceIntegrityError,
  EvidenceReferenceError,
  EvidenceValidationError,
  LedgerCorruptionError,
  ObservationKind,
  REDACTION_MARKER,
  RESULT_FACT_EVENT,
  RedactionStatus,
  ResultFactValidationError,
  openMissionControl,
} from "../src/index.js";

const OBSERVED_AT = "2026-03-01T12:00:00.000Z";
const CHECKPOINT = "checkpoint-001";
const WORK_UNIT = "work-unit-001";

function temporaryStores(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-v2-evidence-"));
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
  });
}

function createMission(control, missionId) {
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    occurredAt: OBSERVED_AT,
    reason: "Deterministic evidence test mission.",
  });
}

function commandEvidence({
  evidenceId = "command-evidence",
  missionId = "evidence-mission",
  exitCode = 0,
  stdout = "completed\n",
  stderr = "",
  workspaceCheckpointReference = CHECKPOINT,
  workUnitReference = WORK_UNIT,
  metadata = { fixture: true },
  sensitiveValues,
} = {}) {
  return {
    evidenceId,
    missionId,
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    captureMethod: "deterministic-fixture",
    producingSubsystem: "TEST_OBSERVATION_PRODUCER",
    timestamp: OBSERVED_AT,
    payload: { exitCode, stdout, stderr },
    workspaceCheckpointReference,
    commandReference: "command-001",
    workUnitReference,
    metadata,
    sensitiveValues,
  };
}

function factInput({
  missionId = "evidence-mission",
  evidenceId = "command-evidence",
  checkpoint = CHECKPOINT,
  workUnitReference = WORK_UNIT,
  eventId = "result-fact-001",
} = {}) {
  return {
    missionId,
    eventId,
    causationId: "command-001",
    occurredAt: OBSERVED_AT,
    producingSubsystem: "TEST_OBSERVATION_PRODUCER",
    statement: "The deterministic command exited with the recorded result.",
    evidenceReferences: [
      {
        evidenceId,
        workspaceCheckpointReference: checkpoint,
      },
    ],
    workspaceCheckpointReference: checkpoint,
    workUnitReference,
    metadata: { fixture: true },
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

function contentHash(payload, payloadReference = null) {
  return createHash("sha256")
    .update(canonicalize({ payload, payloadReference }))
    .digest("hex");
}

function evidencePath(stores, evidenceId) {
  return join(stores.evidenceDirectory, "records", `${evidenceId}.json`);
}

test("creates a valid immutable evidence record", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");

  const record = control.evidence.capture(commandEvidence());

  assert.equal(record.evidenceId, "command-evidence");
  assert.equal(record.missionId, "evidence-mission");
  assert.equal(record.kind, ObservationKind.COMMAND_EXIT_RESULT);
  assert.equal(record.payload.exitCode, 0);
  assert.equal(record.workspaceCheckpointReference, CHECKPOINT);
  assert.equal(record.workUnitReference, WORK_UNIT);
  assert.match(record.contentHash, /^[a-f0-9]{64}$/);
  assert.match(record.recordHash, /^[a-f0-9]{64}$/);
  assert(Object.isFrozen(record));
  assert(Object.isFrozen(record.payload));
  assert.throws(() => {
    record.payload.exitCode = 1;
  }, TypeError);
});

test("rejects duplicate evidence IDs before and after restart", (t) => {
  const stores = temporaryStores(t);
  let control = openControl(stores);
  createMission(control, "evidence-mission");
  control.evidence.capture(commandEvidence());

  assert.throws(
    () => control.evidence.capture(commandEvidence()),
    DuplicateEvidenceError,
  );

  control = openControl(stores);
  assert.throws(
    () => control.evidence.capture(commandEvidence()),
    DuplicateEvidenceError,
  );
});

test("replays identical evidence deterministically", (t) => {
  const firstStores = temporaryStores(t);
  const secondStores = temporaryStores(t);

  for (const stores of [firstStores, secondStores]) {
    const control = openControl(stores);
    createMission(control, "evidence-mission");
    control.evidence.capture(commandEvidence());
  }

  const first = openControl(firstStores).evidence.getById("command-evidence");
  const second = openControl(secondStores).evidence.getById("command-evidence");
  assert.deepEqual(first, second);
});

test("computes and validates the persisted payload content hash", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  const record = control.evidence.capture(commandEvidence());

  assert.equal(
    record.contentHash,
    contentHash(record.payload, record.payloadReference),
  );
  assert.deepEqual(control.evidence.getById(record.evidenceId), record);
});

test("detects payload and full-record tampering", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  control.evidence.capture(commandEvidence());
  const recordPath = evidencePath(stores, "command-evidence");
  const persisted = JSON.parse(readFileSync(recordPath, "utf8"));
  persisted.payload.exitCode = 1;
  writeFileSync(recordPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  assert.throws(
    () => control.evidence.getById("command-evidence"),
    EvidenceIntegrityError,
  );
});

test("retrieves evidence by ID, mission, kind, work unit, and checkpoint", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  createMission(control, "other-mission");
  control.evidence.capture(commandEvidence());
  control.evidence.capture({
    evidenceId: "other-http",
    missionId: "other-mission",
    kind: ObservationKind.HTTP_RESPONSE_RESULT,
    captureMethod: "deterministic-http-fixture",
    producingSubsystem: "TEST_OBSERVATION_PRODUCER",
    timestamp: OBSERVED_AT,
    payload: { statusCode: 200, headers: {}, body: "ok" },
    workspaceCheckpointReference: "checkpoint-002",
    commandReference: null,
    workUnitReference: "work-unit-002",
    metadata: {},
  });

  assert.equal(control.evidence.getById("command-evidence").evidenceId, "command-evidence");
  assert.deepEqual(
    control.evidence.findByMission("evidence-mission").map((item) => item.evidenceId),
    ["command-evidence"],
  );
  assert.deepEqual(
    control.evidence
      .findByKind(ObservationKind.HTTP_RESPONSE_RESULT)
      .map((item) => item.evidenceId),
    ["other-http"],
  );
  assert.deepEqual(
    control.evidence.findByWorkUnit(WORK_UNIT).map((item) => item.evidenceId),
    ["command-evidence"],
  );
  assert.deepEqual(
    control.evidence.findByCheckpoint(CHECKPOINT).map((item) => item.evidenceId),
    ["command-evidence"],
  );
});

test("validates every supported deterministic observation fixture without producing it", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "fixture-mission");
  const matchingHash = "a".repeat(64);
  const fixtures = [
    {
      evidenceId: "command-failed",
      kind: ObservationKind.COMMAND_EXIT_RESULT,
      payload: { exitCode: 1, stdout: "", stderr: "failure\n" },
    },
    {
      evidenceId: "file-exists",
      kind: ObservationKind.FILE_EXISTENCE,
      payload: { path: "artifact.txt", exists: true },
    },
    {
      evidenceId: "file-hash",
      kind: ObservationKind.FILE_CONTENT_HASH,
      payload: {
        path: "artifact.txt",
        algorithm: "sha256",
        contentHash: matchingHash,
        expectedHash: matchingHash,
        matches: true,
      },
    },
    {
      evidenceId: "tests-structured",
      kind: ObservationKind.STRUCTURED_TEST_RESULT,
      payload: {
        suiteName: "deterministic-suite",
        passedCount: 4,
        failedCount: 1,
        skippedCount: 0,
      },
    },
    {
      evidenceId: "runtime-not-ready",
      kind: ObservationKind.RUNTIME_READINESS_RESULT,
      payload: { ready: false, detail: "Readiness probe returned false." },
    },
    {
      evidenceId: "http-200",
      kind: ObservationKind.HTTP_RESPONSE_RESULT,
      payload: { statusCode: 200, headers: {}, body: "ok" },
    },
  ];

  for (const fixture of fixtures) {
    control.evidence.capture({
      ...fixture,
      missionId: "fixture-mission",
      captureMethod: "deterministic-fixture",
      producingSubsystem: "TEST_OBSERVATION_PRODUCER",
      timestamp: OBSERVED_AT,
      workspaceCheckpointReference: CHECKPOINT,
      commandReference: null,
      workUnitReference: WORK_UNIT,
      metadata: {},
    });
  }

  assert.equal(control.evidence.findByMission("fixture-mission").length, 6);
});

test("rejects malformed observation records", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");

  assert.throws(
    () =>
      control.evidence.capture(
        commandEvidence({
          exitCode: "zero",
        }),
      ),
    EvidenceValidationError,
  );
  assert.equal(existsSync(stores.evidenceDirectory), false);
});

test("result-bearing Ledger facts require at least one evidence reference", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");

  assert.throws(
    () =>
      control.facts.recordResultFact({
        ...factInput(),
        evidenceReferences: [],
      }),
    ResultFactValidationError,
  );
  assert.equal(control.ledger.listEvents("evidence-mission").length, 1);
});

test("rejects missing and malformed evidence references", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");

  assert.throws(
    () => control.facts.recordResultFact(factInput({ evidenceId: "missing" })),
    EvidenceReferenceError,
  );
  assert.throws(
    () =>
      control.facts.recordResultFact({
        ...factInput(),
        evidenceReferences: ["not-an-evidence-reference"],
      }),
    ResultFactValidationError,
  );
});

test("rejects cross-mission evidence references", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  createMission(control, "other-mission");
  control.evidence.capture(commandEvidence());

  assert.throws(
    () =>
      control.facts.recordResultFact(
        factInput({ missionId: "other-mission" }),
      ),
    EvidenceReferenceError,
  );
});

test("records an evidence-backed result fact in the existing Mission Ledger", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  control.evidence.capture(commandEvidence());

  const event = control.facts.recordResultFact(factInput());

  assert.equal(event.type, RESULT_FACT_EVENT);
  assert.equal(event.fact.resultBearing, true);
  assert.equal(event.fact.evidenceReferences[0].evidenceId, "command-evidence");
  assert.equal(control.orchestrator.state("evidence-mission").state, "INTAKE");
});

test("rejects evidence that fails integrity validation before appending a result fact", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  control.evidence.capture(commandEvidence());
  const recordPath = evidencePath(stores, "command-evidence");
  const persisted = JSON.parse(readFileSync(recordPath, "utf8"));
  persisted.metadata.fixture = false;
  writeFileSync(recordPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  assert.throws(
    () => control.facts.recordResultFact(factInput()),
    EvidenceReferenceError,
  );
  assert.equal(control.ledger.listEvents("evidence-mission").length, 1);
});

test("binds evidence-backed facts to the exact workspace checkpoint", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  control.evidence.capture(commandEvidence());

  const event = control.facts.recordResultFact(factInput());
  assert.equal(event.fact.workspaceCheckpointReference, CHECKPOINT);
  assert.equal(
    event.fact.evidenceReferences[0].workspaceCheckpointReference,
    CHECKPOINT,
  );
});

test("rejects stale checkpoint and work-unit mismatches", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  control.evidence.capture(commandEvidence());

  assert.throws(
    () =>
      control.facts.recordResultFact(
        factInput({ checkpoint: "checkpoint-stale" }),
      ),
    EvidenceReferenceError,
  );
  assert.throws(
    () =>
      control.facts.recordResultFact(
        factInput({ workUnitReference: "work-unit-stale" }),
      ),
    EvidenceReferenceError,
  );
});

test("redacts sensitive keys and explicit secret values before persistence", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "redaction-mission");
  const originalSecret = "super-secret-value";

  const record = control.evidence.capture({
    evidenceId: "redacted-http",
    missionId: "redaction-mission",
    kind: ObservationKind.HTTP_RESPONSE_RESULT,
    captureMethod: "deterministic-http-fixture",
    producingSubsystem: "TEST_OBSERVATION_PRODUCER",
    timestamp: OBSERVED_AT,
    payload: {
      statusCode: 200,
      headers: {
        Authorization: `Bearer ${originalSecret}`,
        "Content-Type": "text/plain",
      },
      body: `response omitted ${originalSecret}`,
    },
    workspaceCheckpointReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: {
      apiKey: originalSecret,
      note: `credential=${originalSecret}`,
    },
    sensitiveValues: [originalSecret],
  });

  const persistedText = readFileSync(
    evidencePath(stores, "redacted-http"),
    "utf8",
  );
  assert.equal(record.redactionStatus, RedactionStatus.REDACTED);
  assert.equal(record.payload.headers.Authorization, REDACTION_MARKER);
  assert(record.payload.body.includes(REDACTION_MARKER));
  assert.equal(record.metadata.apiKey, REDACTION_MARKER);
  assert.equal(persistedText.includes(originalSecret), false);
  assert(persistedText.includes(REDACTION_MARKER));
});

test("keeps payloads and payload references human-inspectable", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "inspectable-mission");
  control.evidence.capture({
    evidenceId: "inspectable-tests",
    missionId: "inspectable-mission",
    kind: ObservationKind.STRUCTURED_TEST_RESULT,
    captureMethod: "deterministic-test-fixture",
    producingSubsystem: "TEST_OBSERVATION_PRODUCER",
    timestamp: OBSERVED_AT,
    payload: {
      suiteName: "inventory-contract",
      passedCount: 7,
      failedCount: 1,
      skippedCount: 0,
    },
    workspaceCheckpointReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: { format: "structured-json" },
  });
  control.evidence.capture({
    evidenceId: "inspectable-reference",
    missionId: "inspectable-mission",
    kind: ObservationKind.FILE_CONTENT_HASH,
    captureMethod: "external-artifact-reference",
    producingSubsystem: "TEST_OBSERVATION_PRODUCER",
    timestamp: OBSERVED_AT,
    payloadReference: "artifact://sha256/fixture",
    workspaceCheckpointReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: { description: "Human-readable external artifact reference." },
  });

  const persistedText = readFileSync(
    evidencePath(stores, "inspectable-tests"),
    "utf8",
  );
  assert(persistedText.includes('"suiteName": "inventory-contract"'));
  assert.equal(
    control.evidence.getById("inspectable-tests").payload.failedCount,
    1,
  );
  assert.equal(
    control.evidence.getById("inspectable-reference").payloadReference,
    "artifact://sha256/fixture",
  );
});

test("reconstructs evidence from persisted records after interruption and restart", (t) => {
  const stores = temporaryStores(t);
  let control = openControl(stores);
  createMission(control, "evidence-mission");
  const original = control.evidence.capture(commandEvidence());

  control = openControl(stores);
  assert.deepEqual(control.evidence.getById("command-evidence"), original);
  assert.deepEqual(
    control.evidence.findByMission("evidence-mission"),
    [original],
  );
});

test("uses no mutable evidence index or authoritative cache", (t) => {
  const stores = temporaryStores(t);
  const first = openControl(stores);
  createMission(first, "evidence-mission");
  first.evidence.capture(commandEvidence());

  const second = openControl(stores);
  second.evidence.capture(
    commandEvidence({
      evidenceId: "command-evidence-2",
      stdout: "second\n",
    }),
  );

  assert.deepEqual(
    first.evidence.findByMission("evidence-mission").map((item) => item.evidenceId),
    ["command-evidence", "command-evidence-2"],
  );
  assert.deepEqual(
    readdirSync(join(stores.evidenceDirectory, "records")).sort(),
    ["command-evidence-2.json", "command-evidence.json"],
  );
});

test("Ledger replay fails closed if cited evidence is later corrupted", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "evidence-mission");
  control.evidence.capture(commandEvidence());
  control.facts.recordResultFact(factInput());

  const recordPath = evidencePath(stores, "command-evidence");
  const persisted = JSON.parse(readFileSync(recordPath, "utf8"));
  persisted.payload.stdout = "tampered\n";
  writeFileSync(recordPath, `${JSON.stringify(persisted, null, 2)}\n`, "utf8");

  assert.throws(
    () => control.ledger.listEvents("evidence-mission"),
    LedgerCorruptionError,
  );
});
