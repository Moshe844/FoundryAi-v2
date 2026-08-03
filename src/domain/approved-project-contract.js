import { createHash } from "node:crypto";

import { ApprovedProjectContractValidationError } from "./errors.js";
import {
  normalizeDecisionList,
  normalizeDesignDirection,
  normalizeProjectIntent,
  normalizeProjectVerificationPlan,
  normalizeRecommendationList,
  normalizeUserExperiencePlan,
} from "./project-design.js";
import { normalizeProductBlueprint } from "./product-blueprint.js";

export const APPROVED_PROJECT_CONTRACT_SCHEMA_VERSION = 2;
export const APPROVED_PROJECT_CONTRACT_SOURCE = "APPROVED_PROJECT_CONTRACT_SERVICE";

const KEYS = [
  "missionId",
  "originalCustomerRequest",
  "customerFollowUpMessages",
  "finalInterpretedIntent",
  "audiences",
  "workflows",
  "selectedDesignDirection",
  "acceptedRecommendations",
  "rejectedRecommendations",
  "customerDecisions",
  "foundryDecisions",
  "assumptions",
  "explicitExclusions",
  "architectureConstraints",
  "supportedPlatform",
  "selectedStackCapability",
  "acceptanceObligations",
  "verificationPlan",
  "decisionSelections",
  "contractVersion",
  "contentHash",
  "approvalTimestamp",
];
const LEGACY_KEYS = KEYS.filter((key) => key !== "decisionSelections");
const BLUEPRINT_KEYS = [...KEYS, "productBlueprint"];

function fail(message) {
  throw new ApprovedProjectContractValidationError(message);
}

function exact(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} must contain exactly: ${expected.join(", ")}.`);
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function stringList(value, label) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const normalized = value.map((entry, index) => text(entry, `${label}[${index}]`));
  if (new Set(normalized.map((entry) => entry.toLowerCase())).size !== normalized.length) fail(`${label} contains duplicates.`);
  return normalized;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function normalizeSelection(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return structuredClone(value);
}

function normalizeDecisionSelections(value) {
  if (!Array.isArray(value)) fail("decisionSelections must be an array.");
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
  return value.map((entry, index) => {
    const label = `decisionSelections[${index}]`;
    exact(entry, [
      "classification",
      "kind",
      "mode",
      "optionId",
      "reason",
      "sourceProfileVersion",
      "subjectId",
      "value",
    ], label);
    if (!kinds.has(entry.kind)) fail(`${label}.kind is invalid.`);
    if (!modes.has(entry.mode)) fail(`${label}.mode is invalid.`);
    if (
      !Number.isSafeInteger(entry.sourceProfileVersion) ||
      entry.sourceProfileVersion < 1
    ) fail(`${label}.sourceProfileVersion must be a positive integer.`);
    return {
      kind: entry.kind,
      subjectId: text(entry.subjectId, `${label}.subjectId`),
      mode: entry.mode,
      optionId:
        entry.optionId === null ? null : text(entry.optionId, `${label}.optionId`),
      value: text(entry.value, `${label}.value`),
      reason: text(entry.reason, `${label}.reason`),
      classification:
        entry.classification === null
          ? null
          : text(entry.classification, `${label}.classification`),
      sourceProfileVersion: entry.sourceProfileVersion,
    };
  });
}

function payloadWithoutHash(contract) {
  const clone = structuredClone(contract);
  delete clone.contentHash;
  return clone;
}

function assertDecisionLedgerConsistency(contract) {
  if (!Object.hasOwn(contract, "decisionSelections")) {
    fail("Execution requires a versioned decisionSelections ledger.");
  }
  if (contract.decisionSelections.length === 0) {
    fail("decisionSelections must record the choices used to approve this contract.");
  }
  const identities = contract.decisionSelections.map(
    (selection) =>
      selection.kind === "product-subtype"
        ? `${selection.kind}:${selection.subjectId}:${selection.optionId ?? selection.value}`
        : `${selection.kind}:${selection.subjectId}`,
  );
  if (new Set(identities).size !== identities.length) {
    fail("decisionSelections contains more than one final choice for the same subject.");
  }
  const blueprintApprovals = contract.decisionSelections.filter(
    (selection) => selection.kind === "blueprint-approval",
  );
  if (
    blueprintApprovals.length > 1 ||
    blueprintApprovals.some(
      (selection) =>
        selection.mode !== "confirm" ||
        selection.subjectId !== "product-blueprint",
    )
  ) fail("Product Blueprint approval is invalid.");
  if (contract.productBlueprint !== undefined) {
    const blueprint = contract.productBlueprint;
    if (
      blueprint.missionId !== contract.missionId ||
      blueprint.originalCustomerRequest !== contract.originalCustomerRequest
    ) fail("Product Blueprint identity does not match the approved contract.");
    if (
      blueprintApprovals.length !== 1 ||
      blueprintApprovals[0].value !== blueprint.integrityHash ||
      blueprintApprovals[0].sourceProfileVersion !== blueprint.blueprintVersion
    ) fail("Product Blueprint hash and version were not approved exactly.");
    if (
      blueprint.navigationApproach !== contract.selectedDesignDirection.navigationApproach ||
      blueprint.designSpecification.visualPersonality !== contract.selectedDesignDirection.visualPersonality
    ) fail("Approved visual direction was lost between the Product Blueprint and contract.");
    const contractAudiences = new Set(contract.audiences.map((item) => item.toLowerCase()));
    if (blueprint.intendedUsers.some((item) => !contractAudiences.has(item.toLowerCase()))) {
      fail("Product Blueprint audience was dropped from the approved contract.");
    }
    const exclusions = new Set(contract.explicitExclusions.map((item) => item.toLowerCase()));
    if (blueprint.excludedFromV1.some((item) => !exclusions.has(item.toLowerCase()))) {
      fail("Product Blueprint exclusion was dropped from the approved contract.");
    }
  }

  const designSelections = contract.decisionSelections.filter(
    (selection) => selection.kind === "design-direction",
  );
  if (designSelections.length !== 1) {
    fail("decisionSelections must contain exactly one final design direction.");
  }

  const recommendationSelections = contract.decisionSelections.filter(
    (selection) => selection.kind === "recommendation",
  );
  const recommendationTitles = [
    ...contract.acceptedRecommendations.map((item) => [item.title, "include"]),
    ...contract.rejectedRecommendations.map((item) => [item.title, "exclude"]),
  ];
  for (const [title, expectedMode] of recommendationTitles) {
    const matching = recommendationSelections.filter(
      (selection) => selection.value === title,
    );
    if (matching.length !== 1 || matching[0].mode !== expectedMode) {
      fail(`Recommendation "${title}" is not represented consistently in decisionSelections.`);
    }
  }
  if (recommendationSelections.length !== recommendationTitles.length) {
    fail("decisionSelections contains a recommendation that is absent from the approved recommendation lists.");
  }

  const messages = new Set(contract.customerFollowUpMessages);
  for (const selection of contract.decisionSelections) {
    if (selection.kind === "customer-message" && !messages.has(selection.value)) {
      fail("A customer-message choice is absent from customerFollowUpMessages.");
    }
  }
  return contract;
}

export function computeApprovedProjectContractHash(contract) {
  return createHash("sha256").update(canonical(payloadWithoutHash(contract)), "utf8").digest("hex");
}

export function normalizeApprovedProjectContract(input) {
  const hasDecisionSelections = Object.hasOwn(input, "decisionSelections");
  const hasProductBlueprint = Object.hasOwn(input, "productBlueprint");
  exact(
    input,
    hasProductBlueprint
      ? BLUEPRINT_KEYS
      : hasDecisionSelections ? KEYS : LEGACY_KEYS,
    "approvedProjectContract",
  );
  if (!Number.isSafeInteger(input.contractVersion) || input.contractVersion < 1) fail("contractVersion must be a positive integer.");
  const timestamp = text(input.approvalTimestamp, "approvalTimestamp");
  if (Number.isNaN(Date.parse(timestamp))) fail("approvalTimestamp must be an ISO-compatible timestamp.");
  if (typeof input.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(input.contentHash)) fail("contentHash must be a SHA-256 digest.");

  const finalInterpretedIntent = normalizeProjectIntent(input.finalInterpretedIntent);
  const workflows = normalizeUserExperiencePlan(input.workflows);
  const selectedDesignDirection = normalizeDesignDirection(input.selectedDesignDirection);
  const recommendations = normalizeRecommendationList([...input.acceptedRecommendations, ...input.rejectedRecommendations]);
  const decisions = normalizeDecisionList([...input.customerDecisions, ...input.foundryDecisions]);
  const verificationPlan = normalizeProjectVerificationPlan(input.verificationPlan);
  const stack = normalizeSelection(input.selectedStackCapability, "selectedStackCapability");
  for (const key of ["stackId", "stackVersion", "capabilities"]) {
    if (!(key in stack)) fail(`selectedStackCapability.${key} is required.`);
  }
  stack.stackId = text(stack.stackId, "selectedStackCapability.stackId");
  stack.stackVersion = text(stack.stackVersion, "selectedStackCapability.stackVersion");
  stack.capabilities = stringList(stack.capabilities, "selectedStackCapability.capabilities");
  if (!Array.isArray(input.acceptanceObligations) || input.acceptanceObligations.length === 0) fail("acceptanceObligations must be a non-empty array.");
  const obligations = input.acceptanceObligations.map((entry, index) => {
    const result = normalizeSelection(entry, `acceptanceObligations[${index}]`);
    for (const key of ["obligationId", "statement", "sourceRequirement"]) {
      result[key] = text(result[key], `acceptanceObligations[${index}].${key}`);
    }
    return result;
  });
  const normalized = {
    missionId: text(input.missionId, "missionId"),
    originalCustomerRequest: text(input.originalCustomerRequest, "originalCustomerRequest"),
    customerFollowUpMessages: stringList(input.customerFollowUpMessages, "customerFollowUpMessages"),
    finalInterpretedIntent,
    audiences: stringList(input.audiences, "audiences"),
    workflows,
    selectedDesignDirection,
    acceptedRecommendations: recommendations.slice(0, input.acceptedRecommendations.length),
    rejectedRecommendations: recommendations.slice(input.acceptedRecommendations.length),
    customerDecisions: decisions.slice(0, input.customerDecisions.length),
    foundryDecisions: decisions.slice(input.customerDecisions.length),
    assumptions: stringList(input.assumptions, "assumptions"),
    explicitExclusions: stringList(input.explicitExclusions, "explicitExclusions"),
    architectureConstraints: stringList(input.architectureConstraints, "architectureConstraints"),
    supportedPlatform: text(input.supportedPlatform, "supportedPlatform"),
    selectedStackCapability: stack,
    acceptanceObligations: obligations,
    verificationPlan,
    ...(hasProductBlueprint
      ? { productBlueprint: normalizeProductBlueprint(input.productBlueprint) }
      : {}),
    ...(hasDecisionSelections
      ? { decisionSelections: normalizeDecisionSelections(input.decisionSelections) }
      : {}),
    contractVersion: input.contractVersion,
    contentHash: input.contentHash,
    approvalTimestamp: timestamp,
  };
  const expectedHash = computeApprovedProjectContractHash(normalized);
  if (normalized.contentHash !== expectedHash) fail("contentHash does not match the approved contract content.");
  return deepFreeze(normalized);
}

export function createApprovedProjectContract(input) {
  const withPlaceholder = {
    ...structuredClone(input),
    decisionSelections: structuredClone(input.decisionSelections ?? []),
    contentHash: "0".repeat(64),
  };
  withPlaceholder.contentHash = computeApprovedProjectContractHash(withPlaceholder);
  return normalizeApprovedProjectContract(withPlaceholder);
}

export function validateApprovedProjectContractConsistency(input) {
  return assertDecisionLedgerConsistency(normalizeApprovedProjectContract(input));
}
