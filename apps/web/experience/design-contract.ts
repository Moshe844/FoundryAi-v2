import type {
  CreativeDNA,
  CustomerFollowUpAnswer,
  DecisionSelection,
  DesignAlternative,
  DesignVisualSystem,
  ProjectDesignDirection,
} from "./contracts";
import type { CustomDesignComposition } from "./custom-direction";
import {
  createDesignRenderContract,
  type DesignRenderContract,
} from "../../../src/domain/design-concept-renderer.js";
import type { ApprovedDesignContract as LiveApprovedDesignContract } from "../../../src/domain/live-concept-studio.js";

export type ApprovedPrototypeContract = LiveApprovedDesignContract;

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
  // Structural design DNA is what makes a direction recognizable in the built
  // application. Carrying only a name, a mood and a palette is exactly how a
  // build ends up "borrowing the colour" and nothing else.
  creativeDNA: CreativeDNA | null;
  compositionPrimitive: string | null;
  surfaceSequence: readonly string[];
  exclusions: readonly string[];
  customComposition: CustomDesignComposition | null;
  accessibilityRequirements: readonly string[];
  tradeoff: string | null;
  confidence: number | null;
  renderContract: DesignRenderContract;
  approvedPrototypeContract: LiveApprovedDesignContract | null;
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
  customComposition,
  outcome,
  productName,
  sourceProfileVersion,
  workflows,
  audiences = [],
  capabilities = [],
  dataConcepts = [],
  approvedPrototypeContract = null,
}: Readonly<{
  alternatives: readonly DesignAlternative[];
  direction: ProjectDesignDirection;
  mode: "recommended" | "alternative" | "other";
  optionId?: string;
  customValue?: string;
  customComposition?: CustomDesignComposition;
  outcome: string;
  productName: string;
  sourceProfileVersion: number;
  workflows: readonly string[];
  audiences?: readonly string[];
  capabilities?: readonly string[];
  dataConcepts?: readonly string[];
  approvedPrototypeContract?: LiveApprovedDesignContract | null;
}>): ApprovedDesignContract {
  const selected = selectedAlternative(alternatives, mode, optionId);
  const recommended = alternatives.find((item) => item.recommended.value);
  const base = selected ?? recommended;
  const customerInstructions =
    mode === "other" ? text(customValue, "Use a custom customer direction.") : null;
  const hasApprovedPrototype = approvedPrototypeContract !== null;
  const selectedDirectionName =
    hasApprovedPrototype
      ? text(
          customValue,
          `Live concept ${approvedPrototypeContract.selectedConceptId}`,
        )
      : mode === "other"
        ? "Customer-composed direction"
        : text(selected?.name.value, direction.recommendedStyle.value);
  const creativeDNA = hasApprovedPrototype
    ? null
    : (customComposition?.creativeDNA ?? base?.creativeDNA ?? null);
  const visualSystem = hasApprovedPrototype
    ? null
    : (customComposition?.visualSystem ?? base?.visualSystem ?? null);
  const personality =
    hasApprovedPrototype
      ? approvedPrototypeContract.creativeThesis
      : mode === "other"
      ? text(customComposition?.rationale, customerInstructions ?? direction.tone.value)
      : text(base?.visualPersonality.value, direction.tone.value);
  const renderContract = createDesignRenderContract({
    productName,
    outcome,
    directionName: selectedDirectionName,
    personality,
    workflows,
    audiences,
    capabilities,
    dataConcepts,
    visualSystem,
    creativeDNA,
  });

  const contract = {
    schemaVersion: 1 as const,
    sourceProfileVersion,
    selectionMode:
      mode === "other"
        ? ("custom" as const)
        : mode === "alternative"
          ? ("alternative" as const)
          : ("recommended" as const),
    selectedDirectionId: hasApprovedPrototype
      ? approvedPrototypeContract.selectedConceptId
      : (selected?.id ?? null),
    selectedDirectionName,
    rationale:
      approvedPrototypeContract?.creativeThesis ??
      selected?.whyItFits.value ??
      (mode === "other"
        ? "The customer supplied a custom design direction that must be preserved during generation."
        : direction.reason.value),
    customerInstructions,
    composition: {
      layoutApproach: text(
        hasApprovedPrototype
          ? approvedPrototypeContract.compositionRules.join(" ")
          : base?.layoutApproach.value,
        direction.layoutApproach.value,
      ),
      navigationApproach: text(
        hasApprovedPrototype
          ? approvedPrototypeContract.navigation
          : base?.navigationApproach.value,
        "Choose navigation that best supports the approved journeys.",
      ),
      informationDensity: text(
        hasApprovedPrototype
          ? approvedPrototypeContract.components
          : base?.informationDensity.value,
        "Use information density appropriate to the audience and task frequency.",
      ),
      mobileBehavior: text(
        hasApprovedPrototype
          ? approvedPrototypeContract.responsiveBehavior.join(" ")
          : base?.mobileBehavior.value,
        direction.mobilePriority.value,
      ),
    },
    visualCharacter: {
      personality: hasApprovedPrototype
        ? approvedPrototypeContract.creativeThesis
        : text(base?.visualPersonality.value, direction.tone.value),
      typography: text(
        hasApprovedPrototype
          ? Object.values(approvedPrototypeContract.typography).join(" · ")
          : base?.preview.typographyCharacter.value,
        "Typography must express the approved personality and remain highly readable.",
      ),
      colorMood: text(
        hasApprovedPrototype
          ? Object.entries(approvedPrototypeContract.colorTokens)
              .map(([token, value]) => `${token}: ${value}`)
              .join(" · ")
          : base?.preview.colorMood.value,
        "Choose a project-appropriate accessible color system.",
      ),
      hierarchy: text(
        hasApprovedPrototype
          ? approvedPrototypeContract.compositionRules.join(" ")
          : base?.preview.hierarchy.value,
        "Use a clear hierarchy centered on the primary customer outcome.",
      ),
      spacingDensity: text(
        hasApprovedPrototype
          ? `Base ${approvedPrototypeContract.spacingTokens.baseUnit}px; scale ${approvedPrototypeContract.spacingTokens.scale.join(", ")}`
          : base?.preview.spacingDensity.value,
        "Use spacing that supports the approved information density.",
      ),
    },
    visualSystem,
    creativeDNA,
    compositionPrimitive:
      customComposition?.creativeDNA?.compositionPrimitive ??
      base?.creativeDNA?.compositionPrimitive ??
      null,
    surfaceSequence: hasApprovedPrototype
      ? [...approvedPrototypeContract.approvedSurfaceSequence]
      : [
          ...(customComposition?.creativeDNA?.surfaceSequence ??
            base?.creativeDNA?.surfaceSequence ??
            []),
        ],
    exclusions: hasApprovedPrototype
      ? [...approvedPrototypeContract.explicitExclusions]
      : [...(base?.creativeDNA?.exclusions ?? [])],
    customComposition: customComposition ?? null,
    accessibilityRequirements: hasApprovedPrototype
      ? [...approvedPrototypeContract.accessibility]
      : [...direction.accessibilityConsiderations.value],
    tradeoff: selected?.tradeoff.value ?? null,
    confidence: selected?.confidence.value ?? null,
    renderContract,
    approvedPrototypeContract,
  };

  return contract;
}
