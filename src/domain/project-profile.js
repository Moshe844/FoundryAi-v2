import { ProjectProfileValidationError } from "./errors.js";
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
  "contextualSuggestions",
  "dataConcepts",
  "family",
  "missionId",
  "name",
  "openQuestions",
  "outcomes",
  "platform",
  "primaryActors",
  "profileVersion",
  "requirementContractVersion",
  "runtimeAdapterId",
  "selectedStack",
  "sourceRequirementIds",
  "summary",
  "verificationPlan",
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

function normalizeQuestion(question, index) {
  exactKeys(
    question,
    ["answerOptions", "questionId", "prompt", "reason"],
    `openQuestions[${index}]`,
  );
  return {
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
}

function normalizeSuggestion(suggestion, index) {
  exactKeys(
    suggestion,
    ["label", "rationale", "suggestionId"],
    `contextualSuggestions[${index}]`,
  );
  return {
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

export function normalizeProjectProfile(input) {
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
    outcomes: uniqueMeaningfulTextList(input.outcomes, "outcomes", {
      allowEmpty: false,
    }),
    capabilities: uniqueTextList(input.capabilities, "capabilities"),
    dataConcepts: uniqueMeaningfulTextList(input.dataConcepts, "dataConcepts"),
    constraints: uniqueMeaningfulTextList(input.constraints, "constraints"),
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
