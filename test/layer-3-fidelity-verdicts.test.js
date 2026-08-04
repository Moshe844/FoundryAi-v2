import assert from "node:assert/strict";
import test from "node:test";

import {
  AspectVerdict,
  DESIGN_ASPECTS,
  contrastRatio,
  evaluateDesignFidelity,
} from "../src/domain/design-fidelity-verdicts.js";
import {
  combineFidelityAndCritique,
  normalizeVisualCritique,
  visualCritiquePrompt,
  visualCritiqueRequest,
} from "../src/domain/visual-critique.js";

const DNA = Object.freeze({
  thesis: "The print is judged before anything else.",
  emotionalGoal: "Gallery silence",
  audienceResponse: "Collectors linger",
  compositionPrimitive: "immersive-hero",
  typeScale: "monumental",
  typeVoice: "serif-authority",
  imageryTreatment: "full-bleed",
  motionStrategy: "cinematic",
  spacingRhythm: "wide-breath",
  surfaceDepth: "immersive-void",
  responsiveTransform: "collapse-to-stack",
  surfaceSequence: ["full-bleed-stage", "overlay-caption", "quiet-index"],
  exclusions: ["No dense grids at the opening."],
});

const CONTRACT = Object.freeze({
  direction: "Silent Room",
  creativeDNA: DNA,
  composition: { navigationApproach: "hidden index" },
  visualSystem: {
    colorRoles: {
      background: "#0e0f10", surface: "#1a1b1d", primary: "#f2efe9",
      accent: "#c8703c", text: "#f7f5f1",
    },
  },
  exclusions: ["No dense grids at the opening."],
});

function viewport(width, height, overrides = {}) {
  return {
    width, height,
    screenshotPath: `shot-${width}.png`,
    horizontalOverflow: false,
    navigation: { present: true, position: "top" },
    typography: [
      { selector: "h1", fontFamily: "Georgia, serif", fontSize: "72px" },
      { selector: "p", fontFamily: "Georgia, serif", fontSize: "18px" },
    ],
    colors: [{ selector: "body", color: "#f7f5f1", backgroundColor: "#0e0f10" }],
    geometry: [
      { selector: "header", x: 0, y: 0, width, height: Math.round(height * 0.7) },
      { selector: "section", x: 0, y: Math.round(height * 0.7) + 24, width, height: 200 },
      { selector: "footer", x: 0, y: Math.round(height * 0.7) + 248, width, height: 120 },
    ],
    focusVisible: true,
    imageCount: 3,
    motion: { respectsReducedMotion: true },
    ...overrides,
  };
}

const HEALTHY = [viewport(390, 844), viewport(768, 1024), viewport(1440, 900)];

test("a faithful build passes every design aspect", () => {
  const result = evaluateDesignFidelity(CONTRACT, HEALTHY);
  assert.deepEqual(result.failedAspects, [], JSON.stringify(result.verdicts, null, 1));
  assert.deepEqual(result.unprovenAspects, []);
  assert.equal(result.passed, true);
  assert.equal(result.verdicts.length, DESIGN_ASPECTS.length);
});

test("missing evidence is never treated as success", () => {
  const result = evaluateDesignFidelity(CONTRACT, []);
  assert.equal(result.passed, false);
  assert.ok(result.unprovenAspects.length > 0);
  // Nothing may be marked PASS when nothing was measured.
  assert.ok(result.verdicts.every((item) => item.verdict !== AspectVerdict.PASS));
});

test("borrowing only the colour does not pass: structure is judged separately", () => {
  // Correct palette, but a flat page with one region and no type hierarchy.
  const flat = HEALTHY.map((item) =>
    viewport(item.width, item.height, {
      geometry: [{ selector: "main", x: 0, y: 0, width: item.width, height: 80 }],
      typography: [
        { selector: "h1", fontFamily: "Georgia, serif", fontSize: "18px" },
        { selector: "p", fontFamily: "Georgia, serif", fontSize: "17px" },
      ],
    }),
  );
  const result = evaluateDesignFidelity(CONTRACT, flat);
  assert.equal(result.passed, false);
  assert.ok(result.failedAspects.includes("composition"), result.failedAspects.join(","));
  assert.ok(result.failedAspects.includes("hierarchy"), result.failedAspects.join(","));
});

test("an immersive hero that does not fill the fold fails composition", () => {
  const shallow = HEALTHY.map((item) =>
    viewport(item.width, item.height, {
      geometry: [
        { selector: "header", x: 0, y: 0, width: item.width, height: 60 },
        { selector: "a", x: 0, y: 84, width: item.width, height: 60 },
        { selector: "b", x: 0, y: 168, width: item.width, height: 60 },
      ],
    }),
  );
  const result = evaluateDesignFidelity(CONTRACT, shallow);
  const composition = result.verdicts.find((item) => item.aspect === "composition");
  assert.equal(composition.verdict, AspectVerdict.FAIL);
  assert.match(composition.summary, /immersive hero/u);
});

test("default system fonts fail an approved typographic voice", () => {
  const generic = HEALTHY.map((item) =>
    viewport(item.width, item.height, {
      typography: [
        { selector: "h1", fontFamily: "Times New Roman", fontSize: "48px" },
        { selector: "p", fontFamily: "Times New Roman", fontSize: "16px" },
      ],
    }),
  );
  const typography = evaluateDesignFidelity(CONTRACT, generic).verdicts.find(
    (item) => item.aspect === "typography",
  );
  assert.equal(typography.verdict, AspectVerdict.FAIL);
  assert.match(typography.summary, /serif-authority/u);
});

test("horizontal overflow on a phone fails responsive", () => {
  const overflowing = [
    viewport(390, 844, { horizontalOverflow: true }),
    viewport(768, 1024),
    viewport(1440, 900),
  ];
  const responsive = evaluateDesignFidelity(CONTRACT, overflowing).verdicts.find(
    (item) => item.aspect === "responsive",
  );
  assert.equal(responsive.verdict, AspectVerdict.FAIL);
});

test("an excluded imagery treatment is enforced against rendered images", () => {
  const contract = { ...CONTRACT, creativeDNA: { ...DNA, imageryTreatment: "none" } };
  const result = evaluateDesignFidelity(contract, HEALTHY);
  assert.ok(result.failedAspects.includes("imagery"));
  assert.ok(result.failedAspects.includes("exclusions"));
});

test("low contrast fails accessibility with the measured ratio", () => {
  const lowContrast = HEALTHY.map((item) =>
    viewport(item.width, item.height, {
      colors: [{ selector: "p", color: "#8a8a8a", backgroundColor: "#7d7d7d" }],
    }),
  );
  const accessibility = evaluateDesignFidelity(CONTRACT, lowContrast).verdicts.find(
    (item) => item.aspect === "accessibility",
  );
  assert.equal(accessibility.verdict, AspectVerdict.FAIL);
  assert.ok(accessibility.detail.failures[0].ratio < 4.5);
});

test("contrast ratio is computed correctly for known pairs", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21);
  assert.equal(Math.round(contrastRatio("rgb(255,255,255)", "#ffffff")), 1);
});

test("failed aspects map to a narrow repair scope", () => {
  const broken = HEALTHY.map((item) =>
    viewport(item.width, item.height, {
      typography: [
        { selector: "h1", fontFamily: "Times New Roman", fontSize: "18px" },
        { selector: "p", fontFamily: "Times New Roman", fontSize: "17px" },
      ],
    }),
  );
  const result = evaluateDesignFidelity(CONTRACT, broken);
  assert.ok(result.repairScope.includes("design-tokens"));
  assert.ok(!result.repairScope.includes("accessibility"));
});

/* ------------------------------------------------------- visual critique */

test("the critic returns structured critique and rejects malformed output", () => {
  const valid = {
    expressesApprovedThesis: false,
    strongestAspect: "colors",
    weakestAspect: "hierarchy",
    findings: [{
      kind: "weak-hierarchy", aspect: "hierarchy", severity: "blocking",
      observation: "The hero headline and the section headings are within two pixels, so nothing leads the page.",
      repairGuidance: "Raise the hero to the approved monumental step and drop section headings two steps.",
    }],
  };
  const critique = normalizeVisualCritique(valid);
  assert.equal(critique.findings.length, 1);
  assert.throws(() => normalizeVisualCritique({ ...valid, weakestAspect: "vibes" }), /weakestAspect/u);
  assert.throws(() => normalizeVisualCritique({ ...valid, findings: [{ ...valid.findings[0], severity: "meh" }] }), /severity/u);
  assert.throws(() => normalizeVisualCritique({ ...valid, extra: 1 }), /unsupported fields/u);
});

test("the critic cannot turn a deterministic failure into a pass", () => {
  const deterministic = evaluateDesignFidelity(CONTRACT, [
    viewport(390, 844, { horizontalOverflow: true }),
    viewport(768, 1024),
    viewport(1440, 900),
  ]);
  assert.equal(deterministic.passed, false);

  const glowing = normalizeVisualCritique({
    expressesApprovedThesis: true,
    strongestAspect: "composition",
    weakestAspect: "spacing",
    findings: [],
  });
  const combined = combineFidelityAndCritique(deterministic, glowing);
  assert.equal(combined.passed, false, "advisory critique must never grant a pass");
  assert.equal(combined.authority, "deterministic");
  assert.ok(combined.failedAspects.includes("responsive"));
});

test("a blocking critique widens repair scope without narrowing it", () => {
  const deterministic = evaluateDesignFidelity(CONTRACT, HEALTHY);
  assert.equal(deterministic.passed, true);
  const critique = normalizeVisualCritique({
    expressesApprovedThesis: false,
    strongestAspect: "colors",
    weakestAspect: "imagery",
    findings: [{
      kind: "thesis-not-expressed", aspect: "imagery", severity: "blocking",
      observation: "The plates are small and centred, so the gallery silence the thesis promises never arrives.",
      repairGuidance: "Let the opening plate bleed to all four edges as the approved treatment requires.",
    }],
  });
  const combined = combineFidelityAndCritique(deterministic, critique);
  assert.ok(combined.repairScope.includes("imagery"));
  assert.equal(combined.advisoryConcerns.length, 1);
  // Deterministic result still governs completion.
  assert.equal(combined.passed, true);
});

test("the critic prompt carries the thesis, evidence and deterministic verdicts", () => {
  const deterministic = evaluateDesignFidelity(CONTRACT, HEALTHY);
  const request = visualCritiqueRequest({
    contract: CONTRACT,
    projectIntent: "Sell limited-edition prints to collectors.",
    targetAudience: "Fine-art collectors",
    viewports: HEALTHY,
    deterministicVerdicts: deterministic.verdicts,
  });
  assert.equal(request.approvedDesign.compositionPrimitive, "immersive-hero");
  assert.equal(request.screenshots.length, 3);
  assert.equal(request.deterministicVerdicts.length, DESIGN_ASPECTS.length);

  const prompt = visualCritiquePrompt(request);
  assert.match(prompt, /NOT deciding whether the build passes/u);
  assert.match(prompt, /Silent Room/u);
  assert.match(prompt, /immersive-hero/u);
  // The critic must be barred from the same generic vocabulary as the authors.
  assert.match(prompt, /Ban the words clean, modern, professional/u);
});
