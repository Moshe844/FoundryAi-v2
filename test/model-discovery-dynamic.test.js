import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ProviderId,
  classifyModelRouteFailure,
  createLiveAiAdapters,
} from "../src/index.js";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(message, status = 400) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function structuredRequest() {
  return {
    taskClass: "PROJECT_UNDERSTANDING",
    messages: [
      { role: "system", content: "Return one JSON object." },
      { role: "user", content: "Describe the project." },
    ],
    schemaName: "project",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["name"],
      properties: { name: { type: "string" } },
    },
  };
}

function anthropicModel(id, createdAt = undefined) {
  return {
    id,
    display_name: id,
    created_at: createdAt,
    max_input_tokens: 200_000,
    capabilities: {
      structured_outputs: { supported: true },
      thinking: { supported: true },
      image_input: { supported: true },
    },
  };
}

function geminiModel(name) {
  return {
    name: `models/${name}`,
    displayName: name,
    inputTokenLimit: 1_000_000,
    supportedGenerationMethods: ["generateContent"],
    thinking: true,
  };
}

test("OpenAI discovery retains every eligible model returned by the live catalog", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    jsonResponse({
      data: [
        { id: "gpt-future-beta", created: 22 },
        { id: "text-embedding-future", created: 21 },
        { id: "gpt-future-alpha", created: 20 },
      ],
    });

  const adapters = createLiveAiAdapters({ environment: {} });
  const models =
    await adapters.discoveryAdapters[ProviderId.OPENAI].discoverModels({
      credential: "test-credential",
    });

  assert.deepEqual(
    models.map((model) => model.modelId),
    ["gpt-future-beta", "gpt-future-alpha"],
  );
  assert.ok(
    models[0].capabilities.ARCHITECTURE >
      models[1].capabilities.ARCHITECTURE,
  );
});

test("Anthropic discovery follows the live API cursor until the catalog is complete", async (t) => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return urls.length === 1
      ? jsonResponse({
          data: [anthropicModel("claude-future-one")],
          has_more: true,
          last_id: "claude-future-one",
        })
      : jsonResponse({
          data: [anthropicModel("claude-future-two")],
          has_more: false,
          last_id: "claude-future-two",
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const models =
    await adapters.discoveryAdapters[ProviderId.ANTHROPIC].discoverModels({
      credential: "test-credential",
    });

  assert.deepEqual(
    models.map((model) => model.modelId),
    ["claude-future-one", "claude-future-two"],
  );
  assert.equal(models.every((model) => model.supportsReasoning), true);
  assert.match(urls[1], /after_id=claude-future-one/u);
});

test("Anthropic discovery ranks arbitrary catalog entries by provider release metadata, not model names", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    jsonResponse({
      data: [
        anthropicModel("aaa-older-catalog-entry", "2026-01-01T00:00:00Z"),
        anthropicModel("zzz-newer-catalog-entry", "2026-07-01T00:00:00Z"),
      ],
      has_more: false,
    });

  const adapters = createLiveAiAdapters({ environment: {} });
  const models =
    await adapters.discoveryAdapters[ProviderId.ANTHROPIC].discoverModels({
      credential: "test-credential",
    });

  assert.deepEqual(
    models.map((model) => model.modelId),
    ["zzz-newer-catalog-entry", "aaa-older-catalog-entry"],
  );
  assert.ok(
    models[0].capabilities.ARCHITECTURE >
      models[1].capabilities.ARCHITECTURE,
  );
});

test("Gemini discovery follows nextPageToken and uses returned capability metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return urls.length === 1
      ? jsonResponse({
          models: [geminiModel("gemini-future-one")],
          nextPageToken: "next-catalog-page",
        })
      : jsonResponse({
          models: [geminiModel("gemini-future-two")],
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const models =
    await adapters.discoveryAdapters[
      ProviderId.GOOGLE_GEMINI
    ].discoverModels({ credential: "test-credential" });

  assert.deepEqual(
    models.map((model) => model.modelId),
    ["gemini-future-one", "gemini-future-two"],
  );
  assert.equal(models.every((model) => model.supportsReasoning), true);
  assert.match(urls[1], /pageToken=next-catalog-page/u);
});

test("Gemini discovery ranks catalog entries using returned capacity metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    jsonResponse({
      models: [
        {
          ...geminiModel("aaa-small-context-entry"),
          inputTokenLimit: 131_072,
          outputTokenLimit: 8_192,
        },
        {
          ...geminiModel("zzz-large-context-entry"),
          inputTokenLimit: 1_048_576,
          outputTokenLimit: 65_536,
        },
      ],
    });

  const adapters = createLiveAiAdapters({ environment: {} });
  const models =
    await adapters.discoveryAdapters[
      ProviderId.GOOGLE_GEMINI
    ].discoverModels({ credential: "test-credential" });
  const small = models.find(
    (model) => model.modelId === "aaa-small-context-entry",
  );
  const large = models.find(
    (model) => model.modelId === "zzz-large-context-entry",
  );

  assert.ok(
    large.capabilities.ARCHITECTURE > small.capabilities.ARCHITECTURE,
  );
});

test("Gemini discovery uses returned version recency and latest-alias metadata without a model table", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    jsonResponse({
      models: [
        {
          ...geminiModel("aaa-old-full-capacity"),
          version: "release-01-2025",
          outputTokenLimit: 65_536,
        },
        {
          ...geminiModel("middle-current-full-capacity"),
          version: "release-07-2026",
          outputTokenLimit: 65_536,
        },
        {
          ...geminiModel("zzz-provider-alias"),
          version: "Provider Latest",
          outputTokenLimit: 65_536,
        },
      ],
    });

  const adapters = createLiveAiAdapters({ environment: {} });
  const models =
    await adapters.discoveryAdapters[
      ProviderId.GOOGLE_GEMINI
    ].discoverModels({ credential: "test-credential" });
  const score = (modelId) =>
    models.find((model) => model.modelId === modelId).capabilities
      .ARCHITECTURE;

  assert.ok(
    score("zzz-provider-alias") >= score("middle-current-full-capacity"),
  );
  assert.ok(
    score("middle-current-full-capacity") > score("aaa-old-full-capacity"),
  );
});

test("production discovery contains no model-family name ranking table", () => {
  const source = readFileSync(
    resolve(
      fileURLToPath(new URL(".", import.meta.url)),
      "..",
      "src",
      "capability-plane",
      "live-ai-adapters.js",
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:opus|sonnet|haiku)\b/iu);
  assert.doesNotMatch(source, /representatives|compareModelRelease/u);
  assert.match(source, /return eligible;/u);
});

test("OpenAI negotiates JSON mode when the selected live model rejects JSON Schema", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return requests.length === 1
      ? errorResponse(
          "Invalid parameter: 'text.format' of type 'json_schema' is not supported with this model version.",
        )
      : jsonResponse({
          output_text: '{"name":"Live fallback"}',
          usage: { input_tokens: 12, output_tokens: 4 },
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const adapter = adapters.executionAdapters.find(
    (candidate) => candidate.providerId === ProviderId.OPENAI,
  );
  const result = await adapter.generate({
    credential: "test-credential",
    modelId: "catalog-model-without-schema-mode",
    request: structuredRequest(),
  });

  assert.deepEqual(result.output, { name: "Live fallback" });
  assert.equal(requests[0].body.text.format.type, "json_schema");
  assert.equal(requests[0].body.reasoning.effort, "low");
  assert.equal(requests[0].body.text.verbosity, "low");
  assert.equal(requests[1].body.text.format.type, "json_object");
  assert.equal(requests[0].body.model, requests[1].body.model);
  assert.match(
    requests[1].body.input.at(-1).content,
    /matches this exact schema[\s\S]*"required":\["name"\]/u,
  );
});

test("Anthropic negotiates provider-reported unsupported schema keywords without a model table", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return requests.length === 1
      ? errorResponse(
          "output_config.format.schema: For 'array' type, property 'maxItems' is not supported.",
        )
      : jsonResponse({
          content: [{ type: "text", text: '{"name":"Live fallback"}' }],
          usage: { input_tokens: 17, output_tokens: 4 },
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const adapter = adapters.executionAdapters.find(
    (candidate) => candidate.providerId === ProviderId.ANTHROPIC,
  );
  const request = structuredRequest();
  request.schema.properties.tags = {
    type: "array",
    maxItems: 3,
    items: { type: "string" },
  };
  const result = await adapter.generate({
    credential: "test-credential",
    modelId: "catalog-entry-selected-at-runtime",
    request,
  });

  assert.deepEqual(result.output, { name: "Live fallback" });
  assert.equal(requests[0].body.output_config.format.type, "json_schema");
  assert.equal(requests[0].body.output_config.format.schema.properties.tags.maxItems, 3);
  assert.equal(requests[1].body.output_config.format.type, "json_schema");
  assert.equal(requests[1].body.output_config.format.schema.properties.tags.maxItems, undefined);
});

test("Anthropic removes provider-reported unsupported array constraints", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return requests.length === 1
      ? errorResponse(
          "output_config.format.schema: For 'array' type, 'minItems' values other than 0 or 1 are not supported (got: [2, 5]).",
        )
      : jsonResponse({
          content: [{ type: "text", text: '{"name":"Live constraint fallback"}' }],
          usage: { input_tokens: 18, output_tokens: 5 },
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const adapter = adapters.executionAdapters.find(
    (candidate) => candidate.providerId === ProviderId.ANTHROPIC,
  );
  const request = structuredRequest();
  request.schema.properties.tags = {
    type: "array",
    minItems: 2,
    items: { type: "string" },
  };
  const result = await adapter.generate({
    credential: "test-credential",
    modelId: "catalog-entry-selected-at-runtime",
    request,
  });

  assert.deepEqual(result.output, { name: "Live constraint fallback" });
  assert.equal(requests[0].body.output_config.format.schema.properties.tags.minItems, 2);
  assert.equal(requests[1].body.output_config.format.schema.properties.tags.minItems, undefined);
});

test("Anthropic falls back to validated JSON when its live schema grammar is too large", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return requests.length === 1
      ? errorResponse("The compiled grammar is too large, which would cause performance issues.")
      : jsonResponse({
          content: [{ type: "text", text: '{"name":"Live fallback"}' }],
          usage: { input_tokens: 17, output_tokens: 4 },
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const adapter = adapters.executionAdapters.find(
    (candidate) => candidate.providerId === ProviderId.ANTHROPIC,
  );
  const result = await adapter.generate({
    credential: "test-credential",
    modelId: "another-live-catalog-entry",
    request: structuredRequest(),
  });

  assert.deepEqual(result.output, { name: "Live fallback" });
  assert.equal(requests[0].body.output_config.format.type, "json_schema");
  assert.equal(requests[1].body.output_config, undefined);
  assert.match(requests[1].body.system, /validate against this exact schema/u);
});

test("Gemini follows the provider's live Interactions-only signal without a model allowlist", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return requests.length === 1
      ? errorResponse("This model only supports Interactions API.")
      : jsonResponse({
          status: "completed",
          steps: [
            {
              type: "model_output",
              content: [{ type: "text", text: '{"name":"Live interaction"}' }],
            },
          ],
          usage: {
            input_tokens_by_modality: [{ modality: "text", tokens: 21 }],
            output_tokens_by_modality: [{ modality: "text", tokens: 5 }],
          },
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const adapter = adapters.executionAdapters.find(
    (candidate) => candidate.providerId === ProviderId.GOOGLE_GEMINI,
  );
  const result = await adapter.generate({
    credential: "test-credential",
    modelId: "catalog-entry-selected-at-runtime",
    request: structuredRequest(),
  });

  assert.deepEqual(result.output, { name: "Live interaction" });
  assert.match(requests[0].url, /:generateContent\?/u);
  assert.match(requests[1].url, /\/interactions\?/u);
  assert.equal(
    requests[1].body.agent,
    "catalog-entry-selected-at-runtime",
  );
  assert.equal(requests[1].body.response_format.schema.type, "object");
  assert.deepEqual(result.usage, {
    inputTokens: 21,
    outputTokens: 5,
    costUsd: 0,
  });
});

test("Gemini negotiates JSON mode when a discovered model rejects the returned schema", async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    return requests.length === 1
      ? errorResponse("Request contains an invalid argument.")
      : jsonResponse({
          candidates: [{ content: { parts: [{ text: '{"name":"Live Gemini fallback"}' }] } }],
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 5 },
        });
  };

  const adapters = createLiveAiAdapters({ environment: {} });
  const adapter = adapters.executionAdapters.find(
    (candidate) => candidate.providerId === ProviderId.GOOGLE_GEMINI,
  );
  const result = await adapter.generate({
    credential: "test-credential",
    modelId: "provider-discovered-entry",
    request: structuredRequest(),
  });

  assert.deepEqual(result.output, { name: "Live Gemini fallback" });
  assert.equal(requests[0].body.generationConfig.responseJsonSchema.type, "object");
  assert.equal(requests[1].body.generationConfig.responseJsonSchema, undefined);
  assert.match(requests[1].body.systemInstruction.parts[0].text, /validate against this exact schema/u);
});

test("provider-reported unknown Gemini agents are retired dynamically", () => {
  const error = new Error("google-gemini request failed: Unknown agent name: provider-returned-entry.");
  error.status = 400;
  assert.deepEqual(classifyModelRouteFailure(error), {
    category: "MODEL_UNAVAILABLE",
    retryable: false,
  });

  const missing = new Error(
    "openai request failed: Model not found provider-catalog-entry.",
  );
  missing.status = 404;
  assert.deepEqual(classifyModelRouteFailure(missing), {
    category: "MODEL_UNAVAILABLE",
    retryable: false,
  });
});
