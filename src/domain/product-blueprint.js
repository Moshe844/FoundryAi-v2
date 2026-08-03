import { createHash } from "node:crypto";

export const PRODUCT_BLUEPRINT_SCHEMA_VERSION = 1;

const REQUIRED_FIELDS = Object.freeze([
  "schemaVersion", "missionId", "blueprintVersion", "originalCustomerRequest",
  "exactProductType", "selectedSubtypes", "productName", "oneSentenceOutcome",
  "intendedUsers", "businessGoal", "primaryWorkflows", "supportingWorkflows",
  "requiredSurfaces", "navigationApproach", "contentStructure",
  "administrationNeeds", "securityConsiderations", "dataAndPersistenceNeeds",
  "responsivePriorities", "accessibilityNeeds", "experienceStates", "includedNow",
  "excludedFromV1", "recommendedLater", "designSpecification", "selectedFeatures",
  "rejectedRecommendations", "foundryDecisions", "customerDecisions",
  "customCustomerMessages", "businessRules", "integrations", "assumptions",
  "architecture", "certifiedStackCapability", "acceptanceRequirements",
  "verificationPlan", "quality", "integrityHash",
]);

export const PRODUCT_BLUEPRINT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: REQUIRED_FIELDS,
  properties: Object.freeze({
    schemaVersion: { type: "integer", enum: [PRODUCT_BLUEPRINT_SCHEMA_VERSION] },
    missionId: { type: "string", minLength: 1 },
    blueprintVersion: { type: "integer", minimum: 1 },
    originalCustomerRequest: { type: "string", minLength: 1 },
    exactProductType: { type: "string", minLength: 1 },
    selectedSubtypes: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    productName: { type: "string", minLength: 1 },
    oneSentenceOutcome: { type: "string", minLength: 1 },
    intendedUsers: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    businessGoal: { type: "string", minLength: 1 },
    primaryWorkflows: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    supportingWorkflows: { type: "array", items: { type: "string", minLength: 1 } },
    requiredSurfaces: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    navigationApproach: { type: "string", minLength: 1 },
    contentStructure: { type: "string", minLength: 1 },
    administrationNeeds: { type: "array", items: { type: "string", minLength: 1 } },
    securityConsiderations: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    dataAndPersistenceNeeds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    responsivePriorities: { type: "string", minLength: 1 },
    accessibilityNeeds: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    experienceStates: { type: "object" },
    includedNow: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    excludedFromV1: { type: "array", items: { type: "string", minLength: 1 } },
    recommendedLater: { type: "array", items: { type: "string", minLength: 1 } },
    designSpecification: { type: "object" },
    selectedFeatures: { type: "array", items: { type: "string", minLength: 1 } },
    rejectedRecommendations: { type: "array", items: { type: "string", minLength: 1 } },
    foundryDecisions: { type: "array", items: { type: "string", minLength: 1 } },
    customerDecisions: { type: "array", items: { type: "string", minLength: 1 } },
    customCustomerMessages: { type: "array", items: { type: "string", minLength: 1 } },
    businessRules: { type: "array", items: { type: "string", minLength: 1 } },
    integrations: { type: "array", items: { type: "string", minLength: 1 } },
    assumptions: { type: "array", items: { type: "string", minLength: 1 } },
    architecture: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    certifiedStackCapability: { type: "object" },
    acceptanceRequirements: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
    verificationPlan: { type: "array", minItems: 1, items: { type: "object" } },
    quality: { type: "object" },
    integrityHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
  }),
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function contentHash(value) {
  const payload = structuredClone(value);
  delete payload.integrityHash;
  return createHash("sha256").update(canonical(payload)).digest("hex");
}

function unique(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function selectedValues(answers, kind, modes = null) {
  return unique(
    answers
      .map((answer) => answer?.selection)
      .filter(
        (selection) =>
          selection?.kind === kind &&
          (modes === null || modes.includes(selection.mode)),
      )
      .map((selection) => selection.value),
  );
}

export function validateProductBlueprintQuality(blueprint) {
  const scores = {
    specificity: 1,
    completeness: 1,
    usefulness: 1,
    differentiation: 1,
    feasibility: 1,
    clarity: 1,
    designQuality: 1,
    executionReadiness: 1,
    verificationReadiness: 1,
  };
  const missing = REQUIRED_FIELDS.filter((field) => !Object.hasOwn(blueprint, field));
  if (missing.length > 0) throw new TypeError(`Product Blueprint is missing: ${missing.join(", ")}.`);
  for (const field of [
    "selectedSubtypes", "intendedUsers", "primaryWorkflows", "requiredSurfaces",
    "securityConsiderations", "dataAndPersistenceNeeds", "accessibilityNeeds",
    "includedNow", "architecture", "acceptanceRequirements", "verificationPlan",
  ]) {
    if (!Array.isArray(blueprint[field]) || blueprint[field].length === 0) {
      throw new TypeError(`Product Blueprint ${field} must be executable, not empty.`);
    }
  }
  const unresolvedLanguage = findUnresolvedBlueprintLanguage(blueprint);
  if (unresolvedLanguage !== null) {
    throw new TypeError(
      `Product Blueprint contains generic or unresolved language at ${unresolvedLanguage.path}: ${JSON.stringify(unresolvedLanguage.value)}.`,
    );
  }
  for (const capability of blueprint.includedNow) {
    if (!blueprint.verificationPlan.some((entry) => entry.observableOutcome.startsWith(capability))) {
      throw new TypeError(`Included capability is not traceable to verification: ${capability}`);
    }
  }
  if (blueprint.integrityHash !== contentHash(blueprint)) {
    throw new TypeError("Product Blueprint integrity hash does not match its contents.");
  }
  return freeze(scores);
}

export function hasUnresolvedBlueprintLanguage(value) {
  return findUnresolvedBlueprintLanguage(value) !== null;
}

export function findUnresolvedBlueprintLanguage(value, path = "blueprint") {
  if (typeof value === "string") {
    const normalized = value.trim();
    return (
      /^(?:tbd|todo)(?:\s*[:â€”-].*)?[.!?]?$/iu.test(normalized) ||
      /^(?:placeholder(?:\s+(?:content|copy|text|value))?|generic solution|standard app)[.!?]?$/iu.test(
        normalized,
      )
    )
      ? { path, value }
      : null;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const unresolved = findUnresolvedBlueprintLanguage(
        child,
        `${path}[${index}]`,
      );
      if (unresolved !== null) return unresolved;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const unresolved = findUnresolvedBlueprintLanguage(
        child,
        `${path}.${key}`,
      );
      if (unresolved !== null) return unresolved;
    }
  }
  return null;
}

export function createProductBlueprint({
  missionId,
  originalCustomerRequest,
  profile,
  projectDesign,
  answers = [],
  productTypeDiscovery = null,
}) {
  const chosenSubtypes = selectedValues(answers, "product-subtype");
  const selectedSubtypes = chosenSubtypes.length > 0
    ? chosenSubtypes
    : productTypeDiscovery === null
      ? [profile.family]
      : [productTypeDiscovery.subtypes.find((item) => item.recommended)?.title ?? profile.family];
  const customerMessages = unique(
    answers
      .filter((answer) => answer?.selection === undefined || answer.selection.kind === "customer-message")
      .map((answer) => answer.answer),
  );
  const customerDecisions = [
    ...selectedSubtypes,
    ...selectedValues(answers, "decision", ["select-option", "other"]),
    ...selectedValues(answers, "design-direction", ["select-option", "other"]),
  ];
  const foundryDecisions = unique(
    projectDesign.decisions
      .filter((decision) => decision.canFoundryDecide)
      .map((decision) => `${decision.recommendation} — ${decision.recommendationReason}`),
  );
  const selectedFeatures = unique([
    ...projectDesign.productProposal.essentialCapabilities,
    ...projectDesign.recommendations
      .filter((recommendation) =>
        selectedValues(answers, "recommendation", ["include"]).includes(recommendation.title) ||
        (recommendation.selectedByDefault && !selectedValues(answers, "recommendation", ["exclude"]).includes(recommendation.title)),
      )
      .map((recommendation) => recommendation.title),
  ]);
  const rejectedRecommendations = unique([
    ...projectDesign.productProposal.intentionallyExcludedCapabilities,
    ...selectedValues(answers, "recommendation", ["exclude"]),
  ]);
  const businessRules = unique(
    answers
      .filter((answer) => answer?.selection?.classification === "business rule")
      .map((answer) => answer.answer),
  );
  const integrations = unique([
    ...answers
      .filter((answer) => answer?.selection?.classification === "integration")
      .map((answer) => answer.answer),
    ...projectDesign.recommendations.flatMap((recommendation) => recommendation.requiredDependencies),
  ]);
  const draft = {
    schemaVersion: PRODUCT_BLUEPRINT_SCHEMA_VERSION,
    missionId,
    blueprintVersion: profile.profileVersion,
    originalCustomerRequest: originalCustomerRequest.trim(),
    exactProductType: profile.family,
    selectedSubtypes,
    productName: profile.name,
    oneSentenceOutcome: projectDesign.projectIntent.customerOutcome,
    intendedUsers: unique(projectDesign.projectIntent.intendedUsers),
    businessGoal: projectDesign.projectIntent.primaryGoal,
    primaryWorkflows: unique(projectDesign.userExperiencePlan.primaryJourneys),
    supportingWorkflows: unique(projectDesign.userExperiencePlan.secondaryJourneys),
    requiredSurfaces: unique(projectDesign.productProposal.essentialCapabilities),
    navigationApproach: projectDesign.designDirection.navigationApproach,
    contentStructure: projectDesign.designDirection.contentStrategy,
    administrationNeeds: unique(projectDesign.userExperiencePlan.adminResponsibilities),
    securityConsiderations: unique([
      ...projectDesign.userExperiencePlan.trustMoments,
      ...projectDesign.foundryInsights.risks,
    ]),
    dataAndPersistenceNeeds: unique(profile.dataConcepts),
    responsivePriorities: projectDesign.designDirection.responsivePriority,
    accessibilityNeeds: unique(projectDesign.designDirection.accessibilityNeeds),
    experienceStates: {
      empty: unique(projectDesign.userExperiencePlan.criticalMoments),
      loading: unique(projectDesign.userExperiencePlan.repeatedTasks.length > 0
        ? projectDesign.userExperiencePlan.repeatedTasks
        : projectDesign.userExperiencePlan.primaryJourneys),
      error: unique(projectDesign.userExperiencePlan.failureStates),
      success: unique(projectDesign.userExperiencePlan.trustMoments),
    },
    includedNow: unique(projectDesign.productProposal.essentialCapabilities),
    excludedFromV1: unique(projectDesign.productProposal.intentionallyExcludedCapabilities),
    recommendedLater: unique(projectDesign.productProposal.futureCapabilities),
    designSpecification: structuredClone(projectDesign.designDirection),
    selectedFeatures,
    rejectedRecommendations,
    foundryDecisions,
    customerDecisions: unique(customerDecisions),
    customCustomerMessages: customerMessages,
    businessRules,
    integrations,
    assumptions: unique(projectDesign.foundryInsights.assumptions),
    architecture: unique(profile.architectureDecisions),
    certifiedStackCapability: structuredClone(profile.selectedStack),
    acceptanceRequirements: unique(projectDesign.verificationPlan.map((entry) => entry.observableOutcome)),
    verificationPlan: structuredClone(projectDesign.verificationPlan),
    quality: {
      specificity: 1, completeness: 1, usefulness: 1, differentiation: 1,
      feasibility: 1, clarity: 1, designQuality: 1, executionReadiness: 1,
      verificationReadiness: 1,
    },
    integrityHash: "",
  };
  draft.integrityHash = contentHash(draft);
  validateProductBlueprintQuality(draft);
  return freeze(draft);
}

export function normalizeProductBlueprint(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Product Blueprint must be an object.");
  }
  if (Object.keys(value).sort().join(",") !== [...REQUIRED_FIELDS].sort().join(",")) {
    throw new TypeError("Product Blueprint shape is not recognized.");
  }
  const clone = structuredClone(value);
  validateProductBlueprintQuality(clone);
  return freeze(clone);
}
