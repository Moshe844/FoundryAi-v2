import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("Phase C is a modular sourced experience, not a page-local prototype", async () => {
  const [page, discovery, selectors] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/project-discovery.tsx"),
    source("../experience/selectors.ts"),
  ]);

  assert.match(page, /import \{ ProjectDiscovery \}/);
  assert.match(page, /<ProjectDiscovery/);
  assert.doesNotMatch(page, /function (TheRead|QuestionCard|Suggestions)\(/);
  assert.match(selectors, /profile\.observations/);
  assert.match(selectors, /profile\.designAlternatives/);
  assert.match(selectors, /profile\.primaryJourneys\.map/);
  assert.match(selectors, /exclusions: sourced\(/);

  const ordered = [
    "<ProjectUnderstanding",
    "<FoundryProposal",
    "<DesignDirection",
    "<FoundryRecommendations",
    "<ClarificationQuestions",
    "Anything else Foundry should know?",
    "Ready when you are",
  ].map((needle) => [needle, discovery.indexOf(needle)]);
  ordered[2][1] = discovery.indexOf("<DesignDirection", ordered[1][1] + 1);
  for (const [needle, index] of ordered) {
    assert.ok(index > -1, `${needle} is missing`);
  }
  for (let index = 1; index < ordered.length; index += 1) {
    assert.ok(
      ordered[index - 1][1] < ordered[index][1],
      `${ordered[index - 1][0]} must precede ${ordered[index][0]}`,
    );
  }
});

test("every material question provides recommendation, options, and custom input", async () => {
  const questions = await source(
    "../app/components/clarification-questions.tsx",
  );
  for (const copy of [
    "Let Foundry choose",
    "Recommended",
    "More options",
    "Something else&hellip;",
    "Why I&rsquo;m asking",
  ]) {
    assert.match(questions, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(questions, /options\.slice\(0, 4\)/);
  assert.match(questions, /role="radiogroup"/);
  assert.match(questions, /role="radio"/);
  assert.match(questions, /ArrowDown/);
  assert.match(questions, /ArrowRight/);
  assert.match(questions, /ArrowUp/);
  assert.match(questions, /ArrowLeft/);
  assert.match(questions, /Foundry decides\. Recommended:/);
  assert.doesNotMatch(questions, /Skip for now/u);
  assert.match(questions, /kind: "decision"/u);
  assert.match(questions, /sourceProfileVersion/u);
});

test("Phase C guards customer copy and preserves non-blocking submission", async () => {
  const [discovery, questions, recommendations, language] = await Promise.all([
    source("../app/components/project-discovery.tsx"),
    source("../app/components/clarification-questions.tsx"),
    source("../app/components/foundry-recommendations.tsx"),
    source("../experience/plain-language.ts"),
  ]);
  assert.match(questions, /design-review/);
  assert.match(recommendations, /design-review/);
  assert.match(language, /internalLanguageTerm/);
  assert.match(discovery, /answers\[decision\.questionId\] \?\? \{ mode: "none" \}/);
  assert.doesNotMatch(discovery, /disabled=\{[^}]*answered/);
  assert.match(
    discovery,
    /kind: "recommendation"/,
  );
  assert.match(discovery, /customer-proposal-confirmation/);
  assert.match(discovery, /Updating the plan\u2026/);
});

test("the first live profile is reviewed even when no questions are needed", async () => {
  const [selectors, server] = await Promise.all([
    source("../experience/selectors.ts"),
    source("../local-api/server.mjs"),
  ]);
  assert.match(
    selectors,
    /!mission\.proposalConfirmed[\s\S]*mission\.profile\.openQuestions\.length > 0/,
  );
  assert.match(
    selectors,
    /\["INTAKE", "CLARIFYING", "CONTRACTED"\]\.includes\(mission\.state\)/,
  );
  assert.match(server, /customer-proposal-confirmation/);
  assert.match(server, /clarificationAnswers\?\.some/);
});

test("the understanding model owns optional observations and alternatives", async () => {
  const [service, profile, projectDesign] = await Promise.all([
    source("../../../src/understanding-plane/project-understanding-service.js"),
    source("../../../src/domain/project-profile.js"),
    source("../../../src/domain/project-design.js"),
  ]);
  assert.match(service, /projectDesign/);
  assert.match(projectDesign, /foundryInsights/);
  assert.match(projectDesign, /observations: NON_EMPTY_STRING_ARRAY_SCHEMA/);
  assert.doesNotMatch(service, /small trade business/i);
  assert.doesNotMatch(profile, /observations: \[\]/);
  assert.doesNotMatch(profile, /fallbackActors/);
  assert.match(
    profile,
    /designAlternatives\.filter\(\(alternative\) => alternative\.recommended\)/,
  );
});

test("slow catalogue refresh cannot block the local Foundry service", async () => {
  const server = await source("../local-api/server.mjs");
  assert.match(server, /for \(const \[providerId\] of providerDefinitions\)/);
  assert.match(server, /void bootstrapProviders\(\)\.catch/);
  assert.doesNotMatch(server, /\nawait bootstrapProviders\(\);\n/);
  assert.match(
    server,
    /request\.method === "POST" && url\.pathname === "\/providers\/refresh"/,
  );
});
