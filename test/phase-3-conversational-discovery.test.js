import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyModelRouteFailure,
  cumulativeCustomerFollowUpAnswers,
  normalizeCustomerFollowUpAnswers,
  validateStructuredModelOutput,
} from "../src/index.js";
import {
  filterContradictingRecommendations,
  parseUnderstandingRevisionValue,
  validateCustomerFollowUpTraceability,
} from "../src/understanding-plane/project-understanding-service.js";
import { projectDiscoveryConversation } from "../apps/web/local-api/discovery-conversation.mjs";

function profile(profileVersion, overrides = {}) {
  return {
    profileVersion,
    summary: "Policyholders review policy status and next actions.",
    primaryActors: ["policyholders"],
    outcomes: ["Understand policy status"],
    primaryJourneys: ["Open a policy and review its next action"],
    proposedFeatures: ["Policy status overview"],
    includedDefaults: ["Clear validation"],
    designDirection: { tone: "Calm" },
    designAlternatives: [],
    contextualSuggestions: [{ suggestionId: "renewal", label: "Renewal warning" }],
    openQuestions: [],
    architectureDecisions: [],
    assumptions: ["Staff maintain source records"],
    constraints: ["No claim adjudication"],
    verificationPlan: { checks: [{ checkId: "status-visible" }] },
    ...overrides,
  };
}

function fact(profileVersion, answers, overrides = {}) {
  return {
    occurredAt: `2026-07-31T12:0${profileVersion}:00.000Z`,
    fact: {
      metadata: {
        projectProfile: profile(profileVersion, overrides),
        clarificationAnswers: answers,
      },
    },
  };
}

test("Phase 3 preserves every customer follow-up across model revisions", () => {
  const first = {
    questionId: "customer-input-role-first",
    answer: "Customer user-role instruction: Add regional managers.",
  };
  const second = {
    questionId: "customer-input-limitation-second",
    answer: "Customer limitation: Do not send email.",
  };
  const ledger = {
    listEvents() {
      return [fact(1, []), fact(2, [first]), fact(3, [first, second])];
    },
  };
  const third = {
    questionId: "customer-input-acceptance-third",
    answer: "Customer acceptance expectation: Managers can filter locations.",
  };
  assert.deepEqual(
    cumulativeCustomerFollowUpAnswers(ledger, "phase-3", [third]),
    [first, second, third],
  );
});

test("Phase 3 deduplicates a retried natural instruction by meaning, not UI id", () => {
  const recorded = {
    questionId: "customer-message-first-id",
    answer: "Keep the class list readable for older members.",
    selection: {
      kind: "customer-message",
      subjectId: "customer-message-first-id",
      mode: "message",
      optionId: null,
      value: "Keep the class list readable for older members.",
      reason: "Customer context.",
      classification: null,
      sourceProfileVersion: 2,
    },
  };
  const retried = {
    ...recorded,
    questionId: "customer-message-retry-id",
    selection: {
      ...recorded.selection,
      subjectId: "customer-message-retry-id",
    },
  };
  const ledger = {
    listEvents() {
      return [{ fact: { metadata: { customerFollowUpAnswers: [recorded] } } }];
    },
  };
  assert.deepEqual(
    cumulativeCustomerFollowUpAnswers(ledger, "phase-3", [retried]),
    [recorded],
  );
});

test("Phase 3 prevents an explicit customer outcome from being dropped or negated", () => {
  const answers = [{
    questionId: "customer-message-dashboard",
    answer: "It should take you to a nice admin dashboard",
    selection: { kind: "customer-message" },
  }];
  const design = {
    verificationPlan: [],
    projectIntent: { constraints: [] },
    productProposal: {
      intentionallyExcludedCapabilities: [],
      futureCapabilities: [],
    },
    architectureDecisions: [],
  };

  assert.throws(
    () => validateCustomerFollowUpTraceability(design, answers),
    /customer-follow-up-1 is not preserved/u,
  );

  design.verificationPlan = [{
    observableOutcome: "The admin dashboard is visible after successful sign-in.",
    sourceRequirement: "customer-follow-up-1",
  }];
  design.projectIntent.constraints = ["No dashboard content in the first version."];
  assert.throws(
    () => validateCustomerFollowUpTraceability(design, answers),
    /conflicts with proposed scope: No dashboard content/u,
  );

  design.projectIntent.constraints = [];
  design.architectureDecisions = [
    "Successful sign-in navigates to the first-version admin dashboard.",
  ];
  assert.doesNotThrow(() =>
    validateCustomerFollowUpTraceability(design, answers),
  );
});

test("Phase 3 rejects malformed, empty, oversized, and widened customer input", () => {
  assert.deepEqual(
    normalizeCustomerFollowUpAnswers([{ questionId: "customer-input-context-a", answer: "  Keep it simple.  " }]),
    [{ questionId: "customer-input-context-a", answer: "Keep it simple." }],
  );
  for (const invalid of [
    null,
    [{}],
    [{ questionId: "bad id", answer: "Value" }],
    [{ questionId: "valid", answer: " " }],
    [{ questionId: "valid", answer: "x".repeat(5_001) }],
    [{ questionId: "valid", answer: "Value", extra: true }],
  ]) {
    assert.throws(() => normalizeCustomerFollowUpAnswers(invalid), TypeError);
  }
});

test("Phase 3 validates nullable compact replacements without weakening schemas", () => {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["change"],
    properties: {
      change: {
        anyOf: [
          { type: "string", minLength: 2, maxLength: 7 },
          { type: "null" },
        ],
      },
    },
  };
  assert.deepEqual(validateStructuredModelOutput({ change: null }, schema), {
    change: null,
  });
  assert.deepEqual(validateStructuredModelOutput({ change: "updated" }, schema), {
    change: "updated",
  });
  assert.throws(
    () => validateStructuredModelOutput({ change: 3 }, schema),
    /exactly one allowed schema/u,
  );
  assert.throws(
    () => validateStructuredModelOutput({ change: "too-long" }, schema),
    /exactly one allowed schema/u,
  );
});

test("Phase 3 normalizes an unquoted string leaf without weakening structured revisions", () => {
  assert.equal(
    parseUnderstandingRevisionValue({
      valueJson: "Prioritize phone booking for older members.",
      operation: "replace",
      existingValue: "Prioritize online booking.",
    }),
    "Prioritize phone booking for older members.",
  );
  assert.deepEqual(
    parseUnderstandingRevisionValue({
      valueJson: '["phone", "online"]',
      operation: "replace",
      existingValue: [],
    }),
    ["phone", "online"],
  );
  assert.throws(
    () => parseUnderstandingRevisionValue({
      valueJson: "phone, online",
      operation: "replace",
      existingValue: [],
    }),
    /valid JSON for a non-string leaf/u,
  );
});

test("Phase 3 retires dynamically discovered models that require unavailable tools", () => {
  assert.deepEqual(
    classifyModelRouteFailure(
      "This model requires the use of the Computer Use tool.",
    ),
    { category: "MODEL_UNAVAILABLE", retryable: false },
  );
});

test("Phase 3 projects customer messages and a truthful revision diff", () => {
  const role = {
    questionId: "customer-input-role-first",
    answer: "Customer user-role instruction: Add regional managers.",
  };
  const events = [
    fact(1, []),
    fact(2, [role], {
      primaryActors: ["policyholders", "regional managers"],
      primaryJourneys: [
        "Open a policy and review its next action",
        "A regional manager filters policies by location",
      ],
      verificationPlan: {
        checks: [
          { checkId: "status-visible" },
          { checkId: "manager-filter-visible" },
        ],
      },
    }),
  ];
  const conversation = projectDiscoveryConversation(events);
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].kind, "role");
  assert.deepEqual(conversation.latestRevision.changedSections, [
    "Understanding",
    "Workflows",
    "Verification promises",
  ]);
});

test("Phase 3 exposes a durably recorded message even before re-evaluation succeeds", () => {
  const answer = {
    questionId: "customer-input-integration-pending",
    answer: "Customer integration instruction: Use the existing member directory.",
  };
  const conversation = projectDiscoveryConversation([
    fact(1, []),
    {
      occurredAt: "2026-07-31T12:02:00.000Z",
      fact: {
        metadata: {
          customerFollowUpAnswers: [answer],
          requestedProfileVersion: 2,
        },
      },
    },
  ]);
  assert.deepEqual(conversation.messages, [
    {
      messageId: answer.questionId,
      kind: "integration",
      text: answer.answer,
      profileVersion: 2,
      occurredAt: "2026-07-31T12:02:00.000Z",
    },
  ]);
  assert.equal(conversation.latestRevision.profileVersion, 1);
});

test("Phase 3 exposes a failed natural revision as pending, never as applied", () => {
  const answer = {
    questionId: "customer-message-pending",
    answer: "Keep the class list readable for older members.",
    selection: {
      kind: "customer-message",
      sourceProfileVersion: 1,
    },
  };
  const conversation = projectDiscoveryConversation([
    fact(1, []),
    {
      occurredAt: "2026-07-31T12:02:00.000Z",
      fact: {
        metadata: {
          customerFollowUpAnswers: [answer],
          requestedProfileVersion: 2,
        },
      },
    },
  ]);
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].status, "pending");
  assert.deepEqual(conversation.messages[0].affectedSections, []);
  assert.match(conversation.messages[0].interpretation, /has not completed/u);
});

test("Phase 3 projects an applied natural instruction exactly once", () => {
  const answer = {
    questionId: "customer-message-applied",
    answer: "Keep the class list readable for older members.",
    selection: {
      kind: "customer-message",
      sourceProfileVersion: 1,
    },
  };
  const conversation = projectDiscoveryConversation([
    fact(1, []),
    {
      occurredAt: "2026-07-31T12:02:00.000Z",
      fact: {
        metadata: {
          customerFollowUpAnswers: [answer],
          requestedProfileVersion: 2,
        },
      },
    },
    fact(2, [answer], {
      designDirection: { tone: "Calm and readable" },
    }),
  ]);
  assert.equal(conversation.messages.length, 1);
  assert.equal(conversation.messages[0].status, "applied");
});

test("Phase 3 production is a staged working session with unrestricted custom input", () => {
  const discovery = readFileSync(
    new URL("../apps/web/app/components/project-discovery.tsx", import.meta.url),
    "utf8",
  );
  const composer = readFileSync(
    new URL("../apps/web/app/components/customer-input-composer.tsx", import.meta.url),
    "utf8",
  );
  const server = readFileSync(
    new URL("../apps/web/local-api/server.mjs", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL("../apps/web/app/globals.css", import.meta.url),
    "utf8",
  );
  assert.match(discovery, /Step \{stage \+ 1\} of \{stages\.length\}/u);
  assert.match(styles, /grid-template-columns:\s*repeat\(7, minmax\(0, 1fr\)\)/u);
  assert.doesNotMatch(styles, /repeat\(7, minmax\(132px, 1fr\)\)/u);
  assert.match(discovery, /stageId === "read"/u);
  assert.match(discovery, /stageId === "review"/u);
  assert.match(discovery, /Continue with Foundry&rsquo;s recommendations/u);
  assert.match(discovery, /CustomerInputComposer/u);
  assert.doesNotMatch(composer, /<select/u);
  assert.doesNotMatch(composer, /What kind of change is this/u);
  assert.match(composer, /kind: "customer-message"/u);
  assert.match(composer, /Write naturally/u);
  assert.match(composer, /proposal\.smartSuggestions/u);
  assert.match(server, /normalizeCustomerFollowUpAnswers\(input\.answers\)/u);
  assert.match(server, /already revising this project/u);
  const understandingService = readFileSync(
    new URL("../src/understanding-plane/project-understanding-service.js", import.meta.url),
    "utf8",
  );
  assert.match(understandingService, /customerFollowUpAnswers/u);
  assert.match(understandingService, /foundry_project_understanding_revision/u);
  assert.match(understandingService, /applyUnderstandingRevision/u);
  assert.match(understandingService, /minimal JSON Patch-style operations array/u);
  assert.match(understandingService, /targets an invalid array index/u);
  assert.match(understandingService, /never repeat an existing array/u);
  assert.match(understandingService, /Current relevant validated fields/u);
  assert.match(understandingService, /indexes\.includes\(0\)/u);
  assert.match(understandingService, /understandingRevisionPrompt/u);
  assert.match(understandingService, /Do not repeat the complete project understanding/u);
  assert.match(understandingService, /revisionFieldsForAnswers/u);
  assert.match(understandingService, /copy each essential capability exactly/u);
  assert.match(understandingService, /MAX_PRODUCT_INTELLIGENCE_GENERATIONS = 1/u);
  assert.match(understandingService, /MAX_PRODUCT_INTELLIGENCE_ROUTES = 1/u);
  assert.match(understandingService, /if \(!failureDisposition\.retryable\) break/u);
  assert.match(understandingService, /priority: "FAST_RESPONSE"/u);
  assert.match(
    understandingService,
    /id: identifier\("question", index\)/u,
  );
  assert.match(
    understandingService,
    /id: identifier\("suggestion", index\)/u,
  );
  assert.match(
    understandingService,
    /subjectId = identifier\("suggestion", index\)/u,
  );
  assert.match(understandingService, /resolvedCustomerQuestionIds/u);
  assert.match(
    understandingService,
    /shouldDiscoverProductType\(intent, cumulativeAnswers\)/u,
  );
  assert.match(
    understandingService,
    /existing\.value = recommendation\.title/u,
  );
  assert.match(
    understandingService,
    /customerSuppliedContent \?\? \[\]\)\.flatMap/u,
  );
  assert.match(
    understandingService,
    /answer\.selection\.kind === "customer-message"/u,
  );
  assert.match(
    understandingService,
    /answer\.selection\?\.kind === "decision"/u,
  );
  assert.match(
    understandingService,
    /recordSelections\(\{/u,
  );
  assert.match(
    understandingService,
    /without another model call/u,
  );
  assert.match(
    server,
    /generatedOptionSelectionsOnly/u,
  );
  assert.match(
    server,
    /designContract\?\.selectionMode === "custom"[\s\S]*customComposition\?\.complete === true/u,
  );
  assert.match(
    server,
    /control\.understanding\.recordSelections/u,
  );
  assert.match(
    understandingService,
    /!resolvedCustomerQuestionIds\.has\(questionId\)/u,
  );
  const liveAdapters = readFileSync(
    new URL("../src/capability-plane/live-ai-adapters.js", import.meta.url),
    "utf8",
  );
  assert.match(
    liveAdapters,
    /request\.taskClass === "FILE_GENERATION"\) return 32_000/u,
  );
  assert.match(
    liveAdapters,
    /request\.taskClass === "PROJECT_UNDERSTANDING"\) return 120_000/u,
  );
  assert.match(
    liveAdapters,
    /request\.taskClass === "PROJECT_UNDERSTANDING"\) return 6_000/u,
  );
  assert.match(liveAdapters, /return 16_000/u);
  assert.match(liveAdapters, /negotiatedEffort/u);
  assert.match(liveAdapters, /unsupported value:/u);
  assert.match(liveAdapters, /const fenced =/u);
  assert.doesNotMatch(`${discovery}\n${composer}`, /insurance|photographer|booking|plumbing/iu);
});

test("Useful ideas drop directions the customer rejected in Visual Direction", () => {
  const selected = {
    name: "Editorial Welcome",
    visualSystem: { layoutType: "editorial", navigationType: "inline", density: "spacious" },
  };
  const rejected = [
    { name: "Ops Console", visualSystem: { layoutType: "dashboard", navigationType: "sidebar", density: "dense" } },
  ];
  const recommendations = [
    { title: "A", specificValue: "Add a dashboard summary tile", whyThisProjectNeedsIt: "", impact: "" },
    { title: "B", specificValue: "Put controls in a sidebar", whyThisProjectNeedsIt: "", impact: "" },
    { title: "C", specificValue: "Offer a saved-search shortcut", whyThisProjectNeedsIt: "", impact: "" },
    { title: "D", specificValue: "Send a weekly digest email", whyThisProjectNeedsIt: "", impact: "" },
    { title: "E", specificValue: "Let people export a record", whyThisProjectNeedsIt: "", impact: "" },
  ];

  const kept = filterContradictingRecommendations(recommendations, selected, rejected);
  const titles = kept.map((entry) => entry.title);
  assert.deepEqual(titles, ["C", "D", "E"]);

  // Ideas that name the chosen direction alongside a rejected one are comparing,
  // not contradicting, and must survive.
  const comparing = [
    { title: "A", specificValue: "Prefer an editorial rhythm over a dashboard grid", whyThisProjectNeedsIt: "", impact: "" },
    { title: "C", specificValue: "Offer a saved-search shortcut", whyThisProjectNeedsIt: "", impact: "" },
    { title: "D", specificValue: "Send a weekly digest email", whyThisProjectNeedsIt: "", impact: "" },
  ];
  assert.equal(filterContradictingRecommendations(comparing, selected, rejected).length, 3);

  // normalizeProjectDesign rejects fewer than three, so the floor holds even
  // when everything conflicts.
  const allConflicting = recommendations.slice(0, 3).map((entry, index) => ({
    ...entry,
    specificValue: index === 2 ? entry.specificValue : "Use a dense dashboard sidebar",
  }));
  assert.equal(filterContradictingRecommendations(allConflicting, selected, rejected).length, 3);
});
