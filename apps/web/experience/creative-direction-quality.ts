import type { DesignAlternative } from "./contracts";

type DirectionSignature = Readonly<{
  composition: string;
  navigation: string;
  typography: string;
  density: string;
  imagery: string;
  interaction: string;
  surfaces: string;
  colorKey: string;
}>;

export type CreativeDirectionIssue = Readonly<{
  code:
    | "too-few-directions"
    | "missing-recommendation"
    | "multiple-recommendations"
    | "duplicate-concept"
    | "weak-differentiation"
    | "under-specified"
    | "generic-rationale";
  message: string;
  directionIds: readonly string[];
}>;

export type CreativeDirectionAssessment = Readonly<{
  publishable: boolean;
  distinctnessScore: number;
  issues: readonly CreativeDirectionIssue[];
  signatures: Readonly<Record<string, DirectionSignature>>;
}>;

const GENERIC_LANGUAGE = /\b(?:clean|modern|professional|responsive|user[- ]friendly|easy to use|intuitive|sleek|beautiful|simple interface)\b/giu;

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

// Mirrors src/domain/creative-direction-quality.js. Creative DNA is preferred
// over the prose fields, because prose can differ while the built structure is
// identical — which is exactly the failure this gate exists to catch.
function signature(direction: DesignAlternative): DirectionSignature {
  const system = direction.visualSystem;
  const dna = direction.creativeDNA;
  const colors = system?.colorRoles;
  return Object.freeze({
    composition: normalize(dna?.compositionPrimitive ?? system?.layoutType ?? direction.layoutApproach.value),
    navigation: normalize(system?.navigationType ?? direction.navigationApproach.value),
    typography: normalize(
      dna ? `${dna.typeVoice} ${dna.typeScale}` : system?.typographyCategory ?? direction.preview.typographyCharacter.value,
    ),
    density: normalize(system?.density ?? direction.informationDensity.value),
    imagery: normalize(dna?.imageryTreatment ?? system?.imageStrategy ?? direction.preview.hierarchy.value),
    interaction: normalize(dna?.motionStrategy ?? system?.interactionModel ?? direction.visualPersonality.value),
    surfaces: normalize(dna?.surfaceDepth ?? system?.surfaceTreatment ?? direction.preview.spacingDensity.value),
    colorKey: normalize(colors ? Object.values(colors).join(" ") : direction.preview.colorMood.value),
  });
}

function fieldDifference(left: DirectionSignature, right: DirectionSignature) {
  const fields = Object.keys(left) as (keyof DirectionSignature)[];
  return fields.filter((field) => left[field] !== right[field]).length / fields.length;
}

function conceptWords(direction: DesignAlternative) {
  return new Set(
    normalize([
      direction.name.value,
      direction.description.value,
      direction.whyItFits.value,
      direction.layoutApproach.value,
      direction.visualPersonality.value,
      direction.tradeoff.value,
    ].join(" "))
      .split(" ")
      .filter((word) => word.length > 3),
  );
}

function jaccard(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((word) => right.has(word)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 1 : intersection / union;
}

function meaningfulSpecificity(direction: DesignAlternative) {
  const source = [
    direction.description.value,
    direction.whyItFits.value,
    direction.tradeoff.value,
  ].join(" ");
  const stripped = source.replace(GENERIC_LANGUAGE, " ");
  const meaningfulWords = normalize(stripped).split(" ").filter((word) => word.length > 3);
  return new Set(meaningfulWords).size;
}

export function assessCreativeDirectionSet(
  alternatives: readonly DesignAlternative[],
): CreativeDirectionAssessment {
  const issues: CreativeDirectionIssue[] = [];
  const signatures = Object.fromEntries(
    alternatives.map((direction) => [direction.id, signature(direction)]),
  );

  if (alternatives.length < 3) {
    issues.push({
      code: "too-few-directions",
      message: "Foundry needs at least three materially different creative directions before asking the customer to choose.",
      directionIds: alternatives.map((item) => item.id),
    });
  }

  const recommended = alternatives.filter((item) => item.recommended.value);
  if (recommended.length === 0) {
    issues.push({ code: "missing-recommendation", message: "Foundry did not identify a recommended creative direction.", directionIds: [] });
  } else if (recommended.length > 1) {
    issues.push({ code: "multiple-recommendations", message: "Only one creative direction may be recommended.", directionIds: recommended.map((item) => item.id) });
  }

  let totalDifference = 0;
  let comparisons = 0;
  for (let leftIndex = 0; leftIndex < alternatives.length; leftIndex += 1) {
    const left = alternatives[leftIndex];
    const leftSignature = signatures[left.id];
    if (meaningfulSpecificity(left) < 10) {
      issues.push({
        code: "generic-rationale",
        message: `${left.name.value} does not yet contain enough project-specific creative reasoning.`,
        directionIds: [left.id],
      });
    }
    const system = left.visualSystem;
    if (!system || !left.creativeDNA || !system.layoutType || !system.typographyCategory || !system.imageStrategy || !system.interactionModel) {
      issues.push({
        code: "under-specified",
        message: `${left.name.value} is missing execution-ready visual-system detail.`,
        directionIds: [left.id],
      });
    }
    for (let rightIndex = leftIndex + 1; rightIndex < alternatives.length; rightIndex += 1) {
      const right = alternatives[rightIndex];
      const difference = fieldDifference(leftSignature, signatures[right.id]);
      const languageOverlap = jaccard(conceptWords(left), conceptWords(right));
      totalDifference += difference;
      comparisons += 1;
      if (difference < 0.375 || languageOverlap > 0.72) {
        issues.push({
          code: difference < 0.375 ? "weak-differentiation" : "duplicate-concept",
          message: `${left.name.value} and ${right.name.value} are too similar to be honest alternatives.`,
          directionIds: [left.id, right.id],
        });
      }
    }
  }

  const distinctnessScore = comparisons === 0 ? 0 : Math.round((totalDifference / comparisons) * 100);
  return Object.freeze({
    publishable: issues.length === 0 && distinctnessScore >= 50,
    distinctnessScore,
    issues: Object.freeze(issues),
    signatures: Object.freeze(signatures),
  });
}
