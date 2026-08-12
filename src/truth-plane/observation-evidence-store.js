import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  DuplicateEvidenceError,
  EvidenceIntegrityError,
  EvidenceNotFoundError,
  EvidenceReferenceError,
} from "../domain/errors.js";
import {
  freezeEvidenceRecord,
  normalizeEvidenceInput,
  validateEvidenceRecord,
} from "../domain/observation-evidence.js";

const EVIDENCE_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

export function createObservationEvidenceStore({ evidenceDirectory }) {
  const root = resolve(evidenceDirectory);
  const recordsDirectory = resolve(root, "records");
  let indexes = null;

  function addToIndex(index, key, evidenceId) {
    if (key === null || key === undefined) return;
    const ids = index.get(key) ?? new Set();
    ids.add(evidenceId);
    index.set(key, ids);
  }

  function indexRecord(record, target = indexes) {
    if (target === null) return;
    addToIndex(target.byMission, record.missionId, record.evidenceId);
    addToIndex(target.byKind, record.kind, record.evidenceId);
    addToIndex(
      target.byWorkUnit,
      record.workUnitReference,
      record.evidenceId,
    );
    addToIndex(
      target.byCheckpoint,
      record.workspaceCheckpointReference,
      record.evidenceId,
    );
  }

  function pathFor(evidenceId) {
    if (
      typeof evidenceId !== "string" ||
      !EVIDENCE_ID_PATTERN.test(evidenceId)
    ) {
      throw new EvidenceReferenceError(
        "Evidence reference is malformed.",
        evidenceId,
      );
    }
    return resolve(recordsDirectory, `${evidenceId}.json`);
  }

  function capture(input) {
    const record = normalizeEvidenceInput(input);
    mkdirSync(recordsDirectory, { recursive: true });
    const recordPath = pathFor(record.evidenceId);
    let descriptor;

    try {
      descriptor = openSync(recordPath, "wx");
      writeFileSync(
        descriptor,
        `${JSON.stringify(record, null, 2)}\n`,
        "utf8",
      );
      fsyncSync(descriptor);
      indexRecord(record);
      return freezeEvidenceRecord(record);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new DuplicateEvidenceError(record.evidenceId);
      }
      throw error;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
  }

  function getById(evidenceId) {
    const recordPath = pathFor(evidenceId);
    if (!existsSync(recordPath)) {
      throw new EvidenceNotFoundError(evidenceId);
    }

    let parsed;
    try {
      parsed = JSON.parse(readFileSync(recordPath, "utf8"));
    } catch (error) {
      throw new EvidenceIntegrityError(
        evidenceId,
        "the record is not valid JSON",
        { cause: error },
      );
    }
    return validateEvidenceRecord(parsed, evidenceId);
  }

  function listAll() {
    if (!existsSync(recordsDirectory)) {
      return Object.freeze([]);
    }
    const evidenceIds = readdirSync(recordsDirectory, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5))
      .sort();
    return Object.freeze(evidenceIds.map((evidenceId) => getById(evidenceId)));
  }

  function ensureIndexes() {
    if (indexes !== null) return indexes;
    const next = {
      byMission: new Map(),
      byKind: new Map(),
      byWorkUnit: new Map(),
      byCheckpoint: new Map(),
    };
    if (existsSync(recordsDirectory)) {
      const evidenceIds = readdirSync(recordsDirectory, {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name.slice(0, -5))
        .sort();
      for (const evidenceId of evidenceIds) {
        indexRecord(getById(evidenceId), next);
      }
    }
    indexes = next;
    return indexes;
  }

  function indexedRecords(indexName, key) {
    const index = ensureIndexes()[indexName];
    const evidenceIds = [...(index.get(key) ?? [])].sort((left, right) =>
      left.localeCompare(right),
    );
    // Read and validate the selected records on every query. The index removes
    // the unbounded global directory scan without hiding record tampering.
    return Object.freeze(evidenceIds.map((evidenceId) => getById(evidenceId)));
  }

  function integrityFingerprint(evidenceIds = null) {
    const hash = createHash("sha256");
    if (!existsSync(recordsDirectory)) return hash.digest("hex");
    const names =
      evidenceIds === null
        ? readdirSync(recordsDirectory, { withFileTypes: true })
            .filter((candidate) => candidate.isFile())
            .map((entry) => entry.name)
        : [...new Set(evidenceIds)].map((evidenceId) => `${evidenceId}.json`);
    for (const name of names.sort((left, right) =>
      left.localeCompare(right),
    )) {
      hash.update(name);
      const path = resolve(recordsDirectory, name);
      hash.update(existsSync(path) ? readFileSync(path) : "<missing>");
    }
    return hash.digest("hex");
  }

  function find(predicate) {
    return Object.freeze(listAll().filter(predicate));
  }

  function validateReference({
    evidenceId,
    missionId,
    workspaceCheckpointReference,
    workUnitReference,
  }) {
    let evidence;
    try {
      evidence = getById(evidenceId);
    } catch (error) {
      if (
        error instanceof EvidenceNotFoundError ||
        error instanceof EvidenceIntegrityError
      ) {
        throw new EvidenceReferenceError(
          `Evidence reference "${evidenceId}" is not valid.`,
          evidenceId,
          { cause: error },
        );
      }
      throw error;
    }

    if (evidence.missionId !== missionId) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" belongs to mission "${evidence.missionId}", not "${missionId}".`,
        evidenceId,
      );
    }
    if (
      evidence.workspaceCheckpointReference !==
      workspaceCheckpointReference
    ) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" is bound to checkpoint "${evidence.workspaceCheckpointReference}", not "${workspaceCheckpointReference}".`,
        evidenceId,
      );
    }
    if (evidence.workUnitReference !== workUnitReference) {
      throw new EvidenceReferenceError(
        `Evidence "${evidenceId}" is bound to work unit "${evidence.workUnitReference}", not "${workUnitReference}".`,
        evidenceId,
      );
    }
    return evidence;
  }

  return Object.freeze({
    capture,
    getById,
    findByMission(missionId) {
      return indexedRecords("byMission", missionId);
    },
    findByKind(kind) {
      return indexedRecords("byKind", kind);
    },
    findByWorkUnit(workUnitReference) {
      return indexedRecords("byWorkUnit", workUnitReference);
    },
    findByCheckpoint(workspaceCheckpointReference) {
      return indexedRecords("byCheckpoint", workspaceCheckpointReference);
    },
    validateReference,
    integrityFingerprint,
  });
}
