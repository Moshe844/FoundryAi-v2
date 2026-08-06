import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ConceptStrategy,
  createApprovedDesignContract,
  createConceptComposition,
  createConceptPrototypeContract,
  designFidelityRequiresPrototypeEvidence,
  normalizeApprovedDesignContract,
  normalizeConceptPrototypeContract,
} from "../src/domain/live-concept-studio.js";
import { designExecutionBrief } from "../src/domain/design-fidelity.js";

function prototype(overrides = {}) {
  return createConceptPrototypeContract({
    conceptId: "concept-quiet-archive",
    missionId: "mission-photographer",
    conceptVersion: 1,
    conceptName: "Quiet Archive",
    creativeThesis: "Treat each commercial assignment as a precise visual case study.",
    intendedAudienceResponse: "Trust the photographer before opening the inquiry form.",
    designRationale: "A restrained archive keeps imagery dominant while preserving commercial clarity.",
    projectSurfaces: ["Portfolio index", "Project story", "Inquiry"],
    pageOrScreenSequence: ["Opening image", "Selected assignments", "Client context", "Inquiry"],
    navigationModel: "Persistent project index with direct inquiry access.",
    compositionRules: ["Use an asymmetric editorial grid.", "Keep imagery larger than supporting copy."],
    typographySystem: {
      display: "Newsreader",
      body: "Inter",
      scale: "dramatic-editorial",
    },
    colorSystem: {
      background: "#111111",
      surface: "#1d1d1d",
      text: "#f4f1ea",
      primary: "#f4f1ea",
      accent: "#d8b48a",
    },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40, 64, 96] },
    imageryStrategy: "Full-bleed commercial photography with quiet captions.",
    componentCharacter: "Editorial, image-led, and sharply ruled.",
    interactionRules: ["Project tiles open without losing the archive position."],
    motionRules: ["Use restrained opacity and position transitions.", "Honor reduced motion."],
    responsiveRules: ["Collapse the asymmetric grid into an image-first single column."],
    accessibilityRules: ["Visible focus states.", "Descriptive image alternatives."],
    deliberateExclusions: ["No generic agency hero.", "No auto-playing carousel."],
    sampleContentPolicy: "Use clearly fictional commercial assignments without customer facts.",
    expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [
      { checkId: "loads", kind: "runtime", statement: "The concept loads without blocking errors." },
      { checkId: "responsive", kind: "browser", statement: "Desktop, tablet, and mobile render without overflow." },
    ],
    sourceProjectDesignVersion: 3,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
    ...overrides,
  });
}

test("ConceptPrototypeContract is exact, immutable, and tamper evident", () => {
  const contract = prototype();

  assert.equal(contract.integrityHash.length, 64);
  assert.ok(Object.isFrozen(contract));
  assert.ok(Object.isFrozen(contract.verificationPlan));
  assert.equal(normalizeConceptPrototypeContract(contract), contract);

  const tampered = structuredClone(contract);
  tampered.navigationModel = "A generic top navigation.";
  assert.throws(
    () => normalizeConceptPrototypeContract(tampered),
    /integrity hash/iu,
  );
});

test("shock concepts remain contract-bound instead of becoming random novelty", () => {
  const shock = prototype({
    conceptId: "concept-shock",
    conceptName: "Unexpected Sequence",
    strategy: ConceptStrategy.SHOCK,
    compositionRules: ["Use an uncommon but purposeful spatial sequence."],
    deliberateExclusions: ["No arbitrary novelty.", "No generic SaaS shell."],
  });

  assert.equal(shock.strategy, "shock");
  assert.ok(shock.projectSurfaces.length > 0);
  assert.ok(shock.responsiveRules.length > 0);
  assert.ok(shock.accessibilityRules.length > 0);
  assert.ok(shock.deliberateExclusions.includes("No arbitrary novelty."));
});

test("ConceptComposition records sources, selected traits, and conflict resolution", () => {
  const composition = createConceptComposition({
    compositionId: "composition-a-b",
    missionId: "mission-photographer",
    sourceConceptIds: ["concept-a", "concept-b"],
    selectedTraits: [
      { trait: "opening-and-imagery", conceptId: "concept-a" },
      { trait: "navigation", conceptId: "concept-b" },
    ],
    conflicts: [
      {
        trait: "mobile-navigation",
        conceptIds: ["concept-a", "concept-b"],
        reason: "One concept uses overlay navigation while the other requires persistent tabs.",
      },
    ],
    conflictResolution: [
      {
        trait: "mobile-navigation",
        resolution: "Keep Concept B tabs on mobile and use Concept A overlay only on desktop.",
      },
    ],
    resultingDesignSystem: { typography: "concept-a", navigation: "concept-b" },
    resultingComposition: ["Concept A opening", "Concept B project index"],
    resultingResponsiveBehavior: ["Persistent tabs below 768px."],
    customerNotes: ["Make the images much larger."],
    rationale: "The combination preserves cinematic imagery without sacrificing orientation.",
  });

  assert.equal(composition.integrityHash.length, 64);
  assert.equal(composition.selectedTraits[1].conceptId, "concept-b");
  assert.throws(
    () => createConceptComposition({
      ...structuredClone(composition),
      integrityHash: undefined,
      selectedTraits: [{ trait: "typography", conceptId: "concept-missing" }],
    }),
    /source concept/iu,
  );
});

test("ApprovedDesignContract freezes selected prototype evidence without promoting prototype code", () => {
  const selected = prototype();
  const approved = createApprovedDesignContract({
    missionId: selected.missionId,
    selectedConcept: selected,
    customerModifications: ["Reduce the opening transition duration."],
    prototypeFileManifest: [
      { path: "index.html", contentHash: "a".repeat(64), size: 1400 },
      { path: "styles.css", contentHash: "b".repeat(64), size: 3200 },
      { path: "concept.js", contentHash: "c".repeat(64), size: 480 },
    ],
    screenshotEvidenceReferences: ["evidence://concept/desktop", "evidence://concept/mobile"],
    browserEvidenceReferences: ["evidence://concept/browser-verification"],
    prototypeContentHash: "d".repeat(64),
    approvalTimestamp: "2026-08-04T20:00:00.000Z",
  });

  assert.equal(approved.selectedConceptId, selected.conceptId);
  assert.equal(approved.selectedConceptVersion, 1);
  assert.equal(approved.prototypeIntegrityHash, selected.integrityHash);
  assert.equal(approved.prototypeFileManifest.length, 3);
  assert.equal(approved.prototypeContentHash, "d".repeat(64));
  assert.equal(normalizeApprovedDesignContract(approved), approved);
  assert.ok(Object.isFrozen(approved));
  assert.ok(designFidelityRequiresPrototypeEvidence({ approvedDesignContract: approved }));
  assert.equal(
    designFidelityRequiresPrototypeEvidence({ renderContract: { renderContractId: "legacy-wireframe" } }),
    false,
  );
});

test("legacy visual-direction metadata cannot activate prototype fidelity gates", () => {
  const brief = designExecutionBrief({
    productBlueprint: {
      designSpecification: {
        selectedDirectionName: "Legacy visual direction",
        visualPersonality: "Editorial",
        renderContract: {
          renderContractId: "legacy-wireframe",
          productRenderSpec: {
            screens: [
              {
                id: "open-the-catalogue",
                regions: [{ id: "open-the-catalogue-search-and-filter" }],
              },
            ],
          },
        },
      },
    },
    selectedDesignDirection: {
      visualPersonality: "Editorial",
      layoutStrategy: "Image led",
      navigationApproach: "Inline",
      informationDensity: "Spacious",
      tone: "Calm",
      accessibilityNeeds: ["Visible focus"],
    },
  });

  assert.equal(brief.renderContract, null);
  assert.equal(brief.approvedDesignContract, null);
});

test("a studio offers the concepts it proved rather than failing over one it did not", async () => {
  // The real failure: two concepts were generated, browser-admitted at phone,
  // tablet and desktop, and ready to choose between. A third tripped the
  // prototype CSP, and the studio discarded all of it — the customer saw a
  // paused session and a stylesheet error about a concept they never asked
  // for. Three directions are what Foundry aims for, not what a choice needs.
  const server = await readFile(
    new URL("../apps/web/local-api/server.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    server,
    /if \(admitted\.length < 2\) \{/u,
    "a studio must fail only when it cannot offer a choice",
  );
  assert.doesNotMatch(
    server,
    /admitted\.length !== 3/u,
    "requiring exactly three concepts discards proven work",
  );
  // A single concept's failure must no longer end the session before the
  // admitted ones are counted.
  const completion = server.slice(
    server.indexOf("const admitted = session.concepts.filter"),
    server.indexOf("const differentiation = verifyStudioDifferentiation"),
  );
  assert.doesNotMatch(completion, /^\s*if \(firstError !== null\) throw firstError;/mu);
  assert.match(completion, /throw firstError \?\?/u, "the cause is still reported when there is no choice");
});
