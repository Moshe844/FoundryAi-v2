import { createHash } from "node:crypto";

import {
  EvidenceNotFoundError,
  EvidenceReferenceError,
  ExecutionInterruptionError,
  ExecutionStateError,
  ExecutionValidationError,
  WorkUnitIdempotencyError,
} from "../domain/errors.js";
import {
  EXECUTION_ENGINE_SOURCE,
  WorkUnitAction,
  WorkUnitStatus,
  assertExecutionIdentifier,
  canonicalizeExecutionValue,
  freezeExecutionValue,
  normalizeWorkUnitRecord,
  projectExecutionHistory,
} from "../domain/execution.js";
import { MissionState } from "../domain/lifecycle.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import { runControlledCommand } from "./command-runner.js";

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) {
    throw new ExecutionValidationError(`${label} must be a plain object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new ExecutionValidationError(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function normalizeTargets(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ExecutionValidationError(
      "targetObligationIds must be a non-empty array.",
    );
  }
  const result = value.map((id) => {
    assertExecutionIdentifier(id, "target obligation ID");
    return id;
  });
  if (new Set(result).size !== result.length) {
    throw new ExecutionValidationError(
      "targetObligationIds contains duplicates.",
    );
  }
  return result;
}

function normalizeSensitiveValues(value) {
  if (value === undefined) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.some(
      (entry) => typeof entry !== "string" || entry.length === 0,
    )
  ) {
    throw new ExecutionValidationError(
      "inputs.sensitiveValues must be an array of non-empty strings.",
    );
  }
  return [...new Set(value)];
}

function normalizeActionInputs(actionType, input) {
  if (!isPlainObject(input)) {
    throw new ExecutionValidationError("work-unit inputs must be an object.");
  }
  switch (actionType) {
    case WorkUnitAction.APPLY_FILE_BUNDLE: {
      assertExactKeys(input, ["files"], "file-bundle inputs");
      if (!Array.isArray(input.files) || input.files.length === 0) {
        throw new ExecutionValidationError(
          "File-bundle inputs require at least one file.",
        );
      }
      const seenPaths = new Set();
      const files = input.files.map((file, index) => {
        if (!isPlainObject(file)) {
          throw new ExecutionValidationError(
            `File-bundle entry ${index} must be an object.`,
          );
        }
        const allowed = ["content", "path", "sensitiveValues"];
        const actual = Object.keys(file).sort();
        if (
          !actual.every((key) => allowed.includes(key)) ||
          !actual.includes("content") ||
          !actual.includes("path") ||
          typeof file.path !== "string" ||
          file.path.length === 0 ||
          typeof file.content !== "string"
        ) {
          throw new ExecutionValidationError(
            `File-bundle entry ${index} requires string path and content values.`,
          );
        }
        if (seenPaths.has(file.path)) {
          throw new ExecutionValidationError(
            `File-bundle path "${file.path}" is duplicated.`,
          );
        }
        seenPaths.add(file.path);
        const sensitiveValues = normalizeSensitiveValues(
          file.sensitiveValues,
        );
        return {
          runtime: {
            path: file.path,
            content: file.content,
            sensitiveValues,
          },
          persisted: {
            path: file.path,
            encoding: "utf8",
            byteLength: Buffer.byteLength(file.content),
            contentHash: sha256(file.content),
            sensitiveValueCount: sensitiveValues.length,
          },
        };
      });
      return {
        runtime: { files: files.map((file) => file.runtime) },
        persisted: { files: files.map((file) => file.persisted) },
      };
    }
    case WorkUnitAction.WRITE_FILE:
    case WorkUnitAction.REPLACE_FILE: {
      const allowed = ["content", "path", "sensitiveValues"];
      const actual = Object.keys(input).sort();
      if (
        !actual.every((key) => allowed.includes(key)) ||
        !actual.includes("content") ||
        !actual.includes("path")
      ) {
        throw new ExecutionValidationError(
          "File-write inputs require path and content, with optional sensitiveValues.",
        );
      }
      if (
        typeof input.path !== "string" ||
        input.path.length === 0 ||
        typeof input.content !== "string"
      ) {
        throw new ExecutionValidationError(
          "File-write path and content must be strings.",
        );
      }
      const sensitiveValues = normalizeSensitiveValues(input.sensitiveValues);
      return {
        runtime: {
          path: input.path,
          content: input.content,
          sensitiveValues,
        },
        persisted: {
          path: input.path,
          encoding: "utf8",
          byteLength: Buffer.byteLength(input.content),
          contentHash: sha256(input.content),
          sensitiveValueCount: sensitiveValues.length,
        },
      };
    }
    case WorkUnitAction.DELETE_FILE:
    case WorkUnitAction.CREATE_DIRECTORY:
    case WorkUnitAction.INSPECT_FILE:
      assertExactKeys(input, ["path"], "path action inputs");
      if (typeof input.path !== "string" || input.path.length === 0) {
        throw new ExecutionValidationError(
          "Path action input path must be non-empty.",
        );
      }
      return { runtime: { path: input.path }, persisted: { path: input.path } };
    case WorkUnitAction.LIST_FILES: {
      const path = input.path ?? ".";
      if (
        !["", "path"].includes(Object.keys(input).join("")) ||
        typeof path !== "string" ||
        path.length === 0
      ) {
        throw new ExecutionValidationError(
          "List-files inputs may contain only a non-empty path.",
        );
      }
      return { runtime: { path }, persisted: { path } };
    }
    case WorkUnitAction.RUN_COMMAND: {
      const allowed = [
        "environment",
        "outputLimitBytes",
        "procedureName",
        "timeoutMs",
        "workingDirectory",
      ];
      if (
        Object.keys(input).some((key) => !allowed.includes(key)) ||
        typeof input.procedureName !== "string" ||
        input.procedureName.length === 0
      ) {
        throw new ExecutionValidationError(
          "Run-command inputs contain an undeclared field or missing procedureName.",
        );
      }
      const environment = input.environment ?? {};
      if (!isPlainObject(environment)) {
        throw new ExecutionValidationError(
          "Run-command environment must be an object.",
        );
      }
      return {
        runtime: {
          procedureName: input.procedureName,
          workingDirectory: input.workingDirectory ?? ".",
          environment,
          timeoutMs: input.timeoutMs ?? 30_000,
          outputLimitBytes: input.outputLimitBytes ?? 16_384,
        },
        persisted: {
          procedureName: input.procedureName,
          workingDirectory: input.workingDirectory ?? ".",
          environmentVariableNames: Object.keys(environment).sort(),
          timeoutMs: input.timeoutMs ?? 30_000,
          outputLimitBytes: input.outputLimitBytes ?? 16_384,
        },
      };
    }
    default:
      throw new ExecutionValidationError(
        `Unsupported work-unit action "${actionType}".`,
      );
  }
}

function evidenceReference(record, checkpointId) {
  return {
    evidenceId: record.evidenceId,
    workspaceCheckpointReference: checkpointId,
  };
}

function captureOrReuse(evidence, input) {
  try {
    const existing = evidence.getById(input.evidenceId);
    const expected = {
      missionId: input.missionId,
      kind: input.kind,
      captureMethod: input.captureMethod,
      producingSubsystem: input.producingSubsystem,
      timestamp: input.timestamp,
      payload: input.payload,
      workspaceCheckpointReference: input.workspaceCheckpointReference,
      obligationReference: input.obligationReference,
      commandReference: input.commandReference,
      workUnitReference: input.workUnitReference,
      metadata: input.metadata,
    };
    const actual = {
      missionId: existing.missionId,
      kind: existing.kind,
      captureMethod: existing.captureMethod,
      producingSubsystem: existing.producingSubsystem,
      timestamp: existing.timestamp,
      payload: existing.payload,
      workspaceCheckpointReference: existing.workspaceCheckpointReference,
      obligationReference: existing.obligationReference,
      commandReference: existing.commandReference,
      workUnitReference: existing.workUnitReference,
      metadata: existing.metadata,
    };
    if (
      canonicalizeExecutionValue(expected) !==
      canonicalizeExecutionValue(actual)
    ) {
      throw new EvidenceReferenceError(
        `Existing execution evidence "${input.evidenceId}" does not match recovery input.`,
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

export function createExecutionEngine({
  ledger,
  contracts,
  facts,
  evidence,
  workspaces,
  workspaceExecutionAuthority,
  toolchains,
  clock,
  faultInjector = null,
}) {
  if (faultInjector !== null && typeof faultInjector !== "function") {
    throw new ExecutionValidationError(
      "faultInjector must be null or a function.",
    );
  }

  function history(missionId) {
    return projectExecutionHistory(ledger.listEvents(missionId), missionId);
  }

  function startRecord(missionId, idempotencyKey) {
    return ledger
      .listEvents(missionId)
      .find(
        (event) =>
          event.fact?.metadata?.executionStart?.idempotencyKey ===
          idempotencyKey,
      )?.fact.metadata.executionStart;
  }

  async function executeWorkUnit(request, options = {}) {
    assertExactKeys(
      request,
      [
        "actionType",
        "idempotencyKey",
        "inputs",
        "missionId",
        "postWorkCheckpointId",
        "preWorkCheckpointId",
        "targetObligationIds",
        "workUnitId",
        "workspaceId",
      ],
      "work-unit request",
    );
    for (const [label, value] of [
      ["workUnitId", request.workUnitId],
      ["missionId", request.missionId],
      ["workspaceId", request.workspaceId],
      ["preWorkCheckpointId", request.preWorkCheckpointId],
      ["postWorkCheckpointId", request.postWorkCheckpointId],
      ["idempotencyKey", request.idempotencyKey],
    ]) {
      assertExecutionIdentifier(value, label);
    }
    if (!Object.values(WorkUnitAction).includes(request.actionType)) {
      throw new ExecutionValidationError("actionType is invalid.");
    }
    if (
      ledger.projectState(request.missionId).state !== MissionState.EXECUTING
    ) {
      throw new ExecutionStateError(
        request.missionId,
        ledger.projectState(request.missionId).state,
      );
    }
    const targets = normalizeTargets(request.targetObligationIds);
    const contract = contracts.getContract(request.missionId);
    const obligationIds = new Set(
      contract.obligations.map((obligation) => obligation.obligationId),
    );
    if (targets.some((target) => !obligationIds.has(target))) {
      throw new ExecutionValidationError(
        "Work unit targets an obligation absent from the current contract.",
      );
    }
    const normalizedInputs = normalizeActionInputs(
      request.actionType,
      request.inputs,
    );
    const fingerprint = {
      workUnitId: request.workUnitId,
      missionId: request.missionId,
      workspaceId: request.workspaceId,
      targetObligationIds: targets,
      actionType: request.actionType,
      inputs: normalizedInputs.persisted,
      preWorkCheckpointId: request.preWorkCheckpointId,
      postWorkCheckpointId: request.postWorkCheckpointId,
    };
    const currentHistory = history(request.missionId);
    const existing = currentHistory.workUnits.find(
      (workUnit) =>
        workUnit.idempotencyKey === request.idempotencyKey,
    );
    if (existing !== undefined) {
      const existingFingerprint = {
        workUnitId: existing.workUnitId,
        missionId: existing.missionId,
        workspaceId: existing.workspaceId,
        targetObligationIds: existing.targetObligationIds,
        actionType: existing.actionType,
        inputs: existing.inputs,
        preWorkCheckpointId: existing.preWorkCheckpointId,
        postWorkCheckpointId: existing.postWorkCheckpointId,
      };
      if (
        canonicalizeExecutionValue(fingerprint) !==
        canonicalizeExecutionValue(existingFingerprint)
      ) {
        throw new WorkUnitIdempotencyError(request.idempotencyKey);
      }
      return existing;
    }
    if (
      currentHistory.workUnits.some(
        (workUnit) => workUnit.workUnitId === request.workUnitId,
      )
    ) {
      throw new WorkUnitIdempotencyError(request.idempotencyKey);
    }

    const selection = toolchains.getMissionSelection(request.missionId);
    const stack = toolchains.getStack(
      selection.stackId,
      selection.stackVersion,
    );
    let workspace = workspaceExecutionAuthority.workspace(
      request.missionId,
      request.workspaceId,
    );
    const priorStart = startRecord(
      request.missionId,
      request.idempotencyKey,
    );
    if (
      priorStart !== undefined &&
      canonicalizeExecutionValue(priorStart.fingerprint) !==
        canonicalizeExecutionValue(fingerprint)
    ) {
      throw new WorkUnitIdempotencyError(request.idempotencyKey);
    }
    const startTimestamp = priorStart?.startTimestamp ?? clock();

    if (
      !workspace.checkpointChain.includes(request.preWorkCheckpointId)
    ) {
      workspaces.createCheckpoint({
        missionId: request.missionId,
        workspaceId: request.workspaceId,
        checkpointId: request.preWorkCheckpointId,
        evidenceId: `${request.workUnitId}.pre.evidence`,
        eventId: `${request.workUnitId}.pre.checkpoint`,
        causationId: request.idempotencyKey,
        reason: `Capture pre-work checkpoint for ${request.workUnitId}.`,
        occurredAt: startTimestamp,
      });
    }
    workspace = workspaceExecutionAuthority.workspace(
      request.missionId,
      request.workspaceId,
    );
    if (
      workspace.currentCheckpointId !== request.preWorkCheckpointId &&
      workspace.currentCheckpointId !== request.postWorkCheckpointId
    ) {
      throw new ExecutionValidationError(
        "Work-unit checkpoint chain is not at its pre-work or post-work checkpoint.",
      );
    }
    if (priorStart === undefined) {
      facts.recordResultFact({
        missionId: request.missionId,
        eventId: `${request.workUnitId}.started`,
        causationId: request.idempotencyKey,
        occurredAt: startTimestamp,
        producingSubsystem: EXECUTION_ENGINE_SOURCE,
        statement: `Work unit "${request.workUnitId}" started from its immutable pre-work checkpoint.`,
        evidenceReferences: [
          {
            evidenceId: `${request.workUnitId}.pre.evidence`,
            workspaceCheckpointReference: request.preWorkCheckpointId,
          },
        ],
        workspaceCheckpointReference: request.preWorkCheckpointId,
        workUnitReference: null,
        metadata: {
          executionStart: {
            idempotencyKey: request.idempotencyKey,
            startTimestamp,
            fingerprint,
          },
        },
      });
    }

    let actionResult;
    const alreadyAtPost =
      workspace.currentCheckpointId === request.postWorkCheckpointId;
    const existingEvidence = evidence.findByWorkUnit(request.workUnitId);
    if (alreadyAtPost && existingEvidence.length > 0) {
      const primary = existingEvidence.find(
        (record) => record.kind === ObservationKind.WORK_UNIT_RESULT,
      );
      const incompleteCommandEvidence =
        request.actionType === WorkUnitAction.RUN_COMMAND &&
        !existingEvidence.some(
          (record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT,
        );
      actionResult = {
        status: incompleteCommandEvidence
          ? WorkUnitStatus.FAILED
          : (primary?.payload.status ?? WorkUnitStatus.FAILED),
        detail:
          incompleteCommandEvidence
            ? "Recovered a command checkpoint without complete immutable command evidence."
            : (primary?.payload.detail ??
              "Recovered a post-work checkpoint without primary evidence."),
        observations: null,
        command: null,
        sensitiveValues: [],
        endTimestamp: primary?.timestamp ?? clock(),
        recoveredEvidence: existingEvidence,
        requiresRecoveryEvidence: incompleteCommandEvidence,
      };
    } else {
      const recovering = priorStart !== undefined;
      try {
        switch (request.actionType) {
          case WorkUnitAction.APPLY_FILE_BUNDLE: {
            const directories = new Set();
            for (const file of normalizedInputs.runtime.files) {
              const segments = file.path.replaceAll("\\", "/").split("/");
              for (let index = 1; index < segments.length; index += 1) {
                directories.add(segments.slice(0, index).join("/"));
              }
            }
            for (const directory of [...directories].sort(
              (left, right) =>
                left.split("/").length - right.split("/").length ||
                left.localeCompare(right),
            )) {
              const info = workspaceExecutionAuthority.pathInfo({
                missionId: request.missionId,
                workspaceId: request.workspaceId,
                relativePath: directory,
              });
              if (!info.exists) {
                workspaceExecutionAuthority.createDirectory({
                  missionId: request.missionId,
                  workspaceId: request.workspaceId,
                  relativePath: directory,
                });
              } else if (info.type !== "directory") {
                throw new ExecutionValidationError(
                  `Generated bundle parent "${directory}" is not a directory.`,
                );
              }
            }
            const entries = [];
            const sensitiveValues = [];
            for (const file of normalizedInputs.runtime.files) {
              const desired = Buffer.from(file.content, "utf8");
              const info = workspaceExecutionAuthority.pathInfo({
                missionId: request.missionId,
                workspaceId: request.workspaceId,
                relativePath: file.path,
              });
              if (info.exists) {
                if (info.type !== "file") {
                  throw new ExecutionValidationError(
                    `Generated bundle path "${file.path}" is not a file.`,
                  );
                }
                const existing = workspaceExecutionAuthority.readFile({
                  missionId: request.missionId,
                  workspaceId: request.workspaceId,
                  relativePath: file.path,
                });
                if (sha256(existing) !== sha256(desired)) {
                  throw new ExecutionValidationError(
                    `Generated bundle recovery found conflicting content at "${file.path}".`,
                  );
                }
              } else {
                workspaceExecutionAuthority.writeFile({
                  missionId: request.missionId,
                  workspaceId: request.workspaceId,
                  relativePath: file.path,
                  content: desired,
                });
              }
              sensitiveValues.push(...file.sensitiveValues);
              entries.push(file.path);
            }
            actionResult = {
              status: WorkUnitStatus.SUCCEEDED,
              detail: `Observed ${entries.length} generated files after one atomic bundle application.`,
              observations: { path: ".", entries },
              command: null,
              sensitiveValues: [...new Set(sensitiveValues)],
              endTimestamp: clock(),
            };
            break;
          }
          case WorkUnitAction.WRITE_FILE:
          case WorkUnitAction.REPLACE_FILE: {
            const info = workspaceExecutionAuthority.pathInfo({
              missionId: request.missionId,
              workspaceId: request.workspaceId,
              relativePath: normalizedInputs.runtime.path,
            });
            const desired = Buffer.from(
              normalizedInputs.runtime.content,
              "utf8",
            );
            if (
              recovering &&
              info.exists &&
              info.type === "file" &&
              sha256(
                workspaceExecutionAuthority.readFile({
                  missionId: request.missionId,
                  workspaceId: request.workspaceId,
                  relativePath: normalizedInputs.runtime.path,
                }),
              ) === sha256(desired)
            ) {
              // The real mutation completed before interruption.
            } else if (request.actionType === WorkUnitAction.WRITE_FILE) {
              workspaceExecutionAuthority.writeFile({
                missionId: request.missionId,
                workspaceId: request.workspaceId,
                relativePath: normalizedInputs.runtime.path,
                content: desired,
              });
            } else {
              workspaceExecutionAuthority.replaceFile({
                missionId: request.missionId,
                workspaceId: request.workspaceId,
                relativePath: normalizedInputs.runtime.path,
                content: desired,
              });
            }
            const content = workspaceExecutionAuthority.readFile({
              missionId: request.missionId,
              workspaceId: request.workspaceId,
              relativePath: normalizedInputs.runtime.path,
            });
            actionResult = {
              status: WorkUnitStatus.SUCCEEDED,
              detail: `Observed file "${normalizedInputs.runtime.path}" after mutation.`,
              observations: {
                path: normalizedInputs.runtime.path,
                exists: true,
                content,
              },
              command: null,
              sensitiveValues: normalizedInputs.runtime.sensitiveValues,
              endTimestamp: clock(),
            };
            break;
          }
          case WorkUnitAction.DELETE_FILE: {
            const info = workspaceExecutionAuthority.pathInfo({
              missionId: request.missionId,
              workspaceId: request.workspaceId,
              relativePath: normalizedInputs.runtime.path,
            });
            if (!(recovering && !info.exists)) {
              workspaceExecutionAuthority.deleteFile({
                missionId: request.missionId,
                workspaceId: request.workspaceId,
                relativePath: normalizedInputs.runtime.path,
              });
            }
            actionResult = {
              status: WorkUnitStatus.SUCCEEDED,
              detail: `Observed file "${normalizedInputs.runtime.path}" as absent.`,
              observations: {
                path: normalizedInputs.runtime.path,
                exists: false,
              },
              command: null,
              sensitiveValues: [],
              endTimestamp: clock(),
            };
            break;
          }
          case WorkUnitAction.CREATE_DIRECTORY: {
            const info = workspaceExecutionAuthority.pathInfo({
              missionId: request.missionId,
              workspaceId: request.workspaceId,
              relativePath: normalizedInputs.runtime.path,
            });
            if (!(recovering && info.exists && info.type === "directory")) {
              workspaceExecutionAuthority.createDirectory({
                missionId: request.missionId,
                workspaceId: request.workspaceId,
                relativePath: normalizedInputs.runtime.path,
              });
            }
            actionResult = {
              status: WorkUnitStatus.SUCCEEDED,
              detail: `Observed directory "${normalizedInputs.runtime.path}" as present.`,
              observations: {
                path: normalizedInputs.runtime.path,
                exists: true,
              },
              command: null,
              sensitiveValues: [],
              endTimestamp: clock(),
            };
            break;
          }
          case WorkUnitAction.INSPECT_FILE: {
            const content = workspaceExecutionAuthority.readFile({
              missionId: request.missionId,
              workspaceId: request.workspaceId,
              relativePath: normalizedInputs.runtime.path,
            });
            actionResult = {
              status: WorkUnitStatus.SUCCEEDED,
              detail: `Inspected file "${normalizedInputs.runtime.path}".`,
              observations: {
                path: normalizedInputs.runtime.path,
                exists: true,
                content,
              },
              command: null,
              sensitiveValues: [],
              endTimestamp: clock(),
            };
            break;
          }
          case WorkUnitAction.LIST_FILES: {
            const entries = workspaceExecutionAuthority.listFiles({
              missionId: request.missionId,
              workspaceId: request.workspaceId,
              relativePath: normalizedInputs.runtime.path,
            });
            actionResult = {
              status: WorkUnitStatus.SUCCEEDED,
              detail: `Listed ${entries.length} workspace files.`,
              observations: {
                path: normalizedInputs.runtime.path,
                entries,
              },
              command: null,
              sensitiveValues: [],
              endTimestamp: clock(),
            };
            break;
          }
          case WorkUnitAction.RUN_COMMAND: {
            if (recovering) {
              const primary = existingEvidence.find(
                (record) =>
                  record.kind === ObservationKind.WORK_UNIT_RESULT,
              );
              const commandEvidence = existingEvidence.find(
                (record) =>
                  record.kind === ObservationKind.COMMAND_EXIT_RESULT,
              );
              const completeEvidence =
                primary !== undefined && commandEvidence !== undefined;
              actionResult = {
                status: completeEvidence
                  ? primary.payload.status
                  : WorkUnitStatus.FAILED,
                detail:
                  completeEvidence
                    ? primary.payload.detail
                    : "Interrupted command was not repeated because complete immutable result evidence was unavailable.",
                observations: null,
                command: null,
                sensitiveValues: [],
                endTimestamp: primary?.timestamp ?? clock(),
                recoveredEvidence: existingEvidence,
                requiresRecoveryEvidence: !completeEvidence,
              };
              break;
            }
            const procedure =
              stack.manifest.procedures[
                normalizedInputs.runtime.procedureName
              ];
            if (procedure === undefined) {
              throw new ExecutionValidationError(
                `Procedure "${normalizedInputs.runtime.procedureName}" is not declared by the selected stack.`,
              );
            }
            const workingDirectory =
              workspaceExecutionAuthority.resolveWorkingDirectory({
                missionId: request.missionId,
                workspaceId: request.workspaceId,
                relativePath:
                  normalizedInputs.runtime.workingDirectory,
              });
            const command = await runControlledCommand({
              procedure,
              workingDirectory,
              environment: normalizedInputs.runtime.environment,
              timeoutMs: normalizedInputs.runtime.timeoutMs,
              outputLimitBytes:
                normalizedInputs.runtime.outputLimitBytes,
              cancellationSignal: options.cancellationSignal ?? null,
              clock,
            });
            actionResult = {
              status: command.status,
              detail: `Controlled procedure "${normalizedInputs.runtime.procedureName}" ended with operational status ${command.status}.`,
              observations: null,
              command,
              sensitiveValues: command.sensitiveValues,
              endTimestamp: command.endTimestamp,
            };
            break;
          }
          default:
            throw new ExecutionValidationError("Unsupported action.");
        }
      } catch (error) {
        if (error instanceof ExecutionInterruptionError) {
          throw error;
        }
        actionResult = {
          status: WorkUnitStatus.FAILED,
          detail: error.message,
          observations: null,
          command: null,
          sensitiveValues: [],
          endTimestamp: clock(),
        };
      }
      if (faultInjector !== null) {
        faultInjector("after-action", freezeExecutionValue(fingerprint));
      }
    }

    const postCheckpointId = request.postWorkCheckpointId;
    const evidenceRecords = [...(actionResult.recoveredEvidence ?? [])];
    if (actionResult.requiresRecoveryEvidence === true) {
      evidenceRecords.push(
        captureOrReuse(evidence, {
          evidenceId: `${request.workUnitId}.recovery`,
          missionId: request.missionId,
          kind: ObservationKind.WORK_UNIT_RESULT,
          captureMethod: "execution-engine-interruption-recovery",
          producingSubsystem: EXECUTION_ENGINE_SOURCE,
          timestamp: actionResult.endTimestamp,
          payload: {
            actionType: request.actionType,
            status: WorkUnitStatus.FAILED,
            detail: actionResult.detail,
          },
          sensitiveValues: [],
          workspaceCheckpointReference: postCheckpointId,
          obligationReference: targets[0],
          verificationRequestReference: null,
          commandReference: normalizedInputs.runtime.procedureName,
          workUnitReference: request.workUnitId,
          metadata: {
            workspaceId: request.workspaceId,
            interrupted: true,
          },
        }),
      );
    }
    if (evidenceRecords.length === 0) {
      evidenceRecords.push(
        captureOrReuse(evidence, {
          evidenceId: `${request.workUnitId}.result`,
          missionId: request.missionId,
          kind: ObservationKind.WORK_UNIT_RESULT,
          captureMethod: "execution-engine-action-observation",
          producingSubsystem: EXECUTION_ENGINE_SOURCE,
          timestamp: actionResult.endTimestamp,
          payload: {
            actionType: request.actionType,
            status: actionResult.status,
            detail: actionResult.detail,
          },
          sensitiveValues: actionResult.sensitiveValues,
          workspaceCheckpointReference: postCheckpointId,
          obligationReference: targets[0],
          verificationRequestReference: null,
          commandReference:
            request.actionType === WorkUnitAction.RUN_COMMAND
              ? normalizedInputs.runtime.procedureName
              : null,
          workUnitReference: request.workUnitId,
          metadata: { workspaceId: request.workspaceId },
        }),
      );
      if (actionResult.command !== null) {
        const command = actionResult.command;
        evidenceRecords.push(
          captureOrReuse(evidence, {
            evidenceId: `${request.workUnitId}.command`,
            missionId: request.missionId,
            kind: ObservationKind.COMMAND_EXIT_RESULT,
            captureMethod: "controlled-child-process-observation",
            producingSubsystem: EXECUTION_ENGINE_SOURCE,
            timestamp: actionResult.endTimestamp,
            payload: {
              exitCode: command.exitCode,
              stdout: command.stdout,
              stderr: command.stderr,
            },
            sensitiveValues: actionResult.sensitiveValues,
            workspaceCheckpointReference: postCheckpointId,
            obligationReference: targets[0],
            verificationRequestReference: null,
            commandReference: normalizedInputs.runtime.procedureName,
            workUnitReference: request.workUnitId,
            metadata: {
              declaredExecutable: command.declaredExecutable,
              resolvedExecutable: command.resolvedExecutable,
              arguments: command.arguments,
              workingDirectory: command.workingDirectory,
              environmentVariableNames:
                command.environmentVariableNames,
              startTimestamp: command.startTimestamp,
              endTimestamp: command.endTimestamp,
              timeoutMs: normalizedInputs.runtime.timeoutMs,
              timedOut: command.timedOut,
              cancelled: command.cancelled,
              processId: command.processId,
              outputLimitBytes:
                normalizedInputs.runtime.outputLimitBytes,
              outputLimitExceeded: command.outputLimitExceeded,
            },
          }),
        );
      }
      if (actionResult.observations?.entries !== undefined) {
        evidenceRecords.push(
          captureOrReuse(evidence, {
            evidenceId: `${request.workUnitId}.listing`,
            missionId: request.missionId,
            kind: ObservationKind.FILE_LISTING,
            captureMethod: "workspace-filesystem-listing",
            producingSubsystem: EXECUTION_ENGINE_SOURCE,
            timestamp: actionResult.endTimestamp,
            payload: {
              path: actionResult.observations.path,
              entries: actionResult.observations.entries,
            },
            sensitiveValues: [],
            workspaceCheckpointReference: postCheckpointId,
            obligationReference: targets[0],
            verificationRequestReference: null,
            commandReference: null,
            workUnitReference: request.workUnitId,
            metadata: { workspaceId: request.workspaceId },
          }),
        );
      } else if (actionResult.observations !== null) {
        const observed = actionResult.observations;
        evidenceRecords.push(
          captureOrReuse(evidence, {
            evidenceId: `${request.workUnitId}.exists`,
            missionId: request.missionId,
            kind: ObservationKind.FILE_EXISTENCE,
            captureMethod: "workspace-filesystem-existence",
            producingSubsystem: EXECUTION_ENGINE_SOURCE,
            timestamp: actionResult.endTimestamp,
            payload: { path: observed.path, exists: observed.exists },
            sensitiveValues: [],
            workspaceCheckpointReference: postCheckpointId,
            obligationReference: targets[0],
            verificationRequestReference: null,
            commandReference: null,
            workUnitReference: request.workUnitId,
            metadata: { workspaceId: request.workspaceId },
          }),
        );
        if (observed.content !== undefined) {
          const text = Buffer.from(observed.content).toString("utf8");
          const contentHash = sha256(observed.content);
          evidenceRecords.push(
            captureOrReuse(evidence, {
              evidenceId: `${request.workUnitId}.hash`,
              missionId: request.missionId,
              kind: ObservationKind.FILE_CONTENT_HASH,
              captureMethod: "workspace-file-sha256",
              producingSubsystem: EXECUTION_ENGINE_SOURCE,
              timestamp: actionResult.endTimestamp,
              payload: {
                path: observed.path,
                algorithm: "sha256",
                contentHash,
                expectedHash: null,
                matches: null,
              },
              sensitiveValues: [],
              workspaceCheckpointReference: postCheckpointId,
              obligationReference: targets[0],
              verificationRequestReference: null,
              commandReference: null,
              workUnitReference: request.workUnitId,
              metadata: { workspaceId: request.workspaceId },
            }),
          );
          evidenceRecords.push(
            captureOrReuse(evidence, {
              evidenceId: `${request.workUnitId}.content`,
              missionId: request.missionId,
              kind: ObservationKind.FILE_CONTENT,
              captureMethod: "workspace-file-content-read",
              producingSubsystem: EXECUTION_ENGINE_SOURCE,
              timestamp: actionResult.endTimestamp,
              payload: {
                path: observed.path,
                encoding: "utf8",
                content: text,
                contentHash,
              },
              sensitiveValues: actionResult.sensitiveValues,
              workspaceCheckpointReference: postCheckpointId,
              obligationReference: targets[0],
              verificationRequestReference: null,
              commandReference: null,
              workUnitReference: request.workUnitId,
              metadata: { workspaceId: request.workspaceId },
            }),
          );
        }
      }
    }

    workspace = workspaceExecutionAuthority.workspace(
      request.missionId,
      request.workspaceId,
    );
    if (!workspace.checkpointChain.includes(postCheckpointId)) {
      workspaces.createCheckpoint({
        missionId: request.missionId,
        workspaceId: request.workspaceId,
        checkpointId: postCheckpointId,
        parentCheckpointId: request.preWorkCheckpointId,
        evidenceId: `${request.workUnitId}.post.evidence`,
        eventId: `${request.workUnitId}.post.checkpoint`,
        causationId: request.idempotencyKey,
        reason: `Capture post-work checkpoint for ${request.workUnitId}.`,
        occurredAt: actionResult.endTimestamp,
      });
    }
    if (faultInjector !== null) {
      faultInjector("after-post-checkpoint", freezeExecutionValue(fingerprint));
    }
    const references = evidenceRecords.map((record) =>
      evidenceReference(record, postCheckpointId),
    );
    const record = normalizeWorkUnitRecord({
      ...fingerprint,
      startTimestamp,
      endTimestamp: actionResult.endTimestamp,
      status: actionResult.status,
      evidenceReferences: references,
      idempotencyKey: request.idempotencyKey,
    });
    facts.recordResultFact({
      missionId: request.missionId,
      eventId: `${request.workUnitId}.completed`,
      causationId: request.idempotencyKey,
      occurredAt: actionResult.endTimestamp,
      producingSubsystem: EXECUTION_ENGINE_SOURCE,
      statement: `Work unit "${request.workUnitId}" ended with operational status ${record.status}.`,
      evidenceReferences: references,
      workspaceCheckpointReference: postCheckpointId,
      workUnitReference: request.workUnitId,
      metadata: { executionRecord: record },
    });
    return record;
  }

  return Object.freeze({
    executeWorkUnit,
    listWorkUnits(missionId) {
      return history(missionId).workUnits;
    },
  });
}
