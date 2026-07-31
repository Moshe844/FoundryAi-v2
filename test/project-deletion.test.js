import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  projectIsDeleted,
  recordProjectDeletion,
} from "../apps/web/local-api/project-deletion.mjs";
import {
  executionRecoveryDecision,
  understandingRecoveryDecision,
} from "../apps/web/local-api/understanding-recovery.mjs";
import { openMissionControl } from "../src/index.js";

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

test("project deletion is an idempotent Ledger tombstone with evidence", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "foundry-delete-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const control = openMissionControl({
    ledgerDirectory: resolve(root, "ledger"),
    evidenceDirectory: resolve(root, "evidence"),
    workspaceDirectory: resolve(root, "workspaces"),
    registryDirectory: resolve(root, "registry"),
  });
  const missionId = "delete-project";
  control.orchestrator.createMission({
    missionId,
    eventId: "delete-project-created",
    causationId: "delete-project-request",
  });

  const first = recordProjectDeletion({
    control,
    missionId,
    timestamp: "2026-07-30T12:00:00.000Z",
    suffix: "first",
  });
  assert.equal(first.alreadyDeleted, false);
  assert.equal(projectIsDeleted(control.ledger.reportEvents(missionId)), true);
  assert.equal(control.evidence.findByMission(missionId).length, 1);

  const eventCount = control.ledger.projectState(missionId).eventCount;
  const second = recordProjectDeletion({
    control,
    missionId,
    timestamp: "2026-07-30T12:01:00.000Z",
    suffix: "second",
  });
  assert.equal(second.alreadyDeleted, true);
  assert.equal(control.ledger.projectState(missionId).eventCount, eventCount);
});

test("project deletion confirmation is preserved and stale UI responses cannot resurrect a project", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "../apps/web/app/page.tsx"),
    "utf8",
  );

  // Deletion stays behind an explicit confirmation. The native dialog was
  // replaced by an in-product confirm sheet that states what is kept on disk,
  // so the gate is asserted by its wiring rather than by window.confirm.
  assert.match(
    source,
    /setConfirm\(\{\s*kind: "delete",\s*mission,\s*returnFocus\s*\}\)/,
  );
  assert.match(source, /confirm\?\.kind === "delete"/);
  assert.match(source, /confirmLabel="Delete"/);
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)\(/);
  assert.match(
    source,
    /deletedMissionIdsRef\.current\.add\(mission\.missionId\)/,
  );
  assert.match(
    source,
    /deletedMissionIdsRef\.current\.has\(mission\.missionId\)/,
  );
  assert.match(
    source,
    /loadedMissions\.filter\(/,
    "validated catalogue responses must still exclude optimistically deleted missions",
  );
  const deleteFunction = source.slice(
    source.indexOf("async function deleteProject"),
    source.indexOf("const providersReady"),
  );
  assert.ok(
    deleteFunction.indexOf("setMissions") <
      deleteFunction.indexOf("await api"),
    "the project card must disappear before the DELETE request completes",
  );
});

test("deleted and already-dispatched intake missions are never auto-retried on restart", () => {
  const transition = {
    type: "MISSION_TRANSITION",
    transition: { to: "INTAKE" },
  };
  assert.deepEqual(understandingRecoveryDecision([transition]), {
    recover: true,
    reason: "never-dispatched",
  });
  assert.deepEqual(
    understandingRecoveryDecision([
      transition,
      {
        fact: {
          metadata: {
            modelRouteStart: { taskClass: "PROJECT_UNDERSTANDING" },
          },
        },
      },
    ]),
    {
      recover: false,
      reason: "provider-attempt-interrupted",
    },
  );
  assert.deepEqual(
    understandingRecoveryDecision([
      transition,
      {
        fact: {
          metadata: {
            projectCatalogueOperation: { operation: "DELETED" },
          },
        },
      },
    ]),
    { recover: false, reason: "deleted" },
  );
});

test("only active, non-deleted execution states recover a worker after restart", () => {
  const transition = (to) => ({
    type: "MISSION_TRANSITION",
    transition: { to },
  });
  assert.deepEqual(executionRecoveryDecision([transition("EXECUTING")]), {
    recover: true,
    reason: "interrupted-worker",
  });
  assert.deepEqual(executionRecoveryDecision([transition("VERIFYING")]), {
    recover: true,
    reason: "interrupted-worker",
  });
  assert.deepEqual(executionRecoveryDecision([transition("SUCCEEDED")]), {
    recover: false,
    reason: "not-recoverable",
  });
  assert.deepEqual(
    executionRecoveryDecision([
      transition("EXECUTING"),
      {
        fact: {
          metadata: {
            projectCatalogueOperation: { operation: "DELETED" },
          },
        },
      },
    ]),
    { recover: false, reason: "deleted" },
  );
});

test("a project with invalid historical model-call projection can still be deleted and stays deleted after restart", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "foundry-delete-invalid-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directories = {
    ledgerDirectory: resolve(root, "ledger"),
    evidenceDirectory: resolve(root, "evidence"),
    workspaceDirectory: resolve(root, "workspaces"),
    registryDirectory: resolve(root, "registry"),
  };
  const control = openMissionControl(directories);
  const missionId = "delete-invalid-project";
  control.orchestrator.createMission({
    missionId,
    eventId: "delete-invalid-project-created",
    causationId: "delete-invalid-project-request",
  });
  const evidence = control.evidence.capture({
    evidenceId: "invalid-historical-model-call-evidence",
    missionId,
    kind: "http-response-result",
    captureMethod: "deterministic-regression-fixture",
    producingSubsystem: "PROJECT_UNDERSTANDING_SERVICE",
    timestamp: "2026-07-30T13:00:00.000Z",
    payload: {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: "{}",
    },
    sensitiveValues: [],
    workspaceCheckpointReference: null,
    obligationReference: null,
    verificationRequestReference: null,
    commandReference: null,
    workUnitReference: "invalid-model-call",
    metadata: { fixture: true },
  });
  const ledgerPath = resolve(
    directories.ledgerDirectory,
    `${missionId}.jsonl`,
  );
  const firstRecord = JSON.parse(
    readFileSync(ledgerPath, "utf8").trim(),
  );
  const invalidRecordWithoutHash = {
    schemaVersion: 1,
    eventId: "invalid-historical-model-call",
    missionId,
    sequence: 2,
    type: "RESULT_FACT_RECORDED",
    source: "PROJECT_UNDERSTANDING_SERVICE",
    causationId: "historical-understanding",
    occurredAt: "2026-07-30T13:00:01.000Z",
    fact: {
      statement: "Historical model call completed.",
      resultBearing: true,
      evidenceReferences: [
        {
          evidenceId: evidence.evidenceId,
          workspaceCheckpointReference: null,
        },
      ],
      workspaceCheckpointReference: null,
      workUnitReference: "invalid-model-call",
      metadata: {
        modelCallRecord: { requestId: "invalid-model-call" },
      },
    },
    previousHash: firstRecord.hash,
  };
  const invalidRecord = {
    ...invalidRecordWithoutHash,
    hash: createHash("sha256")
      .update(canonicalize(invalidRecordWithoutHash))
      .digest("hex"),
  };
  appendFileSync(ledgerPath, `${JSON.stringify(invalidRecord)}\n`, "utf8");

  assert.throws(
    () => control.ledger.projectState(missionId),
    /execution or model-call event history is invalid/,
  );
  recordProjectDeletion({
    control,
    missionId,
    timestamp: "2026-07-30T13:01:00.000Z",
    suffix: "invalid-history",
  });
  assert.equal(projectIsDeleted(control.ledger.reportEvents(missionId)), true);

  const restarted = openMissionControl(directories);
  assert.equal(
    projectIsDeleted(restarted.ledger.reportEvents(missionId)),
    true,
  );
});
