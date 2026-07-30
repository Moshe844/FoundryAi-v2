import {
  CheckpointAlreadyVerifiedError,
  CheckpointParentError,
  CheckpointNotFoundError,
  DuplicateCheckpointError,
  EvidenceNotFoundError,
  EvidenceReferenceError,
  UnsafeWorkspaceReleaseError,
  VerifiedCheckpointRollbackError,
  WorkspaceAlreadyExistsError,
  WorkspaceIsolationError,
  WorkspaceNotFoundError,
  WorkspaceProvisioningRequiredError,
  WorkspaceStateError,
  WorkspaceValidationError,
} from "../domain/errors.js";
import {
  MissionState,
  isTerminalMissionState,
} from "../domain/lifecycle.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import {
  CheckpointVerificationStatus,
  WORKSPACE_FACT_EVENT,
  WorkspaceLifecycleStatus,
  WorkspaceOperation,
  WorkspaceRetentionState,
  freezeWorkspaceValue,
  normalizeWorkspaceFact,
  projectWorkspace,
} from "../domain/workspace.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new WorkspaceValidationError(`${label} is malformed.`);
  }
}

function captureOrReuseEvidence(evidence, input) {
  try {
    const existing = evidence.getById(input.evidenceId);
    if (
      existing.missionId !== input.missionId ||
      existing.kind !== input.kind ||
      existing.workspaceCheckpointReference !==
        input.workspaceCheckpointReference ||
      existing.captureMethod !== input.captureMethod ||
      existing.producingSubsystem !== input.producingSubsystem ||
      existing.timestamp !== input.timestamp ||
      existing.obligationReference !== input.obligationReference ||
      existing.verificationRequestReference !==
        input.verificationRequestReference ||
      existing.commandReference !== input.commandReference ||
      existing.workUnitReference !== input.workUnitReference ||
      JSON.stringify(existing.payload) !== JSON.stringify(input.payload) ||
      JSON.stringify(existing.metadata) !== JSON.stringify(input.metadata)
    ) {
      throw new EvidenceReferenceError(
        `Existing evidence "${input.evidenceId}" does not match the recoverable workspace observation.`,
        input.evidenceId,
      );
    }
    return existing;
  } catch (error) {
    if (!(error instanceof EvidenceNotFoundError)) {
      throw error;
    }
  }
  return evidence.capture(input);
}

function evidenceReference(record) {
  return {
    evidenceId: record.evidenceId,
    workspaceCheckpointReference: record.workspaceCheckpointReference,
  };
}

function operationFact({
  operation,
  workspaceId,
  checkpointId,
  parentCheckpointId = null,
  rootPath = null,
  reason,
  evidenceRecord,
  authorizationId = null,
  preserveVerifiedCheckpoint = false,
}) {
  return normalizeWorkspaceFact({
    operation,
    workspaceId,
    checkpointId,
    parentCheckpointId,
    rootPath,
    reason,
    evidenceReferences: [evidenceReference(evidenceRecord)],
    authorizationId,
    preserveVerifiedCheckpoint,
  });
}

function checkpointForProjection(store, workspace, checkpointId) {
  if (!workspace.checkpointChain.includes(checkpointId)) {
    throw new CheckpointNotFoundError(checkpointId);
  }
  const checkpoint = store.getCheckpoint(checkpointId);
  if (
    checkpoint.missionId !== workspace.missionId ||
    checkpoint.workspaceId !== workspace.workspaceId
  ) {
    throw new WorkspaceIsolationError(
      `Checkpoint "${checkpointId}" belongs to another mission or workspace.`,
    );
  }
  return checkpoint;
}

function isAtOrAfterVerifiedFloor(store, workspace, targetId, floorId) {
  let currentId = targetId;
  const visited = new Set();
  while (currentId !== null && !visited.has(currentId)) {
    if (currentId === floorId) {
      return true;
    }
    visited.add(currentId);
    const checkpoint = checkpointForProjection(store, workspace, currentId);
    currentId = checkpoint.parentCheckpointId;
  }
  return false;
}

function decorateCheckpoint(checkpoint, workspace) {
  return freezeWorkspaceValue({
    ...checkpoint,
    verificationStatus: workspace.verifiedCheckpointIds.includes(
      checkpoint.checkpointId,
    )
      ? CheckpointVerificationStatus.VERIFIED
      : CheckpointVerificationStatus.UNVERIFIED,
  });
}

export function createWorkspaceLedgerValidator({
  store,
  validateEvidenceReference,
  getEvidenceById,
}) {
  function validateFact({ record, priorRecords, missionId, missionState }) {
    const fact = normalizeWorkspaceFact(record.workspaceFact);
    const before = projectWorkspace(priorRecords, missionId, missionState);
    if (
      fact.operation === WorkspaceOperation.PROVISIONED &&
      missionState !== MissionState.PROVISIONING
    ) {
      throw new WorkspaceStateError(
        missionId,
        missionState,
        "provision",
      );
    }
    if (
      fact.operation !== WorkspaceOperation.PROVISIONED &&
      before === null
    ) {
      throw new WorkspaceNotFoundError(missionId);
    }
    if (
      fact.operation !== WorkspaceOperation.WORKSPACE_RELEASED &&
      isTerminalMissionState(missionState)
    ) {
      throw new WorkspaceStateError(
        missionId,
        missionState,
        fact.operation,
      );
    }
    if (
      fact.operation === WorkspaceOperation.WORKSPACE_RELEASED &&
      !isTerminalMissionState(missionState)
    ) {
      throw new WorkspaceStateError(missionId, missionState, "release");
    }
    for (const reference of fact.evidenceReferences) {
      validateEvidenceReference({
        evidenceId: reference.evidenceId,
        missionId,
        workspaceCheckpointReference:
          reference.workspaceCheckpointReference,
        workUnitReference: null,
      });
    }
    const checkpoint = store.getCheckpoint(fact.checkpointId);
    if (
      checkpoint.missionId !== missionId ||
      checkpoint.workspaceId !== fact.workspaceId
    ) {
      throw new WorkspaceIsolationError(
        `Workspace fact checkpoint "${fact.checkpointId}" has invalid ownership.`,
      );
    }
    if (
      fact.operation === WorkspaceOperation.PROVISIONED &&
      checkpoint.parentCheckpointId !== null
    ) {
      throw new WorkspaceValidationError(
        "The baseline checkpoint must not have a parent.",
      );
    }
    if (
      fact.operation === WorkspaceOperation.CHECKPOINT_CREATED &&
      checkpoint.parentCheckpointId !== fact.parentCheckpointId
    ) {
      throw new WorkspaceValidationError(
        "Checkpoint fact parent does not match the persisted checkpoint.",
      );
    }
    if (
      fact.operation === WorkspaceOperation.CHECKPOINT_VERIFIED &&
      before.verifiedCheckpointIds.length > 0 &&
      !isAtOrAfterVerifiedFloor(
        store,
        before,
        fact.checkpointId,
        before.verifiedCheckpointIds.at(-1),
      )
    ) {
      throw new VerifiedCheckpointRollbackError(
        fact.checkpointId,
        before.verifiedCheckpointIds.at(-1),
      );
    }
    projectWorkspace([...priorRecords, record], missionId, missionState);
  }

  function validateProvisioning(
    records,
    missionId,
    { requireLiveWorkspace = true } = {},
  ) {
    const workspace = projectWorkspace(
      records,
      missionId,
      MissionState.PROVISIONING,
    );
    if (
      workspace === null ||
      workspace.lifecycleStatus !== WorkspaceLifecycleStatus.ACTIVE
    ) {
      throw new WorkspaceProvisioningRequiredError(
        missionId,
        "a successfully provisioned workspace is required",
      );
    }
    let baseline;
    try {
      baseline = store.getCheckpoint(workspace.baselineCheckpointId);
      if (requireLiveWorkspace) {
        store.assertWorkspaceRoot(workspace);
      }
    } catch (error) {
      throw new WorkspaceProvisioningRequiredError(
        missionId,
        "the workspace or baseline checkpoint failed integrity validation",
        { cause: error },
      );
    }
    if (
      baseline.parentCheckpointId !== null ||
      baseline.missionId !== missionId ||
      baseline.workspaceId !== workspace.workspaceId
    ) {
      throw new WorkspaceProvisioningRequiredError(
        missionId,
        "the baseline checkpoint has invalid ownership or ancestry",
      );
    }
    for (const reference of workspace.provisioningEvidenceReferences) {
      let record;
      try {
        validateEvidenceReference({
          evidenceId: reference.evidenceId,
          missionId,
          workspaceCheckpointReference: workspace.baselineCheckpointId,
          workUnitReference: null,
        });
        record = getEvidenceById(reference.evidenceId);
      } catch (error) {
        throw new WorkspaceProvisioningRequiredError(
          missionId,
          "valid provisioning evidence is required",
          { cause: error },
        );
      }
      if (
        record.kind !== ObservationKind.FILE_EXISTENCE ||
        record.payload?.exists !== true ||
        record.payload?.path !== workspace.rootPath
      ) {
        throw new WorkspaceProvisioningRequiredError(
          missionId,
          "provisioning evidence must positively observe the assigned workspace",
        );
      }
    }
    return workspace;
  }

  function validateCheckpointReference({
    records,
    missionId,
    checkpointId,
    requireCurrent = false,
  }) {
    const workspace = projectWorkspace(records, missionId);
    if (workspace === null) {
      throw new WorkspaceNotFoundError(missionId);
    }
    const checkpoint = checkpointForProjection(
      store,
      workspace,
      checkpointId,
    );
    if (requireCurrent && workspace.currentCheckpointId !== checkpointId) {
      throw new EvidenceReferenceError(
        `Checkpoint "${checkpointId}" is stale; current checkpoint is "${workspace.currentCheckpointId}".`,
        checkpointId,
      );
    }
    return checkpoint;
  }

  return Object.freeze({
    validateFact,
    validateProvisioning,
    validateCheckpointReference,
  });
}

export function createWorkspaceService({
  ledger,
  evidence,
  store,
  clock,
}) {
  function state(missionId) {
    return ledger.projectState(missionId).state;
  }

  function workspaceFor(missionId) {
    const missionState = state(missionId);
    const workspace = projectWorkspace(
      ledger.listEvents(missionId),
      missionId,
      missionState,
    );
    if (workspace === null) {
      throw new WorkspaceNotFoundError(missionId);
    }
    return workspace;
  }

  function assertWorkspaceId(workspace, workspaceId) {
    if (workspace.workspaceId !== workspaceId) {
      throw new WorkspaceIsolationError(
        `Workspace "${workspaceId}" does not belong to mission "${workspace.missionId}".`,
      );
    }
  }

  function append({
    missionId,
    eventId,
    causationId,
    occurredAt,
    workspaceFact,
  }) {
    return ledger.appendWorkspaceFact({
      missionId,
      eventId,
      causationId,
      occurredAt,
      workspaceFact,
    });
  }

  const publicWorkspaceService = Object.freeze({
    provisionWorkspace({
      missionId,
      workspaceId,
      baselineCheckpointId,
      evidenceId,
      eventId,
      causationId,
      reason = "Provision isolated workspace and baseline checkpoint.",
      occurredAt = clock(),
    }) {
      assertIdentifier(workspaceId, "workspaceId");
      assertIdentifier(baselineCheckpointId, "baselineCheckpointId");
      assertIdentifier(evidenceId, "evidenceId");
      const missionState = state(missionId);
      if (missionState !== MissionState.PROVISIONING) {
        throw new WorkspaceStateError(
          missionId,
          missionState,
          "provision",
        );
      }
      const existing = projectWorkspace(
        ledger.listEvents(missionId),
        missionId,
        missionState,
      );
      if (existing !== null) {
        throw new WorkspaceAlreadyExistsError(missionId);
      }
      const rootPath = store.provisionRoot({ workspaceId, missionId });
      const { record: baseline } = store.persistCheckpoint(
        {
          checkpointId: baselineCheckpointId,
          workspaceId,
          missionId,
          parentCheckpointId: null,
          creationTimestamp: occurredAt,
          reason,
          rootPath,
        },
        { allowExisting: true },
      );
      const observation = captureOrReuseEvidence(evidence, {
        evidenceId,
        missionId,
        kind: ObservationKind.FILE_EXISTENCE,
        captureMethod: "workspace-filesystem-observation",
        producingSubsystem: "WORKSPACE_SERVICE",
        timestamp: occurredAt,
        payload: { path: rootPath, exists: true },
        workspaceCheckpointReference: baseline.checkpointId,
        obligationReference: null,
        verificationRequestReference: null,
        commandReference: null,
        workUnitReference: null,
        metadata: { workspaceId, operation: "provision" },
      });
      append({
        missionId,
        eventId,
        causationId,
        occurredAt,
        workspaceFact: operationFact({
          operation: WorkspaceOperation.PROVISIONED,
          workspaceId,
          checkpointId: baseline.checkpointId,
          rootPath,
          reason,
          evidenceRecord: observation,
        }),
      });
      return workspaceFor(missionId);
    },

    getWorkspace(missionId) {
      return workspaceFor(missionId);
    },

    listMissionCheckpoints(missionId) {
      const workspace = workspaceFor(missionId);
      return freezeWorkspaceValue(
        workspace.checkpointChain.map((checkpointId) =>
          decorateCheckpoint(store.getCheckpoint(checkpointId), workspace),
        ),
      );
    },

    createCheckpoint({
      missionId,
      workspaceId,
      checkpointId,
      parentCheckpointId = null,
      evidenceId,
      eventId,
      causationId,
      reason,
      occurredAt = clock(),
    }) {
      const missionState = state(missionId);
      if (isTerminalMissionState(missionState)) {
        throw new WorkspaceStateError(
          missionId,
          missionState,
          "create checkpoint",
        );
      }
      const workspace = workspaceFor(missionId);
      assertWorkspaceId(workspace, workspaceId);
      if (workspace.checkpointChain.includes(checkpointId)) {
        throw new DuplicateCheckpointError(checkpointId);
      }
      const parentId =
        parentCheckpointId ?? workspace.currentCheckpointId;
      if (parentId !== workspace.currentCheckpointId) {
        throw new CheckpointParentError(checkpointId, parentId);
      }
      const { record } = store.persistCheckpoint(
        {
          checkpointId,
          workspaceId,
          missionId,
          parentCheckpointId: parentId,
          creationTimestamp: occurredAt,
          reason,
          rootPath: workspace.rootPath,
        },
        { allowExisting: true },
      );
      const observation = captureOrReuseEvidence(evidence, {
        evidenceId,
        missionId,
        kind: ObservationKind.FILE_CONTENT_HASH,
        captureMethod: "workspace-manifest-observation",
        producingSubsystem: "WORKSPACE_SERVICE",
        timestamp: occurredAt,
        payload: {
          path: workspace.rootPath,
          algorithm: "sha256",
          contentHash: record.manifestHash,
          expectedHash: null,
          matches: null,
        },
        workspaceCheckpointReference: checkpointId,
        obligationReference: null,
        verificationRequestReference: null,
        commandReference: null,
        workUnitReference: null,
        metadata: { workspaceId, operation: "checkpoint" },
      });
      append({
        missionId,
        eventId,
        causationId,
        occurredAt,
        workspaceFact: operationFact({
          operation: WorkspaceOperation.CHECKPOINT_CREATED,
          workspaceId,
          checkpointId,
          parentCheckpointId: parentId,
          reason,
          evidenceRecord: observation,
        }),
      });
      return decorateCheckpoint(
        store.getCheckpoint(checkpointId),
        workspaceFor(missionId),
      );
    },

    restoreCheckpoint({
      missionId,
      workspaceId,
      checkpointId,
      evidenceId,
      eventId,
      causationId,
      reason,
      preserveTransientDirectories = [],
      occurredAt = clock(),
    }) {
      const missionState = state(missionId);
      if (isTerminalMissionState(missionState)) {
        throw new WorkspaceStateError(missionId, missionState, "restore");
      }
      const workspace = workspaceFor(missionId);
      assertWorkspaceId(workspace, workspaceId);
      const checkpoint = checkpointForProjection(
        store,
        workspace,
        checkpointId,
      );
      const latestVerifiedId = workspace.verifiedCheckpointIds.at(-1) ?? null;
      if (
        latestVerifiedId !== null &&
        !isAtOrAfterVerifiedFloor(
          store,
          workspace,
          checkpointId,
          latestVerifiedId,
        )
      ) {
        throw new VerifiedCheckpointRollbackError(
          checkpointId,
          latestVerifiedId,
        );
      }
      const prepared = store.prepareRestore({
        workspace,
        checkpoint,
        preserveTransientDirectories,
      });
      try {
        const observation = captureOrReuseEvidence(evidence, {
          evidenceId,
          missionId,
          kind: ObservationKind.FILE_CONTENT_HASH,
          captureMethod: "workspace-restore-observation",
          producingSubsystem: "WORKSPACE_SERVICE",
          timestamp: occurredAt,
          payload: {
            path: workspace.rootPath,
            algorithm: "sha256",
            contentHash: checkpoint.manifestHash,
            expectedHash: checkpoint.manifestHash,
            matches: true,
          },
          workspaceCheckpointReference: checkpointId,
          obligationReference: null,
          verificationRequestReference: null,
          commandReference: null,
          workUnitReference: null,
          metadata: { workspaceId, operation: "restore" },
        });
        append({
          missionId,
          eventId,
          causationId,
          occurredAt,
          workspaceFact: operationFact({
            operation: WorkspaceOperation.CHECKPOINT_RESTORED,
            workspaceId,
            checkpointId,
            reason,
            evidenceRecord: observation,
          }),
        });
        prepared.commit();
      } catch (error) {
        prepared.rollback();
        throw error;
      }
      return workspaceFor(missionId);
    },

    markCheckpointVerified({
      missionId,
      workspaceId,
      checkpointId,
      evidenceId,
      eventId,
      causationId,
      reason,
      occurredAt = clock(),
    }) {
      const missionState = state(missionId);
      if (isTerminalMissionState(missionState)) {
        throw new WorkspaceStateError(
          missionId,
          missionState,
          "verify checkpoint",
        );
      }
      const workspace = workspaceFor(missionId);
      assertWorkspaceId(workspace, workspaceId);
      checkpointForProjection(store, workspace, checkpointId);
      if (workspace.verifiedCheckpointIds.includes(checkpointId)) {
        throw new CheckpointAlreadyVerifiedError(checkpointId);
      }
      const latestVerifiedId = workspace.verifiedCheckpointIds.at(-1) ?? null;
      if (
        latestVerifiedId !== null &&
        !isAtOrAfterVerifiedFloor(
          store,
          workspace,
          checkpointId,
          latestVerifiedId,
        )
      ) {
        throw new VerifiedCheckpointRollbackError(
          checkpointId,
          latestVerifiedId,
        );
      }
      let observation;
      try {
        observation = evidence.getById(evidenceId);
      } catch (error) {
        throw new EvidenceReferenceError(
          `Checkpoint verification evidence "${evidenceId}" is invalid.`,
          evidenceId,
          { cause: error },
        );
      }
      if (
        observation.missionId !== missionId ||
        observation.workspaceCheckpointReference !== checkpointId
      ) {
        throw new EvidenceReferenceError(
          `Checkpoint verification evidence "${evidenceId}" has invalid mission or checkpoint ownership.`,
          evidenceId,
        );
      }
      append({
        missionId,
        eventId,
        causationId,
        occurredAt,
        workspaceFact: operationFact({
          operation: WorkspaceOperation.CHECKPOINT_VERIFIED,
          workspaceId,
          checkpointId,
          reason,
          evidenceRecord: observation,
        }),
      });
      return decorateCheckpoint(
        store.getCheckpoint(checkpointId),
        workspaceFor(missionId),
      );
    },

    getLatestCheckpoint(missionId) {
      const workspace = workspaceFor(missionId);
      return decorateCheckpoint(
        store.getCheckpoint(workspace.checkpointChain.at(-1)),
        workspace,
      );
    },

    getLatestVerifiedCheckpoint(missionId) {
      const workspace = workspaceFor(missionId);
      const checkpointId = workspace.verifiedCheckpointIds.at(-1);
      return checkpointId === undefined
        ? null
        : decorateCheckpoint(store.getCheckpoint(checkpointId), workspace);
    },

    readFile({ missionId, workspaceId, relativePath, encoding = "utf8" }) {
      const workspace = workspaceFor(missionId);
      assertWorkspaceId(workspace, workspaceId);
      if (workspace.lifecycleStatus === WorkspaceLifecycleStatus.RELEASED) {
        throw new WorkspaceNotFoundError(missionId);
      }
      const content = store.readFile({
        workspaceId,
        missionId,
        rootPath: workspace.rootPath,
        relativePath,
      });
      if (encoding === null) {
        return Buffer.from(content);
      }
      if (encoding !== "utf8") {
        throw new WorkspaceValidationError(
          "Workspace reads support only utf8 or null encoding.",
        );
      }
      return content.toString("utf8");
    },

    releaseWorkspace({
      missionId,
      workspaceId,
      evidenceId,
      eventId,
      causationId,
      authorizationId,
      preserveVerifiedCheckpoint = false,
      reason,
      occurredAt = clock(),
    }) {
      const missionState = state(missionId);
      if (!isTerminalMissionState(missionState)) {
        throw new WorkspaceStateError(missionId, missionState, "release");
      }
      const workspace = workspaceFor(missionId);
      assertWorkspaceId(workspace, workspaceId);
      assertIdentifier(authorizationId, "authorizationId");
      if (
        workspace.retentionState ===
          WorkspaceRetentionState.VERIFIED_RETAINED &&
        !preserveVerifiedCheckpoint
      ) {
        throw new UnsafeWorkspaceReleaseError(
          missionId,
          "it would destroy the live copy without explicitly retaining verified checkpoint data",
        );
      }
      const prepared = store.prepareRelease({ workspace });
      try {
        const observation = captureOrReuseEvidence(evidence, {
          evidenceId,
          missionId,
          kind: ObservationKind.FILE_EXISTENCE,
          captureMethod: "workspace-release-observation",
          producingSubsystem: "WORKSPACE_SERVICE",
          timestamp: occurredAt,
          payload: { path: workspace.rootPath, exists: false },
          workspaceCheckpointReference: workspace.currentCheckpointId,
          obligationReference: null,
          verificationRequestReference: null,
          commandReference: null,
          workUnitReference: null,
          metadata: { workspaceId, operation: "release" },
        });
        append({
          missionId,
          eventId,
          causationId,
          occurredAt,
          workspaceFact: operationFact({
            operation: WorkspaceOperation.WORKSPACE_RELEASED,
            workspaceId,
            checkpointId: workspace.currentCheckpointId,
            reason,
            evidenceRecord: observation,
            authorizationId,
            preserveVerifiedCheckpoint,
          }),
        });
        prepared.commit();
      } catch (error) {
        prepared.rollback();
        throw error;
      }
      return workspaceFor(missionId);
    },
  });

  function executionWorkspace(missionId, workspaceId) {
    const missionState = state(missionId);
    if (missionState !== MissionState.EXECUTING) {
      throw new WorkspaceStateError(
        missionId,
        missionState,
        "execution mutation",
      );
    }
    const workspace = workspaceFor(missionId);
    assertWorkspaceId(workspace, workspaceId);
    if (workspace.lifecycleStatus !== WorkspaceLifecycleStatus.ACTIVE) {
      throw new WorkspaceStateError(
        missionId,
        missionState,
        "execution mutation",
      );
    }
    return workspace;
  }

  const executionAuthority = Object.freeze({
    workspace(missionId, workspaceId) {
      return executionWorkspace(missionId, workspaceId);
    },
    writeFile({ missionId, workspaceId, relativePath, content }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      store.writeNewFile({ workspace, relativePath, content });
    },
    replaceFile({ missionId, workspaceId, relativePath, content }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      store.replaceFile({ workspace, relativePath, content });
    },
    deleteFile({ missionId, workspaceId, relativePath }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      store.deleteFile({ workspace, relativePath });
    },
    createDirectory({ missionId, workspaceId, relativePath }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      store.createDirectory({ workspace, relativePath });
    },
    resolveWorkingDirectory({
      missionId,
      workspaceId,
      relativePath = ".",
    }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      return store.resolveWorkingDirectory({ workspace, relativePath });
    },
    listFiles({ missionId, workspaceId, relativePath = "." }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      return store.listFiles({ workspace, relativePath });
    },
    readFile({ missionId, workspaceId, relativePath }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      return store.readFile({
        workspaceId,
        missionId,
        rootPath: workspace.rootPath,
        relativePath,
      });
    },
    pathInfo({ missionId, workspaceId, relativePath }) {
      const workspace = executionWorkspace(missionId, workspaceId);
      return store.pathInfo({ workspace, relativePath });
    },
  });

  return Object.freeze({ publicWorkspaceService, executionAuthority });
}
