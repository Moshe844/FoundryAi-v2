import assert from "node:assert/strict";
import test from "node:test";

import { modelRequestTimeoutMs } from "../src/capability-plane/live-ai-adapters.js";

test("complete design prototypes receive the file-generation timeout budget", () => {
  assert.equal(
    modelRequestTimeoutMs({
      executionStage: "DESIGN_PROTOTYPE",
      taskClass: "FILE_GENERATION",
    }),
    300_000,
  );
  assert.equal(
    modelRequestTimeoutMs({ taskClass: "PROJECT_UNDERSTANDING" }),
    120_000,
  );
});
