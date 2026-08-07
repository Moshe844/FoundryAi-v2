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
