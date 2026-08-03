import {
  ModelTaskClass,
  ProviderId,
  RoutingPriority,
  TaskDepth,
  createAiRegistryStore,
  createModelRouter,
} from "../src/index.js";
import { fileURLToPath } from "node:url";

const providerResponse = await fetch("http://127.0.0.1:3927/providers");
if (!providerResponse.ok) {
  throw new Error(`Provider view returned HTTP ${providerResponse.status}.`);
}
const { providers } = await providerResponse.json();
const availability = new Map(
  providers.map((provider) => [provider.providerId, provider.available]),
);
const store = createAiRegistryStore({
  registryDirectory: fileURLToPath(new URL(
    "../.foundry/customer/registry/ai",
    import.meta.url,
  )),
  clock: () => new Date().toISOString(),
});
const projection = store.projection();
const registry = {
  providers: {
    list() {
      return [...projection.providers.values()].map((provider) => ({
        ...provider,
        availability: {
          available: availability.get(provider.providerId) === true,
        },
      }));
    },
  },
  models: {
    list() {
      return [...projection.models.values()];
    },
  },
};
const router = createModelRouter({ registry });
const selection = router.select({
  taskClass: ModelTaskClass.FILE_GENERATION,
  taskDepth: TaskDepth.MULTI_FILE_ENGINEERING,
  requiredCapabilities: [],
  costConstraints: { maximumTotalPerMillionTokensUsd: null },
  userPreferences: {
    priority: RoutingPriority.LOW_COST,
    preferredLatencyProfile: null,
  },
});

const required = new Set(
  selection.requiredCapabilities.map((entry) => entry.capability),
);
for (const candidate of selection.candidateModels) {
  if (candidate.capabilityFit !== "COMPLETE") {
    throw new Error(`Candidate ${candidate.modelId} has incomplete capability fit.`);
  }
}
if (selection.selectedModel.providerId === ProviderId.GOOGLE_GEMINI &&
    /robotic/u.test(selection.selectedModel.modelId)) {
  throw new Error("A robotics model entered file-generation routing.");
}

console.log(JSON.stringify({
  taskClass: selection.taskClass,
  taskDepth: selection.taskDepth,
  policyVersion: selection.taskCapabilityPolicy.policyVersion,
  requiredCapabilities: [...required].sort(),
  selectedProvider: selection.selectedModel.providerId,
  selectedModel: selection.selectedModel.modelId,
  selectedCostPerMillionTokensUsd: selection.totalCostPerMillionTokensUsd,
  candidateCount: selection.candidateModels.length,
  rejectedCount: selection.rejectedModels.length,
  selectionFactors: selection.selectionFactors,
}, null, 2));
