import type {
  Mission,
  MissionActivity,
  ModelRoute,
  ProjectProfile,
  Provider,
} from "./contracts";

export class ExperiencePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperiencePayloadError";
  }
}

function fail(path: string, expectation: string): never {
  throw new ExperiencePayloadError(
    `Foundry received an invalid ${path}; expected ${expectation}.`,
  );
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "an object");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(path, "a non-empty string");
  }
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "a boolean");
  return value;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) return fail(path, "an integer");
  return value as number;
}

function nullableNumber(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(path, "a finite number or null");
  }
  return value;
}

function list<T>(
  value: unknown,
  path: string,
  parse: (entry: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) return fail(path, "an array");
  return value.map((entry, index) => parse(entry, `${path}[${index}]`));
}

function textList(value: unknown, path: string): string[] {
  return list(value, path, text);
}

function projectProfile(value: unknown, path: string): ProjectProfile {
  const input = object(value, path);
  return {
    missionId: text(input.missionId, `${path}.missionId`),
    profileVersion: integer(input.profileVersion, `${path}.profileVersion`),
    name: text(input.name, `${path}.name`),
    summary: text(input.summary, `${path}.summary`),
    family: text(input.family, `${path}.family`),
    platform: text(input.platform, `${path}.platform`),
    primaryActors: textList(input.primaryActors, `${path}.primaryActors`),
    outcomes: textList(input.outcomes, `${path}.outcomes`),
    capabilities: textList(input.capabilities, `${path}.capabilities`),
    dataConcepts: textList(input.dataConcepts, `${path}.dataConcepts`),
    constraints: textList(input.constraints, `${path}.constraints`),
    architectureDecisions: textList(
      input.architectureDecisions,
      `${path}.architectureDecisions`,
    ),
    openQuestions: list(input.openQuestions, `${path}.openQuestions`, (entry, itemPath) => {
      const question = object(entry, itemPath);
      return {
        questionId: text(question.questionId, `${itemPath}.questionId`),
        prompt: text(question.prompt, `${itemPath}.prompt`),
        reason: text(question.reason, `${itemPath}.reason`),
        answerOptions: textList(
          question.answerOptions,
          `${itemPath}.answerOptions`,
        ),
      };
    }),
    contextualSuggestions: list(
      input.contextualSuggestions,
      `${path}.contextualSuggestions`,
      (entry, itemPath) => {
        const suggestion = object(entry, itemPath);
        return {
          suggestionId: text(
            suggestion.suggestionId,
            `${itemPath}.suggestionId`,
          ),
          label: text(suggestion.label, `${itemPath}.label`),
          rationale: text(suggestion.rationale, `${itemPath}.rationale`),
        };
      },
    ),
    selectedStack: (() => {
      const stack = object(input.selectedStack, `${path}.selectedStack`);
      return {
        stackId: text(stack.stackId, `${path}.selectedStack.stackId`),
        version: text(stack.version, `${path}.selectedStack.version`),
      };
    })(),
    verificationPlan: (() => {
      const plan = object(input.verificationPlan, `${path}.verificationPlan`);
      return {
        checks: list(plan.checks, `${path}.verificationPlan.checks`, (entry, itemPath) => {
          const check = object(entry, itemPath);
          const origin = text(check.origin, `${itemPath}.origin`);
          if (origin !== "customer-stated" && origin !== "foundry-derived") {
            return fail(`${itemPath}.origin`, "a supported obligation origin");
          }
          return {
            checkId: text(check.checkId, `${itemPath}.checkId`),
            label: text(check.label, `${itemPath}.label`),
            origin,
          };
        }),
      };
    })(),
  };
}

function activity(value: unknown, path: string): MissionActivity {
  const input = object(value, path);
  return {
    sequence: integer(input.sequence, `${path}.sequence`),
    occurredAt: text(input.occurredAt, `${path}.occurredAt`),
    kind: text(input.kind, `${path}.kind`),
    title: text(input.title, `${path}.title`),
    detail: text(input.detail, `${path}.detail`),
  };
}

function modelRoute(value: unknown, path: string): ModelRoute {
  const input = object(value, path);
  return {
    sequence: integer(input.sequence, `${path}.sequence`),
    occurredAt: text(input.occurredAt, `${path}.occurredAt`),
    requestId: text(input.requestId, `${path}.requestId`),
    provider: text(input.provider, `${path}.provider`),
    providerFamily: nullableText(input.providerFamily, `${path}.providerFamily`),
    modelId: text(input.modelId, `${path}.modelId`),
    taskClass: text(input.taskClass, `${path}.taskClass`),
    depthLevel:
      input.depthLevel === null
        ? null
        : integer(input.depthLevel, `${path}.depthLevel`),
    routingReason: nullableText(input.routingReason, `${path}.routingReason`),
    status: text(input.status, `${path}.status`),
    attempt: integer(input.attempt, `${path}.attempt`),
    inputTokens:
      input.inputTokens === null
        ? null
        : integer(input.inputTokens, `${path}.inputTokens`),
    outputTokens:
      input.outputTokens === null
        ? null
        : integer(input.outputTokens, `${path}.outputTokens`),
    costUsd: nullableNumber(input.costUsd, `${path}.costUsd`),
  };
}

export function validateMission(value: unknown, path = "mission"): Mission {
  const input = object(value, path);
  const currentActivity =
    input.currentActivity === null
      ? null
      : activity(input.currentActivity, `${path}.currentActivity`);
  const profile =
    input.profile === null
      ? null
      : projectProfile(input.profile, `${path}.profile`);
  const contract =
    input.contract === null
      ? null
      : (() => {
          const raw = object(input.contract, `${path}.contract`);
          return {
            contractVersion: integer(
              raw.contractVersion,
              `${path}.contract.contractVersion`,
            ),
            obligations: list(
              raw.obligations,
              `${path}.contract.obligations`,
              (entry, itemPath) => {
                const obligation = object(entry, itemPath);
                return {
                  obligationId: text(
                    obligation.obligationId,
                    `${itemPath}.obligationId`,
                  ),
                  statement: text(obligation.statement, `${itemPath}.statement`),
                  origin: text(obligation.origin, `${itemPath}.origin`),
                };
              },
            ),
          };
        })();
  const metrics =
    input.executionMetrics === null
      ? null
      : (() => {
          const raw = object(
            input.executionMetrics,
            `${path}.executionMetrics`,
          );
          const repairScopes = object(
            raw.repairScopes,
            `${path}.executionMetrics.repairScopes`,
          );
          return {
            verifiedObligationIds: textList(
              raw.verifiedObligationIds,
              `${path}.executionMetrics.verifiedObligationIds`,
            ),
            uniqueHypothesisCount: integer(
              raw.uniqueHypothesisCount,
              `${path}.executionMetrics.uniqueHypothesisCount`,
            ),
            repeatedPipelineCost: integer(
              raw.repeatedPipelineCost,
              `${path}.executionMetrics.repeatedPipelineCost`,
            ),
            installCount: integer(
              raw.installCount,
              `${path}.executionMetrics.installCount`,
            ),
            reinstallCount: integer(
              raw.reinstallCount,
              `${path}.executionMetrics.reinstallCount`,
            ),
            rebuildCount: integer(
              raw.rebuildCount,
              `${path}.executionMetrics.rebuildCount`,
            ),
            runtimeRestartCount: integer(
              raw.runtimeRestartCount,
              `${path}.executionMetrics.runtimeRestartCount`,
            ),
            providerCallCount: integer(
              raw.providerCallCount,
              `${path}.executionMetrics.providerCallCount`,
            ),
            repairScopes: Object.fromEntries(
              Object.entries(repairScopes).map(([key, count]) => [
                key,
                integer(
                  count,
                  `${path}.executionMetrics.repairScopes.${key}`,
                ),
              ]),
            ),
          };
        })();
  return {
    missionId: text(input.missionId, `${path}.missionId`),
    intent: text(input.intent, `${path}.intent`),
    state: text(input.state, `${path}.state`),
    profile,
    contract,
    previewUrl: nullableText(input.previewUrl, `${path}.previewUrl`),
    running: bool(input.running, `${path}.running`),
    error: nullableText(input.error, `${path}.error`),
    activities: list(input.activities, `${path}.activities`, activity),
    currentActivity,
    modelRouting: list(input.modelRouting, `${path}.modelRouting`, modelRoute),
    activeModelRoute:
      input.activeModelRoute === null
        ? null
        : modelRoute(input.activeModelRoute, `${path}.activeModelRoute`),
    executionMetrics: metrics,
    updatedAt: nullableText(input.updatedAt, `${path}.updatedAt`),
  };
}

export function validateMissionList(value: unknown): Mission[] {
  const input = object(value, "mission list response");
  return list(input.missions, "mission list response.missions", validateMission);
}

function provider(value: unknown, path: string): Provider {
  const input = object(value, path);
  return {
    providerId: text(input.providerId, `${path}.providerId`),
    displayName: text(input.displayName, `${path}.displayName`),
    configured: bool(input.configured, `${path}.configured`),
    formatValid: bool(input.formatValid, `${path}.formatValid`),
    health: text(input.health, `${path}.health`),
    available: bool(input.available, `${path}.available`),
    reason: text(input.reason, `${path}.reason`),
    models: list(input.models, `${path}.models`, (entry, itemPath) => {
      const model = object(entry, itemPath);
      return {
        modelId: text(model.modelId, `${itemPath}.modelId`),
        displayName: text(model.displayName, `${itemPath}.displayName`),
        status: text(model.status, `${itemPath}.status`),
      };
    }),
  };
}

export function validateProviderList(value: unknown): Provider[] {
  const input = object(value, "provider list response");
  return list(input.providers, "provider list response.providers", provider);
}
