import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  approvedContractRequirementCatalogue,
  createApprovedProjectContract,
  createModelTaskContract,
  validateApprovedProjectContractConsistency,
  validateProjectDesignQuality,
} from "../src/index.js";
import { normalizeCustomerFollowUpAnswers } from "../src/understanding-plane/project-understanding-service.js";

const cases = [
  ["customer-portal", "Build a customer portal", "account holders", "service requests", "resolve an open request", "status workspace", ["Self-service resolution", "Staff assisted resolution", "Scheduled follow-up"]],
  ["photographer-portfolio", "Build a photographer portfolio", "prospective clients", "photography collections", "request a suitable shoot", "story-led gallery", ["Editorial collection story", "Service-led portfolio", "Minimal image index"]],
  ["appointment-booking", "Build appointment booking", "people booking appointments", "available time slots", "confirm a suitable appointment", "availability-first scheduler", ["Earliest suitable time", "Preferred provider first", "Service type first"]],
  ["business-website", "Build a business website", "prospective customers", "business services", "choose the right service", "trust-led service guide", ["Service comparison path", "Outcome guided path", "Direct contact path"]],
  ["employee-tool", "Build an internal employee tool", "operations employees", "team work requests", "complete assigned work", "task-first operations desk", ["Personal work queue", "Team status board", "Process guided workspace"]],
  ["rest-api", "Build a REST API", "integration developers", "reservation resources", "complete a valid integration", "contract-first API workspace", ["Resource oriented contract", "Workflow oriented contract", "Event guided contract"]],
  ["document-review", "Build AI document review", "document reviewers", "flagged document findings", "confirm an evidence-backed finding", "evidence-first review desk", ["Finding by finding review", "Document comparison review", "Risk prioritized review"]],
  ["expense-approval", "Build expense approval", "expense approvers", "submitted expenses", "approve a justified expense", "exception-first approval queue", ["Policy exception first", "Employee submission first", "Department budget first"]],
  ["admin-sign-in", "Build admin sign-in", "authorized administrators", "protected administration access", "enter the admin area safely", "assurance-led access flow", ["Low friction sign in", "Risk adaptive sign in", "Recovery guided sign in"]],
  ["parent-portal", "Build a school parent portal", "parents and guardians", "school updates and student tasks", "act on a school request", "family action hub", ["Student timeline first", "Urgent school actions first", "Calendar and message first"]],
].map(([slug, request, users, subject, action, direction, options]) => ({
  slug, request, users, subject, action, direction, options,
}));

function projectDesign(spec) {
  const directions = [
    {
      name: spec.direction,
      density: "Balanced detail for confident repeat use",
      nav: `Navigation follows ${spec.subject} from overview to action`,
      mobile: `The next ${spec.action} remains prominent on a phone`,
      mood: "Focused and trustworthy",
    },
    {
      name: `${spec.slug} guided journey`,
      density: "Low density with progressive explanation",
      nav: `A guided sequence explains ${spec.subject} before action`,
      mobile: `Each ${spec.subject} step becomes a focused mobile screen`,
      mood: "Warm and explanatory",
    },
    {
      name: `${spec.slug} expert workspace`,
      density: "High density for frequent experienced users",
      nav: `A compact workspace exposes related ${spec.subject} together`,
      mobile: `Dense ${spec.subject} groups collapse into prioritized summaries`,
      mood: "Efficient and operational",
    },
  ];
  const recommendations = [
    `Remember ${spec.slug} progress`,
    `Explain ${spec.slug} exceptions`,
    `Surface the next ${spec.slug} action`,
  ];
  return {
    projectIntent: {
      customerOutcome: `${spec.users} can review ${spec.subject} and ${spec.action} without avoidable assistance.`,
      businessContext: `This ${spec.slug} project reduces friction around ${spec.subject} while preserving clear ownership and trust.`,
      intendedUsers: [spec.users],
      primaryGoal: `${spec.users} can understand ${spec.subject} and ${spec.action} in one focused visit.`,
      secondaryGoals: [`Reduce repeated questions about ${spec.subject}.`],
      successDefinition: `${spec.users} can find the current state, understand the consequence, and ${spec.action} successfully.`,
      constraints: [`The first ${spec.slug} release excludes unrelated back-office automation.`],
      confidence: { score: 0.88, rationale: `The ${spec.slug} audience and primary outcome are explicit.` },
    },
    userExperiencePlan: {
      primaryJourneys: [`A ${spec.users} user reviews ${spec.subject}, compares the available path, and ${spec.action}.`],
      secondaryJourneys: [`A returning user checks what changed in ${spec.subject}.`],
      criticalMoments: [`The user understands the consequence before they ${spec.action}.`],
      failureStates: [`Unavailable ${spec.subject} explains what happened and offers a safe next step.`],
      trustMoments: [`Every consequential ${spec.subject} state identifies its source and current owner.`],
      repeatedTasks: [`Review changes in ${spec.subject}.`],
      adminResponsibilities: [`Project owners keep ${spec.subject} accurate and resolve exceptions.`],
    },
    productProposal: {
      essentialCapabilities: [`Users can review ${spec.subject} and ${spec.action} in the running product.`],
      recommendedCapabilities: [`Show what changed in ${spec.subject} since the prior visit.`],
      intentionallyExcludedCapabilities: [`Unrelated ${spec.slug} back-office automation remains outside the first release.`],
      futureCapabilities: [`Optional notifications after the ${spec.slug} workflow proves reliable.`],
      rationale: `The first release completes the central ${spec.slug} outcome before adding adjacent operational breadth.`,
      dependencies: [`A reliable source for current ${spec.subject}.`],
      scopeImpact: `The scope remains centered on ${spec.action} and its necessary trust states.`,
    },
    designDirection: {
      visualPersonality: spec.direction,
      tone: `Direct and reassuring language for ${spec.users}`,
      layoutStrategy: `Lead with current ${spec.subject}, then show consequence and next action`,
      informationDensity: directions[0].density,
      navigationApproach: directions[0].nav,
      responsivePriority: directions[0].mobile,
      accessibilityNeeds: ["Meaning never depends on color alone."],
      contentStrategy: `Name status, source, and ownership beside ${spec.subject}`,
      interactionStyle: `Keep routine review immediate and confirm consequential ${spec.slug} actions`,
      rationale: `${spec.users} need to understand ${spec.subject} before they can ${spec.action} with confidence.`,
    },
    designAlternatives: directions.map((item, index) => ({
      name: item.name,
      description: `${item.name} organizes ${spec.subject} for ${spec.users} around the real decision sequence.`,
      whyItFits: `${spec.users} need a distinct way to understand ${spec.subject} before they ${spec.action} confidently.`,
      layoutApproach: index === 0
        ? `A ${spec.subject} overview followed by consequence and action`
        : `A ${item.name} layout grounded in ${spec.subject}`,
      visualPersonality: item.name,
      informationDensity: item.density,
      navigationApproach: item.nav,
      mobileBehavior: item.mobile,
      tradeoff: index === 0
        ? "Prioritizes repeat comprehension over decorative storytelling and broad exploration."
        : `Improves ${index === 1 ? "first-time guidance" : "expert scanning"} but makes the opposite use pattern slower.`,
      confidence: { score: 0.9 - index * 0.08, rationale: `${item.name} directly supports the ${spec.subject} workflow.` },
      recommended: index === 0,
      preview: {
        typographyCharacter: index === 2 ? "Compact operational labels" : "Clear humanist headings",
        spacingDensity: item.density,
        colorMood: item.mood,
        hierarchy: `${spec.subject} first, consequence second, action third`,
      },
    })),
    foundryInsights: {
      observations: [`The ${spec.slug} request is mainly about making ${spec.subject} understandable before a consequential action.`],
      opportunities: [`A visible change summary can shorten repeated review of ${spec.subject}.`],
      risks: [`Stale ${spec.subject} could create more confusion than an explicit unavailable state.`],
      ambiguities: [],
      assumptions: [`The project owner remains responsible for correcting ${spec.subject}.`],
      confidence: { score: 0.86, rationale: `The ${spec.slug} workflow is clear and the remaining choice has a safe default.` },
    },
    decisions: [{
      customerFriendlyQuestion: `Which starting path should receive priority for ${spec.users}?`,
      whyItMatters: `This changes how ${spec.users} first approach ${spec.subject}.`,
      recommendation: spec.options[0],
      recommendationReason: `${spec.options[0]} best supports the most frequent ${spec.slug} outcome.`,
      alternatives: spec.options,
      consequenceOfEachChoice: spec.options.map((option) => `${option} makes that path prominent while keeping the other paths available.`),
      canFoundryDecide: false,
      architectureImpact: `The selected ${spec.slug} path determines the primary information and workflow hierarchy.`,
      scopeImpact: `All options preserve scope but change which ${spec.slug} path receives the most refinement.`,
    }],
    recommendations: recommendations.map((title, index) => ({
      title,
      specificValue: `${title} gives ${spec.users} concrete help while reviewing ${spec.subject}.`,
      whyThisProjectNeedsIt: `${spec.users} working with ${spec.subject} need this project-specific support to ${spec.action} confidently.`,
      impact: `Adds a bounded ${spec.slug} behavior using information already required by the core workflow.`,
      selectedByDefault: index < 2,
      confidence: { score: 0.9 - index * 0.05, rationale: `The ${spec.slug} journey directly benefits from this focused behavior.` },
      requiredDependencies: [`Current ${spec.subject} records`],
    })),
    verificationPlan: [{
      observableOutcome: `Users can review ${spec.subject} and ${spec.action} in the running product.`,
      acceptanceMethod: "browser-check",
      evidenceRequired: [`A recorded interaction showing ${spec.subject} and the completed action`],
      sourceRequirement: "customer-intent-1",
      origin: "customer-stated",
      dependencyIndexes: [],
    }],
  };
}

function approvedContract(spec, design) {
  const customMessage = `Keep ${spec.subject} visible before the final action.`;
  const decisions = design.decisions;
  const decisionSelections = [
    {
      kind: "design-direction", subjectId: "design-direction", mode: "accept-recommendation",
      optionId: "alternative-1", value: design.designAlternatives[0].name,
      reason: design.designDirection.rationale, classification: "design preference", sourceProfileVersion: 2,
    },
    ...design.recommendations.map((item, index) => ({
      kind: "recommendation", subjectId: `suggestion-${index + 1}`,
      mode: index < 2 ? "include" : "exclude", optionId: `suggestion-${index + 1}`,
      value: item.title, reason: item.whyThisProjectNeedsIt,
      classification: "feature recommendation", sourceProfileVersion: 2,
    })),
    {
      kind: "decision", subjectId: "question-1", mode: "select-option",
      optionId: "question-1-option-2", value: decisions[0].alternatives[1],
      reason: decisions[0].consequenceOfEachChoice[1], classification: "product decision", sourceProfileVersion: 2,
    },
    {
      kind: "customer-message", subjectId: `customer-message-${spec.slug}`,
      mode: "message", optionId: null, value: customMessage,
      reason: "The customer added project-specific context.", classification: null, sourceProfileVersion: 2,
    },
    {
      kind: "proposal-confirmation", subjectId: "customer-proposal-confirmation",
      mode: "confirm", optionId: null, value: "Continue to the approved plan",
      reason: "The customer confirmed the complete proposal.", classification: "proposal confirmation", sourceProfileVersion: 2,
    },
  ];
  return createApprovedProjectContract({
    missionId: `dynamic-${spec.slug}`,
    originalCustomerRequest: spec.request,
    customerFollowUpMessages: [customMessage, "The proposal sounds right; continue to the plan."],
    finalInterpretedIntent: design.projectIntent,
    audiences: design.projectIntent.intendedUsers,
    workflows: design.userExperiencePlan,
    selectedDesignDirection: design.designDirection,
    acceptedRecommendations: design.recommendations.slice(0, 2),
    rejectedRecommendations: design.recommendations.slice(2),
    customerDecisions: decisions,
    foundryDecisions: [],
    assumptions: design.foundryInsights.assumptions,
    explicitExclusions: design.productProposal.intentionallyExcludedCapabilities,
    architectureConstraints: design.projectIntent.constraints,
    supportedPlatform: "web",
    selectedStackCapability: {
      stackId: "nextjs-typescript-sqlite-npm-playwright",
      stackVersion: "1.0.0",
      capabilities: ["web-application", "persistent-data"],
    },
    acceptanceObligations: [{
      obligationId: `${spec.slug}-primary-outcome`,
      statement: design.verificationPlan[0].observableOutcome,
      sourceRequirement: "customer-intent-1",
    }],
    verificationPlan: design.verificationPlan,
    decisionSelections,
    contractVersion: 2,
    approvalTimestamp: "2026-07-31T16:00:00.000Z",
  });
}

test("ten materially different requests produce distinct, rich decision surfaces", () => {
  const designs = cases.map((spec) => validateProjectDesignQuality(projectDesign(spec), { originalRequest: spec.request }));
  const signatures = designs.map((design) => JSON.stringify({
    directions: design.designAlternatives.map((item) => item.name),
    workflows: design.userExperiencePlan.primaryJourneys,
    recommendations: design.recommendations.map((item) => item.title),
    decisions: design.decisions.map((item) => item.alternatives),
  }));
  assert.equal(new Set(signatures).size, 10);
  for (const [index, design] of designs.entries()) {
    assert.ok(design.designAlternatives.length >= 3 && design.designAlternatives.length <= 7);
    assert.ok(design.recommendations.length >= 3 && design.recommendations.length <= 7);
    assert.ok(design.decisions[0].alternatives.length >= 3);
    if (cases[index].slug === "rest-api") {
      assert.match(signatures[index], /contract|resource|event/iu);
      assert.doesNotMatch(signatures[index], /gallery|portfolio/iu);
    }
    for (const other of cases.filter((_, otherIndex) => otherIndex !== index)) {
      assert.doesNotMatch(signatures[index], new RegExp(`\\b${other.slug}\\b`, "iu"));
    }
  }
});

test("typed choices become an immutable contract and exact model-task requirements", () => {
  for (const spec of cases) {
    const design = validateProjectDesignQuality(projectDesign(spec), { originalRequest: spec.request });
    const contract = validateApprovedProjectContractConsistency(approvedContract(spec, design));
    const catalogue = approvedContractRequirementCatalogue(contract);
    const selectedDecision = contract.decisionSelections.find((item) => item.kind === "decision");
    const decisionRequirement = catalogue.implementationRequirements.find((item) => item.kind === "approved-decision");
    assert.match(decisionRequirement.statement, new RegExp(selectedDecision.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "u"));
    assert.equal(contract.verificationPlan[0].observableOutcome, contract.acceptanceObligations[0].statement);
    const task = createModelTaskContract({
      approvedContract: contract,
      routingRequirements: { contractHash: contract.contentHash, contractVersion: contract.contractVersion },
      taskObjective: `Implement the approved ${spec.slug} outcome.`,
      allowedScope: ["Application source and tests"],
      forbiddenChanges: ["Do not reinterpret approved choices"],
      relevantRequirementIds: ["customer-intent-1", "approved-design-direction", "approved-decision-1"],
      currentCheckpoint: `${spec.slug}-baseline`,
      expectedOutputSchema: { type: "object" },
    });
    assert.equal(task.approvedContract.contentHash, contract.contentHash);
    assert.deepEqual(task.approvedContract.decisionSelections, contract.decisionSelections);
  }
});

test("custom natural-language input remains typed data without UI-side project classification", async () => {
  const answer = normalizeCustomerFollowUpAnswers([{
    questionId: "customer-message-1",
    answer: "Keep teacher messages visible beside each student task.",
    selection: {
      kind: "customer-message", subjectId: "customer-message-1", mode: "message",
      optionId: null, value: "Keep teacher messages visible beside each student task.",
      reason: "The customer added project-specific context.", classification: null, sourceProfileVersion: 3,
    },
  }]);
  assert.equal(answer[0].selection.value, answer[0].answer);
  const productionSource = (
    await Promise.all([
      readFile(new URL("../apps/web/experience/intake.ts", import.meta.url), "utf8"),
      readFile(new URL("../apps/web/app/components/project-composer.tsx", import.meta.url), "utf8"),
      readFile(new URL("../apps/web/app/components/customer-input-composer.tsx", import.meta.url), "utf8"),
    ])
  ).join("\n");
  assert.doesNotMatch(productionSource, /STARTER_SUGGESTIONS|suggestionsForIntent|<select|option value=/u);
  assert.match(productionSource, /smartSuggestions/u);
  assert.match(productionSource, /classification: null/u);
});

test("contract consistency rejects missing and contradictory choice ledgers", () => {
  const spec = cases[0];
  const design = validateProjectDesignQuality(projectDesign(spec), { originalRequest: spec.request });
  const valid = approvedContract(spec, design);
  const missing = createApprovedProjectContract({
    ...structuredClone(valid),
    decisionSelections: [],
  });
  assert.throws(
    () => validateApprovedProjectContractConsistency(missing),
    /must record the choices/u,
  );

  const contradictory = createApprovedProjectContract({
    ...structuredClone(valid),
    acceptedRecommendations: [],
    rejectedRecommendations: design.recommendations,
    decisionSelections: valid.decisionSelections.map((selection) =>
      selection.kind === "recommendation" ? { ...selection, mode: "include" } : selection),
  });
  assert.throws(() => validateApprovedProjectContractConsistency(contradictory));
});
