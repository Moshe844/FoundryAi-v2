import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { normalizeConceptPrototypeContract } from "../domain/live-concept-studio.js";

const WORKSPACE_SCHEMA_VERSION = 1;
const RUNTIME_REGISTRY_SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 4_000_000;
const MAX_EVIDENCE_FILE_BYTES = 8_000_000;
const MAX_EVIDENCE_WRITE_BYTES = 24_000_000;

function fail(message) {
  throw new TypeError(`Prototype workspace: ${message}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function isInside(parent, child) {
  const relation = relative(parent, child);
  return (
    relation === "" ||
    (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation))
  );
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${label} is missing or corrupt: ${error.message}`);
  }
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function atomicJson(path, value) {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeSourcePath(sourceRoot, relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath === "" ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) fail(`"${relativePath}" is not a safe workspace-relative file.`);
  const path = resolve(sourceRoot, ...relativePath.split("/"));
  if (!isInside(sourceRoot, path)) fail(`"${relativePath}" escaped the concept workspace.`);
  return path;
}

export function createPrototypeWorkspaceService({ prototypeRoot }) {
  if (typeof prototypeRoot !== "string" || prototypeRoot.trim() === "") {
    fail("prototypeRoot must be a non-empty path.");
  }
  const root = resolve(prototypeRoot);
  const runtimeRegistryPath = resolve(root, "runtime-sessions.json");
  mkdirSync(root, { recursive: true });

  function pathsFor(contract) {
    const versionName = `v${contract.conceptVersion}`;
    const workspaceRoot = resolve(root, contract.missionId, contract.conceptId, versionName);
    if (!isInside(root, workspaceRoot)) fail("concept identity escaped prototypeRoot.");
    return {
      rootPath: workspaceRoot,
      sourcePath: resolve(workspaceRoot, "source"),
      evidencePath: resolve(workspaceRoot, "evidence"),
      contractPath: resolve(workspaceRoot, "contract.json"),
      statePath: resolve(workspaceRoot, "workspace.json"),
      manifestPath: resolve(workspaceRoot, "manifest.json"),
    };
  }

  function readState(contract) {
    const paths = pathsFor(contract);
    if (!existsSync(paths.statePath)) fail(`workspace for ${contract.conceptId} is not provisioned.`);
    const state = readJson(paths.statePath, "workspace state");
    if (
      state.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
      state.missionId !== contract.missionId ||
      state.conceptId !== contract.conceptId ||
      state.conceptVersion !== contract.conceptVersion ||
      state.contractIntegrityHash !== contract.integrityHash
    ) fail("workspace ownership or contract integrity does not match.");
    return { paths, state };
  }

  function view(contract, paths, state) {
    const manifest = existsSync(paths.manifestPath)
      ? readJson(paths.manifestPath, "prototype manifest")
      : null;
    return deepFreeze({
      missionId: contract.missionId,
      conceptId: contract.conceptId,
      conceptVersion: contract.conceptVersion,
      contractIntegrityHash: contract.integrityHash,
      rootPath: paths.rootPath,
      sourcePath: paths.sourcePath,
      evidencePath: paths.evidencePath,
      status: state.status,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      finalizedAt: state.finalizedAt,
      contentHash: manifest?.contentHash ?? null,
      fileManifest: manifest?.fileManifest ?? [],
    });
  }

  function get(contractInput) {
    const contract = normalizeConceptPrototypeContract(contractInput);
    const { paths, state } = readState(contract);
    return view(contract, paths, state);
  }

  function provision(contractInput) {
    const contract = normalizeConceptPrototypeContract(contractInput);
    const paths = pathsFor(contract);
    if (existsSync(paths.statePath)) return get(contract);
    mkdirSync(paths.sourcePath, { recursive: true });
    mkdirSync(paths.evidencePath, { recursive: true });
    const now = new Date().toISOString();
    atomicJson(paths.contractPath, contract);
    atomicJson(paths.statePath, {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      missionId: contract.missionId,
      conceptId: contract.conceptId,
      conceptVersion: contract.conceptVersion,
      contractIntegrityHash: contract.integrityHash,
      status: "PROVISIONED",
      createdAt: now,
      updatedAt: now,
      finalizedAt: null,
    });
    return get(contract);
  }

  function writeFiles(contractInput, files) {
    const contract = normalizeConceptPrototypeContract(contractInput);
    const { paths, state } = readState(contract);
    if (state.status === "FINALIZED") fail("finalized prototype files are immutable.");
    if (files === null || typeof files !== "object" || Array.isArray(files)) {
      fail("files must be an object keyed by expected file path.");
    }
    const expected = new Set(contract.expectedFiles);
    const entries = Object.entries(files);
    let totalBytes = 0;
    for (const [relativePath, content] of entries) {
      if (!expected.has(relativePath)) fail(`"${relativePath}" is not an expected file.`);
      if (typeof content !== "string") fail(`"${relativePath}" content must be text.`);
      const bytes = Buffer.byteLength(content);
      if (bytes > MAX_FILE_BYTES) fail(`"${relativePath}" exceeds the output limit.`);
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_BYTES) fail("prototype output exceeds the total limit.");
      const path = safeSourcePath(paths.sourcePath, relativePath);
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
        fail(`"${relativePath}" must not be a symbolic link.`);
      }
      atomicWrite(path, content);
    }
    const next = {
      ...state,
      status: "WRITTEN",
      updatedAt: new Date().toISOString(),
    };
    atomicJson(paths.statePath, next);
    return view(contract, paths, next);
  }

  function finalize(contractInput) {
    const contract = normalizeConceptPrototypeContract(contractInput);
    const { paths, state } = readState(contract);
    if (state.status === "FINALIZED") return view(contract, paths, state);
    const fileManifest = contract.expectedFiles.map((relativePath) => {
      const path = safeSourcePath(paths.sourcePath, relativePath);
      if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
        fail(`expected file "${relativePath}" is missing or unsafe.`);
      }
      const content = readFileSync(path);
      return { path: relativePath, contentHash: sha256(content), size: content.length };
    }).sort((left, right) => left.path.localeCompare(right.path));
    const contentHash = sha256(canonical({
      contractIntegrityHash: contract.integrityHash,
      fileManifest,
    }));
    const finalizedAt = new Date().toISOString();
    atomicJson(paths.manifestPath, {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      missionId: contract.missionId,
      conceptId: contract.conceptId,
      conceptVersion: contract.conceptVersion,
      contractIntegrityHash: contract.integrityHash,
      fileManifest,
      contentHash,
      finalizedAt,
    });
    const next = {
      ...state,
      status: "FINALIZED",
      updatedAt: finalizedAt,
      finalizedAt,
    };
    atomicJson(paths.statePath, next);
    return view(contract, paths, next);
  }

  function loadContractAt(workspaceRoot) {
    return normalizeConceptPrototypeContract(
      readJson(resolve(workspaceRoot, "contract.json"), "concept contract"),
    );
  }

  function list(missionId) {
    const missionPath = resolve(root, missionId);
    if (!isInside(root, missionPath) || !existsSync(missionPath)) return Object.freeze([]);
    const results = [];
    for (const conceptId of readdirSync(missionPath)) {
      const conceptPath = resolve(missionPath, conceptId);
      if (!statSync(conceptPath).isDirectory()) continue;
      for (const version of readdirSync(conceptPath)) {
        const workspaceRoot = resolve(conceptPath, version);
        if (!statSync(workspaceRoot).isDirectory()) continue;
        try {
          const contract = loadContractAt(workspaceRoot);
          results.push(get(contract));
        } catch {
          // Corrupt or partial directories are not projected as customer concepts.
        }
      }
    }
    return deepFreeze(results.sort((left, right) =>
      left.conceptId.localeCompare(right.conceptId) || left.conceptVersion - right.conceptVersion,
    ));
  }

  function runtimeRecords() {
    if (!existsSync(runtimeRegistryPath)) return [];
    const registry = readJson(runtimeRegistryPath, "runtime registry");
    if (registry.schemaVersion !== RUNTIME_REGISTRY_SCHEMA_VERSION || !Array.isArray(registry.records)) {
      fail("runtime registry schema is invalid.");
    }
    return registry.records;
  }

  function saveRuntimeRecord(record) {
    const records = runtimeRecords();
    const index = records.findIndex((entry) => entry.sessionId === record.sessionId);
    if (index >= 0) records[index] = structuredClone(record);
    else records.push(structuredClone(record));
    atomicJson(runtimeRegistryPath, {
      schemaVersion: RUNTIME_REGISTRY_SCHEMA_VERSION,
      records,
    });
    return deepFreeze(structuredClone(record));
  }

  function writeEvidenceFiles(contractInput, files) {
    const contract = normalizeConceptPrototypeContract(contractInput);
    const { paths, state } = readState(contract);
    if (state.status !== "FINALIZED") fail("evidence requires a finalized prototype workspace.");
    if (files === null || typeof files !== "object" || Array.isArray(files)) {
      fail("evidence files must be an object keyed by relative path.");
    }
    let totalBytes = 0;
    const manifest = [];
    for (const [relativePath, value] of Object.entries(files)) {
      const content = Buffer.isBuffer(value)
        ? value
        : typeof value === "string"
          ? Buffer.from(value, "utf8")
          : fail(`evidence file "${relativePath}" must be text or a Buffer.`);
      if (content.length > MAX_EVIDENCE_FILE_BYTES) {
        fail(`evidence file "${relativePath}" exceeds the output limit.`);
      }
      totalBytes += content.length;
      if (totalBytes > MAX_EVIDENCE_WRITE_BYTES) fail("evidence output exceeds the total limit.");
      const path = safeSourcePath(paths.evidencePath, relativePath);
      if (existsSync(path)) {
        if (!statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
          fail(`evidence file "${relativePath}" is unsafe.`);
        }
        const existing = readFileSync(path);
        if (!existing.equals(content)) fail(`evidence file "${relativePath}" is immutable.`);
      } else {
        atomicWrite(path, content);
      }
      manifest.push({ path: relativePath, contentHash: sha256(content), size: content.length });
    }
    return deepFreeze(manifest.sort((left, right) => left.path.localeCompare(right.path)));
  }

  function readEvidenceFile(contractInput, relativePath) {
    const contract = normalizeConceptPrototypeContract(contractInput);
    const { paths, state } = readState(contract);
    if (state.status !== "FINALIZED") fail("evidence requires a finalized prototype workspace.");
    const path = safeSourcePath(paths.evidencePath, relativePath);
    if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      fail(`evidence file "${relativePath}" is missing or unsafe.`);
    }
    const content = readFileSync(path);
    if (content.length > MAX_EVIDENCE_FILE_BYTES) {
      fail(`evidence file "${relativePath}" exceeds the read limit.`);
    }
    return content;
  }

  function readSourceFile(contractInput, relativePath) {
    const contract = normalizeConceptPrototypeContract(contractInput);
    const { paths, state } = readState(contract);
    if (state.status !== "FINALIZED") fail("source reads require a finalized prototype workspace.");
    const path = safeSourcePath(paths.sourcePath, relativePath);
    if (!existsSync(path) || !statSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
      fail(`source file "${relativePath}" is missing or unsafe.`);
    }
    const content = readFileSync(path);
    if (content.length > MAX_FILE_BYTES) {
      fail(`source file "${relativePath}" exceeds the read limit.`);
    }
    return content;
  }

  return Object.freeze({
    provision,
    writeFiles,
    finalize,
    get,
    list,
    loadContractAt,
    runtimeRecords,
    saveRuntimeRecord,
    writeEvidenceFiles,
    readEvidenceFile,
    readSourceFile,
  });
}
