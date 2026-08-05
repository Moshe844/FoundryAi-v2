import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function fail(message) {
  throw new TypeError(`Concept studio session: ${message}`);
}

function id(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u.test(value)) fail(`${label} is invalid.`);
  return value;
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function createPrototypeStudioSessionService({ prototypeRoot }) {
  if (typeof prototypeRoot !== "string" || prototypeRoot.trim() === "") fail("prototypeRoot is required.");
  const root = resolve(prototypeRoot, "studio-sessions");
  mkdirSync(root, { recursive: true });
  const pathFor = (missionId) => resolve(root, `${id(missionId, "missionId")}.json`);

  function read(missionId) {
    const path = pathFor(missionId);
    if (!existsSync(path)) return null;
    const record = JSON.parse(readFileSync(path, "utf8"));
    if (record.schemaVersion !== 1 || record.missionId !== missionId) fail("persisted session is corrupt.");
    let recovered = record;
    if (record.status === "GENERATING") {
      recovered = {
        ...record,
        status: "INTERRUPTED",
        error: "Concept generation was interrupted. Retry resumes from immutable completed artifacts.",
      };
    }
    if (record.evolution?.status === "GENERATING") {
      recovered = {
        ...recovered,
        evolution: {
          ...record.evolution,
          status: "INTERRUPTED",
          error: "Concept revision, composition, or shock generation was interrupted. Retry starts from the last immutable admitted version.",
          completedAt: new Date().toISOString(),
        },
      };
    }
    return freeze(recovered);
  }

  function save(record) {
    id(record?.missionId, "missionId");
    const next = { ...structuredClone(record), schemaVersion: 1, updatedAt: new Date().toISOString() };
    atomicJson(pathFor(next.missionId), next);
    return freeze(next);
  }

  function begin({ missionId, sourceProjectDesignVersion }) {
    if (!Number.isSafeInteger(sourceProjectDesignVersion) || sourceProjectDesignVersion < 1) fail("sourceProjectDesignVersion is invalid.");
    const existing = read(missionId);
    if (existing?.status === "READY") return existing;
    return save({
      schemaVersion: 1,
      missionId,
      sourceProjectDesignVersion,
      status: "GENERATING",
      recommendedConceptId: null,
      recommendationReason: null,
      concepts: existing?.concepts ?? [],
      generation: {
        startedAt: existing?.generation?.startedAt ?? new Date().toISOString(),
        completedAt: null,
        inputTokens: existing?.generation?.inputTokens ?? 0,
        outputTokens: existing?.generation?.outputTokens ?? 0,
        costUsd: existing?.generation?.costUsd ?? 0,
      },
      selectedConceptId: existing?.selectedConceptId ?? null,
      attemptFailures: existing?.attemptFailures ?? [],
      conceptHistory: existing?.conceptHistory ?? [],
      compositions: existing?.compositions ?? [],
      evolution: existing?.evolution,
      error: null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
  }

  return Object.freeze({ read, save, begin });
}
