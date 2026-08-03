import type {
  CreativeDNA,
  DesignAlternative,
  DesignVisualSystem,
} from "./contracts";

/**
 * A custom direction used to be `selected.join(". ")` — a sentence. Generation
 * received prose and could interpret it however it liked. A combined direction
 * is now a first-class, typed design composition with the same shape and the
 * same authority as a chosen direction, so it can bind to the contract and be
 * verified against the finished application.
 */

export const TRAIT_AXES = [
  "composition",
  "typography",
  "color",
  "imagery",
  "navigation",
  "density",
  "motion",
  "responsive",
  "surface",
] as const;

export type TraitAxis = (typeof TRAIT_AXES)[number];

export type DirectionTrait = Readonly<{
  id: string;
  axis: TraitAxis;
  label: string;
  detail: string;
  sourceDirectionId: string;
  sourceDirectionName: string;
}>;

export type TraitConflict = Readonly<{
  axis: TraitAxis;
  keptTraitId: string;
  droppedTraitIds: readonly string[];
  explanation: string;
}>;

export type CustomDesignComposition = Readonly<{
  schemaVersion: 1;
  sourceDirectionIds: readonly string[];
  selectedTraits: readonly DirectionTrait[];
  resolvedConflicts: readonly TraitConflict[];
  incompatibilities: readonly string[];
  visualSystem: DesignVisualSystem | null;
  creativeDNA: CreativeDNA | null;
  layoutRules: readonly string[];
  typography: string;
  colors: string;
  imagery: string;
  responsiveBehavior: string;
  interactionModel: string;
  customerNote: string | null;
  rationale: string;
  complete: boolean;
}>;

/**
 * Pairs that cannot both be honoured. Detected rather than silently merged,
 * because quietly dropping one is how a customer ends up with a build that
 * ignores half of what they picked.
 */
const INCOMPATIBLE_PAIRS: ReadonlyArray<
  Readonly<{ left: string; right: string; explanation: string }>
> = [
  {
    left: "imagery:none",
    right: "composition:immersive-hero",
    explanation:
      "An immersive hero is built from a full-bleed image. Combining it with an image-free treatment leaves the hero empty, so the image-free choice was dropped.",
  },
  {
    left: "motion:static",
    right: "motion:cinematic",
    explanation:
      "A direction cannot be both completely still and cinematic. The more restrained choice was kept.",
  },
  {
    left: "density:dense",
    right: "composition:narrative-scroll",
    explanation:
      "A narrative scroll needs room to breathe between chapters. The dense reading was relaxed to keep the sequence legible.",
  },
  {
    left: "density:dense",
    right: "composition:immersive-hero",
    explanation:
      "An immersive opening and a dense information grid compete for the same space. Density was relaxed at the opening only.",
  },
];

function traitKey(trait: DirectionTrait) {
  return `${trait.axis}:${trait.label}`;
}

/** Traits are derived from real DNA, so the choices are honest design decisions. */
export function buildDirectionTraits(
  alternatives: readonly DesignAlternative[],
): readonly DirectionTrait[] {
  const traits: DirectionTrait[] = [];
  const seen = new Set<string>();

  for (const alternative of alternatives) {
    const dna = alternative.creativeDNA;
    const system = alternative.visualSystem;
    const candidates: ReadonlyArray<Readonly<{ axis: TraitAxis; label: string; detail: string }>> = [
      dna && {
        axis: "composition" as const,
        label: dna.compositionPrimitive,
        detail: `Compose the experience as a ${dna.compositionPrimitive.replaceAll("-", " ")}: ${dna.surfaceSequence.join(" → ")}.`,
      },
      dna && {
        axis: "typography" as const,
        label: `${dna.typeVoice}/${dna.typeScale}`,
        detail: `Set type in a ${dna.typeVoice.replaceAll("-", " ")} voice at a ${dna.typeScale} scale.`,
      },
      dna && {
        axis: "imagery" as const,
        label: dna.imageryTreatment,
        detail: `Treat imagery as ${dna.imageryTreatment.replaceAll("-", " ")}.`,
      },
      dna && {
        axis: "motion" as const,
        label: dna.motionStrategy,
        detail: `Keep motion ${dna.motionStrategy}.`,
      },
      dna && {
        axis: "responsive" as const,
        label: dna.responsiveTransform,
        detail: `On phones, ${dna.responsiveTransform.replaceAll("-", " ")}.`,
      },
      dna && {
        axis: "surface" as const,
        label: dna.surfaceDepth,
        detail: `Render surfaces as ${dna.surfaceDepth.replaceAll("-", " ")}.`,
      },
      system && {
        axis: "color" as const,
        label: `${system.colorRoles.primary}/${system.colorRoles.accent}`,
        detail: `Use the ${alternative.name.value} palette: primary ${system.colorRoles.primary}, accent ${system.colorRoles.accent}.`,
      },
      system && {
        axis: "navigation" as const,
        label: system.navigationType,
        detail: `Navigate with a ${system.navigationType.replaceAll("-", " ")}.`,
      },
      system && {
        axis: "density" as const,
        label: system.density,
        detail: `Hold a ${system.density} information density.`,
      },
    ].filter(Boolean) as ReadonlyArray<Readonly<{ axis: TraitAxis; label: string; detail: string }>>;

    for (const candidate of candidates) {
      const key = `${candidate.axis}:${candidate.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      traits.push({
        id: `${alternative.id}--${candidate.axis}`,
        axis: candidate.axis,
        label: candidate.label,
        detail: candidate.detail,
        sourceDirectionId: alternative.id,
        sourceDirectionName: alternative.name.value,
      });
    }
  }
  return Object.freeze(traits);
}

/**
 * Useful starting combinations so "Combine ideas" never opens onto an empty
 * form. Each pairs the recommended direction's strongest structural trait with
 * a genuinely different expressive trait from another direction.
 */
export function suggestedCombinations(
  alternatives: readonly DesignAlternative[],
  traits: readonly DirectionTrait[],
): ReadonlyArray<Readonly<{ id: string; label: string; traitIds: readonly string[] }>> {
  const recommended =
    alternatives.find((item) => item.recommended.value) ?? alternatives[0];
  if (!recommended) return Object.freeze([]);
  const others = alternatives.filter((item) => item.id !== recommended.id);

  const pick = (directionId: string, axis: TraitAxis) =>
    traits.find((trait) => trait.sourceDirectionId === directionId && trait.axis === axis);

  const combinations = others.flatMap((other, index) => {
    const structure = pick(recommended.id, "composition") ?? pick(recommended.id, "navigation");
    const expression = pick(other.id, "typography") ?? pick(other.id, "imagery");
    const palette = pick(other.id, "color");
    if (!structure || !expression) return [];
    return [
      {
        id: `combo-${index + 1}`,
        label: `${recommended.name.value} structure with ${other.name.value} ${expression.axis}`,
        traitIds: [structure.id, expression.id, ...(palette ? [palette.id] : [])],
      },
    ];
  });

  return Object.freeze(combinations.slice(0, 3));
}

export function composeCustomDirection({
  alternatives,
  traits,
  selectedTraitIds,
  customerNote,
}: Readonly<{
  alternatives: readonly DesignAlternative[];
  traits: readonly DirectionTrait[];
  selectedTraitIds: ReadonlySet<string>;
  customerNote: string;
}>): CustomDesignComposition {
  const selected = traits.filter((trait) => selectedTraitIds.has(trait.id));
  const note = customerNote.trim() === "" ? null : customerNote.trim();

  // One trait per axis wins. Later selections lose to earlier ones on the same
  // axis, and the customer is told which and why.
  const byAxis = new Map<TraitAxis, DirectionTrait[]>();
  for (const trait of selected) {
    byAxis.set(trait.axis, [...(byAxis.get(trait.axis) ?? []), trait]);
  }

  const resolvedConflicts: TraitConflict[] = [];
  const kept: DirectionTrait[] = [];
  for (const [axis, group] of byAxis) {
    kept.push(group[0]);
    if (group.length > 1) {
      resolvedConflicts.push({
        axis,
        keptTraitId: group[0].id,
        droppedTraitIds: group.slice(1).map((trait) => trait.id),
        explanation: `Only one ${axis} treatment can be built. Foundry kept ${group[0].sourceDirectionName}'s and set the others aside.`,
      });
    }
  }

  const keptKeys = new Set(kept.map(traitKey));
  const incompatibilities = INCOMPATIBLE_PAIRS.filter(
    (pair) => keptKeys.has(pair.left) && keptKeys.has(pair.right),
  ).map((pair) => pair.explanation);

  const sourceIds = [...new Set(kept.map((trait) => trait.sourceDirectionId))];
  const sourceAlternatives = sourceIds
    .map((id) => alternatives.find((item) => item.id === id))
    .filter((item): item is DesignAlternative => item !== undefined);

  const compositionTrait = kept.find((trait) => trait.axis === "composition");
  const structuralSource =
    (compositionTrait &&
      alternatives.find((item) => item.id === compositionTrait.sourceDirectionId)) ??
    sourceAlternatives[0] ??
    alternatives.find((item) => item.recommended.value) ??
    alternatives[0];

  const colorTrait = kept.find((trait) => trait.axis === "color");
  const colorSource = colorTrait
    ? alternatives.find((item) => item.id === colorTrait.sourceDirectionId)
    : undefined;

  const mergedDNA = mergeCreativeDNA(structuralSource, kept, alternatives);
  const mergedSystem = mergeVisualSystem(structuralSource, colorSource, kept);

  const detailFor = (axis: TraitAxis, fallback: string) =>
    kept.find((trait) => trait.axis === axis)?.detail ?? fallback;

  // A combination is complete once it carries a structure. Typing is optional.
  const complete = kept.length > 0;

  return Object.freeze({
    schemaVersion: 1 as const,
    sourceDirectionIds: Object.freeze(sourceIds),
    selectedTraits: Object.freeze(kept),
    resolvedConflicts: Object.freeze(resolvedConflicts),
    incompatibilities: Object.freeze(incompatibilities),
    visualSystem: mergedSystem,
    creativeDNA: mergedDNA,
    layoutRules: Object.freeze(
      mergedDNA
        ? [
            `Compose as a ${mergedDNA.compositionPrimitive.replaceAll("-", " ")}.`,
            `Follow the surface sequence: ${mergedDNA.surfaceSequence.join(" → ")}.`,
            detailFor("navigation", "Navigate in the way the composition implies."),
            detailFor("density", "Hold the density the composition implies."),
          ]
        : [detailFor("composition", "Follow the approved composition.")],
    ),
    typography: detailFor("typography", "Keep the recommended typographic voice and scale."),
    colors: detailFor("color", "Keep the recommended palette."),
    imagery: detailFor("imagery", "Keep the recommended imagery treatment."),
    responsiveBehavior: detailFor("responsive", "Keep the recommended phone transformation."),
    interactionModel: detailFor("motion", "Keep the recommended interaction and motion character."),
    customerNote: note,
    rationale: buildRationale(kept, note, incompatibilities),
    complete,
  });
}

function buildRationale(
  kept: readonly DirectionTrait[],
  note: string | null,
  incompatibilities: readonly string[],
) {
  if (kept.length === 0 && note === null) {
    return "No combined direction has been composed yet.";
  }
  const bySource = new Map<string, string[]>();
  for (const trait of kept) {
    bySource.set(trait.sourceDirectionName, [
      ...(bySource.get(trait.sourceDirectionName) ?? []),
      trait.axis,
    ]);
  }
  const parts = [...bySource].map(
    ([name, axes]) => `${axes.join(" and ")} from ${name}`,
  );
  const base =
    parts.length > 0
      ? `This direction takes ${parts.join(", ")}.`
      : "This direction follows the customer's written instruction.";
  return [
    base,
    note ? `The customer added: ${note}` : "",
    incompatibilities.length > 0
      ? `Foundry resolved ${incompatibilities.length} incompatible combination${incompatibilities.length === 1 ? "" : "s"}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function mergeCreativeDNA(
  structuralSource: DesignAlternative | undefined,
  kept: readonly DirectionTrait[],
  alternatives: readonly DesignAlternative[],
): CreativeDNA | null {
  const base = structuralSource?.creativeDNA;
  if (!base) return null;

  const dnaFor = (axis: TraitAxis) => {
    const trait = kept.find((item) => item.axis === axis);
    if (!trait) return undefined;
    return alternatives.find((item) => item.id === trait.sourceDirectionId)?.creativeDNA;
  };

  const typography = dnaFor("typography");
  const imagery = dnaFor("imagery");
  const motion = dnaFor("motion");
  const responsive = dnaFor("responsive");
  const surface = dnaFor("surface");

  return Object.freeze({
    ...base,
    typeVoice: typography?.typeVoice ?? base.typeVoice,
    typeScale: typography?.typeScale ?? base.typeScale,
    imageryTreatment: imagery?.imageryTreatment ?? base.imageryTreatment,
    motionStrategy: motion?.motionStrategy ?? base.motionStrategy,
    responsiveTransform: responsive?.responsiveTransform ?? base.responsiveTransform,
    surfaceDepth: surface?.surfaceDepth ?? base.surfaceDepth,
    thesis: `A combined direction: ${base.thesis}`,
  });
}

function mergeVisualSystem(
  structuralSource: DesignAlternative | undefined,
  colorSource: DesignAlternative | undefined,
  kept: readonly DirectionTrait[],
): DesignVisualSystem | null {
  const base = structuralSource?.visualSystem;
  if (!base) return null;
  const navigation = kept.find((trait) => trait.axis === "navigation");
  const density = kept.find((trait) => trait.axis === "density");
  return Object.freeze({
    ...base,
    navigationType: navigation?.label ?? base.navigationType,
    density: density?.label ?? base.density,
    colorRoles: colorSource?.visualSystem?.colorRoles ?? base.colorRoles,
  });
}
