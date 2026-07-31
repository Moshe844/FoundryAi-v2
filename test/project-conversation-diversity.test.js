import assert from "node:assert/strict";
import test from "node:test";

import { normalizeProjectProfile } from "../src/domain/project-profile.js";

const cases = [
  ["photography", "marketing-website", "prospective client", "visual story browsing", "editorial and image-led"],
  ["booking", "web-application", "appointment customer", "time-slot reservation", "friendly and efficient"],
  ["api", "api-service", "integrating developer", "resource exchange", "precise and documentation-led"],
  ["directory", "web-application", "employee", "colleague lookup", "clear and information-dense"],
  ["portal", "web-application", "account customer", "account self-service", "trustworthy and reassuring"],
  ["expense", "web-application", "finance team member", "expense submission and review", "efficient and audit-friendly"],
  ["plumbing", "marketing-website", "local service customer", "service discovery and enquiry", "credible and approachable"],
  ["documentreview", "web-application", "document analyst", "AI-assisted document review", "quiet and task-focused"],
];

function profile([key, family, audience, journey, style], index) {
  return normalizeProjectProfile({
    missionId: `conversation-${key}`,
    profileVersion: 1,
    name: `${key} experience`,
    summary: `A ${key}-specific experience shaped around ${journey}.`,
    family,
    platform: "web",
    primaryActors: [audience],
    primaryJourneys: [`The ${audience} completes the ${journey} journey.`],
    outcomes: [`The ${key} feature supports ${journey}.`],
    capabilities: ["web-application"],
    dataConcepts: [`${key} record`],
    designDirection: {
      recommendedStyle: style,
      reason: `${style} supports the ${journey} purpose.`,
      layoutApproach: `A ${key}-specific layout led by ${journey}.`,
      tone: `${style} for the ${audience}.`,
      mobilePriority: `Keep ${journey} clear on smaller screens.`,
      accessibilityConsiderations: [
        `Use clear labels and visible focus throughout the ${key} experience.`,
      ],
    },
    includedDefaults: [`A clear ${key} loading and error state.`],
    customerContent: { supplied: [], missingBeforeLaunch: [] },
    observations: [`The ${journey} is the central ${key} workflow.`],
    designAlternatives: [],
    constraints: [`Keep the first ${key} release focused on ${journey}.`],
    assumptions: [`Foundry will optimise the ${key} flow for ${audience}.`],
    architectureDecisions: [
      `Use the certified web stack for the ${key} experience.`,
    ],
    openQuestions: [
      {
        questionId: `question-${index + 1}`,
        prompt: `What should change the ${key} workflow?`,
        reason: `The answer changes how ${journey} works.`,
        answerOptions: [
          `Let Foundry optimise ${journey}`,
          `Use a customer-defined ${key} workflow`,
        ],
      },
    ],
    contextualSuggestions: [
      {
        suggestionId: `suggestion-${index + 1}`,
        label: `Improve the ${key} follow-up`,
        rationale: `It gives the ${audience} a clearer next step after ${journey}.`,
      },
    ],
    sourceRequirementIds: [`requirement-${index + 1}`],
    selectedStack: {
      stackId: "nextjs-typescript-sqlite-npm-playwright",
      version: "1.0.0",
    },
    runtimeAdapterId: "nextjs-web-runtime",
    requirementContractVersion: 1,
    verificationPlan: {
      planId: `conversation-plan-${index + 1}`,
      checks: [
        {
          checkId: `check-${index + 1}`,
          label: `The ${key} feature is observable.`,
          origin: "foundry-derived",
          acceptanceCondition: {
            type: "browser-check-equals",
            check: `${key}Feature`,
            expected: true,
          },
          evidenceKinds: ["browser-interaction-result"],
          dependencyCheckIds: [],
        },
      ],
    },
  });
}

test("eight unrelated projects retain distinct conversation data without leakage", () => {
  const profiles = cases.map(profile);
  for (const select of [
    (item) => item.summary,
    (item) => item.primaryActors.join("|"),
    (item) => item.primaryJourneys.join("|"),
    (item) => item.designDirection.recommendedStyle,
    (item) => item.contextualSuggestions[0].label,
    (item) => item.openQuestions[0].prompt,
    (item) => item.assumptions[0],
    (item) => item.verificationPlan.checks[0].label,
  ]) {
    assert.equal(new Set(profiles.map(select)).size, cases.length);
  }

  for (const [index, item] of profiles.entries()) {
    const ownKey = cases[index][0];
    const serialized = JSON.stringify(item).toLowerCase();
    assert.match(serialized, new RegExp(ownKey, "u"));
    for (const [otherIndex, [otherKey]] of cases.entries()) {
      if (otherIndex !== index) {
        assert.doesNotMatch(
          serialized,
          new RegExp(`\\b${otherKey}\\b`, "u"),
        );
      }
    }
  }
});

test("sequential and concurrent normalization never shares project-owned state", async () => {
  const sequential = cases.map(profile);
  const concurrent = await Promise.all(
    cases.map(async (item, index) => profile(item, index)),
  );

  for (let index = 0; index < cases.length; index += 1) {
    const first = sequential[index];
    const second = concurrent[index];
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first.primaryActors, second.primaryActors);
    assert.notStrictEqual(first.primaryJourneys, second.primaryJourneys);
    assert.notStrictEqual(first.openQuestions, second.openQuestions);
    assert.notStrictEqual(first.contextualSuggestions, second.contextualSuggestions);
    assert.notStrictEqual(first.verificationPlan, second.verificationPlan);
    assert.equal(first.missionId, `conversation-${cases[index][0]}`);

    for (let other = 0; other < cases.length; other += 1) {
      if (other === index) continue;
      assert.notStrictEqual(first.primaryActors, sequential[other].primaryActors);
      assert.notStrictEqual(
        first.verificationPlan.checks,
        sequential[other].verificationPlan.checks,
      );
      assert.notEqual(first.missionId, sequential[other].missionId);
      assert.notEqual(
        first.verificationPlan.planId,
        sequential[other].verificationPlan.planId,
      );
    }
  }
});
