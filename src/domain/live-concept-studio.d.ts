export const CONCEPT_PROTOTYPE_SCHEMA_VERSION: 1;
export const CONCEPT_COMPOSITION_SCHEMA_VERSION: 1;
export const APPROVED_DESIGN_CONTRACT_SCHEMA_VERSION: 1;

export const ConceptStrategy: Readonly<{
  STANDARD: "standard";
  SHOCK: "shock";
  REVISION: "revision";
  COMPOSITION: "composition";
}>;

export type ConceptStrategyValue = typeof ConceptStrategy[keyof typeof ConceptStrategy];

export interface ConceptVerificationCheck {
  checkId: string;
  kind: "browser" | "runtime" | "security" | "differentiation";
  statement: string;
}

export interface ConceptPrototypeContract {
  schemaVersion: 1;
  conceptId: string;
  missionId: string;
  conceptVersion: number;
  conceptName: string;
  creativeThesis: string;
  intendedAudienceResponse: string;
  designRationale: string;
  projectSurfaces: readonly string[];
  pageOrScreenSequence: readonly string[];
  navigationModel: string;
  compositionRules: readonly string[];
  typographySystem: Readonly<Record<string, string>>;
  colorSystem: Readonly<Record<"background" | "surface" | "text" | "primary" | "accent", string>>;
  spacingSystem: Readonly<{ baseUnit: number; scale: readonly number[] }>;
  imageryStrategy: string;
  componentCharacter: string;
  interactionRules: readonly string[];
  motionRules: readonly string[];
  responsiveRules: readonly string[];
  accessibilityRules: readonly string[];
  deliberateExclusions: readonly string[];
  sampleContentPolicy: string;
  expectedFiles: readonly string[];
  expectedPreviewRoutes: readonly string[];
  verificationPlan: readonly ConceptVerificationCheck[];
  sourceProjectDesignVersion: number;
  strategy: ConceptStrategyValue;
  parentConceptId: string | null;
  sourceConceptIds: readonly string[];
  integrityHash: string;
}

export interface ConceptComposition {
  schemaVersion: 1;
  compositionId: string;
  missionId: string;
  sourceConceptIds: readonly string[];
  selectedTraits: readonly Readonly<{ trait: string; conceptId: string }>[];
  conflicts: readonly Readonly<{ trait: string; conceptIds: readonly string[]; reason: string }>[];
  conflictResolution: readonly Readonly<{ trait: string; resolution: string }>[];
  resultingDesignSystem: Readonly<Record<string, string>>;
  resultingComposition: readonly string[];
  resultingResponsiveBehavior: readonly string[];
  customerNotes: readonly string[];
  rationale: string;
  createdAt: string;
  integrityHash: string;
}

export interface PrototypeFileManifestEntry {
  path: string;
  contentHash: string;
  size: number;
}

export interface ApprovedDesignContract {
  schemaVersion: 1;
  approvedDesignId: string;
  missionId: string;
  selectedConceptId: string;
  selectedConceptVersion: number;
  creativeThesis: string;
  approvedSurfaceSequence: readonly string[];
  compositionRules: readonly string[];
  navigation: string;
  typography: Readonly<Record<string, string>>;
  colorTokens: Readonly<Record<string, string>>;
  spacingTokens: Readonly<{ baseUnit: number; scale: readonly number[] }>;
  imagery: string;
  components: string;
  interactions: readonly string[];
  motion: readonly string[];
  responsiveBehavior: readonly string[];
  accessibility: readonly string[];
  customerModifications: readonly string[];
  explicitExclusions: readonly string[];
  prototypeFileManifest: readonly PrototypeFileManifestEntry[];
  screenshotEvidenceReferences: readonly string[];
  browserEvidenceReferences: readonly string[];
  prototypeIntegrityHash: string;
  prototypeContentHash: string;
  approvalTimestamp: string;
  integrityHash: string;
}

export function computeConceptPrototypeIntegrityHash(
  contract: Omit<ConceptPrototypeContract, "integrityHash"> | ConceptPrototypeContract,
): string;
export function createConceptPrototypeContract(
  input: Omit<ConceptPrototypeContract, "schemaVersion" | "integrityHash">,
): ConceptPrototypeContract;
export function normalizeConceptPrototypeContract(input: ConceptPrototypeContract): ConceptPrototypeContract;
export function createConceptComposition(
  input: Omit<ConceptComposition, "schemaVersion" | "createdAt" | "integrityHash"> & { createdAt?: string },
): ConceptComposition;
export function computeApprovedDesignIntegrityHash(
  contract: Omit<ApprovedDesignContract, "integrityHash"> | ApprovedDesignContract,
): string;
export function createApprovedDesignContract(input: {
  missionId: string;
  selectedConcept: ConceptPrototypeContract;
  customerModifications: readonly string[];
  prototypeFileManifest: readonly PrototypeFileManifestEntry[];
  screenshotEvidenceReferences: readonly string[];
  browserEvidenceReferences: readonly string[];
  approvalTimestamp: string;
}): ApprovedDesignContract;
export function normalizeApprovedDesignContract(input: ApprovedDesignContract): ApprovedDesignContract;
export function designFidelityRequiresPrototypeEvidence(
  designSpecification: { approvedDesignContract?: ApprovedDesignContract | null } | null | undefined,
): boolean;
