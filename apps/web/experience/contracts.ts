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
  whyItMatters: Sourced<string>;
  confidence: Sourced<Confidence>;
}>;

export type DesignAlternative = Readonly<{
  id: string;
  name: Sourced<string>;
  description: Sourced<string>;
  tradeoffs: Sourced<readonly string[]>;
  recommended: Sourced<boolean>;
}>;

export type FoundryRecommendation = Readonly<{
  id: string;
  title: Sourced<string>;
  value: Sourced<string>;
  reason: Sourced<string>;
  selectedByDefault: Sourced<boolean | null>;
  impact: Sourced<RecommendationImpact | null>;
}>;

export type FoundryProposal = Readonly<{
  items: Sourced<readonly string[]>;
  includedDefaults: Sourced<readonly string[]>;
  reasoning: Sourced<readonly string[]>;
  observations: readonly FoundryObservation[];
  alternatives: readonly DesignAlternative[];
  recommendations: readonly FoundryRecommendation[];
}>;

export type ProjectUnderstanding = Readonly<{
  projectName: Sourced<string>;
  summary: Sourced<string>;
  audiences: Sourced<readonly string[]>;
  journeys: readonly ProjectJourney[];
  proposal: FoundryProposal;
}>;

export type ClarificationDecision = Readonly<{
  questionId: string;
  prompt: Sourced<string>;
  reason: Sourced<string>;
  choices: Sourced<readonly string[]>;
  recommendation: Sourced<string>;
  answer: Sourced<string | null> | null;
}>;

export type DecisionBrief = Readonly<{
  whatWillBeBuilt: Sourced<readonly string[]>;
  audiences: Sourced<readonly string[]>;
  journeys: readonly ProjectJourney[];
  decisions: Sourced<readonly string[]>;
  assumptions: Sourced<readonly string[]>;
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
  | "unavailable"
  | "stopped";

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
  deliveredArtifact: Sourced<string | null>;
  verifiedOutcomes: readonly VerifiedOutcome[];
  unverifiedObligations: Sourced<readonly string[]>;
  limitations: readonly KnownLimitation[];
  nextSteps: readonly SuggestedNextStep[];
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
  providers: readonly ProviderTransparency[];
  surface:
    | "reading"
    | "unsupported"
    | "understanding"
    | "plan"
    | "building"
    | "completion"
    | "stopped";
}>;

export type ProjectQuestion = Readonly<{
  questionId: string;
  prompt: string;
  reason: string;
  answerOptions: readonly string[];
}>;

export type ProjectSuggestion = Readonly<{
  suggestionId: string;
  label: string;
  rationale: string;
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
  outcomes: readonly string[];
  capabilities: readonly string[];
  dataConcepts: readonly string[];
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

export type Mission = Readonly<{
  missionId: string;
  intent: string;
  state: string;
  profile: ProjectProfile | null;
  contract: Readonly<{
    contractVersion: number;
    obligations: readonly Readonly<{
      obligationId: string;
      statement: string;
      origin: string;
    }>[];
  }> | null;
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
  reason: string;
  models: readonly Readonly<{
    modelId: string;
    displayName: string;
    status: string;
  }>[];
}>;
