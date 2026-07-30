import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  ProviderId,
  createLiveAiAdapters,
} from "../src/index.js";

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function anthropicModel(id) {
  return {
    id,
    display_name: id,
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
