import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MODEL_TASK_CAPABILITY_POLICY,
  MODEL_TASK_CAPABILITY_POLICY_VERSION,
  LatencyProfile,
  ModelCapability,
  ModelTaskClass,
  ProviderId,
  RoutingPriority,
  TaskDepth,
  createModelRouter,
  diversifyProviderRoutes,
  governProviderCatalog,
  modelTaskCapabilityContract,
  normalizeCapabilityScores,
} from "../src/index.js";

test("live failover reaches each eligible provider before repeating one", () => {
  const routes = diversifyProviderRoutes([
    { providerId: "openai", modelId: "first" },
    { providerId: "anthropic", modelId: "second" },
    { providerId: "anthropic", modelId: "third" },
    { providerId: "google-gemini", modelId: "fourth" },
  ]);
  assert.deepEqual(
    routes.slice(0, 3).map((route) => route.providerId),
    ["openai", "anthropic", "google-gemini"],
  );
  assert.equal(routes[3].modelId, "third");
});

const observedAt = "2026-08-01T12:00:00.000Z";

function governedModels(ids = [
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6-sol",
]) {
  const snapshot = governProviderCatalog({
    providerId: ProviderId.OPENAI,
    observedAt,
    lifecycleEvidence: {
      providerId: ProviderId.OPENAI,
      fetchedAt: observedAt,
      sourceUrl: "https://developers.openai.com/api/docs/deprecations",
      contentHash: "7".repeat(64),
      status: "OFFICIAL_SOURCE",
      notices: [],
    },
    rawModels: ids.map((id) => ({ id })),
  });
  const validationById = new Map(
    snapshot.validatedModels.map((model) => [model.modelId, model]),
  );
  return snapshot.engineeringEligibleModels.map((eligible) => ({
    ...structuredClone(eligible.manifest),
    governance: {
      allowedTaskClasses: structuredClone(eligible.allowedTaskClasses),
      capabilityAliases: structuredClone(eligible.capabilityAliases),
      capabilitySupport: structuredClone(eligible.capabilitySupport),
      eligibilityReasons: structuredClone(eligible.eligibilityReasons),
      pricing: structuredClone(eligible.pricing),
      validation: structuredClone(validationById.get(eligible.modelId)),
    },
  }));
}

function registryFor(models) {
  return {
    providers: {
      list() {
        return [{
          providerId: ProviderId.OPENAI,
          availability: { available: true },
        }];
      },
    },
    models: {
      list() {
        return structuredClone(models);
      },
    },
  };
}

function request(overrides = {}) {
  return {
    taskClass: ModelTaskClass.FILE_GENERATION,
    taskDepth: TaskDepth.MULTI_FILE_ENGINEERING,
    requiredCapabilities: [],
    costConstraints: { maximumTotalPerMillionTokensUsd: null },
    userPreferences: {
      priority: RoutingPriority.LOW_COST,
      preferredLatencyProfile: null,
    },
    ...overrides,
  };
}

test("Phase 7 gives every production model task an explicit capability contract", () => {
  assert.equal(MODEL_TASK_CAPABILITY_POLICY_VERSION, "2026-08-01");
  assert.deepEqual(
    Object.keys(MODEL_TASK_CAPABILITY_POLICY).sort(),
    Object.values(ModelTaskClass).sort(),
  );
  for (const taskClass of Object.values(ModelTaskClass)) {
    const contract = modelTaskCapabilityContract(taskClass);
    assert.equal(contract.taskClass, taskClass);
    assert.ok(contract.requiredCapabilities.length > 0);
    assert.ok(contract.requiredCapabilities.every(
      ({ capability, minimumScore }) =>
        Object.values(ModelCapability).includes(capability) &&
        Number.isSafeInteger(minimumScore),
    ));
  }
});

test("historical scorecards replay new capabilities as unsupported until refresh", () => {
  const legacy = Object.fromEntries(
    Object.values(ModelCapability)
      .filter((capability) => ![
        ModelCapability.SOFTWARE_ENGINEERING,
        ModelCapability.CODE_GENERATION,
        ModelCapability.CODE_REPAIR,
      ].includes(capability))
      .map((capability) => [capability, 70]),
  );
  const replayed = normalizeCapabilityScores(legacy);
  assert.equal(replayed[ModelCapability.SOFTWARE_ENGINEERING], 0);
  assert.equal(replayed[ModelCapability.CODE_GENERATION], 0);
  assert.equal(replayed[ModelCapability.CODE_REPAIR], 0);
  assert.equal(replayed[ModelCapability.REASONING], 70);
});

test("task policy and call-specific capabilities merge without weakening either", () => {
  const router = createModelRouter({
    registry: registryFor(governedModels()),
    clock: () => observedAt,
  });
  const selection = router.select(request({
    requiredCapabilities: [
      { capability: ModelCapability.VISION, minimumScore: 80 },
      { capability: ModelCapability.STRUCTURED_OUTPUT, minimumScore: 85 },
    ],
  }));
  const required = new Map(
    selection.requiredCapabilities.map((entry) => [entry.capability, entry.minimumScore]),
  );
  assert.equal(required.get(ModelCapability.VISION), 80);
  assert.equal(required.get(ModelCapability.STRUCTURED_OUTPUT), 85);
  assert.equal(required.get(ModelCapability.SOFTWARE_ENGINEERING), 70);
  assert.equal(required.get(ModelCapability.CODE_GENERATION), 70);
  assert.equal(selection.candidateModels[0].capabilityFit, "COMPLETE");
});

test("a numeric score cannot replace validated capability support evidence", () => {
  const models = governedModels(["gpt-5.6-luna", "gpt-5.6-terra"]);
  const terra = models.find((model) => model.modelId === "gpt-5.6-terra");
  terra.governance.capabilitySupport = terra.governance.capabilitySupport.filter(
    (entry) => entry.capability !== ModelCapability.SOFTWARE_ENGINEERING,
  );
  assert.ok(
    terra.capabilities[ModelCapability.SOFTWARE_ENGINEERING] >= 70,
    "the score stays high so the evidence gate is independently proven",
  );
  const router = createModelRouter({
    registry: registryFor(models),
    clock: () => observedAt,
  });
  const selection = router.select(request());
  assert.equal(selection.selectedModel.modelId, "gpt-5.6-luna");
  const rejected = selection.rejectedModels.find(
    (model) => model.modelId === "gpt-5.6-terra",
  );
  assert.match(
    rejected.reasons.join(" "),
    /SOFTWARE_ENGINEERING lacks validated capability support evidence/u,
  );
});

test("the cheapest fully capable model wins under a neutral reliability prior", () => {
  const router = createModelRouter({
    registry: registryFor(governedModels()),
    clock: () => observedAt,
  });
  const selection = router.select(request());
  assert.equal(selection.selectedModel.modelId, "gpt-5.6-luna");
  assert.deepEqual(
    selection.candidateModels.map((candidate) => candidate.modelId),
    ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"],
  );
  assert.equal(selection.selectionFactors.reliabilityHistoryApplied, false);
});

test("persisted task reliability outranks cost without changing capability gates", () => {
  const history = [
    {
      kind: "failure",
      requestId: "luna-failed",
      providerId: ProviderId.OPENAI,
      modelId: "gpt-5.6-luna",
      taskClass: ModelTaskClass.FILE_GENERATION,
    },
    {
      kind: "route",
      requestId: "terra-succeeded",
      providerId: ProviderId.OPENAI,
      modelId: "gpt-5.6-terra",
      taskClass: ModelTaskClass.FILE_GENERATION,
      routeAttempt: 1,
    },
    {
      kind: "result",
      requestId: "terra-succeeded",
      providerId: ProviderId.OPENAI,
      modelId: "gpt-5.6-terra",
      taskClass: ModelTaskClass.FILE_GENERATION,
      status: "SUCCEEDED",
    },
  ];
  const router = createModelRouter({
    registry: registryFor(governedModels()),
    clock: () => observedAt,
    routeHistory: () => history,
  });
  const selection = router.select(request());
  assert.equal(selection.selectedModel.modelId, "gpt-5.6-terra");
  assert.equal(selection.selectionFactors.reliabilityHistoryApplied, true);
  assert.ok(
    selection.candidateModels[0].reliability.estimatedFailureRate <
      selection.candidateModels.at(-1).reliability.estimatedFailureRate,
  );
});

test("fast-response intake keeps the fastest eligible family ahead of slower history", () => {
  const history = [
    {
      kind: "failure",
      requestId: "luna-failed",
      providerId: ProviderId.OPENAI,
      modelId: "gpt-5.6-luna",
      taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
    },
    {
      kind: "route",
      requestId: "terra-succeeded",
      providerId: ProviderId.OPENAI,
      modelId: "gpt-5.6-terra",
      taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
      routeAttempt: 1,
    },
    {
      kind: "result",
      requestId: "terra-succeeded",
      providerId: ProviderId.OPENAI,
      modelId: "gpt-5.6-terra",
      taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
      status: "SUCCEEDED",
    },
  ];
  const router = createModelRouter({
    registry: registryFor(governedModels()),
    clock: () => observedAt,
    routeHistory: () => history,
  });
  const selection = router.select(request({
    taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
    taskDepth: TaskDepth.ARCHITECTURE,
    userPreferences: {
      priority: RoutingPriority.FAST_RESPONSE,
      preferredLatencyProfile: LatencyProfile.FAST,
    },
  }));
  assert.equal(selection.selectedModel.modelId, "gpt-5.6-luna");
  assert.equal(selection.candidateModels[0].latencyProfile, LatencyProfile.FAST);
  assert.equal(selection.selectionFactors.reliabilityHistoryApplied, true);
});

test("capability aliases describe a result but never qualify it", () => {
  const router = createModelRouter({
    registry: registryFor(governedModels(["gpt-5.6-luna"])),
    clock: () => observedAt,
  });
  const selection = router.select(request({
    taskClass: ModelTaskClass.STRUCTURED_TRANSFORMATION,
    taskDepth: TaskDepth.MECHANICAL,
    userPreferences: {
      priority: RoutingPriority.CAPABILITY,
      preferredLatencyProfile: null,
    },
  }));
  assert.equal(selection.selectedModel.modelId, "gpt-5.6-luna");
  assert.equal(selection.selectedAlias, "MODEL_CAPABLE");
  assert.match(selection.rationale.join(" "), /did not replace task capability checks/u);
});

test("live gateway routing consumes capability candidates while fixtures stay isolated", () => {
  const gateway = readFileSync(
    new URL("../src/work-plane/model-gateway.js", import.meta.url),
    "utf8",
  );
  assert.match(gateway, /capabilitySelection = modelRouter\.select/u);
  assert.match(gateway, /capabilitySelection\.candidateModels/u);
  assert.match(gateway, /diversifyProviderRoutes/u);
  assert.match(gateway, /priorSafeOutputFailure/u);
  assert.match(gateway, /repeatFinalValidationRoute/u);
  assert.match(gateway, /if \(!fixtureOnly\)/u);
  assert.match(gateway, /Live model execution requires the capability-driven Model Router/u);
});
