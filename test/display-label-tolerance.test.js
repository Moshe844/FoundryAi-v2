import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeProjectProfile } from "../src/domain/project-profile.js";

// A real recorded profile, so only the labels under test differ from something
// Foundry actually produced and accepted.
const RECORDED = JSON.parse(
  readFileSync(new URL("./fixtures-recorded-profile.json", import.meta.url), "utf8"),
);

// The request was one word: "Calculator". Five understanding attempts died in a
// row -- three on "sampleLabels contains duplicates", two on "sampleLabels[1]
// must describe a real project-specific value" -- and the project sat in
// CLARIFYING with no profile, no concepts, and a continue button that could
// only silently return. A calculator's labels are "=", "+", "%" and "C", and
// there is not a letter or digit between them.
function withLabels(sampleLabels) {
  const profile = structuredClone(RECORDED);
  profile.designAlternatives[0].visualSystem.sampleLabels = sampleLabels;
  return profile;
}

test("the recorded profile is valid as captured", () => {
  assert.doesNotThrow(() => normalizeProjectProfile(structuredClone(RECORDED)));
});

test("a calculator may label its keys with operators", () => {
  assert.doesNotThrow(() => normalizeProjectProfile(withLabels(["7", "=", "+", "C"])));
});

test("two controls may carry the same label", () => {
  assert.doesNotThrow(() =>
    normalizeProjectProfile(withLabels(["View", "View", "Archive"])),
  );
});

test("the labels survive rather than being deduplicated away", () => {
  const normalized = normalizeProjectProfile(withLabels(["View", "View", "Archive"]));
  assert.deepEqual(normalized.designAlternatives[0].visualSystem.sampleLabels, [
    "View",
    "View",
    "Archive",
  ]);
});

test("a placeholder label is still refused", () => {
  assert.throws(
    () => normalizeProjectProfile(withLabels(["=", "TBD", "C"])),
    /must describe a real project-specific value/u,
  );
});

test("an empty label is still refused", () => {
  assert.throws(
    () => normalizeProjectProfile(withLabels(["=", "   ", "C"])),
    /must be a non-empty string/u,
  );
});
