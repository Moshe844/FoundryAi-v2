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
    primaryJourneys:
      input.primaryJourneys === undefined
        ? textList(input.outcomes, `${path}.outcomes`)
        : textList(input.primaryJourneys, `${path}.primaryJourneys`),
    outcomes: textList(input.outcomes, `${path}.outcomes`),
    capabilities: textList(input.capabilities, `${path}.capabilities`),
    dataConcepts: textList(input.dataConcepts, `${path}.dataConcepts`),
    designDirection:
      input.designDirection === undefined
        ? {
            recommendedStyle: `Focused around ${textList(input.primaryActors, `${path}.primaryActors`).join(" and ")}`,
            reason: text(input.summary, `${path}.summary`),
            layoutApproach: textList(input.outcomes, `${path}.outcomes`)[0],
            tone: `Clear and direct for ${textList(input.primaryActors, `${path}.primaryActors`).join(" and ")}`,
            mobilePriority:
              "Keep the main experience useful on smaller screens as well as desktop.",
            accessibilityConsiderations: [
              "Clear labels, visible focus, readable contrast, and understandable states.",
            ],
          }
        : (() => {
            const direction = object(
              input.designDirection,
              `${path}.designDirection`,
            );
            return {
              recommendedStyle: text(
                direction.recommendedStyle,
                `${path}.designDirection.recommendedStyle`,
              ),
              reason: text(
                direction.reason,
                `${path}.designDirection.reason`,
              ),
              layoutApproach: text(
                direction.layoutApproach,
                `${path}.designDirection.layoutApproach`,
              ),
              tone: text(
                direction.tone,
                `${path}.designDirection.tone`,
              ),
              mobilePriority: text(
                direction.mobilePriority,
                `${path}.designDirection.mobilePriority`,
              ),
              accessibilityConsiderations: textList(
                direction.accessibilityConsiderations,
                `${path}.designDirection.accessibilityConsiderations`,
              ),
            };
          })(),
    includedDefaults:
      input.includedDefaults === undefined
        ? []
        : textList(input.includedDefaults, `${path}.includedDefaults`),
    assumptions:
      input.assumptions === undefined
        ? textList(input.constraints, `${path}.constraints`)
        : textList(input.assumptions, `${path}.assumptions`),
    customerContent:
      input.customerContent === undefined
        ? { supplied: [], missingBeforeLaunch: [] }
        : (() => {
            const content = object(
              input.customerContent,
              `${path}.customerContent`,
            );
            return {
              supplied: list(
                content.supplied,
                `${path}.customerContent.supplied`,
                (entry, itemPath) => {
                  const supplied = object(entry, itemPath);
                  const source = text(
                    supplied.source,
                    `${itemPath}.source`,
                  );
                  if (
                    source !== "customer-request" &&
                    source !== "customer-answer"
                  ) {
                    return fail(
                      `${itemPath}.source`,
                      "a customer content source",
                    );
                  }
                  return {
                    kind: text(supplied.kind, `${itemPath}.kind`),
                    value: text(supplied.value, `${itemPath}.value`),
                    source,
                  };
                },
              ),
              missingBeforeLaunch: textList(
                content.missingBeforeLaunch,
                `${path}.customerContent.missingBeforeLaunch`,
              ),
            };
          })(),
    observations:
      input.observations === undefined
        ? []
        : textList(input.observations, `${path}.observations`),
    designAlternatives:
      input.designAlternatives === undefined
        ? []
        : list(
            input.designAlternatives,
            `${path}.designAlternatives`,
            (entry, itemPath) => {
              const alternative = object(entry, itemPath);
              const confidence =
                alternative.confidence === undefined
                  ? undefined
                  : object(alternative.confidence, `${itemPath}.confidence`);
              const preview =
                alternative.preview === undefined
                  ? undefined
                  : object(alternative.preview, `${itemPath}.preview`);
              return {
                approach: text(
                  alternative.approach,
                  `${itemPath}.approach`,
                ),
                rationale: text(
                  alternative.rationale,
                  `${itemPath}.rationale`,
                ),
                tradeoffs:
                  alternative.tradeoffs === undefined
                    ? undefined
                    : textList(
                        alternative.tradeoffs,
                        `${itemPath}.tradeoffs`,
                      ),
                whyItFits:
                  alternative.whyItFits === undefined
                    ? undefined
                    : text(alternative.whyItFits, `${itemPath}.whyItFits`),
                layoutApproach:
                  alternative.layoutApproach === undefined
                    ? undefined
                    : text(alternative.layoutApproach, `${itemPath}.layoutApproach`),
                visualPersonality:
                  alternative.visualPersonality === undefined
                    ? undefined
                    : text(alternative.visualPersonality, `${itemPath}.visualPersonality`),
                informationDensity:
                  alternative.informationDensity === undefined
                    ? undefined
                    : text(alternative.informationDensity, `${itemPath}.informationDensity`),
                navigationApproach:
                  alternative.navigationApproach === undefined
                    ? undefined
                    : text(alternative.navigationApproach, `${itemPath}.navigationApproach`),
                mobileBehavior:
                  alternative.mobileBehavior === undefined
                    ? undefined
                    : text(alternative.mobileBehavior, `${itemPath}.mobileBehavior`),
                tradeoff:
                  alternative.tradeoff === undefined
                    ? undefined
                    : text(alternative.tradeoff, `${itemPath}.tradeoff`),
                confidence:
                  confidence === undefined
                    ? undefined
                    : {
                        score: nullableNumber(confidence.score, `${itemPath}.confidence.score`) ?? 0,
                        rationale: text(confidence.rationale, `${itemPath}.confidence.rationale`),
                      },
                preview:
                  preview === undefined
                    ? undefined
                    : {
                        typographyCharacter: text(preview.typographyCharacter, `${itemPath}.preview.typographyCharacter`),
                        spacingDensity: text(preview.spacingDensity, `${itemPath}.preview.spacingDensity`),
                        colorMood: text(preview.colorMood, `${itemPath}.preview.colorMood`),
                        hierarchy: text(preview.hierarchy, `${itemPath}.preview.hierarchy`),
                      },
                recommended: bool(
                  alternative.recommended,
                  `${itemPath}.recommended`,
                ),
              };
            },
          ),
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
        recommendation:
          question.recommendation === undefined
            ? undefined
            : text(question.recommendation, `${itemPath}.recommendation`),
        recommendationReason:
          question.recommendationReason === undefined
            ? undefined
            : text(question.recommendationReason, `${itemPath}.recommendationReason`),
        consequences:
          question.consequences === undefined
            ? undefined
            : textList(question.consequences, `${itemPath}.consequences`),
        architectureImpact:
          question.architectureImpact === undefined
            ? undefined
            : text(question.architectureImpact, `${itemPath}.architectureImpact`),
        scopeImpact:
          question.scopeImpact === undefined
            ? undefined
            : text(question.scopeImpact, `${itemPath}.scopeImpact`),
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
          value:
            suggestion.value === undefined
              ? undefined
              : text(suggestion.value, `${itemPath}.value`),
          impact:
            suggestion.impact === undefined
              ? undefined
              : text(suggestion.impact, `${itemPath}.impact`),
          selectedByDefault:
            suggestion.selectedByDefault === undefined
              ? undefined
              : bool(
                  suggestion.selectedByDefault,
                  `${itemPath}.selectedByDefault`,
                ),
          confidence:
            suggestion.confidence === undefined
              ? undefined
              : nullableNumber(
                  suggestion.confidence,
                  `${itemPath}.confidence`,
                ) ?? undefined,
          requiredDependencies:
            suggestion.requiredDependencies === undefined
              ? undefined
              : textList(
                  suggestion.requiredDependencies,
                  `${itemPath}.requiredDependencies`,
                ),
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
  const decisionHistory = list(
    input.decisionHistory,
    `${path}.decisionHistory`,
    (entry, itemPath) => {
      const decision = object(entry, itemPath);
      return {
        questionId: text(decision.questionId, `${itemPath}.questionId`),
        prompt: text(decision.prompt, `${itemPath}.prompt`),
        reason: text(decision.reason, `${itemPath}.reason`),
        choices: textList(decision.choices, `${itemPath}.choices`),
        recommendation: text(
          decision.recommendation,
          `${itemPath}.recommendation`,
        ),
        answer: text(decision.answer, `${itemPath}.answer`),
      };
    },
  );
  const selectedEnhancements = list(
    input.selectedEnhancements,
    `${path}.selectedEnhancements`,
    (entry, itemPath) => {
      const enhancement = object(entry, itemPath);
      return {
        suggestionId: text(
          enhancement.suggestionId,
          `${itemPath}.suggestionId`,
        ),
        label: text(enhancement.label, `${itemPath}.label`),
        rationale: text(enhancement.rationale, `${itemPath}.rationale`),
      };
    },
  );
  const technicalStack = (() => {
    const stack = object(input.technicalStack, `${path}.technicalStack`);
    const components = object(
      stack.components,
      `${path}.technicalStack.components`,
    );
    return {
      stackId: text(stack.stackId, `${path}.technicalStack.stackId`),
      stackVersion: text(
        stack.stackVersion,
        `${path}.technicalStack.stackVersion`,
      ),
      components: {
        framework: text(
          components.framework,
          `${path}.technicalStack.components.framework`,
        ),
        language: text(
          components.language,
          `${path}.technicalStack.components.language`,
        ),
        database: text(
          components.database,
          `${path}.technicalStack.components.database`,
        ),
        packageManager: text(
          components.packageManager,
          `${path}.technicalStack.components.packageManager`,
        ),
        browserTesting: text(
          components.browserTesting,
          `${path}.technicalStack.components.browserTesting`,
        ),
      },
      frameworkVersion: nullableText(
        stack.frameworkVersion,
        `${path}.technicalStack.frameworkVersion`,
      ),
      knownLimitations: textList(
        stack.knownLimitations,
        `${path}.technicalStack.knownLimitations`,
      ),
    };
  })();
  const executionProjection = (() => {
    const projection = object(
      input.executionProjection,
      `${path}.executionProjection`,
    );
    const rawTiming =
      projection.timing === undefined
        ? { startedAt: null, completedAt: null }
        : object(
            projection.timing,
            `${path}.executionProjection.timing`,
          );
    const phase = object(
      projection.phase,
      `${path}.executionProjection.phase`,
    );
    const rawRepair =
      projection.repair === null
        ? null
        : object(
            projection.repair,
            `${path}.executionProjection.repair`,
          );
    const rawRuntime =
      projection.runtime === null
        ? null
        : object(
            projection.runtime,
            `${path}.executionProjection.runtime`,
          );
    const workspace = object(
      projection.workspace,
      `${path}.executionProjection.workspace`,
    );
    return {
      timing: {
        startedAt: nullableText(
          rawTiming.startedAt,
          `${path}.executionProjection.timing.startedAt`,
        ),
        completedAt: nullableText(
          rawTiming.completedAt,
          `${path}.executionProjection.timing.completedAt`,
        ),
      },
      phase: {
        currentIndex: integer(
          phase.currentIndex,
          `${path}.executionProjection.phase.currentIndex`,
        ),
        completedThrough: integer(
          phase.completedThrough,
          `${path}.executionProjection.phase.completedThrough`,
        ),
        interrupted: bool(
          phase.interrupted,
          `${path}.executionProjection.phase.interrupted`,
        ),
        includesDataPhase: bool(
          phase.includesDataPhase,
          `${path}.executionProjection.phase.includesDataPhase`,
        ),
      },
      repair:
        rawRepair === null
          ? null
          : {
              state: text(
                rawRepair.state,
                `${path}.executionProjection.repair.state`,
              ) as NonNullable<
                Mission["executionProjection"]["repair"]
              >["state"],
              lines: textList(
                rawRepair.lines,
                `${path}.executionProjection.repair.lines`,
              ),
              targetObligationIds: textList(
                rawRepair.targetObligationIds,
                `${path}.executionProjection.repair.targetObligationIds`,
              ),
              affectedArea: nullableText(
                rawRepair.affectedArea,
                `${path}.executionProjection.repair.affectedArea`,
              ),
              findingDetail: nullableText(
                rawRepair.findingDetail,
                `${path}.executionProjection.repair.findingDetail`,
              ),
              attempts: integer(
                rawRepair.attempts,
                `${path}.executionProjection.repair.attempts`,
              ),
            },
      runtime:
        rawRuntime === null
          ? null
          : {
              status: text(
                rawRuntime.status,
                `${path}.executionProjection.runtime.status`,
              ) as NonNullable<
                Mission["executionProjection"]["runtime"]
              >["status"],
              eventType: text(
                rawRuntime.eventType,
                `${path}.executionProjection.runtime.eventType`,
              ),
              previewUrl: text(
                rawRuntime.previewUrl,
                `${path}.executionProjection.runtime.previewUrl`,
              ),
              workspaceId: text(
                rawRuntime.workspaceId,
                `${path}.executionProjection.runtime.workspaceId`,
              ),
              checkpointId: text(
                rawRuntime.checkpointId,
                `${path}.executionProjection.runtime.checkpointId`,
              ),
              sessionId: text(
                rawRuntime.sessionId,
                `${path}.executionProjection.runtime.sessionId`,
              ),
              plainCause: nullableText(
                rawRuntime.plainCause,
                `${path}.executionProjection.runtime.plainCause`,
              ),
              evidenceReferences: list(
                rawRuntime.evidenceReferences,
                `${path}.executionProjection.runtime.evidenceReferences`,
                (entry, itemPath) => {
                  const reference = object(entry, itemPath);
                  return {
                    evidenceId: text(
                      reference.evidenceId,
                      `${itemPath}.evidenceId`,
                    ),
                    workspaceCheckpointReference: nullableText(
                      reference.workspaceCheckpointReference,
                      `${itemPath}.workspaceCheckpointReference`,
                    ),
                  };
                },
              ),
            },
      workspace: {
        workspaceId: nullableText(
          workspace.workspaceId,
          `${path}.executionProjection.workspace.workspaceId`,
        ),
        checkpointIds: textList(
          workspace.checkpointIds,
          `${path}.executionProjection.workspace.checkpointIds`,
        ),
        runtimeAdapterId: text(
          workspace.runtimeAdapterId,
          `${path}.executionProjection.workspace.runtimeAdapterId`,
        ),
      },
      verification: list(
        projection.verification,
        `${path}.executionProjection.verification`,
        (entry, itemPath) => {
          const verification = object(entry, itemPath);
          return {
            obligationId: text(
              verification.obligationId,
              `${itemPath}.obligationId`,
            ),
            statement: text(
              verification.statement,
              `${itemPath}.statement`,
            ),
            result: text(
              verification.result,
              `${itemPath}.result`,
            ) as Mission["executionProjection"]["verification"][number]["result"],
            detail: nullableText(
              verification.detail,
              `${itemPath}.detail`,
            ),
            evidenceReferences: list(
              verification.evidenceReferences,
              `${itemPath}.evidenceReferences`,
              (referenceEntry, referencePath) => {
                const reference = object(referenceEntry, referencePath);
                return {
                  evidenceId: text(
                    reference.evidenceId,
                    `${referencePath}.evidenceId`,
                  ),
                  verificationRequestReference:
                    reference.verificationRequestReference === undefined
                      ? null
                      : nullableText(
                          reference.verificationRequestReference,
                          `${referencePath}.verificationRequestReference`,
                        ),
                  workspaceCheckpointReference: nullableText(
                    reference.workspaceCheckpointReference,
                    `${referencePath}.workspaceCheckpointReference`,
                  ),
                };
              },
            ),
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
  const discoveryInputKinds = new Set([
    "context",
    "understanding",
    "workflow",
    "feature",
    "design",
    "business-rule",
    "role",
    "integration",
    "limitation",
    "acceptance",
  ]);
  const discoveryRaw =
    input.discoveryConversation === undefined
      ? {
          messages: [],
          latestRevision: {
            profileVersion: profile?.profileVersion ?? 0,
            changedSections: [],
          },
        }
      : object(
          input.discoveryConversation,
          `${path}.discoveryConversation`,
        );
  const latestRevisionRaw = object(
    discoveryRaw.latestRevision,
    `${path}.discoveryConversation.latestRevision`,
  );
  const discoveryConversation = {
    messages: list(
      discoveryRaw.messages,
      `${path}.discoveryConversation.messages`,
      (entry, itemPath) => {
        const message = object(entry, itemPath);
        const kind = text(message.kind, `${itemPath}.kind`);
        if (!discoveryInputKinds.has(kind)) {
          return fail(`${itemPath}.kind`, "a supported customer-input kind");
        }
        return {
          messageId: text(message.messageId, `${itemPath}.messageId`),
          kind: kind as Mission["discoveryConversation"]["messages"][number]["kind"],
          text: text(message.text, `${itemPath}.text`),
          profileVersion: integer(
            message.profileVersion,
            `${itemPath}.profileVersion`,
          ),
          occurredAt: text(message.occurredAt, `${itemPath}.occurredAt`),
        };
      },
    ),
    latestRevision: {
      profileVersion: integer(
        latestRevisionRaw.profileVersion,
        `${path}.discoveryConversation.latestRevision.profileVersion`,
      ),
      changedSections: textList(
        latestRevisionRaw.changedSections,
        `${path}.discoveryConversation.latestRevision.changedSections`,
      ),
    },
  };
  return {
    missionId: text(input.missionId, `${path}.missionId`),
    intent: text(input.intent, `${path}.intent`),
    state: text(input.state, `${path}.state`),
    profile,
    proposalConfirmed: bool(
      input.proposalConfirmed,
      `${path}.proposalConfirmed`,
    ),
    contract,
    decisionHistory,
    selectedEnhancements,
    discoveryConversation,
    technicalStack,
    executionProjection,
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
    autoRoutingAvailable: bool(input.autoRoutingAvailable, `${path}.autoRoutingAvailable`),
    lastSuccessfulRefreshAt: nullableText(input.lastSuccessfulRefreshAt, `${path}.lastSuccessfulRefreshAt`),
    refreshStale: bool(input.refreshStale, `${path}.refreshStale`),
    refreshMaximumAgeMs: integer(input.refreshMaximumAgeMs, `${path}.refreshMaximumAgeMs`),
    nextScheduledRefreshAt: nullableText(input.nextScheduledRefreshAt, `${path}.nextScheduledRefreshAt`),
    lifecycleSourceStatus: text(input.lifecycleSourceStatus, `${path}.lifecycleSourceStatus`),
    reason: text(input.reason, `${path}.reason`),
    connectedModels: list(input.connectedModels, `${path}.connectedModels`, (entry, itemPath) => {
      const model = object(entry, itemPath);
      return {
        modelId: text(model.modelId, `${itemPath}.modelId`),
        displayName: text(model.displayName, `${itemPath}.displayName`),
        purpose: text(model.purpose, `${itemPath}.purpose`),
        lifecycle: text(model.lifecycle, `${itemPath}.lifecycle`),
        releaseChannel: text(model.releaseChannel, `${itemPath}.releaseChannel`),
        validationStatus: text(model.validationStatus, `${itemPath}.validationStatus`),
        catalogPresence: text(model.catalogPresence, `${itemPath}.catalogPresence`),
        lastSeenAt: nullableText(model.lastSeenAt, `${itemPath}.lastSeenAt`),
        missingSince: nullableText(model.missingSince, `${itemPath}.missingSince`),
        lastValidatedAt: nullableText(model.lastValidatedAt, `${itemPath}.lastValidatedAt`),
        engineeringEligible: bool(model.engineeringEligible, `${itemPath}.engineeringEligible`),
        reasons: list(model.reasons, `${itemPath}.reasons`, text),
      };
    }),
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
