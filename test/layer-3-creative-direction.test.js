import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSITION_PRIMITIVES,
  CREATIVE_DNA_ENUMS,
  boardRecipe,
  deriveCreativeDNASet,
  normalizeCreativeDNA,
} from "../src/domain/creative-direction.js";
import {
  CREATIVE_DIRECTION_AXES,
  assessCreativeDirectionSet,
  directionSignature,
  regenerationDirective,
} from "../src/domain/creative-direction-quality.js";
import { normalizeDesignAlternativeList } from "../src/domain/project-design.js";

function alternative(overrides = {}) {
  return {
    name: "Coastal Plate",
    description: "Wide photographic plates carry the work with almost no interface around them.",
    whyItFits: "Fine-art buyers judge the print first, so the interface steps back entirely.",
    layoutApproach: "Full-screen photographic stage with a quiet index",
    visualPersonality: "Silent and gallery-like",
    informationDensity: "Very low, one work at a time",
    navigationApproach: "Hidden index revealed on demand",
    mobileBehavior: "One work per screen, swiped",
    tradeoff: "Browsing many works quickly becomes slower than a grid.",
    confidence: { score: 0.8, rationale: "The audience judges the image before anything else." },
    recommended: true,
    preview: {
      typographyCharacter: "Serif authority at monumental scale",
      spacingDensity: "wide breath",
      colorMood: "Bone white against deep ink",
      hierarchy: "full bleed stage → overlay caption",
    },
    ...overrides,
  };
}

test("every composition primitive exposes a renderable surface-role recipe", () => {
  for (const [id, spec] of Object.entries(COMPOSITION_PRIMITIVES)) {
    assert.ok(spec.surfaceRoles.length >= 2, `${id} needs at least two regions`);
    assert.ok(spec.suits.length >= 1, `${id} must declare what it suits`);
  }
  // 18 primitives is what makes boards structurally different rather than
  // recoloured. Guard against silent collapse back to a handful.
  assert.ok(Object.keys(COMPOSITION_PRIMITIVES).length >= 18);
});

test("derived creative DNA never collapses two directions onto one primitive", () => {
  const derived = deriveCreativeDNASet([
    alternative({ name: "A", layoutApproach: "Capacity timeline above details" }),
    alternative({ name: "B", layoutApproach: "Timeline of every stage" }),
    alternative({ name: "C", layoutApproach: "Timeline tracks by owner" }),
  ]);
  const primitives = derived.map((dna) => dna.compositionPrimitive);
  assert.equal(new Set(primitives).size, 3, `expected distinct primitives, got ${primitives}`);
});

test("board recipe is fully machine readable", () => {
  const [dna] = deriveCreativeDNASet([alternative()]);
  const recipe = boardRecipe(dna);
  assert.ok(recipe.regions.length >= 2);
  for (const key of ["typeScale", "typeVoice", "imageryTreatment", "motionStrategy", "spacingRhythm", "surfaceDepth", "responsiveTransform"]) {
    assert.ok(CREATIVE_DNA_ENUMS[key].includes(recipe[key]), `${key} must be a known enum value`);
  }
});

test("creative DNA rejects unsupported values and missing fields", () => {
  const [valid] = deriveCreativeDNASet([alternative()]);
  assert.doesNotThrow(() => normalizeCreativeDNA(valid));
  assert.throws(() => normalizeCreativeDNA({ ...valid, motionStrategy: "sparkly" }), /motionStrategy is unsupported/u);
  const { typeScale, ...missing } = valid;
  assert.ok(typeScale);
  assert.throws(() => normalizeCreativeDNA(missing), /missing: typeScale/u);
});

test("a surface sequence may legitimately repeat a region", () => {
  const [dna] = deriveCreativeDNASet([
    alternative({ layoutApproach: "A narrative story scroll of chapters" }),
  ]);
  assert.doesNotThrow(() =>
    normalizeCreativeDNA({ ...dna, surfaceSequence: ["chapter-band", "chapter-band"] }),
  );
});

test("the quality authority rejects a colour-only variant set", () => {
  const [dnaA] = deriveCreativeDNASet([alternative()]);
  const shared = {
    creativeDNA: dnaA,
    visualSystem: {
      layoutType: "editorial", navigationType: "top-bar", typographyCategory: "editorial",
      density: "balanced", spacingProfile: "rhythmic", surfaceTreatment: "flat",
      contentEmphasis: "story", imageStrategy: "hero", interactionModel: "direct",
      buttonTreatment: "solid",
      colorRoles: { background: "#ffffff", surface: "#fafafa", primary: "#112233", accent: "#cc5522", text: "#111111" },
      sampleLabels: ["a", "b", "c"],
    },
  };
  const assessment = assessCreativeDirectionSet([
    { ...alternative({ name: "Ink" }), ...shared, id: "1", recommended: true },
    {
      ...alternative({ name: "Ochre" }),
      ...shared,
      id: "2",
      recommended: false,
      visualSystem: {
        ...shared.visualSystem,
        colorRoles: { ...shared.visualSystem.colorRoles, accent: "#2255cc" },
      },
    },
    { ...alternative({ name: "Slate" }), ...shared, id: "3", recommended: false },
  ]);
  assert.equal(assessment.publishable, false);
  const codes = assessment.issues.map((issue) => issue.code);
  assert.ok(codes.includes("cosmetic-variant") || codes.includes("same-structure"), codes.join(","));
});

test("the quality authority rejects interchangeable rationale and repeated naming", () => {
  const derived = deriveCreativeDNASet([alternative(), alternative(), alternative()]);
  const assessment = assessCreativeDirectionSet(
    derived.map((dna, index) => ({
      ...alternative({ name: `Harbour Studio` }),
      id: String(index),
      recommended: index === 0,
      creativeDNA: dna,
    })),
  );
  const codes = assessment.issues.map((issue) => issue.code);
  assert.ok(codes.includes("interchangeable-rationale"));
  assert.ok(codes.includes("repeated-naming"));
  assert.equal(assessment.publishable, false);
});

test("a technical product does not receive marketing-site directions", () => {
  const derived = deriveCreativeDNASet([alternative()]);
  const assessment = assessCreativeDirectionSet(
    [{ ...alternative(), id: "1", recommended: true, creativeDNA: { ...derived[0], compositionPrimitive: "immersive-hero" } }],
    { family: "developer" },
  );
  assert.ok(assessment.issues.some((issue) => issue.code === "irrelevant-direction"));
});

test("rejection produces a changed reasoning strategy, not a repeat of the same prompt", () => {
  const directive = regenerationDirective(
    [{ code: "cosmetic-variant" }, { code: "repeated-naming" }],
    Object.fromEntries(CREATIVE_DIRECTION_AXES.map((axis) => [axis, axis === "colorSystem"])),
    18,
  );
  assert.match(directive, /DIFFERENT composition primitive/u);
  assert.match(directive, /shared suffix or prefix/u);
  // Flat axes must be named back to the model so the next attempt is targeted.
  assert.match(directive, /composition, navigation, typography/u);
});

test("signatures compare every differentiation axis", () => {
  const [dna] = deriveCreativeDNASet([alternative()]);
  const signature = directionSignature({ ...alternative(), creativeDNA: dna });
  for (const axis of CREATIVE_DIRECTION_AXES) {
    assert.ok(axis in signature, `signature is missing ${axis}`);
  }
});

test("normalizing alternatives attaches distinct DNA without a model supplying it", () => {
  const normalized = normalizeDesignAlternativeList([
    alternative({ name: "Plate", recommended: true }),
    alternative({ name: "Ledger", layoutApproach: "Record table with bulk actions", recommended: false }),
    alternative({ name: "Walkthrough", layoutApproach: "Guided step by step booking flow", recommended: false }),
  ]);
  assert.equal(normalized.length, 3);
  const primitives = normalized.map((item) => item.creativeDNA.compositionPrimitive);
  assert.equal(new Set(primitives).size, 3, `expected three primitives, got ${primitives}`);
  for (const item of normalized) {
    assert.ok(item.creativeDNA.exclusions.length >= 1);
    assert.ok(item.creativeDNA.surfaceSequence.length >= 2);
  }
});

test("an alternative keeps its own density, navigation and mobile behaviour", () => {
  const normalized = normalizeDesignAlternativeList([
    alternative({ name: "Plate", informationDensity: "very low", navigationApproach: "hidden index", mobileBehavior: "one work per screen", recommended: true }),
    alternative({ name: "Ledger", informationDensity: "very high", navigationApproach: "persistent rail", mobileBehavior: "table collapses to cards", layoutApproach: "Record table", recommended: false }),
    alternative({ name: "Walk", informationDensity: "medium", navigationApproach: "stepper", mobileBehavior: "one question per screen", layoutApproach: "Guided flow", recommended: false }),
  ]);
  assert.deepEqual(
    normalized.map((item) => item.informationDensity),
    ["very low", "very high", "medium"],
  );
  assert.deepEqual(
    normalized.map((item) => item.navigationApproach),
    ["hidden index", "persistent rail", "stepper"],
  );
  assert.deepEqual(
    normalized.map((item) => item.mobileBehavior),
    ["one work per screen", "table collapses to cards", "one question per screen"],
  );
});

test("a rejected direction set feeds a changed retry strategy back to the model", async () => {
  const { validateProjectDesignQuality } = await import("../src/domain/project-design.js");
  const base = {
    projectIntent: {
      customerOutcome: "Photographers can publish a portfolio that sells prints to collectors.",
      businessContext: "An independent fine-art photographer selling limited-edition prints online.",
      intendedUsers: ["Collectors"],
      primaryGoal: "Collectors can browse the work and enquire about a specific print.",
      secondaryGoals: [],
      successDefinition: "A collector finds a print and sends an enquiry without assistance.",
      constraints: [],
      confidence: { score: 0.8, rationale: "The audience and outcome are explicit." },
    },
    userExperiencePlan: {
      primaryJourneys: ["A collector browses the work and enquires about one print."],
      secondaryJourneys: [], criticalMoments: ["The collector sees the print at full size."],
      failureStates: ["A missing image explains itself and offers a next step."],
      trustMoments: ["Edition and price are stated beside every print."],
      repeatedTasks: [], adminResponsibilities: [],
    },
    productProposal: {
      essentialCapabilities: ["Collectors can browse prints and send an enquiry."],
      recommendedCapabilities: [], intentionallyExcludedCapabilities: [], futureCapabilities: [],
      rationale: "The first release completes browsing and enquiry before adding commerce.",
      dependencies: [], scopeImpact: "Scope stays on browsing and enquiry.",
    },
    designDirection: {
      visualPersonality: "Quiet gallery restraint", tone: "Unhurried",
      layoutStrategy: "The print leads every screen", informationDensity: "One work at a time",
      navigationApproach: "Hidden index", responsivePriority: "One work per phone screen",
      accessibilityNeeds: ["Meaning never depends on colour alone."],
      contentStrategy: "Let the print carry the page before any words do",
      interactionStyle: "Direct", rationale: "Collectors judge the print before they read anything at all.",
    },
    foundryInsights: {
      observations: ["Collectors judge a fine-art print before reading any supporting text."],
      opportunities: ["Edition details beside each print remove a round of enquiry email."],
      risks: ["Large photographic files can make the first view slow on poor connections."],
      ambiguities: [], assumptions: [],
      confidence: { score: 0.8, rationale: "The portfolio audience is well understood." },
    },
    decisions: [],
    recommendations: Array.from({ length: 3 }, (_, index) => ({
      title: `Recommendation ${index + 1}`,
      specificValue: `Give collectors a concrete improvement number ${index + 1} here.`,
      whyThisProjectNeedsIt: `Collectors need this specific portfolio behaviour number ${index + 1} to enquire.`,
      impact: "Higher enquiry rate", selectedByDefault: true,
      confidence: { score: 0.8, rationale: "Grounded in the stated outcome." },
      requiredDependencies: [],
    })),
    verificationPlan: [{
      observableOutcome: "Collectors can browse prints and send an enquiry in the running product.",
      acceptanceMethod: "browser-check", evidenceRequired: ["Recorded browser evidence"],
      sourceRequirement: "customer-intent-1", origin: "customer-stated", dependencyIndexes: [],
    }],
    // Three directions that are one idea renamed: identical prose, shared suffix.
    designAlternatives: Array.from({ length: 3 }, (_, index) => ({
      name: `Gallery Studio`,
      description: "A clean modern professional portfolio that is intuitive and user-friendly.",
      whyItFits: "A clean modern professional portfolio that is intuitive and user-friendly.",
      layoutApproach: "A grid of work", visualPersonality: "Clean and modern",
      informationDensity: "Balanced", navigationApproach: "Top bar",
      mobileBehavior: "Stacks", tradeoff: "It is a simple interface.",
      confidence: { score: 0.7, rationale: "Generic." }, recommended: index === 0,
      preview: { typographyCharacter: "a", spacingDensity: "b", colorMood: "c", hierarchy: "d" },
    })),
  };

  assert.throws(
    () => validateProjectDesignQuality(base, { originalRequest: "portfolio", designFamily: "portfolio" }),
    (error) => {
      assert.equal(error.code, "PROJECT_DESIGN_QUALITY");
      // The directive must lead, so it survives truncation on the way back to
      // the model, and it must name a different strategy rather than repeat.
      assert.match(error.issues[0], /^creative-direction-retry-strategy:/u);
      assert.match(error.issues.join(" "), /repeated-naming|interchangeable-rationale|generic-rationale/u);
      return true;
    },
  );
});

test("the generator instruction and the fidelity validator encode the same contract", async () => {
  const { readFile } = await import("node:fs/promises");
  const [instructionSource, validatorSource] = await Promise.all([
    readFile(new URL("../src/domain/contract-bound-execution.js", import.meta.url), "utf8"),
    readFile(new URL("../src/domain/design-fidelity.js", import.meta.url), "utf8"),
  ]);

  // Tightening the validator without updating the instruction makes valid work
  // unbuildable, and it only surfaces in a multi-minute live mission where it
  // looks like a model-quality problem. Keep the two in step here instead.
  const instruction = instructionSource.slice(
    instructionSource.indexOf("The structured output must include designFidelity"),
  ).slice(0, 2000);

  const requiredOfGenerator = [
    // Every viewport class the validator's regexes will look for.
    [/375|390|414/u, "a phone viewport"],
    [/768|810|834|1024/u, "a tablet viewport"],
    [/1280|1440|1512|1728/u, "a desktop viewport"],
    [/scrollWidth/u, "the horizontal-overflow probe"],
    [/activeElement|focus-visible/u, "the keyboard-focus probe"],
    [/prefers-reduced-motion/u, "the reduced-motion fallback"],
  ];

  for (const [pattern, label] of requiredOfGenerator) {
    assert.ok(
      pattern.test(validatorSource),
      `design-fidelity.js no longer checks ${label}; drop it from the instruction too.`,
    );
    assert.ok(
      pattern.test(instruction),
      `The generation instruction never asks for ${label}, but design-fidelity.js rejects output without it.`,
    );
  }
});

test("verification bindings are derived from the plan the contract turns into obligations", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/understanding-plane/project-understanding-service.js", import.meta.url),
    "utf8",
  );

  // The ApprovedProjectContract turns blueprint.verificationPlan into
  // obligations. The blueprint APPENDS design-verification entries to the
  // project plan, so binding from projectDesign.verificationPlan leaves those
  // obligations with an ID and no binding. They never reach
  // requiredBrowserCheckIds, the generator is never told to emit a check for
  // them, and they stay PENDING until the mission gives up — which is exactly
  // how a fully passing build reported FAILED with 31/31 sub-checks green.
  const bindingSites = [...source.matchAll(/const verificationBindings = Object\.fromEntries\(\s*([A-Za-z]+)\.verificationPlan/gu)]
    .map((match) => match[1]);

  assert.ok(bindingSites.length >= 2, `expected at least two binding sites, found ${bindingSites.length}`);
  for (const site of bindingSites) {
    assert.equal(
      site,
      "productBlueprint",
      `verificationBindings must bind ${"productBlueprint"}.verificationPlan, not ${site}.verificationPlan`,
    );
  }
});
