export type ProductRenderRegion = Readonly<{
  id: string;
  kind: string;
  title: string;
  items: readonly string[];
}>;

export type ProductRenderScreen = Readonly<{
  id: string;
  kind: string;
  order: number;
  navLabel: string;
  eyebrow: string;
  title: string;
  summary: string;
  primaryAction: string;
  secondaryAction: string;
  regions: readonly ProductRenderRegion[];
  states: readonly ("default" | "loading" | "empty" | "error" | "success")[];
}>;

export type ProductRenderSpec = Readonly<{
  specVersion: string;
  renderSpecId: string;
  productName: string;
  productSummary: string;
  audiences: readonly string[];
  projectTerms: readonly string[];
  screens: readonly ProductRenderScreen[];
  initialScreenId: string;
  navigation: readonly Readonly<{ screenId: string; label: string }>[];
  transitions: readonly Readonly<{ from: string; action: string; to: string }>[];
  responsiveModes: readonly Readonly<{ id: string; width: number; navigation: string }>[];
}>;

export function createProductRenderSpec(input: Readonly<Record<string, any>>): ProductRenderSpec;
export function productRenderSpecRequirements(spec: ProductRenderSpec): Readonly<{
  renderSpecId: string;
  requiredScreenIds: readonly string[];
  requiredRegionIds: readonly string[];
  requiredStateNames: readonly string[];
  initialScreenId: string;
}>;
