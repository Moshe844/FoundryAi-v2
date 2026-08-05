export const EXPERIENCE_SOURCE_KINDS = [
  "project-understanding",
  "requirement-contract",
  "customer-answer",
  "foundry-assumption",
  "model-recommendation",
  "capability-registry",
  "mission-ledger",
  "runtime-evidence",
  "browser-evidence",
  "completion-verdict",
] as const;

export type ExperienceSourceKind = (typeof EXPERIENCE_SOURCE_KINDS)[number];

export type ExperienceSource = Readonly<{
  kind: ExperienceSourceKind;
  reference: string;
}>;

export type Sourced<T> = Readonly<{
  value: T;
  source: ExperienceSource;
}>;

export type Confidence = "high" | "medium" | "low";
export type RecommendationImpact = "product" | "architecture" | "scope";

export type ProjectSummary = Readonly<{
  missionId: Sourced<string>;
  name: Sourced<string>;
  summary: Sourced<string | null>;
  customerPhase: Sourced<string>;
  customerStatus: Sourced<string>;
  actionLabel: Sourced<string>;
  lastActivityAt: Sourced<string | null>;
}>;

export type ProjectJourney = Readonly<{
  id: string;
  description: Sourced<string>;
}>;

export type FoundryObservation = Readonly<{
  id: string;
  observation: Sourced<string>;
  whyItMatters: Sourced<string | null>;
  confidence: Sourced<Confidence | null>;
}>;

export type DesignVisualSystem = Readonly<{
  layoutType: string;
  navigationType: string;
  typographyCategory: string;
  density: string;
  spacingProfile: string;
  surfaceTreatment: string;
  contentEmphasis: string;
  imageStrategy: string;
  interactionModel: string;
  buttonTreatment: string;
  colorRoles: Readonly<Record<"background" | "surface" | "primary" | "accent" | "text", string>>;
  sampleLabels: readonly string[];
}>;

export type CreativeDNA = Readonly<{
  thesis: string;
  emotionalGoal: string;
  audienceResponse: string;
  compositionPrimitive: string;
  typeScale: string;
  typeVoice: string;
  imageryTreatment: string;
  motionStrategy: string;
  spacingRhythm: string;
  surfaceDepth: string;
  responsiveTransform: string;
  surfaceSequence: readonly string[];
  exclusions: readonly string[];
  surfaceLabels: readonly string[];
  primaryAction: string;
}>;

export type DesignAlternative = Readonly<{
  id: string;
  name: Sourced<string>;
  description: Sourced<string>;
  whyItFits: Sourced<string>;
  layoutApproach: Sourced<string>;
  visualPersonality: Sourced<string>;
  informationDensity: Sourced<string>;
  navigationApproach: Sourced<string>;
  mobileBehavior: Sourced<string>;
  tradeoff: Sourced<string>;
  confidence: Sourced<number>;
  preview: Readonly<{
    typographyCharacter: Sourced<string>;
    spacingDensity: Sourced<string>;
    colorMood: Sourced<string>;
    hierarchy: Sourced<string>;
  }>;
  visualSystem?: DesignVisualSystem;
  creativeDNA?: CreativeDNA;
  recommended: Sourced<boolean>;
}>;

export type FoundryRecommendation = Readonly<{
  id: string;
  title: Sourced<string>;
  value: Sourced<string>;
  reason: Sourced<string>;
  selectedByDefault: Sourced<boolean | null>;
  impact: Sourced<string | null>;
  confidence: Sourced<number | null>;
  dependencies: Sourced<readonly string[]>;
}>;

export type ProjectDesignDirection = Readonly<{
  recommendedStyle: Sourced<string>;
  reason: Sourced<string>;
  layoutApproach: Sourced<string>;
  tone: Sourced<string>;
  mobilePriority: Sourced<string>;
  accessibilityConsiderations: Sourced<readonly string[]>;
}>;

export type FoundryProposal = Readonly<{
  items: Sourced<readonly string[]>;
  includedDefaults: Sourced<readonly string[]>;
  designDirection: ProjectDesignDirection;
  reasoning: Sourced<readonly string[]>;
  exclusions: Sourced<readonly string[]>;
  observations: readonly FoundryObservation[];
  alternatives: readonly DesignAlternative[];
  recommendations: readonly FoundryRecommendation[];
  smartSuggestions: readonly Readonly<{
    id: string;
    label: Sourced<string>;
    reason: Sourced<string>;
  }>[];
}>;

export type ProjectUnderstanding = Readonly<{
  projectName: Sourced<string>;
  summary: Sourced<string>;
  audiences: Sourced<readonly string[]>;
  isRevised: Sourced<boolean>;
  journeys: readonly ProjectJourney[];
  proposal: FoundryProposal;
}>;

export type ClarificationDecision = Readonly<{
  questionId: string;
  prompt: Sourced<string>;
  reason: Sourced<string>;
  choices: Sourced<readonly string[]>;
  recommendation: Sourced<string>;
  recommendationReason: Sourced<string>;
  consequences: Sourced<readonly string[]>;
  architectureImpact: Sourced<string>;
  scopeImpact: Sourced<string>;
  answer: Sourced<string | null> | null;
}>;

export type DecisionBrief = Readonly<{
  projectName: Sourced<string>;
  whatWillBeBuilt: Sourced<string>;
  audiences: Sourced<readonly string[]>;
  journeys: readonly ProjectJourney[];
  designDirection: ProjectDesignDirection;
  structure: Sourced<string>;
  technicalShape: Readonly<{
    stackId: Sourced<string>;
    stackVersion: Sourced<string>;
    framework: Sourced<string>;
    frameworkVersion: Sourced<string | null>;
    language: Sourced<string>;
    database: Sourced<string>;
    packageManager: Sourced<string>;
    browserTesting: Sourced<string>;
    knownLimitations: Sourced<readonly string[]>;
  }>;
  decisions: readonly ClarificationDecision[];
  foundryChoices: Sourced<readonly string[]>;
  assumptions: Sourced<readonly string[]>;
  explicitExclusions: Sourced<readonly string[]>;
  selectedEnhancements: readonly FoundryRecommendation[];
  verificationObligations: Sourced<readonly string[]>;
}>;

export type MissionPhaseState =
  | "complete"
  | "current"
  | "pending"
  | "interrupted"
  | "unavailable";

export type MissionPhase = Readonly<{
  id: string;
  label: Sourced<string>;
  status: Sourced<MissionPhaseState>;
  detail: Sourced<string | null>;
}>;

export type MissionNarrative = Readonly<{
  headline: Sourced<string>;
  detail: Sourced<string>;
}>;

export type RepairNarrative = Readonly<{
  state: Sourced<
    | "automatic"
    | "different-strategy"
    | "budget-warning"
    | "customer-action-required"
    | "external-service"
    | "verification-incomplete"
    | "honest-exhaustion"
  >;
  lines: Sourced<readonly string[]>;
  affectedArea: Sourced<string | null>;
  observedProblem: Sourced<string | null>;
  correction: Sourced<string | null>;
  checksToRerun: Sourced<readonly string[]>;
  customerActionRequired: Sourced<boolean>;
}>;

export type PreviewStateName =
  | "absent"
  | "starting"
  | "live"
  | "rebuilding"
  | "disconnected"
  | "crashed"
  | "stopped"
  | "error"
  | "unavailable";

export type PreviewState = Readonly<{
  state: Sourced<PreviewStateName>;
  readinessUrl: Sourced<string | null>;
}>;

export type ApprovalRequest = Readonly<{
  available: Sourced<boolean>;
  requestId: Sourced<string | null>;
  description: Sourced<string | null>;
}>;

export type Blocker = Readonly<{
  active: Sourced<boolean>;
  description: Sourced<string | null>;
  customerAction: Sourced<string | null>;
}>;

export type VerifiedOutcome = Readonly<{
  obligationId: string;
  statement: Sourced<string>;
  evidenceReferences: Sourced<readonly string[]>;
}>;

export type UnverifiedOutcome = Readonly<{
  obligationId: string;
  statement: Sourced<string>;
  result: Sourced<"PENDING" | "NOT_SATISFIED" | "UNVERIFIABLE">;
  detail: Sourced<string | null>;
}>;

export type CompletionDecision = Readonly<{
  id: string;
  label: Sourced<string>;
  answer: Sourced<string>;
  attribution: Sourced<"customer" | "foundry">;
  reason: Sourced<string>;
}>;

export type KnownLimitation = Readonly<{
  id: string;
  description: Sourced<string>;
}>;

export type SuggestedNextStep = Readonly<{
  id: string;
  description: Sourced<string>;
}>;

export type CompletionSummary = Readonly<{
  available: Sourced<boolean>;
  complete: Sourced<boolean>;
  projectName: Sourced<string | null>;
  deliveredArtifact: Sourced<string | null>;
  buildDuration: Sourced<string | null>;
  browserEvidencePresent: Sourced<boolean>;
  provedCount: Sourced<number>;
  totalCount: Sourced<number>;
  verifiedOutcomes: readonly VerifiedOutcome[];
  unverifiedOutcomes: readonly UnverifiedOutcome[];
  decisions: readonly CompletionDecision[];
  launchRequirements: readonly KnownLimitation[];
  limitations: readonly KnownLimitation[];
  nextSteps: readonly SuggestedNextStep[];
}>;

export type LifecycleOutcomeKind =
  | "failed"
  | "exhausted"
  | "blocked"
  | "cancelled";

export type LifecycleOutcome = Readonly<{
  kind: Sourced<LifecycleOutcomeKind>;
  projectName: Sourced<string>;
  headline: Sourced<string>;
  whatWasHappening: Sourced<string>;
  whatHappened: Sourced<string>;
  provedCount: Sourced<number>;
  totalCount: Sourced<number>;
  provedOutcomes: readonly VerifiedOutcome[];
  unprovedOutcomes: readonly UnverifiedOutcome[];
  completedPhases: Sourced<readonly string[]>;
  whatToTryNext: Sourced<string>;
  whatINeed: Sourced<string>;
  planSaved: Sourced<boolean>;
}>;

export type UnsupportedSummary = Readonly<{
  requestedPlatform: Sourced<string>;
  requestedDescription: Sourced<string>;
  supportedOutcome: Sourced<string>;
  alternative: Sourced<string>;
}>;

export type ProviderModelTransparency = Readonly<{
  modelId: Sourced<string>;
  displayName: Sourced<string>;
  status: Sourced<string>;
}>;

export type ProviderTransparency = Readonly<{
  providerId: Sourced<string>;
  displayName: Sourced<string>;
  available: Sourced<boolean>;
  health: Sourced<string>;
  reason: Sourced<string>;
  models: readonly ProviderModelTransparency[];
}>;

export type FoundryExperienceModel = Readonly<{
  project: ProjectSummary;
  understanding: ProjectUnderstanding | null;
  clarification: readonly ClarificationDecision[];
  decisionBrief: DecisionBrief | null;
  phases: readonly MissionPhase[];
  narrative: MissionNarrative;
  repair: RepairNarrative | null;
  preview: PreviewState;
  approval: ApprovalRequest;
  blocker: Blocker | null;
  completion: CompletionSummary;
  lifecycleOutcome: LifecycleOutcome | null;
  unsupported: UnsupportedSummary | null;
  providers: readonly ProviderTransparency[];
  surface:
    | "reading"
    | "unsupported"
    | "understanding"
    | "plan"
    | "building"
    | "completion"
    | "failed"
    | "blocked"
    | "cancelled";
}>;

export type ProjectQuestion = Readonly<{
  questionId: string;
  prompt: string;
  reason: string;
  answerOptions: readonly string[];
  recommendation?: string;
  recommendationReason?: string;
  consequences?: readonly string[];
  architectureImpact?: string;
  scopeImpact?: string;
}>;

export type ProjectSuggestion = Readonly<{
  suggestionId: string;
  label: string;
  rationale: string;
  value?: string;
  impact?: string;
  selectedByDefault?: boolean;
  confidence?: number;
  requiredDependencies?: readonly string[];
}>;

export type ProjectDesignAlternative = Readonly<{
  approach: string;
  rationale: string;
  tradeoffs?: readonly string[];
  whyItFits?: string;
  layoutApproach?: string;
  visualPersonality?: string;
  informationDensity?: string;
  navigationApproach?: string;
  mobileBehavior?: string;
  tradeoff?: string;
  confidence?: Readonly<{ score: number; rationale: string }>;
  preview?: Readonly<{
    typographyCharacter: string;
    spacingDensity: string;
    colorMood: string;
    hierarchy: string;
  }>;
  visualSystem?: DesignVisualSystem;
  creativeDNA?: CreativeDNA;
  recommended: boolean;
}>;

export type VerificationCheck = Readonly<{
  checkId: string;
  label: string;
  origin: "customer-stated" | "foundry-derived";
}>;

export type ProjectProfile = Readonly<{
  missionId: string;
  profileVersion: number;
  name: string;
  summary: string;
  family: string;
  platform: string;
  primaryActors: readonly string[];
  primaryJourneys: readonly string[];
  outcomes: readonly string[];
  capabilities: readonly string[];
  dataConcepts: readonly string[];
  designDirection: Readonly<{
    recommendedStyle: string;
    reason: string;
    layoutApproach: string;
    tone: string;
    mobilePriority: string;
    accessibilityConsiderations: readonly string[];
  }>;
  includedDefaults: readonly string[];
  assumptions: readonly string[];
  customerContent: Readonly<{
    supplied: readonly Readonly<{
      kind: string;
      value: string;
      source: "customer-request" | "customer-answer";
    }>[];
    missingBeforeLaunch: readonly string[];
  }>;
  observations: readonly string[];
  designAlternatives: readonly ProjectDesignAlternative[];
  constraints: readonly string[];
  architectureDecisions: readonly string[];
  openQuestions: readonly ProjectQuestion[];
  contextualSuggestions: readonly ProjectSuggestion[];
  selectedStack: Readonly<{ stackId: string; version: string }>;
  verificationPlan: Readonly<{ checks: readonly VerificationCheck[] }>;
}>;

export type MissionActivity = Readonly<{
  sequence: number;
  occurredAt: string;
  kind: string;
  title: string;
  detail: string;
}>;

export type ModelRoute = Readonly<{
  sequence: number;
  occurredAt: string;
  requestId: string;
  provider: string;
  providerFamily: string | null;
  modelId: string;
  taskClass: string;
  depthLevel: number | null;
  routingReason: string | null;
  status: string;
  attempt: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}>;

export type CustomerInputKind =
  | "context"
  | "understanding"
  | "workflow"
  | "feature"
  | "design"
  | "business-rule"
  | "role"
  | "integration"
  | "limitation"
  | "acceptance"
  | "design-preference"
  | "workflow-change"
  | "feature-request"
  | "content-requirement"
  | "acceptance-expectation"
  | "correction"
  | "other";

export type DecisionSelectionKind =
  | "product-subtype"
  | "blueprint-approval"
  | "design-direction"
  | "recommendation"
  | "decision"
  | "customer-message"
  | "proposal-confirmation";

export type DecisionSelectionMode =
  | "accept-recommendation"
  | "delegate"
  | "select-option"
  | "other"
  | "include"
  | "exclude"
  | "message"
  | "confirm";

export type DecisionSelection = Readonly<{
  kind: DecisionSelectionKind;
  subjectId: string;
  mode: DecisionSelectionMode;
  optionId: string | null;
  value: string;
  reason: string;
  classification: string | null;
  sourceProfileVersion: number;
}>;

export type CustomerFollowUpAnswer = Readonly<{
  questionId: string;
  answer: string;
  selection?: DecisionSelection;
}>;

export type ProductTypeDiscovery = Readonly<{
  schemaVersion: 1;
  originalRequest: string;
  context: readonly string[];
  interpretation: Readonly<{
    summary: string;
    reasoning: string;
    confidence: number;
  }>;
  subtypes: readonly Readonly<{
    optionId: string;
    title: string;
    explanation: string;
    likelyUsers: readonly string[];
    likelyPrimaryOutcome: string;
    whyItMayFit: string;
    confidence: Readonly<{
      score: number;
      reason: string;
    }>;
    recommended: boolean;
    canCombine: boolean;
    combinationNote: string;
    compatibilityTags: readonly string[];
    deliveryPlatform: "web";
    requiredCapabilities: readonly string[];
  }>[];
}>;

export type ProductBlueprint = Readonly<{
  schemaVersion: 1;
  missionId: string;
  blueprintVersion: number;
  originalCustomerRequest: string;
  exactProductType: string;
  selectedSubtypes: readonly string[];
  productName: string;
  oneSentenceOutcome: string;
  intendedUsers: readonly string[];
  businessGoal: string;
  primaryWorkflows: readonly string[];
  supportingWorkflows: readonly string[];
  requiredSurfaces: readonly string[];
  navigationApproach: string;
  contentStructure: string;
  administrationNeeds: readonly string[];
  securityConsiderations: readonly string[];
  dataAndPersistenceNeeds: readonly string[];
  responsivePriorities: string;
  accessibilityNeeds: readonly string[];
  experienceStates: Readonly<Record<"empty" | "loading" | "error" | "success", readonly string[]>>;
  includedNow: readonly string[];
  excludedFromV1: readonly string[];
  recommendedLater: readonly string[];
  designSpecification: Readonly<Record<string, unknown>>;
  selectedFeatures: readonly string[];
  rejectedRecommendations: readonly string[];
  foundryDecisions: readonly string[];
  customerDecisions: readonly string[];
  customCustomerMessages: readonly string[];
  businessRules: readonly string[];
  integrations: readonly string[];
  assumptions: readonly string[];
  architecture: readonly string[];
  certifiedStackCapability: Readonly<Record<string, unknown>>;
  acceptanceRequirements: readonly string[];
  verificationPlan: readonly Readonly<{
    sourceRequirement: string;
    observableOutcome: string;
    acceptanceMethod: string;
  }>[];
  quality: Readonly<Record<string, number>>;
  integrityHash: string;
}>;

export type DiscoveryConversation = Readonly<{
  messages: readonly Readonly<{
    messageId: string;
    kind: CustomerInputKind;
    text: string;
    interpretation: string;
    affectedSections: readonly string[];
    status: "applied" | "pending";
    profileVersion: number;
    occurredAt: string;
  }>[];
  latestRevision: Readonly<{
    profileVersion: number;
    changedSections: readonly string[];
  }>;
}>;

export type LiveConcept = Readonly<{
  contract: Readonly<{
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
    typographySystem: Readonly<Record<string, string>>;
    colorSystem: Readonly<Record<string, string>>;
    imageryStrategy: string;
    componentCharacter: string;
    interactionRules: readonly string[];
    motionRules: readonly string[];
    responsiveRules: readonly string[];
    accessibilityRules: readonly string[];
    deliberateExclusions: readonly string[];
    sourceProjectDesignVersion: number;
    strategy: string;
    integrityHash: string;
  }>;
  recommended: boolean;
  recommendationReason: string;
  keyDistinction: string;
  tradeoff: string;
  verificationId: string;
  verificationStatus: "PASSED" | "REJECTED";
  verificationFindings: readonly string[];
  screenshotEvidenceReferences: readonly string[];
  contentHash: string;
  usage: Readonly<{ inputTokens: number; outputTokens: number; costUsd: number }>;
  generatedAt: string;
  thumbnailUrl: string | null;
}>;

export type LiveConceptStudio = Readonly<{
  schemaVersion: 1;
  missionId: string;
  sourceProjectDesignVersion: number;
  status: "GENERATING" | "READY" | "FAILED" | "INTERRUPTED";
  recommendedConceptId: string | null;
  recommendationReason: string | null;
  concepts: readonly LiveConcept[];
  generation: Readonly<{
    startedAt: string;
    completedAt: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  selectedConceptId: string | null;
  error: string | null;
  generating: boolean;
  createdAt: string;
  updatedAt: string;
}>;

export type Mission = Readonly<{
  missionId: string;
  intent: string;
  state: string;
  profile: ProjectProfile | null;
  productTypeDiscovery: ProductTypeDiscovery | null;
  productBlueprint: ProductBlueprint | null;
  conceptStudio: LiveConceptStudio | null;
  proposalConfirmed: boolean;
  contract: Readonly<{
    contractVersion: number;
    obligations: readonly Readonly<{
      obligationId: string;
      statement: string;
      origin: string;
    }>[];
  }> | null;
  decisionHistory: readonly Readonly<{
    questionId: string;
    prompt: string;
    reason: string;
    choices: readonly string[];
    recommendation: string;
    answer: string;
  }>[];
  selectedEnhancements: readonly Readonly<{
    suggestionId: string;
    label: string;
    rationale: string;
  }>[];
  discoveryConversation: DiscoveryConversation;
  technicalStack: Readonly<{
    stackId: string;
    stackVersion: string;
    components: Readonly<{
      framework: string;
      language: string;
      database: string;
      packageManager: string;
      browserTesting: string;
    }>;
    frameworkVersion: string | null;
    knownLimitations: readonly string[];
  }>;
  executionProjection: Readonly<{
    timing: Readonly<{
      startedAt: string | null;
      completedAt: string | null;
    }>;
    phase: Readonly<{
      currentIndex: number;
      completedThrough: number;
      interrupted: boolean;
      includesDataPhase: boolean;
    }>;
    repair: Readonly<{
      state:
        | "automatic"
        | "different-strategy"
        | "budget-warning"
        | "customer-action-required"
        | "external-service"
        | "verification-incomplete"
        | "honest-exhaustion";
      lines: readonly string[];
      targetObligationIds: readonly string[];
      affectedArea: string | null;
      findingDetail: string | null;
      attempts: number;
    }> | null;
    runtime: Readonly<{
      status: "READY" | "STARTUP_FAILED" | "HEALTHY" | "CRASHED" | "STOPPED";
      eventType: string;
      previewUrl: string;
      workspaceId: string;
      checkpointId: string;
      sessionId: string;
      plainCause: string | null;
      evidenceReferences: readonly Readonly<{
        evidenceId: string;
        workspaceCheckpointReference: string | null;
      }>[];
    }> | null;
    workspace: Readonly<{
      workspaceId: string | null;
      checkpointIds: readonly string[];
      runtimeAdapterId: string;
    }>;
    verification: readonly Readonly<{
      obligationId: string;
      statement: string;
      result: "PENDING" | "SATISFIED" | "NOT_SATISFIED" | "UNVERIFIABLE";
      detail: string | null;
      evidenceReferences: readonly Readonly<{
        evidenceId: string;
        verificationRequestReference?: string | null;
        workspaceCheckpointReference: string | null;
      }>[];
    }>[];
  }>;
  previewUrl: string | null;
  running: boolean;
  error: string | null;
  activities: readonly MissionActivity[];
  currentActivity: MissionActivity | null;
  modelRouting: readonly ModelRoute[];
  activeModelRoute: ModelRoute | null;
  executionMetrics: Readonly<{
    verifiedObligationIds: readonly string[];
    uniqueHypothesisCount: number;
    repeatedPipelineCost: number;
    installCount: number;
    reinstallCount: number;
    rebuildCount: number;
    runtimeRestartCount: number;
    providerCallCount: number;
    repairScopes: Readonly<Record<string, number>>;
  }> | null;
  updatedAt: string | null;
}>;

export type Provider = Readonly<{
  providerId: string;
  displayName: string;
  configured: boolean;
  formatValid: boolean;
  health: string;
  available: boolean;
  autoRoutingAvailable: boolean;
  lastSuccessfulRefreshAt: string | null;
  refreshStale: boolean;
  refreshMaximumAgeMs: number;
  nextScheduledRefreshAt: string | null;
  lifecycleSourceStatus: string;
  reason: string;
  connectedModels: readonly Readonly<{
    modelId: string;
    displayName: string;
    purpose: string;
    lifecycle: string;
    releaseChannel: string;
    validationStatus: string;
    catalogPresence: string;
    lastSeenAt: string | null;
    missingSince: string | null;
    lastValidatedAt: string | null;
    engineeringEligible: boolean;
    reasons: readonly string[];
  }>[];
  models: readonly Readonly<{
    modelId: string;
    displayName: string;
    status: string;
  }>[];
}>;
