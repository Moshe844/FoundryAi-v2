import { DESIGN_ASPECTS } from "./design-fidelity-verdicts.js";

/**
 * Model-assisted visual critique.
 *
 * The critic reads the approved design contract, the captured screenshots, and
 * the deterministic evidence, and returns STRUCTURED CRITIQUE ONLY.
 *
 * It is deliberately not a verification authority:
 *   - it cannot turn a deterministic FAIL into a PASS;
 *   - it cannot mark a build complete;
 *   - it runs only AFTER deterministic evidence has been collected, so it
 *     never becomes the reason a build is accepted.
 *
 * What it adds is the judgement deterministic checks cannot make — whether the
 * result actually expresses the approved creative thesis, and whether it looks
 * like something a person would want.
 */

export const VISUAL_CRITIQUE_FINDING_KINDS = Object.freeze([
  "weak-hierarchy",
  "poor-rhythm",
  "excessive-emptiness",
  "generic-composition",
  "low-contrast",
  "awkward-alignment",
  "repeated-cards",
  "weak-imagery",
  "inconsistent-typography",
  "poor-mobile-transformation",
  "thesis-not-expressed",
]);

export const VISUAL_CRITIQUE_SEVERITIES = Object.freeze(["blocking", "major", "minor"]);

export const VISUAL_CRITIQUE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["expressesApprovedThesis", "findings", "strongestAspect", "weakestAspect"],
  properties: {
    expressesApprovedThesis: { type: "boolean" },
    strongestAspect: { type: "string", enum: [...DESIGN_ASPECTS] },
    weakestAspect: { type: "string", enum: [...DESIGN_ASPECTS] },
    findings: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "aspect", "severity", "observation", "repairGuidance"],
        properties: {
          kind: { type: "string", enum: [...VISUAL_CRITIQUE_FINDING_KINDS] },
          aspect: { type: "string", enum: [...DESIGN_ASPECTS] },
          severity: { type: "string", enum: [...VISUAL_CRITIQUE_SEVERITIES] },
          observation: { type: "string", minLength: 12, maxLength: 300 },
          repairGuidance: { type: "string", minLength: 12, maxLength: 300 },
        },
      },
    },
  },
});

export class VisualCritiqueValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VisualCritiqueValidationError";
    this.code = "VISUAL_CRITIQUE_VALIDATION";
  }
}

function fail(message) {
  throw new VisualCritiqueValidationError(message);
}

function text(value, label, { min = 1, max = 300 } = {}) {
  if (typeof value !== "string" || value.trim().length < min) {
    fail(`${label} must be a string of at least ${min} characters.`);
  }
  return value.trim().slice(0, max);
}

/**
 * Builds the critic's input. Screenshots are referenced by path and viewport;
 * the deterministic verdicts are included so the critic argues with measured
 * facts instead of inventing them.
 */
export function visualCritiqueRequest({
  contract,
  projectIntent,
  targetAudience,
  viewports,
  deterministicVerdicts,
}) {
  const dna = contract?.creativeDNA ?? null;
  return Object.freeze({
    approvedDesign: Object.freeze({
      direction: contract?.direction ?? null,
      thesis: dna?.thesis ?? null,
      emotionalGoal: dna?.emotionalGoal ?? null,
      audienceResponse: dna?.audienceResponse ?? null,
      compositionPrimitive: dna?.compositionPrimitive ?? null,
      surfaceSequence: dna?.surfaceSequence ?? [],
      typeVoice: dna?.typeVoice ?? null,
      typeScale: dna?.typeScale ?? null,
      imageryTreatment: dna?.imageryTreatment ?? null,
      motionStrategy: dna?.motionStrategy ?? null,
      spacingRhythm: dna?.spacingRhythm ?? null,
      responsiveTransform: dna?.responsiveTransform ?? null,
      exclusions: dna?.exclusions ?? [],
    }),
    projectIntent: projectIntent ?? null,
    targetAudience: targetAudience ?? null,
    screenshots: Object.freeze(
      (viewports ?? []).map((viewport) =>
        Object.freeze({
          viewport: `${viewport.width}x${viewport.height}`,
          path: viewport.screenshotPath ?? null,
        }),
      ),
    ),
    measuredEvidence: Object.freeze(
      (viewports ?? []).map((viewport) =>
        Object.freeze({
          viewport: `${viewport.width}x${viewport.height}`,
          horizontalOverflow: viewport.horizontalOverflow ?? null,
          fontFamilies: [
            ...new Set((viewport.typography ?? []).map((entry) => entry.fontFamily).filter(Boolean)),
          ],
          fontSizes: [...new Set((viewport.typography ?? []).map((entry) => entry.fontSize).filter(Boolean))],
          regionCount: (viewport.geometry ?? []).length,
          imageCount: viewport.imageCount ?? null,
        }),
      ),
    ),
    deterministicVerdicts: Object.freeze(
      (deterministicVerdicts ?? []).map((verdict) =>
        Object.freeze({ aspect: verdict.aspect, verdict: verdict.verdict, summary: verdict.summary }),
      ),
    ),
  });
}

export function visualCritiquePrompt(request) {
  return [
    "You are an elite creative director reviewing a finished application against the art direction that was approved by the customer.",
    "",
    "You are NOT deciding whether the build passes. Deterministic checks and the Verification Authority make that decision. Your job is to say whether the result actually expresses the approved creative thesis, and to give the repair strategist specific, actionable guidance.",
    "",
    "Rules:",
    "- Argue only from the measured evidence and screenshots provided. Do not invent measurements.",
    "- Do not restate a deterministic verdict as your own finding unless you can add something it cannot see.",
    "- Be specific. 'Weak hierarchy' is useless; 'the hero headline and the section headings are within 2px of each other, so nothing leads' is useful.",
    "- Never suggest weakening the approved design to make a check pass.",
    "- Ban the words clean, modern, professional, intuitive, sleek and user-friendly.",
    "",
    "Return only the structured critique object.",
    "",
    JSON.stringify(request, null, 2),
  ].join("\n");
}

export function normalizeVisualCritique(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("visualCritique must be an object.");
  }
  const allowed = new Set(["expressesApprovedThesis", "findings", "strongestAspect", "weakestAspect"]);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) fail(`visualCritique contains unsupported fields: ${unexpected.join(", ")}.`);
  if (typeof value.expressesApprovedThesis !== "boolean") {
    fail("visualCritique.expressesApprovedThesis must be a boolean.");
  }
  for (const key of ["strongestAspect", "weakestAspect"]) {
    if (!DESIGN_ASPECTS.includes(value[key])) {
      fail(`visualCritique.${key} must be one of the known design aspects.`);
    }
  }
  if (!Array.isArray(value.findings)) fail("visualCritique.findings must be an array.");

  const findings = value.findings.slice(0, 8).map((finding, index) => {
    const label = `visualCritique.findings[${index}]`;
    if (finding === null || typeof finding !== "object") fail(`${label} must be an object.`);
    if (!VISUAL_CRITIQUE_FINDING_KINDS.includes(finding.kind)) fail(`${label}.kind is unsupported.`);
    if (!DESIGN_ASPECTS.includes(finding.aspect)) fail(`${label}.aspect is unsupported.`);
    if (!VISUAL_CRITIQUE_SEVERITIES.includes(finding.severity)) fail(`${label}.severity is unsupported.`);
    return Object.freeze({
      kind: finding.kind,
      aspect: finding.aspect,
      severity: finding.severity,
      observation: text(finding.observation, `${label}.observation`, { min: 12 }),
      repairGuidance: text(finding.repairGuidance, `${label}.repairGuidance`, { min: 12 }),
    });
  });

  return Object.freeze({
    expressesApprovedThesis: value.expressesApprovedThesis,
    strongestAspect: value.strongestAspect,
    weakestAspect: value.weakestAspect,
    findings: Object.freeze(findings),
  });
}

/**
 * Combines deterministic verdicts with advisory critique.
 *
 * The deterministic result is authoritative: `passed` is copied straight from
 * it and the critique can only ever ADD repair scope, never remove a failure
 * or flip a failed build to complete.
 */
export function combineFidelityAndCritique(deterministic, critique) {
  const advisory = critique ?? null;
  const blocking = (advisory?.findings ?? []).filter((finding) => finding.severity === "blocking");

  return Object.freeze({
    passed: deterministic.passed,
    authority: "deterministic",
    failedAspects: deterministic.failedAspects,
    unprovenAspects: deterministic.unprovenAspects,
    verdicts: deterministic.verdicts,
    critique: advisory,
    // Advisory findings widen the repair scope so a rebuild fixes what a human
    // would notice, but they never narrow it and never grant a pass.
    repairScope: Object.freeze([
      ...new Set([
        ...deterministic.repairScope,
        ...blocking.map((finding) => finding.aspect),
      ]),
    ]),
    advisoryConcerns: Object.freeze(
      (advisory?.findings ?? []).map((finding) => `${finding.severity}: ${finding.observation}`),
    ),
  });
}
