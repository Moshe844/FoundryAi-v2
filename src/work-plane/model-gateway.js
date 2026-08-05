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
import { rankRoutesByPersistedTaskHistory } from "./model-route-reliability.js";
import { modelTaskCapabilityContract } from "../config/model-task-capability-policy.js";
import { RoutingPriority } from "./model-routing-foundation.js";

export { rankRoutesByPersistedTaskHistory } from "./model-route-reliability.js";

export const ModelExecutionStage = Object.freeze({
  DESIGN_PROTOTYPE: "DESIGN_PROTOTYPE",
});

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

export function diversifyProviderRoutes(routes) {
  const remaining = [...routes];
  const diversified = [];
  const usedProviders = new Set();
  while (remaining.length > 0) {
    const unseenProviderIndex = remaining.findIndex(
      (route) => !usedProviders.has(route.providerId),
    );
    const index = unseenProviderIndex === -1 ? 0 : unseenProviderIndex;
    const [route] = remaining.splice(index, 1);
    diversified.push(route);
    usedProviders.add(route.providerId);
  }
  return diversified;
}

export function classifyModelRouteFailure(errorOrMessage) {
  const message = String(
    errorOrMessage?.message ?? errorOrMessage ?? "",
  ).toLowerCase();
  const status = Number.isSafeInteger(errorOrMessage?.status)
    ? errorOrMessage.status
    : null;
  if (message.startsWith("structured output failed semantic validation:")) {
    return Object.freeze({
      category: "SEMANTIC_ADMISSION_FAILURE",
      retryable: false,
    });
  }
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
  modelRouter = null,
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
  if (modelRouter !== null && typeof modelRouter.select !== "function") {
    throw new ModelGatewayValidationError(
      "modelRouter must expose select() when supplied.",
    );
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
    maxProviderAttempts > 4
  ) {
    throw new ModelGatewayValidationError(
      "maxProviderAttempts must be from 1 through 4.",
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
        "executionStage",
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
      const designPrototypeRequest =
        input.executionStage === ModelExecutionStage.DESIGN_PROTOTYPE;
      if (
        input.executionStage !== undefined &&
        !designPrototypeRequest
      ) {
        throw new ModelGatewayValidationError(
          "Model executionStage is invalid.",
        );
      }
      if (
        designPrototypeRequest &&
        (input.taskClass !== ModelTaskClass.FILE_GENERATION ||
          !contextReferences.some(
            (reference) => reference.kind === "concept-prototype-contract",
          ))
      ) {
        throw new ModelGatewayValidationError(
          "DESIGN_PROTOTYPE is restricted to contract-bound FILE_GENERATION.",
        );
      }
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
      const missionState = ledger.projectState(input.missionId).state;
      if (
        (!designPrototypeRequest && missionState !== MissionState.EXECUTING) ||
        (designPrototypeRequest && missionState !== MissionState.INTAKE)
      ) {
        throw new ModelGatewayValidationError(
          designPrototypeRequest
            ? "Design prototype model calls are permitted only during INTAKE, before production execution."
            : "Model calls are permitted only during EXECUTING.",
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
        let structuredOutput = existing.structuredOutput;
        if (input.structuredOutputValidator !== undefined) {
          try {
            const semanticOutput = input.structuredOutputValidator(
              structuredOutput,
            );
            if (semanticOutput !== undefined) {
              structuredOutput = validateStructuredModelOutput(
                semanticOutput,
                schema,
              );
            }
          } catch (error) {
            throw new ModelOutputValidationError(
              `Persisted structured output failed the caller's semantic validator: ${String(error?.message ?? error)}`,
            );
          }
        }
        return freezeExecutionValue({
          requestId: existing.requestId,
          structuredOutput,
          tokenMetadata: existing.tokenMetadata,
          costMetadata: existing.costMetadata,
        });
      }
      if (calls.some((call) => call.requestId === input.requestId)) {
        throw new ModelCallIdempotencyError(input.idempotencyKey);
      }

      const startTimestamp = clock();
      // A concept is generated before a production workspace exists. Its
      // isolated workspace is controlled by PrototypeWorkspaceService, while
      // all normal production calls remain checkpoint-bound here.
      const workspace = designPrototypeRequest
        ? Object.freeze({ currentCheckpointId: null })
        : workspaces.getWorkspace(input.missionId);
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
      const taskCapabilityContract = modelTaskCapabilityContract(input.taskClass);
      const effectiveTaskDepth =
        depthLevel ?? taskCapabilityContract?.defaultDepth ?? 1;
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
      let priorSafeOutputFailure = null;
      let attemptCount = 0;
      const fixtureOnly = providers.every(
        (provider) => provider.fixtureOnly === true,
      );
      let capabilitySelection = null;
      let baseRoutedProviders;
      let routedProviders;
      if (!fixtureOnly) {
        if (modelRouter === null) {
          throw new ModelGatewayValidationError(
            "Live model execution requires the capability-driven Model Router.",
          );
        }
        capabilitySelection = modelRouter.select({
          taskClass: input.taskClass,
          taskDepth: effectiveTaskDepth,
          requiredCapabilities: [],
          costConstraints: {
            maximumTotalPerMillionTokensUsd: null,
          },
          userPreferences: {
            priority: RoutingPriority.LOW_COST,
            preferredLatencyProfile: preferredLatencyByTier[selectedTier],
          },
        });
        const providersByRoute = new Map(
          providers.map((provider) => [
            `${provider.providerId}\u0000${providerRepairMetadata(provider).modelId}`,
            provider,
          ]),
        );
        baseRoutedProviders = diversifyProviderRoutes(capabilitySelection.candidateModels
          .map((candidate) =>
            providersByRoute.get(
              `${candidate.providerId}\u0000${candidate.modelId}`,
            ),
          )
          .filter(Boolean)
          .filter((provider) =>
            !repairRequest ||
            providerRepairMetadata(provider).maxRepairDepth >= effectiveTaskDepth,
          ));
        routedProviders = baseRoutedProviders;
      } else {
        baseRoutedProviders = rankTaskRoutes(
          repairRequest
            ? providers.filter((provider) => {
                const metadata = providerRepairMetadata(provider);
                return metadata.maxRepairDepth >= depthLevel;
              })
            : providers,
          selectedTier,
        );
        routedProviders = rankRoutesByPersistedTaskHistory(
          baseRoutedProviders,
          routeHistory(),
          input.taskClass,
        );
      }
      // Providers keep advertising retired models in their list APIs, so a
      // route can be "available" by discovery and fail every real call. Drop
      // routes whose model is already recorded as permanently unavailable in
      // the persisted route history; if that empties the list, keep the
      // originals so the terminal error names the provider's real message.
      const persistedRejectedModelIds = new Set(
        (routeHistory() ?? [])
          .filter(
            (entry) =>
              entry?.kind === "failure" &&
              entry.failureCategory === "MODEL_UNAVAILABLE" &&
              entry.retryable === false &&
              typeof entry.modelId === "string",
          )
          .map((entry) => entry.modelId),
      );
      if (persistedRejectedModelIds.size > 0) {
        const survivingRoutes = routedProviders.filter(
          (provider) =>
            !persistedRejectedModelIds.has(
              providerRepairMetadata(provider).modelId,
            ),
        );
        if (survivingRoutes.length > 0) routedProviders = survivingRoutes;
      }
      const historyAdjusted =
        routedProviders[0]?.providerId !==
        baseRoutedProviders[0]?.providerId;
      const eligibleProviderCount = new Set(
        routedProviders.map((provider) => provider.providerId),
      ).size;
      const attemptedProviderIds = new Set();
      // Models that fail non-retryably during THIS request (retired, unknown,
      // unauthorized) are excluded from the remaining attempts so a bounded
      // retry budget is never spent re-calling a route that cannot succeed.
      const inFlightRejectedModelIds = new Set();
      let lastAttemptedProvider = null;
      for (let attempt = 0; attempt < maxProviderAttempts; attempt += 1) {
        attemptCount += 1;
        const repeatFinalValidationRoute =
          priorSafeOutputFailure !== null &&
          lastAttemptedProvider !== null &&
          attemptedProviderIds.size >= eligibleProviderCount;
        let provider;
        if (repeatFinalValidationRoute) {
          provider = lastAttemptedProvider;
        } else {
          const viableRoutes = routedProviders.filter(
            (candidate) =>
              !inFlightRejectedModelIds.has(
                providerRepairMetadata(candidate).modelId,
              ),
          );
          if (viableRoutes.length === 0) break;
          provider =
            viableRoutes.find(
              (candidate) => !attemptedProviderIds.has(candidate.providerId),
            ) ?? viableRoutes[attempt % viableRoutes.length];
        }
        if (provider === undefined) {
          failure = new ModelProviderError(
            "No production model provider is configured.",
          );
          break;
        }
        selectedProvider = provider.providerId;
        attemptedProviderIds.add(provider.providerId);
        lastAttemptedProvider = provider;
        const selectedMetadata = providerRepairMetadata(provider);
        selectedModelId = selectedMetadata.modelId;
        selectedProviderFamily = selectedMetadata.providerFamily;
        const routeAttempt = priorRouteAttemptCount + attemptCount;
        const routeTimestamp = clock();
        const effectiveRoutingReason =
          routingReason ??
          capabilitySelection?.rationale.join(" ") ??
          `${selectedTier} fixture task prefers ${preferredLatencyByTier[selectedTier]} models.${historyAdjusted ? " Persisted outcomes for this task class moved a repeatedly successful fixture provider ahead of routes with recent failures." : ""}`;
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
            executionStage: input.executionStage ?? "PRODUCTION_EXECUTION",
            depthLevel,
            routingReason: effectiveRoutingReason,
            routeAttempt,
            requiredCapabilities:
              capabilitySelection?.requiredCapabilities ??
              taskCapabilityContract?.requiredCapabilities ?? [],
            candidateModels: capabilitySelection?.candidateModels ?? [],
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
              purpose:
                priorSafeOutputFailure === null
                  ? input.purpose.trim()
                  : `${input.purpose.trim()}\n\nA prior eligible route returned output that failed deterministic admission: ${priorSafeOutputFailure} Return a fresh complete object that corrects this defect without omitting or weakening any requirement.`,
              taskClass: input.taskClass,
              modelTier: selectedTier,
              depthLevel,
              routingReason: effectiveRoutingReason,
              requiredCapabilities:
                capabilitySelection?.requiredCapabilities ??
                taskCapabilityContract?.requiredCapabilities ?? [],
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
              const semanticOutput = input.structuredOutputValidator(output);
              if (semanticOutput !== undefined) {
                output = validateStructuredModelOutput(
                  semanticOutput,
                  schema,
                );
              }
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
            failure instanceof ModelOutputValidationError ||
            /returned (?:malformed structured output|no output text)/iu.test(
              failure.message,
            )
          ) {
            priorSafeOutputFailure = failure.message.slice(0, 500);
          } else {
            priorSafeOutputFailure = null;
          }
          const failureDisposition = classifyModelRouteFailure(failure);
          if (
            !failureDisposition.retryable &&
            typeof selectedModelId === "string"
          ) {
            inFlightRejectedModelIds.add(selectedModelId);
          }
          // Persist every attempt's failure, not only the last one. Without
          // this, a three-provider request that dies records a single detail
          // and the first two causes are undiagnosable. The recorded
          // modelRouteFailure also feeds the persisted route history, so a
          // permanently unavailable model is excluded from future requests.
          try {
            const failureTimestamp = clock();
            const failureEvidence = evidence.capture({
              evidenceId: `${input.requestId}.route-${routeAttempt}.failure`,
              missionId: input.missionId,
              kind: ObservationKind.MODEL_CALL_RESULT,
              captureMethod: "model-gateway-route-failure",
              producingSubsystem: MODEL_GATEWAY_SOURCE,
              timestamp: failureTimestamp,
              payload: {
                requestId: input.requestId,
                status: "FAILED",
                structuredOutput: null,
                detail: failure.message.slice(0, 500),
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
                executionStage: input.executionStage ?? "PRODUCTION_EXECUTION",
                routeAttempt,
                failureCategory: failureDisposition.category,
                retryable: failureDisposition.retryable,
              },
            });
            facts.recordResultFact({
              missionId: input.missionId,
              eventId: `${input.requestId}.route-${routeAttempt}.failure.fact`,
              causationId: input.idempotencyKey,
              occurredAt: failureTimestamp,
              producingSubsystem: MODEL_GATEWAY_SOURCE,
              statement: `Model route attempt ${routeAttempt} for request "${input.requestId}" failed: ${failure.message.slice(0, 180)}`,
              evidenceReferences: [
                {
                  evidenceId: failureEvidence.evidenceId,
                  workspaceCheckpointReference: workspace.currentCheckpointId,
                },
              ],
              workspaceCheckpointReference: workspace.currentCheckpointId,
              workUnitReference: input.workUnitId,
              metadata: {
                modelRouteFailure: {
                  requestId: input.requestId,
                  provider: selectedProvider,
                  modelId: selectedModelId,
                  taskClass: input.taskClass,
                  routeAttempt,
                  failureCategory: failureDisposition.category,
                  retryable: failureDisposition.retryable,
                },
              },
            });
          } catch {
            // A failed failure-record must never mask the request's own
            // failure handling; the terminal detail is still preserved by the
            // request-level record below.
          }
          if (
            input.sensitiveValues.some((secret) =>
              failure.message.includes(secret),
            )
          ) {
            failure = new ModelProviderError(
              "Model provider call failed without a persistable detail.",
            );
          }
          // A provider failover can recover an outage or malformed transport,
          // but it cannot change this request's deterministic contract. The
          // semantic validator may normalize mechanical bookkeeping above; if
          // the normalized result still fails, buying the same generation
          // from more providers only repeats the defect and delays the truth.
          if (
            failure.message.startsWith(
              "Structured output failed semantic validation:",
            )
          ) {
            break;
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
          executionStage: input.executionStage ?? "PRODUCTION_EXECUTION",
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
