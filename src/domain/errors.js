export class FoundryError extends Error {
  constructor(message, code, options) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class InvalidInputError extends FoundryError {
  constructor(message, options) {
    super(message, "INVALID_INPUT", options);
  }
}

export class MissionAlreadyExistsError extends FoundryError {
  constructor(missionId) {
    super(`Mission "${missionId}" already exists.`, "MISSION_ALREADY_EXISTS");
    this.missionId = missionId;
  }
}

export class MissionNotFoundError extends FoundryError {
  constructor(missionId) {
    super(`Mission "${missionId}" does not exist.`, "MISSION_NOT_FOUND");
    this.missionId = missionId;
  }
}

export class IllegalTransitionError extends FoundryError {
  constructor(missionId, from, to) {
    super(
      `Mission "${missionId}" cannot transition from ${from} to ${to}.`,
      "ILLEGAL_TRANSITION",
    );
    this.missionId = missionId;
    this.from = from;
    this.to = to;
  }
}

export class TerminalStateError extends FoundryError {
  constructor(missionId, from, to) {
    super(
      `Mission "${missionId}" is terminal in ${from} and cannot transition to ${to}.`,
      "TERMINAL_STATE",
    );
    this.missionId = missionId;
    this.from = from;
    this.to = to;
  }
}

export class DuplicateEventError extends FoundryError {
  constructor(missionId, eventId) {
    super(
      `Event "${eventId}" already exists in mission "${missionId}".`,
      "DUPLICATE_EVENT",
    );
    this.missionId = missionId;
    this.eventId = eventId;
  }
}

export class LedgerBusyError extends FoundryError {
  constructor(missionId, options) {
    super(
      `Mission Ledger for "${missionId}" is locked by another writer.`,
      "LEDGER_BUSY",
      options,
    );
    this.missionId = missionId;
  }
}

export class LedgerCorruptionError extends FoundryError {
  constructor(missionId, detail, options) {
    super(
      `Mission Ledger for "${missionId}" is invalid: ${detail}`,
      "LEDGER_CORRUPTION",
      options,
    );
    this.missionId = missionId;
  }
}

export class ContractValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "CONTRACT_VALIDATION", options);
  }
}

export class ContractAlreadyExistsError extends FoundryError {
  constructor(missionId) {
    super(
      `Mission "${missionId}" already has a Requirement Contract.`,
      "CONTRACT_ALREADY_EXISTS",
    );
    this.missionId = missionId;
  }
}

export class ContractNotFoundError extends FoundryError {
  constructor(missionId) {
    super(
      `Mission "${missionId}" does not have a Requirement Contract.`,
      "CONTRACT_NOT_FOUND",
    );
    this.missionId = missionId;
  }
}

export class ContractStateError extends FoundryError {
  constructor(missionId, state, operation) {
    super(
      `Requirement Contract operation "${operation}" is not allowed for mission "${missionId}" in ${state}.`,
      "CONTRACT_STATE",
    );
    this.missionId = missionId;
    this.state = state;
    this.operation = operation;
  }
}

export class ContractRequiredError extends FoundryError {
  constructor(missionId) {
    super(
      `Mission "${missionId}" cannot enter CONTRACTED without a valid recorded Requirement Contract.`,
      "CONTRACT_REQUIRED",
    );
    this.missionId = missionId;
  }
}

export class InvalidContractAmendmentError extends ContractValidationError {
  constructor(message, options) {
    super(message, options);
    this.code = "INVALID_CONTRACT_AMENDMENT";
  }
}

export class EvidenceValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "EVIDENCE_VALIDATION", options);
  }
}

export class DuplicateEvidenceError extends FoundryError {
  constructor(evidenceId) {
    super(
      `Evidence "${evidenceId}" already exists.`,
      "DUPLICATE_EVIDENCE",
    );
    this.evidenceId = evidenceId;
  }
}

export class EvidenceNotFoundError extends FoundryError {
  constructor(evidenceId) {
    super(
      `Evidence "${evidenceId}" does not exist.`,
      "EVIDENCE_NOT_FOUND",
    );
    this.evidenceId = evidenceId;
  }
}

export class EvidenceIntegrityError extends FoundryError {
  constructor(evidenceId, detail, options) {
    super(
      `Evidence "${evidenceId}" failed integrity validation: ${detail}`,
      "EVIDENCE_INTEGRITY",
      options,
    );
    this.evidenceId = evidenceId;
  }
}

export class EvidenceReferenceError extends FoundryError {
  constructor(message, evidenceId, options) {
    super(message, "EVIDENCE_REFERENCE", options);
    this.evidenceId = evidenceId;
  }
}

export class ResultFactValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "RESULT_FACT_VALIDATION", options);
  }
}

export class VerificationValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "VERIFICATION_VALIDATION", options);
  }
}

export class UnsupportedAcceptanceConditionError extends VerificationValidationError {
  constructor(type) {
    super(`Unsupported acceptance-condition type: ${String(type)}.`);
    this.code = "UNSUPPORTED_ACCEPTANCE_CONDITION";
    this.acceptanceConditionType = type;
  }
}

export class VerificationStateError extends FoundryError {
  constructor(missionId, state) {
    super(
      `Mission "${missionId}" must be in VERIFYING, not ${state}, to issue a Completion Verdict.`,
      "VERIFICATION_STATE",
    );
    this.missionId = missionId;
    this.state = state;
  }
}

export class CompletionVerdictRequiredError extends FoundryError {
  constructor(missionId, requiredResult) {
    super(
      `Mission "${missionId}" requires a valid ${requiredResult} Completion Verdict for this transition.`,
      "COMPLETION_VERDICT_REQUIRED",
    );
    this.missionId = missionId;
    this.requiredResult = requiredResult;
  }
}

export class CompletionVerdictIntegrityError extends VerificationValidationError {
  constructor(message, options) {
    super(message, options);
    this.code = "COMPLETION_VERDICT_INTEGRITY";
  }
}

export class WorkspaceValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "WORKSPACE_VALIDATION", options);
  }
}

export class WorkspaceStateError extends FoundryError {
  constructor(missionId, state, operation) {
    super(
      `Workspace operation "${operation}" is not allowed for mission "${missionId}" in ${state}.`,
      "WORKSPACE_STATE",
    );
    this.missionId = missionId;
    this.state = state;
    this.operation = operation;
  }
}

export class WorkspaceAlreadyExistsError extends FoundryError {
  constructor(missionId) {
    super(
      `Mission "${missionId}" already has a workspace.`,
      "WORKSPACE_ALREADY_EXISTS",
    );
    this.missionId = missionId;
  }
}

export class WorkspaceNotFoundError extends FoundryError {
  constructor(missionId) {
    super(
      `Mission "${missionId}" does not have a workspace.`,
      "WORKSPACE_NOT_FOUND",
    );
    this.missionId = missionId;
  }
}

export class WorkspaceIsolationError extends FoundryError {
  constructor(message, options) {
    super(message, "WORKSPACE_ISOLATION", options);
  }
}

export class WorkspacePathError extends FoundryError {
  constructor(message, options) {
    super(message, "WORKSPACE_PATH", options);
  }
}

export class WorkspaceProvisioningRequiredError extends FoundryError {
  constructor(missionId, detail, options) {
    super(
      `Mission "${missionId}" cannot enter EXECUTING: ${detail}.`,
      "WORKSPACE_PROVISIONING_REQUIRED",
      options,
    );
    this.missionId = missionId;
  }
}

export class DuplicateCheckpointError extends FoundryError {
  constructor(checkpointId) {
    super(
      `Checkpoint "${checkpointId}" already exists.`,
      "DUPLICATE_CHECKPOINT",
    );
    this.checkpointId = checkpointId;
  }
}

export class CheckpointNotFoundError extends FoundryError {
  constructor(checkpointId) {
    super(
      `Checkpoint "${checkpointId}" does not exist.`,
      "CHECKPOINT_NOT_FOUND",
    );
    this.checkpointId = checkpointId;
  }
}

export class CheckpointIntegrityError extends FoundryError {
  constructor(checkpointId, detail, options) {
    super(
      `Checkpoint "${checkpointId}" failed integrity validation: ${detail}.`,
      "CHECKPOINT_INTEGRITY",
      options,
    );
    this.checkpointId = checkpointId;
  }
}

export class CheckpointParentError extends FoundryError {
  constructor(checkpointId, parentCheckpointId, options) {
    super(
      `Checkpoint "${checkpointId}" has invalid parent "${parentCheckpointId}".`,
      "CHECKPOINT_PARENT",
      options,
    );
    this.checkpointId = checkpointId;
    this.parentCheckpointId = parentCheckpointId;
  }
}

export class CheckpointAlreadyVerifiedError extends FoundryError {
  constructor(checkpointId) {
    super(
      `Checkpoint "${checkpointId}" is already verified.`,
      "CHECKPOINT_ALREADY_VERIFIED",
    );
    this.checkpointId = checkpointId;
  }
}

export class VerifiedCheckpointRollbackError extends FoundryError {
  constructor(checkpointId, latestVerifiedCheckpointId) {
    super(
      `Checkpoint "${checkpointId}" is behind latest verified checkpoint "${latestVerifiedCheckpointId}".`,
      "VERIFIED_CHECKPOINT_ROLLBACK",
    );
    this.checkpointId = checkpointId;
    this.latestVerifiedCheckpointId = latestVerifiedCheckpointId;
  }
}

export class UnsafeWorkspaceReleaseError extends FoundryError {
  constructor(missionId, detail) {
    super(
      `Workspace for mission "${missionId}" cannot be released: ${detail}.`,
      "UNSAFE_WORKSPACE_RELEASE",
    );
    this.missionId = missionId;
  }
}

export class StackManifestValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "STACK_MANIFEST_VALIDATION", options);
  }
}

export class RegistryCorruptionError extends FoundryError {
  constructor(detail, options) {
    super(
      `Toolchain & Stack Registry is invalid: ${detail}.`,
      "REGISTRY_CORRUPTION",
      options,
    );
  }
}

export class DuplicateRegistryEventError extends FoundryError {
  constructor(registryEventId) {
    super(
      `Registry event "${registryEventId}" already exists.`,
      "DUPLICATE_REGISTRY_EVENT",
    );
    this.registryEventId = registryEventId;
  }
}

export class DuplicateStackVersionError extends FoundryError {
  constructor(stackId, stackVersion) {
    super(
      `Stack "${stackId}" version "${stackVersion}" is already registered.`,
      "DUPLICATE_STACK_VERSION",
    );
    this.stackId = stackId;
    this.stackVersion = stackVersion;
  }
}

export class UnknownStackError extends FoundryError {
  constructor(stackId, stackVersion) {
    super(
      `Stack "${stackId}" version "${stackVersion}" is not registered.`,
      "UNKNOWN_STACK",
    );
    this.stackId = stackId;
    this.stackVersion = stackVersion;
  }
}

export class StackCertificationError extends FoundryError {
  constructor(message, options) {
    super(message, "STACK_CERTIFICATION", options);
  }
}

export class UncertifiedStackError extends FoundryError {
  constructor(stackId, stackVersion, status) {
    super(
      `Stack "${stackId}" version "${stackVersion}" is ${status}, not CERTIFIED.`,
      "UNCERTIFIED_STACK",
    );
    this.stackId = stackId;
    this.stackVersion = stackVersion;
    this.status = status;
  }
}

export class StaleCertificationError extends FoundryError {
  constructor(stackId, stackVersion, validUntil) {
    super(
      `Stack "${stackId}" version "${stackVersion}" certification expired at ${validUntil}.`,
      "STALE_CERTIFICATION",
    );
    this.stackId = stackId;
    this.stackVersion = stackVersion;
    this.validUntil = validUntil;
  }
}

export class EnvironmentCapabilityError extends FoundryError {
  constructor(message, options) {
    super(message, "ENVIRONMENT_CAPABILITY", options);
  }
}

export class MissingRequiredToolError extends EnvironmentCapabilityError {
  constructor(toolId, detail) {
    super(`Required tool "${toolId}" is unavailable: ${detail}.`);
    this.code = "MISSING_REQUIRED_TOOL";
    this.toolId = toolId;
  }
}

export class IncompatibleToolVersionError extends EnvironmentCapabilityError {
  constructor(toolId, version, versionRange) {
    super(
      `Tool "${toolId}" version "${version}" does not satisfy "${versionRange}".`,
    );
    this.code = "INCOMPATIBLE_TOOL_VERSION";
    this.toolId = toolId;
    this.version = version;
    this.versionRange = versionRange;
  }
}

export class IncompatiblePlatformError extends FoundryError {
  constructor(platform, supportedPlatforms) {
    super(
      `Platform "${platform}" is incompatible; supported platform: ${supportedPlatforms.join(", ")}.`,
      "INCOMPATIBLE_PLATFORM",
    );
    this.platform = platform;
    this.supportedPlatforms = supportedPlatforms;
  }
}

export class UnsupportedCapabilityError extends FoundryError {
  constructor(capabilities) {
    super(
      `Unsupported stack capabilities: ${capabilities.join(", ")}.`,
      "UNSUPPORTED_CAPABILITY",
    );
    this.capabilities = capabilities;
  }
}

export class EnvironmentCheckNotFoundError extends FoundryError {
  constructor(environmentCheckId) {
    super(
      `Environment check "${environmentCheckId}" does not exist.`,
      "ENVIRONMENT_CHECK_NOT_FOUND",
    );
    this.environmentCheckId = environmentCheckId;
  }
}

export class StackSelectionValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "STACK_SELECTION_VALIDATION", options);
  }
}

export class ExecutionValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "EXECUTION_VALIDATION", options);
  }
}

export class ExecutionStateError extends FoundryError {
  constructor(missionId, state) {
    super(
      `Mission "${missionId}" must be in EXECUTING, not ${state}, to run a work unit.`,
      "EXECUTION_STATE",
    );
    this.missionId = missionId;
    this.state = state;
  }
}

export class WorkUnitIdempotencyError extends FoundryError {
  constructor(idempotencyKey) {
    super(
      `Work-unit idempotency key "${idempotencyKey}" was reused with different inputs.`,
      "WORK_UNIT_IDEMPOTENCY",
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class WorkUnitEvidenceRequiredError extends ExecutionValidationError {
  constructor(workUnitId) {
    super(`Work unit "${workUnitId}" cannot complete without evidence.`);
    this.code = "WORK_UNIT_EVIDENCE_REQUIRED";
    this.workUnitId = workUnitId;
  }
}

export class CommandNotAllowedError extends ExecutionValidationError {
  constructor(procedureName) {
    super(
      `Toolchain procedure "${procedureName}" is not declared by the selected stack.`,
    );
    this.code = "COMMAND_NOT_ALLOWED";
    this.procedureName = procedureName;
  }
}

export class ExecutionInterruptionError extends FoundryError {
  constructor(stage) {
    super(
      `Execution was deliberately interrupted at "${stage}".`,
      "EXECUTION_INTERRUPTED",
    );
    this.stage = stage;
  }
}

export class ModelGatewayValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "MODEL_GATEWAY_VALIDATION", options);
  }
}

export class ModelOutputValidationError extends ModelGatewayValidationError {
  constructor(message, options) {
    super(message, options);
    this.code = "MODEL_OUTPUT_VALIDATION";
  }
}

export class ModelProviderError extends FoundryError {
  constructor(message, options) {
    super(message, "MODEL_PROVIDER_FAILURE", options);
  }
}

export class ModelCallIdempotencyError extends FoundryError {
  constructor(idempotencyKey) {
    super(
      `Model-call idempotency key "${idempotencyKey}" was reused with different inputs.`,
      "MODEL_CALL_IDEMPOTENCY",
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class ModelContextSecretError extends ModelGatewayValidationError {
  constructor() {
    super("Model context references must never contain secret values.");
    this.code = "MODEL_CONTEXT_SECRET";
  }
}

export class RuntimeValidationError extends FoundryError {
  constructor(message, options) {
    super(message, "RUNTIME_VALIDATION", options);
  }
}

export class RuntimeStateError extends FoundryError {
  constructor(message, options) {
    super(message, "RUNTIME_STATE", options);
  }
}

export class RuntimePortConflictError extends FoundryError {
  constructor(port, options) {
    super(
      `Runtime port ${port} is unavailable.`,
      "RUNTIME_PORT_CONFLICT",
      options,
    );
    this.port = port;
  }
}

export class RuntimeNotFoundError extends FoundryError {
  constructor(sessionId, options) {
    super(
      `Runtime session "${sessionId}" does not exist.`,
      "RUNTIME_NOT_FOUND",
      options,
    );
    this.sessionId = sessionId;
  }
}

export class RuntimeIdempotencyError extends FoundryError {
  constructor(idempotencyKey, options) {
    super(
      `Runtime idempotency key "${idempotencyKey}" was reused for different work.`,
      "RUNTIME_IDEMPOTENCY",
      options,
    );
    this.idempotencyKey = idempotencyKey;
  }
}

export class BrowserObservationError extends FoundryError {
  constructor(message, options) {
    super(message, "BROWSER_OBSERVATION", options);
  }
}

export class RepairValidationError extends FoundryError {
  constructor(message, options = {}) {
    super(message, "REPAIR_VALIDATION", options);
  }
}

export class RepairStateError extends FoundryError {
  constructor(missionId, state, action) {
    super(
      `Mission "${missionId}" cannot ${action} while in ${state}.`,
      "REPAIR_STATE",
    );
    this.missionId = missionId;
    this.state = state;
  }
}

export class RepairEvidenceRequiredError extends FoundryError {
  constructor() {
    super(
      "Diagnosis requires at least one valid stored failure evidence record.",
      "REPAIR_EVIDENCE_REQUIRED",
    );
  }
}

export class NonNovelRepairStrategyError extends FoundryError {
  constructor(strategyId) {
    super(
      `Repair strategy "${strategyId}" is materially equivalent to a prior attempt.`,
      "NON_NOVEL_REPAIR_STRATEGY",
    );
    this.strategyId = strategyId;
  }
}

export class RepairBudgetExceededError extends FoundryError {
  constructor(dimension) {
    super(
      `Repair budget is exhausted for ${dimension}.`,
      "REPAIR_BUDGET_EXCEEDED",
    );
    this.dimension = dimension;
  }
}

export class RepairRoutingError extends FoundryError {
  constructor(message) {
    super(message, "REPAIR_ROUTING");
  }
}

export class ExternalBlockerRejectedError extends FoundryError {
  constructor(message) {
    super(message, "EXTERNAL_BLOCKER_REJECTED");
  }
}

export class RepairExhaustionRejectedError extends FoundryError {
  constructor(message) {
    super(message, "REPAIR_EXHAUSTION_REJECTED");
  }
}

export class ProjectProfileValidationError extends FoundryError {
  constructor(message, options = {}) {
    super(message, "PROJECT_PROFILE_VALIDATION", options);
  }
}
