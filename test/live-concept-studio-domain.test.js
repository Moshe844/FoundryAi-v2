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

test("a refused concept is told what overflowed and by how much", async () => {
  // Horizontal overflow is the most common reason a concept is refused, and
  // "horizontal overflow detected" told the regeneration nothing it did not
  // already know: one concept was refused twice for the identical finding, and
  // the studio fell below the two directions a choice requires.
  const service = await readFile(
    new URL("../src/work-plane/prototype-verification-service.js", import.meta.url),
    "utf8",
  );
  const verifier = await readFile(
    new URL("../src/work-plane/prototype-browser-verifier.js", import.meta.url),
    "utf8",
  );
  const generation = await readFile(
    new URL("../src/work-plane/prototype-generation-service.js", import.meta.url),
    "utf8",
  );

  // The measurement must identify the offending elements, not only that the
  // page is too wide.
  assert.match(verifier, /overflowingElements/u);
  assert.match(verifier, /box\.right > viewportWidth \+ 1/u);

  // The finding must carry the amount and the widest offenders.
  assert.match(service, /content is \$\{excess\}px wider than the \$\{measurement\.clientWidth\}px viewport/u);
  assert.match(service, /Widest offenders: \$\{offenders\}/u);
  assert.match(service, /max-width:100%/u);

  // And the generator is told the rule before it writes anything, since a
  // refused concept costs the studio a direction.
  assert.match(generation, /opened at 390px, 768px and 1280px wide and is refused if anything overflows/u);
  assert.match(generation, /min-width:0/u);
});

test("the studio's own screen accepts the choice the server admitted", async () => {
  // The server admits a session once it can offer a choice — two proven
  // directions — but the screen still required three. A READY studio therefore
  // rendered its concepts with the continue button reading "Building live
  // concepts…", so a direction could be selected and the customer had no way
  // to go on. The two rules must agree.
  const screen = await readFile(
    new URL("../apps/web/app/components/project-discovery.tsx", import.meta.url),
    "utf8",
  );
  const server = await readFile(
    new URL("../apps/web/local-api/server.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    screen,
    /verificationStatus === "PASSED",\s*\n\s*\)\.length >= 2;/u,
    "the screen must continue on the same minimum the server admits",
  );
  assert.match(server, /if \(admitted\.length < 2\) \{/u);
  assert.doesNotMatch(screen, /\)\.length >= 3;/u);
});

test("three directions may not share a composition", async () => {
  // A warehouse tracker was offered three directions built on two primitives
  // between them, every one a table with filters. The prompt asked for
  // different colour, typography and density — which restyles the same page —
  // and never said the composition itself had to differ. Fifteen primitives
  // exist and only the two marketing ones are ever ruled out.
  const { assessCreativeDirectionSet } = await import(
    "../src/domain/creative-direction-quality.js"
  );
  const direction = (name, primitive, overrides = {}) => ({
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    rationale: `${name} suits this warehouse team's daily stock maintenance work.`,
    tradeoff: `${name} trades some density for clarity in the primary flow.`,
    creativeDNA: { compositionPrimitive: primitive },
    visualSystem: {
      layoutType: primitive,
      navigationType: overrides.nav ?? "top-bar",
      typographyCategory: overrides.type ?? "grotesque-neutral",
      density: overrides.density ?? "balanced",
      ...overrides.system,
    },
  });

  const sameComposition = [
    direction("Operations Table", "table-operations", { nav: "top-bar" }),
    direction("Stock Ledger", "table-operations", { nav: "side-rail", type: "humanist-warm" }),
    direction("Guided Flow", "guided-flow", { density: "airy" }),
  ];
  const shared = assessCreativeDirectionSet(sameComposition);
  const issue = shared.issues.find((entry) => entry.code === "shared-composition");
  assert.ok(issue, "two directions sharing a composition must be rejected");
  assert.match(issue.message, /the choice between them is cosmetic/u);
  assert.deepEqual(issue.directionIds.sort(), ["operations-table", "stock-ledger"]);
  assert.equal(shared.publishable, false);

  // Three genuinely different compositions raise no such issue.
  const distinct = [
    direction("Operations Table", "table-operations"),
    direction("Aisle Map", "map-led", { nav: "side-rail", type: "humanist-warm" }),
    direction("Stock Story", "narrative-scroll", { density: "airy", type: "editorial-serif" }),
  ];
  assert.equal(
    assessCreativeDirectionSet(distinct).issues.filter(
      (entry) => entry.code === "shared-composition",
    ).length,
    0,
  );

  // And the generator is told this before it writes, with the wider vocabulary
  // named so it does not default to three task layouts.
  const prompt = await readFile(
    new URL("../src/understanding-plane/project-understanding-service.js", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /different creativeDNA\.compositionPrimitive/u);
  assert.match(prompt, /map-led, narrative-scroll, editorial-spread/u);
  assert.match(prompt, /choosing three obvious task layouts wastes the choice/u);
});

test("a request to sign up must promise the account, not the form", async () => {
  // "Sign up and sign up page for shoe inventory" produced five capabilities —
  // see the form, the form validates, the button stays usable, tests cover
  // states, the build succeeds — thirteen obligations, every check verified,
  // and a delivered page where nobody can register. The checks were true. The
  // contract was wrong. Its own journeys said "Submit the registration form";
  // nothing said what submitting does.
  const { unfinishedActionIssues } = await import("../src/domain/project-design.js");
  const design = (outcome, capabilities) => ({
    projectIntent: {
      customerOutcome: outcome,
      primaryGoal: outcome,
      successDefinition: outcome,
    },
    productProposal: { essentialCapabilities: capabilities },
  });

  const shipped = design("A visitor can sign up for shoe inventory.", [
    "A visitor can open the sign-up page and see the complete registration form.",
    "The form visibly validates required fields, email format, and password requirements.",
    "The primary action remains clear and usable across desktop and mobile widths.",
    "Automated tests cover valid submission state and representative invalid input states.",
    "The project produces a successful production build without errors.",
  ]);
  const issue = unfinishedActionIssues(shipped)[0];
  assert.ok(issue, "a sign-up that only renders a form must be refused");
  assert.match(issue, /only describes what is displayed or validated/u);
  assert.match(issue, /the record it creates, the state the person reaches/u);

  // One capability asserting the completed effect is enough.
  assert.deepEqual(
    unfinishedActionIssues(
      design("A visitor can sign up for shoe inventory.", [
        "A visitor can see the registration form.",
        "Submitting valid details creates the account and the person is signed in.",
      ]),
    ),
    [],
  );

  // Signing in is access, not creation: a product for reading is unaffected
  // even though its journeys begin with a sign-in.
  assert.deepEqual(
    unfinishedActionIssues(
      design(
        "A customer can sign in, identify the newest activity, and understand its status without assistance.",
        ["A customer can see the newest activity and its current status."],
      ),
    ),
    [],
  );

  // A noun must not read as a verb. "Routine updates" once rejected a
  // read-only policy viewer.
  assert.deepEqual(
    unfinishedActionIssues(
      design(
        "Policyholders can review policy documents without calling their broker for routine updates.",
        ["A policyholder can see current policy documents and their status."],
      ),
    ),
    [],
  );

  // And a working tracker, whose completion wording also describes what is
  // then visible, stays accepted.
  assert.deepEqual(
    unfinishedActionIssues(
      design("Warehouse staff maintain accurate stock records.", [
        "Staff can add an item and it appears in the register.",
        "Inventory records remain available after refreshing the application.",
      ]),
    ),
    [],
  );

  // The generator is told the rule before it writes a contract.
  const prompt = await readFile(
    new URL("../src/understanding-plane/project-understanding-service.js", import.meta.url),
    "utf8",
  );
  assert.match(prompt, /asks for an account to exist afterwards/u);
  assert.match(prompt, /describes a picture of the product, not the product/u);
});
