import { MissionState } from "../domain/lifecycle.js";
import {
  LatencyProfile,
  ModelCapability,
  TaskDepth,
} from "../domain/ai-registry.js";
import {
  MODEL_GATEWAY_SOURCE,
  ModelTaskClass,
  ModelTier,
  normalizeModelCallRecord,
} from "../domain/execution.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import {
  ProjectFamily,
  normalizeProjectProfile,
} from "../domain/project-profile.js";
import { CREATIVE_DNA_SCHEMA } from "../domain/creative-direction.js";
import {
  DESIGN_VISUAL_SYSTEM_SCHEMA,
  PROJECT_DESIGN_SCHEMA,
  normalizeProjectDesign,
  validateProjectDesignQuality,
} from "../domain/project-design.js";
import {
  createProductBlueprint,
  normalizeProductBlueprint,
} from "../domain/product-blueprint.js";
import {
  createApprovedProjectContract,
  validateApprovedProjectContractConsistency,
} from "../domain/approved-project-contract.js";
import { normalizeApprovedDesignContract } from "../domain/live-concept-studio.js";
import {
  CERTIFIED_STACK_ID,
  CERTIFIED_STACK_VERSION,
  WEB_STACK_MANIFEST,
} from "../domain/toolchain-stack.js";
import {
  PRODUCT_TYPE_DISCOVERY_SCHEMA,
  normalizeProductTypeDiscovery,
  productTypeDiscoveryPrompt,
  shouldDiscoverProductType,
  validateDiscoveryPortfolioDifferentiation,
} from "../domain/product-type-discovery.js";
import {
  classifyModelRouteFailure,
  excludePermanentlyRejectedRoutes,
  validateStructuredModelOutput,
} from "../work-plane/model-gateway.js";

export const PROJECT_UNDERSTANDING_SOURCE =
  "PROJECT_UNDERSTANDING_SERVICE";
const PROJECT_UNDERSTANDING_DEPTH = TaskDepth.ARCHITECTURE;
const PROJECT_UNDERSTANDING_TIER = ModelTier.ARCHITECTURE;
// Product intelligence is accepted only when the selected route produces a
// publishable first response. Paid correction and provider failover loops hide
// contract defects and multiply cost, so they are intentionally disabled.
const MAX_PRODUCT_INTELLIGENCE_ROUTES = 1;
const MAX_PRODUCT_INTELLIGENCE_GENERATIONS = 1;
const PROJECT_DESIGN_MODEL_FIELDS = Object.freeze([
  ...PROJECT_DESIGN_SCHEMA.required,
  "designAlternatives",
]);

export function projectGroundingContext(intent, answers = []) {
  return [
    intent,
    ...answers.flatMap((answer) => [
      answer?.answer,
      answer?.selection?.value,
      answer?.selection?.reason,
    ]),
  ]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .join("\n");
}

const stringArray = Object.freeze({
  type: "array",
  items: { type: "string" },
});
const nonEmptyStringArray = Object.freeze({
  type: "array",
  minItems: 1,
  items: { type: "string", minLength: 1 },
});

const PROJECT_PLATFORMS = Object.freeze([
  "web",
  "mobile",
  "desktop",
  "game",
  "other",
]);

const CUSTOMER_CONTENT_KINDS = Object.freeze([
  "business-name",
  "offerings",
  "service-area",
  "contact-details",
  "brand-assets",
  "trust-evidence",
  "business-copy",
  "business-hours",
  "pricing",
  "policies",
  "other",
]);

const legacyProfileProjectionSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "summary",
    "family",
    "platform",
    "audiences",
    "primaryJourneys",
    "designDirection",
    "proposedFeatures",
    "includedDefaults",
    "recommendations",
    "importantDecisions",
    "assumptions",
    "capabilities",
    "dataConcepts",
    "constraints",
    "architectureDecisions",
    "observations",
    "designAlternatives",
    "customerSuppliedContent",
    "missingCustomerContent",
    "obligations",
  ],
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    family: {
      type: "string",
      enum: Object.values(ProjectFamily),
    },
    platform: {
      type: "string",
      enum: PROJECT_PLATFORMS,
    },
    audiences: nonEmptyStringArray,
    primaryJourneys: nonEmptyStringArray,
    designDirection: {
      type: "object",
      additionalProperties: false,
      required: [
        "recommendedStyle",
        "reason",
        "layoutApproach",
        "tone",
        "mobilePriority",
        "accessibilityConsiderations",
      ],
      properties: {
        recommendedStyle: { type: "string", minLength: 1 },
        reason: { type: "string", minLength: 1 },
        layoutApproach: { type: "string", minLength: 1 },
        tone: { type: "string", minLength: 1 },
        mobilePriority: { type: "string", minLength: 1 },
        accessibilityConsiderations: nonEmptyStringArray,
      },
    },
    proposedFeatures: nonEmptyStringArray,
    includedDefaults: nonEmptyStringArray,
    recommendations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "rationale"],
        properties: {
          label: { type: "string", minLength: 1 },
          rationale: { type: "string", minLength: 1 },
        },
      },
    },
    importantDecisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "reason", "answerOptions"],
        properties: {
          prompt: { type: "string", minLength: 1 },
          reason: { type: "string", minLength: 1 },
          answerOptions: nonEmptyStringArray,
        },
      },
    },
    assumptions: stringArray,
    primaryActors: nonEmptyStringArray,
    outcomes: nonEmptyStringArray,
    capabilities: {
      type: "array",
      items: {
        type: "string",
        enum: WEB_STACK_MANIFEST.supportedCapabilities,
      },
    },
    dataConcepts: stringArray,
    constraints: stringArray,
    architectureDecisions: stringArray,
    observations: stringArray,
    designAlternatives: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["approach", "rationale", "recommended"],
        properties: {
          approach: { type: "string" },
          rationale: { type: "string" },
          recommended: { type: "boolean" },
        },
      },
    },
    openQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "reason", "answerOptions"],
        properties: {
          prompt: { type: "string" },
          reason: { type: "string" },
          answerOptions: nonEmptyStringArray,
        },
      },
    },
    contextualSuggestions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "rationale"],
        properties: {
          label: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
    customerSuppliedContent: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "value"],
        properties: {
          kind: {
            type: "string",
            enum: CUSTOMER_CONTENT_KINDS,
          },
          value: { type: "string", minLength: 1 },
        },
      },
    },
    missingCustomerContent: stringArray,
    obligations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "statement",
          "origin",
          "verificationMode",
          "dependencyIndexes",
          "outcomeIndexes",
        ],
        properties: {
          statement: { type: "string" },
          origin: {
            type: "string",
            enum: ["customer-stated", "foundry-derived"],
          },
          verificationMode: {
            type: "string",
            enum: [
              "browser-check",
              "browser-errors",
              "dependency-lock",
              "dependency-install",
              "type-check",
              "lint",
              "production-build",
              "runtime-ready",
              "http-ready",
              "structured-tests",
            ],
          },
          dependencyIndexes: {
            type: "array",
            items: { type: "integer" },
          },
          outcomeIndexes: {
            type: "array",
            minItems: 1,
            items: { type: "integer" },
          },
        },
      },
    },
  },
});

const understandingSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "family",
    "platform",
    ...PROJECT_DESIGN_MODEL_FIELDS,
    "capabilities",
    "dataConcepts",
    "architectureDecisions",
    "customerSuppliedContent",
    "missingCustomerContent",
  ],
  properties: {
    name: { type: "string", minLength: 1 },
    family: { type: "string", enum: Object.values(ProjectFamily) },
    platform: { type: "string", enum: PROJECT_PLATFORMS },
    ...PROJECT_DESIGN_SCHEMA.properties,
    designAlternatives: {
      ...PROJECT_DESIGN_SCHEMA.properties.designAlternatives,
      maxItems: 12,
    },
    capabilities: {
      type: "array",
      items: {
        type: "string",
        enum: WEB_STACK_MANIFEST.supportedCapabilities,
      },
    },
    dataConcepts: stringArray,
    architectureDecisions: stringArray,
    customerSuppliedContent:
      legacyProfileProjectionSchema.properties.customerSuppliedContent,
    missingCustomerContent: stringArray,
  },
});

const fastText = Object.freeze({ type: "string", minLength: 1, maxLength: 240 });
const fastList = Object.freeze({
  type: "array",
  minItems: 1,
  maxItems: 5,
  items: fastText,
});
export const FAST_INITIAL_UNDERSTANDING_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "family",
    "platform",
    "customerOutcome",
    "intendedUsers",
    "primaryGoal",
    "primaryJourneys",
    "essentialCapabilities",
    "explicitExclusions",
    "designDirection",
    "designAlternatives",
    "observations",
    "opportunities",
    "risks",
    "assumptions",
    "recommendations",
    "decisions",
    "capabilities",
    "dataConcepts",
    "architectureDecisions",
    "customerSuppliedContent",
    "missingCustomerContent",
  ],
  properties: {
    name: { ...fastText, maxLength: 80 },
    family: { type: "string", enum: Object.values(ProjectFamily) },
    platform: { type: "string", enum: PROJECT_PLATFORMS },
    customerOutcome: fastText,
    intendedUsers: fastList,
    primaryGoal: fastText,
    primaryJourneys: fastList,
    essentialCapabilities: {
      type: "array",
      minItems: 1,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "acceptanceMethod"],
        properties: {
          statement: fastText,
          acceptanceMethod:
            PROJECT_DESIGN_SCHEMA.properties.verificationPlan.items.properties
              .acceptanceMethod,
        },
      },
    },
    explicitExclusions: fastList,
    designDirection: {
      type: "object",
      additionalProperties: false,
      required: [
        "visualPersonality",
        "layoutStrategy",
        "informationDensity",
        "navigationApproach",
        "responsivePriority",
        "accessibilityNeeds",
        "rationale",
      ],
      properties: {
        visualPersonality: fastText,
        layoutStrategy: fastText,
        informationDensity: fastText,
        navigationApproach: fastText,
        responsivePriority: fastText,
        accessibilityNeeds: fastList,
        rationale: fastText,
      },
    },
    designAlternatives: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        // Every field here is per-alternative on purpose. Density, navigation
        // and mobile behavior used to be inherited from the single recommended
        // designDirection during expansion, which silently collapsed three
        // "independent" directions onto one structure.
        required: [
          "name",
          "whyItFits",
          "visualPersonality",
          "layoutApproach",
          "informationDensity",
          "navigationApproach",
          "mobileBehavior",
          "tradeoff",
          "recommended",
          "visualSystem",
          "creativeDNA",
        ],
        properties: {
          name: fastText,
          whyItFits: fastText,
          visualPersonality: fastText,
          layoutApproach: fastText,
          informationDensity: fastText,
          navigationApproach: fastText,
          mobileBehavior: fastText,
          tradeoff: fastText,
          recommended: { type: "boolean" },
          visualSystem: DESIGN_VISUAL_SYSTEM_SCHEMA,
          creativeDNA: CREATIVE_DNA_SCHEMA,
        },
      },
    },
    observations: fastList,
    opportunities: fastList,
    risks: fastList,
    assumptions: { ...fastList, minItems: 0 },
    recommendations: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "specificValue",
          "whyThisProjectNeedsIt",
          "selectedByDefault",
        ],
        properties: {
          title: fastText,
          specificValue: fastText,
          whyThisProjectNeedsIt: fastText,
          selectedByDefault: { type: "boolean" },
        },
      },
    },
    decisions: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "recommendedOption", "alternatives"],
        properties: {
          question: fastText,
          recommendedOption: fastText,
          alternatives: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: fastText,
          },
        },
      },
    },
    capabilities: {
      type: "array",
      maxItems: 10,
      items: {
        type: "string",
        enum: WEB_STACK_MANIFEST.supportedCapabilities,
      },
    },
    dataConcepts: fastList,
    architectureDecisions: fastList,
    customerSuppliedContent:
      legacyProfileProjectionSchema.properties.customerSuppliedContent,
    missingCustomerContent: { ...fastList, minItems: 0 },
  },
});

export function normalizeUnderstandingCandidateBounds(candidate) {
  if (candidate === null || typeof candidate !== "object") {
    return candidate;
  }
  let designAlternatives = candidate.designAlternatives;
  if (
    Array.isArray(designAlternatives) &&
    designAlternatives.length > 7
  ) {
    const retained = designAlternatives.slice(0, 7);
    const recommended = designAlternatives.find(
      (alternative) => alternative?.recommended === true,
    );
    if (recommended !== undefined && !retained.includes(recommended)) {
      retained[retained.length - 1] = recommended;
    }
    designAlternatives = retained;
  }
  const audience = String(
    candidate.projectIntent?.intendedUsers?.[0] ?? "the people using this project",
  ).trim();
  const technicalQuestionTerms =
    /\b(?:api|architecture|database|delegated|middleware|oauth|persistence|runtime|schema|server-side|stateless|topology|webhook)\b/iu;
  const decisions = Array.isArray(candidate.decisions)
    ? candidate.decisions.map((decision) => {
        const alternatives = Array.isArray(decision?.alternatives)
          ? decision.alternatives
          : [];
        const consequences = Array.isArray(decision?.consequenceOfEachChoice)
          ? decision.consequenceOfEachChoice
          : [];
        const seen = new Set();
        const retainedIndexes = alternatives
          .map((alternative, index) => ({
            index,
            key: String(alternative).trim().replace(/\s+/gu, " ").toLowerCase(),
          }))
          .filter(({ key }) => {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .map(({ index }) => index);
        const canDeduplicate =
          retainedIndexes.length >= 3 &&
          retainedIndexes.length < alternatives.length &&
          consequences.length === alternatives.length;
        return {
          ...decision,
          customerFriendlyQuestion: technicalQuestionTerms.test(
            String(decision?.customerFriendlyQuestion ?? ""),
          )
            ? `Which customer-visible outcome should Foundry prioritize for ${audience}?`
            : decision.customerFriendlyQuestion,
          alternatives: canDeduplicate
            ? retainedIndexes.map((index) => alternatives[index])
            : alternatives,
          consequenceOfEachChoice: canDeduplicate
            ? retainedIndexes.map((index) => consequences[index])
            : consequences,
        };
      })
    : candidate.decisions;
  return {
    ...candidate,
    designAlternatives,
    decisions,
  };
}

function groundedFastText(value, anchor, minimumWords = 8) {
  const base = String(value ?? "").trim();
  const words = base.split(/\s+/u).filter(Boolean);
  if (words.length >= minimumWords) return base;
  const normalizedAnchor = String(anchor ?? "")
    .trim()
    .replace(/[.!?]+$/u, "");
  return `${base}${/[.!?]$/u.test(base) ? "" : "."} This supports ${normalizedAnchor}.`;
}

export function normalizeFastDecisionAlternatives(
  recommendedOption,
  alternatives,
) {
  const unique = [];
  for (const value of [recommendedOption, ...(alternatives ?? [])]) {
    if (typeof value !== "string" || value.trim() === "") continue;
    if (
      unique.some(
        (existing) =>
          existing.trim().toLowerCase() === value.trim().toLowerCase(),
      )
    ) continue;
    unique.push(value);
  }
  return unique.length >= 3 ? unique.slice(0, 3) : [];
}

export function expandFastInitialUnderstanding(brief) {
  const customerOutcome = groundedFastText(
    brief.customerOutcome,
    brief.primaryGoal,
    8,
  );
  const primaryGoal = groundedFastText(
    brief.primaryGoal,
    customerOutcome,
    6,
  );
  const intendedUsers = [...brief.intendedUsers];
  const recommendations = brief.recommendations.map((item) => ({
    title: item.title,
    specificValue: groundedFastText(item.specificValue, primaryGoal, 6),
    whyThisProjectNeedsIt: groundedFastText(
      item.whyThisProjectNeedsIt,
      primaryGoal,
      8,
    ),
    impact: `Changes first-version scope and proof for ${item.title}.`,
    selectedByDefault: item.selectedByDefault,
    confidence: {
      score: 0.8,
      rationale: groundedFastText(item.whyThisProjectNeedsIt, primaryGoal, 8),
    },
    requiredDependencies: [],
  }));
  const recommendedIndex = Math.max(
    0,
    brief.designAlternatives.findIndex((item) => item.recommended === true),
  );
  const recommendedDirection = brief.designAlternatives[recommendedIndex];
  const designDirection = {
    visualPersonality: recommendedDirection.visualPersonality,
    tone: brief.designDirection.visualPersonality,
    layoutStrategy: brief.designDirection.layoutStrategy,
    informationDensity: brief.designDirection.informationDensity,
    navigationApproach: brief.designDirection.navigationApproach,
    responsivePriority: brief.designDirection.responsivePriority,
    accessibilityNeeds: brief.designDirection.accessibilityNeeds,
    contentStrategy: groundedFastText(
      brief.designDirection.rationale,
      primaryGoal,
      8,
    ),
    interactionStyle: brief.designDirection.navigationApproach,
    rationale: groundedFastText(
      brief.designDirection.rationale,
      primaryGoal,
      8,
    ),
  };
  // Each alternative keeps its OWN density, navigation, mobile behavior and
  // creative DNA. The shared designDirection is used only as a last-resort
  // fallback for briefs produced before those fields existed — never as an
  // override of a direction the model actually differentiated.
  const designAlternatives = brief.designAlternatives.map((item, index) => {
    const whyItFits = groundedFastText(item.whyItFits, primaryGoal, 8);
    const dna = item.creativeDNA;
    return {
      name: item.name,
      description: whyItFits,
      whyItFits,
      layoutApproach: item.layoutApproach,
      visualPersonality: item.visualPersonality,
      informationDensity:
        item.informationDensity ?? designDirection.informationDensity,
      navigationApproach:
        item.navigationApproach ?? designDirection.navigationApproach,
      mobileBehavior: item.mobileBehavior ?? designDirection.responsivePriority,
      tradeoff: groundedFastText(item.tradeoff, primaryGoal, 5),
      confidence: { score: 0.75, rationale: whyItFits },
      recommended: index === recommendedIndex,
      preview: {
        typographyCharacter: dna?.typeVoice
          ? `${dna.typeVoice.replaceAll("-", " ")}, ${dna.typeScale} scale`
          : item.visualPersonality,
        spacingDensity:
          dna?.spacingRhythm?.replaceAll("-", " ") ??
          item.informationDensity ??
          designDirection.informationDensity,
        colorMood: item.visualPersonality,
        hierarchy: dna?.surfaceSequence?.join(" → ") ?? item.layoutApproach,
      },
      visualSystem: item.visualSystem,
      ...(dna === undefined ? {} : { creativeDNA: dna }),
    };
  });
  const decisions = brief.decisions.flatMap((item) => {
    const alternatives = normalizeFastDecisionAlternatives(
      item.recommendedOption,
      item.alternatives,
    );
    if (alternatives.length < 3) return [];
    return [{
      customerFriendlyQuestion: item.question,
      whyItMatters: groundedFastText(item.question, primaryGoal, 8),
      recommendation: item.recommendedOption,
      recommendationReason: groundedFastText(
        `The recommended choice best supports ${primaryGoal}`,
        customerOutcome,
        8,
      ),
      alternatives,
      consequenceOfEachChoice: alternatives.map(
        (option) =>
          `Choosing ${option} changes the approved customer-visible scope for ${primaryGoal}.`,
      ),
      canFoundryDecide: false,
      architectureImpact: `The selected outcome changes how Foundry delivers ${primaryGoal}.`,
      scopeImpact: `The selected outcome changes first-version scope for ${primaryGoal}.`,
    }];
  });
  const verificationPlan = [
    ...brief.essentialCapabilities.map((capability) => ({
      observableOutcome: `${capability.statement}: observable evidence proves this approved capability works.`,
      acceptanceMethod: capability.acceptanceMethod,
      evidenceRequired: [`Recorded evidence for ${capability.statement}`],
      sourceRequirement: "customer-intent-1",
      origin: "customer-stated",
      dependencyIndexes: [],
    })),
    ...(brief.platform === "web"
      ? [{
          observableOutcome: `${brief.name} preserves its approved ${brief.designDirection.informationDensity}; ${brief.designDirection.responsivePriority}; ${brief.designDirection.navigationApproach}; and accessible keyboard behavior including ${brief.designDirection.accessibilityNeeds.join(", ")}.`,
          acceptanceMethod: "browser-check",
          evidenceRequired: [
            "Responsive viewport, keyboard interaction, visible focus, and horizontal-overflow browser evidence",
          ],
          sourceRequirement: "foundry-derived-design-quality",
          origin: "foundry-derived",
          dependencyIndexes: [],
        }]
      : []),
    {
      observableOutcome: `${brief.name} completes a production build for the approved first-version scope.`,
      acceptanceMethod: "production-build",
      evidenceRequired: ["Successful production build output"],
      sourceRequirement: "foundry-derived-production-readiness",
      origin: "foundry-derived",
      dependencyIndexes: [],
    },
    {
      observableOutcome: `${brief.name} completes its primary browser workflow without blocking browser errors.`,
      acceptanceMethod: "browser-errors",
      evidenceRequired: ["Browser console and page-error evidence"],
      sourceRequirement: "foundry-derived-browser-stability",
      origin: "foundry-derived",
      dependencyIndexes: [],
    },
  ];
  const observations = brief.observations.map((item) =>
    groundedFastText(item, customerOutcome, 8),
  );
  return {
    name: brief.name,
    family: brief.family,
    platform: brief.platform,
    projectIntent: {
      customerOutcome,
      businessContext: groundedFastText(customerOutcome, primaryGoal, 8),
      intendedUsers,
      primaryGoal,
      secondaryGoals: recommendations.map((item) => item.specificValue),
      successDefinition: groundedFastText(
        `Success means ${customerOutcome}`,
        primaryGoal,
        8,
      ),
      constraints: [...brief.explicitExclusions, ...brief.architectureDecisions],
      confidence: {
        score: 0.8,
        rationale: groundedFastText(customerOutcome, primaryGoal, 8),
      },
    },
    userExperiencePlan: {
      primaryJourneys: brief.primaryJourneys,
      secondaryJourneys: [],
      criticalMoments: brief.primaryJourneys,
      failureStates: brief.risks,
      trustMoments: observations,
      repeatedTasks: brief.primaryJourneys,
      adminResponsibilities: [
        groundedFastText(
          `${intendedUsers[0]} supports ${primaryGoal}`,
          customerOutcome,
          8,
        ),
      ],
    },
    productProposal: {
      essentialCapabilities: brief.essentialCapabilities.map(
        (item) => item.statement,
      ),
      recommendedCapabilities: recommendations.map(
        (item) => item.specificValue,
      ),
      intentionallyExcludedCapabilities: brief.explicitExclusions,
      futureCapabilities: [],
      rationale: groundedFastText(customerOutcome, primaryGoal, 8),
      dependencies: brief.architectureDecisions,
      scopeImpact: groundedFastText(
        brief.explicitExclusions.join("; "),
        primaryGoal,
        8,
      ),
    },
    designDirection,
    designAlternatives,
    foundryInsights: {
      observations,
      opportunities: brief.opportunities,
      risks: brief.risks,
      ambiguities: [],
      assumptions: brief.assumptions,
      confidence: {
        score: 0.8,
        rationale: groundedFastText(customerOutcome, primaryGoal, 8),
      },
    },
    decisions,
    recommendations,
    verificationPlan,
    capabilities: brief.capabilities,
    dataConcepts: brief.dataConcepts,
    architectureDecisions: brief.architectureDecisions,
    customerSuppliedContent: brief.customerSuppliedContent,
    missingCustomerContent: brief.missingCustomerContent,
  };
}

const UNDERSTANDING_REVISION_FIELDS = Object.freeze([
  ...PROJECT_DESIGN_MODEL_FIELDS,
  "name",
  "family",
  "platform",
  "capabilities",
  "dataConcepts",
  "architectureDecisions",
  "customerSuppliedContent",
  "missingCustomerContent",
]);

const REVISION_FIELDS_BY_INPUT_KIND = Object.freeze({
  context: UNDERSTANDING_REVISION_FIELDS,
  understanding: UNDERSTANDING_REVISION_FIELDS,
  workflow: [
    "projectIntent",
    "userExperiencePlan",
    "productProposal",
    "verificationPlan",
  ],
  feature: [
    "userExperiencePlan",
    "productProposal",
    "recommendations",
    "verificationPlan",
  ],
  design: [
    "designDirection",
    "designAlternatives",
    "foundryInsights",
    "verificationPlan",
  ],
  "business-rule": [
    "userExperiencePlan",
    "productProposal",
    "decisions",
    "verificationPlan",
    "architectureDecisions",
  ],
  role: [
    "projectIntent",
    "userExperiencePlan",
    "productProposal",
    "verificationPlan",
  ],
  integration: [
    "productProposal",
    "recommendations",
    "decisions",
    "verificationPlan",
    "architectureDecisions",
    "dataConcepts",
    "capabilities",
  ],
  limitation: [
    "projectIntent",
    "productProposal",
    "foundryInsights",
    "decisions",
    "verificationPlan",
    "architectureDecisions",
  ],
  acceptance: ["productProposal", "verificationPlan"],
});

function revisionFieldsForAnswers(answers) {
  const fields = new Set();
  for (const answer of answers) {
    const selectionKind = answer.selection?.kind;
    if (selectionKind === "customer-message") {
      for (const field of UNDERSTANDING_REVISION_FIELDS) fields.add(field);
      continue;
    }
    if (selectionKind === "design-direction") {
      for (const field of [
        "designDirection",
        "designAlternatives",
        "userExperiencePlan",
        "recommendations",
        "decisions",
        "verificationPlan",
      ]) fields.add(field);
      continue;
    }
    if (selectionKind === "recommendation") {
      for (const field of [
        "productProposal",
        "recommendations",
        "userExperiencePlan",
        "decisions",
        "verificationPlan",
      ]) fields.add(field);
      continue;
    }
    if (selectionKind === "decision") {
      for (const field of [
        "projectIntent",
        "userExperiencePlan",
        "productProposal",
        "designDirection",
        "designAlternatives",
        "recommendations",
        "decisions",
        "foundryInsights",
        "verificationPlan",
        "architectureDecisions",
      ]) fields.add(field);
      continue;
    }
    const kind = Object.keys(REVISION_FIELDS_BY_INPUT_KIND).find(
      (candidate) =>
        answer.questionId.startsWith(`customer-input-${candidate}-`),
    );
    const scoped =
      kind === undefined ? undefined : REVISION_FIELDS_BY_INPUT_KIND[kind];
    if (scoped === undefined) return new Set(UNDERSTANDING_REVISION_FIELDS);
    scoped.forEach((field) => fields.add(field));
  }
  return fields.size > 0
    ? fields
    : new Set(UNDERSTANDING_REVISION_FIELDS);
}

const understandingRevisionEnvelopeSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["operations"],
  properties: {
    operations: {
      type: "array",
      minItems: 1,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["op", "path", "valueJson"],
        properties: {
          op: { type: "string", enum: ["add", "replace", "remove"] },
          path: { type: "string", minLength: 2 },
          valueJson: { type: "string", minLength: 1, maxLength: 800 },
        },
      },
    },
  },
});

function understandingFromCurrent(profile, projectDesign) {
  return {
    name: profile.name,
    family: profile.family,
    platform: profile.platform,
    ...structuredClone(projectDesign),
    capabilities: structuredClone(profile.capabilities),
    dataConcepts: structuredClone(profile.dataConcepts),
    architectureDecisions: structuredClone(profile.architectureDecisions),
    customerSuppliedContent: structuredClone(
      profile.customerContent.supplied.map(({ kind, value }) => ({
        kind,
        value,
      })),
    ),
    missingCustomerContent: structuredClone(
      profile.customerContent.missingBeforeLaunch,
    ),
  };
}

export function parseUnderstandingRevisionValue({
  valueJson,
  operation = "replace",
  existingValue,
  operationIndex = 0,
}) {
  try {
    return JSON.parse(valueJson);
  } catch (error) {
    if (
      operation !== "remove" &&
      operation !== "add" &&
      typeof existingValue === "string"
    ) {
      return valueJson.trim();
    }
    throw new TypeError(
      `Revision operation ${operationIndex + 1} must contain valid JSON for a non-string leaf.`,
      { cause: error },
    );
  }
}

function applyUnderstandingRevision(
  currentUnderstanding,
  envelope,
  allowedRevisionFields,
) {
  const revised = structuredClone(currentUnderstanding);
  if (envelope.operations.length > 6) {
    throw new TypeError("A revision may contain at most 6 operations.");
  }
  for (const [operationIndex, operation] of envelope.operations.entries()) {
    if (operation.valueJson.length > 800) {
      throw new TypeError(
        `Revision operation ${operationIndex + 1} contains an oversized leaf value.`,
      );
    }
    if (!/^\/(?:[A-Za-z0-9_-]+)(?:\/(?:[A-Za-z0-9_-]+|-))*$/u.test(operation.path)) {
      throw new TypeError(
        `Revision operation ${operationIndex + 1} has an unsafe path.`,
      );
    }
    const segments = operation.path.slice(1).split("/");
    const field = segments[0];
    if (!allowedRevisionFields.has(field)) {
      throw new TypeError(
        `Revision field ${field} is unrelated to the supplied customer input.`,
      );
    }
    let parent = revised;
    for (const segment of segments.slice(0, -1)) {
      const key = Array.isArray(parent) ? Number(segment) : segment;
      if (
        (Array.isArray(parent) &&
          (!Number.isSafeInteger(key) || key < 0 || key >= parent.length)) ||
        (!Array.isArray(parent) &&
          (parent === null ||
            typeof parent !== "object" ||
            !Object.hasOwn(parent, key)))
      ) {
        throw new TypeError(
          `Revision operation ${operationIndex + 1} targets a missing parent.`,
        );
      }
      parent = parent[key];
    }
    const finalSegment = segments.at(-1);
    // Structured-output providers occasionally satisfy a string-valued
    // `valueJson` field with the intended leaf text but omit the second layer
    // of JSON quotes. Normalize that unambiguous, type-safe case locally.
    const existingValue = Array.isArray(parent)
      ? parent[Number(finalSegment)]
      : parent !== null && typeof parent === "object"
        ? parent[finalSegment]
        : undefined;
    const value = parseUnderstandingRevisionValue({
      valueJson: operation.valueJson,
      operation: operation.op,
      existingValue,
      operationIndex,
    });
    if (Array.isArray(parent)) {
      if (operation.op === "add" && finalSegment === "-") {
        parent.push(value);
        continue;
      }
      const index = Number(finalSegment);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= parent.length
      ) {
        throw new TypeError(
          `Revision operation ${operationIndex + 1} targets an invalid array index.`,
        );
      }
      if (operation.op === "remove") parent.splice(index, 1);
      else parent[index] = value;
      continue;
    }
    if (parent === null || typeof parent !== "object") {
      throw new TypeError(
        `Revision operation ${operationIndex + 1} targets a non-object value.`,
      );
    }
    if (operation.op !== "add" && !Object.hasOwn(parent, finalSegment)) {
      throw new TypeError(
        `Revision operation ${operationIndex + 1} targets a missing value.`,
      );
    }
    if (operation.op === "remove") delete parent[finalSegment];
    else parent[finalSegment] = value;
  }
  for (const item of revised.verificationPlan ?? []) {
    for (const key of ["dependencyIndexes", "outcomeIndexes"]) {
      const indexes = item[key];
      if (
        Array.isArray(indexes) &&
        indexes.includes(0) &&
        indexes.every(
          (index) => Number.isSafeInteger(index) && index >= 0,
        )
      ) {
        item[key] = indexes.map((index) => index + 1);
      }
    }
  }
  return validateStructuredModelOutput(revised, understandingSchema);
}

function identifier(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function acceptance(mode, checkId) {
  switch (mode) {
    case "browser-check":
      return {
        acceptanceCondition: {
          type: "browser-check-equals",
          check: checkId,
          expected: true,
        },
        evidenceKinds: [ObservationKind.BROWSER_INTERACTION_RESULT],
      };
    case "browser-errors":
      return {
        acceptanceCondition: {
          type: "browser-error-counts",
          maxConsoleErrors: 0,
          maxPageErrors: 0,
        },
        evidenceKinds: [ObservationKind.BROWSER_ERROR_RESULT],
      };
    case "dependency-lock":
    case "dependency-install":
    case "type-check":
    case "lint":
    case "production-build":
      return {
        acceptanceCondition: {
          type: "command-exit-code-equals",
          expectedExitCode: 0,
          checkpointIndependent: true,
        },
        evidenceKinds: [ObservationKind.COMMAND_EXIT_RESULT],
      };
    case "runtime-ready":
      return {
        acceptanceCondition: {
          type: "runtime-readiness-equals",
          expectedReady: true,
          checkpointIndependent: true,
        },
        evidenceKinds: [ObservationKind.RUNTIME_READINESS_RESULT],
      };
    case "http-ready":
      return {
        acceptanceCondition: {
          type: "http-status-equals",
          expectedStatus: 200,
          checkpointIndependent: true,
        },
        evidenceKinds: [ObservationKind.HTTP_RESPONSE_RESULT],
      };
    case "structured-tests":
      return {
        acceptanceCondition: {
          type: "structured-test-counts",
          suiteName: "project-browser-verification",
          minimumPassedCount: 1,
          maximumFailedCount: 0,
          maximumSkippedCount: 0,
        },
        evidenceKinds: [ObservationKind.STRUCTURED_TEST_RESULT],
      };
    default:
      throw new TypeError(`Unsupported verification mode: ${mode}.`);
  }
}

function obligationsFromVerificationPlan(verificationPlan, contractVersion) {
  return verificationPlan.map((entry, index) => {
    const obligationId = identifier("obligation", index);
    const observation = acceptance(entry.acceptanceMethod, obligationId);
    const dependencyObligationIds = [
      ...new Set(
        (entry.dependencyIndexes ?? [])
          .filter(
            (dependency) =>
              Number.isSafeInteger(dependency) &&
              dependency >= 1 &&
              dependency <= verificationPlan.length &&
              dependency !== index + 1,
          )
          .map((dependency) => identifier("obligation", dependency - 1)),
      ),
    ];
    return {
      obligationId,
      statement: entry.observableOutcome,
      origin: entry.origin,
      acceptanceCondition: observation.acceptanceCondition,
      requiredEvidenceKinds: observation.evidenceKinds,
      dependencyObligationIds,
      contractVersion,
      sourceRequirement: entry.sourceRequirement,
    };
  });
}

function nonEmptyStrings(values, fallback) {
  const result = Array.isArray(values)
    ? [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  return result.length > 0 ? result : fallback;
}

function normalizedQuestions(questions) {
  const byPrompt = new Map();
  for (const question of questions ?? []) {
    const prompt = String(question.prompt).trim();
    const key = prompt.toLowerCase().replace(/\s+/gu, " ");
    const existing = byPrompt.get(key);
    if (existing === undefined) {
      byPrompt.set(key, {
        prompt,
        reason: String(question.reason).trim(),
        answerOptions: nonEmptyStrings(question.answerOptions, [
          "Use Foundry's recommended option",
        ]),
      });
      continue;
    }
    existing.answerOptions = nonEmptyStrings(
      [...existing.answerOptions, ...(question.answerOptions ?? [])],
      existing.answerOptions,
    );
  }
  return [...byPrompt.values()];
}

function normalizeSourceText(value) {
  return String(value).toLowerCase().replace(/\s+/gu, " ").trim();
}

function customerContentFromUnderstanding(intent, answers, result) {
  const sources = [
    { source: "customer-request", text: intent },
    ...answers.map((answer) => ({
      source: "customer-answer",
      text: String(answer?.answer ?? ""),
    })),
  ];
  const supplied = (result.customerSuppliedContent ?? []).flatMap(
    (item) => {
      const value = String(item.value).trim();
      const comparable = normalizeSourceText(value);
      const matched = sources.find((source) =>
        normalizeSourceText(source.text).includes(comparable),
      );
      if (matched === undefined) {
        return [];
      }
      return [{
        kind: item.kind,
        value,
        source: matched.source,
      }];
    },
  );
  return {
    supplied,
    missingBeforeLaunch: nonEmptyStrings(
      result.missingCustomerContent,
      [],
    ),
  };
}

function validateOutcomeCoverage(result) {
  const covered = new Set();
  for (const [obligationIndex, obligation] of result.obligations.entries()) {
    for (const outcomeIndex of obligation.outcomeIndexes ?? []) {
      if (
        !Number.isSafeInteger(outcomeIndex) ||
        outcomeIndex < 1 ||
        outcomeIndex > result.proposedFeatures.length
      ) {
        throw new TypeError(
          `obligations[${obligationIndex}].outcomeIndexes contains an invalid outcome reference.`,
        );
      }
      covered.add(outcomeIndex);
    }
  }
  const uncovered = result.proposedFeatures
    .map((_, index) => index + 1)
    .filter((index) => !covered.has(index));
  if (uncovered.length > 0) {
    throw new TypeError(
      `The verification plan does not cover outcome indexes: ${uncovered.join(", ")}.`,
    );
  }
}

const CUSTOMER_FOLLOW_UP_STOP_WORDS = new Set([
  "about",
  "also",
  "could",
  "from",
  "have",
  "into",
  "just",
  "like",
  "make",
  "nice",
  "page",
  "should",
  "take",
  "that",
  "their",
  "there",
  "these",
  "this",
  "through",
  "want",
  "with",
  "would",
  "your",
]);

function customerInstructionTerms(value) {
  return [
    ...new Set(
      String(value)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .split(" ")
        .filter(
          (term) =>
            term.length >= 4 && !CUSTOMER_FOLLOW_UP_STOP_WORDS.has(term),
        ),
    ),
  ];
}

function containsCustomerInstructionTerm(value, terms) {
  const candidateTerms = new Set(customerInstructionTerms(value));
  return terms.some((term) => candidateTerms.has(term));
}

export function validateCustomerFollowUpTraceability(projectDesign, answers) {
  const followUps = answers
    .map((answer, index) => ({ answer, index }))
    .filter(
      ({ answer }) =>
        answer?.selection === undefined ||
        answer.selection.kind === "customer-message",
    );
  for (const { answer, index } of followUps) {
    const requirementReference = `customer-follow-up-${index + 1}`;
    const terms = customerInstructionTerms(answer.answer);
    const tracedOutcomes = projectDesign.verificationPlan.filter(
      (entry) => entry.sourceRequirement === requirementReference,
    );
    if (
      tracedOutcomes.length === 0 ||
      (terms.length > 0 &&
        !tracedOutcomes.some((entry) =>
          containsCustomerInstructionTerm(entry.observableOutcome, terms),
        ))
    ) {
      throw new TypeError(
        `Customer instruction ${requirementReference} is not preserved by a traceable observable outcome.`,
      );
    }

    const instructionIsAffirmative =
      !/\b(?:avoid|do\s+not|don['’]?t|exclude|excluded|later|no|not|skip|without)\b/iu.test(
        answer.answer,
      );
    if (!instructionIsAffirmative || terms.length === 0) continue;

    const negatedScope = [
      ...projectDesign.projectIntent.constraints,
      ...projectDesign.productProposal.intentionallyExcludedCapabilities,
      ...projectDesign.productProposal.futureCapabilities.map(
        (capability) => `Later: ${capability}`,
      ),
      ...(projectDesign.architectureDecisions ?? []),
    ];
    const contradiction = negatedScope.find(
      (entry) =>
        /\b(?:avoid|do\s+not|don['’]?t|exclude|excluded|later|no|not|outside|without)\b/iu.test(
          entry,
        ) && containsCustomerInstructionTerm(entry, terms),
    );
    if (contradiction !== undefined) {
      throw new TypeError(
        `Customer instruction ${requirementReference} conflicts with proposed scope: ${contradiction}`,
      );
    }
  }
}

function profileFromUnderstanding(
  missionId,
  intent,
  answers,
  result,
  profileVersion,
) {
  const projectDesign = normalizeProjectDesign(
    Object.fromEntries(
      PROJECT_DESIGN_MODEL_FIELDS.map((key) => [key, result[key]]),
    ),
    { designFamily: result.family },
  );
  validateCustomerFollowUpTraceability(
    {
      ...projectDesign,
      architectureDecisions: nonEmptyStrings(
        result.architectureDecisions,
        [],
      ),
    },
    answers,
  );
  const obligations = projectDesign.verificationPlan;
  if (obligations.length === 0) {
    throw new TypeError(
      "The model returned no observable completion obligations.",
    );
  }
  const customerContent = customerContentFromUnderstanding(
    intent,
    answers,
    result,
  );
  const resolvedCustomerQuestionIds = new Set(
    answers.flatMap((answer) => {
      if (answer.selection?.kind === "decision") {
        return [answer.selection.subjectId];
      }
      return answer.selection === undefined ? [answer.questionId] : [];
    }),
  );
  if (
    customerContent.supplied.length === 0 &&
    obligations.some((obligation) =>
      /\b(?:supplied|provided)\s+(?:business\s+)?(?:content|wording|images?|logo|contact|details?)\b/iu.test(
        obligation.observableOutcome,
      ),
    )
  ) {
    throw new TypeError(
      "The verification plan claims customer-supplied content that was not present in the request or answers.",
    );
  }
  const checks = obligations.map((obligation, index) => {
    const checkId = identifier("obligation", index);
    const observation = acceptance(obligation.acceptanceMethod, checkId);
    const dependencyCheckIds = [
      ...new Set(
        (obligation.dependencyIndexes ?? [])
          .filter(
            (dependency) =>
              Number.isSafeInteger(dependency) &&
              dependency >= 1 &&
              dependency <= obligations.length &&
              dependency !== index + 1,
          )
          .map((dependency) => identifier("obligation", dependency - 1)),
      ),
    ];
    return {
      checkId,
      label: obligation.observableOutcome,
      origin: obligation.origin,
      acceptanceCondition: observation.acceptanceCondition,
      evidenceKinds: observation.evidenceKinds,
      dependencyCheckIds,
    };
  });
  return normalizeProjectProfile({
    missionId,
    profileVersion,
    name: String(result.name).trim(),
    summary: projectDesign.projectIntent.customerOutcome,
    family: result.family,
    platform: String(result.platform).trim(),
    primaryActors: projectDesign.projectIntent.intendedUsers,
    primaryJourneys: projectDesign.userExperiencePlan.primaryJourneys,
    outcomes: projectDesign.productProposal.essentialCapabilities,
    designDirection: {
      recommendedStyle: projectDesign.designDirection.visualPersonality,
      reason: projectDesign.designDirection.rationale,
      layoutApproach: projectDesign.designDirection.layoutStrategy,
      tone: projectDesign.designDirection.tone,
      mobilePriority: projectDesign.designDirection.responsivePriority,
      accessibilityConsiderations:
        projectDesign.designDirection.accessibilityNeeds,
    },
    includedDefaults:
      projectDesign.productProposal.recommendedCapabilities,
    assumptions: projectDesign.foundryInsights.assumptions,
    capabilities: nonEmptyStrings(result.capabilities, []).sort(),
    dataConcepts: nonEmptyStrings(result.dataConcepts, []),
    customerContent,
    constraints: projectDesign.projectIntent.constraints,
    architectureDecisions: nonEmptyStrings(
      result.architectureDecisions,
      [],
    ),
    observations: projectDesign.foundryInsights.observations,
    designAlternatives: projectDesign.designAlternatives.map(
      (alternative) => ({
        approach: alternative.name,
        rationale: alternative.description,
        whyItFits: alternative.whyItFits,
        layoutApproach: alternative.layoutApproach,
        visualPersonality: alternative.visualPersonality,
        informationDensity: alternative.informationDensity,
        navigationApproach: alternative.navigationApproach,
        mobileBehavior: alternative.mobileBehavior,
        tradeoff: alternative.tradeoff,
        confidence: alternative.confidence,
        preview: alternative.preview,
        visualSystem: alternative.visualSystem,
        creativeDNA: alternative.creativeDNA,
        recommended: alternative.recommended,
      }),
    ),
    openQuestions: projectDesign.decisions
      .filter((decision) => !decision.canFoundryDecide)
      .map((decision, index) => ({
        decision,
        questionId: identifier("question", index),
      }))
      .filter(({ questionId }) => !resolvedCustomerQuestionIds.has(questionId))
      .map(({ decision, questionId }) => ({
          questionId,
          prompt: decision.customerFriendlyQuestion,
          reason: decision.whyItMatters,
          answerOptions: decision.alternatives,
          recommendation: decision.recommendation,
          recommendationReason: decision.recommendationReason,
          consequences: decision.consequenceOfEachChoice,
          architectureImpact: decision.architectureImpact,
          scopeImpact: decision.scopeImpact,
        })),
    contextualSuggestions: projectDesign.recommendations.map(
      (suggestion, index) => ({
        suggestionId: identifier("suggestion", index),
        label: suggestion.title,
        value: suggestion.specificValue,
        rationale: suggestion.whyThisProjectNeedsIt,
        impact: suggestion.impact,
        selectedByDefault: suggestion.selectedByDefault,
        confidence: suggestion.confidence.score,
        requiredDependencies: suggestion.requiredDependencies,
      }),
    ),
    sourceRequirementIds: [...new Set(
      projectDesign.verificationPlan.map(
        (item) => item.sourceRequirement,
      ),
    )],
    selectedStack: {
      stackId: CERTIFIED_STACK_ID,
      version: CERTIFIED_STACK_VERSION,
    },
    runtimeAdapterId: "nextjs-web-runtime",
    requirementContractVersion: 1,
    verificationPlan: {
      planId: `verification-plan-v${profileVersion}`,
      checks,
    },
  });
}

function latestProfile(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index]?.fact?.metadata?.projectProfile;
    if (candidate !== undefined) return normalizeProjectProfile(candidate);
  }
  return null;
}

function latestProjectDesign(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index]?.fact?.metadata?.projectDesign;
    if (candidate !== undefined) return normalizeProjectDesign(candidate);
  }
  return null;
}

function latestProductTypeDiscovery(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index]?.fact?.metadata?.productTypeDiscovery;
    if (candidate !== undefined) return structuredClone(candidate);
  }
  return null;
}

function latestProductBlueprint(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index]?.fact?.metadata?.productBlueprint;
    if (candidate !== undefined) return normalizeProductBlueprint(candidate);
  }
  return null;
}

function latestUnderstandingContext(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const metadata = records[index]?.fact?.metadata;
    if (metadata?.projectDesign !== undefined) {
      return {
        originalCustomerRequest: metadata.originalCustomerRequest,
        clarificationAnswers: structuredClone(
          metadata.clarificationAnswers ?? [],
        ),
      };
    }
  }
  return null;
}

function latestBlueprintApproval(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const approval = records[index]?.fact?.metadata?.productBlueprintApproval;
    if (approval !== undefined) return structuredClone(approval);
  }
  return null;
}

function normalizeSubmittedDesignContract(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.sourceProfileVersion) ||
    value.sourceProfileVersion < 1 ||
    !["recommended", "alternative", "custom"].includes(value.selectionMode) ||
    typeof value.selectedDirectionName !== "string" ||
    value.selectedDirectionName.trim() === "" ||
    typeof value.rationale !== "string" ||
    value.rationale.trim() === "" ||
    value.composition === null ||
    typeof value.composition !== "object" ||
    value.visualCharacter === null ||
    typeof value.visualCharacter !== "object" ||
    !Array.isArray(value.surfaceSequence) ||
    value.surfaceSequence.length === 0 ||
    !Array.isArray(value.accessibilityRequirements)
  ) {
    throw new TypeError(`${label} is invalid.`);
  }
  if (
    value.selectionMode === "custom" &&
    (value.customComposition === null ||
      typeof value.customComposition !== "object" ||
      value.customComposition.complete !== true ||
      value.creativeDNA === null ||
      value.visualSystem === null)
  ) {
    throw new TypeError(`${label} does not contain a complete custom composition.`);
  }
  return Object.freeze(structuredClone(value));
}

export function normalizeCustomerFollowUpAnswers(value) {
  if (!Array.isArray(value)) {
    throw new TypeError("Customer follow-up answers must be an array.");
  }
  return Object.freeze(
    value.map((entry, index) => {
      if (
        entry === null ||
        typeof entry !== "object" ||
        Array.isArray(entry) ||
        !["answer,questionId", "answer,questionId,selection"].includes(
          Object.keys(entry).sort().join(","),
        ) ||
        typeof entry.questionId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(entry.questionId) ||
        typeof entry.answer !== "string" ||
        entry.answer.trim() === "" ||
        entry.answer.trim().length > 5_000
      ) {
        throw new TypeError(
          `Customer follow-up answer ${index + 1} is invalid.`,
        );
      }
      let selection;
      if (entry.selection !== undefined) {
        const candidate = entry.selection;
        const selectionKeys = [
          "classification",
          "kind",
          "mode",
          "optionId",
          "reason",
          "sourceProfileVersion",
          "subjectId",
          "value",
        ];
        const actualSelectionKeys = Object.keys(candidate).sort();
        const allowedSelectionKeys = [
          [...selectionKeys].sort(),
          [...selectionKeys, "designContract"].sort(),
        ];
        const kinds = new Set([
          "product-subtype",
          "blueprint-approval",
          "design-direction",
          "recommendation",
          "decision",
          "customer-message",
          "proposal-confirmation",
        ]);
        const modes = new Set([
          "accept-recommendation",
          "delegate",
          "select-option",
          "other",
          "include",
          "exclude",
          "message",
          "confirm",
        ]);
        if (
          candidate === null ||
          typeof candidate !== "object" ||
          Array.isArray(candidate) ||
          !allowedSelectionKeys.some(
            (keys) => keys.join(",") === actualSelectionKeys.join(","),
          ) ||
          (candidate.designContract !== undefined &&
            candidate.kind !== "design-direction") ||
          !kinds.has(candidate.kind) ||
          !modes.has(candidate.mode) ||
          typeof candidate.subjectId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(candidate.subjectId) ||
          (candidate.optionId !== null &&
            (typeof candidate.optionId !== "string" ||
              !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u.test(candidate.optionId))) ||
          typeof candidate.value !== "string" ||
          candidate.value.trim() === "" ||
          candidate.value.trim().length > 5_000 ||
          typeof candidate.reason !== "string" ||
          candidate.reason.trim() === "" ||
          candidate.reason.trim().length > 1_000 ||
          (candidate.classification !== null &&
            (typeof candidate.classification !== "string" ||
              candidate.classification.trim() === "" ||
              candidate.classification.trim().length > 120)) ||
          !Number.isSafeInteger(candidate.sourceProfileVersion) ||
          candidate.sourceProfileVersion < 1
        ) {
          throw new TypeError(
            `Customer follow-up answer ${index + 1} has an invalid structured selection.`,
          );
        }
        selection = Object.freeze({
          kind: candidate.kind,
          subjectId: candidate.subjectId,
          mode: candidate.mode,
          optionId: candidate.optionId,
          value: candidate.value.trim(),
          reason: candidate.reason.trim(),
          classification:
            candidate.classification === null
              ? null
              : candidate.classification.trim(),
          sourceProfileVersion: candidate.sourceProfileVersion,
          ...(candidate.designContract === undefined
            ? {}
            : {
                designContract: normalizeSubmittedDesignContract(
                  candidate.designContract,
                  `Customer follow-up answer ${index + 1} design contract`,
                ),
              }),
        });
      }
      return Object.freeze({
        questionId: entry.questionId,
        answer: entry.answer.trim(),
        ...(selection === undefined ? {} : { selection }),
      });
    }),
  );
}

export function cumulativeCustomerFollowUpAnswers(
  ledger,
  missionId,
  newAnswers = [],
) {
  const accumulated = [];
  const seen = new Set();
  const batches = [
    ...ledger
      .listEvents(missionId)
      .flatMap((record) => [
        record.fact?.metadata?.customerFollowUpAnswers,
        record.fact?.metadata?.clarificationAnswers,
      ])
      .filter(Array.isArray),
    newAnswers,
  ];
  for (const batch of batches) {
    for (const answer of normalizeCustomerFollowUpAnswers(batch)) {
      // Retrying a natural-language instruction creates a fresh UI message id.
      // Deduplicate it by its actual customer meaning so one retry does not
      // become two requirements or shift every later traceability reference.
      const key = answer.selection?.kind === "customer-message"
        ? `customer-message\u0000${answer.answer.trim().toLowerCase()}\u0000${answer.selection.classification ?? ""}`
        : `${answer.questionId}\u0000${answer.answer}\u0000${JSON.stringify(answer.selection ?? null)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      accumulated.push(answer);
    }
  }
  return Object.freeze(accumulated);
}

export function validateStructuredSelectionsAgainstCurrent(
  answers,
  currentProfile,
  currentDesign,
) {
  const projectAnswers = answers.filter(
    (answer) =>
      answer.selection !== undefined &&
      ![
        "product-subtype",
        "customer-message",
        "proposal-confirmation",
        "blueprint-approval",
      ].includes(answer.selection.kind),
  );
  if (projectAnswers.length === 0) return;
  if (currentProfile === null || currentDesign === null) {
    throw new TypeError(
      "Structured choices require a current validated Project Design.",
    );
  }
  const recommendations = currentDesign.recommendations.map((item, index) => ({
    id: identifier("suggestion", index),
    item,
  }));
  const decisions = currentDesign.decisions
    .filter((item) => !item.canFoundryDecide)
    .map((item, index) => ({ id: identifier("question", index), item }));
  const directions = currentDesign.designAlternatives.map((item, index) => ({
    id: `alternative-${index + 1}`,
    item,
  }));

  for (const answer of projectAnswers) {
    const selection = answer.selection;
    if (
      selection === undefined ||
      selection.kind === "customer-message" ||
      selection.kind === "proposal-confirmation" ||
      selection.kind === "blueprint-approval"
    ) {
      continue;
    }
    if (selection.sourceProfileVersion > currentProfile.profileVersion) {
      throw new TypeError("A structured choice references a future profile version.");
    }
    if (selection.kind === "design-direction") {
      if (selection.subjectId !== "design-direction") {
        throw new TypeError("The design choice has an invalid subject.");
      }
      if (selection.mode === "other") continue;
      const liveApproval = selection.designContract?.approvedPrototypeContract;
      if (liveApproval !== undefined && liveApproval !== null) {
        const approved = normalizeApprovedDesignContract(liveApproval);
        if (
          approved.missionId !== currentProfile.missionId ||
          approved.selectedConceptId !== selection.optionId ||
          approved.prototypeFileManifest.length < 1 ||
          approved.screenshotEvidenceReferences.length < 3 ||
          approved.browserEvidenceReferences.length < 1
        ) {
          throw new TypeError(
            "The live design choice does not match its immutable approval evidence.",
          );
        }
        continue;
      }
      const selected = directions.find(
        (direction) => direction.id === selection.optionId,
      );
      if (
        selected === undefined ||
        selected.item.name !== selection.value ||
        (selection.mode === "accept-recommendation" &&
          !selected.item.recommended)
      ) {
        throw new TypeError(
          "The design choice is not one of the generated directions for this profile.",
        );
      }
      continue;
    }
    if (selection.kind === "recommendation") {
      const selected = recommendations.find(
        (recommendation) => recommendation.id === selection.subjectId,
      );
      if (
        selected === undefined ||
        selected.item.title !== selection.value ||
        !["include", "exclude"].includes(selection.mode)
      ) {
        throw new TypeError(
          "The recommendation choice is not one of the generated recommendations for this profile.",
        );
      }
      continue;
    }
    if (selection.kind === "decision") {
      const selected = decisions.find(
        (decision) => decision.id === selection.subjectId,
      );
      if (selected === undefined) {
        throw new TypeError(
          "The decision choice is not one of the generated decisions for this profile.",
        );
      }
      if (
        ["select-option", "accept-recommendation"].includes(selection.mode) &&
        (!selected.item.alternatives.includes(selection.value) ||
          (selection.mode === "accept-recommendation" &&
            selected.item.recommendation !== selection.value))
      ) {
        throw new TypeError(
          "The selected decision option does not belong to the generated decision.",
        );
      }
    }
  }
}

function validateProductSubtypeSelections(answers, discovery) {
  const selections = answers
    .map((answer) => answer.selection)
    .filter((selection) => selection?.kind === "product-subtype");
  if (selections.length === 0) return;
  if (discovery === null) {
    throw new TypeError("Product subtype choices require a current product-type discovery.");
  }
  const generated = new Map(
    discovery.subtypes.map((subtype) => [subtype.optionId, subtype]),
  );
  const selectedGenerated = [];
  for (const selection of selections) {
    if (selection.subjectId !== "product-type") {
      throw new TypeError("The product subtype choice has an invalid subject.");
    }
    if (selection.mode === "other") continue;
    if (![
      "accept-recommendation",
      "delegate",
      "select-option",
    ].includes(selection.mode)) {
      throw new TypeError("The product subtype choice has an invalid selection mode.");
    }
    const subtype = generated.get(selection.optionId);
    if (
      subtype === undefined ||
      subtype.title !== selection.value ||
      (["accept-recommendation", "delegate"].includes(selection.mode) &&
        !subtype.recommended)
    ) {
      throw new TypeError("The product subtype choice is not one of Foundry's generated interpretations.");
    }
    selectedGenerated.push(subtype);
  }
  if (
    selectedGenerated.length > 1 &&
    (
      selectedGenerated.some((subtype) => subtype.canCombine !== true) ||
      !selectedGenerated
        .map((subtype) => new Set(subtype.compatibilityTags ?? []))
        .reduce(
          (shared, tags) => new Set([...shared].filter((tag) => tags.has(tag))),
        ).size
    )
  ) {
    throw new TypeError("One or more selected product subtypes cannot be safely combined.");
  }
}

function resolvedDecisionSelections(projectDesign, answers, profileVersion) {
  const explicit = answers
    .map((answer) => answer.selection)
    .filter(Boolean);
  const latest = new Map();
  for (const selection of explicit) {
    const identity = selection.kind === "product-subtype"
      ? `${selection.kind}:${selection.subjectId}:${selection.optionId ?? selection.value}`
      : `${selection.kind}:${selection.subjectId}`;
    latest.set(identity, selection);
  }
  const result = [...latest.values()].map((selection) => ({ ...selection }));

  if (!result.some((item) => item.kind === "design-direction")) {
    const recommended = projectDesign.designAlternatives.find(
      (item) => item.recommended,
    );
    result.push({
      kind: "design-direction",
      subjectId: "design-direction",
      mode: "accept-recommendation",
      optionId:
        recommended === undefined
          ? null
          : `alternative-${projectDesign.designAlternatives.indexOf(recommended) + 1}`,
      value: projectDesign.designDirection.visualPersonality,
      reason: projectDesign.designDirection.rationale,
      classification: "design preference",
      sourceProfileVersion: profileVersion,
    });
  }

  for (const [index, recommendation] of projectDesign.recommendations.entries()) {
    const subjectId = identifier("suggestion", index);
    const existing = result.find(
      (item) =>
        item.kind === "recommendation" &&
        (item.subjectId === subjectId || item.value === recommendation.title),
    );
    if (existing === undefined) {
      result.push({
        kind: "recommendation",
        subjectId,
        mode: recommendation.selectedByDefault ? "include" : "exclude",
        optionId: subjectId,
        value: recommendation.title,
        reason: recommendation.whyThisProjectNeedsIt,
        classification: "feature recommendation",
        sourceProfileVersion: profileVersion,
      });
    } else if (existing.value !== recommendation.title) {
      existing.value = recommendation.title;
      existing.reason = recommendation.whyThisProjectNeedsIt;
      existing.optionId = subjectId;
      existing.sourceProfileVersion = profileVersion;
    }
  }

  let customerQuestionIndex = 0;
  for (const [index, decision] of projectDesign.decisions.entries()) {
    if (!decision.canFoundryDecide) customerQuestionIndex += 1;
    const subjectId = decision.canFoundryDecide
      ? `foundry-decision-${index + 1}`
      : identifier("question", customerQuestionIndex - 1);
    const existing = result.find(
      (item) =>
        item.kind === "decision" &&
        (item.subjectId === subjectId ||
          decision.alternatives.includes(item.value)),
    );
    if (existing === undefined) {
      result.push({
        kind: "decision",
        subjectId,
        mode: "delegate",
        optionId: null,
        value: decision.recommendation,
        reason: decision.recommendationReason,
        classification: "project decision",
        sourceProfileVersion: profileVersion,
      });
    }
  }
  return Object.freeze(result.map((item) => Object.freeze({ ...item })));
}

function latestBindings(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate =
      records[index]?.fact?.metadata?.verificationBindings;
    if (candidate !== undefined) return structuredClone(candidate);
  }
  return null;
}

export function approvedArchitectureConstraints(projectDesign, profile) {
  return Object.freeze([
    ...new Set([
      ...projectDesign.projectIntent.constraints,
      ...profile.architectureDecisions,
    ]),
  ]);
}

// Design vocabulary distinctive enough to match against customer-facing prose.
// The common-English enum values ("none", "open", "direct", "flat", "action",
// "status", "data", "balanced", "solid", "quiet") are deliberately excluded:
// matching those would delete good ideas over an incidental word.
const DISTINCTIVE_VISUAL_TERMS = new Set([
  "sidebar", "top-nav", "split-screen", "editorial", "dashboard",
  "guided-flow", "canvas", "documentation",
  "top-bar", "tabs", "stepper",
  "humanist", "geometric", "technical", "expressive",
  "spacious", "dense", "rhythmic",
  "bordered", "elevated", "layered", "immersive",
  "ambient", "hero", "gallery",
  "exploratory", "command-driven", "review-and-confirm",
  "pill",
]);

function visualTermPattern(term) {
  return new RegExp(`\\b${term.replaceAll("-", "[ -]")}\\b`, "iu");
}

// A recommendation contradicts the chosen direction when it names a rejected
// alternative's distinctive vocabulary on an axis the customer actually chose
// between, without naming the value they picked.
function contradictsSelectedDirection(recommendation, selected, rejected) {
  const system = selected?.visualSystem;
  if (system === null || typeof system !== "object") return false;
  const text = [
    recommendation.title,
    recommendation.specificValue,
    recommendation.whyThisProjectNeedsIt,
    recommendation.impact,
  ]
    .filter((value) => typeof value === "string")
    .join(" ");
  for (const [axis, selectedValue] of Object.entries(system)) {
    if (typeof selectedValue !== "string") continue;
    const rejectedValues = new Set(
      rejected
        .map((entry) => entry.visualSystem?.[axis])
        .filter(
          (value) => typeof value === "string" && value !== selectedValue,
        ),
    );
    for (const value of rejectedValues) {
      if (!DISTINCTIVE_VISUAL_TERMS.has(value)) continue;
      if (!visualTermPattern(value).test(text)) continue;
      // Naming the chosen value too means it is comparing, not contradicting.
      if (visualTermPattern(selectedValue).test(text)) continue;
      return true;
    }
  }
  return false;
}

export function filterContradictingRecommendations(recommendations, selected, rejected) {
  if (!Array.isArray(recommendations)) return recommendations;
  const contradicting = recommendations.map((recommendation) =>
    contradictsSelectedDirection(recommendation, selected, rejected),
  );
  // normalizeProjectDesign rejects a design with fewer than three
  // recommendations, so keep the earliest conflicting ones rather than
  // breaking the customer's selection outright.
  let restore = Math.max(
    0,
    3 - contradicting.filter((flagged) => !flagged).length,
  );
  return recommendations.filter((_, index) => {
    if (!contradicting[index]) return true;
    if (restore > 0) {
      restore -= 1;
      return true;
    }
    return false;
  });
}

function applyStructuredSelectionChoices(currentUnderstanding, answers) {
  const revised = structuredClone(currentUnderstanding);
  const designSelection = [...answers]
    .reverse()
    .find((answer) => answer.selection?.kind === "design-direction")
    ?.selection;
  if (designSelection === undefined) return revised;
  const selectedIndex = /^alternative-(?<index>\d+)$/u.exec(
    String(designSelection.optionId ?? ""),
  )?.groups?.index;
  const selected = selectedIndex === undefined
    ? revised.designAlternatives.find(
        (alternative) =>
          alternative.name === designSelection.value ||
          alternative.visualPersonality === designSelection.value,
      )
    : revised.designAlternatives[Number(selectedIndex) - 1];
  if (selected === undefined) return revised;
  revised.designDirection = {
    ...revised.designDirection,
    visualPersonality: selected.visualPersonality,
    layoutStrategy: selected.layoutApproach,
    informationDensity: selected.informationDensity,
    navigationApproach: selected.navigationApproach,
    responsivePriority: selected.mobileBehavior,
    rationale: selected.whyItFits,
  };
  // Useful ideas were written against the originally recommended direction.
  // Carrying them over unchanged is what made them contradict the design the
  // customer actually chose.
  revised.recommendations = filterContradictingRecommendations(
    revised.recommendations,
    selected,
    revised.designAlternatives.filter((alternative) => alternative !== selected),
  );
  revised.designAlternatives = revised.designAlternatives.map((alternative) => ({
    ...alternative,
    recommended: alternative.name === selected.name,
  }));
  return revised;
}

function legacyProjectionPrompt(intent, answers, currentProfile) {
  return [
    "Interpret this project request for Foundry. This is reasoning, not keyword classification.",
    "Behave like a senior experience designer and developer speaking directly to a customer, not like an intake form or generated project brief. Do most of the thinking from even a one-sentence request. Infer the complete, project-specific experience; never reuse a fixed project-family feature list.",
    "Keep summary to two or three short natural sentences. Use primaryJourneys for short workflow summaries and proposedFeatures for concise cards describing the main screens, workflows, or endpoints. Every proposed feature must be observable and covered by the obligation plan.",
    "Create a real designDirection for this exact purpose and audience: recommend a plain-language style, explain why, name the layout approach and tone, describe mobile priority, and list concrete accessibility considerations. Use designAlternatives only when another visual direction is genuinely credible.",
    "Put professional experience and quality choices that do not need customer input in includedDefaults. Put optional, project-specific ideas in recommendations and explain each value in one short sentence. Never return a generic checklist.",
    "Ask as few questions as possible. Put only choices that materially change the project in importantDecisions. Never ask about wording, colours, layout, page names, or anything a senior designer can decide well. If the request is sufficiently understood, return no importantDecisions.",
    "Write every decision, reason, recommendation, feature and design field for a non-technical customer. Ask about outcomes and never about implementation. Do not use the words persistence, authentication, delegated, runtime, topology, schema, middleware, stateless, or architecture in customer-visible fields. Give each decision two to four concrete plain-language options, with the professionally recommended option first.",
    "In every reason, explain your thinking in one sentence a business owner would find useful — what the decision affects and why it matters to them. Never justify a question by saying it is required.",
    "Use confidence-aware language without contradiction. When confidence is high, state the direction directly. When one choice could change the project, say that the direction is recommended and name the one choice plainly. Never say both that the direction is certainly right and that a major decision remains.",
    "Do not use clever metaphors, ambiguous doorway or room analogies, safety euphemisms, or language that calls one unresolved choice the only major open issue. Be direct, warm, concise and natural.",
    "In architectureDecisions, record the judgement calls you made and the trade-off behind each one — what you chose, what you gave up, and why that is the right balance for this business. These are decisions you already made, not options for the customer.",
    "In constraints, record what you deliberately chose to leave out and why, phrased as intentional scope decisions a business owner would understand — for example that something is out of scope for a first version, or would need a service this machine does not have. Do not list vague caveats.",
    "In assumptions, record only the concrete project assumptions Foundry will use if the customer continues without answering. Keep them short enough to review in the final Decision Brief.",
    "Return two to four observations: things you noticed while reading this exact request that its owner would find genuinely insightful. Observations are not questions, assumptions, generic best practices, or implementation notes. Each must connect a specific user, workflow, risk, or goal in the request to why it matters.",
    "Return three to seven genuinely different designAlternatives with exactly one marked recommended. Each direction must explain why it fits this exact project and provide its own layout, visual or interaction personality, density, navigation, mobile behavior, important tradeoff, confidence, and structured visualSystem. Give every direction a different creativeDNA.compositionPrimitive: composition is the structure a customer actually sees, and two directions sharing one are the same page restyled. The vocabulary is wider than dashboards — a map-led, narrative-scroll, editorial-spread, modular-gallery, command-surface, conversation-surface or identity-work-canvas composition can serve an operational product, and choosing three obvious task layouts wastes the choice. Make layoutType, navigationType, typographyCategory, density, colorRoles, spacingProfile, surfaceTreatment, contentEmphasis, imageStrategy, interactionModel, and buttonTreatment materially different too—not title or accent-color variants. sampleLabels must use this project's language. For APIs and other nonvisual work, use documentation, endpoint-explorer, authentication, response-example, monitoring, or developer-workspace structures instead of website themes.",
    "Every decision.customerFriendlyQuestion must ask about a customer-visible outcome or operating choice. Never ask the customer to choose HTTP methods, database engines, schemas, frameworks, authentication protocols, infrastructure, or other implementation mechanisms.",
    "Return at least three recommendations that are specific to this exact project and would make the customer think they would not have thought of that. Ground each rationale in a concrete benefit rather than generic best practice, and prefer a non-obvious idea over a familiar one.",
    `For capabilities, select only applicable identifiers from the certified web stack catalogue: ${WEB_STACK_MANIFEST.supportedCapabilities.join(", ")}.`,
    `All architecture decisions must remain within the selected stack manifest: ${JSON.stringify({
      stackId: WEB_STACK_MANIFEST.stackId,
      stackVersion: WEB_STACK_MANIFEST.stackVersion,
      components: WEB_STACK_MANIFEST.components,
      knownLimitations: WEB_STACK_MANIFEST.knownLimitations,
    })}. Do not propose Vite, Express, another framework, another database, or a different runtime.`,
    "Create individually observable obligations for every requested outcome and the necessary derived quality gates. Include real build success, runtime readiness, HTTP readiness, primary behavior, persistence when requested, and no blocking browser errors when applicable.",
    "For every obligation, outcomeIndexes must identify every proposedFeatures item it verifies using one-based indexes. Every proposed feature must be covered by at least one obligation. A dedicated page, screen, workflow, or endpoint named in a proposed feature must remain explicit in its observable obligation; do not silently merge it away.",
    "Use the distinct dependency-lock, dependency-install, type-check, lint, and production-build verification modes for their corresponding engineering obligations.",
    "Do not invent acceptance claims that cannot be observed using the listed verification modes.",
    "customerSuppliedContent is a provenance record, not a creative-writing field. Include only concrete business facts or asset references copied verbatim from the customer request or clarification answers. Never infer or invent a business name, phone number, email address, location, opening date, credentials, awards, client identity, testimonial, pricing, business hours, or brand asset.",
    "List any business facts or assets still needed for a truthful public launch in missingCustomerContent. Missing launch content is not an architecture-changing question and must not block the proposal. Do not create an obligation claiming that customer content is supplied when it is missing.",
    `Classify platform using exactly one architecture identifier: ${PROJECT_PLATFORMS.join(", ")}. Foundry currently supports only web projects. Preserve the requested platform honestly so unsupported requests can be rejected rather than silently converted.`,
    `Customer request:\n${intent}`,
    currentProfile === null
      ? "There is no prior ProjectProfile."
      : `Current validated ProjectProfile to revise without losing resolved decisions:\n${JSON.stringify(currentProfile)}`,
    answers.length === 0
      ? "No clarification answers have been supplied."
      : `Clarification answers:\n${JSON.stringify(answers)}`,
  ].join("\n\n");
}

function understandingPrompt(intent, answers, currentDesign) {
  const requirementReferences = [
    "customer-intent-1",
    ...answers.map((_, index) => `customer-follow-up-${index + 1}`),
  ];
  return [
    "Create Foundry's deep Project Design for this exact request. Reason from the customer's business, users, goals, workflow sequence, frequency, urgency, privacy, data sensitivity, growth, operational responsibilities, content, brand, trust, responsive priority, integrations, administration, failures, edge cases, and deliberate first-version exclusions. Never classify by keywords or reuse a project-category template.",
    "Be concise enough for a fast customer-facing proposal: use one sentence per string, no more than five items in ordinary lists, exactly three design alternatives, exactly three recommendations, no more than two genuinely customer-blocking decisions, and no more than ten verification items. Omit decisions Foundry can safely make and record those choices in architectureDecisions instead.",
    "Return the strict schema only. Every field must contain concrete project-specific reasoning. Do not use generic audiences, journeys, summaries, feature lists, recommendations, questions, assumptions, or design directions.",
    "ProjectIntent must state the actual customer outcome, context, users, goal, measurable success, known constraints, and a confidence score from 0 through 1 with an honest rationale.",
    "UserExperiencePlan must describe sequenced journeys, critical and trust moments, realistic failures, repeated work, and administrator responsibility for this project.",
    "ProductProposal must separate essential, recommended, intentionally excluded, and future capabilities. Explain why this scope is the right first version, its dependencies, and the consequence for scope.",
    "DesignDirection must be an actual visual and interaction recommendation for these users and this use case. Explain personality, density, navigation, content, responsive behavior, accessibility, interaction style, and the tradeoff behind the choice.",
    "Always return three to seven genuinely different designAlternatives and mark exactly one recommended. Give every alternative a short customer-facing name. Make the recommended alternative's visualPersonality match designDirection.visualPersonality character-for-character. Every direction must use a different compositionPrimitive from the others, and provide a distinct structured visualSystem across layout, navigation, typography, density, color roles, spacing, surfaces, content emphasis, imagery, interactions, buttons, and project-specific sample labels. For APIs and other nonvisual work, generate documentation and developer-tool directions, never website themes. Reject cosmetic renames of the same direction.",
    "FoundryInsights must contain non-obvious observations, opportunities, risks, ambiguities, and explicit assumptions grounded in this request. Every observation must contain at least one concrete noun or workflow phrase used in the original request so its grounding remains visible to the customer.",
    "Recommendations must be few, useful, and specific. Each specificValue must be at least six words and each whyThisProjectNeedsIt must be at least eight words. Both must explicitly name a user, workflow, risk, or goal from the original request. Each recommendation must also state scope/cost/security/integration impact, default selection, confidence, and dependencies. Mark at least one recommendation selected by default and at least one genuinely optional so the customer receives useful stage-aware suggestion chips instead of an all-or-nothing list. A recommendation that could apply unchanged to an unrelated project is invalid.",
    "Decisions are only choices that can materially change outcome, architecture, cost, integrations, or scope. Write questions in customer language, copy the recommended option character-for-character into the alternatives array, give exactly one consequence per alternative, and mark whether Foundry can safely decide. Every non-recommended alternative must represent a materially different outcome, not a verb-only rephrasing such as Use versus Show. Never ask about APIs, databases, schemas, runtimes, middleware, persistence, or architecture.",
    `Use only these stable sourceRequirement values for customer requirements: ${requirementReferences.join(", ")}. Foundry-derived quality obligations may use foundry-derived followed by a descriptive identifier. Every essential capability must have an observable verification item traceable to one of those sources.`,
    "When a journey has a person perform an action — signing up, signing in, submitting, creating, booking, paying, deleting — at least one essential capability must state what the action produces: the record it creates, the state the person reaches, or what remains true after a refresh. A capability that only says a form is shown, is validated, or stays usable describes a picture of the product, not the product. A request to sign up asks for an account to exist afterwards.",
    "VerificationPlan must describe observable outcomes, a supported acceptance method, exact evidence required, its stable source requirement, origin, and one-based dependency indexes. Dependency indexes must reference existing other items, must never reference the current item, and the dependency graph must be acyclic. For traceability, create at least one verification item for every essential capability and begin that item's observableOutcome by copying the complete essential capability text character-for-character. Do not promise anything the acceptance method cannot prove.",
    "For a visual web project, add a foundry-derived browser-check verification item that makes the selected design direction observable. Its outcome must explicitly cover the approved information density, responsive priority, navigation behavior, and accessibility needs. Phone or responsive claims must fail for horizontal overflow, excessively tall ungrouped workflow states, or an unbounded concentration of interactive choices; technical completion alone is not design-quality proof.",
    `For capabilities, select only applicable identifiers discovered from the certified stack catalogue: ${WEB_STACK_MANIFEST.supportedCapabilities.join(", ")}.`,
    `Stay within this real certified stack capability boundary: ${JSON.stringify({ stackId: WEB_STACK_MANIFEST.stackId, stackVersion: WEB_STACK_MANIFEST.stackVersion, components: WEB_STACK_MANIFEST.components, knownLimitations: WEB_STACK_MANIFEST.knownLimitations })}.`,
    "customerSuppliedContent is provenance only: copy concrete business facts or asset references verbatim from the request or answers. Never invent identity, contact details, locations, credentials, awards, testimonials, pricing, hours, or brand assets. missingCustomerContent is only for content the customer explicitly promised to provide later; return [] when Foundry can choose a professional default.",
    `Preserve the requested platform using exactly one of: ${PROJECT_PLATFORMS.join(", ")}. Foundry currently executes only web projects; do not silently convert unsupported work.`,
    `Original customer request [customer-intent-1]:\n${intent}`,
    answers.length === 0
      ? "There are no customer follow-up messages."
      : `Customer follow-up messages:\n${JSON.stringify(answers.map((answer, index) => ({ requirementReference: `customer-follow-up-${index + 1}`, ...answer })))}`,
    currentDesign === null
      ? "There is no prior approved design."
      : `Revise this prior validated design without losing resolved customer input:\n${JSON.stringify(currentDesign)}`,
  ].join("\n\n");
}

function fastUnderstandingPrompt(intent, answers) {
  return [
    "Create a concise, genuinely project-specific customer proposal as strict JSON. Infer users, workflows, scope, design, risks, and useful recommendations from this exact request; never use a category template or generic checklist.",
    "Return exactly three meaningfully different design alternatives and exactly three non-obvious recommendations. Mark exactly one design alternative recommended. Mark at least one recommendation selected by default and at least one genuinely optional. Keep each string to one short sentence.",
    "Return no more than two decisions, and only when a customer-visible choice materially changes scope. Decision alternatives must be mutually distinct outcomes; never return verb-only rewrites of the same practical choice. Do not ask about APIs, databases, schemas, runtimes, middleware, persistence, or architecture. Omit choices Foundry can safely make.",
    "For each essential capability, select the concrete acceptance method that can prove it. Preserve every requested behavior and deliberate exclusion. Do not invent business identity, contact details, credentials, pricing, hours, testimonials, or assets.",
    // The same requirement understandingPrompt states. Without it here the fast
    // path kept returning capabilities that only described a form being shown
    // and validated, which the design-quality gate then rejected twice and the
    // mission died in INTAKE having produced nothing.
    "When a journey has a person perform an action — signing up, signing in, submitting, creating, booking, paying, deleting — at least one essential capability must state what the action produces: the record it creates, the state the person reaches, or what remains true after a refresh. A capability that only says a form is shown, is validated, or stays usable describes a picture of the product, not the product. A request to sign up asks for an account to exist afterwards.",
    "missingCustomerContent is only for content the customer explicitly promised to provide later. Return [] for unspecified details Foundry can safely choose with professional defaults.",
    "When customer follow-up messages contain structured product-subtype selections, treat those generated subtype titles and any customer context as authoritative. If several compatible subtypes were selected, compose their distinct users, workflows, and outcomes into one coherent product rather than dropping any selection.",
    `Select capabilities only from the live certified stack boundary: ${WEB_STACK_MANIFEST.supportedCapabilities.join(", ")}.`,
    `Preserve platform using one of: ${PROJECT_PLATFORMS.join(", ")}. Foundry currently builds only web projects and must not silently convert another platform.`,
    `Customer request:\n${intent}`,
    answers.length === 0
      ? "No customer follow-up messages have been supplied."
      : `Customer follow-up messages:\n${JSON.stringify(answers)}`,
  ].join("\n\n");
}

function understandingRevisionPrompt(
  intent,
  answers,
  currentUnderstanding,
  allowedRevisionFields,
) {
  const requirementReferences = answers.map(
    (_, index) => `customer-follow-up-${index + 1}`,
  );
  const relevantUnderstanding = Object.fromEntries(
    [...allowedRevisionFields].map((field) => [
      field,
      currentUnderstanding[field],
    ]),
  );
  return [
    "Revise the current validated project understanding to honor every customer follow-up. Preserve all resolved decisions and all unrelated behavior.",
    "Return only a minimal JSON Patch-style operations array. Do not repeat the complete project understanding and do not return top-level Project Design fields directly.",
    "Return at most 6 operations. Patch only affected leaf values and never repeat an existing array or top-level section inside valueJson. Append one new array item at a time with a path ending in /-. Replace or remove an existing array item with its zero-based index. Each valueJson must be valid JSON for the single leaf value at that path and no longer than 800 characters. Prefer one concise operation that satisfies several related follow-ups.",
    `Every operation path must begin with one of these allowed top-level fields: ${[...allowedRevisionFields].join(", ")}.`,
    "Keep users, workflows, scope, decisions, and verification internally consistent. Every new customer behavior needs an observable verification item using the matching customer-follow-up source requirement. If an essential capability changes, start a corresponding observableOutcome with that exact essential-capability text so coverage is directly traceable. Keep dependencyIndexes one-based and use an empty array when there is no dependency.",
    `Stable source requirement references for these follow-ups: ${requirementReferences.join(", ")}.`,
    `Original customer request:\n${intent}`,
    `Customer follow-up messages:\n${JSON.stringify(answers.map((answer, index) => ({ requirementReference: requirementReferences[index], ...answer })))}`,
    `Current relevant validated fields:\n${JSON.stringify(relevantUnderstanding)}`,
  ].join("\n\n");
}

function projectProductTypeDiscoveryCandidate(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    return candidate;
  }
  const interpretation = candidate.interpretation;
  return {
    interpretation:
      interpretation === null ||
      typeof interpretation !== "object" ||
      Array.isArray(interpretation)
        ? interpretation
        : {
            summary: interpretation.summary,
            reasoning: interpretation.reasoning,
            confidence: interpretation.confidence,
          },
    subtypes: Array.isArray(candidate.subtypes)
      ? candidate.subtypes.map((subtype) =>
          subtype === null || typeof subtype !== "object" || Array.isArray(subtype)
            ? subtype
            : {
                title: subtype.title,
                explanation: subtype.explanation,
                likelyUsers: subtype.likelyUsers,
                likelyPrimaryOutcome: subtype.likelyPrimaryOutcome,
                whyItMayFit: subtype.whyItMayFit,
                confidence: subtype.confidence,
                recommended: subtype.recommended,
                canCombine: subtype.canCombine,
                combinationNote: subtype.combinationNote,
                compatibilityTags: subtype.compatibilityTags,
                deliveryPlatform: subtype.deliveryPlatform,
                requiredCapabilities: subtype.requiredCapabilities,
              },
        )
      : candidate.subtypes,
  };
}

async function generateProductTypeDiscovery({
  ledger,
  orchestrator,
  evidence,
  facts,
  modelFacts,
  providerRegistry,
  clock,
  missionId,
  intent,
  cumulativeAnswers,
  requestId,
  eventId,
  causationId,
  selection,
  candidateRoutes,
  productTypeDiscoveryHistory,
}) {
  const context = cumulativeAnswers.map((answer) => answer.answer);
  const baseRequest = {
    taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
    messages: [
      {
        role: "system",
        content:
          "You are Foundry's Product Intelligence authority. Resolve ambiguity before proposing a product. Return only validated, customer-friendly JSON; generate every interpretation from the supplied request rather than a category template.",
      },
      {
        role: "user",
        content: productTypeDiscoveryPrompt({ intent, context }),
      },
    ],
    schemaName: "foundry_product_type_discovery_v1",
    schema: PRODUCT_TYPE_DISCOVERY_SCHEMA,
  };
  let response = null;
  let discovery = null;
  let selectedRoute = null;
  let failure = null;
  for (let routeIndex = 0; routeIndex < candidateRoutes.length; routeIndex += 1) {
    const route = candidateRoutes[routeIndex];
    const routeAttempt = routeIndex + 1;
    const startedAt = clock();
    const routingReason = [
      ...selection.rationale,
      routeAttempt === 1
        ? "primary eligible route for product-type discovery"
        : `product-type discovery failover route ${routeAttempt}`,
    ].join("; ");
    const routeEvidence = evidence.capture({
      evidenceId: `${requestId}.product-types.route-${routeAttempt}`,
      missionId,
      kind: ObservationKind.MODEL_CALL_RESULT,
      captureMethod: "product-type-discovery-route-dispatch",
      producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
      timestamp: startedAt,
      payload: {
        requestId,
        status: "STARTED",
        structuredOutput: null,
        detail: "A live product-type discovery request was dispatched.",
      },
      workspaceCheckpointReference: null,
      commandReference: requestId,
      workUnitReference: requestId,
      metadata: {
        provider: route.providerId,
        modelId: route.modelId,
        providerFamily: route.providerFamily,
        taskClass: "PROJECT_UNDERSTANDING",
        depthLevel: PROJECT_UNDERSTANDING_DEPTH,
        routingReason,
        routeAttempt,
      },
    });
    modelFacts.recordResultFact({
      missionId,
      eventId: `${requestId}.product-types.route-${routeAttempt}.fact`,
      causationId,
      occurredAt: startedAt,
      producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
      statement: `Dispatched product-type discovery to eligible live route ${routeAttempt}.`,
      evidenceReferences: [
        { evidenceId: routeEvidence.evidenceId, workspaceCheckpointReference: null },
      ],
      workspaceCheckpointReference: null,
      workUnitReference: requestId,
      metadata: { modelRouteStart: routeEvidence.metadata },
    });
    try {
      let routeRequest = baseRequest;
      let candidateResponse = null;
      let candidateDiscovery = null;
      for (
        let correctionAttempt = 1;
        correctionAttempt <= MAX_PRODUCT_INTELLIGENCE_GENERATIONS;
        correctionAttempt += 1
      ) {
        try {
          candidateResponse = await providerRegistry.generate(
            route.providerId,
            routeRequest,
            { modelId: route.modelId },
          );
          const validated = validateStructuredModelOutput(
            projectProductTypeDiscoveryCandidate(candidateResponse.output),
            PRODUCT_TYPE_DISCOVERY_SCHEMA,
          );
          candidateDiscovery = normalizeProductTypeDiscovery(validated, {
            intent,
            context,
          });
          const priorDiscoveries = productTypeDiscoveryHistory()
            .filter(
              (prior) =>
                prior.originalRequest.toLowerCase() !== intent.toLowerCase(),
            )
            .slice(-20);
          if (priorDiscoveries.length > 0) {
            validateDiscoveryPortfolioDifferentiation([
              ...priorDiscoveries,
              candidateDiscovery,
            ]);
          }
          break;
        } catch (candidateError) {
          const message = String(candidateError?.message ?? candidateError);
          const providerFailure =
            /(?:timed out|could not be reached|compiled grammar|rate limit|unauthori[sz]ed|forbidden|request failed|unknown agent)/iu.test(
              message,
            );
          if (
            correctionAttempt >= MAX_PRODUCT_INTELLIGENCE_GENERATIONS ||
            providerFailure
          ) throw candidateError;
          routeRequest = {
            ...baseRequest,
            messages: [
              ...baseRequest.messages,
              {
                role: "system",
                content: `The subtype set failed Foundry's Product Intelligence Quality Gate: ${message.slice(0, 600)}. Regenerate the complete object with exactly 6 request-grounded, non-repetitive, feasible web-product interpretations. Change the reasoning strategy; do not merely rename the rejected choices.`,
              },
            ],
          };
        }
      }
      response = candidateResponse;
      discovery = candidateDiscovery;
      selectedRoute = {
        ...route,
        routeAttempt,
        routingReason,
        startTimestamp: startedAt,
      };
      failure = null;
      break;
    } catch (error) {
      failure = error;
      const failedAt = clock();
      const disposition = classifyModelRouteFailure(error);
      const failureEvidence = evidence.capture({
        evidenceId: `${requestId}.product-types.route-${routeAttempt}.failure`,
        missionId,
        kind: ObservationKind.MODEL_CALL_RESULT,
        captureMethod: "product-type-discovery-route-failure",
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        timestamp: failedAt,
        payload: {
          requestId,
          status: "FAILED",
          structuredOutput: null,
          detail: String(error?.message ?? error).slice(0, 240),
        },
        workspaceCheckpointReference: null,
        commandReference: requestId,
        workUnitReference: requestId,
        metadata: {
          provider: route.providerId,
          modelId: route.modelId,
          providerFamily: route.providerFamily,
          taskClass: "PROJECT_UNDERSTANDING",
          depthLevel: PROJECT_UNDERSTANDING_DEPTH,
          routingReason,
          routeAttempt,
          failureCategory: disposition.category,
          retryable: disposition.retryable,
        },
      });
      facts.recordResultFact({
        missionId,
        eventId: `${requestId}.product-types.route-${routeAttempt}.failure.fact`,
        causationId,
        occurredAt: failedAt,
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        statement: `Product-type discovery route ${routeAttempt} failed safely.`,
        evidenceReferences: [
          { evidenceId: failureEvidence.evidenceId, workspaceCheckpointReference: null },
        ],
        workspaceCheckpointReference: null,
        workUnitReference: requestId,
        metadata: { productTypeDiscoveryFailure: failureEvidence.metadata },
      });
    }
  }
  if (response === null || discovery === null || selectedRoute === null) {
    throw failure ?? new Error("No live product-type discovery route completed.");
  }
  const occurredAt = clock();
  const evidenceId = `${requestId}.product-types`;
  evidence.capture({
    evidenceId,
    missionId,
    kind: ObservationKind.MODEL_CALL_RESULT,
    captureMethod: "live-provider-structured-product-type-discovery",
    producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
    timestamp: occurredAt,
    payload: {
      requestId,
      status: "SUCCEEDED",
      structuredOutput: discovery,
      detail: "Live model output passed the Product Intelligence Quality Gate.",
    },
    metadata: {
      providerId: selectedRoute.providerId,
      modelId: selectedRoute.modelId,
      providerFamily: selectedRoute.providerFamily,
      routingRationale: selectedRoute.routingReason,
      depthLevel: PROJECT_UNDERSTANDING_DEPTH,
      tokenUsage: response.usage,
    },
    commandReference: requestId,
    workUnitReference: requestId,
  });
  const modelCallRecord = normalizeModelCallRecord({
    requestId,
    missionId,
    workUnitId: requestId,
    purpose: "Generate validated interpretations for a broad product request.",
    taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
    modelId: selectedRoute.modelId,
    modelTier: PROJECT_UNDERSTANDING_TIER,
    provider: selectedRoute.providerId,
    providerFamily: selectedRoute.providerFamily,
    depthLevel: PROJECT_UNDERSTANDING_DEPTH,
    routingReason: selectedRoute.routingReason,
    idempotencyKey: `${requestId}-product-types-key`,
    contextReferences: [],
    expectedStructuredOutputSchema: PRODUCT_TYPE_DISCOVERY_SCHEMA,
    structuredOutput: response.output,
    tokenMetadata: {
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
    },
    costMetadata: {
      attemptCount: selectedRoute.routeAttempt,
      costUsd: response.usage?.costUsd ?? 0,
    },
    startTimestamp: selectedRoute.startTimestamp,
    endTimestamp: occurredAt,
    status: "SUCCEEDED",
  });
  modelFacts.recordResultFact({
    missionId,
    eventId: `${requestId}.product-types.model.fact`,
    causationId,
    occurredAt,
    producingSubsystem: MODEL_GATEWAY_SOURCE,
    statement: "Product-type discovery model request completed with operational status SUCCEEDED.",
    evidenceReferences: [{ evidenceId, workspaceCheckpointReference: null }],
    workspaceCheckpointReference: null,
    workUnitReference: requestId,
    metadata: { modelCallRecord },
  });
  facts.recordResultFact({
    missionId,
    eventId: `${eventId}.product-type-discovery`,
    causationId,
    producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
    statement: "Broad project request interpreted into validated product subtype choices.",
    evidenceReferences: [{ evidenceId, workspaceCheckpointReference: null }],
    workUnitReference: requestId,
    metadata: {
      productTypeDiscovery: discovery,
      originalCustomerRequest: intent,
      clarificationAnswers: structuredClone(cumulativeAnswers),
    },
    occurredAt,
  });
  if (ledger.projectState(missionId).state === MissionState.INTAKE) {
    orchestrator.transition({
      missionId,
      eventId: `${eventId}.product-type-clarifying`,
      causationId: `${eventId}.product-type-discovery`,
      to: MissionState.CLARIFYING,
      reason: "The broad request needs a customer-visible product subtype choice.",
    });
  }
  return Object.freeze({ productTypeDiscovery: discovery, routing: selection });
}

export function createProjectUnderstandingService({
  ledger,
  orchestrator,
  profiles,
  contracts,
  approvedContracts,
  evidence,
  facts,
  modelFacts = facts,
  router,
  providerRegistry,
  routeHistory = () => [],
  productTypeDiscoveryHistory = () => [],
  requireProductBlueprintApproval = false,
  clock,
}) {
  return Object.freeze({
    latest(missionId) {
      return latestProfile(ledger, missionId);
    },

    latestDesign(missionId) {
      return latestProjectDesign(ledger, missionId);
    },

    latestProductTypeDiscovery(missionId) {
      return latestProductTypeDiscovery(ledger, missionId);
    },

    verificationBindings(missionId) {
      return latestBindings(ledger, missionId);
    },

    recordSelections({
      missionId,
      answers,
      requestId,
      eventId,
      causationId,
    }) {
      const state = ledger.projectState(missionId).state;
      if (
        state !== MissionState.INTAKE &&
        state !== MissionState.CLARIFYING
      ) {
        throw new TypeError(
          `Project selections are unavailable while mission is ${state}.`,
        );
      }
      const current = latestProfile(ledger, missionId);
      const currentDesign = latestProjectDesign(ledger, missionId);
      const context = latestUnderstandingContext(ledger, missionId);
      if (current === null || currentDesign === null || context === null) {
        throw new TypeError(
          "A validated project proposal is required before recording selections.",
        );
      }
      const normalizedAnswers = normalizeCustomerFollowUpAnswers(answers);
      if (
        normalizedAnswers.length === 0 ||
        normalizedAnswers.some(
          (answer) =>
            answer.selection === undefined ||
            (answer.selection.mode === "other" &&
              !(
                answer.selection.kind === "design-direction" &&
                answer.selection.designContract?.selectionMode === "custom" &&
                answer.selection.designContract?.customComposition?.complete === true
              )) ||
            answer.selection.kind === "customer-message",
        )
      ) {
        throw new TypeError(
          "Only generated-option selections or complete structured visual contracts can be recorded without project re-evaluation.",
        );
      }
      validateStructuredSelectionsAgainstCurrent(
        normalizedAnswers,
        current,
        currentDesign,
      );
      const cumulativeAnswers = cumulativeCustomerFollowUpAnswers(
        ledger,
        missionId,
        normalizedAnswers,
      );
      const result = applyStructuredSelectionChoices(
        understandingFromCurrent(current, currentDesign),
        cumulativeAnswers,
      );
      const profile = profileFromUnderstanding(
        missionId,
        context.originalCustomerRequest,
        cumulativeAnswers,
        result,
        current.profileVersion + 1,
      );
      const projectDesign = normalizeProjectDesign(
        Object.fromEntries(
          PROJECT_DESIGN_MODEL_FIELDS.map((key) => [key, result[key]]),
        ),
      );
      const productBlueprint = createProductBlueprint({
        missionId,
        originalCustomerRequest: context.originalCustomerRequest,
        profile,
        projectDesign,
        answers: cumulativeAnswers,
        productTypeDiscovery: latestProductTypeDiscovery(ledger, missionId),
      });
      // Bindings must come from the SAME plan the ApprovedProjectContract turns
      // into obligations. The blueprint appends design-verification entries to
      // the project plan, so binding only the project plan left those
      // obligations with an ID and no binding: they never reached
      // requiredBrowserCheckIds, the generator was never told to emit a check
      // for them, and they stayed PENDING until the mission gave up.
      const verificationBindings = Object.fromEntries(
        productBlueprint.verificationPlan.map((obligation, index) => [
          identifier("obligation", index),
          obligation.acceptanceMethod,
        ]),
      );
      const occurredAt = clock();
      const evidenceId = `${requestId}.selections`;
      evidence.capture({
        evidenceId,
        missionId,
        kind: ObservationKind.WORK_UNIT_RESULT,
        captureMethod: "customer-generated-option-selection",
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        timestamp: occurredAt,
        payload: {
          actionType: "customer-selection",
          status: "RECORDED",
          detail: `${normalizedAnswers.length} generated-option selection(s) were applied without another model call.`,
        },
        workspaceCheckpointReference: null,
        commandReference: requestId,
        workUnitReference: requestId,
        metadata: { profileVersion: profile.profileVersion },
      });
      facts.recordResultFact({
        missionId,
        eventId,
        causationId,
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        statement:
          "Customer selections were applied to the validated proposal without project re-evaluation.",
        evidenceReferences: [
          { evidenceId, workspaceCheckpointReference: null },
        ],
        workUnitReference: requestId,
        metadata: {
          projectProfile: profile,
          projectDesign,
          productBlueprint,
          originalCustomerRequest: context.originalCustomerRequest,
          verificationBindings,
          clarificationAnswers: structuredClone(cumulativeAnswers),
          localSelectionApplication: true,
        },
        occurredAt,
      });
      const afterFactState = ledger.projectState(missionId).state;
      if (
        profile.openQuestions.length === 0 &&
        afterFactState === MissionState.CLARIFYING
      ) {
        orchestrator.transition({
          missionId,
          eventId: `${eventId}.resolved`,
          causationId: eventId,
          to: MissionState.INTAKE,
          reason: "Recorded customer selections resolved every open question.",
        });
      }
      return Object.freeze({
        profile,
        projectDesign,
        productBlueprint,
        experience: profiles.experience(profile),
      });
    },

    async understand({
      missionId,
      intent,
      answers = [],
      requestId,
      eventId,
      causationId,
    }) {
      const state = ledger.projectState(missionId).state;
      if (
        state !== MissionState.INTAKE &&
        state !== MissionState.CLARIFYING
      ) {
        throw new TypeError(
          `Project understanding is unavailable while mission is ${state}.`,
        );
      }
      if (typeof intent !== "string" || intent.trim() === "") {
        throw new TypeError("Project intent must be non-empty.");
      }
      const current = latestProfile(ledger, missionId);
      const currentDesign = latestProjectDesign(ledger, missionId);
      const currentProductTypeDiscovery = latestProductTypeDiscovery(
        ledger,
        missionId,
      );
      const normalizedAnswers = normalizeCustomerFollowUpAnswers(answers);
      validateProductSubtypeSelections(
        normalizedAnswers,
        currentProductTypeDiscovery,
      );
      validateStructuredSelectionsAgainstCurrent(
        normalizedAnswers,
        current,
        currentDesign,
      );
      if (normalizedAnswers.length > 0) {
        const recordedAt = clock();
        const customerInputEvidence = evidence.capture({
          evidenceId: `${requestId}.customer-input`,
          missionId,
          kind: ObservationKind.WORK_UNIT_RESULT,
          captureMethod: "customer-follow-up-submission",
          producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
          timestamp: recordedAt,
          payload: {
            actionType: "customer-follow-up",
            status: "RECORDED",
            detail: `${normalizedAnswers.length} customer follow-up message(s) were durably recorded before re-evaluation.`,
          },
          workspaceCheckpointReference: null,
          commandReference: requestId,
          workUnitReference: requestId,
          metadata: {
            requestedProfileVersion: (current?.profileVersion ?? 0) + 1,
          },
        });
        facts.recordResultFact({
          missionId,
          eventId: `${requestId}.customer-input.fact`,
          causationId,
          occurredAt: recordedAt,
          producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
          statement:
            "Customer follow-up input was recorded before project re-evaluation.",
          evidenceReferences: [
            {
              evidenceId: customerInputEvidence.evidenceId,
              workspaceCheckpointReference: null,
            },
          ],
          workspaceCheckpointReference: null,
          workUnitReference: requestId,
          metadata: {
            customerFollowUpAnswers: structuredClone(normalizedAnswers),
            requestedProfileVersion: (current?.profileVersion ?? 0) + 1,
          },
        });
      }
      const cumulativeAnswers = cumulativeCustomerFollowUpAnswers(
        ledger,
        missionId,
        normalizedAnswers,
      );
      // A natural customer message already has a structured selection wrapper
      // so it can be traced, but it is not a request to regenerate the entire
      // product brief. Treating it like a design/decision selection made every
      // conversational edit pay for a full understanding pass and multiplied
      // the chance of provider timeouts. Natural messages use the bounded
      // revision envelope; only explicit studio choices require regeneration.
      const requiresCompleteRegeneration = normalizedAnswers.some(
        (answer) =>
          answer.selection !== undefined &&
          answer.selection.kind !== "customer-message",
      );
      const isRevision =
        current !== null &&
        currentDesign !== null &&
        cumulativeAnswers.length > 0 &&
        !requiresCompleteRegeneration;
      const selection = router.select({
        taskClass: "PROJECT_UNDERSTANDING",
        taskDepth: PROJECT_UNDERSTANDING_DEPTH,
        requiredCapabilities: [
          {
            capability: ModelCapability.ARCHITECTURE,
            minimumScore: 60,
          },
          {
            capability: ModelCapability.STRUCTURED_OUTPUT,
            minimumScore: 80,
          },
          {
            capability: ModelCapability.REASONING,
            minimumScore: 80,
          },
        ],
        costConstraints: {
          maximumTotalPerMillionTokensUsd: null,
        },
        userPreferences: {
          priority: "FAST_RESPONSE",
          preferredLatencyProfile: LatencyProfile.FAST,
        },
      });
      const providerCatalog = providerRegistry.list();
      const persistedRouteHistory = routeHistory();
      let candidateRoutes = selection.eligibleModelIds
        .map((modelId) =>
          providerCatalog.find(
            (candidate) => candidate.modelId === modelId,
          ),
        )
        .filter(Boolean);
      candidateRoutes = excludePermanentlyRejectedRoutes(
        candidateRoutes,
        persistedRouteHistory,
      );
      if (candidateRoutes.length === 0) {
        throw new Error(
          "No healthy project-understanding model remains after recorded model rejections.",
        );
      }
      candidateRoutes = candidateRoutes.filter(
        (route, index, routes) =>
          routes.findIndex(
            (candidate) => candidate.providerId === route.providerId,
          ) === index,
      );
      const needsProductTypeDiscovery =
        current === null &&
        currentDesign === null &&
        shouldDiscoverProductType(intent, cumulativeAnswers);
      if (needsProductTypeDiscovery) {
        if (currentProductTypeDiscovery !== null) {
          return Object.freeze({
            productTypeDiscovery: currentProductTypeDiscovery,
            routing: selection,
          });
        }
        return generateProductTypeDiscovery({
          ledger,
          orchestrator,
          evidence,
          facts,
          modelFacts,
          providerRegistry,
          clock,
          missionId,
          intent: intent.trim(),
          cumulativeAnswers,
          requestId,
          eventId,
          causationId,
          selection,
          candidateRoutes: candidateRoutes.slice(
            0,
            MAX_PRODUCT_INTELLIGENCE_ROUTES,
          ),
          productTypeDiscoveryHistory,
        });
      }
      candidateRoutes = candidateRoutes.slice(
        0,
        MAX_PRODUCT_INTELLIGENCE_ROUTES,
      );
      const historyAdjusted =
        selection.selectionFactors?.reliabilityHistoryApplied === true;
      const currentUnderstanding = isRevision
        ? understandingFromCurrent(current, currentDesign)
        : null;
      const allowedRevisionFields = isRevision
        ? revisionFieldsForAnswers(cumulativeAnswers)
        : new Set();
      const requestSchema = isRevision
        ? understandingRevisionEnvelopeSchema
        : FAST_INITIAL_UNDERSTANDING_SCHEMA;
      const request = {
        taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
        messages: [
          {
            role: "system",
            content:
               isRevision
                 ? "You are Foundry's Project Understanding authority. Return a minimal JSON Patch-style operations array that honors every customer follow-up. Use add, replace, or remove with a precise path. Put the JSON encoding of the new leaf value in valueJson; use the literal string null for remove."
                 : "You are Foundry's fast Project Understanding authority. Return a concise, project-specific proposal brief as strict JSON.",
          },
          {
            role: "user",
            content: isRevision
              ? understandingRevisionPrompt(
                  intent.trim(),
                  cumulativeAnswers,
                  currentUnderstanding,
                  allowedRevisionFields,
                )
              : fastUnderstandingPrompt(intent.trim(), cumulativeAnswers),
          },
        ],
        schemaName: isRevision
          ? "foundry_project_understanding_revision"
          : "foundry_fast_project_brief",
        schema: requestSchema,
      };
      let response = null;
      let result = null;
      let profile = null;
      let selectedRoute = null;
      let failure = null;
      for (
        let routeIndex = 0;
        routeIndex < candidateRoutes.length;
        routeIndex += 1
      ) {
        const route = candidateRoutes[routeIndex];
        const routeAttempt = routeIndex + 1;
        const routeTimestamp = clock();
        const routingReason = [
          ...selection.rationale,
          routeAttempt === 1
            ? "primary eligible route"
            : `failover route ${routeAttempt} after the prior provider failed`,
          historyAdjusted
            ? "persisted project-understanding outcomes promoted a repeatedly successful provider over recent failures"
            : null,
        ].filter(Boolean).join("; ");
        const routeEvidence = evidence.capture({
          evidenceId: `${requestId}.route-${routeAttempt}`,
          missionId,
          kind: ObservationKind.MODEL_CALL_RESULT,
          captureMethod: "project-understanding-route-dispatch",
          producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
          timestamp: routeTimestamp,
          payload: {
            requestId,
            status: "STARTED",
            structuredOutput: null,
            detail: "A live project-understanding request was dispatched.",
          },
          workspaceCheckpointReference: null,
          commandReference: requestId,
          workUnitReference: requestId,
          metadata: {
            provider: route.providerId,
            modelId: route.modelId,
            providerFamily: route.providerFamily,
            taskClass: "PROJECT_UNDERSTANDING",
            depthLevel: PROJECT_UNDERSTANDING_DEPTH,
            routingReason,
            routeAttempt,
          },
        });
        modelFacts.recordResultFact({
          missionId,
          eventId: `${requestId}.route-${routeAttempt}.fact`,
          causationId,
          occurredAt: routeTimestamp,
          producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
          statement: `Dispatched project understanding to eligible live route ${routeAttempt}.`,
          evidenceReferences: [
            {
              evidenceId: routeEvidence.evidenceId,
              workspaceCheckpointReference: null,
            },
          ],
          workspaceCheckpointReference: null,
          workUnitReference: requestId,
          metadata: { modelRouteStart: routeEvidence.metadata },
        });
        try {
          let candidateResponse;
          let candidateResult;
          let candidateProfile;
          let routeRequest = request;
          // Quality failures get bounded correction attempts on the same route
          // before Foundry fails over to another eligible provider.
          const maximumCorrectionAttempts =
            MAX_PRODUCT_INTELLIGENCE_GENERATIONS;
          for (
            let correctionAttempt = 1;
            correctionAttempt <= maximumCorrectionAttempts;
            correctionAttempt += 1
          ) {
            try {
              candidateResponse = await providerRegistry.generate(
                route.providerId,
                routeRequest,
                { modelId: route.modelId },
              );
              const legacyFullInitialOutput =
                !isRevision &&
                candidateResponse.output?.projectIntent !== undefined;
              const validatedOutput = validateStructuredModelOutput(
                candidateResponse.output,
                legacyFullInitialOutput ? understandingSchema : requestSchema,
              );
              candidateResult = isRevision
                ? applyUnderstandingRevision(
                    currentUnderstanding,
                    validatedOutput,
                    allowedRevisionFields,
                  )
                : normalizeUnderstandingCandidateBounds(
                    legacyFullInitialOutput
                      ? validatedOutput
                      : expandFastInitialUnderstanding(validatedOutput),
                  );
              validateProjectDesignQuality(
                Object.fromEntries(
                  PROJECT_DESIGN_MODEL_FIELDS.map((key) => [
                    key,
                    candidateResult[key],
                  ]),
                ),
                {
                  designFamily: candidateResult.family,
                  originalRequest: projectGroundingContext(
                    intent.trim(),
                    cumulativeAnswers,
                  ),
                },
              );
              candidateProfile = profileFromUnderstanding(
                missionId,
                intent.trim(),
                cumulativeAnswers,
                candidateResult,
                (current?.profileVersion ?? 0) + 1,
              );
              break;
            } catch (candidateError) {
              const candidateErrorMessage = String(
                candidateError?.message ?? candidateError,
              );
              const candidateErrorName = String(
                candidateError?.name ?? "",
              );
              const localValidationFailure =
                candidateError instanceof TypeError ||
                /(?:Validation|Quality|StructuredOutput)/u.test(
                  candidateErrorName,
                ) ||
                /(?:must be empty or contain|must contain|must include|must match|is malformed|is not grounded|lacks a|has no traceable|technical question)/iu.test(
                  candidateErrorMessage,
                );
              const correctionIsUseful =
                !/(?:timed out|could not be reached|compiled grammar|rate limit|unauthori[sz]ed|forbidden|request failed|unknown agent)/iu.test(
                  candidateErrorMessage,
                ) &&
                (isRevision || localValidationFailure);
              if (
                correctionAttempt >= maximumCorrectionAttempts ||
                !correctionIsUseful
              ) {
                throw candidateError;
              }
              routeRequest = {
                ...request,
                messages: [
                  ...request.messages,
                  {
                    role: "system",
                    content: isRevision
                      ? `The proposed revision was not publishable: ${candidateErrorMessage.slice(0, 500)} Correct only that defect and return a fresh complete operations array. Keep one-based dependency indexes, copy each essential capability exactly into the start of a corresponding observable verification outcome, preserve every customer instruction, patch only allowed fields, and do not weaken or remove unrelated verified behavior.`
                      : `The proposed project understanding was not publishable: ${candidateErrorMessage.slice(0, 700)} Return a fresh complete understanding object that corrects every listed defect, keeps every field project-specific, uses one-based dependency indexes, and preserves the original customer request. Copy every decision recommendation character-for-character into its alternatives. Begin a verification observableOutcome with the complete exact text of each essential capability. Ground every observation, recommendation, and each of the three-to-seven rich design directions in a concrete phrase from the original request. Make every alternative tradeoff a concrete phrase of at least five words.`,
                  },
                ],
              };
            }
          }
          response = candidateResponse;
          result = candidateResult;
          profile = candidateProfile;
          selectedRoute = {
            ...route,
            routeAttempt,
            routingReason,
            startTimestamp: routeTimestamp,
          };
          failure = null;
          break;
        } catch (error) {
          failure = error;
          const failedAt = clock();
          const failureDisposition = classifyModelRouteFailure(error);
          const failureEvidence = evidence.capture({
            evidenceId: `${requestId}.route-${routeAttempt}.failure`,
            missionId,
            kind: ObservationKind.MODEL_CALL_RESULT,
            captureMethod: "project-understanding-route-failure",
            producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
            timestamp: failedAt,
            payload: {
              requestId,
              status: "FAILED",
              structuredOutput: null,
              detail: String(error?.message ?? error).slice(0, 240),
            },
            workspaceCheckpointReference: null,
            commandReference: requestId,
            workUnitReference: requestId,
            metadata: {
              provider: route.providerId,
              modelId: route.modelId,
              providerFamily: route.providerFamily,
              taskClass: "PROJECT_UNDERSTANDING",
              depthLevel: PROJECT_UNDERSTANDING_DEPTH,
              routingReason,
              routeAttempt,
              failureCategory: failureDisposition.category,
              retryable: failureDisposition.retryable,
            },
          });
          facts.recordResultFact({
            missionId,
            eventId: `${requestId}.route-${routeAttempt}.failure.fact`,
            causationId,
            occurredAt: failedAt,
            producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
            statement: `Project-understanding route ${routeAttempt} failed safely.`,
            evidenceReferences: [
              {
                evidenceId: failureEvidence.evidenceId,
                workspaceCheckpointReference: null,
              },
            ],
            workspaceCheckpointReference: null,
            workUnitReference: requestId,
            metadata: {
              modelRouteFailure: {
                requestId,
                provider: route.providerId,
                providerFamily: route.providerFamily,
                modelId: route.modelId,
                taskClass: "PROJECT_UNDERSTANDING",
                depthLevel: PROJECT_UNDERSTANDING_DEPTH,
                routingReason,
                routeAttempt,
                failureCategory: failureDisposition.category,
                retryable: failureDisposition.retryable,
              },
            },
          });
          // A provider outage may use one different healthy provider. A
          // semantic, schema, policy, or quality rejection is not made better
          // by paying another provider for the same request, so stop there.
          if (!failureDisposition.retryable) break;
        }
      }
      if (
        result === null ||
        profile === null ||
        response === null ||
        selectedRoute === null
      ) {
        throw failure ?? new Error("No live understanding route completed.");
      }
      const projectDesign = normalizeProjectDesign(
        Object.fromEntries(
          PROJECT_DESIGN_MODEL_FIELDS.map((key) => [key, result[key]]),
        ),
      );
      const productBlueprint = createProductBlueprint({
        missionId,
        originalCustomerRequest: intent.trim(),
        profile,
        projectDesign,
        answers: cumulativeAnswers,
        productTypeDiscovery: currentProductTypeDiscovery,
      });
      // Bindings must come from the SAME plan the ApprovedProjectContract turns
      // into obligations. The blueprint appends design-verification entries to
      // the project plan, so binding only the project plan left those
      // obligations with an ID and no binding: they never reached
      // requiredBrowserCheckIds, the generator was never told to emit a check
      // for them, and they stayed PENDING until the mission gave up.
      const verificationBindings = Object.fromEntries(
        productBlueprint.verificationPlan.map((obligation, index) => [
          identifier("obligation", index),
          obligation.acceptanceMethod,
        ]),
      );
      const occurredAt = clock();
      const evidenceId = `${requestId}.understanding`;
      evidence.capture({
        evidenceId,
        missionId,
        kind: ObservationKind.MODEL_CALL_RESULT,
        captureMethod: "live-provider-structured-project-understanding",
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        timestamp: occurredAt,
        payload: {
          requestId,
          status: "SUCCEEDED",
          structuredOutput: profile,
          detail: "Live model output validated as a ProjectProfile.",
        },
        metadata: {
          providerId: selectedRoute.providerId,
          modelId: selectedRoute.modelId,
          providerFamily: selectedRoute.providerFamily,
          routingRationale: selectedRoute.routingReason,
          depthLevel: PROJECT_UNDERSTANDING_DEPTH,
          tokenUsage: response.usage,
        },
        commandReference: requestId,
        workUnitReference: requestId,
      });
      const modelCallRecord = normalizeModelCallRecord({
        requestId,
        missionId,
        workUnitId: requestId,
        purpose: "Interpret project intent into a validated ProjectProfile.",
        taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
        modelId: selectedRoute.modelId,
        modelTier: PROJECT_UNDERSTANDING_TIER,
        provider: selectedRoute.providerId,
        providerFamily: selectedRoute.providerFamily,
        depthLevel: PROJECT_UNDERSTANDING_DEPTH,
        routingReason: selectedRoute.routingReason,
        idempotencyKey: `${requestId}-key`,
        contextReferences: [],
        expectedStructuredOutputSchema: requestSchema,
        structuredOutput: response.output,
        tokenMetadata: {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
        },
        costMetadata: {
          attemptCount: selectedRoute.routeAttempt,
          costUsd: response.usage?.costUsd ?? 0,
        },
        startTimestamp: selectedRoute.startTimestamp,
        endTimestamp: occurredAt,
        status: "SUCCEEDED",
      });
      modelFacts.recordResultFact({
        missionId,
        eventId: `${requestId}.model.fact`,
        causationId,
        occurredAt,
        producingSubsystem: MODEL_GATEWAY_SOURCE,
        statement:
          "Project-understanding model request completed with operational status SUCCEEDED.",
        evidenceReferences: [
          {
            evidenceId,
            workspaceCheckpointReference: null,
          },
        ],
        workspaceCheckpointReference: null,
        workUnitReference: requestId,
        metadata: { modelCallRecord },
      });
      facts.recordResultFact({
        missionId,
        eventId,
        causationId,
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        statement: "Project intent interpreted into a validated profile.",
        evidenceReferences: [
          {
            evidenceId,
            workspaceCheckpointReference: null,
          },
        ],
        workUnitReference: requestId,
        metadata: {
          projectProfile: profile,
          projectDesign,
          productBlueprint,
          originalCustomerRequest: intent.trim(),
          verificationBindings,
          clarificationAnswers: structuredClone(cumulativeAnswers),
        },
        occurredAt,
      });

      const afterFactState = ledger.projectState(missionId).state;
      if (
        profile.openQuestions.length > 0 &&
        afterFactState === MissionState.INTAKE
      ) {
        orchestrator.transition({
          missionId,
          eventId: `${eventId}.clarifying`,
          causationId: eventId,
          to: MissionState.CLARIFYING,
          reason:
            "The live ProjectProfile contains unresolved architecture-changing questions.",
        });
      } else if (
        profile.openQuestions.length === 0 &&
        afterFactState === MissionState.CLARIFYING
      ) {
        orchestrator.transition({
          missionId,
          eventId: `${eventId}.resolved`,
          causationId: eventId,
          to: MissionState.INTAKE,
          reason:
            "Live interpretation resolved all architecture-changing questions.",
        });
      }
      return Object.freeze({
        profile,
        projectDesign,
        productBlueprint,
        experience: profiles.experience(profile),
        routing: selection,
      });
    },

    blueprint(missionId) {
      return latestProductBlueprint(ledger, missionId);
    },

    approveBlueprint({ missionId, answer, eventId, causationId }) {
      const [normalized] = normalizeCustomerFollowUpAnswers([answer]);
      const selection = normalized?.selection;
      const blueprint = latestProductBlueprint(ledger, missionId);
      if (
        blueprint === null ||
        selection?.kind !== "blueprint-approval" ||
        selection.mode !== "confirm" ||
        selection.subjectId !== "product-blueprint" ||
        selection.value !== blueprint.integrityHash ||
        selection.sourceProfileVersion !== blueprint.blueprintVersion
      ) {
        throw new TypeError("Blueprint approval must match the latest version and integrity hash.");
      }
      const occurredAt = clock();
      const approval = Object.freeze({
        blueprintVersion: blueprint.blueprintVersion,
        integrityHash: blueprint.integrityHash,
        approvalTimestamp: occurredAt,
        selection: structuredClone(selection),
      });
      const approvalEvidence = evidence.capture({
        evidenceId: `${eventId}.evidence`,
        missionId,
        kind: ObservationKind.WORK_UNIT_RESULT,
        captureMethod: "customer-product-blueprint-approval",
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        timestamp: occurredAt,
        payload: {
          actionType: "product-blueprint-approval",
          status: "APPROVED",
          detail: `Customer approved Product Blueprint v${blueprint.blueprintVersion} with integrity hash ${blueprint.integrityHash}.`,
        },
        workspaceCheckpointReference: null,
        commandReference: eventId,
        workUnitReference: eventId,
        metadata: {
          blueprintVersion: blueprint.blueprintVersion,
          integrityHash: blueprint.integrityHash,
        },
      });
      facts.recordResultFact({
        missionId,
        eventId,
        causationId,
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        statement: `Customer approved Product Blueprint v${blueprint.blueprintVersion}.`,
        evidenceReferences: [
          {
            evidenceId: approvalEvidence.evidenceId,
            workspaceCheckpointReference: null,
          },
        ],
        workUnitReference: eventId,
        metadata: {
          productBlueprintApproval: approval,
          customerFollowUpAnswers: [structuredClone(normalized)],
          requestedProfileVersion: blueprint.blueprintVersion,
        },
        occurredAt,
      });
      return approval;
    },

    contract({ missionId, eventId, causationId }) {
      const profile = latestProfile(ledger, missionId);
      const projectDesign = latestProjectDesign(ledger, missionId);
      const context = latestUnderstandingContext(ledger, missionId);
      const productBlueprint = latestProductBlueprint(ledger, missionId);
      const blueprintApproval = latestBlueprintApproval(ledger, missionId);
      if (profile === null) {
        throw new TypeError("A recorded ProjectProfile is required.");
      }
      if (projectDesign === null || context === null) {
        throw new TypeError(
          "A validated deep Project Design is required before approval.",
        );
      }
      if (
        requireProductBlueprintApproval &&
        (
          productBlueprint === null ||
          blueprintApproval === null ||
          blueprintApproval.integrityHash !== productBlueprint.integrityHash ||
          blueprintApproval.blueprintVersion !== productBlueprint.blueprintVersion
        )
      ) {
        throw new TypeError("The latest Product Blueprint must be explicitly approved before execution.");
      }
      if (profile.openQuestions.length > 0) {
        throw new TypeError(
          "A contract cannot be created while architecture-changing questions remain unresolved.",
        );
      }
      if (profile.platform.toLowerCase() !== "web") {
        throw new TypeError(
          `Foundry does not yet support the requested platform "${profile.platform}".`,
        );
      }
      const draft = profiles.contractDraft(profile);
      // Production requires an explicitly approved Product Blueprint. Tests,
      // migrations, and replay of pre-blueprint ledgers may intentionally run
      // with that gate disabled; retain their already-validated deep plan.
      const approvedVerificationPlan =
        productBlueprint?.verificationPlan ?? projectDesign.verificationPlan;
      const approvedObligations = obligationsFromVerificationPlan(
        approvedVerificationPlan,
        draft.contractVersion,
      );
      const requirementObligations = approvedObligations.map(
        ({ sourceRequirement: _sourceRequirement, ...obligation }) => obligation,
      );
      const approvalTimestamp = clock();
      const decisionSelections = [
        ...resolvedDecisionSelections(projectDesign, context.clarificationAnswers, profile.profileVersion),
        ...(blueprintApproval === null ? [] : [blueprintApproval.selection]),
      ];
      const acceptedRecommendations = projectDesign.recommendations.filter(
        (recommendation) =>
          decisionSelections.some(
            (selection) =>
              selection.kind === "recommendation" &&
              selection.value === recommendation.title &&
              selection.mode === "include",
          ),
      );
      const rejectedRecommendations = projectDesign.recommendations.filter(
        (recommendation) =>
          !acceptedRecommendations.includes(recommendation),
      );
      const customerDecisionValues = new Set(
        decisionSelections
          .filter(
            (selection) =>
              selection.kind === "decision" &&
              [
                "accept-recommendation",
                "select-option",
                "other",
              ].includes(selection.mode),
          )
          .map((selection) => selection.value),
      );
      const selectedDesignDirection = productBlueprint === null
        ? structuredClone(projectDesign.designDirection)
        : {
            visualPersonality:
              productBlueprint.designSpecification.objective.visualPersonality,
            tone: productBlueprint.designSpecification.color.mood,
            layoutStrategy:
              productBlueprint.designSpecification.composition.layoutStrategy,
            informationDensity:
              productBlueprint.designSpecification.composition.informationDensity,
            navigationApproach:
              productBlueprint.designSpecification.navigation.approach,
            responsivePriority:
              productBlueprint.designSpecification.responsive.priority,
            accessibilityNeeds:
              productBlueprint.designSpecification.accessibility.requirements,
            contentStrategy:
              productBlueprint.designSpecification.surfaces.contentEmphasis,
            interactionStyle:
              productBlueprint.designSpecification.navigation.interactionStyle,
            rationale: productBlueprint.designSpecification.objective.rationale,
          };
      const approvedDraft = createApprovedProjectContract({
        missionId,
        originalCustomerRequest: context.originalCustomerRequest,
        customerFollowUpMessages: [
          ...new Set(
            context.clarificationAnswers
              .filter(
                (answer) =>
                  answer?.selection === undefined ||
                  answer.selection.kind === "customer-message",
              )
              .map((answer) => String(answer?.answer ?? "").trim())
              .filter(Boolean),
          ),
        ],
        finalInterpretedIntent: projectDesign.projectIntent,
        audiences: projectDesign.projectIntent.intendedUsers,
        workflows: projectDesign.userExperiencePlan,
        selectedDesignDirection,
        acceptedRecommendations,
        rejectedRecommendations,
        customerDecisions: projectDesign.decisions.filter(
          (decision) =>
            customerDecisionValues.has(decision.recommendation) ||
            decision.alternatives.some((alternative) =>
              customerDecisionValues.has(alternative),
            ),
        ),
        foundryDecisions: projectDesign.decisions.filter(
          (decision) =>
            !customerDecisionValues.has(decision.recommendation) &&
            !decision.alternatives.some((alternative) =>
              customerDecisionValues.has(alternative),
            ),
        ),
        assumptions: projectDesign.foundryInsights.assumptions,
        explicitExclusions:
          projectDesign.productProposal.intentionallyExcludedCapabilities,
        architectureConstraints: approvedArchitectureConstraints(
          projectDesign,
          profile,
        ),
        supportedPlatform: profile.platform,
        selectedStackCapability: {
          stackId: profile.selectedStack.stackId,
          stackVersion: profile.selectedStack.version,
          capabilities: profile.capabilities,
        },
        acceptanceObligations: approvedObligations,
        verificationPlan: approvedVerificationPlan,
        ...(blueprintApproval === null ? {} : { productBlueprint }),
        decisionSelections,
        contractVersion:
          (approvedContracts.latest(missionId)?.contractVersion ?? 0) + 1,
        approvalTimestamp,
      });
      validateApprovedProjectContractConsistency(approvedDraft);
      const contract = contracts.createContract({
        missionId,
        eventId,
        causationId,
        contractVersion: draft.contractVersion,
        obligations: requirementObligations,
      });
      approvedContracts.approve({
        missionId,
        eventId: `${eventId}.approved-project-contract`,
        causationId: eventId,
        contract: approvedDraft,
      });
      orchestrator.transition({
        missionId,
        eventId: `${eventId}.contracted`,
        causationId: eventId,
        to: MissionState.CONTRACTED,
        reason:
          "A valid model-derived Requirement Contract is recorded in the Mission Ledger.",
      });
      return contract;
    },
  });
}
