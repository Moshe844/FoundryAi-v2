import {
  LatencyProfile,
  MODEL_CAPABILITIES,
  ModelCapability,
  ModelStatus,
  ProviderId,
  cloneAiValue,
} from "../domain/ai-registry.js";
import { ModelProviderError } from "../domain/errors.js";
import { ModelFamilyDefaultEligibility } from "../config/model-governance-policy.js";
import {
  governProviderCatalog,
  resolveModelFamilyGovernance,
} from "../domain/model-governance.js";

const endpoints = Object.freeze({
  [ProviderId.OPENAI]: "https://api.openai.com/v1",
  [ProviderId.ANTHROPIC]: "https://api.anthropic.com/v1",
  [ProviderId.GOOGLE_GEMINI]:
    "https://generativelanguage.googleapis.com/v1beta",
});

export function modelRequestTimeoutMs(request) {
  // A complete responsive HTML/CSS/interaction prototype routinely approaches
  // the same structured-output size as production file generation. Cutting it
  // off at two minutes caused healthy providers to fail after doing the work.
  if (request.executionStage === "DESIGN_PROTOTYPE") return 300_000;
  if (request.taskClass === "FILE_GENERATION") return 300_000;
  if (request.taskClass === "PROJECT_UNDERSTANDING") return 120_000;
  return 120_000;
}

function modelMaxOutputTokens(request) {
  if (request.executionStage === "DESIGN_PROTOTYPE") return 12_000;
  if (request.taskClass === "FILE_GENERATION") return 32_000;
  if (request.taskClass === "PROJECT_UNDERSTANDING") return 6_000;
  return 16_000;
}

function scores(values = {}) {
  return Object.fromEntries(
    MODEL_CAPABILITIES.map((capability) => [
      capability,
      values[capability] ?? 0,
    ]),
  );
}

function safeError(providerId, response, body) {
  const detail =
    body?.error?.message ?? body?.error?.status ?? `HTTP ${response.status}`;
  const error = new ModelProviderError(
    `${providerId} request failed: ${String(detail).slice(0, 240)}.`,
  );
  error.status = response.status;
  return error;
}

async function jsonRequest(providerId, url, options = {}) {
  const {
    requestTimeoutMs = 120_000,
    ...fetchOptions
  } = options;
  let response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (cause) {
    if (
      cause?.name === "TimeoutError" ||
      cause?.name === "AbortError"
    ) {
      const error = new ModelProviderError(
        `${providerId} timed out after ${Math.round(requestTimeoutMs / 1_000)} seconds.`,
        { cause },
      );
      error.status = 408;
      throw error;
    }
    throw new ModelProviderError(`${providerId} could not be reached.`, {
      cause,
    });
  }
  let body;
  try {
    body = await response.json();
  } catch (cause) {
    throw new ModelProviderError(
      `${providerId} returned a non-JSON response.`,
      { cause },
    );
  }
  if (!response.ok) throw safeError(providerId, response, body);
  return body;
}

const whole = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);

// Providers report more than two numbers and Foundry kept two, so its own
// ledger could not answer why a day it recorded as twelve dollars was billed
// as sixty. Cached input is charged at a different rate than fresh input, and
// a reasoning model's thinking is billed as output whether or not it appears
// in the text. Recording every field the provider returns — including the
// total it computed itself — makes the next discrepancy answerable from the
// ledger instead of from a dashboard screenshot.
function usage(inputTokens, outputTokens, details = {}) {
  const input = whole(inputTokens);
  const output = whole(outputTokens);
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: whole(details.cachedInputTokens),
    reasoningTokens: whole(details.reasoningTokens),
    // The provider's own total, when it gives one. A gap between this and
    // input + output is a category Foundry is not yet counting.
    providerTotalTokens: whole(details.totalTokens) || input + output,
    costUsd: 0,
  };
}

function withoutJsonSchemaKeyword(value, keyword) {
  if (Array.isArray(value)) {
    return value.map((item) => withoutJsonSchemaKeyword(item, keyword));
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== keyword)
      .map(([key, item]) => [
        key,
        withoutJsonSchemaKeyword(item, keyword),
      ]),
  );
}

function unsupportedJsonSchemaKeyword(message) {
  const detail = String(message);
  return (
    /property ['"](?<keyword>[A-Za-z][A-Za-z0-9]*)['"] is not supported/iu.exec(
      detail,
    )?.groups?.keyword ??
    /for ['"](?:array|object|string|number|integer)['"] type, ['"](?<keyword>[A-Za-z][A-Za-z0-9]*)['"] values?/iu.exec(
      detail,
    )?.groups?.keyword ??
    null
  );
}

function familyPotentiallySupportsEngineering(providerId, modelId, raw) {
  return resolveModelFamilyGovernance({ providerId, modelId, raw })
    .defaultEligibility === ModelFamilyDefaultEligibility.CONDITIONAL;
}

const DISCOVERED_TEXT_SCORE = 80;

function discoveredCapabilities({
  eligible,
  structured,
  reasoning,
  vision,
  largeContext,
  qualityScore = DISCOVERED_TEXT_SCORE,
}) {
  if (!eligible) return scores();
  return scores({
    [ModelCapability.REASONING]:
      reasoning ? qualityScore : 0,
    [ModelCapability.CODING]: qualityScore,
    [ModelCapability.ARCHITECTURE]: qualityScore,
    [ModelCapability.PLANNING]: qualityScore,
    [ModelCapability.DEBUGGING]: qualityScore,
    [ModelCapability.VISION]: vision ? DISCOVERED_TEXT_SCORE : 0,
    [ModelCapability.STRUCTURED_OUTPUT]:
      structured ? DISCOVERED_TEXT_SCORE : 0,
    [ModelCapability.TOOL_CALLING]: 0,
    [ModelCapability.FAST_RESPONSE]: DISCOVERED_TEXT_SCORE,
    [ModelCapability.LOW_COST]: 0,
    [ModelCapability.LARGE_CONTEXT]:
      largeContext ? DISCOVERED_TEXT_SCORE : 0,
  });
}

function catalogueRankScore(index, total) {
  if (total <= 1) return 100;
  return Math.round(100 - (20 * index) / (total - 1));
}

function catalogueCapacityScore(model, maximums) {
  const inputRatio =
    Math.max(1, model.inputTokenLimit ?? 1) / maximums.inputTokenLimit;
  const outputRatio =
    Math.max(1, model.outputTokenLimit ?? 1) / maximums.outputTokenLimit;
  return Math.round(
    80 + 20 * (Math.sqrt(inputRatio) * 0.75 + Math.sqrt(outputRatio) * 0.25),
  );
}

function catalogueReleaseValue(model) {
  const version = String(model.version ?? "");
  if (/\blatest\b/iu.test(version)) return Number.POSITIVE_INFINITY;
  const fullDate = version.match(/\b(\d{4})-(\d{2})-(\d{2})\b/u);
  if (fullDate) {
    return Date.UTC(
      Number(fullDate[1]),
      Number(fullDate[2]) - 1,
      Number(fullDate[3]),
    );
  }
  const monthYear = version.match(/\b(\d{2})-(\d{4})\b/u);
  if (monthYear) {
    return Date.UTC(Number(monthYear[2]), Number(monthYear[1]) - 1, 1);
  }
  return 0;
}

function openAiManifest(model, qualityScore = DISCOVERED_TEXT_SCORE) {
  const eligible = familyPotentiallySupportsEngineering(
    ProviderId.OPENAI,
    model.id,
    model,
  );
  return {
    modelId: model.id,
    providerId: ProviderId.OPENAI,
    displayName: model.id,
    status: eligible ? ModelStatus.AVAILABLE : ModelStatus.UNAVAILABLE,
    enabled: eligible,
    contextWindow: 1,
    supportsVision: false,
    supportsToolCalling: false,
    supportsStructuredOutput: eligible,
    supportsReasoning: eligible,
    supportsStreaming: eligible,
    latencyProfile: LatencyProfile.BALANCED,
    costProfile: {
      inputPerMillionTokensUsd: 0,
      outputPerMillionTokensUsd: 0,
    },
    capabilities: discoveredCapabilities({
      eligible,
      structured: eligible,
      reasoning: eligible,
      vision: false,
      largeContext: false,
      qualityScore,
    }),
  };
}

function anthropicManifest(model, qualityScore = DISCOVERED_TEXT_SCORE) {
  const structured =
    model.capabilities?.structured_outputs?.supported === true;
  const familyEligible = familyPotentiallySupportsEngineering(
    ProviderId.ANTHROPIC,
    model.id,
    model,
  );
  const reasoning = model.capabilities?.thinking?.supported === true;
  const vision = model.capabilities?.image_input?.supported === true;
  const displayName = model.display_name ?? model.id;
  return {
    modelId: model.id,
    providerId: ProviderId.ANTHROPIC,
    displayName,
    status: structured && familyEligible ? ModelStatus.AVAILABLE : ModelStatus.UNAVAILABLE,
    enabled: structured && familyEligible,
    contextWindow: Math.max(1, model.max_input_tokens ?? 1),
    supportsVision: vision,
    supportsToolCalling: false,
    supportsStructuredOutput: structured && familyEligible,
    supportsReasoning: reasoning,
    supportsStreaming: true,
    latencyProfile: LatencyProfile.BALANCED,
    costProfile: {
      inputPerMillionTokensUsd: 0,
      outputPerMillionTokensUsd: 0,
    },
    capabilities: discoveredCapabilities({
      eligible: structured && familyEligible,
      structured: structured && familyEligible,
      reasoning,
      vision,
      largeContext: (model.max_input_tokens ?? 0) >= 100_000,
      qualityScore,
    }),
  };
}

function geminiManifest(model, qualityScore = DISCOVERED_TEXT_SCORE) {
  const methods =
    model.supportedGenerationMethods ?? model.supportedActions ?? [];
  const lifecycleStage = String(
    model.stage ?? model.lifecycleStage ?? "",
  ).toUpperCase();
  const legacy = lifecycleStage === "LEGACY";
  const modelId = (model.name ?? model.baseModelId).replace(/^models\//u, "");
  const eligible = methods.includes("generateContent") && !legacy &&
    familyPotentiallySupportsEngineering(
      ProviderId.GOOGLE_GEMINI,
      modelId,
      model,
    );
  const displayName = model.displayName ?? modelId;
  const reasoning =
    model.thinking === true || model.thinking?.supported === true;
  return {
    modelId,
    providerId: ProviderId.GOOGLE_GEMINI,
    displayName,
    status: legacy
      ? ModelStatus.DEPRECATED
      : eligible
        ? ModelStatus.AVAILABLE
        : ModelStatus.UNAVAILABLE,
    enabled: eligible,
    contextWindow: Math.max(1, model.inputTokenLimit ?? 1),
    supportsVision: false,
    supportsToolCalling: false,
    supportsStructuredOutput: eligible,
    supportsReasoning: reasoning,
    supportsStreaming: eligible,
    latencyProfile: LatencyProfile.BALANCED,
    costProfile: {
      inputPerMillionTokensUsd: 0,
      outputPerMillionTokensUsd: 0,
    },
    capabilities: discoveredCapabilities({
      eligible,
      structured: eligible,
      reasoning,
      vision: false,
      largeContext: (model.inputTokenLimit ?? 0) >= 100_000,
      qualityScore,
    }),
  };
}

function manifestsByRelease(models, manifest, releasedAt) {
  const ordered = [...models].sort(
    (left, right) => releasedAt(right) - releasedAt(left),
  );
  return ordered.map((model, index) =>
    manifest(model, catalogueRankScore(index, ordered.length)),
  );
}

function geminiManifests(models) {
  const maximums = {
    inputTokenLimit: Math.max(
      1,
      ...models.map((model) => model.inputTokenLimit ?? 1),
    ),
    outputTokenLimit: Math.max(
      1,
      ...models.map((model) => model.outputTokenLimit ?? 1),
    ),
  };
  const dated = models
    .map(catalogueReleaseValue)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left);
  return models.map((model) => {
    const releaseValue = catalogueReleaseValue(model);
    const releaseScore =
      releaseValue === Number.POSITIVE_INFINITY
        ? 100
        : releaseValue === 0
          ? 80
          : catalogueRankScore(
              dated.findIndex((value) => value === releaseValue),
              dated.length,
            );
    const qualityScore = Math.round(
      (catalogueCapacityScore(model, maximums) + releaseScore) / 2,
    );
    return geminiManifest(model, qualityScore);
  });
}

function chooseDiscoveredModels(manifests, configuredModel) {
  if (configuredModel) {
    const configured = manifests.find(
      (manifest) => manifest.modelId === configuredModel,
    );
    if (!configured?.enabled) {
      throw new ModelProviderError(
        `Configured model "${configuredModel}" is not eligible.`,
      );
    }
    return [configured];
  }
  const eligible = manifests
    .filter(
      (manifest) =>
        manifest.enabled &&
        manifest.status === ModelStatus.AVAILABLE &&
        manifest.supportsStructuredOutput,
    );
  if (eligible.length === 0) {
    throw new ModelProviderError(
      "Provider returned no eligible structured-output model.",
    );
  }
  return eligible;
}

function governedCatalog(providerId, rawModels, configuredModel, lifecycleEvidence) {
  const snapshot = governProviderCatalog({ providerId, rawModels, lifecycleEvidence });
  if (!configuredModel) return snapshot;
  if (!snapshot.engineeringEligibleModels.some((model) => model.modelId === configuredModel)) {
    throw new ModelProviderError(
      `Configured model "${configuredModel}" was discovered but did not pass engineering governance.`,
    );
  }
  return cloneAiValue({
    ...snapshot,
    engineeringEligibleModels: snapshot.engineeringEligibleModels.filter(
      (model) => model.modelId === configuredModel,
    ),
  });
}

async function discoverAnthropicCatalog(credential) {
  const models = [];
  let afterId = null;
  for (let page = 0; page < 20; page += 1) {
    const cursor =
      afterId === null ? "" : `&after_id=${encodeURIComponent(afterId)}`;
    const body = await jsonRequest(
      ProviderId.ANTHROPIC,
      `${endpoints[ProviderId.ANTHROPIC]}/models?limit=1000${cursor}`,
      {
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": credential,
        },
      },
    );
    models.push(...(body.data ?? []));
    if (body.has_more !== true || typeof body.last_id !== "string") break;
    if (body.last_id === afterId) {
      throw new ModelProviderError(
        "Anthropic model discovery returned a repeated page cursor.",
      );
    }
    afterId = body.last_id;
  }
  return models;
}

async function discoverGeminiCatalog(credential) {
  const models = [];
  let pageToken = null;
  for (let page = 0; page < 20; page += 1) {
    const cursor =
      pageToken === null
        ? ""
        : `&pageToken=${encodeURIComponent(pageToken)}`;
    const body = await jsonRequest(
      ProviderId.GOOGLE_GEMINI,
      `${endpoints[ProviderId.GOOGLE_GEMINI]}/models?pageSize=1000${cursor}&key=${encodeURIComponent(credential)}`,
    );
    models.push(...(body.models ?? []));
    if (typeof body.nextPageToken !== "string" || body.nextPageToken === "") {
      break;
    }
    if (body.nextPageToken === pageToken) {
      throw new ModelProviderError(
        "Google Gemini model discovery returned a repeated page cursor.",
      );
    }
    pageToken = body.nextPageToken;
  }
  return models;
}

function parseJson(providerId, value) {
  const text = String(value ?? "").trim();
  const candidates = [text];
  const fenced = /^```(?:json)?\s*(?<json>[\s\S]*?)\s*```$/iu.exec(text)
    ?.groups?.json;
  if (fenced !== undefined) candidates.push(fenced.trim());
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  let cause;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      cause = error;
    }
  }
  throw new ModelProviderError(
    `${providerId} returned malformed structured output (${text.length} characters; object start ${firstBrace === 0 ? "present" : "absent"}; object end ${lastBrace === text.length - 1 ? "present" : "absent"}).`,
    { cause },
  );
}

function openAiText(body) {
  if (typeof body.output_text === "string") return body.output_text;
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "refusal") {
        throw new ModelProviderError("OpenAI refused the request.");
      }
      if (content.type === "output_text") return content.text;
    }
  }
  throw new ModelProviderError("OpenAI returned no output text.");
}

function interactionText(body) {
  if (typeof body.output_text === "string" && body.output_text !== "") {
    return body.output_text;
  }
  const text = (body.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((content) => content.type === "text")
    .map((content) => content.text ?? "")
    .join("");
  if (text !== "") return text;
  throw new ModelProviderError(
    "Google Gemini Interactions API returned no output text.",
  );
}

function modalityTokens(values) {
  return (values ?? []).reduce(
    (total, value) =>
      total + (Number.isSafeInteger(value.tokens) ? value.tokens : 0),
    0,
  );
}

function providerRequest(request) {
  if (
    Array.isArray(request.messages) &&
    typeof request.schemaName === "string" &&
    request.schema !== null &&
    typeof request.schema === "object"
  ) {
    return request;
  }
  if (
    typeof request.purpose === "string" &&
    request.expectedStructuredOutputSchema !== null &&
    typeof request.expectedStructuredOutputSchema === "object"
  ) {
    return {
      messages: [
        {
          role: "system",
          content:
            "You are Foundry's project engineering model. Follow the requested architecture and return exactly one JSON object that conforms to the supplied schema. Never substitute a canned project or omit required files.",
        },
        { role: "user", content: request.purpose },
      ],
      schemaName: `foundry_${String(request.taskClass ?? "result")
        .toLowerCase()
        .replace(/[^a-z0-9_-]/gu, "_")}`,
      schema: request.expectedStructuredOutputSchema,
    };
  }
  throw new ModelProviderError(
    "Live model request is missing messages or a structured-output schema.",
  );
}

export function createLiveAiAdapters({
  environment = process.env,
  lifecycleSourceService = null,
} = {}) {
  const lifecycleEvidence = async (providerId) =>
    lifecycleSourceService === null
      ? null
      : lifecycleSourceService.forProvider(providerId);
  const discoveryAdapters = {
    [ProviderId.OPENAI]: {
      async discoverCatalog({ credential }) {
        const body = await jsonRequest(
          ProviderId.OPENAI,
          `${endpoints[ProviderId.OPENAI]}/models`,
          { headers: { authorization: `Bearer ${credential}` } },
        );
        return governedCatalog(
          ProviderId.OPENAI,
          body.data ?? [],
          environment.OPENAI_MODEL,
          await lifecycleEvidence(ProviderId.OPENAI),
        );
      },
      async discoverModels({ credential }) {
        const body = await jsonRequest(
          ProviderId.OPENAI,
          `${endpoints[ProviderId.OPENAI]}/models`,
          { headers: { authorization: `Bearer ${credential}` } },
        );
        return chooseDiscoveredModels(
          manifestsByRelease(body.data ?? [], openAiManifest, (model) => model.created ?? 0),
          environment.OPENAI_MODEL,
        );
      },
    },
    [ProviderId.ANTHROPIC]: {
      async discoverCatalog({ credential }) {
        const models = await discoverAnthropicCatalog(credential);
        return governedCatalog(
          ProviderId.ANTHROPIC,
          models,
          environment.ANTHROPIC_MODEL,
          await lifecycleEvidence(ProviderId.ANTHROPIC),
        );
      },
      async discoverModels({ credential }) {
        const models = await discoverAnthropicCatalog(credential);
        return chooseDiscoveredModels(
          manifestsByRelease(models, anthropicManifest, (model) => Date.parse(model.created_at ?? "") || 0),
          environment.ANTHROPIC_MODEL,
        );
      },
    },
    [ProviderId.GOOGLE_GEMINI]: {
      async discoverCatalog({ credential }) {
        const models = await discoverGeminiCatalog(credential);
        return governedCatalog(
          ProviderId.GOOGLE_GEMINI,
          models,
          environment.GOOGLE_MODEL,
          await lifecycleEvidence(ProviderId.GOOGLE_GEMINI),
        );
      },
      async discoverModels({ credential }) {
        const models = await discoverGeminiCatalog(credential);
        return chooseDiscoveredModels(geminiManifests(models), environment.GOOGLE_MODEL);
      },
    },
  };

  const executionAdapters = [
    {
      providerId: ProviderId.OPENAI,
      providerFamily: "GPT",
      live: true,
      async generate({ credential, modelId, request }) {
        const normalizedRequest = providerRequest(request);
        const url = `${endpoints[ProviderId.OPENAI]}/responses`;
        const options = (format, reasoningEffort = "low") => ({
          method: "POST",
          headers: {
            authorization: `Bearer ${credential}`,
            "content-type": "application/json",
          },
           body: JSON.stringify({
             model: modelId,
             store: false,
             max_output_tokens: modelMaxOutputTokens(request),
             ...(request.taskClass === "PROJECT_UNDERSTANDING"
               ? {
                   ...(reasoningEffort !== null
                     ? { reasoning: { effort: reasoningEffort } }
                     : {}),
                   text: {
                     format,
                     verbosity: reasoningEffort ?? "low",
                   },
                 }
               : { text: { format } }),
             input:
              format.type === "json_object"
                ? [
                    ...normalizedRequest.messages,
                    {
                      role: "system",
                      content: `The selected model supports JSON mode rather than schema-constrained output. Return one JSON object that matches this exact schema, including every required property: ${JSON.stringify(normalizedRequest.schema)}`,
                    },
                  ]
                : normalizedRequest.messages,
           }),
          requestTimeoutMs: modelRequestTimeoutMs(request),
        });
        let body;
        try {
          body = await jsonRequest(
            ProviderId.OPENAI,
            url,
            options({
              type: "json_schema",
              name: normalizedRequest.schemaName,
              strict: true,
              schema: normalizedRequest.schema,
            }),
          );
        } catch (error) {
          const message = String(error.message);
          if (
            /unsupported value:[\s\S]*low[\s\S]*not supported[\s\S]*supported values/iu.test(
              message,
            ) ||
            /(?:reasoning|effort)[\s\S]*low[\s\S]*not supported/iu.test(
              message,
            )
          ) {
            const supportedValuesText =
              /supported values (?:are|include):(?<values>[^.]+)/iu.exec(
                message,
              )?.groups?.values ?? "";
            const negotiatedEffort =
              [...supportedValuesText.matchAll(/['"](?<value>[a-z]+)['"]/giu)]
                .map((match) => match.groups?.value)
                .find(Boolean) ?? null;
            body = await jsonRequest(
              ProviderId.OPENAI,
              url,
              options(
                {
                  type: "json_schema",
                  name: normalizedRequest.schemaName,
                  strict: true,
                  schema: normalizedRequest.schema,
                },
                negotiatedEffort,
              ),
            );
          } else if (
            !/text\.format[\s\S]*json_schema[\s\S]*not supported/iu.test(
              message,
            )
          ) {
            throw error;
          } else {
            body = await jsonRequest(
              ProviderId.OPENAI,
              url,
              options({ type: "json_object" }),
            );
          }
        }
        return cloneAiValue({
          output: parseJson(ProviderId.OPENAI, openAiText(body)),
          usage: usage(body.usage?.input_tokens, body.usage?.output_tokens, {
            cachedInputTokens: body.usage?.input_tokens_details?.cached_tokens,
            reasoningTokens: body.usage?.output_tokens_details?.reasoning_tokens,
            totalTokens: body.usage?.total_tokens,
          }),
        });
      },
    },
    {
      providerId: ProviderId.ANTHROPIC,
      providerFamily: "Claude",
      live: true,
      async generate({ credential, modelId, request }) {
        const normalizedRequest = providerRequest(request);
        const baseSystem = normalizedRequest.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        const messages = normalizedRequest.messages.filter(
          (message) => message.role !== "system",
        );
        const options = (schema) => ({
            method: "POST",
            headers: {
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
              "x-api-key": credential,
            },
            body: JSON.stringify({
              model: modelId,
              max_tokens: modelMaxOutputTokens(request),
              system: schema !== null
                ? baseSystem
                : `${baseSystem}\n\nThe live provider cannot compile this schema as a strict grammar. Return exactly one JSON object with every required property and no prose. It must validate against this exact schema: ${JSON.stringify(normalizedRequest.schema)}`,
              messages,
              ...(schema !== null
                ? {
                    output_config: {
                      format: {
                        type: "json_schema",
                        schema,
                      },
                    },
                  }
                : {}),
            }),
            requestTimeoutMs: modelRequestTimeoutMs(request),
        });
        const url = `${endpoints[ProviderId.ANTHROPIC]}/messages`;
        let body;
        let providerSchema = normalizedRequest.schema;
        for (let negotiationAttempt = 0; negotiationAttempt < 4; negotiationAttempt += 1) {
          try {
            body = await jsonRequest(
              ProviderId.ANTHROPIC,
              url,
              options(providerSchema),
            );
            break;
          } catch (error) {
            const message = String(error.message);
            const unsupportedKeyword = unsupportedJsonSchemaKeyword(message);
            if (unsupportedKeyword !== null && negotiationAttempt < 3) {
              providerSchema = withoutJsonSchemaKeyword(
                providerSchema,
                unsupportedKeyword,
              );
              continue;
            }
            if (!/compiled grammar is too large/iu.test(message)) {
              throw error;
            }
            body = await jsonRequest(
              ProviderId.ANTHROPIC,
              url,
              options(null),
            );
            break;
          }
        }
        const text = (body.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        return cloneAiValue({
          output: parseJson(ProviderId.ANTHROPIC, text),
          // Anthropic reports cache reads and writes as their own fields
          // rather than as a detail of input_tokens, and they are billed
          // separately, so input_tokens alone understates what was charged.
          usage: usage(
            (body.usage?.input_tokens ?? 0) +
              (body.usage?.cache_read_input_tokens ?? 0) +
              (body.usage?.cache_creation_input_tokens ?? 0),
            body.usage?.output_tokens,
            {
              cachedInputTokens: body.usage?.cache_read_input_tokens,
              totalTokens:
                (body.usage?.input_tokens ?? 0) +
                (body.usage?.cache_read_input_tokens ?? 0) +
                (body.usage?.cache_creation_input_tokens ?? 0) +
                (body.usage?.output_tokens ?? 0),
            },
          ),
        });
      },
    },
    {
      providerId: ProviderId.GOOGLE_GEMINI,
      providerFamily: "Gemini",
      live: true,
      async generate({ credential, modelId, request }) {
        const normalizedRequest = providerRequest(request);
        const system = normalizedRequest.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        const prompt = normalizedRequest.messages
          .filter((message) => message.role !== "system")
          .map((message) => message.content)
          .join("\n\n");
        const generateContentOptions = (strictSchema) => ({
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: strictSchema
                  ? system
                  : `${system}\n\nReturn exactly one JSON object with every required property and no prose. It must validate against this exact schema: ${JSON.stringify(normalizedRequest.schema)}`,
              }],
            },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              ...(strictSchema
                ? { responseJsonSchema: normalizedRequest.schema }
                : {}),
              maxOutputTokens: modelMaxOutputTokens(request),
            },
          }),
          requestTimeoutMs: modelRequestTimeoutMs(request),
        });
        const generateContentUrl = `${endpoints[ProviderId.GOOGLE_GEMINI]}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(credential)}`;
        let body;
        try {
          body = await jsonRequest(
            ProviderId.GOOGLE_GEMINI,
            generateContentUrl,
            generateContentOptions(true),
          );
        } catch (error) {
          const message = String(error.message);
          if (/(?:invalid argument|responseJsonSchema[\s\S]*(?:not supported|unsupported))/iu.test(message)) {
            body = await jsonRequest(
              ProviderId.GOOGLE_GEMINI,
              generateContentUrl,
              generateContentOptions(false),
            );
          } else if (!/only supports Interactions API/iu.test(message)) {
            throw error;
          } else {
            const interaction = await jsonRequest(
              ProviderId.GOOGLE_GEMINI,
              `${endpoints[ProviderId.GOOGLE_GEMINI]}/interactions?key=${encodeURIComponent(credential)}`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  agent: modelId,
                  input: prompt,
                  system_instruction: system,
                  response_format: {
                    type: "text",
                    mime_type: "application/json",
                    schema: normalizedRequest.schema,
                  },
                  store: false,
                  background: false,
                }),
                requestTimeoutMs: modelRequestTimeoutMs(request),
              },
            );
            return cloneAiValue({
              output: parseJson(
                ProviderId.GOOGLE_GEMINI,
                interactionText(interaction),
              ),
              usage: usage(
                modalityTokens(interaction.usage?.input_tokens_by_modality),
                modalityTokens(interaction.usage?.output_tokens_by_modality),
              ),
            });
          }
        }
        const text = (body.candidates?.[0]?.content?.parts ?? [])
          .map((part) => part.text ?? "")
          .join("");
        return cloneAiValue({
          output: parseJson(ProviderId.GOOGLE_GEMINI, text),
          usage: usage(
            body.usageMetadata?.promptTokenCount,
            body.usageMetadata?.candidatesTokenCount,
            {
              cachedInputTokens: body.usageMetadata?.cachedContentTokenCount,
              reasoningTokens: body.usageMetadata?.thoughtsTokenCount,
              totalTokens: body.usageMetadata?.totalTokenCount,
            },
          ),
        });
      },
    },
  ];
  return Object.freeze({
    discoveryAdapters,
    executionAdapters,
    refreshLifecycleSources: ({ force = false } = {}) =>
      lifecycleSourceService?.refresh({ force }) ?? Promise.resolve({}),
  });
}
