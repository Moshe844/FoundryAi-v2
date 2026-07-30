import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import {
  CheckpointIntegrityError,
  CheckpointNotFoundError,
  DuplicateCheckpointError,
  WorkspaceIsolationError,
  WorkspacePathError,
  WorkspaceValidationError,
} from "../domain/errors.js";
import {
  createCheckpointRecord,
  validateCheckpointRecord,
} from "../domain/workspace.js";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function assertIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new WorkspaceValidationError(`${label} is malformed.`);
  }
}

function isInside(parent, child) {
  const relation = relative(parent, child);
  return (
    relation === "" ||
    (!relation.startsWith(`..${sep}`) &&
      relation !== ".." &&
      !isAbsolute(relation))
  );
}

function writeExclusiveJson(path, value) {
  let descriptor;
  try {
    descriptor = openSync(path, "wx");
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

export function createWorkspaceStore({ workspaceDirectory }) {
  const root = resolve(workspaceDirectory);
  const liveDirectory = resolve(root, "live");
  const checkpointDirectory = resolve(root, "checkpoints");
  const blobDirectory = resolve(root, "blobs");
  const stagingDirectory = resolve(root, "staging");

  function ensureStoreDirectories() {
    for (const directory of [
      liveDirectory,
      checkpointDirectory,
      blobDirectory,
      stagingDirectory,
    ]) {
      mkdirSync(directory, { recursive: true });
    }
  }

  function areaFor(workspaceId) {
    assertIdentifier(workspaceId, "workspaceId");
    const area = resolve(liveDirectory, workspaceId);
    if (!isInside(liveDirectory, area)) {
      throw new WorkspacePathError("Workspace path escaped the live root.");
    }
    return area;
  }

  function expectedRootPath(workspaceId) {
    return resolve(areaFor(workspaceId), "root");
  }

  function ownerPath(workspaceId) {
    return resolve(areaFor(workspaceId), "owner.json");
  }

  function readOwner(workspaceId) {
    const path = ownerPath(workspaceId);
    if (!existsSync(path)) {
      return null;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new WorkspaceIsolationError(
        `Workspace "${workspaceId}" has invalid ownership metadata.`,
        { cause: error },
      );
    }
  }

  function assertOwnership(workspaceId, missionId) {
    const owner = readOwner(workspaceId);
    if (
      owner === null ||
      owner.workspaceId !== workspaceId ||
      owner.missionId !== missionId
    ) {
      throw new WorkspaceIsolationError(
        `Workspace "${workspaceId}" does not belong to mission "${missionId}".`,
      );
    }
  }

  function provisionRoot({ workspaceId, missionId }) {
    ensureStoreDirectories();
    assertIdentifier(missionId, "missionId");
    const area = areaFor(workspaceId);
    const owner = readOwner(workspaceId);
    if (owner !== null) {
      assertOwnership(workspaceId, missionId);
    } else {
      mkdirSync(area, { recursive: false });
      writeExclusiveJson(ownerPath(workspaceId), {
        workspaceId,
        missionId,
      });
    }
    const workspaceRoot = expectedRootPath(workspaceId);
    mkdirSync(workspaceRoot, { recursive: true });
    accessSync(workspaceRoot, constants.R_OK | constants.W_OK);
    return workspaceRoot;
  }

  function assertWorkspaceRoot({ workspaceId, missionId, rootPath }) {
    assertOwnership(workspaceId, missionId);
    const expected = expectedRootPath(workspaceId);
    if (resolve(rootPath) !== expected || !isInside(liveDirectory, expected)) {
      throw new WorkspaceIsolationError(
        `Workspace "${workspaceId}" root does not match its assigned boundary.`,
      );
    }
    if (!existsSync(expected) || !lstatSync(expected).isDirectory()) {
      throw new WorkspaceIsolationError(
        `Workspace "${workspaceId}" root is unavailable.`,
      );
    }
    accessSync(expected, constants.R_OK | constants.W_OK);
    return expected;
  }

  function safePath({ workspaceId, missionId, rootPath, relativePath }) {
    if (
      typeof relativePath !== "string" ||
      relativePath.length === 0 ||
      isAbsolute(relativePath)
    ) {
      throw new WorkspacePathError(
        "Workspace paths must be non-empty relative paths.",
      );
    }
    const workspaceRoot = assertWorkspaceRoot({
      workspaceId,
      missionId,
      rootPath,
    });
    const target = resolve(workspaceRoot, relativePath);
    if (!isInside(workspaceRoot, target) || target === workspaceRoot) {
      throw new WorkspacePathError(
        "Workspace path traversal or absolute-path escape was rejected.",
      );
    }

    let cursor = workspaceRoot;
    for (const segment of relativePath.split(/[\\/]+/u)) {
      if (segment === "" || segment === "." || segment === "..") {
        throw new WorkspacePathError(
          "Workspace path contains an unsafe segment.",
        );
      }
      cursor = resolve(cursor, segment);
      if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
        throw new WorkspacePathError(
          "Workspace symlink traversal was rejected.",
        );
      }
    }
    return target;
  }

  function blobPath(contentHash) {
    return resolve(blobDirectory, contentHash);
  }

  function mutationTarget(workspace, relativePath) {
    return safePath({
      workspaceId: workspace.workspaceId,
      missionId: workspace.missionId,
      rootPath: workspace.rootPath,
      relativePath,
    });
  }

  function assertParentDirectory(target, relativePath) {
    const parent = dirname(target);
    if (!existsSync(parent) || !lstatSync(parent).isDirectory()) {
      throw new WorkspacePathError(
        `Workspace parent for "${relativePath}" does not exist.`,
      );
    }
  }

  function persistBlob(content, contentHash) {
    const path = blobPath(contentHash);
    if (existsSync(path)) {
      if (sha256(readFileSync(path)) !== contentHash) {
        throw new CheckpointIntegrityError(
          contentHash,
          "an existing content-addressed blob is corrupt",
        );
      }
      return;
    }
    let descriptor;
    try {
      descriptor = openSync(path, "wx");
      writeFileSync(descriptor, content);
      fsyncSync(descriptor);
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
  }

  function captureManifest(rootPath) {
    const entries = [];
    const transientTopLevelDirectories = new Set([
      ".next",
      "node_modules",
      "playwright-report",
      "test-results",
    ]);

    function visit(directory, prefix) {
      const children = readdirSync(directory, { withFileTypes: true }).sort(
        (left, right) => left.name.localeCompare(right.name),
      );
      for (const child of children) {
        if (
          prefix === "" &&
          child.isDirectory() &&
          transientTopLevelDirectories.has(child.name)
        ) {
          continue;
        }
        const absolute = resolve(directory, child.name);
        const relativePath =
          prefix === "" ? child.name : `${prefix}/${child.name}`;
        if (child.isSymbolicLink()) {
          throw new WorkspacePathError(
            `Checkpoint capture rejected symlink "${relativePath}".`,
          );
        }
        if (child.isDirectory()) {
          visit(absolute, relativePath);
          continue;
        }
        if (!child.isFile()) {
          throw new WorkspacePathError(
            `Checkpoint capture rejected special file "${relativePath}".`,
          );
        }
        const content = readFileSync(absolute);
        const contentHash = sha256(content);
        persistBlob(content, contentHash);
        entries.push({
          path: relativePath.replaceAll("\\", "/"),
          size: content.byteLength,
          contentHash,
        });
      }
    }

    visit(rootPath, "");
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  function checkpointPath(checkpointId) {
    assertIdentifier(checkpointId, "checkpointId");
    return resolve(checkpointDirectory, `${checkpointId}.json`);
  }

  function getCheckpoint(checkpointId) {
    const path = checkpointPath(checkpointId);
    if (!existsSync(path)) {
      throw new CheckpointNotFoundError(checkpointId);
    }
    let record;
    try {
      record = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw new CheckpointIntegrityError(
        checkpointId,
        "the checkpoint record is not valid JSON",
        { cause: error },
      );
    }
    const validated = validateCheckpointRecord(record, checkpointId);
    for (const entry of validated.contentManifest) {
      const pathToBlob = blobPath(entry.contentHash);
      if (
        !existsSync(pathToBlob) ||
        sha256(readFileSync(pathToBlob)) !== entry.contentHash
      ) {
        throw new CheckpointIntegrityError(
          checkpointId,
          `content blob for "${entry.path}" is missing or corrupt`,
        );
      }
    }
    return validated;
  }

  function persistCheckpoint(
    {
      checkpointId,
      workspaceId,
      missionId,
      parentCheckpointId,
      creationTimestamp,
      reason,
      rootPath,
    },
    { allowExisting = false } = {},
  ) {
    const path = checkpointPath(checkpointId);
    const workspaceRoot = assertWorkspaceRoot({
      workspaceId,
      missionId,
      rootPath,
    });
    const record = createCheckpointRecord({
      checkpointId,
      workspaceId,
      missionId,
      parentCheckpointId,
      creationTimestamp,
      reason,
      contentManifest: captureManifest(workspaceRoot),
    });
    if (existsSync(path)) {
      if (!allowExisting) {
        throw new DuplicateCheckpointError(checkpointId);
      }
      const existing = getCheckpoint(checkpointId);
      if (JSON.stringify(existing) !== JSON.stringify(record)) {
        throw new DuplicateCheckpointError(checkpointId);
      }
      return { record: existing, recovered: true };
    }
    writeExclusiveJson(path, record);
    return { record: getCheckpoint(checkpointId), recovered: false };
  }

  function prepareRestore({
    workspace,
    checkpoint,
    preserveTransientDirectories = [],
  }) {
    assertWorkspaceRoot({
      workspaceId: workspace.workspaceId,
      missionId: workspace.missionId,
      rootPath: workspace.rootPath,
    });
    if (
      checkpoint.workspaceId !== workspace.workspaceId ||
      checkpoint.missionId !== workspace.missionId
    ) {
      throw new WorkspaceIsolationError(
        `Checkpoint "${checkpoint.checkpointId}" belongs to another workspace or mission.`,
      );
    }

    const token = randomUUID();
    const stagedRoot = resolve(stagingDirectory, `restore-${token}`);
    mkdirSync(stagedRoot, { recursive: false });
    for (const entry of checkpoint.contentManifest) {
      const target = resolve(stagedRoot, ...entry.path.split("/"));
      if (!isInside(stagedRoot, target)) {
        throw new WorkspacePathError(
          "Checkpoint restoration attempted to escape its staging root.",
        );
      }
      mkdirSync(dirname(target), { recursive: true });
      const content = readFileSync(blobPath(entry.contentHash));
      if (sha256(content) !== entry.contentHash) {
        throw new CheckpointIntegrityError(
          checkpoint.checkpointId,
          `restore blob for "${entry.path}" is corrupt`,
        );
      }
      writeFileSync(target, content, { flag: "wx" });
    }

    const transientTopLevelDirectories = new Set([
      ".next",
      "node_modules",
      "playwright-report",
      "test-results",
    ]);
    if (
      !Array.isArray(preserveTransientDirectories) ||
      preserveTransientDirectories.some(
        (name) => !transientTopLevelDirectories.has(name),
      )
    ) {
      throw new WorkspaceValidationError(
        "Checkpoint restore may preserve only known transient artifact directories.",
      );
    }

    const liveRoot = expectedRootPath(workspace.workspaceId);
    const safeTransientDirectories = [];
    for (const name of [...new Set(preserveTransientDirectories)].sort()) {
      const source = resolve(liveRoot, name);
      if (!existsSync(source)) continue;
      const stat = lstatSync(source);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new WorkspacePathError(
          `Transient artifact "${name}" is not a safe directory.`,
        );
      }
      safeTransientDirectories.push(name);
    }
    const backup = resolve(areaFor(workspace.workspaceId), `restore-backup-${token}`);
    renameSync(liveRoot, backup);
    renameSync(stagedRoot, liveRoot);
    const preservedDirectories = [];
    for (const name of safeTransientDirectories) {
      const source = resolve(backup, name);
      renameSync(source, resolve(liveRoot, name));
      preservedDirectories.push(name);
    }
    let finalized = false;
    return Object.freeze({
      commit() {
        if (!finalized) {
          rmSync(backup, { recursive: true, force: true });
          finalized = true;
        }
      },
      rollback() {
        if (!finalized) {
          for (const name of preservedDirectories) {
            const source = resolve(liveRoot, name);
            if (existsSync(source)) {
              renameSync(source, resolve(backup, name));
            }
          }
          rmSync(liveRoot, { recursive: true, force: true });
          renameSync(backup, liveRoot);
          finalized = true;
        }
      },
    });
  }

  function prepareRelease({ workspace }) {
    assertWorkspaceRoot({
      workspaceId: workspace.workspaceId,
      missionId: workspace.missionId,
      rootPath: workspace.rootPath,
    });
    const area = areaFor(workspace.workspaceId);
    const quarantine = resolve(
      stagingDirectory,
      `release-${workspace.workspaceId}-${randomUUID()}`,
    );
    renameSync(area, quarantine);
    let finalized = false;
    return Object.freeze({
      commit() {
        if (!finalized) {
          rmSync(quarantine, { recursive: true, force: true });
          finalized = true;
        }
      },
      rollback() {
        if (!finalized) {
          renameSync(quarantine, area);
          finalized = true;
        }
      },
    });
  }

  function integrityFingerprint(checkpointIds = null) {
    const hash = createHash("sha256");
    if (checkpointIds !== null) {
      const blobNames = new Set();
      for (const checkpointId of [...new Set(checkpointIds)].sort((left, right) =>
        left.localeCompare(right),
      )) {
        const name = `${checkpointId}.json`;
        const path = resolve(checkpointDirectory, name);
        hash.update(name);
        if (!existsSync(path)) {
          hash.update("<missing>");
          continue;
        }
        const content = readFileSync(path);
        hash.update(content);
        try {
          const checkpoint = JSON.parse(content.toString("utf8"));
          for (const entry of checkpoint.contentHashes ?? []) {
            if (typeof entry?.contentHash === "string") {
              blobNames.add(entry.contentHash);
            }
          }
        } catch {
          // Retrieval/replay performs the authoritative structural validation.
        }
      }
      for (const name of [...blobNames].sort((left, right) =>
        left.localeCompare(right),
      )) {
        hash.update(name);
        const path = resolve(blobDirectory, name);
        if (!existsSync(path)) {
          hash.update("<missing>");
          continue;
        }
        const details = statSync(path);
        hash.update(String(details.size));
        hash.update(String(details.mtimeMs));
      }
      return hash.digest("hex");
    }
    for (const base of [checkpointDirectory, blobDirectory]) {
      if (!existsSync(base)) continue;
      for (const entry of readdirSync(base, { withFileTypes: true })
        .filter((candidate) => candidate.isFile())
        .sort((left, right) => left.name.localeCompare(right.name))) {
        hash.update(relative(root, resolve(base, entry.name)));
        hash.update(readFileSync(resolve(base, entry.name)));
      }
    }
    return hash.digest("hex");
  }

  return Object.freeze({
    root,
    integrityFingerprint,
    provisionRoot,
    expectedRootPath,
    assertWorkspaceRoot,
    persistCheckpoint,
    getCheckpoint,
    prepareRestore,
    prepareRelease,
    writeNewFile({ workspace, relativePath, content }) {
      const target = mutationTarget(workspace, relativePath);
      assertParentDirectory(target, relativePath);
      if (existsSync(target)) {
        throw new WorkspacePathError(
          `Workspace path "${relativePath}" already exists.`,
        );
      }
      writeFileSync(target, content, { flag: "wx" });
    },
    replaceFile({ workspace, relativePath, content }) {
      const target = mutationTarget(workspace, relativePath);
      if (!existsSync(target) || !lstatSync(target).isFile()) {
        throw new WorkspacePathError(
          `Workspace file "${relativePath}" does not exist.`,
        );
      }
      const temporary = resolve(
        dirname(target),
        `.foundry-replace-${randomUUID()}`,
      );
      writeFileSync(temporary, content, { flag: "wx" });
      renameSync(temporary, target);
    },
    deleteFile({ workspace, relativePath }) {
      const target = mutationTarget(workspace, relativePath);
      if (!existsSync(target) || !lstatSync(target).isFile()) {
        throw new WorkspacePathError(
          `Workspace file "${relativePath}" does not exist.`,
        );
      }
      rmSync(target, { force: false });
    },
    createDirectory({ workspace, relativePath }) {
      const target = mutationTarget(workspace, relativePath);
      assertParentDirectory(target, relativePath);
      if (existsSync(target)) {
        throw new WorkspacePathError(
          `Workspace path "${relativePath}" already exists.`,
        );
      }
      mkdirSync(target, { recursive: false });
    },
    resolveWorkingDirectory({ workspace, relativePath = "." }) {
      const target =
        relativePath === "."
          ? assertWorkspaceRoot({
              workspaceId: workspace.workspaceId,
              missionId: workspace.missionId,
              rootPath: workspace.rootPath,
            })
          : mutationTarget(workspace, relativePath);
      if (!existsSync(target) || !lstatSync(target).isDirectory()) {
        throw new WorkspacePathError(
          `Workspace directory "${relativePath}" does not exist.`,
        );
      }
      return target;
    },
    listFiles({ workspace, relativePath = "." }) {
      const base =
        relativePath === "."
          ? assertWorkspaceRoot({
              workspaceId: workspace.workspaceId,
              missionId: workspace.missionId,
              rootPath: workspace.rootPath,
            })
          : mutationTarget(workspace, relativePath);
      if (!existsSync(base) || !lstatSync(base).isDirectory()) {
        throw new WorkspacePathError(
          `Workspace directory "${relativePath}" does not exist.`,
        );
      }
      const entries = [];
      function visit(directory) {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const target = resolve(directory, entry.name);
          if (entry.isSymbolicLink()) {
            throw new WorkspacePathError(
              "Workspace listing rejected a symbolic link.",
            );
          }
          if (entry.isDirectory()) {
            visit(target);
          } else if (entry.isFile()) {
            entries.push(relative(base, target).split(sep).join("/"));
          } else {
            throw new WorkspacePathError(
              "Workspace listing rejected a special file.",
            );
          }
        }
      }
      visit(base);
      return entries.sort();
    },
    pathInfo({ workspace, relativePath }) {
      const target = mutationTarget(workspace, relativePath);
      if (!existsSync(target)) {
        return { exists: false, type: null };
      }
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) {
        throw new WorkspacePathError(
          "Workspace path inspection rejected a symbolic link.",
        );
      }
      return {
        exists: true,
        type: stat.isFile()
          ? "file"
          : stat.isDirectory()
            ? "directory"
            : "special",
      };
    },
    readFile({ workspaceId, missionId, rootPath, relativePath }) {
      const target = safePath({
        workspaceId,
        missionId,
        rootPath,
        relativePath,
      });
      if (!existsSync(target) || !lstatSync(target).isFile()) {
        throw new WorkspacePathError(
          `Workspace file "${relativePath}" does not exist.`,
        );
      }
      return readFileSync(target);
    },
  });
}
