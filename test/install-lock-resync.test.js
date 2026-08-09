import assert from "node:assert/strict";
import test from "node:test";

import { lockOutOfSyncWithManifest } from "../src/work-plane/production-mission-service.js";

// Verbatim from the build that died. npm names the remedy in the message --
// "update your lock file with npm install" -- and Foundry sent it to a model
// instead, which edited package.json twice, never touched the lock, and
// exhausted the install budget with nothing built.
const REAL_FAILURE = [
  "npm error code EUSAGE",
  "npm error",
  "npm error `npm ci` can only install packages when your package.json and",
  "package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock",
  "file with `npm install` before continuing.",
  "npm error",
  "npm error Invalid: lock file's @emnapi/wasi-threads@1.2.1 does not satisfy @emnapi/wasi-threads@1.2.3",
].join("\n");

test("the lock mismatch that killed a build is recognised", () => {
  assert.equal(lockOutOfSyncWithManifest(REAL_FAILURE), true);
});

test("each shape npm uses for it is recognised", () => {
  // Five different packages produced this across recorded builds, and npm
  // phrases the detail differently depending on what drifted.
  assert.equal(
    lockOutOfSyncWithManifest("npm error Invalid: lock file's better-sqlite3@13.0.1 does not satisfy better-sqlite3@12.4.1"),
    true,
  );
  assert.equal(
    lockOutOfSyncWithManifest("npm error Missing: streams@1.0.0 from lock file"),
    true,
  );
});

test("an unrelated install failure is left to the repair path", () => {
  // Regenerating a lock does nothing for these, and treating them as a
  // mismatch would spend a command and hide the real fault.
  assert.equal(lockOutOfSyncWithManifest("npm ERR! network timeout while fetching"), false);
  assert.equal(lockOutOfSyncWithManifest("npm ERR! 404 Not Found - GET https://registry.npmjs.org/nope"), false);
  assert.equal(lockOutOfSyncWithManifest("npm ERR! ERESOLVE unable to resolve dependency tree"), false);
});

test("empty or absent output is not a mismatch", () => {
  assert.equal(lockOutOfSyncWithManifest(""), false);
  assert.equal(lockOutOfSyncWithManifest(undefined), false);
  assert.equal(lockOutOfSyncWithManifest(null), false);
});
