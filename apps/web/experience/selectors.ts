import type {
  ClarificationDecision,
  CompletionSummary,
  DecisionBrief,
  ExperienceSourceKind,
  FoundryExperienceModel,
  FoundryProposal,
  Mission,
  MissionNarrative,
  MissionPhase,
  MissionPhaseState,
  PreviewState,
  PreviewStateName,
  ProjectJourney,
  ProjectSummary,
  ProjectUnderstanding,
  Provider,
  ProviderTransparency,
  Sourced,
} from "./contracts";

export type CustomerPhaseView = Readonly<{
  label: string;
  status: string;
  pill: string;
  action: string;
  spineIndex: number;
  fixing: boolean;
}>;

const PHASE_LABELS = [
  "Understanding what you need",
  "Designing the experience",
  "Creating the application structure",
  "Building the main workflows",
  "Connecting data",
  "Preparing it to run",
  "Running the application",
  "Testing important actions",
  "Verifying the result",
] as const;

function sourced<T>(
  value: T,
  kind: ExperienceSourceKind,
  reference: string,
): Sourced<T> {
  return Object.freeze({
    value,
    source: Object.freeze({ kind, reference }),
  });
}

export function customerPhase(mission: Mission): CustomerPhaseView {
  switch (mission.state) {
    case "INTAKE":
      return mission.profile === null
        ? {
            label: "Reading your request",
            status: "Working out what you need",
            pill: "pill-neutral",
            action: "Open",
            spineIndex: 0,
            fixing: false,
          }
        : {
            label: "Waiting on you",
            status: "Waiting for your decisions",
            pill: "pill-attention",
            action:
              mission.profile.openQuestions.length > 0
                ? "Answer"
                : "Review the plan",
            spineIndex: 0,
            fixing: false,
          };
    case "CLARIFYING":
      return {
        label: "Waiting on you",
        status: "Waiting for your decisions",
        pill: "pill-attention",
        action: "Answer",
        spineIndex: 0,
        fixing: false,
      };
    case "CONTRACTED":
      return {
        label: "Plan ready",
        status: "Ready to build",
        pill: "pill-neutral",
        action: "Review the plan",
        spineIndex: 0,
        fixing: false,
      };
    case "PROVISIONING":
      return {
        label: "Building",
        status: "Setting up a clean workspace",
        pill: "pill-building",
        action: "Watch",
        spineIndex: 1,
        fixing: false,
      };
    case "EXECUTING":
      return {
        label: "Building",
        status: "Building your project",
        pill: "pill-building",
        action: "Watch",
        spineIndex: 1,
        fixing: false,
      };
    case "VERIFYING":
      return {
        label: "Testing",
        status: "Checking that it really works",
        pill: "pill-building",
        action: "Watch",
        spineIndex: 7,
        fixing: false,
      };
    case "REPAIRING":
      return {
        label: "Correcting an issue",
        status: "Fixing something that didn't behave",
        pill: "pill-attention",
        action: "Watch",
        spineIndex: 7,
        fixing: true,
      };
    case "SUCCEEDED":
      return {
        label: "Delivered",
        status: "Ready",
        pill: "pill-delivered",
        action: "Continue",
        spineIndex: PHASE_LABELS.length,
        fixing: false,
      };
    case "BLOCKED":
      return {
        label: "Needs you",
        status: "I need something from you",
        pill: "pill-attention",
        action: "Resolve",
        spineIndex: 7,
        fixing: false,
      };
    case "FAILED":
      return {
        label: "Stopped",
        status: "I stopped and couldn't finish this",
        pill: "pill-stopped",
        action: "Reopen",
        spineIndex: 7,
        fixing: false,
      };
    case "EXHAUSTED":
      return {
        label: "Stopped",
        status: "I ran out of safe approaches",
        pill: "pill-stopped",
        action: "Reopen",
        spineIndex: 7,
        fixing: false,
      };
    case "CANCELLED":
      return {
        label: "Cancelled",
        status: "You stopped this",
        pill: "pill-neutral",
        action: "Reopen",
        spineIndex: 0,
        fixing: false,
      };
    default:
      return {
        label: "In progress",
        status: "Working",
        pill: "pill-neutral",
        action: "Open",
        spineIndex: 0,
        fixing: false,
      };
  }
}

function projectSummary(mission: Mission): ProjectSummary {
  const phase = customerPhase(mission);
  return Object.freeze({
    missionId: sourced(
      mission.missionId,
      "mission-ledger",
      "mission.missionId",
    ),
    name: sourced(
      mission.profile?.name ?? mission.intent,
      mission.profile === null ? "mission-ledger" : "project-understanding",
      mission.profile === null ? "mission.intent" : "mission.profile.name",
    ),
    summary: sourced(
      mission.profile?.summary ?? null,
      mission.profile === null ? "mission-ledger" : "project-understanding",
      mission.profile === null ? "unavailable" : "mission.profile.summary",
    ),
    customerPhase: sourced(
      phase.label,
      "mission-ledger",
      `mission.state:${mission.state}`,
    ),
    customerStatus: sourced(
      phase.status,
      "mission-ledger",
      `mission.state:${mission.state}`,
    ),
    actionLabel: sourced(
      phase.action,
      "mission-ledger",
      `mission.state:${mission.state}`,
    ),
    lastActivityAt: sourced(
      mission.updatedAt,
      "mission-ledger",
      "mission.updatedAt",
    ),
  });
}

function journeys(): readonly ProjectJourney[] {
  // ProjectProfile currently records outcomes, not customer journeys. Treating
  // one as the other would create a frontend claim the backend did not make.
  return Object.freeze([]);
}

function proposal(mission: Mission): FoundryProposal {
  const profile = mission.profile;
  if (profile === null) {
    return Object.freeze({
      items: sourced([], "project-understanding", "unavailable"),
      includedDefaults: sourced([], "capability-registry", "unavailable"),
      reasoning: sourced([], "project-understanding", "unavailable"),
      observations: Object.freeze([]),
      alternatives: Object.freeze([]),
      recommendations: Object.freeze([]),
    });
  }
  return Object.freeze({
    items: sourced(
      profile.outcomes,
      "project-understanding",
      "mission.profile.outcomes",
    ),
    includedDefaults: sourced(
      profile.capabilities,
      "capability-registry",
      "mission.profile.capabilities",
    ),
    reasoning: sourced(
      profile.architectureDecisions,
      "project-understanding",
      "mission.profile.architectureDecisions",
    ),
    observations: Object.freeze([]),
    alternatives: Object.freeze([]),
    recommendations: Object.freeze(
      profile.contextualSuggestions.map((recommendation) =>
        Object.freeze({
          id: recommendation.suggestionId,
          title: sourced(
            recommendation.label,
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.label`,
          ),
          value: sourced(
            recommendation.rationale,
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.rationale`,
          ),
          reason: sourced(
            recommendation.rationale,
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.rationale`,
          ),
          selectedByDefault: sourced(
            null,
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.selection not exposed by customer API`,
          ),
          impact: sourced(
            null,
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.impact not exposed by customer API`,
          ),
        }),
      ),
    ),
  });
}

function understanding(mission: Mission): ProjectUnderstanding | null {
  const profile = mission.profile;
  if (profile === null) return null;
  return Object.freeze({
    projectName: sourced(
      profile.name,
      "project-understanding",
      "mission.profile.name",
    ),
    summary: sourced(
      profile.summary,
      "project-understanding",
      "mission.profile.summary",
    ),
    audiences: sourced(
      profile.primaryActors,
      "project-understanding",
      "mission.profile.primaryActors",
    ),
    journeys: journeys(),
    proposal: proposal(mission),
  });
}

function clarification(mission: Mission): readonly ClarificationDecision[] {
  return Object.freeze(
    (mission.profile?.openQuestions ?? []).map((question) =>
      Object.freeze({
        questionId: question.questionId,
        prompt: sourced(
          question.prompt,
          "project-understanding",
          `mission.profile.openQuestions.${question.questionId}.prompt`,
        ),
        reason: sourced(
          question.reason,
          "project-understanding",
          `mission.profile.openQuestions.${question.questionId}.reason`,
        ),
        choices: sourced(
          question.answerOptions,
          "project-understanding",
          `mission.profile.openQuestions.${question.questionId}.answerOptions`,
        ),
        recommendation: sourced(
          question.answerOptions[0],
          "foundry-assumption",
          `mission.profile.openQuestions.${question.questionId}.answerOptions[0]`,
        ),
        answer: null,
      }),
    ),
  );
}

function decisionBrief(mission: Mission): DecisionBrief | null {
  const profile = mission.profile;
  const contract = mission.contract;
  if (profile === null || contract === null) return null;
  return Object.freeze({
    whatWillBeBuilt: sourced(
      profile.outcomes,
      "project-understanding",
      "mission.profile.outcomes",
    ),
    audiences: sourced(
      profile.primaryActors,
      "project-understanding",
      "mission.profile.primaryActors",
    ),
    journeys: journeys(),
    decisions: sourced(
      profile.architectureDecisions,
      "project-understanding",
      "mission.profile.architectureDecisions",
    ),
    assumptions: sourced(
      profile.constraints,
      "foundry-assumption",
      "mission.profile.constraints",
    ),
    selectedEnhancements: Object.freeze([]),
    verificationObligations: sourced(
      contract.obligations.map((obligation) => obligation.statement),
      "requirement-contract",
      "mission.contract.obligations",
    ),
  });
}

function phaseStatus(
  phaseIndex: number,
  currentIndex: number,
  mission: Mission,
): MissionPhaseState {
  if (mission.state === "SUCCEEDED") return "complete";
  if (mission.state === "REPAIRING" && phaseIndex === currentIndex) {
    return "interrupted";
  }
  if (phaseIndex < currentIndex) return "complete";
  if (phaseIndex === currentIndex) return "current";
  if (mission.state === "EXECUTING" && phaseIndex > 1 && phaseIndex < 7) {
    return "unavailable";
  }
  return "pending";
}

function phases(mission: Mission): readonly MissionPhase[] {
  const currentIndex = customerPhase(mission).spineIndex;
  return Object.freeze(
    PHASE_LABELS.map((label, index) =>
      Object.freeze({
        id: `phase-${index + 1}`,
        label: sourced(label, "mission-ledger", `experience.phase.${index + 1}`),
        status: sourced(
          phaseStatus(index, currentIndex, mission),
          "mission-ledger",
          `mission.state:${mission.state}`,
        ),
        detail: sourced(
          null,
          "mission-ledger",
          mission.state === "EXECUTING"
            ? "typed execution phase metadata is unavailable"
            : "no phase detail recorded",
        ),
      }),
    ),
  );
}

function narrative(mission: Mission): MissionNarrative {
  const phase = customerPhase(mission);
  return Object.freeze({
    headline: sourced(
      phase.status,
      "mission-ledger",
      `mission.state:${mission.state}`,
    ),
    detail: sourced(
      mission.currentActivity?.detail ?? phase.status,
      "mission-ledger",
      mission.currentActivity === null
        ? `mission.state:${mission.state}`
        : `mission.activities.${mission.currentActivity.sequence}.detail`,
    ),
  });
}

function preview(mission: Mission): PreviewState {
  const state: PreviewStateName =
    mission.previewUrl !== null
      ? "live"
      : mission.running
        ? "starting"
        : mission.state === "CANCELLED"
          ? "stopped"
          : "absent";
  return Object.freeze({
    state: sourced(state, "runtime-evidence", "mission.previewUrl"),
    readinessUrl: sourced(
      mission.previewUrl,
      "runtime-evidence",
      "mission.previewUrl",
    ),
  });
}

function completion(): CompletionSummary {
  // The current customer API does not expose the Completion Verdict. A
  // SUCCEEDED lifecycle state alone is not enough to reconstruct its claims.
  return Object.freeze({
    available: sourced(
      false,
      "completion-verdict",
      "not exposed by customer API",
    ),
    deliveredArtifact: sourced(
      null,
      "completion-verdict",
      "not exposed by customer API",
    ),
    verifiedOutcomes: Object.freeze([]),
    unverifiedObligations: sourced(
      [],
      "completion-verdict",
      "not exposed by customer API",
    ),
    limitations: Object.freeze([]),
    nextSteps: Object.freeze([]),
  });
}

function providerTransparency(
  providers: readonly Provider[],
): readonly ProviderTransparency[] {
  return Object.freeze(
    providers.map((provider) =>
      Object.freeze({
        providerId: sourced(
          provider.providerId,
          "capability-registry",
          `providers.${provider.providerId}.providerId`,
        ),
        displayName: sourced(
          provider.displayName,
          "capability-registry",
          `providers.${provider.providerId}.displayName`,
        ),
        available: sourced(
          provider.available,
          "capability-registry",
          `providers.${provider.providerId}.availability`,
        ),
        health: sourced(
          provider.health,
          "capability-registry",
          `providers.${provider.providerId}.health`,
        ),
        reason: sourced(
          provider.reason,
          "capability-registry",
          `providers.${provider.providerId}.reason`,
        ),
        models: Object.freeze(
          provider.models.map((model) =>
            Object.freeze({
              modelId: sourced(
                model.modelId,
                "capability-registry",
                `providers.${provider.providerId}.models.${model.modelId}`,
              ),
              displayName: sourced(
                model.displayName,
                "capability-registry",
                `providers.${provider.providerId}.models.${model.modelId}`,
              ),
              status: sourced(
                model.status,
                "capability-registry",
                `providers.${provider.providerId}.models.${model.modelId}.status`,
              ),
            }),
          ),
        ),
      }),
    ),
  );
}

function surface(mission: Mission): FoundryExperienceModel["surface"] {
  if (mission.profile === null) return "reading";
  if (mission.profile.platform !== "web") return "unsupported";
  if (mission.state === "SUCCEEDED") return "completion";
  if (
    ["FAILED", "BLOCKED", "EXHAUSTED", "CANCELLED"].includes(mission.state)
  ) {
    return "stopped";
  }
  if (mission.state === "INTAKE" || mission.state === "CLARIFYING") {
    return mission.profile.openQuestions.length > 0
      ? "understanding"
      : "plan";
  }
  if (mission.state === "CONTRACTED") return "plan";
  return "building";
}

export function selectFoundryExperience(
  mission: Mission,
  providers: readonly Provider[] = [],
): FoundryExperienceModel {
  return Object.freeze({
    project: projectSummary(mission),
    understanding: understanding(mission),
    clarification: clarification(mission),
    decisionBrief: decisionBrief(mission),
    phases: phases(mission),
    narrative: narrative(mission),
    repair:
      mission.state === "REPAIRING"
        ? Object.freeze({
            affectedArea: sourced(
              null,
              "runtime-evidence",
              "no evidence-backed affected area exposed",
            ),
            observedProblem: sourced(
              mission.error,
              "runtime-evidence",
              "mission.error",
            ),
            correction: sourced(
              null,
              "mission-ledger",
              "no correction detail exposed",
            ),
            checksToRerun: sourced(
              [],
              "requirement-contract",
              "no repair-check binding exposed",
            ),
            customerActionRequired: sourced(
              false,
              "mission-ledger",
              "mission.state:REPAIRING",
            ),
          })
        : null,
    preview: preview(mission),
    approval: Object.freeze({
      available: sourced(
        false,
        "mission-ledger",
        "approval capability is not implemented",
      ),
      requestId: sourced(
        null,
        "mission-ledger",
        "approval capability is not implemented",
      ),
      description: sourced(
        null,
        "mission-ledger",
        "approval capability is not implemented",
      ),
    }),
    blocker:
      mission.state === "BLOCKED"
        ? Object.freeze({
            active: sourced(true, "mission-ledger", "mission.state:BLOCKED"),
            description: sourced(
              mission.error,
              "mission-ledger",
              "mission.error",
            ),
            customerAction: sourced(
              null,
              "mission-ledger",
              "no typed customer action exposed",
            ),
          })
        : null,
    completion: completion(),
    providers: providerTransparency(providers),
    surface: surface(mission),
  });
}
