import { createHash } from "node:crypto";

export const CONCEPT_PROTOTYPE_SCHEMA_VERSION = 1;
export const CONCEPT_COMPOSITION_SCHEMA_VERSION = 1;
export const APPROVED_DESIGN_CONTRACT_SCHEMA_VERSION = 1;

export const ConceptStrategy = Object.freeze({
  STANDARD: "standard",
  SHOCK: "shock",
  REVISION: "revision",
  COMPOSITION: "composition",
});

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;
const HASH = /^[a-f0-9]{64}$/u;
const STRATEGIES = new Set(Object.values(ConceptStrategy));

function fail(message) {
  throw new TypeError(`Live Concept Studio contract: ${message}`);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function identifier(value, label) {
  const normalized = text(value, label);
  if (!IDENTIFIER.test(normalized)) fail(`${label} must be a safe identifier.`);
  return normalized;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive integer.`);
  }
  return value;
}

function stringList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  }
  const normalized = value.map((item, index) => text(item, `${label}[${index}]`));
  if (new Set(normalized.map((item) => item.toLowerCase())).size !== normalized.length) {
    fail(`${label} contains duplicates.`);
  }
  return normalized;
}

function exactObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const entries = Object.entries(value);
  if (entries.length === 0) fail(`${label} must not be empty.`);
  return Object.fromEntries(
    entries.map(([key, item]) => [identifier(key, `${label} key`), text(item, `${label}.${key}`)]),
  );
}

function colorSystem(value, label) {
  const normalized = exactObject(value, label);
  for (const key of ["background", "surface", "text", "primary", "accent"]) {
    if (!Object.hasOwn(normalized, key)) fail(`${label}.${key} is required.`);
    if (!/^#[0-9a-f]{6}$/iu.test(normalized[key])) {
      fail(`${label}.${key} must be a six-digit hex color.`);
    }
  }
  return normalized;
}

function spacingSystem(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  if (!Number.isFinite(value.baseUnit) || value.baseUnit <= 0) {
    fail(`${label}.baseUnit must be positive.`);
  }
  if (
    !Array.isArray(value.scale) ||
    value.scale.length < 3 ||
    value.scale.some((item) => !Number.isFinite(item) || item <= 0)
  ) fail(`${label}.scale must contain at least three positive values.`);
  return { baseUnit: value.baseUnit, scale: [...value.scale] };
}

function relativePath(value, label) {
  const normalized = text(value, label).replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  ) fail(`${label} must remain inside the concept workspace.`);
  return normalized;
}

function route(value, label) {
  const normalized = text(value, label);
  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    fail(`${label} must be an origin-relative route.`);
  }
  return normalized;
}

function verificationPlan(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("verificationPlan must be a non-empty array.");
  }
  const checks = value.map((entry, index) => {
    const label = `verificationPlan[${index}]`;
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      fail(`${label} must be an object.`);
    }
    const keys = Object.keys(entry).sort().join(",");
    if (keys !== "checkId,kind,statement") {
      fail(`${label} must contain exactly checkId, kind, and statement.`);
    }
    const kind = text(entry.kind, `${label}.kind`);
    if (!new Set(["browser", "runtime", "security", "differentiation"]).has(kind)) {
      fail(`${label}.kind is unsupported.`);
    }
    return {
      checkId: identifier(entry.checkId, `${label}.checkId`),
      kind,
      statement: text(entry.statement, `${label}.statement`),
    };
  });
  if (new Set(checks.map((check) => check.checkId)).size !== checks.length) {
    fail("verificationPlan contains duplicate check IDs.");
  }
  return checks;
}

function prototypePayload(input) {
  const strategy = text(input.strategy, "strategy");
  if (!STRATEGIES.has(strategy)) fail("strategy is unsupported.");
  const conceptId = identifier(input.conceptId, "conceptId");
  const parentConceptId =
    input.parentConceptId === null
      ? null
      : identifier(input.parentConceptId, "parentConceptId");
  const sourceConceptIds = stringList(input.sourceConceptIds, "sourceConceptIds", {
    allowEmpty: true,
  }).map((value, index) => identifier(value, `sourceConceptIds[${index}]`));
  if (strategy === ConceptStrategy.REVISION && parentConceptId === null) {
    fail("revision concepts require parentConceptId.");
  }
  if (strategy === ConceptStrategy.COMPOSITION && sourceConceptIds.length < 2) {
    fail("composition concepts require at least two sourceConceptIds.");
  }
  if (sourceConceptIds.includes(conceptId)) {
    fail("a concept cannot reference itself as a composition source.");
  }
  if (parentConceptId === conceptId && (strategy !== ConceptStrategy.REVISION || input.conceptVersion < 2)) {
    fail("only a later revision version may reference its own stable concept ID as parent.");
  }
  return {
    schemaVersion: CONCEPT_PROTOTYPE_SCHEMA_VERSION,
    conceptId,
    missionId: identifier(input.missionId, "missionId"),
    conceptVersion: positiveInteger(input.conceptVersion, "conceptVersion"),
    conceptName: text(input.conceptName, "conceptName"),
    creativeThesis: text(input.creativeThesis, "creativeThesis"),
    intendedAudienceResponse: text(input.intendedAudienceResponse, "intendedAudienceResponse"),
    designRationale: text(input.designRationale, "designRationale"),
    projectSurfaces: stringList(input.projectSurfaces, "projectSurfaces"),
    pageOrScreenSequence: stringList(input.pageOrScreenSequence, "pageOrScreenSequence"),
    navigationModel: text(input.navigationModel, "navigationModel"),
    compositionRules: stringList(input.compositionRules, "compositionRules"),
    typographySystem: exactObject(input.typographySystem, "typographySystem"),
    colorSystem: colorSystem(input.colorSystem, "colorSystem"),
    spacingSystem: spacingSystem(input.spacingSystem, "spacingSystem"),
    imageryStrategy: text(input.imageryStrategy, "imageryStrategy"),
    componentCharacter: text(input.componentCharacter, "componentCharacter"),
    interactionRules: stringList(input.interactionRules, "interactionRules"),
    motionRules: stringList(input.motionRules, "motionRules"),
    responsiveRules: stringList(input.responsiveRules, "responsiveRules"),
    accessibilityRules: stringList(input.accessibilityRules, "accessibilityRules"),
    deliberateExclusions: stringList(input.deliberateExclusions, "deliberateExclusions"),
    sampleContentPolicy: text(input.sampleContentPolicy, "sampleContentPolicy"),
    expectedFiles: stringList(input.expectedFiles, "expectedFiles").map((value, index) =>
      relativePath(value, `expectedFiles[${index}]`),
    ),
    expectedPreviewRoutes: stringList(input.expectedPreviewRoutes, "expectedPreviewRoutes").map(
      (value, index) => route(value, `expectedPreviewRoutes[${index}]`),
    ),
    verificationPlan: verificationPlan(input.verificationPlan),
    sourceProjectDesignVersion: positiveInteger(
      input.sourceProjectDesignVersion,
      "sourceProjectDesignVersion",
    ),
    strategy,
    parentConceptId,
    sourceConceptIds,
  };
}

export function computeConceptPrototypeIntegrityHash(contract) {
  const payload = structuredClone(contract);
  delete payload.integrityHash;
  return sha256(payload);
}

export function createConceptPrototypeContract(input) {
  const payload = prototypePayload(input);
  return deepFreeze({
    ...payload,
    integrityHash: computeConceptPrototypeIntegrityHash(payload),
  });
}

export function normalizeConceptPrototypeContract(input) {
  const normalized = createConceptPrototypeContract(input);
  if (!HASH.test(input.integrityHash ?? "")) fail("integrityHash must be SHA-256.");
  if (normalized.integrityHash !== input.integrityHash) {
    fail("integrity hash does not match the concept contract.");
  }
  return Object.isFrozen(input) ? input : normalized;
}

function normalizeSelectedTraits(value, sourceIds) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("selectedTraits must be a non-empty array.");
  }
  const traits = value.map((entry, index) => {
    const label = `selectedTraits[${index}]`;
    const trait = identifier(entry?.trait, `${label}.trait`);
    const conceptId = identifier(entry?.conceptId, `${label}.conceptId`);
    if (!sourceIds.has(conceptId)) fail(`${label} references a concept outside the source concepts.`);
    return { trait, conceptId };
  });
  if (new Set(traits.map((entry) => entry.trait)).size !== traits.length) {
    fail("selectedTraits contains duplicate traits.");
  }
  return traits;
}

function normalizeConflicts(value, sourceIds) {
  if (!Array.isArray(value)) fail("conflicts must be an array.");
  return value.map((entry, index) => {
    const label = `conflicts[${index}]`;
    const conceptIds = stringList(entry?.conceptIds, `${label}.conceptIds`).map((conceptId) =>
      identifier(conceptId, `${label}.conceptIds`),
    );
    if (conceptIds.length < 2 || conceptIds.some((conceptId) => !sourceIds.has(conceptId))) {
      fail(`${label} must reference at least two source concepts.`);
    }
    return {
      trait: identifier(entry.trait, `${label}.trait`),
      conceptIds,
      reason: text(entry.reason, `${label}.reason`),
    };
  });
}

function normalizeConflictResolution(value, conflicts) {
  if (!Array.isArray(value)) fail("conflictResolution must be an array.");
  const resolutions = value.map((entry, index) => ({
    trait: identifier(entry?.trait, `conflictResolution[${index}].trait`),
    resolution: text(entry?.resolution, `conflictResolution[${index}].resolution`),
  }));
  const resolutionTraits = new Set(resolutions.map((entry) => entry.trait));
  for (const conflict of conflicts) {
    if (!resolutionTraits.has(conflict.trait)) {
      fail(`conflict "${conflict.trait}" has no resolution.`);
    }
  }
  return resolutions;
}

export function createConceptComposition(input) {
  const sourceConceptIds = stringList(input.sourceConceptIds, "sourceConceptIds").map(
    (value, index) => identifier(value, `sourceConceptIds[${index}]`),
  );
  if (sourceConceptIds.length < 2) fail("sourceConceptIds requires at least two concepts.");
  const sourceIds = new Set(sourceConceptIds);
  const conflicts = normalizeConflicts(input.conflicts, sourceIds);
  const payload = {
    schemaVersion: CONCEPT_COMPOSITION_SCHEMA_VERSION,
    compositionId: identifier(input.compositionId, "compositionId"),
    missionId: identifier(input.missionId, "missionId"),
    sourceConceptIds,
    selectedTraits: normalizeSelectedTraits(input.selectedTraits, sourceIds),
    conflicts,
    conflictResolution: normalizeConflictResolution(input.conflictResolution, conflicts),
    resultingDesignSystem: exactObject(input.resultingDesignSystem, "resultingDesignSystem"),
    resultingComposition: stringList(input.resultingComposition, "resultingComposition"),
    resultingResponsiveBehavior: stringList(
      input.resultingResponsiveBehavior,
      "resultingResponsiveBehavior",
    ),
    customerNotes: stringList(input.customerNotes, "customerNotes", { allowEmpty: true }),
    rationale: text(input.rationale, "rationale"),
    createdAt: input.createdAt === undefined ? new Date().toISOString() : text(input.createdAt, "createdAt"),
  };
  return deepFreeze({ ...payload, integrityHash: sha256(payload) });
}

function fileManifest(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("prototypeFileManifest must be a non-empty array.");
  }
  const manifest = value.map((entry, index) => {
    const label = `prototypeFileManifest[${index}]`;
    const contentHash = text(entry?.contentHash, `${label}.contentHash`);
    if (!HASH.test(contentHash)) fail(`${label}.contentHash must be SHA-256.`);
    if (!Number.isSafeInteger(entry?.size) || entry.size < 0) {
      fail(`${label}.size must be a non-negative integer.`);
    }
    return {
      path: relativePath(entry.path, `${label}.path`),
      contentHash,
      size: entry.size,
    };
  });
  if (new Set(manifest.map((entry) => entry.path.toLowerCase())).size !== manifest.length) {
    fail("prototypeFileManifest contains duplicate paths.");
  }
  return manifest.sort((left, right) => left.path.localeCompare(right.path));
}

function approvedPayload(input) {
  const selected = normalizeConceptPrototypeContract(input.selectedConcept);
  const missionId = identifier(input.missionId, "missionId");
  if (selected.missionId !== missionId) fail("selected concept belongs to another mission.");
  const manifest = fileManifest(input.prototypeFileManifest);
  const expectedPaths = [...selected.expectedFiles].sort();
  if (
    manifest.length !== expectedPaths.length ||
    manifest.some((entry, index) => entry.path !== expectedPaths[index])
  ) fail("prototypeFileManifest does not match the selected concept expected files.");
  const approvalTimestamp = text(input.approvalTimestamp, "approvalTimestamp");
  if (Number.isNaN(Date.parse(approvalTimestamp))) fail("approvalTimestamp must be ISO-8601.");
  const prototypeContentHash = input.prototypeContentHash ?? sha256(
    manifest.map(({ path, contentHash, size }) => ({ path, contentHash, size })),
  );
  if (!HASH.test(prototypeContentHash)) fail("prototypeContentHash must be SHA-256.");
  return {
    schemaVersion: APPROVED_DESIGN_CONTRACT_SCHEMA_VERSION,
    approvedDesignId: `approved-${selected.conceptId}-v${selected.conceptVersion}`,
    missionId,
    selectedConceptId: selected.conceptId,
    selectedConceptVersion: selected.conceptVersion,
    creativeThesis: selected.creativeThesis,
    approvedSurfaceSequence: [...selected.pageOrScreenSequence],
    compositionRules: [...selected.compositionRules],
    navigation: selected.navigationModel,
    typography: structuredClone(selected.typographySystem),
    colorTokens: structuredClone(selected.colorSystem),
    spacingTokens: structuredClone(selected.spacingSystem),
    imagery: selected.imageryStrategy,
    components: selected.componentCharacter,
    interactions: [...selected.interactionRules],
    motion: [...selected.motionRules],
    responsiveBehavior: [...selected.responsiveRules],
    accessibility: [...selected.accessibilityRules],
    customerModifications: stringList(
      input.customerModifications,
      "customerModifications",
      { allowEmpty: true },
    ),
    explicitExclusions: [...selected.deliberateExclusions],
    prototypeFileManifest: manifest,
    screenshotEvidenceReferences: stringList(
      input.screenshotEvidenceReferences,
      "screenshotEvidenceReferences",
    ),
    browserEvidenceReferences: stringList(
      input.browserEvidenceReferences,
      "browserEvidenceReferences",
    ),
    prototypeIntegrityHash: selected.integrityHash,
    prototypeContentHash,
    approvalTimestamp,
  };
}

export function computeApprovedDesignIntegrityHash(contract) {
  const payload = structuredClone(contract);
  delete payload.integrityHash;
  return sha256(payload);
}

export function createApprovedDesignContract(input) {
  const payload = approvedPayload(input);
  return deepFreeze({
    ...payload,
    integrityHash: computeApprovedDesignIntegrityHash(payload),
  });
}

export function normalizeApprovedDesignContract(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    fail("ApprovedDesignContract must be an object.");
  }
  if (input.schemaVersion !== APPROVED_DESIGN_CONTRACT_SCHEMA_VERSION) {
    fail("ApprovedDesignContract schemaVersion is unsupported.");
  }
  if (!HASH.test(input.integrityHash ?? "")) fail("integrityHash must be SHA-256.");
  if (computeApprovedDesignIntegrityHash(input) !== input.integrityHash) {
    fail("integrity hash does not match the approved design contract.");
  }
  if (!HASH.test(input.prototypeIntegrityHash ?? "")) {
    fail("prototypeIntegrityHash must be SHA-256.");
  }
  if (!HASH.test(input.prototypeContentHash ?? "")) {
    fail("prototypeContentHash must be SHA-256.");
  }
  fileManifest(input.prototypeFileManifest);
  return Object.isFrozen(input) ? input : deepFreeze(structuredClone(input));
}

export function designFidelityRequiresPrototypeEvidence(designSpecification) {
  const approved = designSpecification?.approvedDesignContract;
  if (approved === null || approved === undefined) return false;
  normalizeApprovedDesignContract(approved);
  return true;
}
