import {
  LatencyProfile,
  MODEL_CAPABILITIES,
  ModelCapability,
  ModelStatus,
  ProviderId,
  cloneAiValue,
} from "../domain/ai-registry.js";
import { ModelProviderError } from "../domain/errors.js";

const endpoints = Object.freeze({
  [ProviderId.OPENAI]: "https://api.openai.com/v1",
  [ProviderId.ANTHROPIC]: "https://api.anthropic.com/v1",
  [ProviderId.GOOGLE_GEMINI]:
    "https://generativelanguage.googleapis.com/v1beta",
});

function modelRequestTimeoutMs(request) {
  if (request.taskClass === "FILE_GENERATION") return 300_000;
  if (request.taskClass === "PROJECT_UNDERSTANDING") return 45_000;
  return 120_000;
}

function modelMaxOutputTokens(request) {
  return request.taskClass === "PROJECT_UNDERSTANDING" ? 3_500 : 16_000;
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

function usage(inputTokens, outputTokens) {
  return {
    inputTokens: Number.isSafeInteger(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isSafeInteger(outputTokens) ? outputTokens : 0,
    costUsd: 0,
  };
}

function textModelId(id) {
  return (
    typeof id === "string" &&
    /^(?:gpt-|o\d|chatgpt-)/u.test(id) &&
    !/(?:audio|image|realtime|transcribe|tts|search)/u.test(id)
  );
}

const DISCOVERED_TEXT_SCORE = 80;

function discoveredCapabilities({
  eligible,
  structured,
  reasoning,
  vision,
  largeContext,
}) {
  if (!eligible) return scores();
  return scores({
    [ModelCapability.REASONING]:
      reasoning ? DISCOVERED_TEXT_SCORE : 0,
    [ModelCapability.CODING]: DISCOVERED_TEXT_SCORE,
    [ModelCapability.ARCHITECTURE]: DISCOVERED_TEXT_SCORE,
    [ModelCapability.PLANNING]: DISCOVERED_TEXT_SCORE,
    [ModelCapability.DEBUGGING]: DISCOVERED_TEXT_SCORE,
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

function openAiManifest(model) {
  const eligible = textModelId(model.id);
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
    }),
  };
}

function anthropicManifest(model) {
  const structured =
    model.capabilities?.structured_outputs?.supported === true;
  const reasoning = model.capabilities?.thinking?.supported === true;
  const vision = model.capabilities?.image_input?.supported === true;
  const displayName = model.display_name ?? model.id;
  return {
    modelId: model.id,
    providerId: ProviderId.ANTHROPIC,
    displayName,
    status: structured ? ModelStatus.AVAILABLE : ModelStatus.UNAVAILABLE,
    enabled: structured,
    contextWindow: Math.max(1, model.max_input_tokens ?? 1),
    supportsVision: vision,
    supportsToolCalling: false,
    supportsStructuredOutput: structured,
    supportsReasoning: reasoning,
    supportsStreaming: true,
    latencyProfile: LatencyProfile.BALANCED,
    costProfile: {
      inputPerMillionTokensUsd: 0,
      outputPerMillionTokensUsd: 0,
    },
    capabilities: discoveredCapabilities({
      eligible: structured,
      structured,
      reasoning,
      vision,
      largeContext: (model.max_input_tokens ?? 0) >= 100_000,
    }),
  };
}

function geminiManifest(model) {
  const methods =
    model.supportedGenerationMethods ?? model.supportedActions ?? [];
  const lifecycleStage = String(
    model.stage ?? model.lifecycleStage ?? "",
  ).toUpperCase();
  const legacy = lifecycleStage === "LEGACY";
  const eligible = methods.includes("generateContent") && !legacy;
  const modelId = (model.name ?? model.baseModelId).replace(/^models\//u, "");
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
    }),
  };
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
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw new ModelProviderError(
      `${providerId} returned malformed structured output.`,
      { cause },
    );
  }
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
            "You are Foundry's project engineering model. Follow the requested architecture and return only output that conforms to the supplied schema. Never substitute a canned project or omit required files.",
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

export function createLiveAiAdapters({ environment = process.env } = {}) {
  const discoveryAdapters = {
    [ProviderId.OPENAI]: {
      async discoverModels({ credential }) {
        const body = await jsonRequest(
          ProviderId.OPENAI,
          `${endpoints[ProviderId.OPENAI]}/models`,
          { headers: { authorization: `Bearer ${credential}` } },
        );
        const candidates = (body.data ?? [])
          .sort((left, right) => (right.created ?? 0) - (left.created ?? 0))
          .map(openAiManifest);
        return chooseDiscoveredModels(candidates, environment.OPENAI_MODEL);
      },
    },
    [ProviderId.ANTHROPIC]: {
      async discoverModels({ credential }) {
        const models = await discoverAnthropicCatalog(credential);
        return chooseDiscoveredModels(
          models.map(anthropicManifest),
          environment.ANTHROPIC_MODEL,
        );
      },
    },
    [ProviderId.GOOGLE_GEMINI]: {
      async discoverModels({ credential }) {
        const models = await discoverGeminiCatalog(credential);
        return chooseDiscoveredModels(
          models.map(geminiManifest),
          environment.GOOGLE_MODEL,
        );
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
        const body = await jsonRequest(
          ProviderId.OPENAI,
          `${endpoints[ProviderId.OPENAI]}/responses`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${credential}`,
              "content-type": "application/json",
            },
           body: JSON.stringify({
              model: modelId,
              store: false,
              max_output_tokens: modelMaxOutputTokens(request),
              input: normalizedRequest.messages,
              text: {
                format: {
                  type: "json_schema",
                  name: normalizedRequest.schemaName,
                  strict: true,
                  schema: normalizedRequest.schema,
                },
              },
             }),
            requestTimeoutMs: modelRequestTimeoutMs(request),
           },
        );
        return cloneAiValue({
          output: parseJson(ProviderId.OPENAI, openAiText(body)),
          usage: usage(body.usage?.input_tokens, body.usage?.output_tokens),
        });
      },
    },
    {
      providerId: ProviderId.ANTHROPIC,
      providerFamily: "Claude",
      live: true,
       async generate({ credential, modelId, request }) {
        const normalizedRequest = providerRequest(request);
        const system = normalizedRequest.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        const messages = normalizedRequest.messages.filter(
          (message) => message.role !== "system",
        );
        const body = await jsonRequest(
          ProviderId.ANTHROPIC,
          `${endpoints[ProviderId.ANTHROPIC]}/messages`,
          {
            method: "POST",
            headers: {
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
              "x-api-key": credential,
            },
             body: JSON.stringify({
              model: modelId,
              max_tokens: modelMaxOutputTokens(request),
              system,
              messages,
              output_config: {
                format: {
                  type: "json_schema",
                  schema: normalizedRequest.schema,
                },
               },
             }),
            requestTimeoutMs: modelRequestTimeoutMs(request),
           },
        );
        const text = (body.content ?? [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        return cloneAiValue({
          output: parseJson(ProviderId.ANTHROPIC, text),
          usage: usage(body.usage?.input_tokens, body.usage?.output_tokens),
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
        const body = await jsonRequest(
          ProviderId.GOOGLE_GEMINI,
          `${endpoints[ProviderId.GOOGLE_GEMINI]}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(credential)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
             body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
                responseJsonSchema: normalizedRequest.schema,
                maxOutputTokens: modelMaxOutputTokens(request),
               },
             }),
            requestTimeoutMs: modelRequestTimeoutMs(request),
           },
        );
        const text = (body.candidates?.[0]?.content?.parts ?? [])
          .map((part) => part.text ?? "")
          .join("");
        return cloneAiValue({
          output: parseJson(ProviderId.GOOGLE_GEMINI, text),
          usage: usage(
            body.usageMetadata?.promptTokenCount,
            body.usageMetadata?.candidatesTokenCount,
          ),
        });
      },
    },
  ];
  return Object.freeze({ discoveryAdapters, executionAdapters });
}
