import assert from "node:assert/strict";
import test from "node:test";

import { FAST_INITIAL_UNDERSTANDING_SCHEMA } from "../src/understanding-plane/project-understanding-service.js";
import { WEB_STACK_MANIFEST } from "../src/domain/toolchain-stack.js";

// Understanding failed on every route with "$.capabilities must contain at most
// 10 items" while the manifest offered 11. A project that genuinely needed all
// of them -- persistence, records, tests and export together -- produced a
// valid answer the schema refused. Simple requests never reached the ceiling,
// so it sat unnoticed until one did.
test("the capability ceiling can express selecting every capability", () => {
  const capabilities = FAST_INITIAL_UNDERSTANDING_SCHEMA.properties.capabilities;
  assert.equal(
    capabilities.maxItems,
    WEB_STACK_MANIFEST.supportedCapabilities.length,
    "a project may need every capability the stack offers",
  );
});

test("the ceiling is derived, so it cannot drift when a capability is added", () => {
  // The bug was a hardcoded 10. Deriving it is the fix, not raising it to 11.
  const capabilities = FAST_INITIAL_UNDERSTANDING_SCHEMA.properties.capabilities;
  assert.ok(
    capabilities.maxItems >= capabilities.items.enum.length,
    "the ceiling must never sit below the enum it bounds",
  );
});
