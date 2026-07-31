function check({
  checkId,
  label,
  acceptanceCondition,
  evidenceKinds,
  origin = "customer-stated",
  dependencyCheckIds = [],
}) {
  return {
    checkId,
    label,
    origin,
    acceptanceCondition,
    evidenceKinds,
    dependencyCheckIds,
  };
}

function profile({
  missionId,
  name,
  summary,
  family,
  platform,
  actors,
  outcomes,
  capabilities,
  dataConcepts,
  architectureDecisions,
  questions,
  suggestions,
  sourceRequirementIds,
  selectedStack,
  runtimeAdapterId,
  planId,
  checks,
}) {
  return {
    missionId,
    profileVersion: 1,
    name,
    summary,
    family,
    platform,
    primaryActors: actors,
    primaryJourneys: outcomes,
    outcomes,
    observations: outcomes.map(
      (outcome) => `${actors.join(" and ")} depend on this outcome: ${outcome}`,
    ),
    designDirection: {
      recommendedStyle: `${name} focused on ${actors.join(" and ")}`,
      reason: summary,
      layoutApproach: outcomes[0],
      tone: `Direct language for ${actors.join(" and ")}`,
      mobilePriority: `Preserve the ${outcomes[0]} workflow on smaller screens.`,
      accessibilityConsiderations: [
        `Make ${outcomes[0]} operable with a keyboard and readable at high zoom.`,
      ],
    },
    designAlternatives: [],
    includedDefaults: [],
    assumptions: [],
    capabilities,
    dataConcepts,
    constraints: ["No blocking runtime errors"],
    architectureDecisions,
    openQuestions: questions,
    contextualSuggestions: suggestions,
    customerContent: {
      supplied: [],
      missingBeforeLaunch: [],
    },
    sourceRequirementIds,
    selectedStack,
    runtimeAdapterId,
    requirementContractVersion: 1,
    verificationPlan: { planId, checks },
  };
}

export function inventoryCertificationFixture(
  missionId = "fixture-inventory",
) {
  return profile({
    missionId,
    name: "Stockroom",
    summary: "Track items and quantities with persistence after refresh.",
    family: "web-application",
    platform: "web",
    actors: ["operator"],
    outcomes: ["Create an item and update its available quantity."],
    capabilities: ["persistent-data", "interactive-workflow"],
    dataConcepts: ["item", "quantity"],
    architectureDecisions: ["server-backed persistence"],
    questions: [],
    suggestions: [
      {
        suggestionId: "quantity-validation",
        label: "Define how invalid quantities are handled",
        rationale: "This makes the data rule observable.",
      },
    ],
    sourceRequirementIds: ["customer-intent"],
    selectedStack: {
      stackId: "nextjs-typescript-sqlite-npm-playwright",
      version: "1.0.0",
    },
    runtimeAdapterId: "web-runtime",
    planId: "stockroom-verification",
    checks: [
      check({
        checkId: "item-created",
        label: "A user can create an item with an initial quantity.",
        acceptanceCondition: {
          type: "browser-check-equals",
          check: "itemCreated",
          expected: true,
          checkpointIndependent: false,
        },
        evidenceKinds: ["browser-interaction-result"],
      }),
      check({
        checkId: "quantity-persists",
        label: "An updated quantity remains after refresh.",
        acceptanceCondition: {
          type: "browser-check-equals",
          check: "quantityPersists",
          expected: true,
          checkpointIndependent: false,
        },
        evidenceKinds: ["browser-interaction-result"],
        dependencyCheckIds: ["item-created"],
      }),
      check({
        checkId: "runtime-ready",
        label: "The application starts and becomes ready.",
        origin: "foundry-derived",
        acceptanceCondition: {
          type: "runtime-readiness-equals",
          expectedReady: true,
          checkpointIndependent: false,
        },
        evidenceKinds: ["runtime-readiness-result"],
      }),
    ],
  });
}

export function marketingWebsiteFixture(
  missionId = "fixture-marketing-site",
) {
  return profile({
    missionId,
    name: "Acme Launch",
    summary:
      "Publish a responsive business website that explains the offer and captures qualified enquiries.",
    family: "marketing-website",
    platform: "web",
    actors: ["prospective customer", "content owner"],
    outcomes: ["A visitor understands the offer and can submit an enquiry."],
    capabilities: ["responsive-content", "lead-capture", "accessible-navigation"],
    dataConcepts: ["enquiry"],
    architectureDecisions: ["server-rendered public pages", "validated enquiry endpoint"],
    questions: [
      {
        questionId: "content-ownership",
        prompt: "Who updates published content?",
        reason: "This changes the content architecture.",
        answerOptions: ["Project owner", "Content team"],
      },
    ],
    suggestions: [
      {
        suggestionId: "proof-section",
        label: "Add observable customer proof",
        rationale: "Supports the visitor decision without changing the primary workflow.",
      },
    ],
    sourceRequirementIds: ["marketing-intent", "lead-intent"],
    selectedStack: {
      stackId: "nextjs-typescript-sqlite-npm-playwright",
      version: "1.0.0",
    },
    runtimeAdapterId: "web-runtime",
    planId: "marketing-site-verification",
    checks: [
      check({
        checkId: "offer-visible",
        label: "The primary offer is visible on the landing page.",
        acceptanceCondition: {
          type: "browser-check-equals",
          check: "primaryOfferVisible",
          expected: true,
          checkpointIndependent: false,
        },
        evidenceKinds: ["browser-interaction-result"],
      }),
      check({
        checkId: "enquiry-submitted",
        label: "A visitor can submit a valid enquiry.",
        acceptanceCondition: {
          type: "browser-check-equals",
          check: "enquirySubmitted",
          expected: true,
          checkpointIndependent: false,
        },
        evidenceKinds: ["browser-interaction-result"],
        dependencyCheckIds: ["offer-visible"],
      }),
    ],
  });
}

export function restApiFixture(missionId = "fixture-rest-api") {
  return profile({
    missionId,
    name: "Reservation API",
    summary:
      "Provide a REST service that creates and retrieves reservations with clear validation failures.",
    family: "api-service",
    platform: "web-service",
    actors: ["trusted client application"],
    outcomes: ["A client can create and retrieve a valid reservation."],
    capabilities: ["json-api", "persistent-data", "input-validation"],
    dataConcepts: ["reservation"],
    architectureDecisions: ["versioned HTTP endpoints", "server-owned persistence"],
    questions: [
      {
        questionId: "api-access",
        prompt: "Which callers may use the service?",
        reason: "This determines authentication and rate limits.",
        answerOptions: ["Internal services", "Signed-in customers", "Public clients"],
      },
    ],
    suggestions: [
      {
        suggestionId: "conflict-contract",
        label: "Define the response for a conflicting reservation",
        rationale: "Turns an important failure path into a verifiable contract.",
      },
    ],
    sourceRequirementIds: ["reservation-create", "reservation-read"],
    selectedStack: {
      stackId: "nextjs-typescript-sqlite-npm-playwright",
      version: "1.0.0",
    },
    runtimeAdapterId: "web-service-runtime",
    planId: "reservation-api-verification",
    checks: [
      check({
        checkId: "reservation-created",
        label: "A valid request creates a reservation.",
        acceptanceCondition: {
          type: "http-status-equals",
          expectedStatus: 201,
          checkpointIndependent: false,
        },
        evidenceKinds: ["http-response-result"],
      }),
      check({
        checkId: "reservation-retrieved",
        label: "The created reservation can be retrieved.",
        acceptanceCondition: {
          type: "http-status-equals",
          expectedStatus: 200,
          checkpointIndependent: false,
        },
        evidenceKinds: ["http-response-result"],
        dependencyCheckIds: ["reservation-created"],
      }),
    ],
  });
}

export const certificationProjectFixtures = Object.freeze([
  inventoryCertificationFixture,
  marketingWebsiteFixture,
  restApiFixture,
]);
