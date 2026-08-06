import { COMPOSITION_PRIMITIVES } from "./creative-direction.js";

/**
 * Production authority for a set of creative directions.
 *
 * This is deliberately NOT a frontend score. The frontend may render the same
 * verdict, but the authoritative decision — publish, regenerate, or fail
 * honestly — is made here so that generation can never receive a set the
 * customer would rightly call "three renamed versions of the same layout".
 */

export const CREATIVE_DIRECTION_AXES = Object.freeze([
  "composition",
  "navigation",
  "typography",
  "colorSystem",
  "imagery",
  "interaction",
  "responsive",
  "density",
  "surfaceDepth",
  "motion",
]);

export const MAX_CREATIVE_DIRECTION_ATTEMPTS = 3;

const GENERIC_LANGUAGE =
  /\b(?:clean|modern|professional|responsive|user[- ]friendly|easy to use|intuitive|sleek|beautiful|simple interface|best practices|cutting[- ]edge)\b/giu;

// Compositions that only make sense as a brand or campaign site. A narrative
// scroll is deliberately NOT here: a guided integration walkthrough is a real
// developer-documentation pattern, not marketing decoration.
const MARKETING_ONLY_PRIMITIVES = new Set([
  "immersive-hero",
  "asymmetric-split",
]);

const TECHNICAL_FAMILIES = new Set(["developer"]);

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function contentWords(value) {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((word) => word.length > 3),
  );
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const word of left) if (right.has(word)) intersection += 1;
  return intersection / new Set([...left, ...right]).size;
}

function colorKey(alternative) {
  const roles = alternative.visualSystem?.colorRoles;
  return roles ? Object.values(roles).join("|").toLowerCase() : "";
}

/** One comparable value per differentiation axis. */
export function directionSignature(alternative) {
  const system = alternative.visualSystem ?? {};
  const dna = alternative.creativeDNA ?? {};
  return Object.freeze({
    composition: normalize(dna.compositionPrimitive ?? system.layoutType ?? alternative.layoutApproach),
    navigation: normalize(system.navigationType ?? alternative.navigationApproach),
    typography: normalize(`${dna.typeVoice ?? ""} ${dna.typeScale ?? system.typographyCategory ?? ""}`),
    colorSystem: colorKey(alternative),
    imagery: normalize(dna.imageryTreatment ?? system.imageStrategy),
    interaction: normalize(system.interactionModel ?? alternative.visualPersonality),
    responsive: normalize(dna.responsiveTransform ?? alternative.mobileBehavior),
    density: normalize(system.density ?? alternative.informationDensity),
    surfaceDepth: normalize(dna.surfaceDepth ?? system.surfaceTreatment),
    motion: normalize(dna.motionStrategy ?? ""),
  });
}

function axisDifference(left, right) {
  const differing = CREATIVE_DIRECTION_AXES.filter(
    (axis) => left[axis] !== right[axis],
  );
  return {
    differing,
    ratio: differing.length / CREATIVE_DIRECTION_AXES.length,
  };
}

function rationaleWords(alternative) {
  return contentWords(
    [
      alternative.name,
      alternative.description,
      alternative.whyItFits,
      alternative.tradeoff,
      alternative.creativeDNA?.thesis,
      alternative.creativeDNA?.emotionalGoal,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function specificity(alternative) {
  const source = [
    alternative.description,
    alternative.whyItFits,
    alternative.tradeoff,
    alternative.creativeDNA?.thesis,
  ]
    .filter(Boolean)
    .join(" ");
  return contentWords(source.replace(GENERIC_LANGUAGE, " ")).size;
}

/** Repeated naming patterns, e.g. "X Studio", "Y Studio", "Z Studio". */
function namingPatternIssue(alternatives) {
  const shapes = alternatives.map((alternative) => {
    const parts = normalize(alternative.name).split(" ").filter(Boolean);
    return parts.length > 1 ? parts.at(-1) : "";
  });
  const counts = new Map();
  for (const shape of shapes) {
    if (shape) counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  for (const [shape, count] of counts) {
    if (count >= alternatives.length && alternatives.length >= 2) {
      return `Every direction name ends in "${shape}", which reads as one idea renamed.`;
    }
  }
  return null;
}

function relevanceIssues(alternatives, { family, supportedPrimitives }) {
  const issues = [];
  for (const alternative of alternatives) {
    const primitive = alternative.creativeDNA?.compositionPrimitive;
    if (!primitive) continue;
    const spec = COMPOSITION_PRIMITIVES[primitive];
    if (spec === undefined) {
      issues.push({
        code: "unsupported-primitive",
        message: `${alternative.name} uses a composition this stack cannot build.`,
        directionIds: [alternative.id ?? alternative.name],
      });
      continue;
    }
    if (
      TECHNICAL_FAMILIES.has(family) &&
      MARKETING_ONLY_PRIMITIVES.has(primitive)
    ) {
      issues.push({
        code: "irrelevant-direction",
        message: `${alternative.name} proposes a marketing-site composition for a technical product.`,
        directionIds: [alternative.id ?? alternative.name],
      });
    }
    if (
      supportedPrimitives !== undefined &&
      !supportedPrimitives.includes(primitive)
    ) {
      issues.push({
        code: "unsupported-primitive",
        message: `${alternative.name} requires a composition outside the certified stack.`,
        directionIds: [alternative.id ?? alternative.name],
      });
    }
  }
  return issues;
}

/**
 * @returns {{publishable: boolean, distinctnessScore: number,
 *            issues: ReadonlyArray<object>, axisCoverage: object,
 *            regenerationDirective: string|null}}
 */
// Composition is the axis a customer actually sees. Every other axis — colour,
// typography, density, button treatment — restyles the same page. A warehouse
// tracker was offered three directions built on two primitives between them,
// all of them variations of a table with filters, and the choice was cosmetic.
// Fifteen primitives exist and only the two marketing ones are ever ruled out,
// so a set that reuses a composition is not offering a choice.
function sharedCompositionIssues(alternatives) {
  const used = alternatives
    .map((alternative) => ({
      id: alternative.id ?? alternative.name,
      primitive: alternative.creativeDNA?.compositionPrimitive,
    }))
    .filter((entry) => typeof entry.primitive === "string");
  if (used.length < 2) return [];
  const byPrimitive = new Map();
  for (const entry of used) {
    byPrimitive.set(entry.primitive, [
      ...(byPrimitive.get(entry.primitive) ?? []),
      entry.id,
    ]);
  }
  return [...byPrimitive.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([primitive, ids]) => ({
      code: "shared-composition",
      message: `${ids.join(" and ")} are all built as a ${String(primitive).replaceAll("-", " ")}, so the choice between them is cosmetic. Every direction must use a different composition primitive: that is the structure the customer sees, not its palette or type scale.`,
      directionIds: ids,
    }));
}

export function assessCreativeDirectionSet(alternatives, options = {}) {
  const { family = "application", supportedPrimitives, minimumDistinctness = 55 } = options;
  const list = Array.isArray(alternatives) ? alternatives : [];
  const issues = [];
  const identify = (alternative) => alternative.id ?? alternative.name ?? "unknown";

  if (list.length < 3) {
    issues.push({
      code: "too-few-directions",
      message:
        "Foundry needs at least three materially different creative directions before asking the customer to choose.",
      directionIds: list.map(identify),
    });
  }

  const recommended = list.filter((item) => item.recommended === true);
  if (list.length > 0 && recommended.length === 0) {
    issues.push({
      code: "missing-recommendation",
      message: "No creative direction is recommended.",
      directionIds: [],
    });
  } else if (recommended.length > 1) {
    issues.push({
      code: "multiple-recommendations",
      message: "Only one creative direction may be recommended.",
      directionIds: recommended.map(identify),
    });
  }

  const signatures = new Map(
    list.map((alternative) => [identify(alternative), directionSignature(alternative)]),
  );

  const axisEverDiffers = Object.fromEntries(
    CREATIVE_DIRECTION_AXES.map((axis) => [axis, false]),
  );

  let totalRatio = 0;
  let comparisons = 0;

  for (let leftIndex = 0; leftIndex < list.length; leftIndex += 1) {
    const left = list[leftIndex];
    if (specificity(left) < 10) {
      issues.push({
        code: "generic-rationale",
        message: `${left.name} does not contain enough project-specific creative reasoning.`,
        directionIds: [identify(left)],
      });
    }
    if (!left.creativeDNA) {
      issues.push({
        code: "under-specified",
        message: `${left.name} is missing its creative DNA and cannot be built faithfully.`,
        directionIds: [identify(left)],
      });
    }

    for (let rightIndex = leftIndex + 1; rightIndex < list.length; rightIndex += 1) {
      const right = list[rightIndex];
      const { differing, ratio } = axisDifference(
        signatures.get(identify(left)),
        signatures.get(identify(right)),
      );
      for (const axis of differing) axisEverDiffers[axis] = true;
      totalRatio += ratio;
      comparisons += 1;

      const languageOverlap = jaccard(rationaleWords(left), rationaleWords(right));
      const structuralAxes = differing.filter((axis) =>
        ["composition", "navigation", "responsive", "density"].includes(axis),
      );

      if (differing.length === 1 && differing[0] === "colorSystem") {
        issues.push({
          code: "cosmetic-variant",
          message: `${left.name} and ${right.name} differ only in color.`,
          directionIds: [identify(left), identify(right)],
        });
      } else if (structuralAxes.length === 0) {
        issues.push({
          code: "same-structure",
          message: `${left.name} and ${right.name} share the same composition, navigation, density and mobile behavior.`,
          directionIds: [identify(left), identify(right)],
        });
      } else if (ratio < 0.4) {
        issues.push({
          code: "weak-differentiation",
          message: `${left.name} and ${right.name} are too similar to be honest alternatives.`,
          directionIds: [identify(left), identify(right)],
        });
      }

      if (languageOverlap > 0.7) {
        issues.push({
          code: "interchangeable-rationale",
          message: `${left.name} and ${right.name} are explained in interchangeable language.`,
          directionIds: [identify(left), identify(right)],
        });
      }
    }
  }

  const namingIssue = namingPatternIssue(list);
  if (namingIssue !== null) {
    issues.push({
      code: "repeated-naming",
      message: namingIssue,
      directionIds: list.map(identify),
    });
  }

  issues.push(...relevanceIssues(list, { family, supportedPrimitives }));
  issues.push(...sharedCompositionIssues(list));

  const distinctnessScore =
    comparisons === 0 ? 0 : Math.round((totalRatio / comparisons) * 100);
  const publishable = issues.length === 0 && distinctnessScore >= minimumDistinctness;

  return Object.freeze({
    publishable,
    distinctnessScore,
    issues: Object.freeze(issues),
    axisCoverage: Object.freeze(axisEverDiffers),
    regenerationDirective: publishable
      ? null
      : regenerationDirective(issues, axisEverDiffers, distinctnessScore),
  });
}

/**
 * Turns a rejection into a *changed reasoning strategy* for the next attempt,
 * rather than repeating the same prompt and hoping for different output.
 */
export function regenerationDirective(issues, axisCoverage, distinctnessScore) {
  const codes = new Set(issues.map((issue) => issue.code));
  const flatAxes = Object.entries(axisCoverage)
    .filter(([, differs]) => !differs)
    .map(([axis]) => axis);

  const instructions = [];
  if (codes.has("cosmetic-variant") || codes.has("same-structure")) {
    instructions.push(
      "The previous attempt produced one layout in different colors. Start each direction from a DIFFERENT composition primitive and let colour follow the composition, never the reverse.",
    );
  }
  if (codes.has("weak-differentiation") || distinctnessScore < 55) {
    instructions.push(
      "Choose directions that a designer would argue about. Each must win on a different axis and visibly lose on another.",
    );
  }
  if (codes.has("interchangeable-rationale")) {
    instructions.push(
      "Rewrite each rationale so it names a concrete decision unique to that direction. Do not reuse sentence shapes between directions.",
    );
  }
  if (codes.has("repeated-naming")) {
    instructions.push(
      "Name each direction from its own creative idea. Do not use a shared suffix or prefix across the set.",
    );
  }
  if (codes.has("generic-rationale")) {
    instructions.push(
      "Ban the words clean, modern, professional, intuitive, sleek and user-friendly. Describe what the customer will actually see.",
    );
  }
  if (codes.has("irrelevant-direction") || codes.has("unsupported-primitive")) {
    instructions.push(
      "Every direction must suit this product family and this build stack. Drop compositions that cannot serve the approved journeys.",
    );
  }
  if (codes.has("under-specified")) {
    instructions.push(
      "Every direction must carry complete creative DNA: composition primitive, type scale and voice, imagery treatment, motion, spacing rhythm, surface depth, responsive transform, surface sequence and explicit exclusions.",
    );
  }
  if (flatAxes.length > 0) {
    instructions.push(
      `These axes were identical across every direction and must now vary: ${flatAxes.join(", ")}.`,
    );
  }
  if (codes.has("missing-recommendation") || codes.has("multiple-recommendations")) {
    instructions.push("Mark exactly one direction as recommended.");
  }
  if (codes.has("too-few-directions")) {
    instructions.push("Return exactly three directions.");
  }

  return instructions.join(" ");
}
