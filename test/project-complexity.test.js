import assert from "node:assert/strict";
import test from "node:test";

import {
  modelDepthForComplexity,
  projectComplexityScore,
} from "../src/domain/contract-bound-execution.js";

// A todo dashboard measured 14 and routed to the ARCHITECTURE tier. Eleven of
// those points were stack plumbing present on every certified web build, so a
// todo list and a bank scored almost the same and every project paid the
// deepest tier's latency -- on file generation, and again on each repair.
const TODO_DASHBOARD = {
  capabilities: [
    "automated-tests",
    "browser-verification",
    "create-records",
    "development-runtime",
    "production-build",
    "refresh-persistence",
    "typescript",
    "web-application",
  ],
  integrationRequirements: [],
  primaryJourneys: ["add a task", "complete a task", "filter tasks"],
  secondaryJourneys: [],
};

test("a small product is not scored as an architecture problem", () => {
  const score = projectComplexityScore(TODO_DASHBOARD);
  // create-records and refresh-persistence are real; the other six are plumbing.
  assert.equal(score, 5);
  assert.equal(modelDepthForComplexity(score), 2);
});

test("capabilities every build carries contribute nothing", () => {
  const bare = projectComplexityScore({
    capabilities: [
      "automated-tests",
      "browser-verification",
      "development-runtime",
      "package-export",
      "production-build",
      "typescript",
      "web-application",
    ],
    primaryJourneys: [],
  });
  assert.equal(bare, 0, "a contract describing no product scores nothing");
});

test("capabilities that describe the product still count", () => {
  const withData = projectComplexityScore({
    capabilities: ["typescript", "web-application", "sqlite-persistence", "update-records"],
    primaryJourneys: [],
  });
  assert.equal(withData, 2);
});

test("a genuinely large product still reaches the deepest tier", () => {
  // Modelled on a recorded contract: a multi-role portal with integrations.
  const portal = projectComplexityScore({
    capabilities: ["sqlite-persistence", "create-records", "update-records", "refresh-persistence", "typescript"],
    integrationRequirements: ["mail", "payments"],
    primaryJourneys: ["a", "b", "c", "d", "e"],
    secondaryJourneys: ["f"],
  });
  assert.ok(portal >= 10, `expected a large product to score 10 or more, got ${portal}`);
  assert.equal(modelDepthForComplexity(portal), 4);
});

test("the depth ladder is monotonic and bounded", () => {
  assert.equal(modelDepthForComplexity(0), 2);
  assert.equal(modelDepthForComplexity(5), 2);
  assert.equal(modelDepthForComplexity(6), 3);
  assert.equal(modelDepthForComplexity(9), 3);
  assert.equal(modelDepthForComplexity(10), 4);
  assert.equal(modelDepthForComplexity(99), 4);
});

test("journeys are what actually move the score", () => {
  // The property that was missing: describing more product must cost more
  // depth, and describing more plumbing must not.
  const base = { capabilities: ["typescript", "web-application"], primaryJourneys: ["a"] };
  const richer = { ...base, primaryJourneys: ["a", "b", "c", "d", "e", "f"] };
  assert.ok(projectComplexityScore(richer) > projectComplexityScore(base));
  const morePlumbing = {
    ...base,
    capabilities: [...base.capabilities, "production-build", "automated-tests", "package-export"],
  };
  assert.equal(projectComplexityScore(morePlumbing), projectComplexityScore(base));
});
