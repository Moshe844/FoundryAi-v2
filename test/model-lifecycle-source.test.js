import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ProviderId,
  createModelLifecycleSourceService,
  parseLifecycleNotices,
} from "../src/index.js";

const fetchedAt = "2026-07-31T20:00:00.000Z";
const documents = Object.freeze({
  [ProviderId.OPENAI]: `
    <table><tr><th>Shutdown date</th><th>Model</th></tr>
    <tr><td>Aug 10, 2026</td><td><code>gpt-5.2-chat-latest</code></td></tr></table>`,
  [ProviderId.ANTHROPIC]: `
    <table><tr><th>API model name</th><th>Current state</th><th>Deprecated</th><th>Retirement</th></tr>
    <tr><td><code>claude-opus-4-1-20250805</code></td><td>Deprecated</td><td>June 5, 2026</td><td>August 5, 2026</td></tr></table>`,
  [ProviderId.GOOGLE_GEMINI]: `
    <table><tr><th>Model</th><th>Release date</th><th>Shutdown date</th></tr>
    <tr><td><code>gemini-2.0-flash</code></td><td>February 5, 2025</td><td>June 1, 2026</td></tr></table>`,
});

test("provider lifecycle documents normalize future deprecations and completed shutdowns", () => {
  const openAi = parseLifecycleNotices({
    providerId: ProviderId.OPENAI,
    document: documents[ProviderId.OPENAI],
    sourceUrl: "https://developers.openai.com/api/docs/deprecations",
    fetchedAt,
  });
  const anthropic = parseLifecycleNotices({
    providerId: ProviderId.ANTHROPIC,
    document: documents[ProviderId.ANTHROPIC],
    sourceUrl: "https://platform.claude.com/docs/en/about-claude/model-deprecations",
    fetchedAt,
  });
  const google = parseLifecycleNotices({
    providerId: ProviderId.GOOGLE_GEMINI,
    document: documents[ProviderId.GOOGLE_GEMINI],
    sourceUrl: "https://ai.google.dev/gemini-api/docs/deprecations",
    fetchedAt,
  });
  assert.deepEqual(openAi.map(({ modelId, lifecycle }) => [modelId, lifecycle]), [
    ["gpt-5.2-chat-latest", "DEPRECATED"],
  ]);
  assert.deepEqual(anthropic.map(({ modelId, lifecycle }) => [modelId, lifecycle]), [
    ["claude-opus-4-1-20250805", "DEPRECATED"],
  ]);
  assert.deepEqual(google.map(({ modelId, lifecycle }) => [modelId, lifecycle]), [
    ["gemini-2.0-flash", "SHUTDOWN"],
  ]);
});

test("official lifecycle evidence is cached without persisting source documents", async () => {
  const directory = mkdtempSync(join(tmpdir(), "foundry-lifecycle-source-"));
  try {
    const cachePath = join(directory, "lifecycle-cache.json");
    let calls = 0;
    const service = createModelLifecycleSourceService({
      cachePath,
      clock: () => fetchedAt,
      fetchImpl: async (url) => {
        calls += 1;
        const providerId = url.includes("openai")
          ? ProviderId.OPENAI
          : url.includes("claude")
            ? ProviderId.ANTHROPIC
            : ProviderId.GOOGLE_GEMINI;
        return new Response(documents[providerId], { status: 200 });
      },
    });
    const refreshed = await service.refresh({ force: true });
    assert.equal(calls, 3);
    assert.ok(Object.values(refreshed).every((entry) => entry.status === "OFFICIAL_SOURCE"));
    assert.ok(Object.values(refreshed).every((entry) => entry.contentHash?.length === 64));
    assert.equal(existsSync(cachePath), true);

    const cachedService = createModelLifecycleSourceService({
      cachePath,
      clock: () => fetchedAt,
      fetchImpl: async () => {
        throw new Error("network should not be used for a fresh cache");
      },
    });
    const cached = await cachedService.refresh();
    assert.ok(Object.values(cached).every((entry) => entry.status === "OFFICIAL_SOURCE"));

    const fallback = await cachedService.refresh({ force: true });
    assert.ok(
      Object.values(fallback).every(
        (entry) => entry.status === "CACHED_OFFICIAL_SOURCE",
      ),
    );
    assert.ok(Object.values(fallback).every((entry) => entry.notices.length === 1));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
