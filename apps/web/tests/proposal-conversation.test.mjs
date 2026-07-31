import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

const projectTypes = [
  "photographer portfolio",
  "appointment booking app",
  "restaurant reservations REST API",
  "internal employee directory",
  "customer support portal",
  "expense-management web application",
  "plumbing company website",
  "AI-assisted document-review tool",
];

test("the proposal is a progressive pre-build conversation", async () => {
  const [discovery, composer, understanding, proposal, design, questions] =
    await Promise.all([
      source("../app/components/project-discovery.tsx"),
      source("../app/components/customer-input-composer.tsx"),
      source("../app/components/project-understanding.tsx"),
      source("../app/components/foundry-proposal.tsx"),
      source("../app/components/design-direction.tsx"),
      source("../app/components/clarification-questions.tsx"),
    ]);

  assert.match(understanding, /Here&rsquo;s what I think you need/);
  assert.match(understanding, /focus\(\{ preventScroll: true \}\)/);
  assert.match(proposal, /What I&rsquo;d build/);
  assert.match(proposal, /What I&rsquo;d include automatically/);
  assert.match(proposal, /conversation-details/);
  assert.match(design, /Choose how this project should feel/);
  assert.match(design, /Foundry recommends/);
  assert.match(design, /directions were created for this project/);
  assert.match(design, /Describe your own style/);
  assert.match(questions, /Let Foundry choose/);
  assert.doesNotMatch(questions, /Skip for now/);
  assert.match(questions, /Something else/);
  assert.match(discovery, /Anything else\?/);
  assert.match(discovery, /Continue with Foundry&rsquo;s recommendations/);
  assert.match(composer, /data-contract-field="customer-note"/);
  assert.match(discovery, /kind: "design-direction"/);
  assert.match(discovery, /Why I recommend this/);
});

test("project proposal content is sourced and contains no admin sample copy", async () => {
  const production = (
    await Promise.all([
      source("../app/components/project-discovery.tsx"),
      source("../app/components/project-understanding.tsx"),
      source("../app/components/foundry-proposal.tsx"),
      source("../app/components/design-direction.tsx"),
      source("../app/components/foundry-recommendations.tsx"),
      source("../experience/selectors.ts"),
    ])
  ).join("\n");

  for (const leaked of [
    "Administrator",
    "Unapproved visitor",
    "admin landing page",
    "account details",
    "access status",
    "forgot-password flow",
    "two-step verification",
    "session timeout warning",
  ]) {
    assert.doesNotMatch(production, new RegExp(leaked, "iu"));
  }
  assert.match(production, /profile\.designDirection/);
  assert.match(production, /profile\.primaryJourneys/);
  assert.match(production, /profile\.includedDefaults/);
  assert.match(production, /profile\.contextualSuggestions/);
  assert.match(production, /profile\.openQuestions/);
});

test("the validated model contract carries every conversation field", async () => {
  const service = await source(
    "../../../src/understanding-plane/project-understanding-service.js",
  );
  for (const field of [
    "summary",
    "audiences",
    "primaryJourneys",
    "designDirection",
    "recommendedStyle",
    "layoutApproach",
    "tone",
    "mobilePriority",
    "accessibilityConsiderations",
    "proposedFeatures",
    "includedDefaults",
    "recommendations",
    "observations",
    "importantDecisions",
    "assumptions",
  ]) {
    assert.match(service, new RegExp(`"${field}"`, "u"));
  }
  assert.match(service, /additionalProperties: false/);
  assert.match(service, /validateStructuredModelOutput/);
});

test("the Decision Brief retains design defaults, answers, and assumptions", async () => {
  const [brief, selectors, discovery, composer] = await Promise.all([
    source("../app/components/decision-brief.tsx"),
    source("../experience/selectors.ts"),
    source("../app/components/project-discovery.tsx"),
    source("../app/components/customer-input-composer.tsx"),
  ]);
  assert.match(brief, /Design direction/);
  assert.match(brief, /brief\.designDirection\.recommendedStyle\.value/);
  assert.match(brief, /brief\.decisions\.map/);
  assert.match(brief, /brief\.assumptions\.value\.map/);
  assert.match(selectors, /mission\.profile\.designDirection/);
  assert.match(selectors, /mission\.profile\.assumptions/);
  assert.match(discovery, /kind: "design-direction"/);
  assert.match(composer, /data-contract-field="customer-note"/);
});

test("the eight required project types remain explicit diversity fixtures", () => {
  assert.equal(projectTypes.length, 8);
  assert.equal(new Set(projectTypes).size, 8);
  assert.deepEqual(projectTypes, [
    "photographer portfolio",
    "appointment booking app",
    "restaurant reservations REST API",
    "internal employee directory",
    "customer support portal",
    "expense-management web application",
    "plumbing company website",
    "AI-assisted document-review tool",
  ]);
});
