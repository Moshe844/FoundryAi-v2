import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";

const STACK_VERSION = "1.5.0";
const VERSIONS = Object.freeze({
  "@eslint/eslintrc": "3.3.1",
  "@playwright/test": "1.62.1",
  "@types/better-sqlite3": "7.6.13",
  "@types/node": "22.15.21",
  "@types/react": "19.1.2",
  "@types/react-dom": "19.1.2",
  "better-sqlite3": "13.0.1",
  eslint: "9.29.0",
  "eslint-config-next": "15.5.23",
  next: "15.5.23",
  react: "19.1.0",
  "react-dom": "19.1.0",
  typescript: "5.8.3",
});
const RUNTIME = new Set([
  "better-sqlite3",
  "next",
  "react",
  "react-dom",
]);

function canonicalPackages(definition) {
  return {
    packages: Object.fromEntries(Object.entries({
      ...(definition.dependencies ?? {}),
      ...(definition.devDependencies ?? {}),
    }).sort(([left], [right]) => left.localeCompare(right))),
    overrides: Object.fromEntries(
      Object.entries(definition.overrides ?? {}).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}

function fingerprint(definition) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalPackages(definition)))
    .digest("hex");
}

function foundryRoot(start) {
  let cursor = resolve(start);
  while (dirname(cursor) !== cursor) {
    if (basename(cursor) === ".foundry") return cursor;
    if (existsSync(join(cursor, ".foundry"))) return join(cursor, ".foundry");
    cursor = dirname(cursor);
  }
  throw new Error("The certified dependency cache root could not be located.");
}

function cachePaths(start) {
  const root = join(
    foundryRoot(start),
    "cache",
    `certified-stack-${STACK_VERSION}`,
  );
  return {
    root,
    modules: join(root, "node_modules"),
    lock: join(root, "package-lock.json"),
    ready: join(root, "ready.json"),
  };
}

function cloneTree(source, destination) {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      cloneTree(from, to);
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        symlinkSync(readlinkSync(from), to, "junction");
      } catch {
        copyFileSync(resolve(dirname(from), readlinkSync(from)), to);
      }
      continue;
    }
    if (!lstatSync(from).isFile()) continue;
    try {
      linkSync(from, to);
    } catch {
      copyFileSync(from, to);
    }
  }
}

function runNpmInstall(cwd) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--prefer-offline", "--no-audit", "--no-fund"],
    { cwd, stdio: "inherit", windowsHide: true, shell: process.platform === "win32" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function warm() {
  const paths = cachePaths(process.cwd());
  const dependencies = {};
  const devDependencies = {};
  for (const [name, version] of Object.entries(VERSIONS)) {
    (RUNTIME.has(name) ? dependencies : devDependencies)[name] = version;
  }
  const definition = {
    name: "foundry-certified-dependency-image",
    private: true,
    version: STACK_VERSION,
    dependencies,
    devDependencies,
    overrides: { postcss: "8.5.26", sharp: "0.35.3" },
  };
  const expected = fingerprint(definition);
  if (existsSync(paths.ready) && existsSync(paths.modules) && existsSync(paths.lock)) {
    const ready = JSON.parse(readFileSync(paths.ready, "utf8"));
    if (ready.fingerprint === expected) return;
  }
  const staging = `${paths.root}.warming-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(staging, "package.json"), `${JSON.stringify(definition, null, 2)}\n`);
  runNpmInstall(staging);
  writeFileSync(
    join(staging, "ready.json"),
    `${JSON.stringify({ fingerprint: expected, stackVersion: STACK_VERSION })}\n`,
  );
  if (!existsSync(paths.root)) {
    try {
      renameSync(staging, paths.root);
    } catch (error) {
      if (error?.code !== "EPERM") throw error;
      // Antivirus/indexing can temporarily deny a directory rename on
      // Windows. Materialize the immutable image with hard links instead.
      mkdirSync(paths.root, { recursive: true });
      cloneTree(join(staging, "node_modules"), paths.modules);
      copyFileSync(join(staging, "package.json"), join(paths.root, "package.json"));
      copyFileSync(join(staging, "package-lock.json"), paths.lock);
      copyFileSync(join(staging, "ready.json"), paths.ready);
      rmSync(staging, { recursive: true, force: true });
    }
  } else {
    rmSync(staging, { recursive: true, force: true });
  }
}

function installProject() {
  const projectRoot = process.cwd();
  const definition = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  const paths = cachePaths(projectRoot);
  const expected = fingerprint(definition);
  if (existsSync(paths.ready) && existsSync(paths.modules) && existsSync(paths.lock)) {
    const ready = JSON.parse(readFileSync(paths.ready, "utf8"));
    if (ready.fingerprint === expected) {
      const destination = join(projectRoot, "node_modules");
      rmSync(destination, { recursive: true, force: true });
      cloneTree(paths.modules, destination);
      copyFileSync(paths.lock, join(projectRoot, "package-lock.json"));
      process.stdout.write("Installed certified dependencies from the prewarmed image.\n");
      return;
    }
  }
  runNpmInstall(projectRoot);
}

if (process.argv.includes("--warm")) warm();
else installProject();
