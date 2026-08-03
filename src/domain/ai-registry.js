import { createHash } from "node:crypto";

import {
  ModelGatewayValidationError,
  ModelOutputValidationError,
} from "./errors.js";

export const AI_REGISTRY_SCHEMA_VERSION = 1;

export const ProviderId = Object.freeze({
  OPENAI: "openai",
  ANTHROPIC: "anthropic",
  GOOGLE_GEMINI: "google-gemini",
});

export const SUPPORTED_PROVIDER_IDS = Object.freeze(
  Object.values(ProviderId),
);

export const ProviderHealth = Object.freeze({
  UNKNOWN: "UNKNOWN",
  HEALTHY: "HEALTHY",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
});

export const ModelStatus = Object.freeze({
  AVAILABLE: "AVAILABLE",
  DEGRADED: "DEGRADED",
  UNAVAILABLE: "UNAVAILABLE",
  DEPRECATED: "DEPRECATED",
});

export const ModelCapability = Object.freeze({
  SOFTWARE_ENGINEERING: "SOFTWARE_ENGINEERING",
  CODE_GENERATION: "CODE_GENERATION",
  CODE_REPAIR: "CODE_REPAIR",
  REASONING: "REASONING",
  CODING: "CODING",
  ARCHITECTURE: "ARCHITECTURE",
  PLANNING: "PLANNING",
  DEBUGGING: "DEBUGGING",
  LARGE_CONTEXT: "LARGE_CONTEXT",
  VISION: "VISION",
  TOOL_CALLING: "TOOL_CALLING",
  STRUCTURED_OUTPUT: "STRUCTURED_OUTPUT",
  FAST_RESPONSE: "FAST_RESPONSE",
  LOW_COST: "LOW_COST",
  LONG_RUNNING: "LONG_RUNNING",
});

export const MODEL_CAPABILITIES = Object.freeze(
  Object.values(ModelCapability),
);

const REPLAY_DEFAULT_UNSUPPORTED_CAPABILITIES = Object.freeze([
  ModelCapability.SOFTWARE_ENGINEERING,
  ModelCapability.CODE_GENERATION,
  ModelCapability.CODE_REPAIR,
]);

export const TaskDepth = Object.freeze({
  MECHANICAL: 1,
  STANDARD_CODING: 2,
  MULTI_FILE_ENGINEERING: 3,
  ARCHITECTURE: 4,
  EXCEPTIONAL_REASONING: 5,
});

export const TaskKind = Object.freeze({
  RENAME: "RENAME",
  IMPORT_FIX: "IMPORT_FIX",
  FORMAT: "FORMAT",
  COMPILE_ERROR: "COMPILE_ERROR",
  SMALL_FEATURE: "SMALL_FEATURE",
  MULTI_FILE_CHANGE: "MULTI_FILE_CHANGE",
  RUNTIME_BUG: "RUNTIME_BUG",
  DATABASE_WORK: "DATABASE_WORK",
  CROSS_MODULE_REDESIGN: "CROSS_MODULE_REDESIGN",
  LARGE_REFACTOR: "LARGE_REFACTOR",
  MAJOR_DESIGN: "MAJOR_DESIGN",
  LARGE_MIGRATION: "LARGE_MIGRATION",
});

export const RegistryOperation = Object.freeze({
  PROVIDER_REGISTERED: "PROVIDER_REGISTERED",
  PROVIDER_ENABLED_CHANGED: "PROVIDER_ENABLED_CHANGED",
  PROVIDER_HEALTH_RECORDED: "PROVIDER_HEALTH_RECORDED",
  MODELS_DISCOVERED: "MODELS_DISCOVERED",
  MODEL_CATALOG_REFRESHED: "MODEL_CATALOG_REFRESHED",
  MODEL_GOVERNANCE_REFRESHED: "MODEL_GOVERNANCE_REFRESHED",
});

export const LatencyProfile = Object.freeze({
  FAST: "FAST",
  BALANCED: "BALANCED",
  THOROUGH: "THOROUGH",
});

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,191})$/;
const providerHealthSet = new Set(Object.values(ProviderHealth));
const modelStatusSet = new Set(Object.values(ModelStatus));
const latencyProfileSet = new Set(Object.values(LatencyProfile));

export function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function canonicalizeAiValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeAiValue(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeAiValue(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function freezeAiValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      freezeAiValue(item);
    }
    return Object.freeze(value);
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) {
      freezeAiValue(item);
    }
    return Object.freeze(value);
  }
  return value;
}

export function cloneAiValue(value) {
  return freezeAiValue(JSON.parse(canonicalizeAiValue(value)));
}

export function hashAiValue(value) {
  return createHash("sha256").update(canonicalizeAiValue(value)).digest("hex");
}

export function assertAiIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new ModelGatewayValidationError(
      `${label} must be a non-empty portable identifier.`,
    );
  }
  return value;
}

function exactKeys(value, keys) {
  return (
    isPlainObject(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function nonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ModelGatewayValidationError(
      `${label} must be a finite non-negative number.`,
    );
  }
  return value;
}

function nullablePositiveInteger(value, label) {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) || value < 1)
  ) {
    throw new ModelGatewayValidationError(
      `${label} must be null or a positive integer.`,
    );
  }
  return value;
}

export function normalizeProviderMetadata(input) {
  const keys = [
    "providerId",
    "displayName",
    "version",
    "enabled",
    "rateLimits",
    "costMetadata",
  ];
  if (!exactKeys(input, keys)) {
    throw new ModelGatewayValidationError(
      `Provider metadata must contain exactly: ${keys.join(", ")}.`,
    );
  }
  assertAiIdentifier(input.providerId, "providerId");
  if (!SUPPORTED_PROVIDER_IDS.includes(input.providerId)) {
    throw new ModelGatewayValidationError(
      `Provider "${input.providerId}" is not supported by Milestone 9A.`,
    );
  }
  for (const [label, value] of [
    ["displayName", input.displayName],
    ["version", input.version],
  ]) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ModelGatewayValidationError(
        `Provider ${label} must be non-empty.`,
      );
    }
  }
  if (typeof input.enabled !== "boolean") {
    throw new ModelGatewayValidationError(
      "Provider enabled must be boolean.",
    );
  }
  if (
    !exactKeys(input.rateLimits, [
      "requestsPerMinute",
      "tokensPerMinute",
    ])
  ) {
    throw new ModelGatewayValidationError(
      "Provider rateLimits must define requestsPerMinute and tokensPerMinute.",
    );
  }
  nullablePositiveInteger(
    input.rateLimits.requestsPerMinute,
    "requestsPerMinute",
  );
  nullablePositiveInteger(
    input.rateLimits.tokensPerMinute,
    "tokensPerMinute",
  );
  if (
    !exactKeys(input.costMetadata, ["currency", "source"]) ||
    input.costMetadata.currency !== "USD" ||
    typeof input.costMetadata.source !== "string" ||
    input.costMetadata.source.trim() === ""
  ) {
    throw new ModelGatewayValidationError(
      "Provider costMetadata must declare USD and a non-empty source.",
    );
  }
  return cloneAiValue({
    providerId: input.providerId,
    displayName: input.displayName.trim(),
    version: input.version.trim(),
    enabled: input.enabled,
    rateLimits: input.rateLimits,
    costMetadata: {
      currency: "USD",
      source: input.costMetadata.source.trim(),
    },
  });
}

export function normalizeCapabilityScores(input) {
  const suppliedKeys = isPlainObject(input) ? Object.keys(input) : [];
  const missingKeys = MODEL_CAPABILITIES.filter(
    (capability) => !suppliedKeys.includes(capability),
  );
  const unexpectedKeys = suppliedKeys.filter(
    (capability) => !MODEL_CAPABILITIES.includes(capability),
  );
  if (
    !isPlainObject(input) ||
    unexpectedKeys.length > 0 ||
    missingKeys.some(
      (capability) =>
        !REPLAY_DEFAULT_UNSUPPORTED_CAPABILITIES.includes(capability),
    )
  ) {
    throw new ModelGatewayValidationError(
      "Model capability scores must define every registered capability.",
    );
  }
  const scores = {};
  for (const capability of MODEL_CAPABILITIES) {
    const score = input[capability] ?? 0;
    if (
      !Number.isSafeInteger(score) ||
      score < 0 ||
      score > 100
    ) {
      throw new ModelGatewayValidationError(
        `Capability ${capability} score must be an integer from 0 through 100.`,
      );
    }
    scores[capability] = score;
  }
  return cloneAiValue(scores);
}

export function normalizeModelManifest(input) {
  const keys = [
    "modelId",
    "providerId",
    "displayName",
    "status",
    "enabled",
    "contextWindow",
    "supportsVision",
    "supportsToolCalling",
    "supportsStructuredOutput",
    "supportsReasoning",
    "supportsStreaming",
    "latencyProfile",
    "costProfile",
    "capabilities",
  ];
  if (!exactKeys(input, keys)) {
    throw new ModelGatewayValidationError(
      `Model manifest must contain exactly: ${keys.join(", ")}.`,
    );
  }
  assertAiIdentifier(input.modelId, "modelId");
  assertAiIdentifier(input.providerId, "model providerId");
  if (!SUPPORTED_PROVIDER_IDS.includes(input.providerId)) {
    throw new ModelGatewayValidationError(
      `Model provider "${input.providerId}" is unsupported.`,
    );
  }
  if (
    typeof input.displayName !== "string" ||
    input.displayName.trim() === ""
  ) {
    throw new ModelGatewayValidationError(
      "Model displayName must be non-empty.",
    );
  }
  if (!modelStatusSet.has(input.status)) {
    throw new ModelGatewayValidationError("Model status is invalid.");
  }
  for (const key of [
    "enabled",
    "supportsVision",
    "supportsToolCalling",
    "supportsStructuredOutput",
    "supportsReasoning",
    "supportsStreaming",
  ]) {
    if (typeof input[key] !== "boolean") {
      throw new ModelGatewayValidationError(`Model ${key} must be boolean.`);
    }
  }
  if (
    !Number.isSafeInteger(input.contextWindow) ||
    input.contextWindow < 1
  ) {
    throw new ModelGatewayValidationError(
      "Model contextWindow must be a positive integer.",
    );
  }
  if (!latencyProfileSet.has(input.latencyProfile)) {
    throw new ModelGatewayValidationError(
      "Model latencyProfile is invalid.",
    );
  }
  if (
    !exactKeys(input.costProfile, [
      "inputPerMillionTokensUsd",
      "outputPerMillionTokensUsd",
    ])
  ) {
    throw new ModelGatewayValidationError(
      "Model costProfile must define input and output token rates.",
    );
  }
  nonNegativeNumber(
    input.costProfile.inputPerMillionTokensUsd,
    "Model input cost",
  );
  nonNegativeNumber(
    input.costProfile.outputPerMillionTokensUsd,
    "Model output cost",
  );
  const capabilities = normalizeCapabilityScores(input.capabilities);
  const capabilityFlags = [
    ["supportsVision", ModelCapability.VISION],
    ["supportsToolCalling", ModelCapability.TOOL_CALLING],
    ["supportsStructuredOutput", ModelCapability.STRUCTURED_OUTPUT],
    ["supportsReasoning", ModelCapability.REASONING],
  ];
  for (const [flag, capability] of capabilityFlags) {
    if (input[flag] !== (capabilities[capability] > 0)) {
      throw new ModelGatewayValidationError(
        `Model ${flag} must agree with its ${capability} capability score.`,
      );
    }
  }
  return cloneAiValue({
    ...input,
    displayName: input.displayName.trim(),
    costProfile: input.costProfile,
    capabilities,
  });
}

export function normalizeProviderHealth(input) {
  const keys = ["health", "detail"];
  if (!exactKeys(input, keys) || !providerHealthSet.has(input.health)) {
    throw new ModelGatewayValidationError(
      "Provider health record is invalid.",
    );
  }
  if (typeof input.detail !== "string" || input.detail.trim() === "") {
    throw new ModelGatewayValidationError(
      "Provider health detail must be non-empty.",
    );
  }
  return cloneAiValue({
    health: input.health,
    detail: input.detail.trim(),
  });
}

export function classifyTaskDepth(taskKind) {
  const mapping = Object.freeze({
    [TaskKind.RENAME]: TaskDepth.MECHANICAL,
    [TaskKind.IMPORT_FIX]: TaskDepth.MECHANICAL,
    [TaskKind.FORMAT]: TaskDepth.MECHANICAL,
    [TaskKind.COMPILE_ERROR]: TaskDepth.STANDARD_CODING,
    [TaskKind.SMALL_FEATURE]: TaskDepth.STANDARD_CODING,
    [TaskKind.MULTI_FILE_CHANGE]: TaskDepth.MULTI_FILE_ENGINEERING,
    [TaskKind.RUNTIME_BUG]: TaskDepth.MULTI_FILE_ENGINEERING,
    [TaskKind.DATABASE_WORK]: TaskDepth.MULTI_FILE_ENGINEERING,
    [TaskKind.CROSS_MODULE_REDESIGN]: TaskDepth.ARCHITECTURE,
    [TaskKind.LARGE_REFACTOR]: TaskDepth.ARCHITECTURE,
    [TaskKind.MAJOR_DESIGN]: TaskDepth.EXCEPTIONAL_REASONING,
    [TaskKind.LARGE_MIGRATION]: TaskDepth.EXCEPTIONAL_REASONING,
  });
  const depth = mapping[taskKind];
  if (depth === undefined) {
    throw new ModelGatewayValidationError(
      `Task kind "${taskKind}" is not registered.`,
    );
  }
  return depth;
}

export function assertStructuredSchema(schema) {
  if (
    !isPlainObject(schema) ||
    schema.type !== "object" ||
    !isPlainObject(schema.properties) ||
    !Array.isArray(schema.required) ||
    typeof schema.additionalProperties !== "boolean"
  ) {
    throw new ModelGatewayValidationError(
      "Structured response schema must define object properties, required, and additionalProperties.",
    );
  }
  for (const required of schema.required) {
    if (
      typeof required !== "string" ||
      !(required in schema.properties)
    ) {
      throw new ModelGatewayValidationError(
        "Structured response schema has an unknown required property.",
      );
    }
  }
  return cloneAiValue(schema);
}

export function modelOutputError(message) {
  return new ModelOutputValidationError(message);
}
