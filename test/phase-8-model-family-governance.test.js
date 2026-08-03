import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MODEL_FAMILY_GOVERNANCE_POLICY,
  MODEL_GOVERNANCE_POLICY,
  ModelFamilyDefaultEligibility,
  ModelLifecycleState,
  ModelPurpose,
  ModelTaskClass,
  ProviderId,
  createLiveAiAdapters,
  governProviderCatalog,
  resolveModelFamilyGovernance,
} from "../src/index.js";

const observedAt = "2026-08-02T15:00:00.000Z";

function gemini(name, extra = {}) {
  return {
    name: `models/${name}`,
    supportedGenerationMethods: ["generateContent"],
    thinking: true,
    ...extra,
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("Phase 8 exposes one immutable family policy for every production provider", () => {
  assert.equal(
    MODEL_GOVERNANCE_POLICY.familyGovernance,
    MODEL_FAMILY_GOVERNANCE_POLICY,
  );
  assert.deepEqual(
    Object.keys(MODEL_FAMILY_GOVERNANCE_POLICY.providers).sort(),
    Object.values(ProviderId).sort(),
  );
  const rules = [
    ...MODEL_FAMILY_GOVERNANCE_POLICY.excludedFamilies,
    ...Object.values(MODEL_FAMILY_GOVERNANCE_POLICY.providers).flat(),
  ];
  assert.equal(new Set(rules.map((rule) => rule.ruleId)).size, rules.length);
  for (const rule of MODEL_FAMILY_GOVERNANCE_POLICY.excludedFamilies) {
    assert.equal(rule.defaultEligibility, ModelFamilyDefaultEligibility.DENIED);
    assert.deepEqual(rule.allowedTaskClasses, []);
    assert.notEqual(rule.reason.trim(), "");
  }
});

test("maintained deny rules beat broad provider-family rules", () => {
  const cases = [
    ["gemini-robotics-er-2-preview", "robotics", ModelPurpose.ROBOTICS],
    ["text-embedding-004", "embedding", ModelPurpose.EMBEDDINGS],
    ["imagen-4.0-generate", "image-generation", ModelPurpose.IMAGE_GENERATION],
    ["veo-3.0-generate", "video-generation", ModelPurpose.VIDEO_GENERATION],
    ["lyria-2-music", "audio-music", ModelPurpose.AUDIO],
    ["gemini-tts-preview", "speech", ModelPurpose.SPEECH],
    ["gemini-deep-research-preview", "deep-research", ModelPurpose.RESEARCH],
    ["gemini-computer-use-preview", "computer-use", ModelPurpose.COMPUTER_USE],
  ];
  const snapshot = governProviderCatalog({
    providerId: ProviderId.GOOGLE_GEMINI,
    observedAt,
    rawModels: cases.map(([modelId]) => gemini(modelId)),
  });
  assert.equal(snapshot.engineeringEligibleModels.length, 0);
  for (const [modelId, family, purpose] of cases) {
    const validation = snapshot.validatedModels.find((model) => model.modelId === modelId);
    assert.equal(validation.family, family);
    assert.equal(validation.purpose, purpose);
    assert.equal(validation.familyDefaultEligibility, ModelFamilyDefaultEligibility.DENIED);
    assert.deepEqual(validation.familyAllowedTaskClasses, []);
    assert.equal(validation.registryState, ModelLifecycleState.QUARANTINED);
    assert.match(validation.validationReasons.join(" "), /denied by default/u);
  }
});

test("authoritative provider metadata overrides a general-looking model ID", () => {
  for (const [providerId, modelId, raw] of [
    [ProviderId.OPENAI, "gpt-5.6-sol", { id: "gpt-5.6-sol", description: "Physical world robotics control model" }],
    [ProviderId.ANTHROPIC, "claude-sonnet-5", {
      id: "claude-sonnet-5",
      description: "Image generation model",
      capabilities: {
        structured_outputs: { supported: true },
        thinking: { supported: true },
      },
    }],
    [ProviderId.GOOGLE_GEMINI, "gemini-3.5-flash", gemini("gemini-3.5-flash", { description: "Deep research agent" })],
  ]) {
    const decision = resolveModelFamilyGovernance({ providerId, modelId, raw });
    assert.equal(decision.defaultEligibility, ModelFamilyDefaultEligibility.DENIED);
    assert.equal(decision.classificationSource, "PROVIDER_METADATA");
    const snapshot = governProviderCatalog({ providerId, observedAt, rawModels: [raw] });
    assert.equal(snapshot.engineeringEligibleModels.length, 0);
    assert.equal(snapshot.validatedModels[0].registryState, ModelLifecycleState.QUARANTINED);
  }
});

test("unknown families fail closed while validated general families retain explicit task scope", () => {
  const unknown = resolveModelFamilyGovernance({
    providerId: ProviderId.OPENAI,
    modelId: "unclassified-provider-model",
    raw: { id: "unclassified-provider-model" },
  });
  assert.equal(unknown.family, "unknown-specialized");
  assert.equal(unknown.defaultEligibility, ModelFamilyDefaultEligibility.DENIED);
  assert.deepEqual(unknown.allowedTaskClasses, []);
  assert.equal(unknown.classificationSource, "FAIL_CLOSED_DEFAULT");

  const eligible = [
    [ProviderId.OPENAI, { id: "gpt-5.6-luna" }, "openai-general-reasoning"],
    [ProviderId.ANTHROPIC, {
      id: "claude-sonnet-5",
      capabilities: {
        structured_outputs: { supported: true },
        thinking: { supported: true },
      },
    }, "anthropic-general-coding"],
    [ProviderId.GOOGLE_GEMINI, gemini("gemini-3.5-flash"), "google-general-reasoning"],
  ];
  for (const [providerId, raw, family] of eligible) {
    const snapshot = governProviderCatalog({ providerId, observedAt, rawModels: [raw] });
    assert.equal(snapshot.engineeringEligibleModels.length, 1);
    assert.equal(snapshot.engineeringEligibleModels[0].family, family);
    assert.deepEqual(
      [...snapshot.engineeringEligibleModels[0].allowedTaskClasses].sort(),
      Object.values(ModelTaskClass).sort(),
    );
  }
});

test("legacy discovery manifests use the same family deny policy", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => jsonResponse({
    models: [
      gemini("gemini-future-general"),
      gemini("gemini-robotics-er-99-preview"),
      gemini("text-embedding-future"),
    ],
  });
  const adapters = createLiveAiAdapters({ environment: {} });
  const manifests = await adapters.discoveryAdapters[
    ProviderId.GOOGLE_GEMINI
  ].discoverModels({ credential: "not-persisted" });
  assert.deepEqual(manifests.map((manifest) => manifest.modelId), [
    "gemini-future-general",
  ]);
});

test("specialized family patterns exist only in the authoritative policy module", () => {
  const domainSource = readFileSync(
    new URL("../src/domain/model-governance.js", import.meta.url),
    "utf8",
  );
  const adapterSource = readFileSync(
    new URL("../src/capability-plane/live-ai-adapters.js", import.meta.url),
    "utf8",
  );
  for (const scatteredPattern of [
    /gemini-robotics/u,
    /gpt-image/u,
    /deep-research/u,
    /text-to-speech/u,
    /computer-use/u,
  ]) {
    assert.doesNotMatch(domainSource, scatteredPattern);
    assert.doesNotMatch(adapterSource, scatteredPattern);
  }
});
