import type {
  CustomerFollowUpAnswer,
  DecisionSelection,
  DesignAlternative,
  DesignVisualSystem,
  ProjectDesignDirection,
} from "./contracts";

export type ApprovedDesignContract = Readonly<{
  schemaVersion: 1;
  sourceProfileVersion: number;
  selectionMode: "recommended" | "alternative" | "custom";
  selectedDirectionId: string | null;
  selectedDirectionName: string;
  rationale: string;
  customerInstructions: string | null;
  composition: Readonly<{
    layoutApproach: string;
    navigationApproach: string;
    informationDensity: string;
    mobileBehavior: string;
  }>;
  visualCharacter: Readonly<{
    personality: string;
    typography: string;
    colorMood: string;
    hierarchy: string;
    spacingDensity: string;
  }>;
  visualSystem: DesignVisualSystem | null;
  accessibilityRequirements: readonly string[];
  tradeoff: string | null;
  confidence: number | null;
}>;

export type StructuredDecisionSelection = DecisionSelection &
  Readonly<{ designContract: ApprovedDesignContract }>;

export type StructuredCustomerFollowUpAnswer = Omit<
  CustomerFollowUpAnswer,
  "selection"
> &
  Readonly<{ selection: StructuredDecisionSelection }>;

function text(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized ? normalized : fallback;
}

function selectedAlternative(
  alternatives: readonly DesignAlternative[],
  mode: "recommended" | "alternative" | "other",
  optionId: string | undefined,
) {
  if (optionId) {
    const exact = alternatives.find((item) => item.id === optionId);
    if (exact) return exact;
  }

  if (mode === "recommended") {
    return alternatives.find((item) => item.recommended.value);
  }

  return undefined;
}

export function buildApprovedDesignContract({
  alternatives,
  direction,
  mode,
  optionId,
  customValue,
  sourceProfileVersion,
}: Readonly<{
  alternatives: readonly DesignAlternative[];
  direction: ProjectDesignDirection;
  mode: "recommended" | "alternative" | "other";
  optionId?: string;
  customValue?: string;
  sourceProfileVersion: number;
}>): ApprovedDesignContract {
  const selected = selectedAlternative(alternatives, mode, optionId);
  const recommended = alternatives.find((item) => item.recommended.value);
  const base = selected ?? recommended;
  const customerInstructions =
    mode === "other" ? text(customValue, "Use a custom customer direction.") : null;
  const selectedDirectionName =
    mode === "other"
      ? text(customValue, "Custom customer direction")
      : text(selected?.name.value, direction.recommendedStyle.value);

  const contract = {
    schemaVersion: 1 as const,
    sourceProfileVersion,
    selectionMode:
      mode === "other"
        ? ("custom" as const)
        : mode === "alternative"
          ? ("alternative" as const)
          : ("recommended" as const),
    selectedDirectionId: selected?.id ?? null,
    selectedDirectionName,
    rationale:
      selected?.whyItFits.value ??
      (mode === "other"
        ? "The customer supplied a custom design direction that must be preserved during generation."
        : direction.reason.value),
    customerInstructions,
    composition: {
      layoutApproach: text(
        base?.layoutApproach.value,
        direction.layoutApproach.value,
      ),
      navigationApproach: text(
        base?.navigationApproach.value,
        "Choose navigation that best supports the approved journeys.",
      ),
      informationDensity: text(
        base?.informationDensity.value,
        "Use information density appropriate to the audience and task frequency.",
      ),
      mobileBehavior: text(
        base?.mobileBehavior.value,
        direction.mobilePriority.value,
      ),
    },
    visualCharacter: {
      personality: text(base?.visualPersonality.value, direction.tone.value),
      typography: text(
        base?.preview.typographyCharacter.value,
        "Typography must express the approved personality and remain highly readable.",
      ),
      colorMood: text(
        base?.preview.colorMood.value,
        "Choose a project-appropriate accessible color system.",
      ),
      hierarchy: text(
        base?.preview.hierarchy.value,
        "Use a clear hierarchy centered on the primary customer outcome.",
      ),
      spacingDensity: text(
        base?.preview.spacingDensity.value,
        "Use spacing that supports the approved information density.",
      ),
    },
    visualSystem: base?.visualSystem ?? null,
    accessibilityRequirements: [
      ...direction.accessibilityConsiderations.value,
    ],
    tradeoff: selected?.tradeoff.value ?? null,
    confidence: selected?.confidence.value ?? null,
  };

  // The local UX can inspect this contract immediately. The current strict
  // clarification API accepts only the canonical DecisionSelection fields, so
  // JSON transport intentionally omits this duplicate browser-side projection.
  // The authoritative backend Product Blueprint independently reconstructs the
  // same approved design from the canonical selection and generated design data.
  Object.defineProperty(contract, "toJSON", {
    value: () => undefined,
    enumerable: false,
  });

  return contract;
}
