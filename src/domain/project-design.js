import {
  ProjectDesignQualityError,
  ProjectDesignValidationError,
} from "./errors.js";
import {
  CREATIVE_DNA_SCHEMA,
  deriveCreativeDNASet,
  normalizeCreativeDNA,
} from "./creative-direction.js";
import { assessCreativeDirectionSet } from "./creative-direction-quality.js";

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

const VISUAL_ENUMS = Object.freeze({
  layoutType: ["sidebar", "top-nav", "split-screen", "editorial", "dashboard", "guided-flow", "canvas", "documentation"],
  navigationType: ["sidebar", "top-bar", "tabs", "stepper", "command", "inline", "tree", "none"],
  typographyCategory: ["humanist", "editorial", "geometric", "technical", "compact", "expressive"],
  density: ["spacious", "balanced", "dense"],
  spacingProfile: ["open", "rhythmic", "compact"],
  surfaceTreatment: ["flat", "bordered", "elevated", "layered", "immersive"],
  contentEmphasis: ["action", "status", "story", "data", "guidance", "reference"],
  imageStrategy: ["none", "ambient", "hero", "gallery", "supporting"],
  interactionModel: ["direct", "guided", "exploratory", "command-driven", "review-and-confirm"],
  buttonTreatment: ["solid", "outline", "quiet", "pill", "compact"],
});

export const DESIGN_VISUAL_SYSTEM_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...Object.keys(VISUAL_ENUMS), "colorRoles", "sampleLabels"],
  properties: Object.freeze({
    ...Object.fromEntries(Object.entries(VISUAL_ENUMS).map(([key, values]) => [key, { type: "string", enum: values }])),
    colorRoles: {
      type: "object",
      additionalProperties: false,
      required: ["background", "surface", "primary", "accent", "text"],
      properties: Object.fromEntries(["background", "surface", "primary", "accent", "text"].map((key) => [key, { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" }])),
    },
    sampleLabels: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", minLength: 1 } },
  }),
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
          visualSystem: DESIGN_VISUAL_SYSTEM_SCHEMA,
          creativeDNA: CREATIVE_DNA_SCHEMA,
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

// A request for "sign up" asked for an account to exist afterwards. Foundry
// answered with five capabilities — see the form, the form validates, the
// button stays usable, tests cover states, the build succeeds — verified all
// of them honestly, and reported success on a page where nobody can register.
// Its own journeys said "Submit the registration form"; nothing said what
// submitting does.
//
// An action a person performs is only delivered when its effect is. A project
// whose journeys contain actions must promise at least one completed outcome,
// not only that a form is displayed and validated.
// Deliberately narrow. A wrong rejection blocks a legitimate project, while a
// miss only leaves today's behaviour, so this lists verbs that are
// unambiguously transactional and cannot be read as nouns. "Routine updates"
// in a read-only policy viewer matched an earlier, broader list and wrongly
// rejected it.
// Deliberately narrow, on two grounds. A wrong rejection blocks a legitimate
// project while a miss only leaves today's behaviour, so every verb here must
// be unambiguously transactional and unreadable as a noun — "routine updates"
// in a read-only policy viewer matched a broader list and wrongly rejected it.
//
// Signing in is excluded on principle: it is access, not creation. "A customer
// can sign in, identify the newest activity, and understand its status" is a
// product for reading, and the sign-in is plumbing on the way there. Signing
// up is different — it is the account coming into existence, which is exactly
// what a form that only renders and validates fails to do.
const ACTION_JOURNEY =
  /\b(?:signs? ?up|signing ?up|sign-?up|registers?|registering|registration|submits?|submitting|submission|checks? out|checkout|places? an order|creates? an account)\b/iu;

// Wording that asserts the action finished and left something behind. Asking
// additionally that a capability contain no presentational verb was wrong and
// rejected a working tracker: "an item is added and it appears in the register"
// is a completed outcome that happens to describe what is then visible.
const COMPLETED_OUTCOME =
  /\b(?:created|registered|saved|stored|recorded|added|removed|deleted|persisted|creates?|registers?|saves?|stores?|records?|persists?|able to sign ?in|reach(?:es)? the|arriv(?:es?|ing) at|receiv(?:es?|ing) (?:a )?confirmation|appears? in|remains? (?:available )?after|survives? a refresh|is signed ?in|can then)\b/iu;

export function unfinishedActionIssues(design) {
  // Read the action from what the customer asked for, not from every journey
  // line. Signing in appears in the journeys of a read-only policy viewer as
  // plumbing on the way to reading a document; the product there is the
  // reading. Requiring a completion promise from that is wrong, and did
  // wrongly reject one. The outcome, goal and definition of success are where
  // the customer said what the product is.
  const asked = [
    design?.projectIntent?.customerOutcome,
    design?.projectIntent?.primaryGoal,
    design?.projectIntent?.successDefinition,
  ]
    .map((entry) => String(entry?.value ?? entry ?? ""))
    .filter((entry) => entry !== "");
  const actions = asked.filter((entry) => ACTION_JOURNEY.test(entry));
  if (actions.length === 0) return [];

  const capabilities = (design?.productProposal?.essentialCapabilities ?? []).map(
    (capability) => String(capability?.value ?? capability ?? ""),
  );
  const promisesCompletion = capabilities.some((capability) =>
    COMPLETED_OUTCOME.test(capability),
  );
  if (promisesCompletion) return [];
  return [
    `The customer asked for an action to be performed — ${actions.slice(0, 2).map((entry) => `"${entry}"`).join(", ")} — but every essential capability only describes what is displayed or validated. Add a capability stating what the action produces: the record it creates, the state the person reaches, or what remains true afterwards. A form that renders and validates but completes nothing is not the requested product.`,
  ];
}

export function normalizeDesignDirection(design) {
  exact(design, ["visualPersonality", "tone", "layoutStrategy", "informationDensity", "navigationApproach", "responsivePriority", "accessibilityNeeds", "contentStrategy", "interactionStyle", "rationale"], "designDirection");
  return freeze({
    ...Object.fromEntries(Object.entries(design).filter(([key]) => key !== "accessibilityNeeds").map(([key, value]) => [key, text(value, `designDirection.${key}`)])),
    accessibilityNeeds: list(design.accessibilityNeeds, "designDirection.accessibilityNeeds", { required: true }),
  });
}

export function normalizeDesignAlternativeList(value = [], { family } = {}) {
  if (!Array.isArray(value)) fail("designAlternatives must be an array.");
  if (value.length < 3 || value.length > 7) {
    fail("designAlternatives must contain three to seven meaningful directions.");
  }
  const derivedDNA = deriveCreativeDNASet(value, { family });
  const normalized = value.map((entry, index) => {
    const label = `designAlternatives[${index}]`;
    const alternativeKeys = [
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
      ];
    const optionalKeys = ["visualSystem", "creativeDNA"].filter((key) =>
      Object.hasOwn(entry, key),
    );
    exact(entry, [...alternativeKeys, ...optionalKeys], label);
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
    const visualSystem = normalizeVisualSystem(entry.visualSystem, entry, index, label);
    const creativeDNA = entry.creativeDNA === undefined
      ? derivedDNA[index]
      : normalizeCreativeDNA(entry.creativeDNA, `${label}.creativeDNA`);
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
      visualSystem,
      creativeDNA,
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

/**
 * Curated fallback palettes, used only when the model does not author its own.
 * Each is a deliberate pairing with real figure/ground contrast — a gallery
 * white, a darkroom, a warm paper, a cool archive, an ink-and-ochre press.
 */
const DESIGNED_PALETTES = Object.freeze([
  Object.freeze({ background: "#f6f4ef", surface: "#ffffff", primary: "#1c1b19", accent: "#b4552d", text: "#171614" }),
  Object.freeze({ background: "#111214", surface: "#1a1c1f", primary: "#f4f2ed", accent: "#d8a657", text: "#f2f0eb" }),
  Object.freeze({ background: "#fbf9f4", surface: "#ffffff", primary: "#243b34", accent: "#c2603c", text: "#1a201d" }),
  Object.freeze({ background: "#f2f4f7", surface: "#ffffff", primary: "#1e2a3a", accent: "#3d6fb4", text: "#141b24" }),
  Object.freeze({ background: "#f7f3ec", surface: "#fffdf9", primary: "#2b2118", accent: "#9c6b3f", text: "#221a13" }),
  Object.freeze({ background: "#0f1512", surface: "#18201c", primary: "#eef2ef", accent: "#7fbf9a", text: "#e8ede9" }),
  Object.freeze({ background: "#fdf7f5", surface: "#ffffff", primary: "#3a1f26", accent: "#a8354f", text: "#241318" }),
]);

function hashSeed(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function derivedVisualSystem(entry, index) {
  const seed = hashSeed(`${entry.name}|${entry.layoutApproach}|${entry.visualPersonality}|${entry.navigationApproach}`);
  const pick = (key, offset = 0) => VISUAL_ENUMS[key][(seed + index + offset) % VISUAL_ENUMS[key].length];
  const hue = (seed + index * 71) % 360;
  const hex = (h, saturation, lightness) => {
    const a = saturation * Math.min(lightness, 1 - lightness);
    const channel = (n) => {
      const k = (n + h / 30) % 12;
      const color = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      return Math.round(255 * color).toString(16).padStart(2, "0");
    };
    return `#${channel(0)}${channel(8)}${channel(4)}`;
  };
  return {
    layoutType: VISUAL_ENUMS.layoutType[index % VISUAL_ENUMS.layoutType.length],
    navigationType: VISUAL_ENUMS.navigationType[(index * 2 + 1) % VISUAL_ENUMS.navigationType.length],
    typographyCategory: pick("typographyCategory", index * 2),
    density: VISUAL_ENUMS.density[index % VISUAL_ENUMS.density.length],
    spacingProfile: VISUAL_ENUMS.spacingProfile[(index + 1) % VISUAL_ENUMS.spacingProfile.length],
    surfaceTreatment: pick("surfaceTreatment", index * 3),
    contentEmphasis: pick("contentEmphasis", index * 4),
    imageStrategy: pick("imageStrategy", index),
    interactionModel: pick("interactionModel", index * 2),
    buttonTreatment: pick("buttonTreatment", index * 3),
    // Palettes are designed, not hashed.
    //
    // Deriving a hue from a hash of the direction name produced washed-out,
    // frequently-colliding colour — three "different" directions all rendering
    // the same green. Colour is the first thing a customer judges, so the
    // fallback now draws from curated palettes with real contrast and a real
    // point of view, de-collided across the set by index.
    colorRoles: DESIGNED_PALETTES[index % DESIGNED_PALETTES.length],
    sampleLabels: [
      String(entry.name).slice(0, 48),
      `Tone: ${String(entry.visualPersonality).slice(0, 40)}`,
      `Layout: ${String(entry.layoutApproach).slice(0, 38)}`,
    ],
  };
}

function normalizeVisualSystem(value, entry, index, label) {
  const candidate = value ?? derivedVisualSystem(entry, index);
  exact(candidate, [...Object.keys(VISUAL_ENUMS), "colorRoles", "sampleLabels"], `${label}.visualSystem`);
  for (const [key, values] of Object.entries(VISUAL_ENUMS)) {
    if (!values.includes(candidate[key])) fail(`${label}.visualSystem.${key} is unsupported.`);
  }
  exact(candidate.colorRoles, ["background", "surface", "primary", "accent", "text"], `${label}.visualSystem.colorRoles`);
  const colorRoles = Object.fromEntries(Object.entries(candidate.colorRoles).map(([key, color]) => {
    if (typeof color !== "string" || !/^#[0-9a-f]{6}$/iu.test(color)) fail(`${label}.visualSystem.colorRoles.${key} must be a six-digit hex color.`);
    return [key, color.toLowerCase()];
  }));
  return {
    ...Object.fromEntries(Object.keys(VISUAL_ENUMS).map((key) => [key, candidate[key]])),
    colorRoles,
    sampleLabels: list(candidate.sampleLabels, `${label}.visualSystem.sampleLabels`, { required: true }).slice(0, 5),
  };
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
  const normalized = value.map((entry, index) => {
    const label = `verificationPlan[${index}]`;
    exact(entry, ["observableOutcome", "acceptanceMethod", "evidenceRequired", "sourceRequirement", "origin", "dependencyIndexes"], label);
    if (!["customer-stated", "foundry-derived"].includes(entry.origin)) fail(`${label}.origin is invalid.`);
    if (!ACCEPTANCE_METHODS.has(entry.acceptanceMethod)) fail(`${label}.acceptanceMethod is unsupported.`);
    if (!Array.isArray(entry.dependencyIndexes) || entry.dependencyIndexes.some((dependency) => !Number.isSafeInteger(dependency) || dependency < 1)) fail(`${label}.dependencyIndexes must contain positive integers.`);
    const dependencyIndexes = [...new Set(entry.dependencyIndexes)];
    if (dependencyIndexes.some((dependency) => dependency > value.length)) {
      fail(`${label}.dependencyIndexes references a missing verification item.`);
    }
    if (dependencyIndexes.includes(index + 1)) {
      fail(`${label}.dependencyIndexes cannot reference itself.`);
    }
    return {
      observableOutcome: text(entry.observableOutcome, `${label}.observableOutcome`),
      acceptanceMethod: text(entry.acceptanceMethod, `${label}.acceptanceMethod`),
      evidenceRequired: list(entry.evidenceRequired, `${label}.evidenceRequired`, { required: true }),
      sourceRequirement: text(entry.sourceRequirement, `${label}.sourceRequirement`),
      origin: entry.origin,
      dependencyIndexes,
    };
  });
  const visiting = new Set();
  const visited = new Set();
  function visit(index) {
    if (visiting.has(index)) {
      fail("verificationPlan dependencyIndexes contain a cycle.");
    }
    if (visited.has(index)) return;
    visiting.add(index);
    for (const dependency of normalized[index].dependencyIndexes) {
      visit(dependency - 1);
    }
    visiting.delete(index);
    visited.add(index);
  }
  for (const index of normalized.keys()) visit(index);
  return freeze(normalized);
}

export function normalizeProjectDesign(input, { designFamily } = {}) {
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
    designAlternatives: normalizeDesignAlternativeList(input.designAlternatives ?? [], { family: designFamily }),
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

function tokenSimilarity(leftValue, rightValue) {
  const left = tokens(leftValue);
  const right = tokens(rightValue);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / new Set([...left, ...right]).size;
}

function wordCount(value) {
  return normalizeText(value).split(" ").filter(Boolean).length;
}

export function validateProjectDesignQuality(
  input,
  { originalRequest = "", designFamily = "application" } = {},
) {
  const design = normalizeProjectDesign(input, { designFamily });
  const issues = [];
  const intent = design.projectIntent;
  for (const [field, value] of [["customerOutcome", intent.customerOutcome], ["businessContext", intent.businessContext], ["primaryGoal", intent.primaryGoal], ["successDefinition", intent.successDefinition]]) {
    if (wordCount(value) < 6) issues.push(`projectIntent.${field} is too vague.`);
  }
  const anchors = tokens([originalRequest, intent.customerOutcome, intent.businessContext, intent.primaryGoal, ...intent.intendedUsers, ...design.userExperiencePlan.primaryJourneys].join(" "));
  if (wordCount(design.designDirection.rationale) < 8) {
    issues.push("designDirection.rationale is too vague.");
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
  }
  // The production Creative Direction Quality Authority replaces the previous
  // visual-enum counting heuristic. It compares every differentiation axis,
  // rationale language, naming patterns and project relevance, and it reports a
  // regeneration directive rather than only a pass/fail bit.
  const creativeAssessment = assessCreativeDirectionSet(
    design.designAlternatives.map((alternative, index) => ({
      ...alternative,
      id: `designAlternatives[${index}]`,
    })),
    { family: designFamily },
  );
  const retryStrategy = creativeAssessment.regenerationDirective
    ? `creative-direction-retry-strategy: ${creativeAssessment.regenerationDirective}`
    : null;
  for (const issue of creativeAssessment.issues) {
    issues.push(`${issue.code}: ${issue.message}`);
  }
  if (
    creativeAssessment.issues.length === 0 &&
    !creativeAssessment.publishable
  ) {
    issues.push(
      `designAlternatives are only ${creativeAssessment.distinctnessScore}% distinct across composition, navigation, typography, color, imagery, interaction, responsive, density, surface and motion.`,
    );
  }
  const recommendedAlternative = design.designAlternatives.find(
    (alternative) => alternative.recommended,
  );
  if (
    recommendedAlternative !== undefined &&
    normalizeText(recommendedAlternative.visualPersonality) !==
      normalizeText(design.designDirection.visualPersonality)
  ) {
    issues.push(
      "designAlternatives recommended direction does not match the approved designDirection.",
    );
  }
  for (const [index, observation] of design.foundryInsights.observations.entries()) {
    if (wordCount(observation) < 8) {
      issues.push(`foundryInsights.observations[${index}] is too vague.`);
    }
  }
  const observationSetTokens = tokens(
    design.foundryInsights.observations.join(" "),
  );
  if (anchors.size > 0 && !overlap(anchors, observationSetTokens)) {
    issues.push(
      `foundryInsights.observations are not grounded in this project: ${JSON.stringify(design.foundryInsights.observations)}.`,
    );
  }
  const recommendationTitles = new Set();
  for (const [index, recommendation] of design.recommendations.entries()) {
    const title = normalizeText(recommendation.title);
    if (recommendationTitles.has(title)) issues.push(`recommendations[${index}] duplicates another recommendation.`);
    recommendationTitles.add(title);
    if (wordCount(recommendation.specificValue) < 6 || wordCount(recommendation.whyThisProjectNeedsIt) < 8) issues.push(`recommendations[${index}] lacks a specific rationale.`);
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
    for (let left = 0; left < decision.alternatives.length; left += 1) {
      for (let right = left + 1; right < decision.alternatives.length; right += 1) {
        if (tokenSimilarity(decision.alternatives[left], decision.alternatives[right]) >= 0.72) {
          issues.push(
            `decisions[${index}] alternatives ${left + 1} and ${right + 1} describe the same practical choice.`,
          );
        }
      }
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
  issues.push(...unfinishedActionIssues(design));
  if (issues.length > 0) {
    // The retry strategy leads: the correction loop truncates this message
    // before feeding it back, and a changed strategy matters more than the
    // tail of the defect list.
    const reported = retryStrategy === null ? issues : [retryStrategy, ...issues];
    throw new ProjectDesignQualityError(
      `Project design quality validation failed: ${reported.join(" ")}`,
      reported,
    );
  }
  return design;
}
