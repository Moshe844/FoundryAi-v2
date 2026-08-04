import type { ProductRenderSpec } from "./product-render-spec.js";

export type DesignRenderContract = Readonly<{
  rendererVersion: string;
  renderContractId: string;
  productName: string;
  outcome: string;
  directionName: string;
  personality: string;
  primitive: string;
  family: string;
  regions: readonly string[];
  labels: readonly string[];
  workflows: readonly string[];
  authentication: Readonly<{
    required: boolean;
    mode: "sign-in" | "sign-up";
    title: string;
    identityLabel: string;
    secretLabel: string;
    actionLabel: string;
    secondaryAction: string;
  }>;
  primaryAction: string;
  responsiveTransform: string;
  imageryTreatment: string;
  motionStrategy: string;
  spacingRhythm: string;
  surfaceDepth: string;
  typeVoice: string;
  typeScale: string;
  density: string;
  navigationType: string;
  layoutType: string;
  contentEmphasis: string;
  interactionModel: string;
  buttonTreatment: string;
  colors: Readonly<Record<"background" | "surface" | "primary" | "accent" | "text", string>>;
  productRenderSpec: ProductRenderSpec;
}>;

export function createDesignRenderContract(input: Readonly<Record<string, any>>): DesignRenderContract;
export function designRendererRequirements(contract: DesignRenderContract): Readonly<{
  rendererVersion: string;
  family: string;
  rootClass: string;
  responsiveClass: string;
  requiredClasses: readonly string[];
  structuralRules: readonly string[];
  responsiveBreakpointPx: number;
}>;
export function renderDesignConceptDocument(contract: DesignRenderContract): string;
