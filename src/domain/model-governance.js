import {
  LatencyProfile,
  MODEL_CAPABILITIES,
  ModelCapability,
  ModelStatus,
  ProviderId,
  cloneAiValue,
} from "./ai-registry.js";
import {
  MODEL_FAMILY_GOVERNANCE_POLICY,
  MODEL_GOVERNANCE_POLICY,
  MODEL_GOVERNANCE_POLICY_VERSION,
  ModelFamilyDefaultEligibility,
} from "../config/model-governance-policy.js";

export const ModelPurpose = Object.freeze({
  GENERAL_REASONING: "GENERAL_REASONING",
  SOFTWARE_ENGINEERING: "SOFTWARE_ENGINEERING",
  CODING_AGENT: "CODING_AGENT",
  IMAGE_GENERATION: "IMAGE_GENERATION",
  VIDEO_GENERATION: "VIDEO_GENERATION",
  AUDIO: "AUDIO",
  EMBEDDINGS: "EMBEDDINGS",
  SPEECH: "SPEECH",
  MODERATION: "MODERATION",
  SEARCH: "SEARCH",
  ROBOTICS: "ROBOTICS",
  RESEARCH: "RESEARCH",
  COMPUTER_USE: "COMPUTER_USE",
  REALTIME: "REALTIME",
  UNKNOWN: "UNKNOWN",
});

export const ModelLifecycle = Object.freeze({
  ACTIVE: "ACTIVE",
  DEPRECATED: "DEPRECATED",
  SHUTDOWN: "SHUTDOWN",
  UNKNOWN: "UNKNOWN",
});

export const ModelLifecycleState = Object.freeze({
  DISCOVERED: "DISCOVERED",
  VALIDATING: "VALIDATING",
  ACTIVE_STABLE: "ACTIVE_STABLE",
  ACTIVE_PREVIEW: "ACTIVE_PREVIEW",
  EXPERIMENTAL: "EXPERIMENTAL",
  DEPRECATED: "DEPRECATED",
  SHUTDOWN: "SHUTDOWN",
  INACCESSIBLE: "INACCESSIBLE",
  UNVERIFIED: "UNVERIFIED",
  QUARANTINED: "QUARANTINED",
});

export const ModelReleaseChannel = Object.freeze({
  STABLE: "STABLE",
  SNAPSHOT: "SNAPSHOT",
  PREVIEW: "PREVIEW",
  EXPERIMENTAL: "EXPERIMENTAL",
  MOVING_ALIAS: "MOVING_ALIAS",
  UNKNOWN: "UNKNOWN",
});

export const EngineeringModelAlias = Object.freeze({
  MODEL_FAST: "MODEL_FAST",
  MODEL_BALANCED: "MODEL_BALANCED",
  MODEL_CAPABLE: "MODEL_CAPABLE",
  MODEL_CODE_SPECIALIST: "MODEL_CODE_SPECIALIST",
  MODEL_LONG_CONTEXT: "MODEL_LONG_CONTEXT",
});

function normalizedId(providerId, raw) {
  const value = providerId === ProviderId.GOOGLE_GEMINI
    ? raw.name ?? raw.baseModelId
    : raw.id;
  return String(value ?? "").replace(/^models\//u, "");
}

function releaseChannel(modelId, raw) {
  const text = `${modelId} ${raw.stage ?? ""} ${raw.lifecycleStage ?? ""}`.toLowerCase();
  if (/experimental|exp-/u.test(text)) return ModelReleaseChannel.EXPERIMENTAL;
  if (/preview/u.test(text)) return ModelReleaseChannel.PREVIEW;
  if (/(?:^|-)latest(?:$|-)/u.test(modelId)) return ModelReleaseChannel.MOVING_ALIAS;
  if (/\d{4}-\d{2}-\d{2}|\d{8}$/u.test(modelId)) return ModelReleaseChannel.SNAPSHOT;
  return ModelReleaseChannel.STABLE;
}

function ruleMatches(values, patterns) {
  return patterns.some((pattern) => {
    const matcher = new RegExp(pattern, "iu");
    return values.some((value) => matcher.test(value));
  });
}

function providerMetadataValues(raw) {
  return [
    raw.description,
    raw.purpose,
    raw.modelPurpose,
    ...(Array.isArray(raw.supportedTasks) ? raw.supportedTasks : []),
    ...(Array.isArray(raw.supported_tasks) ? raw.supported_tasks : []),
  ]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((value) => value.toLowerCase());
}

function metadataValue(raw, path) {
  return path.split(".").reduce(
    (value, key) => value !== null && typeof value === "object" ? value[key] : undefined,
    raw,
  );
}

function metadataRequirementMatches(raw, requirement) {
  const value = metadataValue(raw, requirement.path);
  if (Object.hasOwn(requirement, "equals")) return value === requirement.equals;
  if (Object.hasOwn(requirement, "includes")) {
    return Array.isArray(value) && value.includes(requirement.includes);
  }
  return false;
}

function metadataConditionMatches(raw, condition) {
  const all = condition.all ?? [];
  const any = condition.any ?? [];
  return all.every((requirement) => metadataRequirementMatches(raw, requirement)) &&
    (any.length === 0 || any.some((requirement) => metadataRequirementMatches(raw, requirement)));
}

function familyDecision(rule, classificationSource) {
  return cloneAiValue({
    ruleId: rule.ruleId,
    family: rule.family,
    purpose: rule.purpose,
    defaultEligibility: rule.defaultEligibility,
    allowedTaskClasses: rule.allowedTaskClasses,
    classificationSource,
    reason: rule.reason,
    policyVersion: MODEL_FAMILY_GOVERNANCE_POLICY.policyVersion,
  });
}

export function resolveModelFamilyGovernance({ providerId, modelId, raw = {} }) {
  const metadataValues = providerMetadataValues(raw);
  for (const rule of MODEL_FAMILY_GOVERNANCE_POLICY.excludedFamilies) {
    if (ruleMatches(metadataValues, rule.metadataPatterns)) {
      return familyDecision(rule, "PROVIDER_METADATA");
    }
  }
  for (const rule of MODEL_FAMILY_GOVERNANCE_POLICY.excludedFamilies) {
    if (ruleMatches([modelId], rule.idPatterns)) {
      return familyDecision(rule, "MAINTAINED_FAMILY_RULE");
    }
  }
  for (const rule of MODEL_FAMILY_GOVERNANCE_POLICY.providers[providerId] ?? []) {
    if (ruleMatches(metadataValues, rule.metadataPatterns)) {
      return familyDecision(rule, "PROVIDER_METADATA");
    }
    if (rule.metadataConditions.some((condition) => metadataConditionMatches(raw, condition))) {
      return familyDecision(rule, "PROVIDER_CAPABILITY_METADATA");
    }
    if (ruleMatches([modelId], rule.idPatterns)) {
      return familyDecision(rule, "MAINTAINED_FAMILY_RULE");
    }
  }
  return familyDecision(
    MODEL_FAMILY_GOVERNANCE_POLICY.unknownFamily,
    "FAIL_CLOSED_DEFAULT",
  );
}

function familyPolicy(providerId, modelId) {
  return MODEL_GOVERNANCE_POLICY.providers[providerId]?.engineeringFamilies.find(
    (family) => new RegExp(family.pattern, "u").test(modelId),
  ) ?? null;
}

function providerLifecycleFor(policy, modelId, raw, lifecycleEvidence) {
  const officialNotice = lifecycleEvidence?.notices?.find(
    (notice) => notice.modelId === modelId,
  );
  if (officialNotice?.lifecycle === "SHUTDOWN") return ModelLifecycle.SHUTDOWN;
  if (officialNotice?.lifecycle === "DEPRECATED") return ModelLifecycle.DEPRECATED;
  if (officialNotice?.lifecycle === "ACTIVE") return ModelLifecycle.ACTIVE;
  const matches = (patterns) => patterns?.some(
    (pattern) => new RegExp(pattern, "u").test(modelId),
  ) === true;
  if (matches(policy?.retiredModelPatterns)) return ModelLifecycle.SHUTDOWN;
  if (matches(policy?.deprecatedModelPatterns)) return ModelLifecycle.DEPRECATED;
  const lifecycleText = String(raw.stage ?? raw.lifecycleStage ?? "").toUpperCase();
  if (lifecycleText === "RETIRED" || lifecycleText === "SHUTDOWN") {
    return ModelLifecycle.SHUTDOWN;
  }
  if (lifecycleText === "DEPRECATED" || lifecycleText === "LEGACY") {
    return ModelLifecycle.DEPRECATED;
  }
  return ModelLifecycle.ACTIVE;
}

function registryStateFor({
  accountAccessible,
  capabilities,
  channel,
  engineeringFamily,
  familyGovernance,
  lifecycle,
}) {
  if (!accountAccessible) return ModelLifecycleState.INACCESSIBLE;
  if (lifecycle === ModelLifecycle.SHUTDOWN) return ModelLifecycleState.SHUTDOWN;
  if (lifecycle === ModelLifecycle.DEPRECATED) return ModelLifecycleState.DEPRECATED;
  if (lifecycle === ModelLifecycle.UNKNOWN) return ModelLifecycleState.UNVERIFIED;
  if (
    familyGovernance.defaultEligibility !== ModelFamilyDefaultEligibility.CONDITIONAL ||
    !capabilities.endpointCompatible
  ) {
    return ModelLifecycleState.QUARANTINED;
  }
  if (channel === ModelReleaseChannel.EXPERIMENTAL) {
    return ModelLifecycleState.EXPERIMENTAL;
  }
  if (channel === ModelReleaseChannel.PREVIEW) {
    return ModelLifecycleState.ACTIVE_PREVIEW;
  }
  if (channel === ModelReleaseChannel.MOVING_ALIAS || engineeringFamily === null) {
    return ModelLifecycleState.UNVERIFIED;
  }
  if (channel === ModelReleaseChannel.STABLE || channel === ModelReleaseChannel.SNAPSHOT) {
    return ModelLifecycleState.ACTIVE_STABLE;
  }
  return ModelLifecycleState.UNVERIFIED;
}

function providerCapabilities(providerId, raw) {
  if (providerId === ProviderId.ANTHROPIC) {
    return {
      structuredOutput: raw.capabilities?.structured_outputs?.supported === true,
      reasoning: raw.capabilities?.thinking?.supported === true,
      vision: raw.capabilities?.image_input?.supported === true,
      streaming: true,
      endpointCompatible: true,
    };
  }
  if (providerId === ProviderId.GOOGLE_GEMINI) {
    const methods = raw.supportedGenerationMethods ?? raw.supportedActions ?? [];
    return {
      structuredOutput: methods.includes("generateContent"),
      reasoning: raw.thinking === true || raw.thinking?.supported === true,
      vision: Array.isArray(raw.inputModalities) && raw.inputModalities.includes("IMAGE"),
      streaming: methods.includes("streamGenerateContent") || methods.includes("generateContent"),
      endpointCompatible: methods.includes("generateContent"),
    };
  }
  return {
    structuredOutput: true,
    reasoning: true,
    vision: true,
    streaming: true,
    endpointCompatible: true,
  };
}

function scores(quality, capabilities, contextWindow) {
  const values = Object.fromEntries(MODEL_CAPABILITIES.map((capability) => [capability, 0]));
  for (const capability of [
    ModelCapability.SOFTWARE_ENGINEERING,
    ModelCapability.CODE_GENERATION,
    ModelCapability.CODE_REPAIR,
  ]) values[capability] = quality;
  for (const capability of [ModelCapability.CODING, ModelCapability.ARCHITECTURE, ModelCapability.PLANNING, ModelCapability.DEBUGGING]) values[capability] = quality;
  values[ModelCapability.REASONING] = capabilities.reasoning ? quality : 0;
  values[ModelCapability.STRUCTURED_OUTPUT] = capabilities.structuredOutput ? quality : 0;
  values[ModelCapability.VISION] = capabilities.vision ? Math.min(quality, 85) : 0;
  values[ModelCapability.FAST_RESPONSE] = quality >= 90 ? 70 : 90;
  values[ModelCapability.LOW_COST] = 50;
  values[ModelCapability.LARGE_CONTEXT] = contextWindow >= 100_000 ? quality : 0;
  return values;
}

function capabilitySupport({
  capabilities,
  contextWindow,
  family,
  policy,
  purpose,
}) {
  const supported = new Set([
    ModelCapability.SOFTWARE_ENGINEERING,
    ModelCapability.CODE_GENERATION,
    ModelCapability.CODE_REPAIR,
    ModelCapability.CODING,
    ModelCapability.ARCHITECTURE,
    ModelCapability.PLANNING,
    ModelCapability.DEBUGGING,
  ]);
  if (capabilities.structuredOutput) supported.add(ModelCapability.STRUCTURED_OUTPUT);
  if (capabilities.reasoning) supported.add(ModelCapability.REASONING);
  if (capabilities.vision) supported.add(ModelCapability.VISION);
  if (contextWindow >= 100_000) supported.add(ModelCapability.LARGE_CONTEXT);
  if (family.latencyProfile === LatencyProfile.FAST) supported.add(ModelCapability.FAST_RESPONSE);
  if (
    Number.isFinite(family.inputPerMillionTokensUsd) &&
    Number.isFinite(family.outputPerMillionTokensUsd) &&
    family.inputPerMillionTokensUsd + family.outputPerMillionTokensUsd <= 10
  ) supported.add(ModelCapability.LOW_COST);
  return [...supported].sort().map((capability) => ({
    capability,
    support: "SUPPORTED",
    evidence: [
      `validated model purpose ${purpose}`,
      `matched engineering family policy ${MODEL_GOVERNANCE_POLICY_VERSION}`,
      policy.catalogSource,
    ],
  }));
}

function aliases(family, contextWindow) {
  const result = [EngineeringModelAlias.MODEL_BALANCED, EngineeringModelAlias.MODEL_CODE_SPECIALIST];
  if (family.latencyProfile === LatencyProfile.FAST) result.push(EngineeringModelAlias.MODEL_FAST);
  if (family.quality >= 94) result.push(EngineeringModelAlias.MODEL_CAPABLE);
  if (contextWindow >= 100_000) result.push(EngineeringModelAlias.MODEL_LONG_CONTEXT);
  return result.sort();
}

export function governProviderCatalog({
  providerId,
  rawModels,
  observedAt = new Date().toISOString(),
  lifecycleEvidence = null,
}) {
  const policy = MODEL_GOVERNANCE_POLICY.providers[providerId];
  const discoveredModels = [];
  const validatedModels = [];
  const engineeringEligibleModels = [];
  for (const raw of rawModels) {
    const modelId = normalizedId(providerId, raw);
    if (modelId === "") continue;
    const displayName = String(raw.displayName ?? raw.display_name ?? modelId);
    const familyGovernance = resolveModelFamilyGovernance({ providerId, modelId, raw });
    const purpose = familyGovernance.purpose;
    const channel = releaseChannel(modelId, raw);
    const lifecycle = providerLifecycleFor(policy, modelId, raw, lifecycleEvidence);
    const lifecycleNotice = lifecycleEvidence?.notices?.find(
      (notice) => notice.modelId === modelId,
    ) ?? null;
    const capabilities = providerCapabilities(providerId, raw);
    const family = familyPolicy(providerId, modelId);
    const accountAccessible = raw.accountAccessible !== false && raw.accessible !== false;
    const registryState = registryStateFor({
      accountAccessible,
      capabilities,
      channel,
      engineeringFamily: family,
      familyGovernance,
      lifecycle,
    });
    const validationReasons = [];
    if (purpose === ModelPurpose.UNKNOWN) validationReasons.push("purpose is unknown");
    if (lifecycle !== ModelLifecycle.ACTIVE) validationReasons.push(`lifecycle is ${lifecycle}`);
    if (channel === ModelReleaseChannel.PREVIEW || channel === ModelReleaseChannel.EXPERIMENTAL || channel === ModelReleaseChannel.MOVING_ALIAS) validationReasons.push(`release channel is ${channel}`);
    if (!accountAccessible) validationReasons.push("model is inaccessible to the configured account");
    if (familyGovernance.defaultEligibility !== ModelFamilyDefaultEligibility.CONDITIONAL) {
      validationReasons.push(`family ${familyGovernance.family} is denied by default: ${familyGovernance.reason}`);
    }
    if (!capabilities.endpointCompatible) validationReasons.push("required structured generation endpoint is unsupported");
    if (family === null) validationReasons.push("no current engineering family policy matches");
    const validated = registryState === ModelLifecycleState.ACTIVE_STABLE && validationReasons.length === 0;
    const contextWindow = Math.max(1, raw.max_input_tokens ?? raw.inputTokenLimit ?? family?.contextWindow ?? 1);
    discoveredModels.push({
      providerId, modelId, displayName,
      sourceEndpoint: policy.catalogSource,
      observedAt,
      lastSeenAt: observedAt,
      missingSince: null,
      catalogPresence: "PRESENT",
      accountAccessible,
      registryState: ModelLifecycleState.DISCOVERED,
      rawMetadata: raw,
    });
    validatedModels.push({
      providerId, modelId, purpose, lifecycle, releaseChannel: channel,
      family: familyGovernance.family,
      familyRuleId: familyGovernance.ruleId,
      familyDefaultEligibility: familyGovernance.defaultEligibility,
      familyAllowedTaskClasses: familyGovernance.allowedTaskClasses,
      familyClassificationSource: familyGovernance.classificationSource,
      familyPolicyVersion: familyGovernance.policyVersion,
      familyReason: familyGovernance.reason,
      registryState,
      stateHistory: [
        ModelLifecycleState.DISCOVERED,
        ModelLifecycleState.VALIDATING,
        registryState,
      ],
      endpointCompatibility: capabilities,
      validationStatus: validated ? "VALIDATED" : registryState,
      validationReasons,
      catalogObservedAt: observedAt,
      maximumCatalogAgeMs: MODEL_GOVERNANCE_POLICY.maximumCatalogAgeMs,
      validatedAt: lifecycleEvidence?.fetchedAt ?? MODEL_GOVERNANCE_POLICY.documentationValidatedAt,
      maximumValidationAgeMs: MODEL_GOVERNANCE_POLICY.maximumValidationAgeMs,
      policyVersion: MODEL_GOVERNANCE_POLICY_VERSION,
      sources: [...new Set([
        ...policy.lifecycleSources,
        ...(lifecycleEvidence?.sourceUrl ? [lifecycleEvidence.sourceUrl] : []),
      ])],
      lifecycleSourceStatus: lifecycleEvidence?.status ?? "BUNDLED_POLICY",
      lifecycleSourceHash: lifecycleEvidence?.contentHash ?? null,
      deprecationDate: lifecycleNotice?.deprecationDate ?? null,
      shutdownDate: lifecycleNotice?.shutdownDate ?? null,
    });
    if (!validated) continue;
    const quality = family.quality;
    const costKnown = Number.isFinite(family.inputPerMillionTokensUsd) && Number.isFinite(family.outputPerMillionTokensUsd);
    const supportedCapabilities = capabilitySupport({
      capabilities,
      contextWindow,
      family,
      policy,
      purpose,
    });
    engineeringEligibleModels.push({
      providerId, modelId,
      family: familyGovernance.family,
      familyRuleId: familyGovernance.ruleId,
      familyPolicyVersion: familyGovernance.policyVersion,
      allowedTaskClasses: familyGovernance.allowedTaskClasses,
      capabilityAliases: aliases(family, contextWindow),
      capabilitySupport: supportedCapabilities,
      eligibilityReasons: [
        `purpose ${purpose} is approved for engineering`,
        `family ${familyGovernance.family} is conditionally eligible under centralized rule ${familyGovernance.ruleId}`,
        `provider lifecycle ${lifecycle} is active`,
        `lifecycle state ${registryState} is eligible for Auto routing`,
        `release channel ${channel} is pinned or stable`,
        "provider endpoint metadata is compatible",
        `provider catalog observed at ${observedAt}`,
        `lifecycle evidence ${lifecycleEvidence?.status ?? "BUNDLED_POLICY"} validated at ${lifecycleEvidence?.fetchedAt ?? MODEL_GOVERNANCE_POLICY.documentationValidatedAt}`,
        `family policy ${MODEL_GOVERNANCE_POLICY_VERSION} matched`,
      ],
      manifest: {
        modelId, providerId, displayName,
        status: ModelStatus.AVAILABLE,
        enabled: true,
        contextWindow,
        supportsVision: capabilities.vision,
        supportsToolCalling: false,
        supportsStructuredOutput: capabilities.structuredOutput,
        supportsReasoning: capabilities.reasoning,
        supportsStreaming: capabilities.streaming,
        latencyProfile: family.latencyProfile,
        costProfile: {
          inputPerMillionTokensUsd: costKnown ? family.inputPerMillionTokensUsd : 0,
          outputPerMillionTokensUsd: costKnown ? family.outputPerMillionTokensUsd : 0,
        },
        capabilities: scores(quality, capabilities, contextWindow),
      },
      pricing: {
        known: costKnown,
        source: costKnown ? policy.lifecycleSources.at(-1) : null,
        observedAt,
      },
    });
  }
  return cloneAiValue({ discoveredModels, validatedModels, engineeringEligibleModels });
}
