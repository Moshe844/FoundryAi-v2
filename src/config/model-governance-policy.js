import { ProviderId } from "../domain/ai-registry.js";

export const MODEL_GOVERNANCE_POLICY_VERSION = "2026-07-31";

export const MODEL_GOVERNANCE_POLICY = Object.freeze({
  documentationValidatedAt: "2026-07-31T18:00:00.000Z",
  maximumValidationAgeMs: 7 * 24 * 60 * 60 * 1_000,
  maximumCatalogAgeMs: 24 * 60 * 60 * 1_000,
  scheduledRefreshIntervalMs: 24 * 60 * 60 * 1_000,
  sourceRequestTimeoutMs: 5_000,
  providers: Object.freeze({
    [ProviderId.OPENAI]: Object.freeze({
      catalogSource: "https://api.openai.com/v1/models",
      lifecycleSources: Object.freeze([
        "https://developers.openai.com/api/docs/models",
        "https://developers.openai.com/api/docs/deprecations",
      ]),
      lifecycleSource: "https://developers.openai.com/api/docs/deprecations",
      deprecatedModelPatterns: Object.freeze([
        "^gpt-5\\.2-chat-latest$",
      ]),
      retiredModelPatterns: Object.freeze([
        "^gpt-5\\.1-codex-max(?:-|$)",
      ]),
      engineeringFamilies: Object.freeze([
        Object.freeze({
          pattern: "^gpt-5\\.6-sol(?:-\\d{4}-\\d{2}-\\d{2})?$",
          quality: 100,
          latencyProfile: "THOROUGH",
          inputPerMillionTokensUsd: 5,
          outputPerMillionTokensUsd: 30,
          contextWindow: 1_050_000,
        }),
        Object.freeze({
          pattern: "^gpt-5\\.6-terra(?:-\\d{4}-\\d{2}-\\d{2})?$",
          quality: 94,
          latencyProfile: "BALANCED",
          inputPerMillionTokensUsd: 2.5,
          outputPerMillionTokensUsd: 15,
          contextWindow: 1_050_000,
        }),
        Object.freeze({
          pattern: "^gpt-5\\.6-luna(?:-\\d{4}-\\d{2}-\\d{2})?$",
          quality: 86,
          latencyProfile: "FAST",
          inputPerMillionTokensUsd: 1,
          outputPerMillionTokensUsd: 6,
          contextWindow: 1_050_000,
        }),
      ]),
    }),
    [ProviderId.ANTHROPIC]: Object.freeze({
      catalogSource: "https://api.anthropic.com/v1/models",
      lifecycleSources: Object.freeze([
        "https://platform.claude.com/docs/en/api/models/list",
        "https://platform.claude.com/docs/en/about-claude/model-deprecations",
        "https://platform.claude.com/docs/en/about-claude/pricing",
      ]),
      lifecycleSource: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
      deprecatedModelPatterns: Object.freeze([]),
      retiredModelPatterns: Object.freeze([]),
      engineeringFamilies: Object.freeze([
        Object.freeze({ pattern: "^claude-opus-(?:4-(?:[5-9])|[5-9])(?:-\\d{8})?$", quality: 98, latencyProfile: "THOROUGH", inputPerMillionTokensUsd: 5, outputPerMillionTokensUsd: 25 }),
        Object.freeze({ pattern: "^claude-sonnet-5(?:-\\d{8})?$", quality: 94, latencyProfile: "BALANCED", inputPerMillionTokensUsd: 2, outputPerMillionTokensUsd: 10 }),
        Object.freeze({ pattern: "^claude-sonnet-4-(?:5|6)(?:-\\d{8})?$", quality: 90, latencyProfile: "BALANCED", inputPerMillionTokensUsd: 3, outputPerMillionTokensUsd: 15 }),
        Object.freeze({ pattern: "^claude-haiku-4-5(?:-\\d{8})?$", quality: 78, latencyProfile: "FAST", inputPerMillionTokensUsd: 1, outputPerMillionTokensUsd: 5 }),
      ]),
    }),
    [ProviderId.GOOGLE_GEMINI]: Object.freeze({
      catalogSource: "https://generativelanguage.googleapis.com/v1beta/models",
      lifecycleSources: Object.freeze([
        "https://ai.google.dev/gemini-api/docs/models",
        "https://ai.google.dev/gemini-api/docs/deprecations",
        "https://ai.google.dev/gemini-api/docs/pricing",
      ]),
      lifecycleSource: "https://ai.google.dev/gemini-api/docs/deprecations",
      deprecatedModelPatterns: Object.freeze([]),
      retiredModelPatterns: Object.freeze([
        "^gemini-2\\.0-",
        "^gemini-robotics-er-1\\.5-",
      ]),
      engineeringFamilies: Object.freeze([
        Object.freeze({ pattern: "^gemini-3\\.6-flash$", quality: 96, latencyProfile: "BALANCED", inputPerMillionTokensUsd: 1.5, outputPerMillionTokensUsd: 7.5 }),
        Object.freeze({ pattern: "^gemini-3\\.5-flash$", quality: 93, latencyProfile: "BALANCED", inputPerMillionTokensUsd: 1.5, outputPerMillionTokensUsd: 9 }),
        Object.freeze({ pattern: "^gemini-3\\.5-flash-lite$", quality: 84, latencyProfile: "FAST", inputPerMillionTokensUsd: 0.3, outputPerMillionTokensUsd: 2.5 }),
        Object.freeze({ pattern: "^gemini-3\\.1-flash-lite$", quality: 80, latencyProfile: "FAST", inputPerMillionTokensUsd: 0.25, outputPerMillionTokensUsd: 1.5 }),
        Object.freeze({ pattern: "^gemini-2\\.5-pro$", quality: 88, latencyProfile: "THOROUGH", inputPerMillionTokensUsd: 1.25, outputPerMillionTokensUsd: 10 }),
        Object.freeze({ pattern: "^gemini-2\\.5-flash$", quality: 78, latencyProfile: "BALANCED", inputPerMillionTokensUsd: 0.3, outputPerMillionTokensUsd: 2.5 }),
        Object.freeze({ pattern: "^gemini-2\\.5-flash-lite$", quality: 70, latencyProfile: "FAST", inputPerMillionTokensUsd: 0.1, outputPerMillionTokensUsd: 0.4 }),
      ]),
    }),
  }),
});
