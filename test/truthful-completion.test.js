import assert from "node:assert/strict";
import test from "node:test";

import {
  createCompletionVerdict,
  normalizeDesignShortfall,
} from "../src/domain/verification.js";

// A real recorded build: the approved design was missed on surface-order,
// hierarchy and navigation, and the completion verdict said SATISFIED x14,
// NOT_SATISFIED x0, with the shortfall mentioned nowhere. The customer was
// told fourteen of fourteen.
const SATISFIED = [
  {
    obligationId: "obligation-001",
    result: "SATISFIED",
    deficiency: null,
    unverifiableCondition: null,
    evidenceReferences: [],
  },
];

function verdict(designShortfall) {
  return createCompletionVerdict({
    verdictId: "verdict-1",
    missionId: "mission-1",
    contractVersion: 1,
    verificationTimestamp: new Date().toISOString(),
    workspaceCheckpointReference: null,
    obligationVerdicts: SATISFIED,
    designShortfall,
  });
}

test("a delivered design shortfall travels on the completion verdict", () => {
  const shipped = verdict({
    failedAspects: ["surface-order", "hierarchy", "navigation"],
    comparedViewports: 3,
    reason: "Corrections stopped reducing the outstanding design aspects.",
  });
  assert.deepEqual(shipped.designShortfall.failedAspects, [
    "surface-order",
    "hierarchy",
    "navigation",
  ]);
  assert.equal(shipped.designShortfall.comparedViewports, 3);
});

test("prototype viewport evidence is reduced to its public count before completion", () => {
  // Fidelity evidence identifies each route and viewport. The completion
  // contract reports only how many viewports were compared.
  const viewportEvidence = ["/:390x844", "/:768x1024", "/:1280x900"];
  const shipped = verdict({
    failedAspects: ["responsive"],
    comparedViewports: viewportEvidence,
    reason: "The approved responsive transformation still differs.",
  });
  assert.equal(shipped.designShortfall.comparedViewports, 3);
});

test("the shortfall is inside the integrity hash, so it cannot be dropped quietly", () => {
  const shipped = verdict({
    failedAspects: ["typography"],
    comparedViewports: 3,
    reason: "Corrections stopped reducing the outstanding design aspects.",
  });
  const clean = verdict(null);
  assert.notEqual(shipped.integrityHash, clean.integrityHash);
});

test("a build that reproduced its approved design records no shortfall", () => {
  assert.equal(verdict(null).designShortfall, null);
});

test("delivery is still permitted: the obligations decide the overall result", () => {
  // Making a shortfall INCOMPLETE blocks the SUCCEEDED transition, which sent
  // proven builds back to repair and destroyed them. The verdict discloses the
  // shortfall; it does not withhold the working application.
  const shipped = verdict({
    failedAspects: ["colors"],
    comparedViewports: 3,
    reason: "Corrections stopped reducing the outstanding design aspects.",
  });
  assert.equal(shipped.overallResult, "COMPLETE");
  assert.notEqual(shipped.designShortfall, null);
});

test("a shortfall that names nothing is not a disclosure", () => {
  assert.throws(
    () =>
      normalizeDesignShortfall({
        failedAspects: [],
        comparedViewports: 3,
        reason: "Something fell short.",
      }),
    /at least one named aspect/u,
  );
  assert.throws(
    () =>
      normalizeDesignShortfall({
        failedAspects: ["colors"],
        comparedViewports: 3,
        reason: "",
      }),
    /reason/u,
  );
});

// Adding designShortfall to the verdict's required keys made every verdict
// recorded before the field existed fail replay, which 500'd the whole project
// list rather than one mission. Three shapes are on disk and all three must
// verify: absent, present-and-null, and present with a shortfall.
test("a verdict recorded before the field existed still verifies", () => {
  const legacy = createCompletionVerdict({
    verdictId: "verdict-legacy",
    missionId: "mission-1",
    contractVersion: 1,
    verificationTimestamp: "2026-01-01T00:00:00.000Z",
    workspaceCheckpointReference: null,
    obligationVerdicts: SATISFIED,
    // No designShortfall at all, exactly as the oldest records were written.
  });
  assert.equal("designShortfall" in legacy, false);

  // And its hash must be what it always was: adding the key would silently
  // invalidate every historical record.
  const recomputed = createCompletionVerdict({
    verdictId: "verdict-legacy",
    missionId: "mission-1",
    contractVersion: 1,
    verificationTimestamp: "2026-01-01T00:00:00.000Z",
    workspaceCheckpointReference: null,
    obligationVerdicts: SATISFIED,
    designShortfall: undefined,
  });
  assert.equal(recomputed.integrityHash, legacy.integrityHash);
});

test("a verdict written with an explicit null keeps the key and its own hash", () => {
  // Recorded while the field was being added. Re-hashing it in today's shape
  // would reject it, so the stored shape is preserved.
  const withNull = verdict(null);
  assert.equal("designShortfall" in withNull, true);
  assert.equal(withNull.designShortfall, null);

  const legacy = createCompletionVerdict({
    verdictId: "verdict-1",
    missionId: "mission-1",
    contractVersion: 1,
    verificationTimestamp: withNull.verificationTimestamp,
    workspaceCheckpointReference: null,
    obligationVerdicts: SATISFIED,
  });
  assert.notEqual(withNull.integrityHash, legacy.integrityHash);
});
