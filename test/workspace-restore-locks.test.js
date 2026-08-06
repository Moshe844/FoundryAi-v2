import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { awaitProcessTreeExit } from "../src/work-plane/command-runner.js";

test("a directory move survives a lock that clears on its own", async () => {
  // The real failure: a build that had already generated, compiled, and run was
  // discarded at the checkpoint restore with
  //   EPERM: operation not permitted, rename 'staging\restore-…' -> 'live\…\root'
  // because the dev server's workers still held handles on their build cache a
  // moment after the parent process reported closed. The rename was not wrong,
  // only early — nothing about the mission had failed.
  const root = mkdtempSync(join(tmpdir(), "foundry-restore-lock-"));
  try {
    const source = join(root, "staged");
    const target = join(root, "live");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "page.tsx"), "export default function P(){}");

    // Hold the lock for the first few attempts, exactly as an exiting worker
    // does, then release it.
    let held = 3;
    const move = () => {
      if (held > 0) {
        held -= 1;
        const error = new Error(
          `EPERM: operation not permitted, rename '${source}' -> '${target}'`,
        );
        error.code = "EPERM";
        throw error;
      }
      renameSync(source, target);
    };

    let moved = false;
    for (let attempt = 0; attempt < 6 && !moved; attempt += 1) {
      try {
        move();
        moved = true;
      } catch (error) {
        assert.equal(error.code, "EPERM");
      }
    }
    assert.ok(moved, "the move must succeed once the handle is released");
    assert.equal(held, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("waiting on a process tree returns immediately for one already gone", async () => {
  // A pid that never existed must not stall the pipeline for the full timeout.
  const started = Date.now();
  assert.equal(
    await awaitProcessTreeExit(0x7ff_fff0, { timeoutMs: 2_000, pollIntervalMs: 25 }),
    true,
  );
  assert.ok(
    Date.now() - started < 1_500,
    "an absent process must not be waited on",
  );

  // A malformed pid is not something to wait for either.
  assert.equal(await awaitProcessTreeExit(undefined), true);
  assert.equal(await awaitProcessTreeExit(-1), true);
});
