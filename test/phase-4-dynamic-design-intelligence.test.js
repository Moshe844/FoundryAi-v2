import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ProjectDesignQualityError,
  normalizeProjectDesign,
  validateProjectDesignQuality,
} from "../src/index.js";

function designFor({ audience, subject, style }) {
  const outcome = `${audience} can review ${subject} and complete the next important action without staff assistance.`;
  return {
    projectIntent: {
      customerOutcome: outcome,
      businessContext: `The organisation needs to reduce repeated coordination while keeping ${subject} trustworthy for ${audience}.`,
      intendedUsers: [audience],
      primaryGoal: `${audience} can understand ${subject} and act confidently in one visit.`,
      secondaryGoals: ["Reduce avoidable staff follow-up."],
      successDefinition: `${audience} can find the current record, understand its meaning, and complete the next action.`,
      constraints: ["The first release keeps exceptional decisions with staff."],
      confidence: { score: 0.9, rationale: "The audience, repeated task, and desired outcome are explicit." },
    },
    userExperiencePlan: {
      primaryJourneys: [`${audience} reviews ${subject}, sees what changed, and completes the next action.`],
      secondaryJourneys: ["Staff correct a source record and explain the change."],
      criticalMoments: ["The next important action is unmistakable."],
      failureStates: ["A missing record explains who can resolve it."],
      trustMoments: ["Each status names its source and last update."],
      repeatedTasks: [`Review changes to ${subject}.`],
      adminResponsibilities: ["Staff maintain source records and exception guidance."],
    },
    productProposal: {
      essentialCapabilities: [outcome],
      recommendedCapabilities: ["Show meaningful changes since the prior visit."],
      intentionallyExcludedCapabilities: ["Exceptional decisions stay with staff in the first release."],
      futureCapabilities: ["Notifications after the source data proves reliable."],
      rationale: "This scope solves the frequent coordination problem without automating exceptional decisions.",
      dependencies: ["A reliable source for current records."],
      scopeImpact: "The first release stays focused on review, explanation, and action.",
    },
    designDirection: {
      visualPersonality: style,
      tone: "Direct, reassuring, and specific about current status",
      layoutStrategy: "Lead with current status and next action, then reveal supporting detail",
      informationDensity: "Moderate density with compact history for repeat visits",
      navigationApproach: "A shallow overview with direct paths to the repeated task",
      responsivePriority: "Keep the primary action fully usable on a phone",
      accessibilityNeeds: ["Use text and icons rather than color alone for status."],
      contentStrategy: "Place the source and last update beside consequential information",
      interactionStyle: "Confirm consequential changes and keep review actions immediate",
      rationale: `${audience} reviewing ${subject} need confidence in the next action before they need visual novelty.`,
    },
    designAlternatives: [
      {
        name: style,
        description: `Optimises rapid comprehension of ${subject} while keeping the next action prominent.`,
        whyItFits: `${audience} repeatedly review ${subject} and need the next action without staff assistance.`,
        layoutApproach: `A status-led workspace organised around ${subject} and the next action.`,
        visualPersonality: style,
        informationDensity: "Moderate density with compact history",
        navigationApproach: `Shallow navigation around the repeated ${subject} workflow.`,
        mobileBehavior: "The current status and action remain first on small screens",
        tradeoff: "Accepts less decorative storytelling in exchange for faster repeat use.",
        confidence: { score: 0.91, rationale: `The repeated ${subject} workflow rewards rapid comprehension.` },
        recommended: true,
        preview: { typographyCharacter: "Direct and legible", spacingDensity: "Balanced", colorMood: "Quiet and trustworthy", hierarchy: "Status, action, evidence" },
      },
      {
        name: "Guided and editorial",
        description: `Optimises first-time explanation of ${subject} with a more guided reading sequence.`,
        whyItFits: `${audience} who are new to ${subject} may need a guided explanation before acting.`,
        layoutApproach: `A sequenced explanation of ${subject} with progressive supporting detail.`,
        visualPersonality: "Guided and editorial",
        informationDensity: "Low density with progressive disclosure",
        navigationApproach: `A stepwise reading path through ${subject}.`,
        mobileBehavior: "The explanation becomes a focused vertical sequence",
        tradeoff: "Adds more reading before experienced users reach repeated actions.",
        confidence: { score: 0.76, rationale: `The ${subject} workflow may need first-use explanation.` },
        recommended: false,
        preview: { typographyCharacter: "Editorial and explanatory", spacingDensity: "Open", colorMood: "Warm and calm", hierarchy: "Context, explanation, action" },
      },
      {
        name: "Compact operational view",
        description: `Optimises frequent comparison of ${subject} through a denser task-focused workspace.`,
        whyItFits: `${audience} returning often to ${subject} can compare changes with fewer transitions.`,
        layoutApproach: `A compact comparison layout grouped by ${subject} status.`,
        visualPersonality: "Compact operational view",
        informationDensity: "High density with scannable rows",
        navigationApproach: `Record-first navigation across related ${subject}.`,
        mobileBehavior: "Dense rows collapse into prioritized summaries",
        tradeoff: "Requires more familiarity from people visiting for the first time.",
        confidence: { score: 0.7, rationale: `Frequent ${subject} review may benefit from comparison density.` },
        recommended: false,
        preview: { typographyCharacter: "Compact and utilitarian", spacingDensity: "Tight", colorMood: "Cool and focused", hierarchy: "Records, changes, actions" },
      },
    ],
    foundryInsights: {
      observations: [`The repeated burden for ${audience} is understanding changes in ${subject}, not merely opening a record.`],
      opportunities: ["A change summary can prevent unnecessary staff follow-up."],
      risks: ["An unexplained stale status could undermine trust."],
      ambiguities: [],
      assumptions: ["Staff remain responsible for correcting source records."],
      confidence: { score: 0.86, rationale: "The main workflow is clear and the exceptional path remains bounded." },
    },
    decisions: [],
    recommendations: [{
      title: "Change-focused return view",
      specificValue: `Shows ${audience} what changed in ${subject} since the prior visit.`,
      whyThisProjectNeedsIt: `${audience} repeat this review and need the new action, not another undifferentiated record list.`,
      impact: "Adds focused comparison scope without a new external integration.",
      selectedByDefault: true,
      confidence: { score: 0.9, rationale: "The repeated review workflow directly benefits from comparison." },
      requiredDependencies: ["A last-updated value for each source record"],
    }, {
      title: "Explain the latest change",
      specificValue: `Shows ${audience} what changed in ${subject} since the prior visit.`,
      whyThisProjectNeedsIt: `${audience} repeating the ${subject} review need the changed fact before older detail.`,
      impact: "Adds comparison using the existing dated source record.",
      selectedByDefault: true,
      confidence: { score: 0.85, rationale: "The repeated workflow benefits from change emphasis." },
      requiredDependencies: ["A dated source record"],
    }, {
      title: "Give exceptions a clear owner",
      specificValue: `Tells ${audience} who can resolve an exception in ${subject}.`,
      whyThisProjectNeedsIt: `${audience} need a trustworthy next step when ${subject} cannot be completed independently.`,
      impact: "Adds ownership content without automating exceptional decisions.",
      selectedByDefault: true,
      confidence: { score: 0.82, rationale: "The bounded exception path needs visible ownership." },
      requiredDependencies: ["A responsible staff role"],
    }],
    verificationPlan: [{
      observableOutcome: `${outcome} The running interface shows the current record and next action.`,
      acceptanceMethod: "browser-check",
      evidenceRequired: ["A recorded browser interaction showing the current record and next action"],
      sourceRequirement: "customer-intent-1",
      origin: "customer-stated",
      dependencyIndexes: [],
    }],
  };
}

test("Phase 4 validates and retains meaningful design alternatives", () => {
  const normalized = validateProjectDesignQuality(
    designFor({
      audience: "community garden coordinators",
      subject: "plot assignments and shared work days",
      style: "Warm, practical, and season-aware",
    }),
    { originalRequest: "A planner for community garden coordinators managing plot assignments and shared work days" },
  );
  assert.equal(normalized.designAlternatives.length, 3);
  assert.equal(normalized.designAlternatives[0].recommended, true);
  assert.equal(
    normalized.designAlternatives[0].tradeoff,
    "Accepts less decorative storytelling in exchange for faster repeat use.",
  );
  assert(Object.isFrozen(normalized.designAlternatives));
});

test("Phase 4 rejects cosmetic alternatives and generic observations", () => {
  const oneAlternative = designFor({
    audience: "clinic coordinators",
    subject: "room readiness and equipment handoffs",
    style: "Calm operational clarity",
  });
  oneAlternative.designAlternatives.pop();
  assert.throws(
    () => normalizeProjectDesign(oneAlternative),
    /three to seven meaningful directions/u,
  );

  const genericObservation = designFor({
    audience: "clinic coordinators",
    subject: "room readiness and equipment handoffs",
    style: "Calm operational clarity",
  });
  genericObservation.foundryInsights.observations = [
    "A modern responsive design should provide an intuitive experience for everyone.",
  ];
  assert.throws(
    () => validateProjectDesignQuality(genericObservation),
    ProjectDesignQualityError,
  );
});

test("Phase 4 produces meaningfully different intelligence for unrelated work", () => {
  const inputs = [
    ["museum visitors", "quiet-gallery routes and exhibit context", "Editorial, spacious, and contemplative"],
    ["warehouse shift leads", "dock exceptions and pallet handoffs", "Dense, urgent, and operational"],
    ["choir volunteers", "rehearsal attendance and sheet-music readiness", "Welcoming, rhythmic, and communal"],
  ];
  const signatures = inputs.map(([audience, subject, style]) => {
    const design = validateProjectDesignQuality(
      designFor({ audience, subject, style }),
      { originalRequest: `Create a tool for ${audience} handling ${subject}` },
    );
    return JSON.stringify({
      direction: design.designDirection,
      alternatives: design.designAlternatives,
      observations: design.foundryInsights.observations,
      recommendations: design.recommendations,
    });
  });
  assert.equal(new Set(signatures).size, inputs.length);
  for (let index = 0; index < signatures.length; index += 1) {
    const others = signatures.filter((_, candidate) => candidate !== index);
    assert(others.every((other) => other !== signatures[index]));
  }
});

test("Phase 4 carries model intelligence into the customer working session", () => {
  const understanding = readFileSync(
    new URL("../src/understanding-plane/project-understanding-service.js", import.meta.url),
    "utf8",
  );
  const profile = readFileSync(
    new URL("../src/domain/project-profile.js", import.meta.url),
    "utf8",
  );
  const discovery = readFileSync(
    new URL("../apps/web/app/components/project-discovery.tsx", import.meta.url),
    "utf8",
  );
  const recommendations = readFileSync(
    new URL("../apps/web/app/components/foundry-recommendations.tsx", import.meta.url),
    "utf8",
  );

  assert.match(understanding, /PROJECT_DESIGN_MODEL_FIELDS/u);
  assert.match(understanding, /localValidationFailure/u);
  assert.match(understanding, /Copy every decision recommendation character-for-character/u);
  assert.match(understanding, /designAlternatives: projectDesign\.designAlternatives\.map/u);
  assert.match(understanding, /selectedByDefault: suggestion\.selectedByDefault/u);
  assert.match(understanding, /impact: suggestion\.impact/u);
  assert.match(profile, /requiredDependencies/u);
  assert.match(discovery, /<FoundryObservations observations=\{proposal\.observations\}/u);
  assert.match(discovery, /recommendation\.selectedByDefault\.value === true/u);
  assert.match(discovery, /Remove this project idea:/u);
  assert.match(recommendations, /"Ask why"/u);
  assert.match(recommendations, /Impact:/u);
  assert.doesNotMatch(understanding, /if\s*\([^)]*(?:portal|booking|photographer)/iu);
});
