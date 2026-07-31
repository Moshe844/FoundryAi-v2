import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { ProviderId, cloneAiValue } from "../domain/ai-registry.js";
import {
  MODEL_GOVERNANCE_POLICY,
  MODEL_GOVERNANCE_POLICY_VERSION,
} from "../config/model-governance-policy.js";

const CACHE_SCHEMA_VERSION = 1;

function stripMarkup(value) {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/&quot;|&#34;/giu, '"')
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

function tableRows(document) {
  const htmlRows = [...String(document).matchAll(/<tr\b[^>]*>(?<row>[\s\S]*?)<\/tr>/giu)]
    .map((match) => [...match.groups.row.matchAll(/<t[dh]\b[^>]*>(?<cell>[\s\S]*?)<\/t[dh]>/giu)]
      .map((cell) => stripMarkup(cell.groups.cell)))
    .filter((cells) => cells.length >= 2);
  if (htmlRows.length > 0) return htmlRows;
  return String(document)
    .split(/\r?\n/gu)
    .filter((line) => line.includes("|"))
    .map((line) => line.split("|").map(stripMarkup).filter((cell) => cell !== ""))
    .filter((cells) => cells.length >= 2 && !cells.every((cell) => /^[-: ]+$/u.test(cell)));
}

function modelIds(providerId, value) {
  const patterns = {
    [ProviderId.OPENAI]: /(?:gpt|chatgpt|computer-use|o[1345]|sora|text|code|babbage|davinci)[A-Za-z0-9_.:-]*(?:-[A-Za-z0-9_.:-]+)*/gu,
    [ProviderId.ANTHROPIC]: /claude-[a-z0-9.-]+/gu,
    [ProviderId.GOOGLE_GEMINI]: /gemini-[a-z0-9.-]+/gu,
  };
  return [...new Set(String(value).match(patterns[providerId]) ?? [])]
    .filter((modelId) => !modelId.endsWith("."));
}

function dateFrom(value) {
  const text = String(value);
  const iso = /\b\d{4}-\d{2}-\d{2}\b/u.exec(text)?.[0];
  const named = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b/iu.exec(text)?.[0];
  const candidate = iso ?? named ?? null;
  if (candidate === null || !Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString().slice(0, 10);
}

function datedState(shutdownDate, now) {
  if (shutdownDate === null) return "ACTIVE";
  return Date.parse(`${shutdownDate}T23:59:59.999Z`) < Date.parse(now)
    ? "SHUTDOWN"
    : "DEPRECATED";
}

export function parseLifecycleNotices({ providerId, document, sourceUrl, fetchedAt }) {
  const notices = [];
  for (const cells of tableRows(document)) {
    let ids = [];
    let lifecycle = null;
    let shutdownDate = null;
    if (providerId === ProviderId.OPENAI) {
      shutdownDate = dateFrom(cells[0]);
      ids = modelIds(providerId, cells[1] ?? "");
      if (ids.length > 0 && shutdownDate !== null) lifecycle = datedState(shutdownDate, fetchedAt);
    } else if (providerId === ProviderId.ANTHROPIC) {
      ids = modelIds(providerId, cells[0] ?? "");
      const state = String(cells[1] ?? "").toUpperCase();
      shutdownDate = dateFrom(cells[3] ?? cells.at(-1) ?? "");
      if (state.includes("RETIRED")) lifecycle = "SHUTDOWN";
      else if (state.includes("DEPRECATED") || state.includes("LEGACY")) lifecycle = "DEPRECATED";
      else if (state.includes("ACTIVE")) lifecycle = "ACTIVE";
    } else if (providerId === ProviderId.GOOGLE_GEMINI) {
      ids = modelIds(providerId, cells[0] ?? "");
      const shutdownCell = cells[2] ?? "";
      shutdownDate = dateFrom(shutdownCell);
      lifecycle = /no shutdown date announced/iu.test(shutdownCell)
        ? "ACTIVE"
        : shutdownDate === null
          ? null
          : datedState(shutdownDate, fetchedAt);
    }
    if (lifecycle === null) continue;
    for (const modelId of ids) {
      notices.push({
        modelId,
        lifecycle,
        shutdownDate,
        sourceUrl,
      });
    }
  }
  return cloneAiValue(
    [...new Map(notices.map((notice) => [notice.modelId, notice])).values()]
      .sort((left, right) => left.modelId.localeCompare(right.modelId)),
  );
}

function bundledEvidence(providerId) {
  const policy = MODEL_GOVERNANCE_POLICY.providers[providerId];
  return {
    providerId,
    sourceUrl: policy.lifecycleSource,
    fetchedAt: MODEL_GOVERNANCE_POLICY.documentationValidatedAt,
    contentHash: null,
    status: "BUNDLED_POLICY",
    policyVersion: MODEL_GOVERNANCE_POLICY_VERSION,
    notices: [],
  };
}

function validCache(value) {
  return value !== null && typeof value === "object" &&
    value.schemaVersion === CACHE_SCHEMA_VERSION &&
    value.providers !== null && typeof value.providers === "object";
}

export function createModelLifecycleSourceService({
  cachePath,
  clock = () => new Date().toISOString(),
  fetchImpl = globalThis.fetch,
}) {
  const resolvedCachePath = resolve(cachePath);
  let refreshPromise = null;

  function readCache() {
    if (!existsSync(resolvedCachePath)) return { schemaVersion: CACHE_SCHEMA_VERSION, providers: {} };
    try {
      const parsed = JSON.parse(readFileSync(resolvedCachePath, "utf8"));
      return validCache(parsed) ? parsed : { schemaVersion: CACHE_SCHEMA_VERSION, providers: {} };
    } catch {
      return { schemaVersion: CACHE_SCHEMA_VERSION, providers: {} };
    }
  }

  function writeCache(cache) {
    mkdirSync(dirname(resolvedCachePath), { recursive: true });
    const temporaryPath = `${resolvedCachePath}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    renameSync(temporaryPath, resolvedCachePath);
  }

  function fresh(entry, now = clock()) {
    return entry !== undefined && Number.isFinite(Date.parse(entry.fetchedAt)) &&
      Date.parse(entry.fetchedAt) + MODEL_GOVERNANCE_POLICY.maximumValidationAgeMs >= Date.parse(now);
  }

  async function fetchProvider(providerId, fetchedAt) {
    const policy = MODEL_GOVERNANCE_POLICY.providers[providerId];
    const response = await fetchImpl(policy.lifecycleSource, {
      headers: { accept: "text/html, text/markdown;q=0.9" },
      signal: AbortSignal.timeout(MODEL_GOVERNANCE_POLICY.sourceRequestTimeoutMs),
    });
    if (!response.ok) throw new Error(`Lifecycle source returned HTTP ${response.status}.`);
    const document = await response.text();
    const notices = parseLifecycleNotices({
      providerId,
      document,
      sourceUrl: policy.lifecycleSource,
      fetchedAt,
    });
    if (notices.length === 0) throw new Error("Lifecycle source contained no parseable model notices.");
    return {
      providerId,
      sourceUrl: policy.lifecycleSource,
      fetchedAt,
      contentHash: createHash("sha256").update(document).digest("hex"),
      status: "OFFICIAL_SOURCE",
      policyVersion: MODEL_GOVERNANCE_POLICY_VERSION,
      notices,
    };
  }

  async function performRefresh({ force }) {
    const cache = readCache();
    const fetchedAt = clock();
    const providerIds = Object.values(ProviderId);
    const results = await Promise.all(providerIds.map(async (providerId) => {
      const cached = cache.providers[providerId];
      if (!force && fresh(cached, fetchedAt)) return cached;
      try {
        return await fetchProvider(providerId, fetchedAt);
      } catch (error) {
        if (fresh(cached, fetchedAt)) {
          return { ...cached, status: "CACHED_OFFICIAL_SOURCE", refreshError: String(error.message).slice(0, 240) };
        }
        return { ...bundledEvidence(providerId), refreshError: String(error.message).slice(0, 240) };
      }
    }));
    const next = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      providers: Object.fromEntries(results.map((entry) => [entry.providerId, entry])),
    };
    writeCache(next);
    return cloneAiValue(next.providers);
  }

  async function refresh({ force = false } = {}) {
    if (refreshPromise === null) {
      refreshPromise = performRefresh({ force }).finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  return Object.freeze({
    path: resolvedCachePath,
    refresh,
    async forProvider(providerId) {
      const providers = await refresh({ force: false });
      return cloneAiValue(providers[providerId] ?? bundledEvidence(providerId));
    },
  });
}
