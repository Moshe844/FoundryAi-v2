import {
  ProjectDesignQualityError,
  ProjectDesignValidationError,
} from "./errors.js";

const CONFIDENCE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["score", "rationale"],
  properties: {
    score: { type: "number" },
    rationale: { type: "string", minLength: 1 },
  },
});

const STRING_ARRAY_SCHEMA = Object.freeze({
  type: "array",
  items: { type: "string", minLength: 1 },
});
const NON_EMPTY_STRING_ARRAY_SCHEMA = Object.freeze({
  type: "array",
  minItems: 1,
  items: { type: "string", minLength: 1 },
});

export const PROJECT_DESIGN_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "projectIntent",
    "userExperiencePlan",
    "productProposal",
    "designDirection",
    "foundryInsights",
    "decisions",
    "recommendations",
    "verificationPlan",
  ],
  properties: {
    projectIntent: {
      type: "object",
      additionalProperties: false,
      required: [
        "customerOutcome",
        "businessContext",
        "intendedUsers",
        "primaryGoal",
        "secondaryGoals",
        "successDefinition",
        "constraints",
        "confidence",
      ],
      properties: {
        customerOutcome: { type: "string", minLength: 1 },
        businessContext: { type: "string", minLength: 1 },
        intendedUsers: NON_EMPTY_STRING_ARRAY_SCHEMA,
        primaryGoal: { type: "string", minLength: 1 },
        secondaryGoals: STRING_ARRAY_SCHEMA,
        successDefinition: { type: "string", minLength: 1 },
        constraints: STRING_ARRAY_SCHEMA,
        confidence: CONFIDENCE_SCHEMA,
      },
    },
    userExperiencePlan: {
      type: "object",
      additionalProperties: false,
      required: [
        "primaryJourneys",
        "secondaryJourneys",
        "criticalMoments",
        "failureStates",
        "trustMoments",
        "repeatedTasks",
        "adminResponsibilities",
      ],
      properties: {
        primaryJourneys: NON_EMPTY_STRING_ARRAY_SCHEMA,
        secondaryJourneys: STRING_ARRAY_SCHEMA,
        criticalMoments: NON_EMPTY_STRING_ARRAY_SCHEMA,
        failureStates: NON_EMPTY_STRING_ARRAY_SCHEMA,
        trustMoments: NON_EMPTY_STRING_ARRAY_SCHEMA,
        repeatedTasks: STRING_ARRAY_SCHEMA,
        adminResponsibilities: STRING_ARRAY_SCHEMA,
      },
    },
    productProposal: {
      type: "object",
      additionalProperties: false,
      required: [
        "essentialCapabilities",
        "recommendedCapabilities",
        "intentionallyExcludedCapabilities",
        "futureCapabilities",
        "rationale",
        "dependencies",
        "scopeImpact",
      ],
      properties: {
        essentialCapabilities: NON_EMPTY_STRING_ARRAY_SCHEMA,
        recommendedCapabilities: STRING_ARRAY_SCHEMA,
        intentionallyExcludedCapabilities: STRING_ARRAY_SCHEMA,
        futureCapabilities: STRING_ARRAY_SCHEMA,
        rationale: { type: "string", minLength: 1 },
        dependencies: STRING_ARRAY_SCHEMA,
        scopeImpact: { type: "string", minLength: 1 },
      },
    },
    designDirection: {
      type: "object",
      additionalProperties: false,
      required: [
        "visualPersonality",
        "tone",
        "layoutStrategy",
        "informationDensity",
        "navigationApproach",
        "responsivePriority",
        "accessibilityNeeds",
        "contentStrategy",
        "interactionStyle",
        "rationale",
      ],
      properties: {
        visualPersonality: { type: "string", minLength: 1 },
        tone: { type: "string", minLength: 1 },
        layoutStrategy: { type: "string", minLength: 1 },
        informationDensity: { type: "string", minLength: 1 },
        navigationApproach: { type: "string", minLength: 1 },
        responsivePriority: { type: "string", minLength: 1 },
        accessibilityNeeds: NON_EMPTY_STRING_ARRAY_SCHEMA,
        contentStrategy: { type: "string", minLength: 1 },
        interactionStyle: { type: "string", minLength: 1 },
        rationale: { type: "string", minLength: 1 },
      },
    },
    designAlternatives: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "description",
          "whyItFits",
          "layoutApproach",
          "visualPersonality",
          "informationDensity",
          "navigationApproach",
          "mobileBehavior",
          "tradeoff",
          "confidence",
          "recommended",
          "preview",
        ],
        properties: {
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
          whyItFits: { type: "string", minLength: 1 },
          layoutApproach: { type: "string", minLength: 1 },
          visualPersonality: { type: "string", minLength: 1 },
          informationDensity: { type: "string", minLength: 1 },
          navigationApproach: { type: "string", minLength: 1 },
          mobileBehavior: { type: "string", minLength: 1 },
          tradeoff: { type: "string", minLength: 1 },
          confidence: CONFIDENCE_SCHEMA,
          recommended: { type: "boolean" },
          preview: {
            type: "object",
            additionalProperties: false,
            required: [
              "typographyCharacter",
              "spacingDensity",
              "colorMood",
              "hierarchy",
            ],
            properties: {
              typographyCharacter: { type: "string", minLength: 1 },
              spacingDensity: { type: "string", minLength: 1 },
              colorMood: { type: "string", minLength: 1 },
              hierarchy: { type: "string", minLength: 1 },
            },
          },
        },
      },
    },
    foundryInsights: {
      type: "object",
      additionalProperties: false,
      required: [
        "observations",
        "opportunities",
        "risks",
        "ambiguities",
        "assumptions",
        "confidence",
      ],
      properties: {
        observations: NON_EMPTY_STRING_ARRAY_SCHEMA,
        opportunities: NON_EMPTY_STRING_ARRAY_SCHEMA,
        risks: NON_EMPTY_STRING_ARRAY_SCHEMA,
        ambiguities: STRING_ARRAY_SCHEMA,
        assumptions: STRING_ARRAY_SCHEMA,
        confidence: CONFIDENCE_SCHEMA,
      },
    },
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "customerFriendlyQuestion",
          "whyItMatters",
          "recommendation",
          "recommendationReason",
          "alternatives",
          "consequenceOfEachChoice",
          "canFoundryDecide",
          "architectureImpact",
          "scopeImpact",
        ],
        properties: {
          customerFriendlyQuestion: { type: "string", minLength: 1 },
          whyItMatters: { type: "string", minLength: 1 },
          recommendation: { type: "string", minLength: 1 },
          recommendationReason: { type: "string", minLength: 1 },
          alternatives: {
            type: "array",
            minItems: 3,
            maxItems: 7,
            items: { type: "string", minLength: 1 },
          },
          consequenceOfEachChoice: {
            type: "array",
            minItems: 3,
            maxItems: 7,
            items: { type: "string", minLength: 1 },
          },
          canFoundryDecide: { type: "boolean" },
          architectureImpact: { type: "string", minLength: 1 },
          scopeImpact: { type: "string", minLength: 1 },
        },
      },
    },
    recommendations: {
      type: "array",
      minItems: 3,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "specificValue",
          "whyThisProjectNeedsIt",
          "impact",
          "selectedByDefault",
          "confidence",
          "requiredDependencies",
        ],
        properties: {
          title: { type: "string", minLength: 1 },
          specificValue: { type: "string", minLength: 1 },
          whyThisProjectNeedsIt: { type: "string", minLength: 1 },
          impact: { type: "string", minLength: 1 },
          selectedByDefault: { type: "boolean" },
          confidence: CONFIDENCE_SCHEMA,
          requiredDependencies: STRING_ARRAY_SCHEMA,
        },
      },
    },
    verificationPlan: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "observableOutcome",
          "acceptanceMethod",
          "evidenceRequired",
          "sourceRequirement",
          "origin",
          "dependencyIndexes",
        ],
        properties: {
          observableOutcome: { type: "string", minLength: 1 },
          acceptanceMethod: {
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
          evidenceRequired: NON_EMPTY_STRING_ARRAY_SCHEMA,
          sourceRequirement: { type: "string", minLength: 1 },
          origin: {
            type: "string",
            enum: ["customer-stated", "foundry-derived"],
          },
          dependencyIndexes: {
            type: "array",
            items: { type: "integer" },
          },
        },
      },
    },
  },
});

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "because", "been", "being",
  "build", "can", "could", "customer", "customers", "each", "for", "from",
  "have", "into", "more", "must", "need", "needs", "only", "other", "project",
  "should", "that", "the", "their", "them", "this", "through", "use", "user",
  "users", "using", "want", "with", "would",
]);
const TECHNICAL_QUESTION_TERMS = /\b(?:api|architecture|database|delegated|middleware|oauth|persistence|runtime|schema|server-side|stateless|topology|webhook)\b/iu;
const ACCEPTANCE_METHODS = new Set([
  "browser-check", "browser-errors", "dependency-lock",
  "dependency-install", "type-check", "lint", "production-build",
  "runtime-ready", "http-ready", "structured-tests",
]);
const CERTAINTY_TERMS = /\b(?:certain|certainly|definite|definitely|no doubt|unquestionably)\b/iu;
const UNCERTAINTY_TERMS = /\b(?:ambiguous|uncertain|unclear|unknown|unsure)\b/iu;

function fail(message) {
  throw new ProjectDesignValidationError(message);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function exact(value, keys, label) {
  object(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly: ${expected.join(", ")}.`);
  }
}

function exactWithOptional(value, required, optional, label) {
  object(value, label);
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    fail(
      `${label} must contain ${required.join(", ")}${
        optional.length > 0 ? `; optional: ${optional.join(", ")}` : ""
      }.`,
    );
  }
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function list(value, label, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    fail(`${label} must be ${required ? "a non-empty" : "an"} array.`);
  }
  const normalized = value.map((entry, index) => text(entry, `${label}[${index}]`));
  const comparable = normalized.map(normalizeText);
  if (new Set(comparable).size !== comparable.length) fail(`${label} contains duplicates.`);
  return normalized;
}

function confidence(value, label) {
  exact(value, ["score", "rationale"], label);
  if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 1) {
    fail(`${label}.score must be between 0 and 1.`);
  }
  return { score: value.score, rationale: text(value.rationale, `${label}.rationale`) };
}

function normalizeText(value) {
  return String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function tokens(value) {
  return new Set(normalizeText(value).split(" ").filter((token) => token.length >= 4 && !STOP_WORDS.has(token)));
}

function normalizeDecision(value, index) {
  const label = `decisions[${index}]`;
  const keys = ["customerFriendlyQuestion", "whyItMatters", "recommendation", "recommendationReason", "alternatives", "consequenceOfEachChoice", "canFoundryDecide", "architectureImpact", "scopeImpact"];
  exact(value, keys, label);
  if (typeof value.canFoundryDecide !== "boolean") fail(`${label}.canFoundryDecide must be boolean.`);
  const alternatives = list(value.alternatives, `${label}.alternatives`, { required: true });
  const consequences = list(value.consequenceOfEachChoice, `${label}.consequenceOfEachChoice`, { required: true });
  if (alternatives.length < 3 || alternatives.length > 7) {
    fail(`${label}.alternatives must contain three to seven meaningful choices.`);
  }
  if (alternatives.length !== consequences.length) fail(`${label} must give one consequence for every alternative.`);
  return {
    customerFriendlyQuestion: text(value.customerFriendlyQuestion, `${label}.customerFriendlyQuestion`),
    whyItMatters: text(value.whyItMatters, `${label}.whyItMatters`),
    recommendation: text(value.recommendation, `${label}.recommendation`),
    recommendationReason: text(value.recommendationReason, `${label}.recommendationReason`),
    alternatives,
    consequenceOfEachChoice: consequences,
    canFoundryDecide: value.canFoundryDecide,
    architectureImpact: text(value.architectureImpact, `${label}.architectureImpact`),
    scopeImpact: text(value.scopeImpact, `${label}.scopeImpact`),
  };
}

function normalizeRecommendation(value, index) {
  const label = `recommendations[${index}]`;
  const keys = ["title", "specificValue", "whyThisProjectNeedsIt", "impact", "selectedByDefault", "confidence", "requiredDependencies"];
  exact(value, keys, label);
  if (typeof value.selectedByDefault !== "boolean") fail(`${label}.selectedByDefault must be boolean.`);
  return {
    title: text(value.title, `${label}.title`),
    specificValue: text(value.specificValue, `${label}.specificValue`),
    whyThisProjectNeedsIt: text(value.whyThisProjectNeedsIt, `${label}.whyThisProjectNeedsIt`),
    impact: text(value.impact, `${label}.impact`),
    selectedByDefault: value.selectedByDefault,
    confidence: confidence(value.confidence, `${label}.confidence`),
    requiredDependencies: list(value.requiredDependencies, `${label}.requiredDependencies`),
  };
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

export function normalizeProjectIntent(intent) {
  exact(intent, ["customerOutcome", "businessContext", "intendedUsers", "primaryGoal", "secondaryGoals", "successDefinition", "constraints", "confidence"], "projectIntent");
  return freeze({
    customerOutcome: text(intent.customerOutcome, "projectIntent.customerOutcome"),
    businessContext: text(intent.businessContext, "projectIntent.businessContext"),
    intendedUsers: list(intent.intendedUsers, "projectIntent.intendedUsers", { required: true }),
    primaryGoal: text(intent.primaryGoal, "projectIntent.primaryGoal"),
    secondaryGoals: list(intent.secondaryGoals, "projectIntent.secondaryGoals"),
    successDefinition: text(intent.successDefinition, "projectIntent.successDefinition"),
    constraints: list(intent.constraints, "projectIntent.constraints"),
    confidence: confidence(intent.confidence, "projectIntent.confidence"),
  });
}

export function normalizeUserExperiencePlan(ux) {
  exact(ux, ["primaryJourneys", "secondaryJourneys", "criticalMoments", "failureStates", "trustMoments", "repeatedTasks", "adminResponsibilities"], "userExperiencePlan");
  return freeze(Object.fromEntries(Object.entries(ux).map(([key, value]) => [key, list(value, `userExperiencePlan.${key}`, { required: ["primaryJourneys", "criticalMoments", "failureStates", "trustMoments"].includes(key) })])));
}

export function normalizeDesignDirection(design) {
  exact(design, ["visualPersonality", "tone", "layoutStrategy", "informationDensity", "navigationApproach", "responsivePriority", "accessibilityNeeds", "contentStrategy", "interactionStyle", "rationale"], "designDirection");
  return freeze({
    ...Object.fromEntries(Object.entries(design).filter(([key]) => key !== "accessibilityNeeds").map(([key, value]) => [key, text(value, `designDirection.${key}`)])),
    accessibilityNeeds: list(design.accessibilityNeeds, "designDirection.accessibilityNeeds", { required: true }),
  });
}

export function normalizeDesignAlternativeList(value = []) {
  if (!Array.isArray(value)) fail("designAlternatives must be an array.");
  if (value.length < 3 || value.length > 7) {
    fail("designAlternatives must contain three to seven meaningful directions.");
  }
  const normalized = value.map((entry, index) => {
    const label = `designAlternatives[${index}]`;
    exact(
      entry,
      [
        "name",
        "description",
        "whyItFits",
        "layoutApproach",
        "visualPersonality",
        "informationDensity",
        "navigationApproach",
        "mobileBehavior",
        "tradeoff",
        "confidence",
        "recommended",
        "preview",
      ],
      label,
    );
    if (typeof entry.recommended !== "boolean") {
      fail(`${label}.recommended must be boolean.`);
    }
    exact(
      entry.preview,
      [
        "typographyCharacter",
        "spacingDensity",
        "colorMood",
        "hierarchy",
      ],
      `${label}.preview`,
    );
    return {
      name: text(entry.name, `${label}.name`),
      description: text(entry.description, `${label}.description`),
      whyItFits: text(entry.whyItFits, `${label}.whyItFits`),
      layoutApproach: text(entry.layoutApproach, `${label}.layoutApproach`),
      visualPersonality: text(
        entry.visualPersonality,
        `${label}.visualPersonality`,
      ),
      informationDensity: text(
        entry.informationDensity,
        `${label}.informationDensity`,
      ),
      navigationApproach: text(
        entry.navigationApproach,
        `${label}.navigationApproach`,
      ),
      mobileBehavior: text(entry.mobileBehavior, `${label}.mobileBehavior`),
      tradeoff: text(entry.tradeoff, `${label}.tradeoff`),
      confidence: confidence(entry.confidence, `${label}.confidence`),
      recommended: entry.recommended,
      preview: {
        typographyCharacter: text(
          entry.preview.typographyCharacter,
          `${label}.preview.typographyCharacter`,
        ),
        spacingDensity: text(
          entry.preview.spacingDensity,
          `${label}.preview.spacingDensity`,
        ),
        colorMood: text(entry.preview.colorMood, `${label}.preview.colorMood`),
        hierarchy: text(entry.preview.hierarchy, `${label}.preview.hierarchy`),
      },
    };
  });
  if (
    normalized.length > 0 &&
    normalized.filter((entry) => entry.recommended).length !== 1
  ) {
    fail("designAlternatives must mark exactly one direction as recommended.");
  }
  return freeze(normalized);
}

export function normalizeDecisionList(value) {
  if (!Array.isArray(value)) fail("decisions must be an array.");
  return freeze(value.map(normalizeDecision));
}

export function normalizeRecommendationList(value) {
  if (!Array.isArray(value) || value.length === 0) fail("recommendations must be a non-empty array.");
  return freeze(value.map(normalizeRecommendation));
}

export function normalizeProjectVerificationPlan(value) {
  if (!Array.isArray(value) || value.length === 0) fail("verificationPlan must be a non-empty array.");
  return freeze(value.map((entry, index) => {
    const label = `verificationPlan[${index}]`;
    exact(entry, ["observableOutcome", "acceptanceMethod", "evidenceRequired", "sourceRequirement", "origin", "dependencyIndexes"], label);
    if (!["customer-stated", "foundry-derived"].includes(entry.origin)) fail(`${label}.origin is invalid.`);
    if (!ACCEPTANCE_METHODS.has(entry.acceptanceMethod)) fail(`${label}.acceptanceMethod is unsupported.`);
    if (!Array.isArray(entry.dependencyIndexes) || entry.dependencyIndexes.some((dependency) => !Number.isSafeInteger(dependency) || dependency < 1)) fail(`${label}.dependencyIndexes must contain positive integers.`);
    return {
      observableOutcome: text(entry.observableOutcome, `${label}.observableOutcome`),
      acceptanceMethod: text(entry.acceptanceMethod, `${label}.acceptanceMethod`),
      evidenceRequired: list(entry.evidenceRequired, `${label}.evidenceRequired`, { required: true }),
      sourceRequirement: text(entry.sourceRequirement, `${label}.sourceRequirement`),
      origin: entry.origin,
      dependencyIndexes: [...new Set(entry.dependencyIndexes)],
    };
  }));
}

export function normalizeProjectDesign(input) {
  exactWithOptional(
    input,
    ["projectIntent", "userExperiencePlan", "productProposal", "designDirection", "foundryInsights", "decisions", "recommendations", "verificationPlan"],
    ["designAlternatives"],
    "projectDesign",
  );
  const intent = object(input.projectIntent, "projectIntent");
  const ux = object(input.userExperiencePlan, "userExperiencePlan");
  const proposal = object(input.productProposal, "productProposal");
  exact(proposal, ["essentialCapabilities", "recommendedCapabilities", "intentionallyExcludedCapabilities", "futureCapabilities", "rationale", "dependencies", "scopeImpact"], "productProposal");
  const design = object(input.designDirection, "designDirection");
  const insights = object(input.foundryInsights, "foundryInsights");
  exact(insights, ["observations", "opportunities", "risks", "ambiguities", "assumptions", "confidence"], "foundryInsights");
  if (!Array.isArray(input.decisions) || !Array.isArray(input.recommendations) || input.recommendations.length < 3 || input.recommendations.length > 7 || !Array.isArray(input.verificationPlan) || input.verificationPlan.length === 0) fail("decisions and verificationPlan must be valid arrays, and recommendations must contain three to seven items.");
  const normalized = {
    projectIntent: normalizeProjectIntent(intent),
    userExperiencePlan: normalizeUserExperiencePlan(ux),
    productProposal: {
      essentialCapabilities: list(proposal.essentialCapabilities, "productProposal.essentialCapabilities", { required: true }),
      recommendedCapabilities: list(proposal.recommendedCapabilities, "productProposal.recommendedCapabilities"),
      intentionallyExcludedCapabilities: list(proposal.intentionallyExcludedCapabilities, "productProposal.intentionallyExcludedCapabilities"),
      futureCapabilities: list(proposal.futureCapabilities, "productProposal.futureCapabilities"),
      rationale: text(proposal.rationale, "productProposal.rationale"),
      dependencies: list(proposal.dependencies, "productProposal.dependencies"),
      scopeImpact: text(proposal.scopeImpact, "productProposal.scopeImpact"),
    },
    designDirection: normalizeDesignDirection(design),
    designAlternatives: normalizeDesignAlternativeList(input.designAlternatives ?? []),
    foundryInsights: {
      observations: list(insights.observations, "foundryInsights.observations", { required: true }),
      opportunities: list(insights.opportunities, "foundryInsights.opportunities", { required: true }),
      risks: list(insights.risks, "foundryInsights.risks", { required: true }),
      ambiguities: list(insights.ambiguities, "foundryInsights.ambiguities"),
      assumptions: list(insights.assumptions, "foundryInsights.assumptions"),
      confidence: confidence(insights.confidence, "foundryInsights.confidence"),
    },
    decisions: normalizeDecisionList(input.decisions),
    recommendations: normalizeRecommendationList(input.recommendations),
    verificationPlan: normalizeProjectVerificationPlan(input.verificationPlan),
  };
  return freeze(normalized);
}

function overlap(left, right) {
  for (const token of left) if (right.has(token)) return true;
  return false;
}

function wordCount(value) {
  return normalizeText(value).split(" ").filter(Boolean).length;
}

export function validateProjectDesignQuality(input, { originalRequest = "" } = {}) {
  const design = normalizeProjectDesign(input);
  const issues = [];
  const intent = design.projectIntent;
  for (const [field, value] of [["customerOutcome", intent.customerOutcome], ["businessContext", intent.businessContext], ["primaryGoal", intent.primaryGoal], ["successDefinition", intent.successDefinition]]) {
    if (wordCount(value) < 6) issues.push(`projectIntent.${field} is too vague.`);
  }
  const anchors = tokens([originalRequest, intent.customerOutcome, intent.businessContext, intent.primaryGoal, ...intent.intendedUsers, ...design.userExperiencePlan.primaryJourneys].join(" "));
  const designRationaleTokens = tokens(
    `${design.designDirection.visualPersonality} ${design.designDirection.rationale}`,
  );
  if (wordCount(design.designDirection.rationale) < 8) {
    issues.push("designDirection.rationale is too vague.");
  }
  if (anchors.size > 0 && !overlap(anchors, designRationaleTokens)) {
    issues.push("designDirection is not grounded in this project.");
  }
  const alternativeNames = new Set();
  for (const [index, alternative] of design.designAlternatives.entries()) {
    const name = normalizeText(alternative.name);
    if (alternativeNames.has(name)) {
      issues.push(`designAlternatives[${index}] duplicates another direction.`);
    }
    alternativeNames.add(name);
    if (
      wordCount(alternative.description) < 7 ||
      wordCount(alternative.whyItFits) < 8 ||
      wordCount(alternative.tradeoff) < 5
    ) {
      issues.push(`designAlternatives[${index}] lacks a meaningful tradeoff.`);
    }
    const grounding = tokens(
      `${alternative.description} ${alternative.whyItFits} ${alternative.layoutApproach} ${alternative.navigationApproach}`,
    );
    if (anchors.size > 0 && !overlap(anchors, grounding)) {
      issues.push(`designAlternatives[${index}] is not grounded in this project.`);
    }
  }
  const recommendedAlternative = design.designAlternatives.find(
    (alternative) => alternative.recommended,
  );
  if (
    recommendedAlternative !== undefined &&
    (normalizeText(recommendedAlternative.name) !==
      normalizeText(design.designDirection.visualPersonality) ||
      normalizeText(recommendedAlternative.visualPersonality) !==
        normalizeText(design.designDirection.visualPersonality))
  ) {
    issues.push(
      "designAlternatives recommended direction does not match the approved designDirection.",
    );
  }
  for (const [index, observation] of design.foundryInsights.observations.entries()) {
    const observationTokens = tokens(observation);
    if (wordCount(observation) < 8) {
      issues.push(`foundryInsights.observations[${index}] is too vague.`);
    } else if (anchors.size > 0 && !overlap(anchors, observationTokens)) {
      issues.push(`foundryInsights.observations[${index}] is not grounded in this project.`);
    }
  }
  const recommendationTitles = new Set();
  for (const [index, recommendation] of design.recommendations.entries()) {
    const title = normalizeText(recommendation.title);
    if (recommendationTitles.has(title)) issues.push(`recommendations[${index}] duplicates another recommendation.`);
    recommendationTitles.add(title);
    if (wordCount(recommendation.specificValue) < 6 || wordCount(recommendation.whyThisProjectNeedsIt) < 8) issues.push(`recommendations[${index}] lacks a specific rationale.`);
    const rationaleTokens = tokens(`${recommendation.specificValue} ${recommendation.whyThisProjectNeedsIt}`);
    if (anchors.size > 0 && !overlap(anchors, rationaleTokens)) issues.push(`recommendations[${index}] is not grounded in this project.`);
  }
  for (const [index, decision] of design.decisions.entries()) {
    if (TECHNICAL_QUESTION_TERMS.test(decision.customerFriendlyQuestion)) issues.push(`decisions[${index}] asks a technical question.`);
    if (!decision.alternatives.includes(decision.recommendation)) issues.push(`decisions[${index}] recommendation is not one of its alternatives.`);
    if (decision.alternatives.some((option) => wordCount(option) < 2)) {
      issues.push(`decisions[${index}] contains a vague option.`);
    }
    if (decision.consequenceOfEachChoice.some((item) => wordCount(item) < 5)) {
      issues.push(`decisions[${index}] contains a vague consequence.`);
    }
  }
  for (const [label, value] of [["projectIntent", intent.confidence], ["foundryInsights", design.foundryInsights.confidence]]) {
    if (value.score >= 0.8 && CERTAINTY_TERMS.test(value.rationale) && UNCERTAINTY_TERMS.test(value.rationale)) issues.push(`${label}.confidence is contradictory.`);
  }
  const essential = design.productProposal.essentialCapabilities;
  for (const [index, requirement] of essential.entries()) {
    const requirementTokens = tokens(requirement);
    const covered = design.verificationPlan.some((item) => overlap(requirementTokens, tokens(`${item.observableOutcome} ${item.sourceRequirement}`)));
    if (requirementTokens.size > 0 && !covered) issues.push(`productProposal.essentialCapabilities[${index}] has no traceable verification outcome.`);
  }
  if (issues.length > 0) {
    throw new ProjectDesignQualityError(`Project design quality validation failed: ${issues.join(" ")}`, issues);
  }
  return design;
}
