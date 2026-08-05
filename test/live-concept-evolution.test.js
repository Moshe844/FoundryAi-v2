import assert from "node:assert/strict";
import test from "node:test";

import { ConceptStrategy, createConceptPrototypeContract } from "../src/domain/live-concept-studio.js";
import { createConceptEvolutionService } from "../src/work-plane/concept-evolution-service.js";

function contract(id, overrides = {}) {
  return createConceptPrototypeContract({
    conceptId: id,
    missionId: "mission-evolution",
    conceptVersion: 1,
    conceptName: overrides.name ?? id,
    creativeThesis: overrides.thesis ?? "A useful project-specific direction.",
    intendedAudienceResponse: "Feel confident using the experience.",
    designRationale: "A deliberate working prototype.",
    projectSurfaces: ["Opening", "Work", "Action"],
    pageOrScreenSequence: ["Opening", "Work", "Action"],
    navigationModel: overrides.navigation ?? "Top navigation.",
    compositionRules: overrides.composition ?? ["Balanced grid."],
    typographySystem: { display: overrides.type ?? "Georgia", body: "Arial" },
    colorSystem: { background: "#ffffff", surface: "#eeeeee", text: "#111111", primary: "#222222", accent: "#aa4400" },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40] },
    imageryStrategy: overrides.imagery ?? "Framed project imagery.",
    componentCharacter: "Clear and composed.",
    interactionRules: ["Navigation reaches each surface."],
    motionRules: ["Use restrained transitions."],
    responsiveRules: overrides.responsive ?? ["Stack into one column."],
    accessibilityRules: ["Visible focus."],
    deliberateExclusions: ["No production integrations."],
    sampleContentPolicy: "Use fictional content.",
    expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [{ checkId: "browser", kind: "browser", statement: "Verify responsive browser evidence." }],
    sourceProjectDesignVersion: 1,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
  });
}

test("revision classification preserves unaffected contract fields and creates a later immutable version", () => {
  const service = createConceptEvolutionService();
  const source = contract("concept-a");
  const typographySource = contract("concept-c", { name: "Concept C", type: "Inter", composition: ["Dense sidebar grid."] });
  const result = service.revise({
    sourceConcept: source,
    availableConcepts: [source, typographySource],
    instruction: "Keep this layout but use the typography from Concept C and make mobile the priority.",
  });
  assert.equal(result.contract.conceptId, source.conceptId);
  assert.equal(result.contract.conceptVersion, 2);
  assert.equal(result.contract.strategy, ConceptStrategy.REVISION);
  assert.equal(result.contract.parentConceptId, source.conceptId);
  assert.deepEqual(result.contract.compositionRules, source.compositionRules);
  assert.deepEqual(result.contract.typographySystem, typographySource.typographySystem);
  assert.match(result.contract.responsiveRules.join(" "), /mobile as the primary/iu);
  assert.deepEqual([...result.classification.scopes].sort(), ["responsive", "typography"]);
});

test("composition reports incompatible traits plainly, then creates a real composition contract after resolution", () => {
  const service = createConceptEvolutionService();
  const editorial = contract("concept-editorial", { thesis: "Cinematic editorial story", composition: ["Full-screen editorial composition."] });
  const workspace = contract("concept-workspace", { navigation: "Permanent sidebar workspace navigation." });
  const input = {
    missionId: "mission-evolution",
    compositionId: "composition-one",
    sourceConcepts: [editorial, workspace],
    selectedTraits: [
      { trait: "composition", conceptId: editorial.conceptId },
      { trait: "imagery", conceptId: editorial.conceptId },
      { trait: "navigation", conceptId: workspace.conceptId },
      { trait: "typography", conceptId: workspace.conceptId },
    ],
    customerNotes: ["Keep the opening spacious."],
  };
  const conflict = service.compose(input);
  assert.equal(conflict.status, "CONFLICT");
  assert.match(conflict.conflicts[0].reason, /uninterrupted width/iu);
  const resolved = service.compose({
    ...input,
    conflictResolution: conflict.conflicts.map((entry) => ({ trait: entry.trait, resolution: entry.recommendation })),
  });
  assert.equal(resolved.status, "READY");
  assert.equal(resolved.contract.strategy, ConceptStrategy.COMPOSITION);
  assert.deepEqual(resolved.contract.sourceConceptIds, [editorial.conceptId, workspace.conceptId]);
  assert.match(resolved.contract.navigationModel, /overlay/iu);
  assert.equal(resolved.composition.selectedTraits.length, 4);
});
