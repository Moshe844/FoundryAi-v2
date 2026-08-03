import {
  MODEL_FAMILY_GOVERNANCE_POLICY,
  ModelFamilyDefaultEligibility,
  ModelLifecycleState,
  ProviderId,
  governProviderCatalog,
  resolveModelFamilyGovernance,
} from "../src/index.js";

const observedAt = "2026-08-02T15:00:00.000Z";
const specialized = [
  "gemini-robotics-er-2-preview",
  "text-embedding-004",
  "imagen-4.0-generate",
  "veo-3.0-generate",
  "lyria-2-music",
  "gemini-tts-preview",
  "gemini-deep-research-preview",
  "gemini-computer-use-preview",
];

const snapshot = governProviderCatalog({
  providerId: ProviderId.GOOGLE_GEMINI,
  observedAt,
  rawModels: [
    ...specialized.map((modelId) => ({
      name: `models/${modelId}`,
      supportedGenerationMethods: ["generateContent"],
    })),
    {
      name: "models/gemini-3.5-flash",
      supportedGenerationMethods: ["generateContent"],
      thinking: true,
    },
  ],
});

const denied = snapshot.validatedModels.filter((model) =>
  specialized.includes(model.modelId),
);
const unknown = resolveModelFamilyGovernance({
  providerId: ProviderId.OPENAI,
  modelId: "unclassified-provider-model",
  raw: { id: "unclassified-provider-model" },
});

const checks = {
  everyProviderHasRules:
    Object.keys(MODEL_FAMILY_GOVERNANCE_POLICY.providers).length ===
    Object.values(ProviderId).length,
  specializedModelsDenied:
    denied.length === specialized.length &&
    denied.every((model) =>
      model.familyDefaultEligibility === ModelFamilyDefaultEligibility.DENIED &&
      model.registryState === ModelLifecycleState.QUARANTINED &&
      model.familyAllowedTaskClasses.length === 0,
    ),
  generalEngineeringModelEligible:
    snapshot.engineeringEligibleModels.length === 1 &&
    snapshot.engineeringEligibleModels[0].modelId === "gemini-3.5-flash",
  unknownFamiliesFailClosed:
    unknown.defaultEligibility === ModelFamilyDefaultEligibility.DENIED &&
    unknown.allowedTaskClasses.length === 0,
};

if (Object.values(checks).some((passed) => !passed)) {
  throw new Error(`Phase 8 evaluation failed: ${JSON.stringify(checks)}`);
}

console.log(JSON.stringify({
  phase: 8,
  policyVersion: MODEL_FAMILY_GOVERNANCE_POLICY.policyVersion,
  checks,
  excludedFamilies: MODEL_FAMILY_GOVERNANCE_POLICY.excludedFamilies.map(
    (rule) => ({
      ruleId: rule.ruleId,
      family: rule.family,
      defaultEligibility: rule.defaultEligibility,
      allowedTaskClasses: rule.allowedTaskClasses,
    }),
  ),
  validatedSpecializedModels: denied.map((model) => ({
    modelId: model.modelId,
    family: model.family,
    source: model.familyClassificationSource,
    state: model.registryState,
    reason: model.familyReason,
  })),
  eligibleModels: snapshot.engineeringEligibleModels.map((model) => ({
    modelId: model.modelId,
    family: model.family,
    ruleId: model.familyRuleId,
    taskClasses: model.allowedTaskClasses,
  })),
}, null, 2));
