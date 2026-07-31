import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  EngineeringModelAlias,
  ModelLifecycle,
  ModelLifecycleState,
  ModelPurpose,
  ModelReleaseChannel,
  ModelCapability,
  ProviderHealth,
  ProviderId,
  RoutingPriority,
  TaskDepth,
  AiRegistryOperation,
  createAiProviderRegistry,
  createAiRegistryStore,
  createModelRouter,
  governProviderCatalog,
} from "../src/index.js";

const observedAt = "2026-07-31T18:00:00.000Z";

test("OpenAI discovery is not engineering eligibility", () => {
  const snapshot = governProviderCatalog({
    providerId: ProviderId.OPENAI,
    observedAt,
    rawModels: [
      { id: "gpt-5.2-pro", created: 1, owned_by: "openai" },
      { id: "gpt-5.6-sol", created: 2, owned_by: "openai" },
      { id: "gpt-image-2", created: 3, owned_by: "openai" },
    ],
  });
  assert.equal(snapshot.discoveredModels.length, 3);
  assert.deepEqual(snapshot.engineeringEligibleModels.map((model) => model.modelId), ["gpt-5.6-sol"]);
  const oldPro = snapshot.validatedModels.find((model) => model.modelId === "gpt-5.2-pro");
  assert.equal(oldPro.registryState, ModelLifecycleState.UNVERIFIED);
  assert.equal(oldPro.validationStatus, ModelLifecycleState.UNVERIFIED);
  assert.match(oldPro.validationReasons.join(" "), /current engineering family policy/u);
  assert.equal(snapshot.engineeringEligibleModels[0].pricing.known, true);
  assert.equal(snapshot.engineeringEligibleModels[0].manifest.costProfile.inputPerMillionTokensUsd, 5);
});

test("catalog refresh quarantines a previously discovered model that disappears", async () => {
  const directory = mkdtempSync(join(tmpdir(), "foundry-model-refresh-"));
  let now = observedAt;
  let rawModels = [{ id: "gpt-5.6-luna" }, { id: "gpt-5.6-sol" }];
  try {
    const store = createAiRegistryStore({ registryDirectory: directory, clock: () => now });
    const registry = createAiProviderRegistry({
      store,
      clock: () => now,
      environment: {
        inspectProvider: () => ({ configured: true, valid: true, reason: "configured" }),
        withCredential: async (_providerId, callback) => callback("not-persisted"),
      },
      discoveryAdapters: {
        [ProviderId.OPENAI]: {
          async discoverCatalog() {
            return governProviderCatalog({
              providerId: ProviderId.OPENAI,
              rawModels,
              observedAt: now,
            });
          },
        },
      },
      executionAdapters: [],
    });
    registry.providers.register({
      eventId: "provider-openai-refresh-test",
      metadata: {
        providerId: ProviderId.OPENAI,
        displayName: "OpenAI",
        version: "v1",
        enabled: true,
        rateLimits: { requestsPerMinute: null, tokensPerMinute: null },
        costMetadata: { currency: "USD", source: "official pricing" },
      },
    });
    registry.providers.recordHealth({
      eventId: "provider-openai-refresh-health",
      providerId: ProviderId.OPENAI,
      observation: { health: ProviderHealth.HEALTHY, detail: "healthy" },
    });
    await registry.models.discover({
      eventId: "provider-openai-refresh-first",
      discoveryId: "provider-openai-refresh-first-discovery",
      providerId: ProviderId.OPENAI,
    });
    rawModels = [{ id: "gpt-5.6-luna" }];
    now = "2026-07-31T19:00:00.000Z";
    await registry.models.refresh({
      eventId: "provider-openai-refresh-second",
      discoveryId: "provider-openai-refresh-second-discovery",
      providerId: ProviderId.OPENAI,
    });
    const missing = registry.models.listDiscovered({ providerId: ProviderId.OPENAI })
      .find((model) => model.modelId === "gpt-5.6-sol");
    const validation = registry.models.listValidated({ providerId: ProviderId.OPENAI })
      .find((model) => model.modelId === "gpt-5.6-sol");
    assert.equal(missing.catalogPresence, "MISSING");
    assert.equal(missing.missingSince, now);
    assert.equal(validation.registryState, ModelLifecycleState.QUARANTINED);
    assert.match(validation.validationReasons.join(" "), /no longer reports/u);
    assert.deepEqual(
      registry.models.list({ providerId: ProviderId.OPENAI }).map((model) => model.modelId),
      ["gpt-5.6-luna"],
    );
    assert.deepEqual(registry.models.refreshStatus(ProviderId.OPENAI), {
      providerId: ProviderId.OPENAI,
      lastSuccessfulRefreshAt: now,
      discoveryId: "provider-openai-refresh-second-discovery",
      ageMs: 0,
      maximumAgeMs: 86_400_000,
      stale: false,
    });
    const restartedStore = createAiRegistryStore({
      registryDirectory: directory,
      clock: () => now,
    });
    assert.deepEqual(
      restartedStore.projection().modelRefreshes.get(ProviderId.OPENAI),
      {
        providerId: ProviderId.OPENAI,
        discoveryId: "provider-openai-refresh-second-discovery",
        refreshEventId: "provider-openai-refresh-second",
        lastSuccessfulRefreshAt: now,
      },
    );
    now = "2026-08-02T19:00:00.001Z";
    assert.equal(registry.models.refreshStatus(ProviderId.OPENAI).stale, true);
    const router = createModelRouter({ registry, clock: () => now });
    assert.throws(
      () => router.select({
        taskClass: "PROJECT_UNDERSTANDING",
        taskDepth: TaskDepth.MECHANICAL,
        requiredCapabilities: [
          { capability: ModelCapability.CODING, minimumScore: 50 },
        ],
        costConstraints: { maximumTotalPerMillionTokensUsd: 10 },
        userPreferences: {
          priority: RoutingPriority.FAST_RESPONSE,
          preferredLatencyProfile: null,
        },
      }),
      /provider catalog metadata is stale/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("specialized and unstable Gemini variants fail closed generically", () => {
  const snapshot = governProviderCatalog({
    providerId: ProviderId.GOOGLE_GEMINI,
    observedAt,
    rawModels: [
      { name: "models/gemini-robotics-er-2-preview", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-robotics-er-99-preview", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3.5-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-flash-latest", supportedGenerationMethods: ["generateContent"] },
    ],
  });
  for (const id of ["gemini-robotics-er-2-preview", "gemini-robotics-er-99-preview"]) {
    const model = snapshot.validatedModels.find((candidate) => candidate.modelId === id);
    assert.equal(model.purpose, ModelPurpose.ROBOTICS);
    assert.equal(model.releaseChannel, ModelReleaseChannel.PREVIEW);
    assert.equal(model.validationStatus, "QUARANTINED");
  }
  const alias = snapshot.validatedModels.find((model) => model.modelId === "gemini-flash-latest");
  assert.equal(alias.releaseChannel, ModelReleaseChannel.MOVING_ALIAS);
  assert.deepEqual(snapshot.engineeringEligibleModels.map((model) => model.modelId), ["gemini-3.5-flash"]);
});

test("documented shutdown model families are labeled and excluded by lifecycle policy", () => {
  const snapshot = governProviderCatalog({
    providerId: ProviderId.GOOGLE_GEMINI,
    observedAt,
    rawModels: [
      { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-robotics-er-1.5-preview", supportedGenerationMethods: ["generateContent"] },
    ],
  });
  for (const model of snapshot.validatedModels) {
    assert.equal(model.lifecycle, ModelLifecycle.SHUTDOWN);
    assert.equal(model.registryState, ModelLifecycleState.SHUTDOWN);
    assert.equal(model.validationStatus, ModelLifecycleState.SHUTDOWN);
    assert.match(model.validationReasons.join(" "), /lifecycle is SHUTDOWN/u);
  }
});

test("fresh official lifecycle evidence overrides a catalog that still reports a deprecated model", () => {
  const snapshot = governProviderCatalog({
    providerId: ProviderId.OPENAI,
    observedAt,
    lifecycleEvidence: {
      providerId: ProviderId.OPENAI,
      fetchedAt: observedAt,
      sourceUrl: "https://developers.openai.com/api/docs/deprecations",
      contentHash: "a".repeat(64),
      status: "OFFICIAL_SOURCE",
      notices: [{
        modelId: "gpt-5.6-luna",
        lifecycle: "DEPRECATED",
        shutdownDate: "2026-12-11",
        sourceUrl: "https://developers.openai.com/api/docs/deprecations",
      }],
    },
    rawModels: [{ id: "gpt-5.6-luna" }],
  });
  assert.equal(snapshot.validatedModels[0].registryState, ModelLifecycleState.DEPRECATED);
  assert.equal(snapshot.validatedModels[0].lifecycleSourceStatus, "OFFICIAL_SOURCE");
  assert.equal(snapshot.validatedModels[0].catalogObservedAt, observedAt);
  assert.equal(snapshot.validatedModels[0].maximumCatalogAgeMs, 86_400_000);
  assert.equal(snapshot.engineeringEligibleModels.length, 0);
});

test("Phase 5 exposes every required lifecycle state and routes only ACTIVE_STABLE", () => {
  assert.deepEqual(Object.values(ModelLifecycleState).sort(), [
    "ACTIVE_PREVIEW",
    "ACTIVE_STABLE",
    "DEPRECATED",
    "DISCOVERED",
    "EXPERIMENTAL",
    "INACCESSIBLE",
    "QUARANTINED",
    "SHUTDOWN",
    "UNVERIFIED",
    "VALIDATING",
  ]);
  const snapshot = governProviderCatalog({
    providerId: ProviderId.OPENAI,
    observedAt,
    rawModels: [
      { id: "gpt-5.6-luna" },
      { id: "gpt-5.6-luna-preview", stage: "PREVIEW" },
      { id: "gpt-5.6-luna-experimental", stage: "EXPERIMENTAL" },
      { id: "gpt-5.6-terra", stage: "LEGACY" },
      { id: "gpt-5.6-sol", accessible: false },
      { id: "gpt-5.2-pro" },
      { id: "gpt-image-2" },
    ],
  });
  const state = (modelId) => snapshot.validatedModels.find((model) => model.modelId === modelId).registryState;
  assert.equal(snapshot.discoveredModels[0].registryState, ModelLifecycleState.DISCOVERED);
  assert.equal(state("gpt-5.6-luna"), ModelLifecycleState.ACTIVE_STABLE);
  assert.deepEqual(snapshot.validatedModels[0].stateHistory, [
    ModelLifecycleState.DISCOVERED,
    ModelLifecycleState.VALIDATING,
    ModelLifecycleState.ACTIVE_STABLE,
  ]);
  assert.equal(state("gpt-5.6-luna-preview"), ModelLifecycleState.ACTIVE_PREVIEW);
  assert.equal(state("gpt-5.6-luna-experimental"), ModelLifecycleState.EXPERIMENTAL);
  assert.equal(state("gpt-5.6-terra"), ModelLifecycleState.DEPRECATED);
  assert.equal(state("gpt-5.6-sol"), ModelLifecycleState.INACCESSIBLE);
  assert.equal(state("gpt-5.2-pro"), ModelLifecycleState.UNVERIFIED);
  assert.equal(state("gpt-image-2"), ModelLifecycleState.QUARANTINED);
  assert.deepEqual(snapshot.engineeringEligibleModels.map((model) => model.modelId), ["gpt-5.6-luna"]);
});

test("eligible records carry dynamic aliases, task scope, lifecycle, sources, and raw provenance", () => {
  const raw = {
    id: "claude-sonnet-5",
    display_name: "Claude Sonnet 5",
    max_input_tokens: 1_000_000,
    capabilities: {
      structured_outputs: { supported: true },
      thinking: { supported: true },
      image_input: { supported: true },
    },
  };
  const snapshot = governProviderCatalog({ providerId: ProviderId.ANTHROPIC, rawModels: [raw], observedAt });
  assert.deepEqual(snapshot.discoveredModels[0].rawMetadata, raw);
  assert.equal(snapshot.validatedModels[0].lifecycle, ModelLifecycle.ACTIVE);
  assert.ok(snapshot.validatedModels[0].sources.every((source) => source.startsWith("https://")));
  assert.ok(snapshot.engineeringEligibleModels[0].capabilityAliases.includes(EngineeringModelAlias.MODEL_CAPABLE));
  assert.ok(snapshot.engineeringEligibleModels[0].capabilityAliases.includes(EngineeringModelAlias.MODEL_LONG_CONTEXT));
  assert.ok(snapshot.engineeringEligibleModels[0].allowedTaskClasses.includes("PROJECT_UNDERSTANDING"));
});

test("governance policy contains no exact emergency blacklist for audited IDs", () => {
  const source = [
    readFileSync(new URL("../src/config/model-governance-policy.js", import.meta.url), "utf8"),
    readFileSync(new URL("../src/domain/model-governance.js", import.meta.url), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /gpt-5\.2-pro/u);
  assert.doesNotMatch(source, /gemini-robotics-er-2-preview/u);
});

test("governance refresh replays three separate projections and routes only eligible manifests", () => {
  const directory = mkdtempSync(join(tmpdir(), "foundry-model-governance-"));
  try {
    const store = createAiRegistryStore({ registryDirectory: directory, clock: () => observedAt });
    store.append({
      eventId: "provider-openai",
      operation: AiRegistryOperation.PROVIDER_REGISTERED,
      occurredAt: observedAt,
      payload: {
        providerId: ProviderId.OPENAI,
        displayName: "OpenAI",
        version: "v1",
        enabled: true,
        rateLimits: { requestsPerMinute: null, tokensPerMinute: null },
        costMetadata: { currency: "USD", source: "official pricing" },
      },
    });
    const snapshot = governProviderCatalog({
      providerId: ProviderId.OPENAI,
      observedAt,
      rawModels: [{ id: "gpt-5.2-pro" }, { id: "gpt-5.6-luna" }],
    });
    const nonStableSnapshot = structuredClone(snapshot);
    nonStableSnapshot.validatedModels.find(
      (model) => model.modelId === "gpt-5.6-luna",
    ).registryState = ModelLifecycleState.ACTIVE_PREVIEW;
    assert.throws(
      () => store.append({
        eventId: "governance-openai-invalid-preview",
        operation: AiRegistryOperation.MODEL_GOVERNANCE_REFRESHED,
        occurredAt: observedAt,
        payload: {
          discoveryId: "catalog-openai-invalid-preview",
          providerId: ProviderId.OPENAI,
          ...nonStableSnapshot,
        },
      }),
      /not ACTIVE_STABLE and validated/u,
    );
    const legacySnapshot = structuredClone(snapshot);
    for (const model of legacySnapshot.discoveredModels) delete model.registryState;
    for (const model of legacySnapshot.validatedModels) delete model.registryState;
    store.append({
      eventId: "governance-openai-legacy",
      operation: AiRegistryOperation.MODEL_GOVERNANCE_REFRESHED,
      occurredAt: observedAt,
      payload: {
        discoveryId: "catalog-openai-legacy",
        providerId: ProviderId.OPENAI,
        ...legacySnapshot,
      },
    });
    assert.equal(
      store.projection().models.get("gpt-5.6-luna").governance.validation.registryState,
      ModelLifecycleState.ACTIVE_STABLE,
    );
    store.append({
      eventId: "governance-openai-1",
      operation: AiRegistryOperation.MODEL_GOVERNANCE_REFRESHED,
      occurredAt: observedAt,
      payload: { discoveryId: "catalog-openai-1", providerId: ProviderId.OPENAI, ...snapshot },
    });
    const projection = store.projection();
    assert.equal(projection.discoveredModels.size, 2);
    assert.equal(projection.validatedModels.size, 2);
    assert.equal(projection.engineeringEligibleModels.size, 1);
    assert.deepEqual([...projection.models.keys()], ["gpt-5.6-luna"]);
    assert.equal(projection.models.get("gpt-5.6-luna").governance.validation.validationStatus, "VALIDATED");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
