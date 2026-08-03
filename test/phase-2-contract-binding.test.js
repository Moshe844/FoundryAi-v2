import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONTRACT_BOUND_BUNDLE_SCHEMA,
  ContractBindingValidationError,
  WEB_STACK_MANIFEST,
  approvedContractRequirementCatalogue,
  approvedDesignDirectionHash,
  bindMissingApprovedRequirementTraces,
  contractBoundModelPrompt,
  createApprovedProjectContract,
  createModelTaskContract,
  deriveContractRoutingRequirements,
  validateContractBoundMissionPlan,
  validateContractRequirementTrace,
} from "../src/index.js";

function contractFixture({
  missionId = "phase-2-contract",
  capabilities = ["web-application", "sqlite-persistence"],
  dependencies = ["Current policy status records"],
} = {}) {
  const intent = {
    customerOutcome:
      "Insurance policyholders can review policy status and the next required action without calling their broker.",
    businessContext:
      "An insurance brokerage needs to reduce repeated service calls while preserving trust around sensitive policy status.",
    intendedUsers: ["insurance policyholders"],
    primaryGoal:
      "Policyholders can find current policy status and understand the next action without staff assistance.",
    secondaryGoals: ["Reduce avoidable status calls to brokerage staff."],
    successDefinition:
      "A policyholder can locate a current policy, understand its status, and identify the next action in one visit.",
    constraints: ["The first release must not adjudicate insurance claims."],
    confidence: {
      score: 0.9,
      rationale:
        "The audience, repeated service problem, and desired self-service outcome are explicit.",
    },
  };
  const workflows = {
    primaryJourneys: [
      "A policyholder signs in, reviews policy status, and identifies the next required action.",
    ],
    secondaryJourneys: [
      "A returning policyholder compares a new status with the prior update.",
    ],
    criticalMoments: [
      "A policyholder sees whether a time-sensitive action is required.",
    ],
    failureStates: [
      "A missing record is explained without implying that coverage disappeared.",
    ],
    trustMoments: [
      "Every sensitive status shows its source and last-updated time.",
    ],
    repeatedTasks: ["Review changes to policy status."],
    adminResponsibilities: [
      "Brokerage staff maintain accurate policyholder records and explanations.",
    ],
  };
  const design = {
    visualPersonality: "Calm, precise, and evidence-led",
    tone: "Reassuring plain language",
    layoutStrategy:
      "Lead with current status and next action, then reveal dated supporting detail",
    informationDensity: "Moderate density with compact history",
    navigationApproach: "A shallow policy overview",
    responsivePriority: "Keep urgent status and next actions usable on a phone",
    accessibilityNeeds: ["Status changes use text and icons rather than color alone."],
    contentStrategy: "Show source and last update beside sensitive information",
    interactionStyle: "Confirm consequential actions and keep review interactions immediate",
    rationale: "Policyholders need confidence in the status before visual novelty.",
  };
  const recommendation = {
    title: "Renewal readiness summary",
    specificValue:
      "Shows policyholders which policy records need attention before a renewal deadline.",
    whyThisProjectNeedsIt:
      "People reviewing policy status need a prioritized next action.",
    impact: "Adds focused comparison without a new external integration.",
    selectedByDefault: true,
    confidence: {
      score: 0.9,
      rationale: "The repeated review workflow directly benefits from prioritization.",
    },
    requiredDependencies: dependencies,
  };
  const verificationPlan = [{
    observableOutcome:
      "Policyholders can review policy status and the next required action in the running interface.",
    acceptanceMethod: "browser-check",
    evidenceRequired: ["A browser interaction recording the status and next action"],
    sourceRequirement: "customer-intent-1",
    origin: "customer-stated",
    dependencyIndexes: [],
  }];
  return createApprovedProjectContract({
    missionId,
    originalCustomerRequest:
      "Build a self-service insurance portal for policy status and next actions.",
    customerFollowUpMessages: [
      "Keep the most urgent next action visible on mobile.",
    ],
    finalInterpretedIntent: intent,
    audiences: intent.intendedUsers,
    workflows,
    selectedDesignDirection: design,
    acceptedRecommendations: [recommendation],
    rejectedRecommendations: [],
    customerDecisions: [],
    foundryDecisions: [],
    assumptions: ["Brokerage staff remain the source-record authority."],
    explicitExclusions: ["Claim adjudication is outside the first release."],
    architectureConstraints: intent.constraints,
    supportedPlatform: "web",
    selectedStackCapability: {
      stackId: WEB_STACK_MANIFEST.stackId,
      stackVersion: WEB_STACK_MANIFEST.stackVersion,
      capabilities,
    },
    acceptanceObligations: [{
      obligationId: "policy-status-visible",
      statement: verificationPlan[0].observableOutcome,
      sourceRequirement: "customer-intent-1",
    }],
    verificationPlan,
    contractVersion: 1,
    approvalTimestamp: "2026-07-31T12:00:00.000Z",
  });
}

function validPlan(contract) {
  const catalogue = approvedContractRequirementCatalogue(contract);
  const ids = catalogue.implementationRequirements.map(
    (requirement) => requirement.requirementId,
  );
  return {
    contractHash: contract.contentHash,
    contractVersion: contract.contractVersion,
    supportedPlatform: contract.supportedPlatform,
    designDirectionHash: approvedDesignDirectionHash(contract),
    designFidelity: {
      compositionImplementation:
        "Lead with current status and next action in a calm evidence-led grid layout.",
      typographyImplementation:
        "Use precise reassuring typography with an explicit readable type scale.",
      colorImplementation:
        "Use a calm evidence-led color system that preserves status trust.",
      responsiveImplementation:
        "Keep urgent status and next actions usable on a phone with a responsive transformation.",
      interactionImplementation:
        "Confirm consequential actions and keep review interactions immediate.",
      sourceFiles: ["app/page.tsx", "app/styles.css"],
      browserEvidence: {
        capturesScreenshots: true,
        measuresComposition: true,
        measuresTypography: true,
        measuresColor: true,
        measuresResponsiveTransformation: true,
      },
    },
    requirementClaims: catalogue.implementationRequirements.map(
      (requirement) => ({
        requirementId: requirement.requirementId,
        implementationSummary: requirement.statement,
      }),
    ),
    explicitExclusionIds: catalogue.exclusionRequirements.map(
      (requirement) => requirement.requirementId,
    ),
    files: [
      {
        path: "app/page.tsx",
        content:
          "export default function Page() { return <main className=\"policy-grid\">Current policy status and next required action</main>; }",
        contractRequirementIds: ids,
      },
      {
        path: "app/styles.css",
        content:
          ":root { --trust-blue: #24597a; } .policy-grid { display: grid; font-family: system-ui; font-size: 1rem; color: var(--trust-blue); } @media (max-width: 414px) { .policy-grid { grid-template-columns: 1fr; } }",
        contractRequirementIds: [ids[0]],
      },
      {
        path: "tests/design.spec.ts",
        content:
          "await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'phone.png' }); const phone = await page.locator('main').evaluate((el) => { const style = getComputedStyle(el); return { box: el.getBoundingClientRect(), fontFamily: style.fontFamily, fontSize: style.fontSize, backgroundColor: style.backgroundColor, color: style.color }; }); await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: 'desktop.png' }); const desktop = await page.locator('main').boundingBox();",
        contractRequirementIds: [ids[0]],
      },
    ],
  };
}

test("Phase 2 derives workload and model depth from the approved contract", () => {
  const simple = contractFixture();
  const complex = contractFixture({
    missionId: "phase-2-complex",
    capabilities: [
      "web-application",
      "sqlite-persistence",
      "create-records",
      "update-records",
      "browser-verification",
      "production-build",
    ],
    dependencies: [
      "Current policy status records",
      "Renewal calendar records",
      "Brokerage service ownership records",
    ],
  });
  const simpleRoute = deriveContractRoutingRequirements(simple, WEB_STACK_MANIFEST);
  const complexRoute = deriveContractRoutingRequirements(complex, WEB_STACK_MANIFEST);
  assert.equal(simpleRoute.stackId, WEB_STACK_MANIFEST.stackId);
  assert.deepEqual(simpleRoute.requiredWorkloadCapabilities, [
    "sqlite-persistence",
    "web-application",
  ]);
  assert(simpleRoute.modelDepth < complexRoute.modelDepth);
  assert.match(complexRoute.routingReason, /workload capabilities/u);

  const unsupported = contractFixture({
    missionId: "phase-2-unsupported",
    capabilities: ["web-application", "native-ios-runtime"],
  });
  assert.throws(
    () => deriveContractRoutingRequirements(unsupported, WEB_STACK_MANIFEST),
    /unsupported stack capabilities/u,
  );
});

test("Phase 2 gives every model call a complete binding task contract", () => {
  const contract = contractFixture();
  const catalogue = approvedContractRequirementCatalogue(contract);
  const routing = deriveContractRoutingRequirements(contract, WEB_STACK_MANIFEST);
  const task = createModelTaskContract({
    approvedContract: contract,
    routingRequirements: routing,
    taskObjective: "Generate the approved customer experience.",
    allowedScope: ["Implement the approved requirements."],
    forbiddenChanges: ["Do not change the approved platform."],
    relevantRequirementIds: catalogue.implementationRequirements.map(
      (item) => item.requirementId,
    ),
    currentCheckpoint: "phase-2-baseline",
    expectedOutputSchema: CONTRACT_BOUND_BUNDLE_SCHEMA,
  });
  assert.equal(task.approvedContract.contentHash, contract.contentHash);
  assert.equal(
    task.approvedContract.selectedDesignDirectionHash,
    approvedDesignDirectionHash(contract),
  );
  assert.deepEqual(
    task.approvedContract.explicitExclusionIds,
    catalogue.exclusionRequirements.map((item) => item.requirementId),
  );
  assert.equal(task.currentCheckpoint, "phase-2-baseline");
  assert.deepEqual(task.verificationPlan, contract.verificationPlan);
  assert.equal(task.expectedOutputSchema, CONTRACT_BOUND_BUNDLE_SCHEMA);
  assert.equal(
    task.relevantRequirements.length,
    catalogue.implementationRequirements.length,
  );
  assert.deepEqual(
    task.requiredImplementationRequirementIds,
    catalogue.implementationRequirements.map((item) => item.requirementId),
  );
  const prompt = contractBoundModelPrompt(task, ["Return the exact schema."]);
  assert.match(prompt, /BINDING/u);
  assert.match(prompt, /Do not reinterpret the original request/u);
  assert.match(prompt, /Never calculate, abbreviate, or reinterpret/u);
  assert(prompt.includes(contract.contentHash));
});

test("Phase 2 rejects omissions, reinterpretation, expansion, drift, and weak traces", () => {
  const contract = contractFixture();
  const plan = validPlan(contract);
  const accepted = validateContractBoundMissionPlan(plan, contract);
  assert.equal(accepted.files[0].contractRequirementIds.length, plan.requirementClaims.length);

  const omitted = structuredClone(plan);
  omitted.requirementClaims.pop();
  assert.throws(
    () => validateContractBoundMissionPlan(omitted, contract),
    /omits approved requirements/u,
  );

  const reinterpreted = structuredClone(plan);
  reinterpreted.requirementClaims[0].implementationSummary =
    "Cryptocurrency exchange analytics dashboard.";
  assert.throws(
    () => validateContractBoundMissionPlan(reinterpreted, contract),
    /reinterprets requirement/u,
  );

  const expanded = structuredClone(plan);
  expanded.requirementClaims.push({
    requirementId: "unapproved-cryptocurrency-trading",
    implementationSummary: "Add cryptocurrency trading.",
  });
  assert.throws(
    () => validateContractBoundMissionPlan(expanded, contract),
    /adds unapproved requirement/u,
  );

  const platformDrift = structuredClone(plan);
  platformDrift.supportedPlatform = "native-ios";
  assert.throws(
    () => validateContractBoundMissionPlan(platformDrift, contract),
    /changed the approved platform/u,
  );

  const exclusionDropped = structuredClone(plan);
  exclusionDropped.explicitExclusionIds = [];
  assert.throws(
    () => validateContractBoundMissionPlan(exclusionDropped, contract),
    /preserve every explicit exclusion/u,
  );

  const untraced = structuredClone(plan);
  untraced.files[0].contractRequirementIds.pop();
  assert.throws(
    () => validateContractBoundMissionPlan(untraced, contract),
    /No generated file traces/u,
  );
});

test("Phase 2 binds an omitted trace only to a file that preserves its subject", () => {
  const contract = contractFixture();
  const plan = validPlan(contract);
  const missingId = plan.files[0].contractRequirementIds.pop();
  const requirement = approvedContractRequirementCatalogue(contract)
    .implementationRequirements.find((item) => item.requirementId === missingId);
  plan.files[0].content += `\n${requirement.statement}`;
  const bound = bindMissingApprovedRequirementTraces(plan, contract);
  assert(bound.files[0].contractRequirementIds.includes(missingId));
  assert.doesNotThrow(() => validateContractBoundMissionPlan(bound, contract));

  const unrelated = validPlan(contract);
  unrelated.files[0].contractRequirementIds.pop();
  for (const file of unrelated.files) {
    file.content = "mechanical fixture content without product subject terms";
  }
  const unchanged = bindMissingApprovedRequirementTraces(unrelated, contract);
  assert.equal(unchanged.files[0].contractRequirementIds.includes(missingId), false);
});

test("Phase 2 normalizes mechanical generation bookkeeping before semantic admission", () => {
  const contract = contractFixture();
  const plan = validPlan(contract);
  const missingClaim = plan.requirementClaims.pop();
  plan.files[0].contractRequirementIds = plan.files[0].contractRequirementIds
    .filter((requirementId) => requirementId !== missingClaim.requirementId);
  plan.files[0].contractRequirementIds.push("invented-design-trace");
  plan.files[0].content += `\n${approvedContractRequirementCatalogue(contract)
    .implementationRequirements.find(
      (requirement) => requirement.requirementId === missingClaim.requirementId,
    ).statement}`;
  plan.files.push({
    ...structuredClone(plan.files[0]),
    content: `${plan.files[0].content}\n// final duplicate occurrence`,
  });

  const normalized = bindMissingApprovedRequirementTraces(plan, contract);
  const accepted = validateContractBoundMissionPlan(normalized, contract);
  assert.equal(accepted.files.length, 3);
  assert.equal(
    accepted.files.filter((file) => file.path === "app/page.tsx").length,
    1,
  );
  assert.equal(
    accepted.files[0].contractRequirementIds.includes("invented-design-trace"),
    false,
  );
  assert(
    accepted.requirementClaims.some(
      (claim) => claim.requirementId === missingClaim.requirementId,
    ),
  );
  assert(
    accepted.files[0].contractRequirementIds.includes(
      missingClaim.requirementId,
    ),
  );
});

test("Phase 2 admits intrinsic responsive sizing and still rejects no responsive strategy", () => {
  const contract = contractFixture();
  const intrinsic = validPlan(contract);
  intrinsic.files.find((file) => file.path === "app/styles.css").content =
    ":root { --trust-blue: #24597a; } .policy-grid { display: grid; width: 100%; max-width: 48rem; margin: 0 auto; padding: 1rem; font-family: system-ui; font-size: 1rem; color: var(--trust-blue); }";
  assert.doesNotThrow(() => validateContractBoundMissionPlan(intrinsic, contract));

  const fixedOnly = validPlan(contract);
  fixedOnly.files.find((file) => file.path === "app/styles.css").content =
    ":root { --trust-blue: #24597a; } .policy-grid { display: grid; width: 48rem; font-family: system-ui; font-size: 1rem; color: var(--trust-blue); }";
  assert.throws(
    () => validateContractBoundMissionPlan(fixedOnly, contract),
    /responsive transformation/u,
  );
});

test("Phase 2 rejects repair traces outside the exact approved task scope", () => {
  const contract = contractFixture();
  const catalogue = approvedContractRequirementCatalogue(contract);
  const [first, second] = catalogue.implementationRequirements;
  assert.deepEqual(
    validateContractRequirementTrace(
      [first.requirementId],
      contract,
      [first.requirementId],
    ),
    [first.requirementId],
  );
  assert.throws(
    () => validateContractRequirementTrace(
      [second.requirementId],
      contract,
      [first.requirementId],
    ),
    ContractBindingValidationError,
  );
  assert.throws(
    () => validateContractRequirementTrace([], contract, [first.requirementId]),
    /non-empty/u,
  );
});

test("Phase 2 production has one contract gateway and no hard-coded model catalogue", () => {
  const production = readFileSync(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  const binding = readFileSync(
    new URL("../src/domain/contract-bound-execution.js", import.meta.url),
    "utf8",
  );
  assert.equal(production.match(/models\.request\(/gu)?.length, 2);
  assert((production.match(/requestModel\(/gu)?.length ?? 0) >= 4);
  assert.match(production, /contractTraceSchema\(\s*scopedBrowserRepairPatchSchema/u);
  assert.match(production, /combined file content below 18,000 characters/u);
  assert.doesNotMatch(binding, /\b(?:claude|gemini|gpt|opus)[-_\d]/iu);
});
