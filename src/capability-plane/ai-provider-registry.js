import { ModelGatewayValidationError } from "../domain/errors.js";
import {
  LatencyProfile,
  ModelCapability,
  ProviderHealth,
  RegistryOperation,
  SUPPORTED_PROVIDER_IDS,
  assertAiIdentifier,
  cloneAiValue,
  normalizeModelManifest,
  normalizeProviderHealth,
  normalizeProviderMetadata,
} from "../domain/ai-registry.js";
import { ModelLifecycleState } from "../domain/model-governance.js";
import { MODEL_GOVERNANCE_POLICY } from "../config/model-governance-policy.js";

function providerAvailability(provider, environmentInspection) {
  const reasons = [];
  if (!provider.enabled) {
    reasons.push("provider is disabled");
  }
  if (!environmentInspection.configured) {
    reasons.push("credential is missing");
  } else if (!environmentInspection.valid) {
    reasons.push("credential format is invalid");
  }
  if (provider.health !== ProviderHealth.HEALTHY) {
    reasons.push(`provider health is ${provider.health}`);
  }
  return cloneAiValue({
    available: reasons.length === 0,
    reasons,
  });
}

function assertKnownProviderId(providerId) {
  if (!SUPPORTED_PROVIDER_IDS.includes(providerId)) {
    throw new ModelGatewayValidationError(
      `Provider "${providerId}" is not supported by Milestone 9A.`,
    );
  }
}

export function createAiProviderRegistry({
  store,
  environment,
  discoveryAdapters = {},
  executionAdapters = [],
  clock,
}) {
  if (
    store === null ||
    typeof store !== "object" ||
    environment === null ||
    typeof environment !== "object" ||
    typeof clock !== "function"
  ) {
    throw new ModelGatewayValidationError(
      "Provider Registry requires a store, Environment Service, and clock.",
    );
  }
  if (
    discoveryAdapters === null ||
    typeof discoveryAdapters !== "object" ||
    Array.isArray(discoveryAdapters)
  ) {
    throw new ModelGatewayValidationError(
      "Provider discovery adapters must be an object.",
    );
  }
  for (const [providerId, adapter] of Object.entries(discoveryAdapters)) {
    assertKnownProviderId(providerId);
    if (
      adapter === null ||
      typeof adapter !== "object" ||
      typeof adapter.discoverModels !== "function" &&
      typeof adapter.discoverCatalog !== "function"
    ) {
      throw new ModelGatewayValidationError(
        `Discovery adapter "${providerId}" must expose discoverModels() or discoverCatalog().`,
      );
    }
  }
  if (
    !Array.isArray(executionAdapters) ||
    executionAdapters.some(
      (adapter) =>
        adapter === null ||
        typeof adapter !== "object" ||
        (adapter.fixtureOnly !== true && adapter.live !== true) ||
        typeof adapter.generate !== "function",
    )
  ) {
    throw new ModelGatewayValidationError(
      "Execution adapters must declare fixtureOnly or live and expose generate().",
    );
  }
  const executionAdapterMap = new Map();
  const executionProviderMetadata = [];
  for (const adapter of executionAdapters) {
    if (adapter.live === true) {
      assertKnownProviderId(adapter.providerId);
    } else {
      assertAiIdentifier(adapter.providerId, "fixture providerId");
    }
    if (executionAdapterMap.has(adapter.providerId)) {
      throw new ModelGatewayValidationError(
        `Execution provider "${adapter.providerId}" is duplicated.`,
      );
    }
    executionAdapterMap.set(adapter.providerId, adapter);
    executionProviderMetadata.push({
      providerId: adapter.providerId,
      providerFamily: adapter.providerFamily ?? "GPT",
      modelId: adapter.modelId ?? adapter.providerId,
      maxRepairDepth: adapter.maxRepairDepth ?? 5,
      available: adapter.available ?? true,
      inputCostPerMillionTokensUsd:
        adapter.inputCostPerMillionTokensUsd ?? 0,
      outputCostPerMillionTokensUsd:
        adapter.outputCostPerMillionTokensUsd ?? 0,
      observedPerformance: adapter.observedPerformance ?? 0,
      latencyProfile: adapter.latencyProfile ?? LatencyProfile.BALANCED,
    });
  }

  function getRawProvider(providerId) {
    assertKnownProviderId(providerId);
    const provider = store.projection().providers.get(providerId);
    if (provider === undefined) {
      throw new ModelGatewayValidationError(
        `Provider "${providerId}" is not registered.`,
      );
    }
    return provider;
  }

  function decorateProvider(provider) {
    const environmentInspection = environment.inspectProvider(
      provider.providerId,
    );
    const availability = providerAvailability(
      provider,
      environmentInspection,
    );
    return cloneAiValue({
      ...provider,
      credential: environmentInspection,
      availability,
    });
  }

  function append(eventId, operation, payload, occurredAt = clock()) {
    return store.append({ eventId, operation, payload, occurredAt });
  }

  function preserveMissingCatalogModels(providerId, snapshot, missingSince) {
    const projection = store.projection();
    const currentIds = new Set(snapshot.discoveredModels.map((model) => model.modelId));
    const discoveredModels = snapshot.discoveredModels.map((model) => ({
      ...model,
      catalogPresence: "PRESENT",
      lastSeenAt: model.observedAt,
      missingSince: null,
    }));
    const validatedModels = snapshot.validatedModels.map((model) => cloneAiValue(model));
    for (const previous of projection.discoveredModels.values()) {
      if (previous.providerId !== providerId || currentIds.has(previous.modelId)) continue;
      const key = `${providerId}:${previous.modelId}`;
      const validation = projection.validatedModels.get(key);
      discoveredModels.push({
        ...previous,
        accountAccessible: false,
        catalogPresence: "MISSING",
        lastSeenAt: previous.lastSeenAt ?? previous.observedAt ?? previous.discoveredAt,
        missingSince: previous.missingSince ?? missingSince,
      });
      if (validation !== undefined) {
        const reason = "provider catalog no longer reports this model; pending validation";
        validatedModels.push({
          ...validation,
          registryState: ModelLifecycleState.QUARANTINED,
          validationStatus: ModelLifecycleState.QUARANTINED,
          validationReasons: [...new Set([...(validation.validationReasons ?? []), reason])],
          stateHistory: [...(validation.stateHistory ?? []), ModelLifecycleState.QUARANTINED],
          missingSince: previous.missingSince ?? missingSince,
        });
      }
    }
    return cloneAiValue({
      discoveredModels: discoveredModels.sort((left, right) => left.modelId.localeCompare(right.modelId)),
      validatedModels: validatedModels.sort((left, right) => left.modelId.localeCompare(right.modelId)),
      engineeringEligibleModels: snapshot.engineeringEligibleModels,
    });
  }

  const providers = Object.freeze({
    register({ eventId, metadata, occurredAt = clock() }) {
      const normalized = normalizeProviderMetadata(metadata);
      return append(
        eventId,
        RegistryOperation.PROVIDER_REGISTERED,
        normalized,
        occurredAt,
      );
    },
    setEnabled({
      eventId,
      providerId,
      enabled,
      reason,
      occurredAt = clock(),
    }) {
      const provider = getRawProvider(providerId);
      if (typeof enabled !== "boolean") {
        throw new ModelGatewayValidationError(
          "Provider enabled must be boolean.",
        );
      }
      if (
        typeof reason !== "string" ||
        reason.trim() === "" ||
        provider.enabled === enabled
      ) {
        throw new ModelGatewayValidationError(
          "Provider enablement must change state and include a reason.",
        );
      }
      return append(
        eventId,
        RegistryOperation.PROVIDER_ENABLED_CHANGED,
        { providerId, enabled, reason: reason.trim() },
        occurredAt,
      );
    },
    recordHealth({
      eventId,
      providerId,
      observation,
      occurredAt = clock(),
    }) {
      getRawProvider(providerId);
      return append(
        eventId,
        RegistryOperation.PROVIDER_HEALTH_RECORDED,
        {
          providerId,
          observation: normalizeProviderHealth(observation),
        },
        occurredAt,
      );
    },
    get(providerId) {
      return decorateProvider(getRawProvider(providerId));
    },
    list() {
      return cloneAiValue(
        [...store.projection().providers.values()]
          .sort((left, right) =>
            left.providerId.localeCompare(right.providerId),
          )
          .map(decorateProvider),
      );
    },
    validateCredential(providerId) {
      getRawProvider(providerId);
      return environment.inspectProvider(providerId);
    },
  });

  const models = Object.freeze({
    async probe(providerId) {
      const provider = providers.get(providerId);
      if (
        !provider.enabled ||
        !provider.credential.configured ||
        !provider.credential.valid
      ) {
        throw new ModelGatewayValidationError(
          `Provider "${providerId}" is unavailable: ${provider.availability.reasons.join(", ")}.`,
        );
      }
      const adapter = discoveryAdapters[providerId];
      if (adapter === undefined) {
        throw new ModelGatewayValidationError(
          `No model-discovery adapter is configured for "${providerId}".`,
        );
      }
      const discoveredModels = await environment.withCredential(
        providerId,
        (credential) =>
          (adapter.discoverCatalog ?? adapter.discoverModels)({
            credential,
            provider: cloneAiValue(provider),
          }),
      );
      if (!Array.isArray(discoveredModels)) {
        if (
          discoveredModels === null ||
          typeof discoveredModels !== "object" ||
          !Array.isArray(discoveredModels.discoveredModels) ||
          !Array.isArray(discoveredModels.validatedModels) ||
          !Array.isArray(discoveredModels.engineeringEligibleModels)
        ) {
          throw new ModelGatewayValidationError(
            "Provider model probe returned an invalid governance snapshot.",
          );
        }
        return cloneAiValue({
          discoveredModels: discoveredModels.discoveredModels,
          validatedModels: discoveredModels.validatedModels,
          engineeringEligibleModels: discoveredModels.engineeringEligibleModels.map(
            (model) => ({ ...model, manifest: normalizeModelManifest(model.manifest) }),
          ),
        });
      }
      return cloneAiValue(
        discoveredModels.map((model) => normalizeModelManifest(model)),
      );
    },

    registerDiscovery({
      eventId,
      discoveryId,
      providerId,
      discoveredModels,
      occurredAt = clock(),
    }) {
      getRawProvider(providerId);
      assertAiIdentifier(discoveryId, "model discoveryId");
      if (!Array.isArray(discoveredModels)) {
        throw new ModelGatewayValidationError(
          "Discovered models must be an array.",
        );
      }
      const normalized = discoveredModels.map((model) =>
        normalizeModelManifest(model),
      );
      return append(
        eventId,
        RegistryOperation.MODELS_DISCOVERED,
        {
          discoveryId,
          providerId,
          models: normalized,
        },
        occurredAt,
      );
    },
    async discover({
      eventId,
      discoveryId,
      providerId,
      occurredAt = clock(),
    }) {
      const provider = providers.get(providerId);
      if (
        !provider.enabled ||
        !provider.credential.configured ||
        !provider.credential.valid
      ) {
        throw new ModelGatewayValidationError(
          `Provider "${providerId}" is unavailable: ${provider.availability.reasons.join(", ")}.`,
        );
      }
      const discoveredModels = await models.probe(providerId);
      if (!Array.isArray(discoveredModels)) {
        const governedSnapshot = preserveMissingCatalogModels(
          providerId,
          discoveredModels,
          occurredAt,
        );
        return append(
          eventId,
          RegistryOperation.MODEL_GOVERNANCE_REFRESHED,
          { discoveryId, providerId, ...governedSnapshot },
          occurredAt,
        );
      }
      return models.registerDiscovery({
        eventId,
        discoveryId,
        providerId,
        discoveredModels,
        occurredAt,
      });
    },
    async refresh({
      eventId,
      discoveryId,
      providerId,
      occurredAt = clock(),
    }) {
      const discoveredModels = await models.probe(providerId);
      if (!Array.isArray(discoveredModels)) {
        const governedSnapshot = preserveMissingCatalogModels(
          providerId,
          discoveredModels,
          occurredAt,
        );
        return append(
          eventId,
          RegistryOperation.MODEL_GOVERNANCE_REFRESHED,
          { discoveryId, providerId, ...governedSnapshot },
          occurredAt,
        );
      }
      return append(
        eventId,
        RegistryOperation.MODEL_CATALOG_REFRESHED,
        {
          discoveryId,
          providerId,
          models: discoveredModels,
        },
        occurredAt,
      );
    },
    get(modelId) {
      assertAiIdentifier(modelId, "modelId");
      const model = store.projection().models.get(modelId);
      if (model === undefined) {
        throw new ModelGatewayValidationError(
          `Model "${modelId}" is not registered.`,
        );
      }
      return model;
    },
    list({ providerId = null } = {}) {
      if (providerId !== null) {
        getRawProvider(providerId);
      }
      return cloneAiValue(
        [...store.projection().models.values()]
          .filter(
            (model) =>
              providerId === null || model.providerId === providerId,
          )
          .sort((left, right) => left.modelId.localeCompare(right.modelId)),
      );
    },
    listDiscovered({ providerId = null } = {}) {
      if (providerId !== null) getRawProvider(providerId);
      return cloneAiValue(
        [...store.projection().discoveredModels.values()]
          .filter((model) => providerId === null || model.providerId === providerId)
          .sort((left, right) => left.modelId.localeCompare(right.modelId)),
      );
    },
    listValidated({ providerId = null } = {}) {
      if (providerId !== null) getRawProvider(providerId);
      return cloneAiValue(
        [...store.projection().validatedModels.values()]
          .filter((model) => providerId === null || model.providerId === providerId)
          .sort((left, right) => left.modelId.localeCompare(right.modelId)),
      );
    },
    listEngineeringEligible({ providerId = null } = {}) {
      if (providerId !== null) getRawProvider(providerId);
      return cloneAiValue(
        [...store.projection().engineeringEligibleModels.values()]
          .filter((model) => providerId === null || model.providerId === providerId)
          .sort((left, right) => left.modelId.localeCompare(right.modelId)),
      );
    },
    refreshStatus(providerId) {
      getRawProvider(providerId);
      const refresh = store.projection().modelRefreshes.get(providerId) ?? null;
      const now = clock();
      const ageMs = refresh === null
        ? null
        : Math.max(0, Date.parse(now) - Date.parse(refresh.lastSuccessfulRefreshAt));
      return cloneAiValue({
        providerId,
        lastSuccessfulRefreshAt: refresh?.lastSuccessfulRefreshAt ?? null,
        discoveryId: refresh?.discoveryId ?? null,
        ageMs,
        maximumAgeMs: MODEL_GOVERNANCE_POLICY.maximumCatalogAgeMs,
        stale: refresh === null || ageMs > MODEL_GOVERNANCE_POLICY.maximumCatalogAgeMs,
      });
    },
  });

  const capabilities = Object.freeze({
    list() {
      return cloneAiValue(Object.values(ModelCapability));
    },
    forModel(modelId) {
      return cloneAiValue(models.get(modelId).capabilities);
    },
    score(modelId, capability) {
      if (!Object.values(ModelCapability).includes(capability)) {
        throw new ModelGatewayValidationError(
          `Capability "${capability}" is not registered.`,
        );
      }
      return models.get(modelId).capabilities[capability];
    },
  });

  const execution = Object.freeze({
    list() {
      return cloneAiValue(
        executionProviderMetadata.flatMap((metadata) => {
          const adapter = executionAdapterMap.get(metadata.providerId);
          if (adapter?.live !== true) return [metadata];
          const provider =
            store.projection().providers.get(metadata.providerId);
          const environmentInspection = environment.inspectProvider(
            metadata.providerId,
          );
          const discovered = [...store.projection().models.values()]
            .filter(
              (model) =>
                model.providerId === metadata.providerId &&
                model.enabled &&
                model.status === "AVAILABLE" &&
                model.supportsStructuredOutput,
            )
            .sort((left, right) =>
              left.modelId.localeCompare(right.modelId),
            );
          const available =
            provider?.enabled === true &&
            provider.health === ProviderHealth.HEALTHY &&
            environmentInspection.configured &&
            environmentInspection.valid;
          if (discovered.length === 0) {
            return [{ ...metadata, available: false }];
          }
          return discovered.map((model) => ({
            ...metadata,
            modelId: model.modelId,
            available,
            latencyProfile: model.latencyProfile,
            inputCostPerMillionTokensUsd:
              model.costProfile.inputPerMillionTokensUsd,
            outputCostPerMillionTokensUsd:
              model.costProfile.outputPerMillionTokensUsd,
            observedPerformance: Math.round(
              (model.capabilities[ModelCapability.CODING] +
                model.capabilities[ModelCapability.REASONING] +
                model.capabilities[ModelCapability.DEBUGGING]) /
                3,
            ),
          }));
        }),
      );
    },
    async generate(providerId, request, { modelId = null } = {}) {
      assertAiIdentifier(providerId, "execution providerId");
      const adapter = executionAdapterMap.get(providerId);
      if (adapter === undefined) {
        throw new ModelGatewayValidationError(
          `Execution provider "${providerId}" is not configured.`,
        );
      }
      if (adapter.fixtureOnly === true) {
        return adapter.generate(cloneAiValue(request));
      }
      assertKnownProviderId(providerId);
      const provider = providers.get(providerId);
      if (!provider.availability.available) {
        throw new ModelGatewayValidationError(
          `Provider "${providerId}" is unavailable: ${provider.availability.reasons.join(", ")}.`,
        );
      }
      const selectedModelId =
        modelId ??
        execution
          .list()
          .find((metadata) => metadata.providerId === providerId)
          ?.modelId;
      if (
        typeof selectedModelId !== "string" ||
        selectedModelId === providerId
      ) {
        throw new ModelGatewayValidationError(
          `Provider "${providerId}" has no discovered execution model.`,
        );
      }
      const selectedModel = models.get(selectedModelId);
      if (
        selectedModel.providerId !== providerId ||
        !selectedModel.enabled ||
        selectedModel.status !== "AVAILABLE" ||
        !selectedModel.supportsStructuredOutput
      ) {
        throw new ModelGatewayValidationError(
          `Model "${selectedModelId}" is not an eligible execution model for provider "${providerId}".`,
        );
      }
      const result = await environment.withCredential(providerId, (credential) =>
        adapter.generate({
          credential,
          modelId: selectedModelId,
          request: cloneAiValue(request),
        }),
      );
      const inputRate = selectedModel.costProfile.inputPerMillionTokensUsd;
      const outputRate = selectedModel.costProfile.outputPerMillionTokensUsd;
      const inputTokens = result.usage?.inputTokens ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;
      return cloneAiValue({
        ...result,
        usage: {
          ...result.usage,
          costUsd:
            (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
        },
      });
    },
  });

  return Object.freeze({
    providers,
    models,
    capabilities,
    execution,
    listEvents: store.listEvents,
    path: store.path,
  });
}
