import type {
  ClarificationDecision,
  CompletionSummary,
  DecisionBrief,
  ExperienceSourceKind,
  FoundryExperienceModel,
  FoundryProposal,
  LifecycleOutcome,
  Mission,
  MissionNarrative,
  MissionPhase,
  MissionPhaseState,
  PreviewState,
  PreviewStateName,
  ProjectProfile,
  ProjectJourney,
  ProjectSummary,
  ProjectUnderstanding,
  Provider,
  ProviderTransparency,
  Sourced,
  UnsupportedSummary,
} from "./contracts";
import { buildElapsedLabel } from "./timing";

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

const CAPABILITY_COPY: Readonly<Record<string, string | null>> = Object.freeze({
  "web-application": null,
  typescript: null,
  "sqlite-persistence": "Its own database",
  "create-records": "People can add records",
  "update-records": "People can change records",
  "refresh-persistence": "Data survives a refresh",
  "production-build": "Built the way it would really ship",
  "development-runtime": "Runs on your machine",
  "browser-verification": "Tested in a real browser",
  "automated-tests": "Automated tests included",
  "package-export": "Portable project folder you own",
});

export function customerCapability(identifier: string): string | null {
  if (identifier in CAPABILITY_COPY) return CAPABILITY_COPY[identifier];
  if (typeof console !== "undefined") {
    console.warn(
      `[foundry] Capability "${identifier}" has no customer wording yet.`,
    );
  }
  const spaced = identifier.replaceAll("-", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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

/**
 * Compresses a recommendation into a short, scannable action label. A chip is
 * a thing the customer can ask for, not a paragraph explaining a default.
 */
function suggestionLabel(value: string) {
  const firstClause = value
    .split(/[.;:]/u)[0]
    .replace(/^(?:foundry|we|the app|the site)\s+(?:will|should|can|may)\s+/iu, "")
    .replace(/^(?:add|include|provide|give|let|allow|show|make)\s+/iu, (match) =>
      match.toLowerCase(),
    )
    .trim();
  const words = firstClause.split(/\s+/u);
  const trimmed = words.length > 7 ? `${words.slice(0, 7).join(" ")}…` : firstClause;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
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
    case "EXECUTING": {
      const currentPhaseIndex =
        mission.executionProjection.phase.currentIndex;
      const currentActivity = mission.currentActivity;
      const correcting = currentActivity?.kind === "repair";
      if (correcting) {
        return {
          label: "Correcting an issue",
          status: currentActivity?.title ?? "Correcting the affected part",
          pill: "pill-attention",
          action: "Watch",
          spineIndex: currentPhaseIndex,
          fixing: true,
        };
      }
      if (currentPhaseIndex >= 7) {
        return {
          label: "Testing",
          status: "Testing important actions",
          pill: "pill-building",
          action: "Watch",
          spineIndex: currentPhaseIndex,
          fixing: false,
        };
      }
      return {
        label: "Building",
        status: "Building your project",
        pill: "pill-building",
        action: "Watch",
        spineIndex: currentPhaseIndex,
        fixing: false,
      };
    }
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
        status: "I stopped at the safe repair limit",
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

export function selectProjectSummary(mission: Mission): ProjectSummary {
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

function journeys(profile: ProjectProfile): readonly ProjectJourney[] {
  return Object.freeze(
    profile.primaryJourneys.map((outcome, index) =>
      Object.freeze({
        id: `journey-${index + 1}`,
        description: sourced(
          outcome,
          "project-understanding",
          `mission.profile.primaryJourneys[${index}]`,
        ),
      }),
    ),
  );
}

function conversationalSummary(value: string): string {
  const sentences = value
    .match(/[^.!?]+[.!?]?/gu)
    ?.map((sentence) => sentence.trim())
    .filter(Boolean) ?? [value.trim()];
  const direct = sentences.filter(
    (sentence) =>
      !/\b(?:I am confident|the only major open decision)\b/iu.test(sentence),
  );
  return (direct.length > 0 ? direct : sentences).slice(0, 2).join(" ");
}

function proposal(mission: Mission): FoundryProposal {
  const profile = mission.profile;
  if (profile === null) {
    return Object.freeze({
      items: sourced([], "project-understanding", "unavailable"),
      includedDefaults: sourced([], "capability-registry", "unavailable"),
      designDirection: Object.freeze({
        recommendedStyle: sourced(
          "",
          "project-understanding",
          "unavailable",
        ),
        reason: sourced("", "project-understanding", "unavailable"),
        layoutApproach: sourced(
          "",
          "project-understanding",
          "unavailable",
        ),
        tone: sourced("", "project-understanding", "unavailable"),
        mobilePriority: sourced(
          "",
          "project-understanding",
          "unavailable",
        ),
        accessibilityConsiderations: sourced(
          [],
          "project-understanding",
          "unavailable",
        ),
      }),
      reasoning: sourced([], "project-understanding", "unavailable"),
      exclusions: sourced([], "project-understanding", "unavailable"),
      observations: Object.freeze([]),
      alternatives: Object.freeze([]),
      recommendations: Object.freeze([]),
      smartSuggestions: Object.freeze([]),
    });
  }
  return Object.freeze({
    items: sourced(
      profile.outcomes,
      "project-understanding",
      "mission.profile.outcomes",
    ),
    includedDefaults: sourced(
      profile.includedDefaults.length > 0
        ? profile.includedDefaults
        : profile.capabilities
            .map(customerCapability)
            .filter((label): label is string => label !== null),
      profile.includedDefaults.length > 0
        ? "project-understanding"
        : "capability-registry",
      profile.includedDefaults.length > 0
        ? "mission.profile.includedDefaults"
        : "mission.profile.capabilities",
    ),
    designDirection: Object.freeze({
      recommendedStyle: sourced(
        profile.designDirection.recommendedStyle,
        "project-understanding",
        "mission.profile.designDirection.recommendedStyle",
      ),
      reason: sourced(
        profile.designDirection.reason,
        "project-understanding",
        "mission.profile.designDirection.reason",
      ),
      layoutApproach: sourced(
        profile.designDirection.layoutApproach,
        "project-understanding",
        "mission.profile.designDirection.layoutApproach",
      ),
      tone: sourced(
        profile.designDirection.tone,
        "project-understanding",
        "mission.profile.designDirection.tone",
      ),
      mobilePriority: sourced(
        profile.designDirection.mobilePriority,
        "project-understanding",
        "mission.profile.designDirection.mobilePriority",
      ),
      accessibilityConsiderations: sourced(
        profile.designDirection.accessibilityConsiderations,
        "project-understanding",
        "mission.profile.designDirection.accessibilityConsiderations",
      ),
    }),
    reasoning: sourced(
      profile.architectureDecisions,
      "project-understanding",
      "mission.profile.architectureDecisions",
    ),
    exclusions: sourced(
      profile.constraints.filter(
        (constraint) => !profile.architectureDecisions.includes(constraint),
      ),
      "project-understanding",
      "mission.profile.constraints excluding mission.profile.architectureDecisions",
    ),
    observations: Object.freeze(
      profile.observations.map((observation, index) =>
        Object.freeze({
          id: `observation-${index + 1}`,
          observation: sourced(
            observation,
            "project-understanding",
            `mission.profile.observations[${index}]`,
          ),
          whyItMatters: sourced(
            null,
            "project-understanding",
            `mission.profile.observations[${index}].whyItMatters not exposed by customer API`,
          ),
          confidence: sourced(
            null,
            "project-understanding",
            `mission.profile.observations[${index}].confidence not exposed by customer API`,
          ),
        }),
      ),
    ),
    alternatives: Object.freeze(
      profile.designAlternatives.map((alternative, index) =>
        Object.freeze({
          id: `alternative-${index + 1}`,
          name: sourced(
            alternative.approach,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].approach`,
          ),
          description: sourced(
            alternative.rationale,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].rationale`,
          ),
          whyItFits: sourced(
            alternative.whyItFits ?? alternative.rationale,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].whyItFits`,
          ),
          layoutApproach: sourced(
            alternative.layoutApproach ?? profile.designDirection.layoutApproach,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].layoutApproach`,
          ),
          visualPersonality: sourced(
            alternative.visualPersonality ?? alternative.approach,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].visualPersonality`,
          ),
          informationDensity: sourced(
            alternative.informationDensity ?? alternative.rationale,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].informationDensity`,
          ),
          navigationApproach: sourced(
            alternative.navigationApproach ?? alternative.rationale,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].navigationApproach`,
          ),
          mobileBehavior: sourced(
            alternative.mobileBehavior ?? profile.designDirection.mobilePriority,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].mobileBehavior`,
          ),
          tradeoff: sourced(
            alternative.tradeoff ?? alternative.tradeoffs?.[0] ?? alternative.rationale,
            "project-understanding",
            `mission.profile.designAlternatives[${index}].tradeoff`,
          ),
          confidence: sourced(
            alternative.confidence?.score ?? 0.5,
            "model-recommendation",
            `mission.profile.designAlternatives[${index}].confidence.score`,
          ),
          preview: Object.freeze({
            typographyCharacter: sourced(
              alternative.preview?.typographyCharacter ?? alternative.approach,
              "project-understanding",
              `mission.profile.designAlternatives[${index}].preview.typographyCharacter`,
            ),
            spacingDensity: sourced(
              alternative.preview?.spacingDensity ?? alternative.informationDensity ?? alternative.rationale,
              "project-understanding",
              `mission.profile.designAlternatives[${index}].preview.spacingDensity`,
            ),
            colorMood: sourced(
              alternative.preview?.colorMood ?? profile.designDirection.tone,
              "project-understanding",
              `mission.profile.designAlternatives[${index}].preview.colorMood`,
            ),
            hierarchy: sourced(
              alternative.preview?.hierarchy ?? alternative.layoutApproach ?? alternative.rationale,
              "project-understanding",
              `mission.profile.designAlternatives[${index}].preview.hierarchy`,
            ),
          }),
          visualSystem: alternative.visualSystem,
          creativeDNA: alternative.creativeDNA,
          recommended: sourced(
            alternative.recommended,
            "model-recommendation",
            `mission.profile.designAlternatives[${index}].recommended`,
          ),
        }),
      ),
    ),
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
            recommendation.value ?? recommendation.rationale,
            "model-recommendation",
            recommendation.value === undefined
              ? `mission.profile.contextualSuggestions.${recommendation.suggestionId}.rationale`
              : `mission.profile.contextualSuggestions.${recommendation.suggestionId}.value`,
          ),
          reason: sourced(
            recommendation.rationale,
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.rationale`,
          ),
          selectedByDefault: sourced(
            recommendation.selectedByDefault ?? null,
            "model-recommendation",
            recommendation.selectedByDefault === undefined
              ? `mission.profile.contextualSuggestions.${recommendation.suggestionId}.selection not exposed by this profile revision`
              : `mission.profile.contextualSuggestions.${recommendation.suggestionId}.selectedByDefault`,
          ),
          impact: sourced(
            recommendation.impact ?? null,
            "model-recommendation",
            recommendation.impact === undefined
              ? `mission.profile.contextualSuggestions.${recommendation.suggestionId}.impact not exposed by this profile revision`
              : `mission.profile.contextualSuggestions.${recommendation.suggestionId}.impact`,
          ),
          confidence: sourced(
            recommendation.confidence ?? null,
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.confidence`,
          ),
          dependencies: sourced(
            recommendation.requiredDependencies ?? [],
            "model-recommendation",
            `mission.profile.contextualSuggestions.${recommendation.suggestionId}.requiredDependencies`,
          ),
        }),
      ),
    ),
    // Suggestions are customer ACTIONS only.
    //
    // Previously this mixed three contextualSuggestions — already shown in
    // full as Foundry recommendations, so the chip was a duplicate — with two
    // raw assumptions like "owner will showcase work", which are Foundry's
    // own defaults and not something a customer can usefully "add". Labels
    // were the long `value` sentence, which is why the chips were enormous.
    //
    // Now: a recommendation only appears as a chip if the customer has NOT
    // already accepted it, assumptions are excluded entirely, and every label
    // is compressed to a short imperative.
    smartSuggestions: Object.freeze(
      profile.contextualSuggestions
        .filter((item) => item.selectedByDefault !== true)
        .map((item) =>
          Object.freeze({
            id: `smart-${item.suggestionId}`,
            label: sourced(
              suggestionLabel(item.label ?? item.value ?? ""),
              "model-recommendation",
              `mission.profile.contextualSuggestions.${item.suggestionId}.label`,
            ),
            reason: sourced(
              item.rationale,
              "model-recommendation",
              `mission.profile.contextualSuggestions.${item.suggestionId}.rationale`,
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
      conversationalSummary(profile.summary),
      "project-understanding",
      "mission.profile.summary (conversational excerpt)",
    ),
    audiences: sourced(
      profile.primaryActors,
      "project-understanding",
      "mission.profile.primaryActors",
    ),
    isRevised: sourced(
      profile.profileVersion > 1,
      "project-understanding",
      "mission.profile.profileVersion",
    ),
    journeys: journeys(profile),
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
          question.recommendation ?? question.answerOptions[0],
          "foundry-assumption",
          `mission.profile.openQuestions.${question.questionId}.recommendation`,
        ),
        recommendationReason: sourced(
          question.recommendationReason ?? question.reason,
          "model-recommendation",
          `mission.profile.openQuestions.${question.questionId}.recommendationReason`,
        ),
        consequences: sourced(
          question.consequences ?? question.answerOptions.map(() => question.reason),
          "project-understanding",
          `mission.profile.openQuestions.${question.questionId}.consequences`,
        ),
        architectureImpact: sourced(
          question.architectureImpact ?? question.reason,
          "project-understanding",
          `mission.profile.openQuestions.${question.questionId}.architectureImpact`,
        ),
        scopeImpact: sourced(
          question.scopeImpact ?? question.reason,
          "project-understanding",
          `mission.profile.openQuestions.${question.questionId}.scopeImpact`,
        ),
        answer: null,
      }),
    ),
  );
}

function delegatedDecisionAnswer(answer: string): string | null {
  const delegated = /^Foundry decides\. Recommended: (.+?)\.* Use your professional judgement\.$/u.exec(
    answer,
  );
  return delegated?.[1].replace(/\.+$/u, "") ?? null;
}

function customerDecisionAnswer(answer: string): string {
  const delegated = delegatedDecisionAnswer(answer);
  if (delegated !== null) return `Left to Foundry \u2014 ${delegated}.`;
  if (
    answer.startsWith(
      "Skipped by the customer. Use your professional judgement.",
    )
  ) {
    const note = answer.match(/Keep in mind:\s*(.+)$/u)?.[1];
    return note ? `Left to Foundry — keep in mind: ${note}` : "Left to Foundry.";
  }
  return answer;
}

function decisionBrief(mission: Mission): DecisionBrief | null {
  const profile = mission.profile;
  if (profile === null) return null;
  const hasPersistence = profile.capabilities.some((capability) =>
    [
      "sqlite-persistence",
      "create-records",
      "update-records",
      "refresh-persistence",
    ].includes(capability),
  );
  const projectShape =
    profile.family.toLocaleLowerCase().includes("website") && !hasPersistence
      ? "website"
      : "web application";
  const structure = hasPersistence
    ? `A ${projectShape} with its own database, built the way it would really ship, running on your machine.`
    : `A ${projectShape} built the way it would really ship, running on your machine.`;
  const stack = mission.technicalStack;
  const registryReference = `technicalStack.${stack.stackId}@${stack.stackVersion}`;
  return Object.freeze({
    projectName: sourced(
      profile.name,
      "project-understanding",
      "mission.profile.name",
    ),
    whatWillBeBuilt: sourced(
      profile.summary,
      "project-understanding",
      "mission.profile.summary",
    ),
    audiences: sourced(
      profile.primaryActors,
      "project-understanding",
      "mission.profile.primaryActors",
    ),
    journeys: journeys(profile),
    designDirection: Object.freeze({
      recommendedStyle: sourced(
        profile.designDirection.recommendedStyle,
        "project-understanding",
        "mission.profile.designDirection.recommendedStyle",
      ),
      reason: sourced(
        profile.designDirection.reason,
        "project-understanding",
        "mission.profile.designDirection.reason",
      ),
      layoutApproach: sourced(
        profile.designDirection.layoutApproach,
        "project-understanding",
        "mission.profile.designDirection.layoutApproach",
      ),
      tone: sourced(
        profile.designDirection.tone,
        "project-understanding",
        "mission.profile.designDirection.tone",
      ),
      mobilePriority: sourced(
        profile.designDirection.mobilePriority,
        "project-understanding",
        "mission.profile.designDirection.mobilePriority",
      ),
      accessibilityConsiderations: sourced(
        profile.designDirection.accessibilityConsiderations,
        "project-understanding",
        "mission.profile.designDirection.accessibilityConsiderations",
      ),
    }),
    structure: sourced(
      structure,
      "capability-registry",
      "mission.profile.family+mission.profile.capabilities",
    ),
    technicalShape: Object.freeze({
      stackId: sourced(
        stack.stackId,
        "capability-registry",
        `${registryReference}.stackId`,
      ),
      stackVersion: sourced(
        stack.stackVersion,
        "capability-registry",
        `${registryReference}.stackVersion`,
      ),
      framework: sourced(
        stack.components.framework,
        "capability-registry",
        `${registryReference}.components.framework`,
      ),
      frameworkVersion: sourced(
        stack.frameworkVersion,
        "capability-registry",
        `${registryReference}.frameworkVersion`,
      ),
      language: sourced(
        stack.components.language,
        "capability-registry",
        `${registryReference}.components.language`,
      ),
      database: sourced(
        stack.components.database,
        "capability-registry",
        `${registryReference}.components.database`,
      ),
      packageManager: sourced(
        stack.components.packageManager,
        "capability-registry",
        `${registryReference}.components.packageManager`,
      ),
      browserTesting: sourced(
        stack.components.browserTesting,
        "capability-registry",
        `${registryReference}.components.browserTesting`,
      ),
      knownLimitations: sourced(
        stack.knownLimitations,
        "capability-registry",
        `${registryReference}.knownLimitations`,
      ),
    }),
    decisions: Object.freeze(
      mission.decisionHistory.map((decision) =>
        Object.freeze({
          questionId: decision.questionId,
          prompt: sourced(
            decision.prompt,
            "project-understanding",
            `mission.decisionHistory.${decision.questionId}.prompt`,
          ),
          reason: sourced(
            decision.reason,
            "project-understanding",
            `mission.decisionHistory.${decision.questionId}.reason`,
          ),
          choices: sourced(
            decision.choices,
            "project-understanding",
            `mission.decisionHistory.${decision.questionId}.choices`,
          ),
          recommendation: sourced(
            decision.recommendation,
            "model-recommendation",
            `mission.decisionHistory.${decision.questionId}.recommendation`,
          ),
          recommendationReason: sourced(
            decision.reason,
            "model-recommendation",
            `mission.decisionHistory.${decision.questionId}.reason`,
          ),
          consequences: sourced(
            decision.choices.map(() => decision.reason),
            "project-understanding",
            `mission.decisionHistory.${decision.questionId}.consequences`,
          ),
          architectureImpact: sourced(
            decision.reason,
            "project-understanding",
            `mission.decisionHistory.${decision.questionId}.architectureImpact`,
          ),
          scopeImpact: sourced(
            decision.reason,
            "project-understanding",
            `mission.decisionHistory.${decision.questionId}.scopeImpact`,
          ),
          answer: sourced(
            customerDecisionAnswer(decision.answer),
            "customer-answer",
            `mission.decisionHistory.${decision.questionId}.answer`,
          ),
        }),
      ),
    ),
    foundryChoices: sourced(
      profile.architectureDecisions,
      "project-understanding",
      "mission.profile.architectureDecisions",
    ),
    assumptions: sourced(
      profile.assumptions.map((assumption) =>
        assumption.replaceAll(stack.stackId, "the certified web stack"),
      ),
      "project-understanding",
      "mission.profile.assumptions",
    ),
    explicitExclusions: sourced(
      profile.constraints.filter(
        (constraint) => !profile.architectureDecisions.includes(constraint),
      ),
      "project-understanding",
      "mission.profile.constraints excluding mission.profile.architectureDecisions",
    ),
    selectedEnhancements: Object.freeze(
      mission.selectedEnhancements.map((enhancement) =>
        Object.freeze({
          id: enhancement.suggestionId,
          title: sourced(
            enhancement.label,
            "model-recommendation",
            `mission.selectedEnhancements.${enhancement.suggestionId}.label`,
          ),
          value: sourced(
            enhancement.rationale,
            "model-recommendation",
            `mission.selectedEnhancements.${enhancement.suggestionId}.rationale`,
          ),
          reason: sourced(
            enhancement.rationale,
            "model-recommendation",
            `mission.selectedEnhancements.${enhancement.suggestionId}.rationale`,
          ),
          selectedByDefault: sourced(
            false,
            "customer-answer",
            `mission.selectedEnhancements.${enhancement.suggestionId}`,
          ),
          impact: sourced(
            null,
            "model-recommendation",
            `mission.selectedEnhancements.${enhancement.suggestionId}.impact not exposed by customer API`,
          ),
          confidence: sourced(
            null,
            "model-recommendation",
            `mission.selectedEnhancements.${enhancement.suggestionId}.confidence`,
          ),
          dependencies: sourced(
            [],
            "model-recommendation",
            `mission.selectedEnhancements.${enhancement.suggestionId}.dependencies`,
          ),
        }),
      ),
    ),
    verificationObligations: sourced(
      profile.verificationPlan.checks.map((check) => check.label),
      "project-understanding",
      "mission.profile.verificationPlan.checks[].label",
    ),
  });
}

function phaseStatus(
  phaseIndex: number,
  mission: Mission,
): MissionPhaseState {
  const progress = mission.executionProjection.phase;
  if (mission.state === "SUCCEEDED") return "complete";
  if (progress.interrupted && phaseIndex === progress.currentIndex) {
    return "interrupted";
  }
  if (phaseIndex <= progress.completedThrough) return "complete";
  if (phaseIndex === progress.currentIndex) return "current";
  return "pending";
}

function phases(mission: Mission): readonly MissionPhase[] {
  return Object.freeze(
    PHASE_LABELS.map((label, index) =>
      Object.freeze({
        id: `phase-${index + 1}`,
        label: sourced(label, "mission-ledger", `experience.phase.${index + 1}`),
        status: sourced(
          phaseStatus(index, mission),
          "mission-ledger",
          `mission.executionProjection.phase:${index}`,
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

function customerSentence(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const plain = `${value.charAt(0).toLocaleLowerCase()}${value.slice(1)}`
    .replace(/[A-Za-z0-9_./\\-]+\.(?:ts|tsx|js|jsx)\b/giu, "")
    .replace(/[\\/]/gu, " ")
    .replace(/\bnpm\b/giu, "project tools")
    .replace(/\s+/gu, " ")
    .replace(/[.!?]+$/u, "")
    .trim();
  return plain || fallback;
}

function phaseWhy(mission: Mission, phaseIndex: number): string {
  const profile = mission.profile;
  switch (phaseIndex) {
    case 0:
      return "Making sure the plan reflects what you asked for.";
    case 1:
      return "Working out the pages and how people move between them.";
    case 2:
      return "Setting up the project so everything has a place.";
    case 3:
      return `So ${customerSentence(
        profile?.outcomes[0],
        "the main things people need to do actually work",
      )}.`;
    case 4:
      return `So ${customerSentence(
        profile?.dataConcepts[0],
        "your data",
      )} is saved and still there after a refresh.`;
    case 5:
      return "Installing what it needs and building it the way it would really ship.";
    case 6:
      return "Starting it for real and waiting until it actually answers.";
    case 7:
      return "Doing the things a real person would do, in a real browser.";
    case 8:
      return "Checking every promise I made in the plan.";
    default:
      return "Building your product.";
  }
}

function narrative(mission: Mission): MissionNarrative {
  const phaseIndex = mission.executionProjection.phase.currentIndex;
  const label = PHASE_LABELS[phaseIndex] ?? "Building your product";
  return Object.freeze({
    headline: sourced(
      label,
      "mission-ledger",
      `mission.executionProjection.phase.currentIndex:${phaseIndex}`,
    ),
    detail: sourced(
      phaseWhy(mission, phaseIndex),
      "project-understanding",
      `mission.profile+execution.phase:${phaseIndex}`,
    ),
  });
}

function preview(mission: Mission): PreviewState {
  const runtime = mission.executionProjection.runtime;
  let state: PreviewStateName = "absent";
  if (runtime?.status === "STARTUP_FAILED") state = "error";
  else if (runtime?.status === "CRASHED") state = "crashed";
  else if (runtime?.status === "STOPPED") state = "stopped";
  else if (mission.state === "REPAIRING" && runtime !== null) {
    state = "rebuilding";
  } else if (runtime?.status === "READY") state = "starting";
  else if (runtime?.status === "HEALTHY" && mission.previewUrl === null) {
    state = "disconnected";
  } else if (runtime?.status === "HEALTHY") state = "live";
  return Object.freeze({
    state: sourced(
      state,
      "runtime-evidence",
      "mission.executionProjection.runtime.status+mission.previewUrl",
    ),
    readinessUrl: sourced(
      runtime?.previewUrl ?? null,
      "runtime-evidence",
      "mission.executionProjection.runtime.previewUrl",
    ),
  });
}

export function customerRepairCopy(
  state: NonNullable<
    Mission["executionProjection"]["repair"]
  >["state"],
  affectedPromises = 0,
): string {
  switch (state) {
    case "different-strategy":
      return "That correction didn't hold. I'm trying a different approach.";
    case "budget-warning":
      return "I've tried three approaches to this. Two attempts remain before I stop and tell you what I know.";
    case "customer-action-required":
      return "I need a decision before I can carry on.";
    case "external-service":
      return "Something outside your project isn't responding. This isn't a problem with your build.";
    case "verification-incomplete":
      return `I fixed the failure, but I couldn't re-prove ${Math.max(
        1,
        affectedPromises,
      )} promises. I won't call those done.`;
    case "honest-exhaustion":
      return "I stopped. I couldn't make this work, and I won't tell you it's done.";
    default:
      return "A workflow didn't behave as expected. I found the likely cause. I'm correcting the affected part.";
  }
}

function customerRepairArea(classification: string | null): string | null {
  if (classification === null) return null;
  if (classification.includes("BROWSER")) return "an important browser workflow";
  if (classification.includes("PERSISTENCE")) return "saving and reloading data";
  if (classification.includes("STARTUP") || classification.includes("PORT")) {
    return "starting the application";
  }
  if (classification.includes("COMPILE") || classification.includes("LINT")) {
    return "preparing the application to run";
  }
  if (classification.includes("PROVIDER")) return "the build model";
  return "the interrupted part of the build";
}

function hasExplicitDeferredCustomerContent(mission: Mission): boolean {
  const customerText = [
    mission.intent,
    ...mission.discoveryConversation.messages.map((message) => message.text),
  ].join(" ");
  return /\b(?:will provide|will send|provide later|send later|pending|tbd|to be provided|not yet supplied|still need to (?:provide|send)|placeholder (?:content|copy|image|logo))\b/iu.test(
    customerText,
  );
}

function completion(mission: Mission): CompletionSummary {
  const profile = mission.profile;
  const verification = mission.executionProjection.verification;
  const verified = verification.filter(
    (outcome) => outcome.result === "SATISFIED",
  );
  const unverified = verification.filter(
    (outcome) => outcome.result !== "SATISFIED",
  );
  const verdictAvailable =
    verification.length > 0 &&
    verification.some((outcome) => outcome.result !== "PENDING");
  const complete =
    mission.state === "SUCCEEDED" &&
    verdictAvailable &&
    unverified.length === 0;
  const customerVerificationDetail = (
    result: Mission["executionProjection"]["verification"][number]["result"],
  ): string => {
    if (result === "UNVERIFIABLE") {
      return "The required evidence was not available.";
    }
    if (result === "NOT_SATISFIED") {
      return "The recorded evidence did not support this promise.";
    }
    return "This promise was not checked before work stopped.";
  };
  const selectedEnhancementIds = new Set(
    mission.selectedEnhancements.map((enhancement) => enhancement.suggestionId),
  );
  const limitationValues: Array<{
    id: string;
    description: string;
    kind: ExperienceSourceKind;
    reference: string;
  }> = [
    ...(profile?.constraints ?? [])
      .filter(
        (description) =>
          !(profile?.architectureDecisions ?? []).includes(description),
      )
      .map((description, index) => ({
        id: `constraint-${index}`,
        description,
        kind: "project-understanding" as const,
        reference: `mission.profile.constraints[${index}]`,
      })),
    ...mission.technicalStack.knownLimitations
      .filter(
        (description) =>
          !/\b(?:foundry|milestone\s+\d+|certification requires)\b/iu.test(
            description,
          ),
      )
      .map((description, index) => ({
        id: `stack-${index}`,
        description,
        kind: "capability-registry" as const,
        reference: `mission.technicalStack.knownLimitations[${index}]`,
      })),
  ].filter(
    (item, index, items) =>
      items.findIndex(
        (candidate) => candidate.description === item.description,
      ) === index,
  );
  if (limitationValues.length === 0) {
    limitationValues.push({
      id: "agreed-scope",
      description:
        "Only the agreed plan is included in this version; anything outside it remains out of scope.",
      kind: "requirement-contract",
      reference: "mission.contract.scope",
    });
  }

  return Object.freeze({
    available: sourced(
      verdictAvailable,
      "completion-verdict",
      "mission.executionProjection.verification",
    ),
    complete: sourced(
      complete,
      "completion-verdict",
      "mission.executionProjection.verification",
    ),
    projectName: sourced(
      profile?.name ?? null,
      "project-understanding",
      "mission.profile.name",
    ),
    deliveredArtifact: sourced(
      profile?.summary ?? null,
      "project-understanding",
      "mission.profile.summary",
    ),
    buildDuration: sourced(
      buildElapsedLabel(mission),
      "mission-ledger",
      "mission.executionProjection.timing",
    ),
    browserEvidencePresent: sourced(
      verified.some((outcome) =>
        outcome.evidenceReferences.some((reference) =>
          reference.evidenceId.includes("browser"),
        ),
      ),
      "browser-evidence",
      "mission.executionProjection.verification.evidenceReferences",
    ),
    provedCount: sourced(
      verified.length,
      "completion-verdict",
      "mission.executionProjection.verification[result=SATISFIED]",
    ),
    totalCount: sourced(
      verification.length,
      "requirement-contract",
      "mission.executionProjection.verification.length",
    ),
    verifiedOutcomes: Object.freeze(
      verified.map((outcome) =>
        Object.freeze({
          obligationId: outcome.obligationId,
          statement: sourced(
            outcome.statement,
            "requirement-contract",
            `mission.executionProjection.verification.${outcome.obligationId}.statement`,
          ),
          evidenceReferences: sourced(
            outcome.evidenceReferences.map(
              (reference) => reference.evidenceId,
            ),
            "completion-verdict",
            `mission.executionProjection.verification.${outcome.obligationId}.evidenceReferences`,
          ),
        }),
      ),
    ),
    unverifiedOutcomes: Object.freeze(
      unverified.map((outcome) =>
        Object.freeze({
          obligationId: outcome.obligationId,
          statement: sourced(
            outcome.statement,
            "requirement-contract",
            `mission.executionProjection.verification.${outcome.obligationId}.statement`,
          ),
          result: sourced(
            outcome.result as "PENDING" | "NOT_SATISFIED" | "UNVERIFIABLE",
            "completion-verdict",
            `mission.executionProjection.verification.${outcome.obligationId}.result`,
          ),
          detail: sourced(
            customerVerificationDetail(outcome.result),
            "completion-verdict",
            `mission.executionProjection.verification.${outcome.obligationId}.result`,
          ),
        }),
      ),
    ),
    launchRequirements: Object.freeze(
      (hasExplicitDeferredCustomerContent(mission)
        ? (profile?.customerContent.missingBeforeLaunch ?? [])
        : []
      ).map(
        (description, index) =>
          Object.freeze({
            id: `launch-content-${index}`,
            description: sourced(
              description,
              "project-understanding",
              `mission.profile.customerContent.missingBeforeLaunch[${index}]`,
            ),
          }),
      ),
    ),
    decisions: Object.freeze(
      [
        ...mission.decisionHistory.map((decision) => {
          const delegated = delegatedDecisionAnswer(decision.answer);
          const foundryMade = delegated !== null;
          const attribution: "customer" | "foundry" = foundryMade
            ? "foundry"
            : "customer";
          return Object.freeze({
            id: decision.questionId,
            label: sourced(
              decision.prompt,
              "project-understanding",
              `mission.decisionHistory.${decision.questionId}.prompt`,
            ),
            answer: sourced(
              delegated ?? decision.answer,
              foundryMade ? "foundry-assumption" : "customer-answer",
              `mission.decisionHistory.${decision.questionId}.answer`,
            ),
            attribution: sourced(
              attribution,
              foundryMade ? "foundry-assumption" : "customer-answer",
              `mission.decisionHistory.${decision.questionId}.answer`,
            ),
            reason: sourced(
              decision.reason,
              "project-understanding",
              `mission.decisionHistory.${decision.questionId}.reason`,
            ),
          });
        }),
        ...mission.selectedEnhancements.map((enhancement) =>
          Object.freeze({
            id: enhancement.suggestionId,
            label: sourced(
              enhancement.label,
              "model-recommendation",
              `mission.selectedEnhancements.${enhancement.suggestionId}.label`,
            ),
            answer: sourced(
              "Included in this version",
              "customer-answer",
              `mission.selectedEnhancements.${enhancement.suggestionId}`,
            ),
            attribution: sourced(
              "customer" as const,
              "customer-answer",
              `mission.selectedEnhancements.${enhancement.suggestionId}`,
            ),
            reason: sourced(
              enhancement.rationale,
              "model-recommendation",
              `mission.selectedEnhancements.${enhancement.suggestionId}.rationale`,
            ),
          }),
        ),
      ],
    ),
    limitations: Object.freeze(
      limitationValues.map((limitation) =>
        Object.freeze({
          id: limitation.id,
          description: sourced(
            limitation.description,
            limitation.kind,
            limitation.reference,
          ),
        }),
      ),
    ),
    nextSteps: Object.freeze(
      (profile?.contextualSuggestions ?? [])
        .filter(
          (suggestion) =>
            !selectedEnhancementIds.has(suggestion.suggestionId),
        )
        .map((suggestion) =>
          Object.freeze({
            id: suggestion.suggestionId,
            description: sourced(
              `${suggestion.label} \u2014 ${suggestion.rationale}`,
              "model-recommendation",
              `mission.profile.contextualSuggestions.${suggestion.suggestionId}`,
            ),
          }),
        ),
    ),
  });
}

function lifecycleOutcome(
  mission: Mission,
  missionPhases: readonly MissionPhase[],
  completionSummary: CompletionSummary,
): LifecycleOutcome | null {
  const kinds = {
    FAILED: "failed",
    EXHAUSTED: "exhausted",
    BLOCKED: "blocked",
    CANCELLED: "cancelled",
  } as const;
  const kind = kinds[mission.state as keyof typeof kinds];
  if (kind === undefined) return null;

  const affectedArea = customerRepairArea(
    mission.executionProjection.repair?.affectedArea ?? null,
  );
  const copy = {
    failed: {
      headline: "I stopped, and I couldn't finish this.",
      happened:
        affectedArea === null
          ? "A recorded build step could not be completed safely."
          : `The build could not safely complete ${affectedArea}.`,
      next:
        "Review what was proved and the Engineering details before starting a revised project.",
      need:
        "Nothing is required right now. A revised request can change the part that stopped.",
    },
    exhausted: {
      headline: "I stopped at the safe repair limit.",
      happened:
        affectedArea === null
          ? "The evidence-backed repair limit was reached. The final engineering error and every attempted change were preserved."
          : `The evidence-backed repair limit was reached while working on ${affectedArea}. The final error and every attempted change were preserved.`,
      next:
        "Review the final recorded error in Engineering details before deciding whether to retry or revise the plan.",
      need:
        "Nothing is required until the recorded failure has been diagnosed.",
    },
    blocked: {
      headline: "I need a decision before I can carry on.",
      happened:
        affectedArea === null
          ? "A customer decision is required before this project can continue safely."
          : `A decision is required about ${affectedArea} before this project can continue safely.`,
      next:
        "Start a revised project with that decision included in the request.",
      need:
        affectedArea === null
          ? "Tell me how you want the blocked part handled."
          : `Tell me how you want ${affectedArea} handled.`,
    },
    cancelled: {
      headline: "You stopped this build.",
      happened:
        "The build stopped when you asked. Completed work and the recorded plan were kept.",
      next:
        "Review the saved plan when you are ready to start another version.",
      need: "Nothing else is required.",
    },
  }[kind];
  const phaseIndex = Math.min(
    PHASE_LABELS.length - 1,
    Math.max(0, mission.executionProjection.phase.currentIndex),
  );

  return Object.freeze({
    kind: sourced(kind, "mission-ledger", `mission.state:${mission.state}`),
    projectName: sourced(
      mission.profile?.name ?? mission.intent,
      mission.profile === null ? "mission-ledger" : "project-understanding",
      mission.profile === null ? "mission.intent" : "mission.profile.name",
    ),
    headline: sourced(
      copy.headline,
      "mission-ledger",
      `mission.state:${mission.state}`,
    ),
    whatWasHappening: sourced(
      PHASE_LABELS[phaseIndex],
      "mission-ledger",
      "mission.executionProjection.phase.currentIndex",
    ),
    whatHappened: sourced(
      copy.happened,
      "mission-ledger",
      "mission.state+mission.executionProjection.repair.affectedArea",
    ),
    provedCount: completionSummary.provedCount,
    totalCount: completionSummary.totalCount,
    provedOutcomes: completionSummary.verifiedOutcomes,
    unprovedOutcomes: completionSummary.unverifiedOutcomes,
    completedPhases: sourced(
      missionPhases
        .filter((phase) => phase.status.value === "complete")
        .map((phase) => phase.label.value),
      "mission-ledger",
      "mission.executionProjection.phase.completedThrough",
    ),
    whatToTryNext: sourced(
      copy.next,
      "mission-ledger",
      `mission.state:${mission.state}`,
    ),
    whatINeed: sourced(
      copy.need,
      "mission-ledger",
      `mission.state:${mission.state}`,
    ),
    planSaved: sourced(
      mission.profile !== null,
      "mission-ledger",
      "mission.profile",
    ),
  });
}

function unsupported(mission: Mission): UnsupportedSummary | null {
  const profile = mission.profile;
  if (profile === null || profile.platform === "web") return null;
  const requested = {
    mobile: "a native mobile app",
    desktop: "a desktop application you install",
    game: "a native game",
    other: "a platform without a certified Foundry build path",
  }[profile.platform] ?? `a ${profile.platform} project`;
  return Object.freeze({
    requestedPlatform: sourced(
      profile.platform,
      "project-understanding",
      "mission.profile.platform",
    ),
    requestedDescription: sourced(
      requested,
      "project-understanding",
      "mission.profile.platform",
    ),
    supportedOutcome: sourced(
      "web apps, business websites, customer portals, internal tools, and web APIs",
      "capability-registry",
      "mission.technicalStack",
    ),
    alternative: sourced(
      "A web version can work in a phone or desktop browser without requiring an installation.",
      "capability-registry",
      "mission.technicalStack",
    ),
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
  if (mission.state === "SUCCEEDED") return "completion";
  if (mission.state === "BLOCKED") return "blocked";
  if (mission.state === "CANCELLED") return "cancelled";
  if (["FAILED", "EXHAUSTED"].includes(mission.state)) return "failed";
  if (mission.profile === null) return "reading";
  if (mission.profile.platform !== "web") return "unsupported";
  if (
    ["INTAKE", "CLARIFYING", "CONTRACTED"].includes(mission.state) &&
    (!mission.proposalConfirmed ||
      mission.profile.openQuestions.length > 0)
  ) {
    return "understanding";
  }
  if (
    ["INTAKE", "CLARIFYING", "CONTRACTED"].includes(mission.state)
  ) {
    return "plan";
  }
  return "building";
}

export function selectFoundryExperience(
  mission: Mission,
  providers: readonly Provider[] = [],
): FoundryExperienceModel {
  const projectedPhases = phases(mission);
  const completionSummary = completion(mission);
  return Object.freeze({
    project: selectProjectSummary(mission),
    understanding: understanding(mission),
    clarification: clarification(mission),
    decisionBrief: decisionBrief(mission),
    phases: projectedPhases,
    narrative: narrative(mission),
    repair:
      mission.executionProjection.repair !== null &&
      ["REPAIRING", "BLOCKED", "EXHAUSTED"].includes(mission.state)
        ? Object.freeze({
            state: sourced(
              mission.executionProjection.repair.state,
              "mission-ledger",
              "mission.executionProjection.repair.state",
            ),
            lines: sourced(
              mission.executionProjection.repair.lines,
              "mission-ledger",
              "mission.executionProjection.repair.lines",
            ),
            affectedArea: sourced(
              customerRepairArea(
                mission.executionProjection.repair.affectedArea,
              ),
              "runtime-evidence",
              "mission.executionProjection.repair.affectedArea",
            ),
            observedProblem: sourced(
              customerRepairCopy(
                mission.executionProjection.repair.state,
                mission.executionProjection.repair.targetObligationIds.length,
              ),
              "runtime-evidence",
              "mission.executionProjection.repair.state",
            ),
            correction: sourced(
              mission.executionProjection.repair.lines.includes(
                "I'm correcting the affected part.",
              )
                ? "I'm correcting the affected part."
                : null,
              "mission-ledger",
              "mission.executionProjection.repair.lines",
            ),
            checksToRerun: sourced(
              mission.executionProjection.repair.targetObligationIds,
              "requirement-contract",
              "mission.executionProjection.repair.targetObligationIds",
            ),
            customerActionRequired: sourced(
              mission.executionProjection.repair.state ===
                "customer-action-required" ||
                mission.executionProjection.repair.state ===
                  "external-service",
              "mission-ledger",
              "mission.executionProjection.repair.state",
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
    completion: completionSummary,
    lifecycleOutcome: lifecycleOutcome(
      mission,
      projectedPhases,
      completionSummary,
    ),
    unsupported: unsupported(mission),
    providers: providerTransparency(providers),
    surface: surface(mission),
  });
}
