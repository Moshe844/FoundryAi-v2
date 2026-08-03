import { ProviderId } from "../domain/ai-registry.js";
import { ModelTaskClass } from "../domain/execution.js";

export const MODEL_GOVERNANCE_POLICY_VERSION = "2026-08-02";

export const ModelFamilyDefaultEligibility = Object.freeze({
  CONDITIONAL: "CONDITIONAL",
  DENIED: "DENIED",
});

const ALL_ENGINEERING_TASK_CLASSES = Object.freeze([
  ...Object.values(ModelTaskClass),
]);

const NO_ENGINEERING_TASK_CLASSES = Object.freeze([]);

function familyRule({
  ruleId,
  family,
  purpose,
  defaultEligibility,
  allowedTaskClasses,
  idPatterns,
  metadataPatterns,
  metadataConditions = [],
  reason,
}) {
  return Object.freeze({
    ruleId,
    family,
    purpose,
    defaultEligibility,
    allowedTaskClasses,
    idPatterns: Object.freeze(idPatterns),
    metadataPatterns: Object.freeze(metadataPatterns),
    metadataConditions: Object.freeze(metadataConditions),
    reason,
  });
}

export const MODEL_FAMILY_GOVERNANCE_POLICY = Object.freeze({
  policyVersion: MODEL_GOVERNANCE_POLICY_VERSION,
  unknownFamily: familyRule({
    ruleId: "unknown-specialized",
    family: "unknown-specialized",
    purpose: "UNKNOWN",
    defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
    allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
    idPatterns: [],
    metadataPatterns: [],
    reason: "The model family could not be confidently classified.",
  }),
  excludedFamilies: Object.freeze([
    familyRule({
      ruleId: "robotics",
      family: "robotics",
      purpose: "ROBOTICS",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["robotic", "physical-world", "spatial-action"],
      metadataPatterns: ["robotic", "physical world", "spatial action"],
      reason: "Robotics and physical-world models are outside Foundry's certified engineering capability set.",
    }),
    familyRule({
      ruleId: "embedding",
      family: "embedding",
      purpose: "EMBEDDINGS",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["(?:^|[-_.])embed(?:ding|dings)?(?:[-_.]|$)"],
      metadataPatterns: ["embedding model", "text embedding", "vector embedding"],
      reason: "Embedding models do not generate engineering deliverables.",
    }),
    familyRule({
      ruleId: "image-generation",
      family: "image-generation",
      purpose: "IMAGE_GENERATION",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["(?:^|[-_.])imagen(?:[-_.]|$)", "gpt-image", "dall-e", "image-generation"],
      metadataPatterns: ["image generation", "generate images", "text to image"],
      reason: "Image-generation models are not ordinary software-engineering models.",
    }),
    familyRule({
      ruleId: "video-generation",
      family: "video-generation",
      purpose: "VIDEO_GENERATION",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["(?:^|[-_.])veo(?:[-_.]|$)", "(?:^|[-_.])sora(?:[-_.]|$)", "video-generation"],
      metadataPatterns: ["video generation", "generate videos", "text to video"],
      reason: "Video-generation models are not ordinary software-engineering models.",
    }),
    familyRule({
      ruleId: "speech",
      family: "speech",
      purpose: "SPEECH",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["text-to-speech", "(?:^|[-_.])tts(?:[-_.]|$)", "transcrib", "speech"],
      metadataPatterns: ["text to speech", "speech generation", "speech recognition", "speech transcription"],
      reason: "Speech models are not ordinary software-engineering models.",
    }),
    familyRule({
      ruleId: "audio-music",
      family: "audio-music",
      purpose: "AUDIO",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["(?:^|[-_.])lyria(?:[-_.]|$)", "(?:^|[-_.])audio(?:[-_.]|$)", "music-generation"],
      metadataPatterns: ["audio generation", "music generation", "generate music"],
      reason: "Audio and music models are not ordinary software-engineering models.",
    }),
    familyRule({
      ruleId: "moderation",
      family: "moderation",
      purpose: "MODERATION",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["moderat"],
      metadataPatterns: ["content moderation", "safety classification"],
      reason: "Moderation models do not generate engineering deliverables.",
    }),
    familyRule({
      ruleId: "deep-research",
      family: "deep-research",
      purpose: "RESEARCH",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["deep-research", "research-preview"],
      metadataPatterns: ["deep research", "research agent"],
      reason: "Research models require a separately explicit and certified research task.",
    }),
    familyRule({
      ruleId: "computer-use",
      family: "computer-use",
      purpose: "COMPUTER_USE",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["computer-use"],
      metadataPatterns: ["computer use", "browser operator"],
      reason: "Computer-use models require a separately explicit and certified browser-operation task.",
    }),
    familyRule({
      ruleId: "realtime",
      family: "realtime",
      purpose: "REALTIME",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["(?:^|[-_.])realtime(?:[-_.]|$)", "live-audio", "native-audio"],
      metadataPatterns: ["realtime audio", "live audio", "native audio"],
      reason: "Realtime and live-audio models are not ordinary software-engineering models.",
    }),
    familyRule({
      ruleId: "search",
      family: "search",
      purpose: "SEARCH",
      defaultEligibility: ModelFamilyDefaultEligibility.DENIED,
      allowedTaskClasses: NO_ENGINEERING_TASK_CLASSES,
      idPatterns: ["(?:^|[-_.])search(?:[-_.]|$)"],
      metadataPatterns: ["search model", "web search agent"],
      reason: "Search-specialized models require a separately explicit and certified research task.",
    }),
  ]),
  providers: Object.freeze({
    [ProviderId.OPENAI]: Object.freeze([
      familyRule({
        ruleId: "openai-coding-agent",
        family: "openai-coding-agent",
        purpose: "CODING_AGENT",
        defaultEligibility: ModelFamilyDefaultEligibility.CONDITIONAL,
        allowedTaskClasses: ALL_ENGINEERING_TASK_CLASSES,
        idPatterns: ["(?:^|[-_.])codex(?:[-_.]|$)"],
        metadataPatterns: ["coding agent", "software engineering agent"],
        reason: "OpenAI coding families may be eligible only after lifecycle, endpoint, capability, and exact engineering-family validation.",
      }),
      familyRule({
        ruleId: "openai-general-reasoning",
        family: "openai-general-reasoning",
        purpose: "GENERAL_REASONING",
        defaultEligibility: ModelFamilyDefaultEligibility.CONDITIONAL,
        allowedTaskClasses: ALL_ENGINEERING_TASK_CLASSES,
        idPatterns: ["^gpt-", "^o[1-9](?:[-_.]|$)"],
        metadataPatterns: [],
        reason: "OpenAI general-reasoning families may be eligible only after lifecycle, endpoint, capability, and exact engineering-family validation.",
      }),
    ]),
    [ProviderId.ANTHROPIC]: Object.freeze([
      familyRule({
        ruleId: "anthropic-general-coding",
        family: "anthropic-general-coding",
        purpose: "SOFTWARE_ENGINEERING",
        defaultEligibility: ModelFamilyDefaultEligibility.CONDITIONAL,
        allowedTaskClasses: ALL_ENGINEERING_TASK_CLASSES,
        idPatterns: ["^claude-"],
        metadataPatterns: [],
        metadataConditions: [{
          all: [
            { path: "capabilities.structured_outputs.supported", equals: true },
            { path: "capabilities.thinking.supported", equals: true },
          ],
        }],
        reason: "Anthropic Claude families may be eligible only after lifecycle, endpoint, capability, and exact engineering-family validation.",
      }),
    ]),
    [ProviderId.GOOGLE_GEMINI]: Object.freeze([
      familyRule({
        ruleId: "google-general-reasoning",
        family: "google-general-reasoning",
        purpose: "GENERAL_REASONING",
        defaultEligibility: ModelFamilyDefaultEligibility.CONDITIONAL,
        allowedTaskClasses: ALL_ENGINEERING_TASK_CLASSES,
        idPatterns: ["^gemini-"],
        metadataPatterns: [],
        metadataConditions: [{
          any: [
            { path: "supportedGenerationMethods", includes: "generateContent" },
            { path: "supportedActions", includes: "generateContent" },
          ],
        }],
        reason: "Gemini general-reasoning families may be eligible only after lifecycle, endpoint, capability, and exact engineering-family validation.",
      }),
    ]),
  }),
});

export const MODEL_GOVERNANCE_POLICY = Object.freeze({
  documentationValidatedAt: "2026-07-31T18:00:00.000Z",
  maximumValidationAgeMs: 7 * 24 * 60 * 60 * 1_000,
  maximumCatalogAgeMs: 24 * 60 * 60 * 1_000,
  scheduledRefreshIntervalMs: 24 * 60 * 60 * 1_000,
  sourceRequestTimeoutMs: 5_000,
  familyGovernance: MODEL_FAMILY_GOVERNANCE_POLICY,
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
