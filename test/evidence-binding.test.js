import assert from "node:assert/strict";
import test from "node:test";

import { evidenceBindsToObligation } from "../src/work-plane/production-mission-service.js";

// A build reached VERIFYING and then failed on the last step: a scoped repair
// re-ran the production build while fixing a browser check, so the command
// evidence was stamped obligation-001 -- a browser-check obligation that does
// not accept command evidence at all. The build obligation then selected that
// newest run and the authority rejected the binding.
const BROWSER_OBLIGATION = {
  obligationId: "obligation-001",
  acceptanceCondition: {
    type: "browser-check-equals",
    check: "obligation-001",
    expected: true,
  },
  requiredEvidenceKinds: ["browser-interaction-result"],
};

const BUILD_OBLIGATION = {
  obligationId: "obligation-006",
  acceptanceCondition: { type: "command-exit-code-equals", expectedExitCode: 0 },
  requiredEvidenceKinds: ["command-exit-result"],
};

const OTHER_BUILD_OBLIGATION = {
  obligationId: "obligation-009",
  acceptanceCondition: { type: "command-exit-code-equals", expectedExitCode: 0 },
  requiredEvidenceKinds: ["command-exit-result"],
};

const ACTIVE = [BROWSER_OBLIGATION, BUILD_OBLIGATION, OTHER_BUILD_OBLIGATION];

test("command evidence stamped with a browser obligation does not bind to a build obligation", () => {
  const record = {
    kind: "command-exit-result",
    obligationReference: "obligation-001",
  };
  assert.equal(evidenceBindsToObligation(record, BUILD_OBLIGATION, ACTIVE), false);
});

test("command evidence stamped with this obligation binds", () => {
  const record = {
    kind: "command-exit-result",
    obligationReference: "obligation-006",
  };
  assert.equal(evidenceBindsToObligation(record, BUILD_OBLIGATION, ACTIVE), true);
});

test("command evidence from an identically-shaped obligation binds", () => {
  // Two obligations both proven by a zero exit from the same command are
  // interchangeable, and the authority accepts that too.
  const record = {
    kind: "command-exit-result",
    obligationReference: "obligation-009",
  };
  assert.equal(evidenceBindsToObligation(record, BUILD_OBLIGATION, ACTIVE), true);
});

test("evidence of the wrong kind never binds, whatever it is stamped with", () => {
  const record = {
    kind: "browser-interaction-result",
    obligationReference: "obligation-006",
  };
  assert.equal(evidenceBindsToObligation(record, BUILD_OBLIGATION, ACTIVE), false);
});

test("a missing record does not bind", () => {
  assert.equal(evidenceBindsToObligation(undefined, BUILD_OBLIGATION, ACTIVE), false);
});
