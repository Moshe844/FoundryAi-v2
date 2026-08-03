import { createHash } from "node:crypto";

import { ContractBindingValidationError } from "./errors.js";
import { normalizeApprovedProjectContract } from "./approved-project-contract.js";
import {
  DESIGN_FIDELITY_SCHEMA,
  designExecutionBrief,
  validateGeneratedDesignFidelity,
} from "./design-fidelity.js";

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

function preservesRequirementSubject(requirement, summary) {
  if (overlaps(requirement.statement, summary)) return true;
  // Design requirements carry creative direction names and prose rationales
  // ("Coastal calm. Soft blues convey trust."), so a faithful implementation
  // summary legitimately shares no ≥4-letter token with the statement. Accept
  // a summary that is unambiguously about implementing the visual design;
  // summaries about unrelated features still fail. This mirrors the existing
  // production-build carve-out below for the same token-overlap limitation.
  if (
    requirement.kind.startsWith("design-") &&
    /\b(?:design(?:ed|s)?|visual(?:s|ly)?|styl(?:e[sd]?|ing)|direction|palette|colou?r(?:s|ed)?|typograph\w*|font\w*|layout\w*|navigat\w*|responsive|mobile|hierarch\w*|aesthetic\w*|brand(?:ed|ing)?|look|theme[sd]?|spacing|accessib\w*)\b/iu.test(
      summary,
    )
  ) {
    return true;
  }
  return (
    requirement.kind === "acceptance-obligation" &&
    /\bproduction build\b/iu.test(requirement.statement) &&
    /\b(?:production|compile[sd]?|compilation|package[sd]?|packaging|bundle[sd]?)\b/iu.test(summary)
  );
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

function addBlueprintDesignRequirements(add, implementation, exclusions, blueprint) {
  const design = blueprint.designSpecification;
  if (design === null || typeof design !== "object") return;
  const composition = design.composition ?? {};
  const visual = design.visualCharacter ?? {};
  const additions = [
    ["blueprint-design-direction", "design-direction", `${design.selectedDirectionName ?? design.visualPersonality}. ${design.rationale ?? ""}`],
    ["blueprint-design-composition", "design-composition", `${composition.layoutApproach ?? design.layoutStrategy}. ${visual.hierarchy ?? ""}`],
    ["blueprint-design-navigation", "design-navigation", `${composition.navigationApproach ?? design.navigationApproach}. ${design.interactionStyle ?? ""}`],
    ["blueprint-design-typography", "design-typography", `${visual.typography ?? design.typographyDirection ?? design.visualPersonality}`],
    ["blueprint-design-color", "design-color", `${visual.colorMood ?? design.colorStrategy ?? design.tone}`],
    ["blueprint-design-responsive", "design-responsive", `${composition.mobileBehavior ?? design.responsivePriority}`],
  ];
  for (const [id, kind, statement] of additions) {
    if (typeof statement === "string" && statement.trim().length > 2) {
      add(implementation, entry(id, kind, statement));
    }
  }
  // Structural design DNA. Without these the builder receives a mood and a
  // palette, which is how a "selected direction" ends up recognizable only by
  // its accent colour. Each entry below is independently verifiable against
  // the finished application.
  const dna = design.creativeDNA ?? null;
  if (dna !== null && typeof dna === "object") {
    const structural = [
      ["blueprint-design-primitive", "design-composition-primitive",
        `Compose every customer-facing surface as a ${String(dna.compositionPrimitive).replaceAll("-", " ")}. This structure is binding, not a suggestion.`],
      ["blueprint-design-sequence", "design-surface-sequence",
        `Lay out the primary surface in this order: ${(dna.surfaceSequence ?? []).join(" then ")}.`],
      ["blueprint-design-typescale", "design-typography",
        `Set type in a ${String(dna.typeVoice).replaceAll("-", " ")} voice at a ${dna.typeScale} scale, with a matching modular scale for every heading level.`],
      ["blueprint-design-imagery", "design-imagery",
        `Treat imagery as ${String(dna.imageryTreatment).replaceAll("-", " ")}.`],
      ["blueprint-design-motion", "design-motion",
        `Motion character must be ${dna.motionStrategy}, and must respect prefers-reduced-motion.`],
      ["blueprint-design-rhythm", "design-spacing",
        `Use a ${String(dna.spacingRhythm).replaceAll("-", " ")} spacing rhythm derived from a single spacing scale.`],
      ["blueprint-design-surface-depth", "design-surface",
        `Render surfaces as ${String(dna.surfaceDepth).replaceAll("-", " ")}.`],
      ["blueprint-design-responsive-transform", "design-responsive",
        `On phone viewports the layout must ${String(dna.responsiveTransform).replaceAll("-", " ")} without horizontal overflow.`],
    ];
    for (const [id, kind, statement] of structural) {
      if (typeof statement === "string" && statement.trim().length > 2) {
        add(implementation, entry(id, kind, statement));
      }
    }
    for (const [index, exclusion] of (dna.exclusions ?? []).entries()) {
      add(exclusions, entry(`blueprint-design-exclusion-${index + 1}`, "design-exclusion", exclusion));
    }
  }
  for (const [index, requirement] of (design.accessibilityRequirements ?? design.accessibilityNeeds ?? []).entries()) {
    add(implementation, entry(`blueprint-design-accessibility-${index + 1}`, "design-accessibility", requirement));
  }
  if (typeof design.customerInstructions === "string" && design.customerInstructions.trim() !== "") {
    add(implementation, entry("blueprint-design-customer-instructions", "design-customer-instructions", design.customerInstructions));
  }
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
  if (contract.productBlueprint !== undefined) {
    const blueprint = contract.productBlueprint;
    add(implementation, entry(
      "approved-blueprint-version",
      "product-blueprint",
      `Product Blueprint version ${blueprint.blueprintVersion} integrity ${blueprint.integrityHash}. ${blueprint.productName}. ${blueprint.oneSentenceOutcome}`,
    ));
    add(implementation, entry(
      "approved-product-type",
      "product-type",
      `${blueprint.exactProductType}. ${blueprint.selectedSubtypes.join(". ")}`,
    ));
    blueprint.requiredSurfaces.forEach((surface, index) => add(
      implementation,
      entry(`blueprint-surface-${index + 1}`, "required-surface", surface),
    ));
    blueprint.selectedFeatures.forEach((feature, index) => add(
      implementation,
      entry(`blueprint-feature-${index + 1}`, "selected-feature", feature),
    ));
    blueprint.businessRules.forEach((rule, index) => add(
      implementation,
      entry(`blueprint-business-rule-${index + 1}`, "business-rule", rule),
    ));
    blueprint.integrations.forEach((integration, index) => add(
      implementation,
      entry(`blueprint-integration-${index + 1}`, "integration", integration),
    ));
    blueprint.architecture.forEach((decision, index) => add(
      implementation,
      entry(`blueprint-architecture-${index + 1}`, "architecture", decision),
    ));
    blueprint.acceptanceRequirements.forEach((requirement, index) => add(
      implementation,
      entry(`blueprint-acceptance-${index + 1}`, "acceptance", requirement),
    ));
    addBlueprintDesignRequirements(add, implementation, exclusions, blueprint);
    blueprint.excludedFromV1.forEach((statement, index) => add(
      exclusions,
      entry(`blueprint-exclusion-${index + 1}`, "blueprint-exclusion", statement),
    ));
    blueprint.rejectedRecommendations.forEach((statement, index) => add(
      exclusions,
      entry(`blueprint-rejected-${index + 1}`, "blueprint-rejected", statement),
    ));
  }
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
      entry(`approved-decision-${index + 1}`, "approved-decision", `${selection.value}. ${selection.reason}`),
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
    blueprintHash: contract.productBlueprint?.integrityHash ?? null,
    blueprintVersion: contract.productBlueprint?.blueprintVersion ?? null,
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
    "designFidelity",
    "requirementClaims",
    "explicitExclusionIds",
    "files",
  ],
  properties: {
    contractHash: { type: "string", minLength: 64 },
    contractVersion: { type: "integer" },
    supportedPlatform: { type: "string", minLength: 1 },
    designDirectionHash: { type: "string", minLength: 64 },
    designFidelity: DESIGN_FIDELITY_SCHEMA,
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
  exact(plan, ["contractHash", "contractVersion", "supportedPlatform", "designDirectionHash", "designFidelity", "requirementClaims", "explicitExclusionIds", "files"], "generatedMissionPlan");
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
    if (!preservesRequirementSubject(requirement, summary)) fail(`Generated mission plan reinterprets requirement "${requirementId}" without preserving its subject.`);
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
  const normalizedPlan = { ...plan, files };
  validateGeneratedDesignFidelity(normalizedPlan, contract, fail);
  const untraced = [...requiredById.keys()].filter((requirementId) => !traced.has(requirementId));
  if (untraced.length > 0) fail(`No generated file traces to approved requirements: ${untraced.join(", ")}.`);
  return freeze({
    contractHash: contract.contentHash,
    contractVersion: contract.contractVersion,
    supportedPlatform: contract.supportedPlatform,
    designDirectionHash: plan.designDirectionHash,
    designFidelity: structuredClone(plan.designFidelity),
    requirementClaims: [...claims].map(([requirementId, implementationSummary]) => ({ requirementId, implementationSummary })),
    explicitExclusionIds: actualExclusions,
    files,
  });
}

export function validateContractRequirementTrace(requirementIds, contractInput, allowedRequirementIds) {
  const catalogue = approvedContractRequirementCatalogue(contractInput);
  const approvedIds = new Set(catalogue.implementationRequirements.map((item) => item.requirementId));
  const allowedIds = new Set(uniqueIdentifiers(allowedRequirementIds, "allowedRequirementIds"));
  for (const requirementId of allowedIds) {
    if (!approvedIds.has(requirementId)) fail(`Repair scope references unknown requirement "${requirementId}".`);
  }
  const trace = uniqueIdentifiers(requirementIds, "contractRequirementIds");
  for (const requirementId of trace) {
    if (!allowedIds.has(requirementId)) fail(`Repair traces to requirement "${requirementId}" outside its approved task scope.`);
  }
  return freeze([...trace]);
}

export function createModelTaskContract({ approvedContract, routingRequirements, taskObjective, allowedScope, forbiddenChanges, relevantRequirementIds, currentCheckpoint, expectedOutputSchema }) {
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
      selectedDesignDirectionHash: approvedDesignDirectionHash(contract),
      designExecutionBrief: designExecutionBrief(contract),
      acceptedRecommendations: contract.acceptedRecommendations,
      rejectedRecommendations: contract.rejectedRecommendations,
      customerDecisions: contract.customerDecisions,
      foundryDecisions: contract.foundryDecisions,
      decisionSelections: contract.decisionSelections ?? [],
      productBlueprint: contract.productBlueprint ?? null,
      assumptions: contract.assumptions,
      explicitExclusions: contract.explicitExclusions,
      explicitExclusionIds: catalogue.exclusionRequirements.map((requirement) => requirement.requirementId),
      architectureConstraints: contract.architectureConstraints,
      supportedPlatform: contract.supportedPlatform,
      selectedStackCapability: contract.selectedStackCapability,
    },
    relevantRequirements,
    requiredImplementationRequirementIds: ids,
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
    "DESIGN-DIRECTED GENERATION — BINDING",
    "Implement the approved designExecutionBrief as the real structural design of the application, not as descriptive copy. Translate its composition, navigation, hierarchy, typography, color roles, spacing density, interaction behavior, imagery strategy, mobile transformation, accessibility requirements, and customer instructions into concrete source. The finished project must be recognizably the approved direction. Reusing a generic dashboard, card stack, or universal shell that merely changes colors or labels is a contract violation.",
    "The structured output must include designFidelity explaining exactly where each design rule is implemented. designFidelity.sourceFiles must identify the actual customer-facing layout and style files. Customer-facing source must contain an inspectable responsive strategy: an explicit breakpoint or container transformation, a wrapping/auto-fit layout, or intrinsic fluid sizing with a real maximum bound. The generated Playwright test must capture screenshots at both phone and desktop widths and must measure rendered composition, typography, color, and responsive transformation using real DOM/computed-style evidence. A screenshot alone is not a passing verdict, but screenshots are mandatory evidence for review and repair.",
    "Copy authoritative contractHash, contractVersion, supportedPlatform, designDirectionHash, and explicitExclusionIds values exactly from the binding task contract when the output schema requests them. Never calculate, abbreviate, or reinterpret those values. Return exactly one requirementClaims entry for every requiredImplementationRequirementIds value and trace every one of those identifiers to at least one generated file. Begin each implementationSummary by quoting the requirement's statement verbatim, then ' — implemented by ' and a concrete description of where and how it is implemented; never paraphrase the quoted statement, because admission verifies its exact words. For a production-build requirement, additionally describe the production compilation, packaging, or bundle.",
    "INSTRUCTIONS",
    ...instructions.map((instruction, index) => `${index + 1}. ${text(instruction, `instructions[${index}]`)}`),
    "Do not reinterpret the original request. Do not omit an approved requirement, add an unapproved major feature, change platform or design direction, ignore a customer message, violate an exclusion, or weaken verification.",
  ].join("\n\n");
}
