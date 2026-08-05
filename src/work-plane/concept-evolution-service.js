import {
  ConceptStrategy,
  createConceptComposition,
  createConceptPrototypeContract,
  normalizeConceptPrototypeContract,
} from "../domain/live-concept-studio.js";

const TRAIT_FIELDS = Object.freeze({
  composition: ["projectSurfaces", "pageOrScreenSequence", "compositionRules"],
  navigation: ["navigationModel"],
  typography: ["typographySystem"],
  color: ["colorSystem"],
  spacing: ["spacingSystem"],
  imagery: ["imageryStrategy"],
  components: ["componentCharacter"],
  interactions: ["interactionRules"],
  motion: ["motionRules"],
  responsive: ["responsiveRules"],
});

function fail(message) {
  throw new TypeError(`Concept evolution: ${message}`);
}

function instructionText(value) {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 2_000) {
    fail("instruction must contain 2 to 2,000 characters.");
  }
  return value.trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function classifyRevision(instruction, concepts) {
  const lower = instruction.toLowerCase();
  const scopes = [];
  const rules = [
    ["navigation", "navigation|nav|menu|sidebar"],
    ["typography", "typography|typeface|font|fonts"],
    ["color", "colou?r|palette|brand"],
    ["spacing", "spacing|whitespace|roomier|tighter"],
    ["imagery", "image|images|imagery|photo|photos|gallery"],
    ["motion", "animation|motion|transition"],
    ["responsive", "mobile|tablet|responsive"],
    ["composition", "layout|composition|opening|hero|sequence|section"],
    ["components", "premium|calmer|calm|character|card|button|sidebar"],
    ["interactions", "interaction|click|hover|filter|form"],
  ];
  const referencedScopes = [];
  for (const [scope, terms] of rules) {
    const mentioned = new RegExp(`\\b(?:${terms})\\b`, "iu").test(lower);
    const kept = new RegExp(`\\bkeep\\b[^.]{0,48}\\b(?:${terms})\\b`, "iu").test(lower);
    const sourced = new RegExp(`\\b(?:${terms})\\b(?:\\s+[a-z&-]+){0,2}\\s+\\bfrom\\b`, "iu").test(lower);
    if (mentioned && (!kept || sourced)) scopes.push(scope);
    if (sourced) referencedScopes.push(scope);
  }
  if (scopes.length === 0) scopes.push("components");
  let referenced = null;
  const requestedVersion = /\b(?:version|v)\s*(\d+)\b/iu.exec(instruction)?.[1];
  for (const concept of concepts) {
    const candidates = [concept.conceptId, concept.conceptName].map((value) => value.toLowerCase());
    if (
      candidates.some((value) => lower.includes(value)) &&
      (requestedVersion === undefined || concept.conceptVersion === Number(requestedVersion))
    ) referenced = concept;
    const label = /(?:concept|direction)\s+([a-z0-9-]+)/iu.exec(instruction)?.[1]?.toLowerCase();
    if (label !== undefined && (concept.conceptId.toLowerCase().endsWith(label) || concept.conceptName.toLowerCase() === label)) {
      referenced = concept;
    }
  }
  return Object.freeze({
    scopes: Object.freeze(unique(scopes)),
    referencedScopes: Object.freeze(unique(referencedScopes)),
    referencedConcept: referenced,
  });
}

function copy(value) {
  return structuredClone(value);
}

function applyReference(next, scope, referenced) {
  if (referenced === null) return;
  for (const field of TRAIT_FIELDS[scope] ?? []) next[field] = copy(referenced[field]);
}

function revisionContract({ sourceConcept: sourceInput, instruction: input, availableConcepts = [], targetConceptVersion }) {
  const source = normalizeConceptPrototypeContract(sourceInput);
  const instruction = instructionText(input);
  const candidates = availableConcepts.map(normalizeConceptPrototypeContract);
  if (candidates.some((entry) => entry.missionId !== source.missionId)) fail("available concepts must belong to the same mission.");
  const classification = classifyRevision(instruction, candidates.filter(
    (entry) => entry.conceptId !== source.conceptId || entry.conceptVersion !== source.conceptVersion,
  ));
  const next = copy(source);
  delete next.schemaVersion;
  delete next.integrityHash;
  const nextVersion = targetConceptVersion ?? source.conceptVersion + 1;
  if (!Number.isSafeInteger(nextVersion) || nextVersion <= source.conceptVersion) fail("targetConceptVersion must be later than the source version.");
  next.conceptVersion = nextVersion;
  next.strategy = ConceptStrategy.REVISION;
  next.parentConceptId = source.conceptId;
  next.sourceConceptIds = [];
  next.designRationale = `${source.designRationale} Customer revision: ${instruction}`;
  for (const scope of classification.referencedScopes) applyReference(next, scope, classification.referencedConcept);
  const lower = instruction.toLowerCase();
  if (/\b(?:reduce|less|remove)\b.*\b(?:animation|motion)\b|\b(?:animation|motion)\b.*\b(?:reduce|less|remove)\b/u.test(lower)) {
    next.motionRules = ["Use only functional state transitions.", "Honor prefers-reduced-motion and remove decorative animation."];
  }
  if (/\bmobile\b.*\b(?:first|priority|priorit)/u.test(lower)) {
    next.responsiveRules = unique(["Treat mobile as the primary composition and progressively enhance wider screens.", ...next.responsiveRules]);
  }
  if (/\b(?:larger|bigger|full[- ]?bleed)\b.*\b(?:image|images|imagery|photo|photos)\b|\b(?:image|images|imagery|photo|photos)\b.*\b(?:larger|bigger|full[- ]?bleed)\b/u.test(lower)) {
    next.imageryStrategy = `${next.imageryStrategy} Make representative imagery materially larger and give key images dominant visual weight.`;
  }
  if (/\bremove\b.*\bsidebar\b/u.test(lower)) {
    next.navigationModel = "Use compact top navigation without a sidebar.";
    next.deliberateExclusions = unique([...next.deliberateExclusions, "No sidebar navigation."]);
  }
  if (/\bcalmer|\bcalm\b/u.test(lower)) next.componentCharacter = `${next.componentCharacter} Calmer, quieter, and lower contrast in density.`;
  if (/\bpremium|luxur/u.test(lower)) next.componentCharacter = `${next.componentCharacter} Premium through restraint, material detail, and exact spacing.`;
  const hex = instruction.match(/#[0-9a-f]{6}\b/giu) ?? [];
  if (hex.length > 0) next.colorSystem = { ...next.colorSystem, primary: hex[0], accent: hex[1] ?? hex[0] };
  return Object.freeze({
    contract: createConceptPrototypeContract(next),
    classification: Object.freeze({ scopes: classification.scopes, referencedConceptId: classification.referencedConcept?.conceptId ?? null }),
    changedSummary: Object.freeze(classification.scopes.map((scope) => `${scope}: ${instruction}`)),
  });
}

function conflictsFor(selectedTraits, byId) {
  const selected = new Map(selectedTraits.map((entry) => [entry.trait, byId.get(entry.conceptId)]));
  const composition = selected.get("composition");
  const navigation = selected.get("navigation");
  const conflicts = [];
  if (
    composition !== undefined && navigation !== undefined && composition.conceptId !== navigation.conceptId &&
    /editorial|cinematic|full[- ]?screen|story/iu.test(`${composition.creativeThesis} ${composition.compositionRules.join(" ")}`) &&
    /sidebar|dense|workspace/iu.test(navigation.navigationModel)
  ) {
    conflicts.push({
      trait: "composition-navigation",
      conceptIds: [composition.conceptId, navigation.conceptId],
      reason: "The immersive composition needs uninterrupted width, while the selected navigation reserves permanent sidebar space.",
      recommendation: `Keep ${navigation.conceptName}'s navigation behavior, but collapse it into an overlay so ${composition.conceptName}'s composition remains intact.`,
    });
  }
  const responsive = selected.get("responsive");
  if (
    responsive !== undefined && navigation !== undefined && responsive.conceptId !== navigation.conceptId &&
    /sidebar/iu.test(navigation.navigationModel) && !/collapse|drawer|overlay/iu.test(responsive.responsiveRules.join(" "))
  ) {
    conflicts.push({
      trait: "navigation-responsive",
      conceptIds: [navigation.conceptId, responsive.conceptId],
      reason: "The selected mobile behavior does not define how the sidebar navigation transforms on small screens.",
      recommendation: "Collapse the sidebar into a keyboard-accessible mobile drawer.",
    });
  }
  return conflicts;
}

function compositionContract({ missionId, compositionId, sourceConcepts: sourceInputs, selectedTraits, customerNotes = [], conflictResolution = [], targetConceptVersion = 1 }) {
  const sources = sourceInputs.map(normalizeConceptPrototypeContract);
  if (sources.length < 2) fail("at least two source concepts are required.");
  if (sources.some((source) => source.missionId !== missionId)) fail("source concepts must belong to the mission.");
  const byId = new Map(sources.map((source) => [source.conceptId, source]));
  if (!Array.isArray(selectedTraits) || selectedTraits.length === 0) fail("selectedTraits is required.");
  for (const entry of selectedTraits) {
    if (!Object.hasOwn(TRAIT_FIELDS, entry?.trait) || !byId.has(entry?.conceptId)) fail("selectedTraits contains an unsupported trait or source.");
  }
  const conflicts = conflictsFor(selectedTraits, byId);
  if (conflicts.length > 0 && conflictResolution.length === 0) {
    return Object.freeze({ status: "CONFLICT", conflicts: Object.freeze(conflicts), composition: null, contract: null });
  }
  const resolutions = conflicts.map((conflict) => ({
    trait: conflict.trait,
    resolution: conflictResolution.find((entry) => entry.trait === conflict.trait)?.resolution ?? conflict.recommendation,
  }));
  const base = sources[0];
  const composition = createConceptComposition({
    compositionId,
    missionId,
    sourceConceptIds: sources.map((source) => source.conceptId),
    selectedTraits,
    conflicts: conflicts.map(({ recommendation: _recommendation, ...conflict }) => conflict),
    conflictResolution: resolutions,
    resultingDesignSystem: Object.fromEntries(selectedTraits.map((entry) => [entry.trait, entry.conceptId])),
    resultingComposition: selectedTraits.some((entry) => entry.trait === "composition")
      ? selectedTraits.filter((entry) => entry.trait === "composition").map((entry) => `Composition from ${entry.conceptId}`)
      : [`Composition preserved from ${base.conceptId}`],
    resultingResponsiveBehavior: selectedTraits.some((entry) => entry.trait === "responsive")
      ? selectedTraits.filter((entry) => entry.trait === "responsive").map((entry) => `Responsive behavior from ${entry.conceptId}`)
      : [`Responsive behavior preserved from ${base.conceptId}`],
    customerNotes,
    rationale: `Combine explicitly selected qualities from ${sources.map((source) => source.conceptName).join(" and ")}.`,
  });
  const next = copy(base);
  delete next.schemaVersion;
  delete next.integrityHash;
  next.conceptId = compositionId;
  if (!Number.isSafeInteger(targetConceptVersion) || targetConceptVersion < 1) fail("targetConceptVersion must be a positive integer.");
  next.conceptVersion = targetConceptVersion;
  next.conceptName = `Combined: ${sources.map((source) => source.conceptName).join(" + ")}`;
  next.creativeThesis = composition.rationale;
  next.designRationale = `${composition.rationale} ${resolutions.map((entry) => entry.resolution).join(" ")}`.trim();
  next.strategy = ConceptStrategy.COMPOSITION;
  next.parentConceptId = null;
  next.sourceConceptIds = [...composition.sourceConceptIds];
  for (const selection of selectedTraits) {
    const source = byId.get(selection.conceptId);
    for (const field of TRAIT_FIELDS[selection.trait]) next[field] = copy(source[field]);
  }
  if (resolutions.some((entry) => entry.trait === "composition-navigation")) next.navigationModel = `${next.navigationModel} On constrained widths, preserve the composition with an overlay navigation treatment.`;
  if (resolutions.some((entry) => entry.trait === "navigation-responsive")) next.responsiveRules = unique([...next.responsiveRules, "Collapse sidebar navigation into a keyboard-accessible mobile drawer."]);
  return Object.freeze({ status: "READY", conflicts: Object.freeze(conflicts), composition, contract: createConceptPrototypeContract(next) });
}

function shockContract({ sourceConcept: sourceInput, shockConceptId = "shock-concept", targetConceptVersion = 1 }) {
  const source = normalizeConceptPrototypeContract(sourceInput);
  if (!Number.isSafeInteger(targetConceptVersion) || targetConceptVersion < 1) fail("targetConceptVersion must be a positive integer.");
  const next = copy(source);
  delete next.schemaVersion;
  delete next.integrityHash;
  next.conceptId = shockConceptId;
  next.conceptVersion = targetConceptVersion;
  next.conceptName = `Uncommon: ${source.conceptName}`;
  next.creativeThesis = `Pursue a surprising but purposeful alternative to the safest common pattern while preserving: ${source.creativeThesis}`;
  next.designRationale = "Use memorable hierarchy, uncommon but usable sequencing, and strong art direction without arbitrary novelty or loss of the primary workflow.";
  next.compositionRules = unique([
    "Avoid the most common template composition for this product type.",
    "Use an uncommon but purposeful composition with one memorable hierarchy move.",
    ...source.compositionRules,
  ]);
  next.typographySystem = {
    ...next.typographySystem,
    originality: "Use distinctive, accessible typography treatment with a deliberate contrast in voice and scale.",
  };
  next.imageryStrategy = `${source.imageryStrategy} Use a distinctive project-appropriate treatment that changes the sequence, crop logic, or relationship to type rather than merely recoloring it.`;
  next.componentCharacter = `${source.componentCharacter} Memorable and art-directed, with no generic SaaS shell and no arbitrary novelty.`;
  next.interactionRules = unique([
    "Include one unexpected but understandable interaction or content-reveal sequence.",
    ...source.interactionRules,
  ]);
  next.motionRules = unique([
    "Use motion only when it reinforces the surprising hierarchy or sequencing.",
    ...source.motionRules,
  ]);
  next.responsiveRules = unique([
    "Preserve the central creative idea on mobile instead of collapsing into a generic stack.",
    ...source.responsiveRules,
  ]);
  next.accessibilityRules = [...source.accessibilityRules];
  next.deliberateExclusions = unique([
    ...source.deliberateExclusions,
    "No generic SaaS shell.",
    "No arbitrary novelty that obscures a required workflow.",
  ]);
  next.strategy = ConceptStrategy.SHOCK;
  next.parentConceptId = null;
  next.sourceConceptIds = [source.conceptId];
  return Object.freeze({
    contract: createConceptPrototypeContract(next),
    classification: Object.freeze({
      scopes: Object.freeze(["composition", "typography", "imagery", "interactions", "motion", "responsive"]),
      referencedConceptId: source.conceptId,
    }),
  });
}

export function createConceptEvolutionService() {
  return Object.freeze({ revise: revisionContract, compose: compositionContract, shock: shockContract });
}
