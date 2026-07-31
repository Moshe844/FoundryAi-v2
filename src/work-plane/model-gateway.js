import {
  ModelCallIdempotencyError,
  ModelContextSecretError,
  ModelGatewayValidationError,
  ModelOutputValidationError,
  ModelProviderError,
} from "../domain/errors.js";
import {
  MODEL_GATEWAY_SOURCE,
  ModelTaskClass,
  ModelTier,
  canonicalizeExecutionValue,
  freezeExecutionValue,
  normalizeModelCallRecord,
  projectExecutionHistory,
  assertExecutionIdentifier,
} from "../domain/execution.js";
import { MissionState } from "../domain/lifecycle.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import { LatencyProfile } from "../domain/ai-registry.js";
import { validateModelResponse } from "./model-response-validator.js";

const taskTier = Object.freeze({
  [ModelTaskClass.FILE_GENERATION]: ModelTier.STANDARD_ENGINEERING,
  [ModelTaskClass.STRUCTURED_TRANSFORMATION]: ModelTier.MECHANICAL,
  [ModelTaskClass.WORK_DECOMPOSITION]: ModelTier.DEEP_REASONING,
  [ModelTaskClass.REPAIR_DIAGNOSIS]: ModelTier.STANDARD_ENGINEERING,
  [ModelTaskClass.REPAIR_IMPLEMENTATION]: ModelTier.STANDARD_ENGINEERING,
});

const preferredLatencyByTier = Object.freeze({
  [ModelTier.MECHANICAL]: LatencyProfile.FAST,
  [ModelTier.STANDARD_ENGINEERING]: LatencyProfile.BALANCED,
  [ModelTier.DEEP_REASONING]: LatencyProfile.THOROUGH,
  [ModelTier.ARCHITECTURE]: LatencyProfile.THOROUGH,
  [ModelTier.EXCEPTIONAL_REASONING]: LatencyProfile.THOROUGH,
});

const repairTaskClasses = new Set([
  ModelTaskClass.REPAIR_DIAGNOSIS,
  ModelTaskClass.REPAIR_IMPLEMENTATION,
]);

function tierForDepth(depthLevel) {
  return {
    1: ModelTier.MECHANICAL,
    2: ModelTier.STANDARD_ENGINEERING,
    3: ModelTier.DEEP_REASONING,
    4: ModelTier.ARCHITECTURE,
    5: ModelTier.EXCEPTIONAL_REASONING,
  }[depthLevel];
}

function providerRepairMetadata(provider) {
  return {
    providerFamily: provider.providerFamily ?? "GPT",
    modelId: provider.modelId ?? provider.providerId,
    maxRepairDepth: provider.maxRepairDepth ?? 5,
    available: provider.available ?? true,
    inputCostPerMillionTokensUsd:
      provider.inputCostPerMillionTokensUsd ?? 0,
    outputCostPerMillionTokensUsd:
      provider.outputCostPerMillionTokensUsd ?? 0,
    observedPerformance: provider.observedPerformance ?? 0,
    latencyProfile:
      provider.latencyProfile ?? LatencyProfile.BALANCED,
  };
}

function routeTier(taskClass, depthLevel) {
  return depthLevel === null ? taskTier[taskClass] : tierForDepth(depthLevel);
}

function rankTaskRoutes(providers, modelTier) {
  const preferredLatency = preferredLatencyByTier[modelTier];
  const ranked = providers
    .filter((provider) => providerRepairMetadata(provider).available)
    .sort((left, right) => {
      const leftMetadata = providerRepairMetadata(left);
      const rightMetadata = providerRepairMetadata(right);
      return (
        Number(rightMetadata.latencyProfile === preferredLatency) -
          Number(leftMetadata.latencyProfile === preferredLatency) ||
        leftMetadata.inputCostPerMillionTokensUsd +
          leftMetadata.outputCostPerMillionTokensUsd -
          rightMetadata.inputCostPerMillionTokensUsd -
          rightMetadata.outputCostPerMillionTokensUsd ||
        rightMetadata.observedPerformance -
          leftMetadata.observedPerformance ||
        left.providerId.localeCompare(right.providerId) ||
        leftMetadata.modelId.localeCompare(rightMetadata.modelId)
      );
    });
  const providerDiverse = [];
  const remaining = [...ranked];
  const usedProviders = new Set();
  while (remaining.length > 0) {
    const differentProvider = remaining.findIndex(
      (candidate) => !usedProviders.has(candidate.providerId),
    );
    const index = differentProvider === -1 ? 0 : differentProvider;
    const [candidate] = remaining.splice(index, 1);
    providerDiverse.push(candidate);
    usedProviders.add(candidate.providerId);
  }
  return providerDiverse;
}

export function rankRoutesByPersistedTaskHistory(
  routes,
  history,
  taskClass,
) {
  if (!Array.isArray(routes) || !Array.isArray(history)) return routes;
  const results = new Map();
  const attemptsByRequest = new Map();
  const failures = [];
  for (const entry of history) {
    if (entry?.taskClass !== taskClass) continue;
    if (entry.kind === "result" && typeof entry.requestId === "string") {
      results.set(entry.requestId, entry);
      continue;
    }
    if (entry.kind === "route" && typeof entry.requestId === "string") {
      const attempts = attemptsByRequest.get(entry.requestId) ?? [];
      attempts.push(entry);
      attemptsByRequest.set(entry.requestId, attempts);
      continue;
    }
    if (entry.kind === "failure" && typeof entry.providerId === "string") {
      failures.push(entry);
    }
  }
  const providerStatistics = new Map();
  const modelStatistics = new Map();
  function observe(providerId, modelId, succeeded) {
    if (typeof providerId !== "string") return;
    const statistics =
      typeof modelId === "string" ? modelStatistics : providerStatistics;
    const key =
      typeof modelId === "string"
        ? `${providerId}\u0000${modelId}`
        : providerId;
    const record = statistics.get(key) ?? {
      succeeded: 0,
      failed: 0,
    };
    record[succeeded ? "succeeded" : "failed"] += 1;
    statistics.set(key, record);
  }
  for (const result of results.values()) {
    const attempts = [...(attemptsByRequest.get(result.requestId) ?? [])]
      .sort((left, right) => left.routeAttempt - right.routeAttempt);
    attempts.forEach((attempt, index) => {
      const isFinal = index === attempts.length - 1;
      observe(
        attempt.providerId,
        attempt.modelId,
        isFinal &&
          result.status === "SUCCEEDED" &&
          attempt.providerId === result.providerId &&
          (typeof result.modelId !== "string" ||
            typeof attempt.modelId !== "string" ||
            attempt.modelId === result.modelId),
      );
    });
  }
  for (const failure of failures.filter(
    (entry) => !results.has(entry.requestId),
  )) {
    observe(failure.providerId, failure.modelId, false);
  }
  function observedFailureRate(statistics, key) {
    const record = statistics.get(key) ?? {
      succeeded: 0,
      failed: 0,
    };
    return (
      (record.failed * 2 + 1) /
      (record.succeeded + record.failed * 2 + 2)
    );
  }
  return routes
    .map((route, baseIndex) => ({ route, baseIndex }))
    .sort((left, right) => {
      const leftModelKey = `${left.route.providerId}\u0000${left.route.modelId}`;
      const rightModelKey = `${right.route.providerId}\u0000${right.route.modelId}`;
      const leftStatistics = modelStatistics.has(leftModelKey)
        ? [modelStatistics, leftModelKey]
        : [providerStatistics, left.route.providerId];
      const rightStatistics = modelStatistics.has(rightModelKey)
        ? [modelStatistics, rightModelKey]
        : [providerStatistics, right.route.providerId];
      return (
        observedFailureRate(...leftStatistics) -
          observedFailureRate(...rightStatistics) ||
        left.baseIndex - right.baseIndex
      );
    })
    .map(({ route }) => route);
}

export function classifyModelRouteFailure(errorOrMessage) {
  const message = String(
    errorOrMessage?.message ?? errorOrMessage ?? "",
  ).toLowerCase();
  const status = Number.isSafeInteger(errorOrMessage?.status)
    ? errorOrMessage.status
    : null;
  const permanentlyUnavailable =
    /(?:no longer available|model (?:is )?(?:unavailable|deprecated|retired)|unknown (?:model|agent)|model(?: .*?)? not found|unsupported model|does not exist|background=true is required for agent interactions|requires the use of .{0,80} tool)/u.test(
      message,
    ) &&
    (status === null || [400, 404, 410, 422].includes(status));
  if (permanentlyUnavailable) {
    return Object.freeze({
      category: "MODEL_UNAVAILABLE",
      retryable: false,
    });
  }
  if (
    [401, 403].includes(status) ||
    /(?:invalid api key|authentication|permission denied)/u.test(message)
  ) {
    return Object.freeze({
      category: "PROVIDER_AUTHORIZATION",
      retryable: false,
    });
  }
  return Object.freeze({
    category: "TRANSIENT_PROVIDER_FAILURE",
    retryable: true,
  });
}

export function excludePermanentlyRejectedRoutes(routes, history) {
  if (!Array.isArray(routes) || !Array.isArray(history)) return routes;
  const rejectedModelIds = new Set(
    history
      .filter(
        (entry) =>
          entry?.kind === "failure" &&
          entry.failureCategory === "MODEL_UNAVAILABLE" &&
          entry.retryable === false &&
          typeof entry.modelId === "string",
      )
      .map((entry) => entry.modelId),
  );
  return routes.filter((route) => !rejectedModelIds.has(route.modelId));
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function validateSchema(schema, label = "expectedStructuredOutputSchema") {
  if (!isPlainObject(schema)) {
    throw new ModelGatewayValidationError(`${label} must be an object.`);
  }
  if (
    schema.type !== "object" ||
    !isPlainObject(schema.properties) ||
    !Array.isArray(schema.required) ||
    typeof schema.additionalProperties !== "boolean"
  ) {
    throw new ModelGatewayValidationError(
      `${label} must declare object properties, required fields, and additionalProperties.`,
    );
  }
  for (const [name, property] of Object.entries(schema.properties)) {
    if (
      !isPlainObject(property) ||
      !["string", "number", "integer", "boolean", "array", "object"].includes(
        property.type,
      )
    ) {
      throw new ModelGatewayValidationError(
        `${label}.properties.${name} has an unsupported type.`,
      );
    }
  }
  for (const name of schema.required) {
    if (typeof name !== "string" || !(name in schema.properties)) {
      throw new ModelGatewayValidationError(
        `${label}.required contains an unknown property.`,
      );
    }
  }
  return freezeExecutionValue(schema);
}

export function validateStructuredModelOutput(output, schema) {
  return freezeExecutionValue(validateModelResponse(output, schema));
}

function validateUsage(usage) {
  if (
    !isPlainObject(usage) ||
    !Number.isSafeInteger(usage.inputTokens) ||
    usage.inputTokens < 0 ||
    !Number.isSafeInteger(usage.outputTokens) ||
    usage.outputTokens < 0 ||
    typeof usage.costUsd !== "number" ||
    !Number.isFinite(usage.costUsd) ||
    usage.costUsd < 0
  ) {
    throw new ModelProviderError(
      "Model provider returned invalid token or cost metadata.",
    );
  }
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costUsd: usage.costUsd,
  };
}

export function createDeterministicLocalModelProvider({
  handler,
  providerId = "deterministic-local",
  providerFamily = "GPT",
  modelId = providerId,
  maxRepairDepth = 5,
  available = true,
  inputCostPerMillionTokensUsd = 0,
  outputCostPerMillionTokensUsd = 0,
  observedPerformance = 1,
  latencyProfile = LatencyProfile.BALANCED,
}) {
  assertExecutionIdentifier(
    providerId,
    "providerId",
    ModelGatewayValidationError,
  );
  if (typeof handler !== "function") {
    throw new ModelGatewayValidationError(
      "Deterministic provider handler must be a function.",
    );
  }
  return Object.freeze({
    fixtureOnly: true,
    providerId,
    providerFamily,
    modelId,
    maxRepairDepth,
    available,
    inputCostPerMillionTokensUsd,
    outputCostPerMillionTokensUsd,
    observedPerformance,
    latencyProfile,
    async generate(request) {
      return handler(freezeExecutionValue(request));
    },
  });
}

function normalizeContextReferences(value) {
  if (!Array.isArray(value)) {
    throw new ModelGatewayValidationError(
      "contextReferences must be an array.",
    );
  }
  return value.map((reference) => {
    if (
      !isPlainObject(reference) ||
      Object.keys(reference).sort().join(",") !== "id,kind"
    ) {
      throw new ModelGatewayValidationError(
        "Every context reference must contain exactly kind and id.",
      );
    }
    assertExecutionIdentifier(
      reference.kind,
      "context reference kind",
      ModelGatewayValidationError,
    );
    assertExecutionIdentifier(
      reference.id,
      "context reference id",
      ModelGatewayValidationError,
    );
    return { kind: reference.kind, id: reference.id };
  });
}

function assertNoSecrets(value, sensitiveValues) {
  const serialized = canonicalizeExecutionValue(value);
  if (
    sensitiveValues.some(
      (secret) =>
        typeof secret === "string" &&
        secret.length > 0 &&
        serialized.includes(secret),
    )
  ) {
    throw new ModelContextSecretError();
  }
}

export function createModelGateway({
  ledger,
  evidence,
  facts,
  workspaces,
  providerRegistry,
  routeHistory = () => [],
  maxProviderAttempts = 2,
  clock,
}) {
  if (
    providerRegistry === null ||
    typeof providerRegistry !== "object" ||
    typeof providerRegistry.list !== "function" ||
    typeof providerRegistry.generate !== "function"
  ) {
    throw new ModelGatewayValidationError(
      "Model Gateway requires the Provider Registry execution boundary.",
    );
  }
  if (typeof routeHistory !== "function") {
    throw new ModelGatewayValidationError("routeHistory must be a function.");
  }
  const configuredProviders = providerRegistry.list();
  if (
    !Array.isArray(configuredProviders) ||
    configuredProviders.some(
      (provider) =>
        !isPlainObject(provider) &&
        (typeof provider !== "object" || provider === null),
    )
  ) {
    throw new ModelGatewayValidationError("providers must be an array.");
  }
  for (const provider of configuredProviders) {
    assertExecutionIdentifier(
      provider.providerId,
      "provider.providerId",
      ModelGatewayValidationError,
    );
    const metadata = providerRepairMetadata(provider);
    if (
      !["GPT", "Claude", "Gemini"].includes(metadata.providerFamily) ||
      !Number.isSafeInteger(metadata.maxRepairDepth) ||
      metadata.maxRepairDepth < 1 ||
      metadata.maxRepairDepth > 5 ||
      !Object.values(LatencyProfile).includes(metadata.latencyProfile) ||
      typeof metadata.available !== "boolean" ||
      [
        metadata.inputCostPerMillionTokensUsd,
        metadata.outputCostPerMillionTokensUsd,
        metadata.observedPerformance,
      ].some(
        (value) =>
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          value < 0,
      )
    ) {
      throw new ModelGatewayValidationError(
        "Model provider repair capabilities are invalid.",
      );
    }
  }
  if (
    !Number.isSafeInteger(maxProviderAttempts) ||
    maxProviderAttempts < 1 ||
    maxProviderAttempts > 3
  ) {
    throw new ModelGatewayValidationError(
      "maxProviderAttempts must be from 1 through 3.",
    );
  }

  function callHistory(missionId) {
    return projectExecutionHistory(
      ledger.listEvents(missionId),
      missionId,
    ).modelCalls;
  }

  return Object.freeze({
    async request(input) {
      if (!isPlainObject(input)) {
        throw new ModelGatewayValidationError(
          "Model request must be a plain object.",
        );
      }
      const allowed = [
        "contextReferences",
        "expectedStructuredOutputSchema",
        "idempotencyKey",
        "missionId",
        "purpose",
        "requestId",
        "sensitiveValues",
        "taskClass",
        "workUnitId",
      ];
      const optional = [
        "structuredOutputValidator",
        "depthLevel",
        "routingReason",
      ];
      const repairRequest = repairTaskClasses.has(input.taskClass);
      const requiredKeys = repairRequest
        ? [...allowed, "depthLevel", "routingReason"]
        : allowed;
      const actual = Object.keys(input).sort();
      if (
        requiredKeys.some((key) => !actual.includes(key)) ||
        actual.some(
          (key) => !requiredKeys.includes(key) && !optional.includes(key),
        )
      ) {
        throw new ModelGatewayValidationError(
          `Model request must contain required keys ${requiredKeys.join(", ")} and only supported optional keys.`,
        );
      }
      if (
        input.structuredOutputValidator !== undefined &&
        typeof input.structuredOutputValidator !== "function"
      ) {
        throw new ModelGatewayValidationError(
          "structuredOutputValidator must be a function when supplied.",
        );
      }
      for (const [label, value] of [
        ["requestId", input.requestId],
        ["missionId", input.missionId],
        ["workUnitId", input.workUnitId],
        ["idempotencyKey", input.idempotencyKey],
      ]) {
        assertExecutionIdentifier(
          value,
          label,
          ModelGatewayValidationError,
        );
      }
      if (
        typeof input.purpose !== "string" ||
        input.purpose.trim().length === 0 ||
        !(input.taskClass in taskTier)
      ) {
        throw new ModelGatewayValidationError(
          "Model purpose or taskClass is invalid.",
        );
      }
      const explicitRouting =
        input.depthLevel !== undefined || input.routingReason !== undefined;
      const depthLevel = explicitRouting ? input.depthLevel : null;
      const routingReason = explicitRouting ? input.routingReason : null;
      if (
        (repairRequest || explicitRouting) &&
        (!Number.isSafeInteger(depthLevel) ||
          depthLevel < 1 ||
          depthLevel > 5 ||
          typeof routingReason !== "string" ||
          routingReason.trim() === "")
      ) {
        throw new ModelGatewayValidationError(
          "Explicit model routing requires depth 1-5 and a technical routing reason.",
        );
      }
      if (
        !Array.isArray(input.sensitiveValues) ||
        input.sensitiveValues.some(
          (value) => typeof value !== "string" || value.length === 0,
        )
      ) {
        throw new ModelGatewayValidationError(
          "sensitiveValues must be an array of non-empty strings.",
        );
      }
      const contextReferences = normalizeContextReferences(
        input.contextReferences,
      );
      const schema = validateSchema(input.expectedStructuredOutputSchema);
      const fingerprint = {
        requestId: input.requestId,
        missionId: input.missionId,
        workUnitId: input.workUnitId,
        purpose: input.purpose.trim(),
        taskClass: input.taskClass,
        contextReferences,
        expectedStructuredOutputSchema: schema,
        depthLevel,
        routingReason:
          routingReason === null ? null : routingReason.trim(),
      };
      assertNoSecrets(fingerprint, input.sensitiveValues);
      if (
        ledger.projectState(input.missionId).state !== MissionState.EXECUTING
      ) {
        throw new ModelGatewayValidationError(
          "Model calls are permitted only during EXECUTING.",
        );
      }
      const calls = callHistory(input.missionId);
      const existing = calls.find(
        (call) => call.idempotencyKey === input.idempotencyKey,
      );
      if (existing !== undefined) {
        const existingFingerprint = {
          requestId: existing.requestId,
          missionId: existing.missionId,
          workUnitId: existing.workUnitId,
          purpose: existing.purpose,
          taskClass: existing.taskClass,
          contextReferences: existing.contextReferences,
          expectedStructuredOutputSchema:
            existing.expectedStructuredOutputSchema,
          depthLevel: existing.depthLevel,
          routingReason: existing.routingReason,
        };
        if (
          canonicalizeExecutionValue(fingerprint) !==
          canonicalizeExecutionValue(existingFingerprint)
        ) {
          throw new ModelCallIdempotencyError(input.idempotencyKey);
        }
        if (existing.status === "FAILED") {
          throw new ModelProviderError(
            `Model request "${existing.requestId}" previously failed.`,
          );
        }
        if (input.structuredOutputValidator !== undefined) {
          try {
            input.structuredOutputValidator(existing.structuredOutput);
          } catch (error) {
            throw new ModelOutputValidationError(
              `Persisted structured output failed the caller's semantic validator: ${String(error?.message ?? error)}`,
            );
          }
        }
        return freezeExecutionValue({
          requestId: existing.requestId,
          structuredOutput: existing.structuredOutput,
          tokenMetadata: existing.tokenMetadata,
          costMetadata: existing.costMetadata,
        });
      }
      if (calls.some((call) => call.requestId === input.requestId)) {
        throw new ModelCallIdempotencyError(input.idempotencyKey);
      }

      const startTimestamp = clock();
      const workspace = workspaces.getWorkspace(input.missionId);
      const priorRouteAttemptCount = evidence
        .findByMission(input.missionId)
        .filter(
          (record) =>
            record.kind === ObservationKind.MODEL_CALL_RESULT &&
            record.payload?.requestId === input.requestId &&
            record.payload?.status === "STARTED",
        ).length;
      const providers = providerRegistry.list();
      const selectedTier = routeTier(input.taskClass, depthLevel);
      let output = null;
      let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
      let selectedProvider = providers[0]?.providerId ?? "unavailable";
      let selectedModelId =
        providers[0] === undefined
          ? "unavailable"
          : providerRepairMetadata(providers[0]).modelId;
      let selectedProviderFamily =
        providers[0] === undefined
          ? null
          : providerRepairMetadata(providers[0]).providerFamily;
      let failure = null;
      let attemptCount = 0;
      const baseRoutedProviders = rankTaskRoutes(
        repairRequest
          ? providers.filter((provider) => {
              const metadata = providerRepairMetadata(provider);
              return metadata.maxRepairDepth >= depthLevel;
            })
          : providers,
        selectedTier,
      );
      const routedProviders = rankRoutesByPersistedTaskHistory(
        baseRoutedProviders,
        routeHistory(),
        input.taskClass,
      );
      const historyAdjusted =
        routedProviders[0]?.providerId !==
        baseRoutedProviders[0]?.providerId;
      for (let attempt = 0; attempt < maxProviderAttempts; attempt += 1) {
        attemptCount += 1;
        const provider =
          routedProviders[attempt % Math.max(routedProviders.length, 1)];
        if (provider === undefined) {
          failure = new ModelProviderError(
            "No production model provider is configured.",
          );
          break;
        }
        selectedProvider = provider.providerId;
        const selectedMetadata = providerRepairMetadata(provider);
        selectedModelId = selectedMetadata.modelId;
        selectedProviderFamily = selectedMetadata.providerFamily;
        const routeAttempt = priorRouteAttemptCount + attemptCount;
        const routeTimestamp = clock();
        const effectiveRoutingReason =
          routingReason ??
          `${selectedTier} task prefers ${preferredLatencyByTier[selectedTier]} models; provider health and capability ranking selected this route.${historyAdjusted ? " Persisted outcomes for this task class moved a repeatedly successful live provider ahead of routes with recent failures." : ""}`;
        const routeEvidence = evidence.capture({
          evidenceId: `${input.requestId}.route-${routeAttempt}`,
          missionId: input.missionId,
          kind: ObservationKind.MODEL_CALL_RESULT,
          captureMethod: "model-gateway-route-dispatch",
          producingSubsystem: MODEL_GATEWAY_SOURCE,
          timestamp: routeTimestamp,
          payload: {
            requestId: input.requestId,
            status: "STARTED",
            structuredOutput: null,
            detail: "A live provider request was dispatched.",
          },
          sensitiveValues: input.sensitiveValues,
          workspaceCheckpointReference: workspace.currentCheckpointId,
          obligationReference: null,
          verificationRequestReference: null,
          commandReference: input.requestId,
          workUnitReference: input.workUnitId,
          metadata: {
            provider: selectedProvider,
            modelId: selectedModelId,
            providerFamily: selectedProviderFamily,
            taskClass: input.taskClass,
            depthLevel,
            routingReason: effectiveRoutingReason,
            routeAttempt,
          },
        });
        facts.recordResultFact({
          missionId: input.missionId,
          eventId: `${input.requestId}.route-${routeAttempt}.fact`,
          causationId: input.idempotencyKey,
          occurredAt: routeTimestamp,
          producingSubsystem: MODEL_GATEWAY_SOURCE,
          statement: `Dispatched model request "${input.requestId}" to an eligible live route.`,
          evidenceReferences: [
            {
              evidenceId: routeEvidence.evidenceId,
              workspaceCheckpointReference: workspace.currentCheckpointId,
            },
          ],
          workspaceCheckpointReference: workspace.currentCheckpointId,
          workUnitReference: input.workUnitId,
          metadata: {
            modelRouteStart: routeEvidence.metadata,
          },
        });
        try {
          const response = await providerRegistry.generate(
            provider.providerId,
            {
              requestId: input.requestId,
              missionId: input.missionId,
              workUnitId: input.workUnitId,
              purpose: input.purpose.trim(),
              taskClass: input.taskClass,
              modelTier: selectedTier,
              depthLevel,
              routingReason: effectiveRoutingReason,
              contextReferences,
              expectedStructuredOutputSchema: schema,
            },
            { modelId: selectedModelId },
          );
          if (!isPlainObject(response)) {
            throw new ModelProviderError(
              "Model provider response must be an object.",
            );
          }
          output = validateStructuredModelOutput(response.output, schema);
          if (input.structuredOutputValidator !== undefined) {
            try {
              input.structuredOutputValidator(output);
            } catch (error) {
              throw new ModelOutputValidationError(
                `Structured output failed semantic validation: ${String(error?.message ?? error)}`,
              );
            }
          }
          assertNoSecrets(output, input.sensitiveValues);
          usage = validateUsage(response.usage);
          failure = null;
          break;
        } catch (error) {
          output = null;
          usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
          failure =
            error instanceof ModelOutputValidationError ||
            error instanceof ModelProviderError ||
            error instanceof ModelContextSecretError
              ? error
              : new ModelProviderError("Model provider call failed.", {
                  cause: error,
                });
          if (
            input.sensitiveValues.some((secret) =>
              failure.message.includes(secret),
            )
          ) {
            failure = new ModelProviderError(
              "Model provider call failed without a persistable detail.",
            );
          }
        }
      }
      const endTimestamp = clock();
      const status = failure === null ? "SUCCEEDED" : "FAILED";
      const record = normalizeModelCallRecord({
        requestId: input.requestId,
        missionId: input.missionId,
        workUnitId: input.workUnitId,
        purpose: input.purpose,
        taskClass: input.taskClass,
        modelId: selectedModelId,
        modelTier: selectedTier,
        provider: selectedProvider,
        providerFamily: selectedProviderFamily,
        depthLevel,
        routingReason,
        idempotencyKey: input.idempotencyKey,
        contextReferences,
        expectedStructuredOutputSchema: schema,
        structuredOutput: output,
        tokenMetadata: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        costMetadata: {
          attemptCount,
          costUsd: usage.costUsd,
        },
        startTimestamp,
        endTimestamp,
        status,
      });
      const evidenceRecord = evidence.capture({
        evidenceId: `${input.requestId}.model`,
        missionId: input.missionId,
        kind: ObservationKind.MODEL_CALL_RESULT,
        captureMethod: "model-gateway-structured-response-validation",
        producingSubsystem: MODEL_GATEWAY_SOURCE,
        timestamp: endTimestamp,
        payload: {
          requestId: input.requestId,
          status,
          structuredOutput: output,
          detail:
            failure === null
              ? "Structured model output validated."
              : failure.message,
        },
        sensitiveValues: input.sensitiveValues,
        workspaceCheckpointReference: workspace.currentCheckpointId,
        obligationReference: null,
        verificationRequestReference: null,
        commandReference: input.requestId,
        workUnitReference: input.workUnitId,
        metadata: {
          provider: selectedProvider,
          modelId: record.modelId,
          modelTier: record.modelTier,
          providerFamily: record.providerFamily,
          depthLevel: record.depthLevel,
          routingReason: record.routingReason,
          taskClass: record.taskClass,
          tokenMetadata: record.tokenMetadata,
          costMetadata: record.costMetadata,
        },
      });
      facts.recordResultFact({
        missionId: input.missionId,
        eventId: `${input.requestId}.model.fact`,
        causationId: input.idempotencyKey,
        occurredAt: endTimestamp,
        producingSubsystem: MODEL_GATEWAY_SOURCE,
        statement: `Model request "${input.requestId}" completed with operational status ${status}.`,
        evidenceReferences: [
          {
            evidenceId: evidenceRecord.evidenceId,
            workspaceCheckpointReference:
              workspace.currentCheckpointId,
          },
        ],
        workspaceCheckpointReference: workspace.currentCheckpointId,
        workUnitReference: input.workUnitId,
        metadata: { modelCallRecord: record },
      });
      if (failure !== null) {
        throw failure;
      }
      return freezeExecutionValue({
        requestId: record.requestId,
        structuredOutput: record.structuredOutput,
        tokenMetadata: record.tokenMetadata,
        costMetadata: record.costMetadata,
      });
    },

    listCalls(missionId) {
      return projectExecutionHistory(
        ledger.listEvents(missionId),
        missionId,
      ).modelCalls;
    },
  });
}
