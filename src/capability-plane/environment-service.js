import { ModelGatewayValidationError } from "../domain/errors.js";
import {
  ProviderId,
  SUPPORTED_PROVIDER_IDS,
  cloneAiValue,
} from "../domain/ai-registry.js";

const definitions = Object.freeze({
  [ProviderId.OPENAI]: Object.freeze({
    environmentVariable: "OPENAI_API_KEY",
    formatDescription: "an sk- prefixed provider credential",
    pattern: /^sk-[A-Za-z0-9_-]{16,}$/,
  }),
  [ProviderId.ANTHROPIC]: Object.freeze({
    environmentVariable: "ANTHROPIC_API_KEY",
    formatDescription: "an sk-ant- prefixed provider credential",
    pattern: /^sk-ant-[A-Za-z0-9_-]{16,}$/,
  }),
  [ProviderId.GOOGLE_GEMINI]: Object.freeze({
    environmentVariable: "GOOGLE_API_KEY",
    formatDescription: "a non-whitespace Gemini API credential",
    // Google supports both legacy standard API keys and newer authorization
    // keys. Their prefixes are not an authentication contract; live provider
    // discovery is the authority that determines whether a key is accepted.
    pattern: /^\S{20,}$/u,
  }),
});

function assertProviderId(providerId) {
  if (!SUPPORTED_PROVIDER_IDS.includes(providerId)) {
    throw new ModelGatewayValidationError(
      `Provider "${providerId}" is not supported by Milestone 9A.`,
    );
  }
}

function inspectCredential(providerId, environment) {
  assertProviderId(providerId);
  const definition = definitions[providerId];
  const value = environment[definition.environmentVariable];
  if (typeof value !== "string" || value.trim() === "") {
    return cloneAiValue({
      providerId,
      environmentVariable: definition.environmentVariable,
      configured: false,
      valid: false,
      reason: `${definition.environmentVariable} is missing.`,
    });
  }
  if (
    value !== value.trim() ||
    /\s/.test(value) ||
    !definition.pattern.test(value)
  ) {
    return cloneAiValue({
      providerId,
      environmentVariable: definition.environmentVariable,
      configured: true,
      valid: false,
      reason: `${definition.environmentVariable} must use ${definition.formatDescription}.`,
    });
  }
  return cloneAiValue({
    providerId,
    environmentVariable: definition.environmentVariable,
    configured: true,
    valid: true,
    reason: `${definition.environmentVariable} is configured and format-valid.`,
  });
}

export function createEnvironmentService({
  environment = process.env,
} = {}) {
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new ModelGatewayValidationError(
      "Environment Service requires an environment object.",
    );
  }

  return Object.freeze({
    inspectProvider(providerId) {
      return inspectCredential(providerId, environment);
    },
    inspectAllProviders() {
      return cloneAiValue(
        SUPPORTED_PROVIDER_IDS.map((providerId) =>
          inspectCredential(providerId, environment),
        ),
      );
    },
    hasValidCredential(providerId) {
      return inspectCredential(providerId, environment).valid;
    },
    withCredential(providerId, operation) {
      assertProviderId(providerId);
      if (typeof operation !== "function") {
        throw new ModelGatewayValidationError(
          "Credential operation must be a function.",
        );
      }
      const inspection = inspectCredential(providerId, environment);
      if (!inspection.valid) {
        throw new ModelGatewayValidationError(inspection.reason);
      }
      const variable = definitions[providerId].environmentVariable;
      return operation(environment[variable]);
    },
  });
}
