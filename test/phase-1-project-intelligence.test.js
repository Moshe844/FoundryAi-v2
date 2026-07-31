import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  ApprovedProjectContractValidationError,
  ProjectDesignQualityError,
  createApprovedProjectContract,
  normalizeApprovedProjectContract,
  normalizeProjectDesign,
  openMissionControl,
  validateProjectDesignQuality,
} from "../src/index.js";

function projectDesign({
  audience = "insurance policyholders",
  subject = "policy documents and claim status",
  recommendation = "Renewal readiness summary",
} = {}) {
  return {
    projectIntent: {
      customerOutcome: `${audience} can review ${subject} without calling their broker for routine updates.`,
      businessContext: `An insurance brokerage needs to reduce repeated service calls while preserving trust around sensitive ${subject}.`,
      intendedUsers: [audience],
      primaryGoal: `${audience} can find current ${subject} and understand the next action without staff assistance.`,
      secondaryGoals: ["Reduce avoidable status calls to brokerage staff."],
      successDefinition: `${audience} can locate a current record, understand its status, and identify the next action in one visit.`,
      constraints: ["The first release must not initiate or adjudicate insurance claims."],
      confidence: { score: 0.88, rationale: "The audience, repeated service problem, and desired self-service outcome are explicit." },
    },
    userExperiencePlan: {
      primaryJourneys: [`A policyholder signs in, reviews ${subject}, and identifies the next required action.`],
      secondaryJourneys: ["A returning policyholder compares a new status with the prior update."],
      criticalMoments: ["A policyholder sees whether a time-sensitive action is required."],
      failureStates: ["A missing record is explained without implying that coverage or a claim disappeared."],
      trustMoments: ["Every sensitive status shows its source and last-updated time."],
      repeatedTasks: [`Review changes to ${subject}.`],
      adminResponsibilities: ["Brokerage staff maintain accurate policyholder records and status explanations."],
    },
    productProposal: {
      essentialCapabilities: [`Policyholders can review ${subject} and the next required action.`],
      recommendedCapabilities: ["Explain changes since the policyholder's last visit."],
      intentionallyExcludedCapabilities: ["Claim adjudication and coverage decisions remain outside the first release."],
      futureCapabilities: ["Policyholder notification preferences after status data is proven reliable."],
      rationale: "The first version solves the high-frequency status question without taking on regulated decision-making.",
      dependencies: ["A reliable brokerage source for policy and claim-status records."],
      scopeImpact: "The release stays focused on trustworthy self-service review and staff-managed source data.",
    },
    designDirection: {
      visualPersonality: "Calm, precise, and evidence-led rather than sales-oriented",
      tone: "Reassuring plain language that distinguishes known status from required action",
      layoutStrategy: "Lead with current status and next action, then reveal dated supporting detail",
      informationDensity: "Moderate density with compact history for returning policyholders",
      navigationApproach: "A shallow policy overview with direct paths to documents and claim status",
      responsivePriority: "Make urgent status and next actions fully usable on a phone",
      accessibilityNeeds: ["Status changes use text and icons rather than color alone."],
      contentStrategy: "State source, last update, and responsible party beside sensitive information",
      interactionStyle: "Confirm consequential actions and keep review interactions immediate",
      rationale: "Policyholders need confidence in the status before they need visual novelty or promotional content.",
    },
    designAlternatives: [
      {
        name: "Calm, precise, and evidence-led rather than sales-oriented",
        description: `Leads ${audience} directly from ${subject} to the next required action with quiet supporting evidence.`,
        whyItFits: `${audience} need to trust sensitive ${subject} before acting without brokerage staff assistance.`,
        layoutApproach: `A status-led workspace that keeps ${subject} and the next action together.`,
        visualPersonality: "Calm, precise, and evidence-led rather than sales-oriented",
        informationDensity: "Moderate density with compact dated history",
        navigationApproach: `Shallow navigation organised around ${subject} and required actions.`,
        mobileBehavior: "Urgent status and the next action remain first on small screens",
        tradeoff: "Uses less promotional storytelling to preserve fast repeat comprehension.",
        confidence: { score: 0.92, rationale: `The ${subject} workflow prioritises trust and repeated review.` },
        recommended: true,
        preview: {
          typographyCharacter: "Measured and highly legible",
          spacingDensity: "Balanced operational spacing",
          colorMood: "Quiet trustworthy neutrals",
          hierarchy: "Status first, action second, evidence third",
        },
      },
      {
        name: "Guided policy explanation",
        description: `Walks ${audience} through changes in ${subject} before presenting the next action.`,
        whyItFits: `First-time ${audience} may need more explanation before they trust unfamiliar ${subject}.`,
        layoutApproach: `A guided sequence that explains ${subject} from summary through supporting detail.`,
        visualPersonality: "Guided, reassuring, and explanatory",
        informationDensity: "Low density with progressive explanation",
        navigationApproach: `A stepwise path through each ${subject} explanation.`,
        mobileBehavior: "Explanations become a focused vertical reading sequence",
        tradeoff: "Experienced policyholders take longer to reach repeated status actions.",
        confidence: { score: 0.77, rationale: `The ${subject} audience includes people unfamiliar with policy language.` },
        recommended: false,
        preview: {
          typographyCharacter: "Friendly explanatory headings",
          spacingDensity: "Open guided spacing",
          colorMood: "Warm reassuring neutrals",
          hierarchy: "Explanation first, evidence second, action third",
        },
      },
      {
        name: "Dense service workspace",
        description: `Places several ${subject} records and their next actions in one compact operational view.`,
        whyItFits: `Frequent ${audience} handling several ${subject} records can compare changes without extra navigation.`,
        layoutApproach: `A compact comparison workspace grouped by ${subject} status.`,
        visualPersonality: "Dense, efficient, and operational",
        informationDensity: "High density with scannable status rows",
        navigationApproach: `Record-first navigation across related ${subject}.`,
        mobileBehavior: "Comparison rows collapse into prioritized status summaries",
        tradeoff: "The denser presentation requires more familiarity from first-time visitors.",
        confidence: { score: 0.71, rationale: `Repeat review of ${subject} may reward faster comparison.` },
        recommended: false,
        preview: {
          typographyCharacter: "Compact utilitarian labels",
          spacingDensity: "Tight operational spacing",
          colorMood: "Cool focused neutrals",
          hierarchy: "Record list first, changes second, action third",
        },
      },
    ],
    foundryInsights: {
      observations: ["The repeated service burden is explanation, not merely document storage."],
      opportunities: ["Showing what changed since the last visit can prevent unnecessary broker calls."],
      risks: ["An unexplained stale status could damage trust more than showing no status at all."],
      ambiguities: [],
      assumptions: ["Brokerage staff remain the authority for correcting source records."],
      confidence: { score: 0.84, rationale: "The main workflow is clear and no unresolved choice changes the first-release architecture." },
    },
    decisions: [],
    recommendations: [{
      title: recommendation,
      specificValue: `Shows ${audience} which ${subject} need attention before a renewal deadline.`,
      whyThisProjectNeedsIt: `People reviewing ${subject} need a prioritized next action, not another undifferentiated document list.`,
      impact: "Adds focused comparison logic without adding a new external integration.",
      selectedByDefault: true,
      confidence: { score: 0.9, rationale: "The repeated review workflow directly benefits from prioritization." },
      requiredDependencies: ["Current policy renewal dates and status records"],
    }, {
      title: "Explain the latest status change",
      specificValue: `Shows ${audience} what changed in ${subject} since their previous review.` ,
      whyThisProjectNeedsIt: `${audience} reviewing ${subject} need the changed fact highlighted before older supporting detail.`,
      impact: "Adds a focused comparison using the existing status records.",
      selectedByDefault: true,
      confidence: { score: 0.86, rationale: "Repeated review benefits from a visible change summary." },
      requiredDependencies: ["Dated policy status records"],
    }, {
      title: "Name the responsible follow-up owner",
      specificValue: `Tells ${audience} who can resolve an exception in ${subject} when self-service stops.` ,
      whyThisProjectNeedsIt: `${audience} need a trustworthy next step when ${subject} cannot be resolved in the portal.`,
      impact: "Adds clear ownership content without automating regulated decisions.",
      selectedByDefault: true,
      confidence: { score: 0.84, rationale: "The bounded staff exception path needs visible ownership." },
      requiredDependencies: ["Brokerage service ownership records"],
    }],
    verificationPlan: [{
      observableOutcome: `Policyholders can review ${subject} and the next required action in the running interface.`,
      acceptanceMethod: "browser-check",
      evidenceRequired: ["A recorded browser interaction showing the status and next action"],
      sourceRequirement: "customer-intent-1",
      origin: "customer-stated",
      dependencyIndexes: [],
    }],
  };
}

function contractInput(missionId, design, timestamp = "2026-07-31T12:00:00.000Z") {
  return {
    missionId,
    originalCustomerRequest: design.projectIntent.customerOutcome,
    customerFollowUpMessages: ["Keep the most urgent next action visible on mobile."],
    finalInterpretedIntent: design.projectIntent,
    audiences: design.projectIntent.intendedUsers,
    workflows: design.userExperiencePlan,
    selectedDesignDirection: design.designDirection,
    acceptedRecommendations: design.recommendations,
    rejectedRecommendations: [],
    customerDecisions: [],
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
      obligationId: "customer-status-review",
      statement: design.verificationPlan[0].observableOutcome,
      sourceRequirement: "customer-intent-1",
    }],
    verificationPlan: design.verificationPlan,
    contractVersion: 1,
    approvalTimestamp: timestamp,
  };
}

test("Phase 1 validates every deep project-design structure", () => {
  const normalized = normalizeProjectDesign(projectDesign());
  assert(Object.isFrozen(normalized));
  assert(Object.isFrozen(normalized.projectIntent));
  assert.equal(normalized.projectIntent.intendedUsers[0], "insurance policyholders");
  assert.throws(
    () => normalizeProjectDesign({ ...projectDesign(), designDirection: { tone: "Calm" } }),
    /must contain exactly/u,
  );
});

test("Phase 1 rejects generic, duplicate, technical, contradictory, and unsupported output", () => {
  const generic = projectDesign();
  generic.recommendations[0] = {
    ...generic.recommendations[0],
    specificValue: "Adds a secure login screen.",
    whyThisProjectNeedsIt: "It follows common best practices for a professional application.",
  };
  assert.throws(() => validateProjectDesignQuality(generic, { originalRequest: "Insurance broker customer portal" }), ProjectDesignQualityError);

  const duplicate = projectDesign();
  duplicate.recommendations.push(structuredClone(duplicate.recommendations[0]));
  assert.throws(
    () => validateProjectDesignQuality(duplicate),
    /duplicates another recommendation/u,
  );

  const vague = projectDesign();
  vague.projectIntent.customerOutcome = "A useful portal.";
  assert.throws(
    () => validateProjectDesignQuality(vague),
    /customerOutcome is too vague/u,
  );

  const contradictory = projectDesign();
  contradictory.projectIntent.confidence = {
    score: 0.95,
    rationale: "The direction is definitely right although the audience is still uncertain.",
  };
  assert.throws(
    () => validateProjectDesignQuality(contradictory),
    /confidence is contradictory/u,
  );

  const technical = projectDesign();
  technical.decisions = [{
    customerFriendlyQuestion: "Which database and OAuth architecture should we use?",
    whyItMatters: "This affects customer access.",
    recommendation: "Managed identity",
    recommendationReason: "It simplifies customer recovery.",
    alternatives: ["Managed identity", "Broker-managed accounts", "Shared identity ownership"],
    consequenceOfEachChoice: [
      "Foundry manages recovery.",
      "Broker staff manage recovery.",
      "Foundry and broker staff split recovery responsibilities.",
    ],
    canFoundryDecide: false,
    architectureImpact: "Identity ownership changes.",
    scopeImpact: "Setup responsibilities change.",
  }];
  assert.throws(() => validateProjectDesignQuality(technical), /technical question/u);

  const unsupported = projectDesign();
  unsupported.verificationPlan[0].acceptanceMethod = "trust-the-model";
  assert.throws(() => normalizeProjectDesign(unsupported), /unsupported/u);
});

test("ApprovedProjectContract is immutable, content-addressed, versioned, and replayable", (t) => {
  const design = validateProjectDesignQuality(projectDesign(), { originalRequest: "Build an insurance broker customer portal" });
  const approved = createApprovedProjectContract(contractInput("phase-1-contract", design));
  assert.match(approved.contentHash, /^[a-f0-9]{64}$/u);
  assert(Object.isFrozen(approved));
  assert.throws(() => { approved.supportedPlatform = "mobile"; }, TypeError);

  const tampered = structuredClone(approved);
  tampered.originalCustomerRequest = "A different request";
  assert.throws(() => normalizeApprovedProjectContract(tampered), ApprovedProjectContractValidationError);

  const ledgerDirectory = mkdtempSync(join(tmpdir(), "foundry-approved-contract-"));
  t.after(() => rmSync(ledgerDirectory, { recursive: true, force: true }));
  const control = openMissionControl({ ledgerDirectory });
  control.orchestrator.createMission({
    missionId: "phase-1-contract",
    eventId: "phase-1-contract-created",
    causationId: "phase-1-contract-intent",
    reason: "Customer request received.",
  });
  const approvalEvidence = control.evidence.capture({
    evidenceId: "phase-1-contract-understanding-evidence",
    missionId: "phase-1-contract",
    kind: "model-call-result",
    captureMethod: "phase-1-contract-test",
    producingSubsystem: "PHASE_1_TEST",
    payload: {
      requestId: "phase-1-contract-understanding",
      status: "SUCCEEDED",
      structuredOutput: design,
      detail: "Validated deep project design.",
    },
    commandReference: "phase-1-contract-understanding",
    workUnitReference: "phase-1-contract-understanding",
  });
  const recorded = control.approvedContracts.approve({
    missionId: "phase-1-contract",
    eventId: "phase-1-contract-approved",
    causationId: "phase-1-contract-intent",
    contract: approved,
    evidenceReferences: [{
      evidenceId: approvalEvidence.evidenceId,
      workspaceCheckpointReference: null,
    }],
    workUnitReference: "phase-1-contract-understanding",
  });
  assert.equal(recorded.contentHash, approved.contentHash);
  assert.equal(control.approvedContracts.history("phase-1-contract").length, 1);
  assert.equal(
    control.ledger.listEvents("phase-1-contract").at(-1).fact.metadata.approvedProjectContract.contentHash,
    approved.contentHash,
  );
});

test("Build approval freezes the deep design beside the executable Requirement Contract", (t) => {
  const ledgerDirectory = mkdtempSync(join(tmpdir(), "foundry-approval-binding-"));
  t.after(() => rmSync(ledgerDirectory, { recursive: true, force: true }));
  const control = openMissionControl({ ledgerDirectory });
  const missionId = "approval-binding";
  const design = validateProjectDesignQuality(projectDesign(), {
    originalRequest: "Build an insurance broker customer portal",
  });
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    reason: "Customer request received.",
  });
  const evidence = control.evidence.capture({
    evidenceId: `${missionId}-understanding-evidence`,
    missionId,
    kind: "model-call-result",
    captureMethod: "phase-1-binding-test",
    producingSubsystem: "PHASE_1_TEST",
    payload: {
      requestId: `${missionId}-understanding`,
      status: "SUCCEEDED",
      structuredOutput: design,
      detail: "Validated deep project design.",
    },
    commandReference: `${missionId}-understanding`,
    workUnitReference: `${missionId}-understanding`,
  });
  const profile = control.profiles.create({
    missionId,
    profileVersion: 1,
    name: "Policyholder account review",
    summary: design.projectIntent.customerOutcome,
    family: "web-application",
    platform: "web",
    primaryActors: design.projectIntent.intendedUsers,
    primaryJourneys: design.userExperiencePlan.primaryJourneys,
    outcomes: design.productProposal.essentialCapabilities,
    observations: design.foundryInsights.observations,
    designDirection: {
      recommendedStyle: design.designDirection.visualPersonality,
      reason: design.designDirection.rationale,
      layoutApproach: design.designDirection.layoutStrategy,
      tone: design.designDirection.tone,
      mobilePriority: design.designDirection.responsivePriority,
      accessibilityConsiderations: design.designDirection.accessibilityNeeds,
    },
    designAlternatives: [],
    includedDefaults: design.productProposal.recommendedCapabilities,
    constraints: design.projectIntent.constraints,
    assumptions: design.foundryInsights.assumptions,
    customerContent: { supplied: [], missingBeforeLaunch: [] },
    capabilities: ["web-application", "persistent-data"],
    dataConcepts: ["Policy record", "Claim status"],
    architectureDecisions: ["Keep sensitive policy records behind customer access."],
    openQuestions: [],
    contextualSuggestions: design.recommendations.map((item, index) => ({
      suggestionId: `suggestion-${index + 1}`,
      label: item.title,
      rationale: item.whyThisProjectNeedsIt,
    })),
    sourceRequirementIds: ["customer-intent-1"],
    selectedStack: {
      stackId: "nextjs-typescript-sqlite-npm-playwright",
      version: "1.0.0",
    },
    runtimeAdapterId: "nextjs-web-runtime",
    requirementContractVersion: 1,
    verificationPlan: {
      planId: "approval-binding-verification",
      checks: [{
        checkId: "policy-status-review",
        label: design.verificationPlan[0].observableOutcome,
        origin: "customer-stated",
        acceptanceCondition: {
          type: "browser-check-equals",
          check: "policy-status-review",
          expected: true,
        },
        evidenceKinds: ["browser-interaction-result"],
        dependencyCheckIds: [],
      }],
    },
  });
  control.facts.recordResultFact({
    missionId,
    eventId: `${missionId}-understanding-fact`,
    causationId: `${missionId}-intent`,
    producingSubsystem: "PHASE_1_TEST",
    statement: "Deep understanding was validated.",
    evidenceReferences: [{
      evidenceId: evidence.evidenceId,
      workspaceCheckpointReference: null,
    }],
    workUnitReference: `${missionId}-understanding`,
    metadata: {
      projectProfile: profile,
      projectDesign: design,
      originalCustomerRequest: "Build an insurance broker customer portal",
      clarificationAnswers: [],
      verificationBindings: {
        "policy-status-review": "browser-check",
      },
    },
  });

  control.understanding.contract({
    missionId,
    eventId: `${missionId}-contract`,
    causationId: `${missionId}-understanding-fact`,
  });

  assert.equal(control.ledger.projectState(missionId).state, "CONTRACTED");
  assert.equal(control.contracts.getContract(missionId).obligations.length, 1);
  const approved = control.approvedContracts.latest(missionId);
  assert.equal(approved.originalCustomerRequest, "Build an insurance broker customer portal");
  assert.equal(approved.acceptanceObligations[0].sourceRequirement, "customer-intent-1");
  assert.match(approved.contentHash, /^[a-f0-9]{64}$/u);
});

test("unrelated designs produce meaningfully different contracts without production samples", () => {
  const insurance = projectDesign();
  const photography = projectDesign({
    audience: "engaged couples choosing a wedding photographer",
    subject: "full wedding stories, editing style, and date availability",
    recommendation: "Full-story proof before inquiry",
  });
  const left = createApprovedProjectContract(contractInput("insurance-contract", insurance));
  const right = createApprovedProjectContract(contractInput("photography-contract", photography));
  assert.notEqual(left.contentHash, right.contentHash);
  assert.notDeepEqual(left.workflows, right.workflows);
  assert.notDeepEqual(left.acceptedRecommendations, right.acceptedRecommendations);

  const production = [
    "../src/domain/project-profile.js",
    "../src/understanding-plane/project-understanding-service.js",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  for (const forbidden of [
    "fallbackActors",
    "The requested project behavior is observable.",
    "The main customer journey is clear and observable.",
  ]) {
    assert.equal(production.includes(forbidden), false, `production contains forbidden fallback: ${forbidden}`);
  }
});
