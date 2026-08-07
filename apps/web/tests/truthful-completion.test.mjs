import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectExecutionProjection } from "../local-api/execution-projection.mjs";
import { selectFoundryExperience } from "../experience/selectors.ts";

// A real delivered mission, captured from the local API: SUCCEEDED, every
// obligation satisfied. The build this guards against looked exactly like it,
// except that the approved design was missed on three measured aspects -- and
// it still reported "fourteen of fourteen contract checks verified", with the
// shortfall recorded nowhere the customer could see.
const DELIVERED = JSON.parse(
  await readFile(new URL("./fixtures-succeeded-mission.json", import.meta.url), "utf8"),
);

const SHORTFALL = {
  failedAspects: ["surface-order", "hierarchy", "navigation"],
  comparedViewports: 3,
  reason: "Corrections stopped reducing the outstanding design aspects.",
};

function missionWith(designShortfall) {
  return {
    ...DELIVERED,
    executionProjection: { ...DELIVERED.executionProjection, designShortfall },
  };
}

test("the projection carries a delivered design shortfall from the verdict", () => {
  const withShortfall = projectExecutionProjection({
    contract: { contractVersion: 1, obligations: [] },
    events: [
      { type: "MISSION_TRANSITION", transition: { to: "EXECUTING" } },
      {
        type: "COMPLETION_VERDICT_RECORDED",
        completionVerdict: { obligationVerdicts: [], designShortfall: SHORTFALL },
      },
    ],
    profile: { capabilities: [] },
  });
  assert.deepEqual(withShortfall.designShortfall.failedAspects, SHORTFALL.failedAspects);

  const clean = projectExecutionProjection({
    contract: { contractVersion: 1, obligations: [] },
    events: [{ type: "MISSION_TRANSITION", transition: { to: "EXECUTING" } }],
    profile: { capabilities: [] },
  });
  assert.equal(clean.designShortfall, null);
});

test("a build that missed the approved design is never described as complete", () => {
  const shipped = selectFoundryExperience(missionWith(SHORTFALL)).completion;

  // Every obligation really is satisfied. On its own that count is exactly what
  // misled the customer, so it must stay true and stop being the whole story.
  assert.equal(shipped.unverifiedOutcomes.length, 0);
  assert.equal(shipped.provedCount.value, shipped.totalCount.value);

  assert.equal(shipped.complete.value, false);
  assert.deepEqual(
    shipped.designShortfall.value.failedAspects,
    SHORTFALL.failedAspects,
  );
});

test("the same build with its design reproduced is still called complete", () => {
  const clean = selectFoundryExperience(missionWith(null)).completion;
  assert.equal(clean.complete.value, true);
  assert.equal(clean.designShortfall.value, null);
});
