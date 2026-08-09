import { ProjectProfileValidationError } from "./errors.js";
import { normalizeCreativeDNA } from "./creative-direction.js";
import { OBSERVATION_KINDS } from "./observation-evidence.js";
import { normalizeAcceptanceCondition } from "./verification.js";

export const ProjectFamily = Object.freeze({
  WEB_APPLICATION: "web-application",
  MARKETING_WEBSITE: "marketing-website",
  API_SERVICE: "api-service",
  DESKTOP_APPLICATION: "desktop-application",
  MOBILE_APPLICATION: "mobile-application",
  GAME: "game",
  AUTOMATION: "automation",
  OTHER: "other",
});

export const PROJECT_FAMILIES = Object.freeze(Object.values(ProjectFamily));

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const FAMILIES = new Set(PROJECT_FAMILIES);
const OBLIGATION_ORIGINS = new Set([
  "customer-stated",
  "foundry-derived",
]);
const EVIDENCE_KINDS = new Set(OBSERVATION_KINDS);
const PROFILE_KEYS = Object.freeze([
  "architectureDecisions",
  "capabilities",
  "constraints",
  "customerContent",
  "contextualSuggestions",
  "dataConcepts",
  "designDirection",
  "designAlternatives",
  "family",
  "includedDefaults",
  "missionId",
  "name",
  "observations",
  "openQuestions",
  "outcomes",
  "platform",
  "primaryActors",
  "primaryJourneys",
  "profileVersion",
  "requirementContractVersion",
  "runtimeAdapterId",
  "selectedStack",
  "sourceRequirementIds",
  "summary",
  "assumptions",
  "verificationPlan",
]);

const CUSTOMER_CONTENT_KINDS = new Set([
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

const CUSTOMER_CONTENT_SOURCES = new Set([
  "customer-request",
  "customer-answer",
]);

function fail(message) {
  throw new ProjectProfileValidationError(message);
}

function plainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(`${label} must be a plain object.`);
  }
}

function exactKeys(value, expected, label) {
  plainObject(value, label);
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  if (
    actual.length !== keys.length ||
    actual.some((key, index) => key !== keys[index])
  ) {
    fail(`${label} must contain exactly: ${keys.join(", ")}.`);
  }
}

function keysWithOptional(value, required, optional, label) {
  plainObject(value, label);
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

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail(`${label} is malformed.`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

const PLACEHOLDER_TEXT = new Set([
  "placeholder",
  "tbd",
  "todo",
  "to be determined",
  "unknown",
  "n/a",
  "not applicable",
]);

function meaningfulText(value, label) {
  const normalized = text(value, label);
  const comparable = normalized
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (
    !/[\p{L}\p{N}]/u.test(normalized) ||
    PLACEHOLDER_TEXT.has(comparable)
  ) {
    fail(`${label} must describe a real project-specific value.`);
  }
  return normalized;
}

function uniqueTextList(value, label, { allowEmpty = true } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.trim() === "")
  ) {
    fail(`${label} must be ${allowEmpty ? "a" : "a non-empty"} string array.`);
  }
  const normalized = value.map((entry) => entry.trim());
  if (new Set(normalized).size !== normalized.length) {
    fail(`${label} contains duplicate values.`);
  }
  return normalized;
}

function uniqueMeaningfulTextList(
  value,
  label,
  { allowEmpty = true } = {},
) {
  const normalized = uniqueTextList(value, label, { allowEmpty });
  return normalized.map((entry, index) =>
    meaningfulText(entry, `${label}[${index}]`),
  );
}

// Sample labels are the words a mock puts on a control, and they follow the
// product rather than prose. A calculator's most meaningful labels are "=",
// "+", "%" and "C": no letter or digit between them, so meaningfulText called
// them placeholders and refused the design. Five understanding attempts died
// that way on a one-word request -- three on the duplicate rule, two on this --
// and the project sat in CLARIFYING with no profile and a continue button that
// could do nothing.
//
// So display labels are judged on what actually matters for them: present, not
// a placeholder word, and short enough to fit a control. Repeats are allowed --
// two buttons legitimately read "View" -- and symbols are labels, not noise.
function displayLabelList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${label} must be a non-empty array.`);
  }
  return value.map((entry, index) => {
    const at = `${label}[${index}]`;
    const normalized = text(entry, at);
    const comparable = normalized
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (PLACEHOLDER_TEXT.has(comparable)) {
      fail(`${at} must describe a real project-specific value.`);
    }
    return normalized;
  });
}

function normalizeQuestion(question, index) {
  keysWithOptional(
    question,
    ["answerOptions", "questionId", "prompt", "reason"],
    [
      "recommendation",
      "recommendationReason",
      "consequences",
      "architectureImpact",
      "scopeImpact",
    ],
    `openQuestions[${index}]`,
  );
  const normalized = {
    questionId: identifier(
      question.questionId,
      `openQuestions[${index}].questionId`,
    ),
    prompt: meaningfulText(
      question.prompt,
      `openQuestions[${index}].prompt`,
    ),
    reason: meaningfulText(
      question.reason,
      `openQuestions[${index}].reason`,
    ),
    answerOptions: uniqueMeaningfulTextList(
      question.answerOptions,
      `openQuestions[${index}].answerOptions`,
      { allowEmpty: false },
    ),
  };
  for (const field of [
    "recommendation",
    "recommendationReason",
    "architectureImpact",
    "scopeImpact",
  ]) {
    if (question[field] !== undefined) {
      normalized[field] = meaningfulText(
        question[field],
        `openQuestions[${index}].${field}`,
      );
    }
  }
  if (question.consequences !== undefined) {
    normalized.consequences = uniqueMeaningfulTextList(
      question.consequences,
      `openQuestions[${index}].consequences`,
      { allowEmpty: false },
    );
    if (normalized.consequences.length !== normalized.answerOptions.length) {
      fail(
        `openQuestions[${index}].consequences must match answerOptions length.`,
      );
    }
  }
  return normalized;
}

function normalizeSuggestion(suggestion, index) {
  keysWithOptional(
    suggestion,
    ["label", "rationale", "suggestionId"],
    [
      "confidence",
      "impact",
      "requiredDependencies",
      "selectedByDefault",
      "value",
    ],
    `contextualSuggestions[${index}]`,
  );
  const normalized = {
    suggestionId: identifier(
      suggestion.suggestionId,
      `contextualSuggestions[${index}].suggestionId`,
    ),
    label: meaningfulText(
      suggestion.label,
      `contextualSuggestions[${index}].label`,
    ),
    rationale: meaningfulText(
      suggestion.rationale,
      `contextualSuggestions[${index}].rationale`,
    ),
  };
  if (suggestion.value !== undefined) {
    normalized.value = meaningfulText(
      suggestion.value,
      `contextualSuggestions[${index}].value`,
    );
  }
  if (suggestion.impact !== undefined) {
    normalized.impact = meaningfulText(
      suggestion.impact,
      `contextualSuggestions[${index}].impact`,
    );
  }
  if (suggestion.selectedByDefault !== undefined) {
    if (typeof suggestion.selectedByDefault !== "boolean") {
      fail(`contextualSuggestions[${index}].selectedByDefault must be a boolean.`);
    }
    normalized.selectedByDefault = suggestion.selectedByDefault;
  }
  if (suggestion.confidence !== undefined) {
    if (
      typeof suggestion.confidence !== "number" ||
      !Number.isFinite(suggestion.confidence) ||
      suggestion.confidence < 0 ||
      suggestion.confidence > 1
    ) {
      fail(`contextualSuggestions[${index}].confidence must be between 0 and 1.`);
    }
    normalized.confidence = suggestion.confidence;
  }
  if (suggestion.requiredDependencies !== undefined) {
    normalized.requiredDependencies = uniqueMeaningfulTextList(
      suggestion.requiredDependencies,
      `contextualSuggestions[${index}].requiredDependencies`,
    );
  }
  return normalized;
}

function normalizeDesignAlternative(alternative, index) {
  keysWithOptional(
    alternative,
    ["approach", "rationale", "recommended"],
    [
      "whyItFits",
      "layoutApproach",
      "visualPersonality",
      "informationDensity",
      "navigationApproach",
      "mobileBehavior",
      "tradeoff",
      "confidence",
      "preview",
      "visualSystem",
      "creativeDNA",
      "tradeoffs",
    ],
    `designAlternatives[${index}]`,
  );
  if (typeof alternative.recommended !== "boolean") {
    fail(`designAlternatives[${index}].recommended must be a boolean.`);
  }
  const normalized = {
    approach: meaningfulText(
      alternative.approach,
      `designAlternatives[${index}].approach`,
    ),
    rationale: meaningfulText(
      alternative.rationale,
      `designAlternatives[${index}].rationale`,
    ),
    recommended: alternative.recommended,
  };
  if (alternative.tradeoffs !== undefined) {
    normalized.tradeoffs = uniqueMeaningfulTextList(
      alternative.tradeoffs,
      `designAlternatives[${index}].tradeoffs`,
      { allowEmpty: false },
    );
  }
  for (const field of [
    "whyItFits",
    "layoutApproach",
    "visualPersonality",
    "informationDensity",
    "navigationApproach",
    "mobileBehavior",
    "tradeoff",
  ]) {
    if (alternative[field] !== undefined) {
      normalized[field] = meaningfulText(
        alternative[field],
        `designAlternatives[${index}].${field}`,
      );
    }
  }
  if (alternative.confidence !== undefined) {
    exactKeys(
      alternative.confidence,
      ["rationale", "score"],
      `designAlternatives[${index}].confidence`,
    );
    if (
      typeof alternative.confidence.score !== "number" ||
      !Number.isFinite(alternative.confidence.score) ||
      alternative.confidence.score < 0 ||
      alternative.confidence.score > 1
    ) {
      fail(
        `designAlternatives[${index}].confidence.score must be between 0 and 1.`,
      );
    }
    normalized.confidence = {
      score: alternative.confidence.score,
      rationale: meaningfulText(
        alternative.confidence.rationale,
        `designAlternatives[${index}].confidence.rationale`,
      ),
    };
  }
  if (alternative.preview !== undefined) {
    exactKeys(
      alternative.preview,
      ["colorMood", "hierarchy", "spacingDensity", "typographyCharacter"],
      `designAlternatives[${index}].preview`,
    );
    normalized.preview = Object.fromEntries(
      Object.entries(alternative.preview).map(([field, value]) => [
        field,
        meaningfulText(
          value,
          `designAlternatives[${index}].preview.${field}`,
        ),
      ]),
    );
  }
  if (alternative.visualSystem !== undefined) {
    const fields = [
      "layoutType", "navigationType", "typographyCategory", "density",
      "spacingProfile", "surfaceTreatment", "contentEmphasis", "imageStrategy",
      "interactionModel", "buttonTreatment", "colorRoles", "sampleLabels",
    ];
    exactKeys(alternative.visualSystem, fields, `designAlternatives[${index}].visualSystem`);
    exactKeys(
      alternative.visualSystem.colorRoles,
      ["background", "surface", "primary", "accent", "text"],
      `designAlternatives[${index}].visualSystem.colorRoles`,
    );
    normalized.visualSystem = {
      ...Object.fromEntries(fields
        .filter((field) => !["colorRoles", "sampleLabels"].includes(field))
        .map((field) => [field, meaningfulText(alternative.visualSystem[field], `designAlternatives[${index}].visualSystem.${field}`)])),
      colorRoles: Object.fromEntries(
        Object.entries(alternative.visualSystem.colorRoles).map(([field, value]) => {
          if (typeof value !== "string" || !/^#[0-9a-f]{6}$/iu.test(value)) {
            fail(`designAlternatives[${index}].visualSystem.colorRoles.${field} must be a hex color.`);
          }
          return [field, value.toLowerCase()];
        }),
      ),
      sampleLabels: displayLabelList(
        alternative.visualSystem.sampleLabels,
        `designAlternatives[${index}].visualSystem.sampleLabels`,
      ),
    };
  }
  // Creative DNA is the structural design contract for this direction. It must
  // survive the profile boundary intact or generation receives a name and a
  // palette and nothing that makes the direction recognizable.
  if (alternative.creativeDNA !== undefined) {
    normalized.creativeDNA = normalizeCreativeDNA(
      alternative.creativeDNA,
      `designAlternatives[${index}].creativeDNA`,
    );
  }
  return normalized;
}

function normalizeDesignDirection(direction) {
  exactKeys(
    direction,
    [
      "accessibilityConsiderations",
      "layoutApproach",
      "mobilePriority",
      "reason",
      "recommendedStyle",
      "tone",
    ],
    "designDirection",
  );
  return {
    recommendedStyle: meaningfulText(
      direction.recommendedStyle,
      "designDirection.recommendedStyle",
    ),
    reason: meaningfulText(direction.reason, "designDirection.reason"),
    layoutApproach: meaningfulText(
      direction.layoutApproach,
      "designDirection.layoutApproach",
    ),
    tone: meaningfulText(direction.tone, "designDirection.tone"),
    mobilePriority: meaningfulText(
      direction.mobilePriority,
      "designDirection.mobilePriority",
    ),
    accessibilityConsiderations: uniqueMeaningfulTextList(
      direction.accessibilityConsiderations,
      "designDirection.accessibilityConsiderations",
      { allowEmpty: false },
    ),
  };
}

function normalizeCustomerContent(content) {
  exactKeys(
    content,
    ["missingBeforeLaunch", "supplied"],
    "customerContent",
  );
  if (!Array.isArray(content.supplied)) {
    fail("customerContent.supplied must be an array.");
  }
  const supplied = content.supplied.map((item, index) => {
    exactKeys(
      item,
      ["kind", "source", "value"],
      `customerContent.supplied[${index}]`,
    );
    if (!CUSTOMER_CONTENT_KINDS.has(item.kind)) {
      fail(`customerContent.supplied[${index}].kind is invalid.`);
    }
    if (!CUSTOMER_CONTENT_SOURCES.has(item.source)) {
      fail(`customerContent.supplied[${index}].source is invalid.`);
    }
    return {
      kind: item.kind,
      value: meaningfulText(
        item.value,
        `customerContent.supplied[${index}].value`,
      ),
      source: item.source,
    };
  });
  const identities = supplied.map(
    (item) => `${item.kind}\u0000${item.value.toLowerCase()}`,
  );
  if (new Set(identities).size !== identities.length) {
    fail("customerContent.supplied contains duplicate values.");
  }
  return {
    supplied,
    missingBeforeLaunch: uniqueMeaningfulTextList(
      content.missingBeforeLaunch,
      "customerContent.missingBeforeLaunch",
    ),
  };
}

function normalizeStack(stack) {
  exactKeys(stack, ["stackId", "version"], "selectedStack");
  return {
    stackId: identifier(stack.stackId, "selectedStack.stackId"),
    version: text(stack.version, "selectedStack.version"),
  };
}

function normalizeVerificationPlan(plan) {
  exactKeys(plan, ["checks", "planId"], "verificationPlan");
  if (!Array.isArray(plan.checks) || plan.checks.length === 0) {
    fail("verificationPlan.checks must be a non-empty array.");
  }
  const checks = plan.checks.map((check, index) => {
    exactKeys(
      check,
      [
        "acceptanceCondition",
        "checkId",
        "dependencyCheckIds",
        "evidenceKinds",
        "label",
        "origin",
      ],
      `verificationPlan.checks[${index}]`,
    );
    plainObject(
      check.acceptanceCondition,
      `verificationPlan.checks[${index}].acceptanceCondition`,
    );
    const evidenceKinds = uniqueTextList(
      check.evidenceKinds,
      `verificationPlan.checks[${index}].evidenceKinds`,
      { allowEmpty: false },
    );
    if (evidenceKinds.some((kind) => !EVIDENCE_KINDS.has(kind))) {
      fail(`verificationPlan.checks[${index}] has an unknown evidence kind.`);
    }
    return {
      checkId: identifier(
        check.checkId,
        `verificationPlan.checks[${index}].checkId`,
      ),
      label: meaningfulText(
        check.label,
        `verificationPlan.checks[${index}].label`,
      ),
      origin: check.origin,
      acceptanceCondition: normalizeAcceptanceCondition(
        check.acceptanceCondition,
      ),
      evidenceKinds,
      dependencyCheckIds: uniqueTextList(
        check.dependencyCheckIds,
        `verificationPlan.checks[${index}].dependencyCheckIds`,
      ).map((id, dependencyIndex) =>
        identifier(
          id,
          `verificationPlan.checks[${index}].dependencyCheckIds[${dependencyIndex}]`,
        ),
      ),
    };
  });
  if (checks.some((check) => !OBLIGATION_ORIGINS.has(check.origin))) {
    fail("verificationPlan check origin is invalid.");
  }
  const ids = checks.map((check) => check.checkId);
  if (new Set(ids).size !== ids.length) {
    fail("verificationPlan contains duplicate check IDs.");
  }
  const idSet = new Set(ids);
  if (
    checks.some((check) =>
      check.dependencyCheckIds.some((dependency) => !idSet.has(dependency)),
    )
  ) {
    fail("verificationPlan check dependency does not exist.");
  }
  return {
    planId: identifier(plan.planId, "verificationPlan.planId"),
    checks,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function normalizeProjectProfile(rawInput) {
  const input = rawInput;
  exactKeys(input, PROFILE_KEYS, "ProjectProfile");
  if (!Number.isSafeInteger(input.profileVersion) || input.profileVersion < 1) {
    fail("profileVersion must be a positive integer.");
  }
  if (!FAMILIES.has(input.family)) {
    fail(`Unsupported project family: ${String(input.family)}.`);
  }
  if (
    !Number.isSafeInteger(input.requirementContractVersion) ||
    input.requirementContractVersion < 1
  ) {
    fail("requirementContractVersion must be a positive integer.");
  }

  const openQuestions = input.openQuestions.map(normalizeQuestion);
  const questionIds = openQuestions.map((question) => question.questionId);
  if (new Set(questionIds).size !== questionIds.length) {
    fail("openQuestions contains duplicate question IDs.");
  }
  const contextualSuggestions =
    input.contextualSuggestions.map(normalizeSuggestion);
  const suggestionIds = contextualSuggestions.map(
    (suggestion) => suggestion.suggestionId,
  );
  if (new Set(suggestionIds).size !== suggestionIds.length) {
    fail("contextualSuggestions contains duplicate suggestion IDs.");
  }
  if (!Array.isArray(input.designAlternatives)) {
    fail("designAlternatives must be an array.");
  }
  const designAlternatives = input.designAlternatives.map(
    normalizeDesignAlternative,
  );
  if (
    designAlternatives.filter((alternative) => alternative.recommended)
      .length > 1
  ) {
    fail("designAlternatives may contain at most one recommended approach.");
  }

  return deepFreeze({
    missionId: identifier(input.missionId, "missionId"),
    profileVersion: input.profileVersion,
    name: meaningfulText(input.name, "name"),
    summary: meaningfulText(input.summary, "summary"),
    family: input.family,
    platform: text(input.platform, "platform"),
    primaryActors: uniqueMeaningfulTextList(input.primaryActors, "primaryActors", {
      allowEmpty: false,
    }),
    primaryJourneys: uniqueMeaningfulTextList(
      input.primaryJourneys,
      "primaryJourneys",
      { allowEmpty: false },
    ),
    outcomes: uniqueMeaningfulTextList(input.outcomes, "outcomes", {
      allowEmpty: false,
    }),
    capabilities: uniqueTextList(input.capabilities, "capabilities"),
    dataConcepts: uniqueMeaningfulTextList(input.dataConcepts, "dataConcepts"),
    observations: uniqueMeaningfulTextList(
      input.observations,
      "observations",
    ),
    designDirection: normalizeDesignDirection(input.designDirection),
    designAlternatives,
    includedDefaults: uniqueMeaningfulTextList(
      input.includedDefaults,
      "includedDefaults",
    ),
    constraints: uniqueMeaningfulTextList(input.constraints, "constraints"),
    assumptions: uniqueMeaningfulTextList(input.assumptions, "assumptions"),
    customerContent: normalizeCustomerContent(input.customerContent),
    architectureDecisions: uniqueMeaningfulTextList(
      input.architectureDecisions,
      "architectureDecisions",
    ),
    openQuestions,
    contextualSuggestions,
    sourceRequirementIds: uniqueTextList(
      input.sourceRequirementIds,
      "sourceRequirementIds",
      { allowEmpty: false },
    ).map((id, index) => identifier(id, `sourceRequirementIds[${index}]`)),
    selectedStack: normalizeStack(input.selectedStack),
    runtimeAdapterId: identifier(input.runtimeAdapterId, "runtimeAdapterId"),
    requirementContractVersion: input.requirementContractVersion,
    verificationPlan: normalizeVerificationPlan(input.verificationPlan),
  });
}

export function projectProfileExperience(profileInput) {
  const profile = normalizeProjectProfile(profileInput);
  const nextQuestion = profile.openQuestions[0] ?? null;
  return deepFreeze({
    projectName: profile.name,
    projectSummary: profile.summary,
    family: profile.family,
    platform: profile.platform,
    missionTitle: profile.outcomes[0],
    currentGoal: profile.outcomes[0],
    discoveryPrompt:
      nextQuestion?.prompt ?? "That is enough to begin.",
    discoveryReason:
      nextQuestion?.reason ??
      "Foundry has the architecture-changing decisions it needs.",
    answerOptions: nextQuestion?.answerOptions ?? [],
    suggestions: profile.contextualSuggestions,
    verificationLabels: profile.verificationPlan.checks.map(
      (check) => check.label,
    ),
    previewAdapterId: profile.runtimeAdapterId,
  });
}
