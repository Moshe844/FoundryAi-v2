import { createHash } from "node:crypto";

import { ContractBindingValidationError } from "./errors.js";
import { normalizeApprovedProjectContract } from "./approved-project-contract.js";

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;
const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "build", "customer", "customers",
  "each", "for", "from", "have", "into", "more", "must", "need", "only",
  "project", "should", "that", "the", "their", "them", "this", "through",
  "user", "users", "using", "with", "would",
]);

function fail(message) {
  throw new ContractBindingValidationError(message);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label} must be a stable identifier.`);
  return value;
}

function exact(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} must contain exactly: ${expected.join(", ")}.`);
}

function uniqueIdentifiers(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  const result = value.map((entry, index) => identifier(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates.`);
  return result;
}

function tokens(value) {
  return new Set(String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((token) => token.length >= 4 && !STOP_WORDS.has(token)));
}

function overlaps(left, right) {
  const rightTokens = tokens(right);
  for (const token of tokens(left)) if (rightTokens.has(token)) return true;
  return false;
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function entry(requirementId, kind, statement) {
  return { requirementId, kind, statement: text(statement, `${requirementId}.statement`) };
}

export function approvedContractRequirementCatalogue(contractInput) {
  const contract = normalizeApprovedProjectContract(contractInput);
  const implementation = new Map();
  const exclusions = new Map();
  function add(target, item) {
    if (target.has(item.requirementId)) fail(`Approved contract repeats requirement ID "${item.requirementId}".`);
    target.set(item.requirementId, item);
  }
  add(implementation, entry("customer-intent-1", "original-request", contract.originalCustomerRequest));
  contract.customerFollowUpMessages.forEach((message, index) => add(
    implementation,
    entry(`customer-follow-up-${index + 1}`, "customer-follow-up", message),
  ));
  contract.workflows.primaryJourneys.forEach((journey, index) => add(
    implementation,
    entry(`workflow-primary-${index + 1}`, "primary-workflow", journey),
  ));
  contract.workflows.secondaryJourneys.forEach((journey, index) => add(
    implementation,
    entry(`workflow-secondary-${index + 1}`, "secondary-workflow", journey),
  ));
  add(implementation, entry(
    "approved-design-direction",
    "design-direction",
    `${contract.selectedDesignDirection.visualPersonality}. ${contract.selectedDesignDirection.layoutStrategy}. ${contract.selectedDesignDirection.interactionStyle}`,
  ));
  contract.acceptedRecommendations.forEach((recommendation, index) => add(
    implementation,
    entry(`accepted-recommendation-${index + 1}`, "accepted-recommendation", `${recommendation.title}. ${recommendation.specificValue}`),
  ));
  const selectedDecisions = (contract.decisionSelections ?? []).filter(
    (selection) => selection.kind === "decision",
  );
  if (selectedDecisions.length > 0) {
    selectedDecisions.forEach((selection, index) => add(
      implementation,
      entry(
        `approved-decision-${index + 1}`,
        "approved-decision",
        `${selection.value}. ${selection.reason}`,
      ),
    ));
  } else {
    [...contract.customerDecisions, ...contract.foundryDecisions].forEach((decision, index) => add(
      implementation,
      entry(`approved-decision-${index + 1}`, "approved-decision", `${decision.recommendation}. ${decision.recommendationReason}`),
    ));
  }
  contract.acceptanceObligations.forEach((obligation) => add(
    implementation,
    entry(obligation.obligationId, "acceptance-obligation", obligation.statement),
  ));
  contract.explicitExclusions.forEach((statement, index) => add(
    exclusions,
    entry(`explicit-exclusion-${index + 1}`, "explicit-exclusion", statement),
  ));
  contract.rejectedRecommendations.forEach((recommendation, index) => add(
    exclusions,
    entry(`rejected-recommendation-${index + 1}`, "rejected-recommendation", `${recommendation.title}. ${recommendation.specificValue}`),
  ));
  return freeze({
    implementationRequirements: [...implementation.values()],
    exclusionRequirements: [...exclusions.values()],
  });
}

export function deriveContractRoutingRequirements(contractInput, stackManifest) {
  const contract = normalizeApprovedProjectContract(contractInput);
  if (stackManifest === null || typeof stackManifest !== "object") fail("A certified stack manifest is required for routing.");
  if (contract.supportedPlatform !== "web") fail(`Approved platform "${contract.supportedPlatform}" is not executable by the current Foundry runtime.`);
  if (contract.selectedStackCapability.stackId !== stackManifest.stackId || contract.selectedStackCapability.stackVersion !== stackManifest.stackVersion) fail("Approved stack identity does not match the certified workload stack.");
  const supported = new Set(stackManifest.supportedCapabilities ?? []);
  const unsupported = contract.selectedStackCapability.capabilities.filter((capability) => !supported.has(capability));
  if (unsupported.length > 0) fail(`Approved contract requires unsupported stack capabilities: ${unsupported.join(", ")}.`);
  const integrationRequirements = [...new Set(contract.acceptedRecommendations.flatMap((item) => item.requiredDependencies))];
  const verificationMethods = [...new Set(contract.verificationPlan.map((item) => item.acceptanceMethod))].sort();
  const complexity = contract.selectedStackCapability.capabilities.length + integrationRequirements.length + verificationMethods.length + contract.workflows.primaryJourneys.length + contract.workflows.secondaryJourneys.length;
  const modelDepth = complexity >= 12 ? 4 : complexity >= 7 ? 3 : 2;
  return freeze({
    contractHash: contract.contentHash,
    contractVersion: contract.contractVersion,
    supportedPlatform: contract.supportedPlatform,
    stackId: contract.selectedStackCapability.stackId,
    stackVersion: contract.selectedStackCapability.stackVersion,
    requiredWorkloadCapabilities: [...contract.selectedStackCapability.capabilities].sort(),
    integrationRequirements,
    verificationMethods,
    modelDepth,
    routingReason: `Approved contract ${contract.contentHash.slice(0, 12)} requires ${contract.selectedStackCapability.capabilities.length} certified workload capabilities, ${integrationRequirements.length} dependencies, ${verificationMethods.length} verification methods, and ${contract.workflows.primaryJourneys.length + contract.workflows.secondaryJourneys.length} workflows.`,
  });
}

export const CONTRACT_BOUND_BUNDLE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "contractHash",
    "contractVersion",
    "supportedPlatform",
    "designDirectionHash",
    "requirementClaims",
    "explicitExclusionIds",
    "files",
  ],
  properties: {
    contractHash: { type: "string", minLength: 64 },
    contractVersion: { type: "integer" },
    supportedPlatform: { type: "string", minLength: 1 },
    designDirectionHash: { type: "string", minLength: 64 },
    requirementClaims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "implementationSummary"],
        properties: {
          requirementId: { type: "string", minLength: 1 },
          implementationSummary: { type: "string", minLength: 1 },
        },
      },
    },
    explicitExclusionIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content", "contractRequirementIds"],
        properties: {
          path: { type: "string", minLength: 1 },
          content: { type: "string" },
          contractRequirementIds: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
});

export function approvedDesignDirectionHash(contractInput) {
  return hash(normalizeApprovedProjectContract(contractInput).selectedDesignDirection);
}

export function validateContractBoundMissionPlan(plan, contractInput) {
  const contract = normalizeApprovedProjectContract(contractInput);
  const catalogue = approvedContractRequirementCatalogue(contract);
  exact(plan, ["contractHash", "contractVersion", "supportedPlatform", "designDirectionHash", "requirementClaims", "explicitExclusionIds", "files"], "generatedMissionPlan");
  if (plan.contractHash !== contract.contentHash || plan.contractVersion !== contract.contractVersion) fail("Generated mission plan is not bound to the approved contract version and hash.");
  if (plan.supportedPlatform !== contract.supportedPlatform) fail("Generated mission plan changed the approved platform.");
  if (plan.designDirectionHash !== approvedDesignDirectionHash(contract)) fail("Generated mission plan changed the approved design direction.");
  if (!Array.isArray(plan.requirementClaims)) fail("requirementClaims must be an array.");
  const requiredById = new Map(catalogue.implementationRequirements.map((item) => [item.requirementId, item]));
  const claims = new Map();
  for (const [index, claim] of plan.requirementClaims.entries()) {
    exact(claim, ["requirementId", "implementationSummary"], `requirementClaims[${index}]`);
    const requirementId = identifier(claim.requirementId, `requirementClaims[${index}].requirementId`);
    const summary = text(claim.implementationSummary, `requirementClaims[${index}].implementationSummary`);
    const requirement = requiredById.get(requirementId);
    if (requirement === undefined) fail(`Generated mission plan adds unapproved requirement "${requirementId}".`);
    if (claims.has(requirementId)) fail(`Generated mission plan duplicates requirement "${requirementId}".`);
    if (!overlaps(requirement.statement, summary)) fail(`Generated mission plan reinterprets requirement "${requirementId}" without preserving its subject.`);
    claims.set(requirementId, summary);
  }
  const missing = [...requiredById.keys()].filter((requirementId) => !claims.has(requirementId));
  if (missing.length > 0) fail(`Generated mission plan omits approved requirements: ${missing.join(", ")}.`);
  const expectedExclusions = catalogue.exclusionRequirements.map((item) => item.requirementId).sort();
  const actualExclusions = uniqueIdentifiers(plan.explicitExclusionIds, "explicitExclusionIds", { allowEmpty: true }).sort();
  if (canonical(expectedExclusions) !== canonical(actualExclusions)) fail("Generated mission plan did not preserve every explicit exclusion.");
  if (!Array.isArray(plan.files) || plan.files.length === 0) fail("Generated mission plan must contain traceable files.");
  const traced = new Set();
  const paths = new Set();
  const files = plan.files.map((file, index) => {
    exact(file, ["path", "content", "contractRequirementIds"], `files[${index}]`);
    const path = text(file.path, `files[${index}].path`);
    if (paths.has(path)) fail(`Generated mission plan duplicates path "${path}".`);
    paths.add(path);
    const ids = uniqueIdentifiers(file.contractRequirementIds, `files[${index}].contractRequirementIds`);
    for (const requirementId of ids) {
      if (!requiredById.has(requirementId)) fail(`File "${path}" traces to unknown or excluded requirement "${requirementId}".`);
      traced.add(requirementId);
    }
    return { path, content: String(file.content), contractRequirementIds: ids };
  });
  const untraced = [...requiredById.keys()].filter((requirementId) => !traced.has(requirementId));
  if (untraced.length > 0) fail(`No generated file traces to approved requirements: ${untraced.join(", ")}.`);
  return freeze({
    contractHash: contract.contentHash,
    contractVersion: contract.contractVersion,
    supportedPlatform: contract.supportedPlatform,
    designDirectionHash: plan.designDirectionHash,
    requirementClaims: [...claims].map(([requirementId, implementationSummary]) => ({ requirementId, implementationSummary })),
    explicitExclusionIds: actualExclusions,
    files,
  });
}

export function validateContractRequirementTrace(
  requirementIds,
  contractInput,
  allowedRequirementIds,
) {
  const catalogue = approvedContractRequirementCatalogue(contractInput);
  const approvedIds = new Set(
    catalogue.implementationRequirements.map((item) => item.requirementId),
  );
  const allowedIds = new Set(
    uniqueIdentifiers(allowedRequirementIds, "allowedRequirementIds"),
  );
  for (const requirementId of allowedIds) {
    if (!approvedIds.has(requirementId)) {
      fail(`Repair scope references unknown requirement "${requirementId}".`);
    }
  }
  const trace = uniqueIdentifiers(
    requirementIds,
    "contractRequirementIds",
  );
  for (const requirementId of trace) {
    if (!allowedIds.has(requirementId)) {
      fail(
        `Repair traces to requirement "${requirementId}" outside its approved task scope.`,
      );
    }
  }
  return freeze([...trace]);
}

export function createModelTaskContract({
  approvedContract,
  routingRequirements,
  taskObjective,
  allowedScope,
  forbiddenChanges,
  relevantRequirementIds,
  currentCheckpoint,
  expectedOutputSchema,
}) {
  const contract = normalizeApprovedProjectContract(approvedContract);
  const catalogue = approvedContractRequirementCatalogue(contract);
  const byId = new Map(catalogue.implementationRequirements.map((item) => [item.requirementId, item]));
  const ids = uniqueIdentifiers(relevantRequirementIds, "relevantRequirementIds");
  const relevantRequirements = ids.map((requirementId) => {
    const item = byId.get(requirementId);
    if (item === undefined) fail(`Model task references unknown requirement "${requirementId}".`);
    return item;
  });
  if (!Array.isArray(allowedScope) || allowedScope.length === 0 || !Array.isArray(forbiddenChanges) || forbiddenChanges.length === 0) fail("Model task allowedScope and forbiddenChanges must be non-empty arrays.");
  return freeze({
    taskObjective: text(taskObjective, "taskObjective"),
    allowedScope: allowedScope.map((item, index) => text(item, `allowedScope[${index}]`)),
    forbiddenChanges: forbiddenChanges.map((item, index) => text(item, `forbiddenChanges[${index}]`)),
    approvedContract: {
      contentHash: contract.contentHash,
      contractVersion: contract.contractVersion,
      originalCustomerRequest: contract.originalCustomerRequest,
      customerFollowUpMessages: contract.customerFollowUpMessages,
      finalInterpretedIntent: contract.finalInterpretedIntent,
      audiences: contract.audiences,
      workflows: contract.workflows,
      selectedDesignDirection: contract.selectedDesignDirection,
      acceptedRecommendations: contract.acceptedRecommendations,
      rejectedRecommendations: contract.rejectedRecommendations,
      customerDecisions: contract.customerDecisions,
      foundryDecisions: contract.foundryDecisions,
      decisionSelections: contract.decisionSelections ?? [],
      assumptions: contract.assumptions,
      explicitExclusions: contract.explicitExclusions,
      architectureConstraints: contract.architectureConstraints,
      supportedPlatform: contract.supportedPlatform,
      selectedStackCapability: contract.selectedStackCapability,
    },
    relevantRequirements,
    verificationObligations: contract.acceptanceObligations,
    verificationPlan: contract.verificationPlan,
    routingRequirements,
    currentCheckpoint: identifier(currentCheckpoint, "currentCheckpoint"),
    expectedOutputSchema,
  });
}

export function contractBoundModelPrompt(taskContract, instructions) {
  if (!Array.isArray(instructions) || instructions.length === 0) fail("Model task instructions must be a non-empty array.");
  return [
    "MODEL TASK CONTRACT — BINDING",
    JSON.stringify(taskContract),
    "INSTRUCTIONS",
    ...instructions.map((instruction, index) => `${index + 1}. ${text(instruction, `instructions[${index}]`)}`),
    "Do not reinterpret the original request. Do not omit an approved requirement, add an unapproved major feature, change platform or design direction, ignore a customer message, violate an exclusion, or weaken verification.",
  ].join("\n\n");
}
