import assert from "node:assert/strict";
import test from "node:test";

import { buildEnforcesTypesAndLint } from "../src/work-plane/production-mission-service.js";

const CERTIFIED = [
  { path: "package.json", content: '{"scripts":{"build":"next build","typecheck":"tsc --noEmit","lint":"eslint ."}}' },
  { path: "eslint.config.mjs", content: "export default [];" },
  { path: "tsconfig.json", content: "{}" },
];

test("the certified stack lets next build cover types and lint", () => {
  assert.equal(buildEnforcesTypesAndLint(CERTIFIED), true);
});

test("a build told to ignore type errors keeps its standalone typecheck", () => {
  assert.equal(
    buildEnforcesTypesAndLint([
      ...CERTIFIED,
      { path: "next.config.mjs", content: "export default {typescript:{ignoreBuildErrors:true}};" },
    ]),
    false,
  );
});

test("a build told to skip lint keeps its standalone lint", () => {
  assert.equal(
    buildEnforcesTypesAndLint([
      ...CERTIFIED,
      { path: "next.config.mjs", content: "export default {eslint:{ignoreDuringBuilds:true}};" },
    ]),
    false,
  );
});

test("without an eslint config there is no build lint step to inherit", () => {
  assert.equal(
    buildEnforcesTypesAndLint(CERTIFIED.filter((f) => f.path !== "eslint.config.mjs")),
    false,
  );
});
