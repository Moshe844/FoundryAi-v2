import { createAiRegistryStore } from "../src/truth-plane/ai-registry-store.js";
import { createModelRouter } from "../src/work-plane/model-routing-foundation.js";
import { LatencyProfile, ModelCapability } from "../src/domain/ai-registry.js";

const store = createAiRegistryStore({
  registryDirectory: ".foundry/customer/registry/ai",
  clock: () => new Date().toISOString(),
});
const projection = store.projection();
const registry = {
  providers: {
    list: () => [...projection.providers.values()].map((provider) => ({
      ...provider,
      availability: {
        available: provider.enabled && provider.health === "HEALTHY",
        reasons: [],
      },
    })),
  },
  models: { list: () => [...projection.models.values()] },
};
const decision = createModelRouter({ registry }).select({
  taskClass: "PROJECT_UNDERSTANDING",
  taskDepth: 5,
  requiredCapabilities: [
    { capability: ModelCapability.ARCHITECTURE, minimumScore: 60 },
    { capability: ModelCapability.STRUCTURED_OUTPUT, minimumScore: 80 },
    { capability: ModelCapability.REASONING, minimumScore: 80 },
  ],
  costConstraints: { maximumTotalPerMillionTokensUsd: null },
  userPreferences: {
    priority: "FAST_RESPONSE",
    preferredLatencyProfile: LatencyProfile.FAST,
  },
});

console.log(JSON.stringify({
  selectedModelId: decision.selectedModel.modelId,
  selectedProviderId: decision.selectedModel.providerId,
  selectedAlias: decision.selectedAlias,
  costPerMillionTokensUsd: decision.totalCostPerMillionTokensUsd,
  eligibleModelIds: decision.eligibleModelIds,
  rationale: decision.rationale,
}, null, 2));
