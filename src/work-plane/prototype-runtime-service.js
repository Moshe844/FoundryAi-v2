import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

import { normalizeConceptPrototypeContract } from "../domain/live-concept-studio.js";

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;
const MAX_RESPONSE_BYTES = 1_000_000;
const CSP = [
  "default-src 'none'",
  "style-src 'self'",
  "script-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "form-action 'none'",
].join("; ");

function fail(message) {
  throw new TypeError(`Prototype runtime: ${message}`);
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail(`${label} must be a safe identifier.`);
  }
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function mimeType(path) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".woff2": "font/woff2",
  }[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function headers(response, contentType = "text/plain; charset=utf-8") {
  response.setHeader("Content-Type", contentType);
  response.setHeader("Content-Security-Policy", CSP);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  response.setHeader("Cache-Control", "no-store");
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  });
}

export function createPrototypeRuntimeService({ workspaceService }) {
  if (workspaceService === null || typeof workspaceService !== "object") {
    fail("workspaceService is required.");
  }
  const live = new Map();

  function persisted(sessionId) {
    const record = workspaceService.runtimeRecords().find((entry) => entry.sessionId === sessionId);
    if (record === undefined) fail(`session "${sessionId}" does not exist.`);
    return record;
  }

  function get(sessionIdInput) {
    const sessionId = identifier(sessionIdInput, "sessionId");
    const record = persisted(sessionId);
    if (record.status === "RUNNING" && !live.has(sessionId)) {
      const stale = {
        ...record,
        status: "STALE",
        stoppedAt: new Date().toISOString(),
        stopReason: "runtime-process-not-owned-after-restart",
      };
      return workspaceService.saveRuntimeRecord(stale);
    }
    return deepFreeze(structuredClone(record));
  }

  async function start({
    conceptContract: conceptInput,
    sessionId: sessionIdInput,
    idempotencyKey: idempotencyInput,
    timeoutMs,
    expiresAt,
  }) {
    const conceptContract = normalizeConceptPrototypeContract(conceptInput);
    const sessionId = identifier(sessionIdInput, "sessionId");
    const idempotencyKey = identifier(idempotencyInput, "idempotencyKey");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) {
      fail("timeoutMs must be between 100 and 120000.");
    }
    if (typeof expiresAt !== "string" || Number.isNaN(Date.parse(expiresAt))) {
      fail("expiresAt must be an ISO-8601 timestamp.");
    }
    if (Date.parse(expiresAt) <= Date.now()) fail("expiresAt must be in the future.");
    const workspace = workspaceService.get(conceptContract);
    if (workspace.status !== "FINALIZED") fail("runtime requires a finalized concept workspace.");

    const prior = workspaceService.runtimeRecords().find(
      (entry) => entry.idempotencyKey === idempotencyKey,
    );
    if (prior !== undefined) {
      if (
        prior.sessionId !== sessionId ||
        prior.conceptId !== conceptContract.conceptId ||
        prior.conceptVersion !== conceptContract.conceptVersion ||
        prior.contentHash !== workspace.contentHash
      ) fail("idempotencyKey was reused for different prototype work.");
      if (live.has(sessionId)) return deepFreeze(structuredClone(prior));
      if (prior.status === "STOPPED" || prior.status === "EXPIRED") return deepFreeze(structuredClone(prior));
      workspaceService.saveRuntimeRecord({
        ...prior,
        status: "STALE",
        stoppedAt: new Date().toISOString(),
        stopReason: "runtime-process-not-owned-after-restart",
      });
    }

    const allowedFiles = new Set(conceptContract.expectedFiles);
    const server = createServer((request, response) => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        const decoded = decodeURIComponent(url.pathname);
        const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
        if (
          !allowedFiles.has(relativePath) ||
          relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
        ) {
          headers(response);
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const file = workspace.fileManifest.find((entry) => entry.path === relativePath);
        if (file === undefined || file.size > MAX_RESPONSE_BYTES) {
          headers(response);
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const body = readFileSync(`${workspace.sourcePath}/${relativePath.replaceAll("/", "\\")}`);
        headers(response, mimeType(relativePath));
        response.writeHead(200);
        response.end(body);
      } catch {
        headers(response);
        response.writeHead(400);
        response.end("Invalid request");
      }
    });
    server.requestTimeout = Math.min(timeoutMs, 15_000);
    server.headersTimeout = Math.min(timeoutMs, 10_000);
    server.maxRequestsPerSocket = 100;

    await Promise.race([
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
      }),
      new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error("Prototype runtime startup timed out.")), timeoutMs);
        timer.unref?.();
      }),
    ]).catch(async (error) => {
      if (server.listening) await closeServer(server);
      throw error;
    });

    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : null;
    if (!Number.isSafeInteger(port)) {
      await closeServer(server);
      fail("runtime did not receive a loopback port.");
    }
    const startedAt = new Date().toISOString();
    const record = {
      sessionId,
      idempotencyKey,
      missionId: conceptContract.missionId,
      conceptId: conceptContract.conceptId,
      conceptVersion: conceptContract.conceptVersion,
      contractIntegrityHash: conceptContract.integrityHash,
      contentHash: workspace.contentHash,
      status: "RUNNING",
      previewUrl: `http://127.0.0.1:${port}/`,
      port,
      startedAt,
      expiresAt,
      stoppedAt: null,
      stopReason: null,
    };
    const expirationDelay = Math.max(1, Date.parse(expiresAt) - Date.now());
    const expiration = setTimeout(() => {
      void stop({ sessionId, reason: "expired" });
    }, expirationDelay);
    expiration.unref?.();
    live.set(sessionId, { server, expiration });
    return workspaceService.saveRuntimeRecord(record);
  }

  async function stop({ sessionId: sessionIdInput, reason }) {
    const sessionId = identifier(sessionIdInput, "sessionId");
    if (typeof reason !== "string" || reason.trim() === "") fail("stop reason is required.");
    let record;
    try {
      record = persisted(sessionId);
    } catch {
      return deepFreeze({ sessionId, status: "NOT_FOUND", stopReason: reason.trim() });
    }
    const owned = live.get(sessionId);
    if (owned !== undefined) {
      clearTimeout(owned.expiration);
      await closeServer(owned.server);
      live.delete(sessionId);
    }
    if (["STOPPED", "EXPIRED"].includes(record.status)) return deepFreeze(structuredClone(record));
    const stopped = {
      ...record,
      status: reason === "expired" ? "EXPIRED" : "STOPPED",
      stoppedAt: new Date().toISOString(),
      stopReason: reason.trim(),
    };
    return workspaceService.saveRuntimeRecord(stopped);
  }

  async function stopAll({ reason }) {
    const sessionIds = [...live.keys()];
    return Promise.all(sessionIds.map((sessionId) => stop({ sessionId, reason })));
  }

  return Object.freeze({ start, stop, stopAll, get });
}
