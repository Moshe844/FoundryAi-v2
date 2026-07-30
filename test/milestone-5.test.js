import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";

import {
  CheckpointAlreadyVerifiedError,
  CheckpointParentError,
  DuplicateCheckpointError,
  DuplicateEventError,
  EvidenceReferenceError,
  LedgerCorruptionError,
  MissionState,
  ObservationKind,
  UnsafeWorkspaceReleaseError,
  VerifiedCheckpointRollbackError,
  WORKSPACE_FACT_EVENT,
  WorkspaceAlreadyExistsError,
  WorkspaceIsolationError,
  WorkspaceLifecycleStatus,
  WorkspacePathError,
  WorkspaceProvisioningRequiredError,
  WorkspaceRetentionState,
  WorkspaceStateError,
  openMissionControl,
} from "../src/index.js";

const TIME = "2026-05-01T12:00:00.000Z";

function temporaryStores(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-v2-workspace-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    ledgerDirectory: join(root, "ledger"),
    evidenceDirectory: join(root, "evidence"),
    workspaceDirectory: join(root, "workspace-store"),
  };
}

function openControl(stores) {
  return openMissionControl({
    ...stores,
    clock: () => TIME,
  });
}

function contractObligation() {
  return {
    obligationId: "workspace-test-obligation",
    statement: "The deterministic workspace test condition is observed.",
    origin: "foundry-derived",
    acceptanceCondition: {
      type: "command-exit-code-equals",
      expectedExitCode: 0,
    },
    requiredEvidenceKinds: [ObservationKind.COMMAND_EXIT_RESULT],
    dependencyObligationIds: [],
    contractVersion: 1,
  };
}

function createProvisioningMission(control, missionId) {
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    occurredAt: TIME,
    reason: "Accept deterministic workspace test mission.",
  });
  control.contracts.createContract({
    missionId,
    eventId: `${missionId}-contract`,
    causationId: `${missionId}-contract-command`,
    occurredAt: TIME,
    contractVersion: 1,
    obligations: [contractObligation()],
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-contracted`,
    causationId: `${missionId}-contracted-command`,
    occurredAt: TIME,
    to: MissionState.CONTRACTED,
    reason: "Contract recorded.",
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-provisioning`,
    causationId: `${missionId}-provisioning-command`,
    occurredAt: TIME,
    to: MissionState.PROVISIONING,
    reason: "Begin workspace preparation.",
  });
}

function provision(control, missionId, suffix = missionId) {
  return control.workspaces.provisionWorkspace({
    missionId,
    workspaceId: `${suffix}-workspace`,
    baselineCheckpointId: `${suffix}-baseline`,
    evidenceId: `${suffix}-provision-evidence`,
    eventId: `${suffix}-provision-event`,
    causationId: `${suffix}-provision-command`,
    reason: "Provision isolated deterministic fixture workspace.",
    occurredAt: TIME,
  });
}

function checkpoint(control, missionId, workspaceId, suffix, extra = {}) {
  return control.workspaces.createCheckpoint({
    missionId,
    workspaceId,
    checkpointId: `${suffix}-checkpoint`,
    evidenceId: `${suffix}-checkpoint-evidence`,
    eventId: `${suffix}-checkpoint-event`,
    causationId: `${suffix}-checkpoint-command`,
    reason: `Capture deterministic checkpoint ${suffix}.`,
    occurredAt: TIME,
    ...extra,
  });
}

function writeFixture(workspace, relativePath, content) {
  const target = join(workspace.rootPath, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
  return target;
}

test("successfully provisions exactly one isolated workspace with a baseline checkpoint and evidence", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "provision-success";
  createProvisioningMission(control, missionId);

  const workspace = provision(control, missionId);
  const checkpoints = control.workspaces.listMissionCheckpoints(missionId);

  assert.equal(workspace.missionId, missionId);
  assert.equal(workspace.workspaceId, `${missionId}-workspace`);
  assert(isAbsolute(workspace.rootPath));
  assert(existsSync(workspace.rootPath));
  assert.equal(workspace.currentCheckpointId, `${missionId}-baseline`);
  assert.deepEqual(workspace.checkpointChain, [`${missionId}-baseline`]);
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0].parentCheckpointId, null);
  assert.equal(checkpoints[0].contentManifest.length, 0);
  assert(Object.isFrozen(workspace));
  const fact = control.ledger.listEvents(missionId).at(-1);
  assert.equal(fact.type, WORKSPACE_FACT_EVENT);
  assert.equal(fact.workspaceFact.evidenceReferences.length, 1);

  assert.throws(() => provision(control, missionId), WorkspaceAlreadyExistsError);
});

test("workspace creation is rejected outside PROVISIONING", (t) => {
  const control = openControl(temporaryStores(t));
  control.orchestrator.createMission({
    missionId: "wrong-state-workspace",
    eventId: "wrong-state-created",
    causationId: "wrong-state-intent",
    occurredAt: TIME,
  });
  assert.throws(
    () => provision(control, "wrong-state-workspace"),
    WorkspaceStateError,
  );
});

test("workspace state and checkpoint chain reconstruct exactly after restart without a mutable state file", (t) => {
  const stores = temporaryStores(t);
  const first = openControl(stores);
  const missionId = "workspace-restart";
  createProvisioningMission(first, missionId);
  const workspace = provision(first, missionId);
  writeFixture(workspace, "README.md", "deterministic\n");
  checkpoint(first, missionId, workspace.workspaceId, "workspace-restart-one");
  const expectedWorkspace = first.workspaces.getWorkspace(missionId);
  const expectedCheckpoints = first.workspaces.listMissionCheckpoints(missionId);

  const restarted = openControl(stores);
  assert.deepEqual(restarted.workspaces.getWorkspace(missionId), expectedWorkspace);
  assert.deepEqual(
    restarted.workspaces.listMissionCheckpoints(missionId),
    expectedCheckpoints,
  );
  assert.equal(
    existsSync(join(stores.workspaceDirectory, "workspace-state.json")),
    false,
  );
});

test("mission ownership prevents cross-mission observation and restoration", (t) => {
  const control = openControl(temporaryStores(t));
  createProvisioningMission(control, "isolated-one");
  createProvisioningMission(control, "isolated-two");
  const first = provision(control, "isolated-one");
  const second = provision(control, "isolated-two");
  writeFixture(first, "README.md", "one");
  writeFixture(second, "README.md", "two");
  const secondCheckpoint = checkpoint(
    control,
    "isolated-two",
    second.workspaceId,
    "isolated-two-content",
  );

  assert.equal(
    control.workspaces.readFile({
      missionId: "isolated-one",
      workspaceId: first.workspaceId,
      relativePath: "README.md",
    }),
    "one",
  );
  assert.throws(
    () =>
      control.workspaces.readFile({
        missionId: "isolated-one",
        workspaceId: second.workspaceId,
        relativePath: "README.md",
      }),
    WorkspaceIsolationError,
  );
  assert.throws(
    () =>
      control.workspaces.restoreCheckpoint({
        missionId: "isolated-one",
        workspaceId: second.workspaceId,
        checkpointId: secondCheckpoint.checkpointId,
        evidenceId: "cross-restore-evidence",
        eventId: "cross-restore-event",
        causationId: "cross-restore-command",
        reason: "Attempt cross-mission write.",
        occurredAt: TIME,
      }),
    WorkspaceIsolationError,
  );
  assert.throws(
    () =>
      control.workspaces.provisionWorkspace({
        missionId: "isolated-two",
        workspaceId: first.workspaceId,
        baselineCheckpointId: "collision-baseline",
        evidenceId: "collision-evidence",
        eventId: "collision-event",
        causationId: "collision-command",
        occurredAt: TIME,
      }),
    WorkspaceAlreadyExistsError,
  );
});

test("path traversal, absolute paths, and symlink escape are rejected", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "path-safety";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  writeFixture(workspace, "safe.txt", "safe");

  for (const unsafePath of ["../outside.txt", "sub/../../outside.txt", stores.root]) {
    assert.throws(
      () =>
        control.workspaces.readFile({
          missionId,
          workspaceId: workspace.workspaceId,
          relativePath: unsafePath,
        }),
      WorkspacePathError,
    );
  }

  const outside = join(stores.root, "outside.txt");
  writeFileSync(outside, "outside", "utf8");
  const link = join(workspace.rootPath, "outside-link");
  try {
    symlinkSync(outside, link, "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      return;
    }
    throw error;
  }
  assert.throws(
    () =>
      control.workspaces.readFile({
        missionId,
        workspaceId: workspace.workspaceId,
        relativePath: "outside-link",
      }),
    WorkspacePathError,
  );
  assert.throws(
    () =>
      checkpoint(
        control,
        missionId,
        workspace.workspaceId,
        "symlink-checkpoint",
      ),
    WorkspacePathError,
  );
});

test("content manifests and hashes are deterministic, sorted, and immutable", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "manifest-determinism";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  writeFixture(workspace, "src/z.js", "export const z = 1;\n");
  writeFixture(workspace, "README.md", "hello\n");

  const first = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "manifest-one",
  );
  const second = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "manifest-two",
  );

  assert.deepEqual(
    first.contentManifest.map((entry) => entry.path),
    ["README.md", "src/z.js"],
  );
  assert.deepEqual(first.contentManifest, second.contentManifest);
  assert.deepEqual(first.contentHashes, second.contentHashes);
  assert.equal(
    first.contentManifest[0].contentHash,
    createHash("sha256").update("hello\n").digest("hex"),
  );
  assert(Object.isFrozen(first));
  assert.throws(() => {
    first.contentManifest[0].path = "changed";
  }, TypeError);
});

test("duplicate checkpoint IDs and invalid parents are rejected before and after restart", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "checkpoint-duplicates";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  checkpoint(control, missionId, workspace.workspaceId, "unique");

  assert.throws(
    () => checkpoint(control, missionId, workspace.workspaceId, "unique"),
    DuplicateCheckpointError,
  );
  assert.throws(
    () =>
      checkpoint(control, missionId, workspace.workspaceId, "bad-parent", {
        parentCheckpointId: workspace.baselineCheckpointId,
      }),
    CheckpointParentError,
  );
  const restarted = openControl(stores);
  assert.throws(
    () => checkpoint(restarted, missionId, workspace.workspaceId, "unique"),
    DuplicateCheckpointError,
  );
});

test("checkpoint record or blob tampering is detected on retrieval and restore", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  const missionId = "checkpoint-tamper";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  writeFixture(workspace, "README.md", "original");
  const created = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "tamper-target",
  );
  const checkpointPath = join(
    stores.workspaceDirectory,
    "checkpoints",
    `${created.checkpointId}.json`,
  );
  const record = JSON.parse(readFileSync(checkpointPath, "utf8"));
  record.reason = "tampered";
  writeFileSync(checkpointPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");

  assert.throws(
    () => control.workspaces.listMissionCheckpoints(missionId),
    LedgerCorruptionError,
  );
  assert.throws(
    () =>
      control.workspaces.restoreCheckpoint({
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId: created.checkpointId,
        evidenceId: "tamper-restore-evidence",
        eventId: "tamper-restore-event",
        causationId: "tamper-restore-command",
        reason: "Restore tampered checkpoint.",
        occurredAt: TIME,
      }),
    LedgerCorruptionError,
  );
});

test("restore reproduces files and deletions while latest checkpoint remains creation-ordered", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "restore-success";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  writeFixture(workspace, "README.md", "version one");
  writeFixture(workspace, "src/a.js", "a");
  const first = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "restore-one",
  );
  writeFixture(workspace, "README.md", "version two");
  unlinkSync(join(workspace.rootPath, "src", "a.js"));
  writeFixture(workspace, "src/b.js", "b");
  const second = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "restore-two",
  );

  control.workspaces.restoreCheckpoint({
    missionId,
    workspaceId: workspace.workspaceId,
    checkpointId: first.checkpointId,
    evidenceId: "restore-one-evidence",
    eventId: "restore-one-event",
    causationId: "restore-one-command",
    reason: "Restore the first deterministic snapshot.",
    occurredAt: TIME,
  });

  assert.equal(readFileSync(join(workspace.rootPath, "README.md"), "utf8"), "version one");
  assert.equal(readFileSync(join(workspace.rootPath, "src", "a.js"), "utf8"), "a");
  assert.equal(existsSync(join(workspace.rootPath, "src", "b.js")), false);
  assert.equal(
    control.workspaces.getWorkspace(missionId).currentCheckpointId,
    first.checkpointId,
  );
  assert.equal(
    control.workspaces.getLatestCheckpoint(missionId).checkpointId,
    second.checkpointId,
  );
});

test("browser-state restore can preserve explicitly allowed transient dependency and build artifacts", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "restore-transient-artifacts";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  writeFixture(workspace, "app/page.tsx", "version one");
  const sourceCheckpoint = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "restore-transient-source",
  );
  writeFixture(workspace, "app/page.tsx", "browser-mutated");
  writeFixture(workspace, "node_modules/next/package.json", '{"version":"15.4.4"}');
  writeFixture(workspace, ".next/BUILD_ID", "deterministic-build");

  control.workspaces.restoreCheckpoint({
    missionId,
    workspaceId: workspace.workspaceId,
    checkpointId: sourceCheckpoint.checkpointId,
    evidenceId: "restore-transient-evidence",
    eventId: "restore-transient-event",
    causationId: "restore-transient-command",
    reason: "Restore browser state while retaining compatible transient artifacts.",
    preserveTransientDirectories: [".next", "node_modules"],
    occurredAt: TIME,
  });

  assert.equal(
    readFileSync(join(workspace.rootPath, "app", "page.tsx"), "utf8"),
    "version one",
  );
  assert.equal(
    readFileSync(
      join(workspace.rootPath, "node_modules", "next", "package.json"),
      "utf8",
    ),
    '{"version":"15.4.4"}',
  );
  assert.equal(
    readFileSync(join(workspace.rootPath, ".next", "BUILD_ID"), "utf8"),
    "deterministic-build",
  );
});

test("restore rejects unknown transient preservation targets before changing the workspace", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "restore-invalid-transient";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  writeFixture(workspace, "README.md", "before");
  const sourceCheckpoint = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "restore-invalid-source",
  );
  writeFixture(workspace, "README.md", "after");

  assert.throws(
    () =>
      control.workspaces.restoreCheckpoint({
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId: sourceCheckpoint.checkpointId,
        evidenceId: "restore-invalid-evidence",
        eventId: "restore-invalid-event",
        causationId: "restore-invalid-command",
        reason: "Reject an unsafe transient preservation request.",
        preserveTransientDirectories: ["data"],
        occurredAt: TIME,
      }),
    /known transient artifact directories/u,
  );
  assert.equal(
    readFileSync(join(workspace.rootPath, "README.md"), "utf8"),
    "after",
  );
});

test("verified checkpoint marks are irreversible and define the rollback floor", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "verified-floor";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  writeFixture(workspace, "README.md", "verified");
  const verified = checkpoint(
    control,
    missionId,
    workspace.workspaceId,
    "verified-content",
  );
  control.workspaces.markCheckpointVerified({
    missionId,
    workspaceId: workspace.workspaceId,
    checkpointId: verified.checkpointId,
    evidenceId: "verified-content-checkpoint-evidence",
    eventId: "verified-content-mark-event",
    causationId: "verified-content-mark-command",
    reason: "Preserve deterministic verified work.",
    occurredAt: TIME,
  });

  assert.equal(
    control.workspaces.getLatestVerifiedCheckpoint(missionId).checkpointId,
    verified.checkpointId,
  );
  assert.throws(
    () =>
      control.workspaces.markCheckpointVerified({
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId: verified.checkpointId,
        evidenceId: "verified-content-checkpoint-evidence",
        eventId: "duplicate-mark-event",
        causationId: "duplicate-mark-command",
        reason: "Attempt duplicate mark.",
        occurredAt: TIME,
      }),
    CheckpointAlreadyVerifiedError,
  );
  assert.throws(
    () =>
      control.workspaces.restoreCheckpoint({
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId: workspace.baselineCheckpointId,
        evidenceId: "behind-floor-evidence",
        eventId: "behind-floor-event",
        causationId: "behind-floor-command",
        reason: "Attempt rollback behind verified work.",
        occurredAt: TIME,
      }),
    VerifiedCheckpointRollbackError,
  );
  assert.throws(
    () =>
      control.workspaces.markCheckpointVerified({
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId: workspace.baselineCheckpointId,
        evidenceId: `${missionId}-provision-evidence`,
        eventId: "behind-floor-mark-event",
        causationId: "behind-floor-mark-command",
        reason: "Attempt to move the verified floor backward.",
        occurredAt: TIME,
      }),
    VerifiedCheckpointRollbackError,
  );
});

test("checkpoint verification rejects stale and cross-mission evidence bindings", (t) => {
  const control = openControl(temporaryStores(t));
  createProvisioningMission(control, "binding-one");
  createProvisioningMission(control, "binding-two");
  const first = provision(control, "binding-one");
  const second = provision(control, "binding-two");
  const firstCheckpoint = checkpoint(
    control,
    "binding-one",
    first.workspaceId,
    "binding-one-next",
  );

  assert.throws(
    () =>
      control.workspaces.markCheckpointVerified({
        missionId: "binding-one",
        workspaceId: first.workspaceId,
        checkpointId: firstCheckpoint.checkpointId,
        evidenceId: "binding-one-provision-evidence",
        eventId: "stale-binding-event",
        causationId: "stale-binding-command",
        reason: "Attempt stale evidence binding.",
        occurredAt: TIME,
      }),
    EvidenceReferenceError,
  );
  assert.throws(
    () =>
      control.workspaces.markCheckpointVerified({
        missionId: "binding-one",
        workspaceId: first.workspaceId,
        checkpointId: firstCheckpoint.checkpointId,
        evidenceId: "binding-two-provision-evidence",
        eventId: "cross-binding-event",
        causationId: "cross-binding-command",
        reason: "Attempt cross-mission evidence binding.",
        occurredAt: TIME,
      }),
    EvidenceReferenceError,
  );
  assert.equal(second.missionId, "binding-two");
});

test("PROVISIONING to EXECUTING requires the workspace, intact baseline, and provisioning evidence", (t) => {
  const storesMissing = temporaryStores(t);
  const missing = openControl(storesMissing);
  createProvisioningMission(missing, "guard-missing");
  assert.throws(
    () =>
      missing.orchestrator.transition({
        missionId: "guard-missing",
        eventId: "guard-missing-executing",
        causationId: "guard-missing-command",
        occurredAt: TIME,
        to: MissionState.EXECUTING,
        reason: "Attempt execution without workspace.",
      }),
    WorkspaceProvisioningRequiredError,
  );

  const storesValid = temporaryStores(t);
  const valid = openControl(storesValid);
  createProvisioningMission(valid, "guard-valid");
  provision(valid, "guard-valid");
  valid.orchestrator.transition({
    missionId: "guard-valid",
    eventId: "guard-valid-executing",
    causationId: "guard-valid-command",
    occurredAt: TIME,
    to: MissionState.EXECUTING,
    reason: "Enter execution with valid workspace.",
  });
  assert.equal(valid.orchestrator.state("guard-valid").state, MissionState.EXECUTING);

  const storesCheckpoint = temporaryStores(t);
  const brokenCheckpoint = openControl(storesCheckpoint);
  createProvisioningMission(brokenCheckpoint, "guard-checkpoint");
  const checkpointWorkspace = provision(
    brokenCheckpoint,
    "guard-checkpoint",
  );
  rmSync(
    join(
      storesCheckpoint.workspaceDirectory,
      "checkpoints",
      `${checkpointWorkspace.baselineCheckpointId}.json`,
    ),
  );
  assert.throws(
    () =>
      brokenCheckpoint.orchestrator.transition({
        missionId: "guard-checkpoint",
        eventId: "guard-checkpoint-executing",
        causationId: "guard-checkpoint-command",
        occurredAt: TIME,
        to: MissionState.EXECUTING,
        reason: "Attempt execution without baseline.",
      }),
    LedgerCorruptionError,
  );

  const storesEvidence = temporaryStores(t);
  const brokenEvidence = openControl(storesEvidence);
  createProvisioningMission(brokenEvidence, "guard-evidence");
  provision(brokenEvidence, "guard-evidence");
  rmSync(
    join(
      storesEvidence.evidenceDirectory,
      "records",
      "guard-evidence-provision-evidence.json",
    ),
  );
  assert.throws(
    () =>
      brokenEvidence.orchestrator.transition({
        missionId: "guard-evidence",
        eventId: "guard-evidence-executing",
        causationId: "guard-evidence-command",
        occurredAt: TIME,
        to: MissionState.EXECUTING,
        reason: "Attempt execution without provisioning evidence.",
      }),
    LedgerCorruptionError,
  );
});

test("failed and cancelled terminal missions preserve their latest verified workspace", (t) => {
  for (const [missionId, terminal] of [
    ["preserve-failed", MissionState.FAILED],
    ["preserve-cancelled", MissionState.CANCELLED],
  ]) {
    const control = openControl(temporaryStores(t));
    createProvisioningMission(control, missionId);
    const workspace = provision(control, missionId);
    control.workspaces.markCheckpointVerified({
      missionId,
      workspaceId: workspace.workspaceId,
      checkpointId: workspace.baselineCheckpointId,
      evidenceId: `${missionId}-provision-evidence`,
      eventId: `${missionId}-verify-baseline`,
      causationId: `${missionId}-verify-baseline-command`,
      reason: "Mark baseline as retained verified work.",
      occurredAt: TIME,
    });
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-terminal`,
      causationId: `${missionId}-terminal-command`,
      occurredAt: TIME,
      to: terminal,
      reason: `Enter ${terminal} while preserving work.`,
    });
    const retained = control.workspaces.getWorkspace(missionId);
    assert.equal(
      retained.lifecycleStatus,
      WorkspaceLifecycleStatus.TERMINAL_RETAINED,
    );
    assert.equal(
      retained.retentionState,
      WorkspaceRetentionState.VERIFIED_RETAINED,
    );
    assert(existsSync(retained.rootPath));
    assert.equal(
      control.workspaces.getLatestVerifiedCheckpoint(missionId).checkpointId,
      workspace.baselineCheckpointId,
    );
  }
});

test("successful terminal missions retain the verified workspace", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "preserve-success";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  control.orchestrator.transition({
    missionId,
    eventId: "preserve-success-executing",
    causationId: "preserve-success-executing-command",
    occurredAt: TIME,
    to: MissionState.EXECUTING,
    reason: "Workspace is ready.",
  });
  control.orchestrator.transition({
    missionId,
    eventId: "preserve-success-verifying",
    causationId: "preserve-success-verifying-command",
    occurredAt: TIME,
    to: MissionState.VERIFYING,
    reason: "Verify deterministic fixture.",
  });
  const evidence = control.evidence.capture({
    evidenceId: "preserve-success-result",
    missionId,
    kind: ObservationKind.COMMAND_EXIT_RESULT,
    captureMethod: "deterministic-fixture",
    producingSubsystem: "MILESTONE_5_TEST",
    timestamp: TIME,
    payload: { exitCode: 0, stdout: "ok", stderr: "" },
    workspaceCheckpointReference: workspace.baselineCheckpointId,
    obligationReference: "workspace-test-obligation",
    verificationRequestReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: {},
  });
  control.verification.verify({
    missionId,
    verdictId: "preserve-success-verdict",
    eventId: "preserve-success-verdict-event",
    causationId: "preserve-success-verdict-command",
    verificationTimestamp: TIME,
    workspaceCheckpointReference: workspace.baselineCheckpointId,
    evidenceByObligation: {
      "workspace-test-obligation": [evidence.evidenceId],
    },
  });
  control.workspaces.markCheckpointVerified({
    missionId,
    workspaceId: workspace.workspaceId,
    checkpointId: workspace.baselineCheckpointId,
    evidenceId: evidence.evidenceId,
    eventId: "preserve-success-checkpoint-mark",
    causationId: "preserve-success-checkpoint-command",
    reason: "Retain the checkpoint proven by verification.",
    occurredAt: TIME,
  });
  control.orchestrator.transition({
    missionId,
    eventId: "preserve-success-succeeded",
    causationId: "preserve-success-succeeded-command",
    occurredAt: TIME,
    to: MissionState.SUCCEEDED,
    reason: "Act on COMPLETE verdict.",
  });
  assert.equal(
    control.workspaces.getWorkspace(missionId).lifecycleStatus,
    WorkspaceLifecycleStatus.TERMINAL_RETAINED,
  );
});

test("workspace release is explicit and unsafe loss of verified work is rejected", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "release-safe";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  control.orchestrator.transition({
    missionId,
    eventId: "release-safe-cancel",
    causationId: "release-safe-cancel-command",
    occurredAt: TIME,
    to: MissionState.CANCELLED,
    reason: "Cancel before verified work.",
  });
  const released = control.workspaces.releaseWorkspace({
    missionId,
    workspaceId: workspace.workspaceId,
    evidenceId: "release-safe-evidence",
    eventId: "release-safe-event",
    causationId: "release-safe-command",
    authorizationId: "customer-release-authorization",
    reason: "Explicit customer-authorized release.",
    occurredAt: TIME,
  });
  assert.equal(released.lifecycleStatus, WorkspaceLifecycleStatus.RELEASED);
  assert.equal(released.retentionState, WorkspaceRetentionState.RELEASED);
  assert.equal(existsSync(workspace.rootPath), false);

  const verifiedControl = openControl(temporaryStores(t));
  const verifiedMission = "release-verified";
  createProvisioningMission(verifiedControl, verifiedMission);
  const verifiedWorkspace = provision(verifiedControl, verifiedMission);
  verifiedControl.workspaces.markCheckpointVerified({
    missionId: verifiedMission,
    workspaceId: verifiedWorkspace.workspaceId,
    checkpointId: verifiedWorkspace.baselineCheckpointId,
    evidenceId: `${verifiedMission}-provision-evidence`,
    eventId: "release-verified-mark",
    causationId: "release-verified-mark-command",
    reason: "Retain verified baseline.",
    occurredAt: TIME,
  });
  verifiedControl.orchestrator.transition({
    missionId: verifiedMission,
    eventId: "release-verified-cancel",
    causationId: "release-verified-cancel-command",
    occurredAt: TIME,
    to: MissionState.CANCELLED,
    reason: "Cancel with verified work.",
  });
  assert.throws(
    () =>
      verifiedControl.workspaces.releaseWorkspace({
        missionId: verifiedMission,
        workspaceId: verifiedWorkspace.workspaceId,
        evidenceId: "unsafe-release-evidence",
        eventId: "unsafe-release-event",
        causationId: "unsafe-release-command",
        authorizationId: "unsafe-release-authorization",
        reason: "Attempt unsafe release.",
        occurredAt: TIME,
      }),
    UnsafeWorkspaceReleaseError,
  );
  assert(existsSync(verifiedWorkspace.rootPath));
  const safelyReleased = verifiedControl.workspaces.releaseWorkspace({
    missionId: verifiedMission,
    workspaceId: verifiedWorkspace.workspaceId,
    evidenceId: "preserved-release-evidence",
    eventId: "preserved-release-event",
    causationId: "preserved-release-command",
    authorizationId: "preserved-release-authorization",
    preserveVerifiedCheckpoint: true,
    reason: "Release live workspace while retaining immutable verified checkpoint.",
    occurredAt: TIME,
  });
  assert.equal(safelyReleased.lifecycleStatus, WorkspaceLifecycleStatus.RELEASED);
  assert.equal(
    verifiedControl.workspaces.getLatestVerifiedCheckpoint(verifiedMission)
      .checkpointId,
    verifiedWorkspace.baselineCheckpointId,
  );
});

test("interrupted checkpoint publication recovers from immutable persisted content", (t) => {
  const stores = temporaryStores(t);
  const first = openControl(stores);
  const missionId = "checkpoint-recovery";
  createProvisioningMission(first, missionId);
  const workspace = provision(first, missionId);
  writeFixture(workspace, "README.md", "recover me");

  assert.throws(
    () =>
      first.workspaces.createCheckpoint({
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId: "recovery-checkpoint",
        evidenceId: "recovery-checkpoint-evidence",
        eventId: `${missionId}-created`,
        causationId: "recovery-interrupted-command",
        reason: "Persist before interrupted Ledger publication.",
        occurredAt: TIME,
      }),
    DuplicateEventError,
  );
  assert.equal(
    first.workspaces.getWorkspace(missionId).checkpointChain.includes(
      "recovery-checkpoint",
    ),
    false,
  );

  const restarted = openControl(stores);
  const recovered = restarted.workspaces.createCheckpoint({
    missionId,
    workspaceId: workspace.workspaceId,
    checkpointId: "recovery-checkpoint",
    evidenceId: "recovery-checkpoint-evidence",
    eventId: "recovery-checkpoint-published",
    causationId: "recovery-checkpoint-command",
    reason: "Persist before interrupted Ledger publication.",
    occurredAt: TIME,
  });
  assert.equal(recovered.checkpointId, "recovery-checkpoint");
  assert(
    restarted.workspaces
      .getWorkspace(missionId)
      .checkpointChain.includes("recovery-checkpoint"),
  );
});

test("workspace release and checkpoint operations never transition mission state directly", (t) => {
  const control = openControl(temporaryStores(t));
  const missionId = "no-state-authority";
  createProvisioningMission(control, missionId);
  const workspace = provision(control, missionId);
  checkpoint(control, missionId, workspace.workspaceId, "no-state-one");
  assert.equal(
    control.orchestrator.state(missionId).state,
    MissionState.PROVISIONING,
  );
  assert.equal(control.workspaces.transition, undefined);
  assert.equal(control.ledger.appendWorkspaceFact, undefined);
});
