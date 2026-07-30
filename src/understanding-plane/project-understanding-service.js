import { MissionState } from "../domain/lifecycle.js";
import {
  LatencyProfile,
  ModelCapability,
  TaskDepth,
} from "../domain/ai-registry.js";
import {
  MODEL_GATEWAY_SOURCE,
  ModelTaskClass,
  ModelTier,
  normalizeModelCallRecord,
} from "../domain/execution.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import {
  ProjectFamily,
  normalizeProjectProfile,
} from "../domain/project-profile.js";
import {
  CERTIFIED_STACK_ID,
  CERTIFIED_STACK_VERSION,
  WEB_STACK_MANIFEST,
} from "../domain/toolchain-stack.js";
import {
  classifyModelRouteFailure,
  excludePermanentlyRejectedRoutes,
  rankRoutesByPersistedTaskHistory,
  validateStructuredModelOutput,
} from "../work-plane/model-gateway.js";

export const PROJECT_UNDERSTANDING_SOURCE =
  "PROJECT_UNDERSTANDING_SERVICE";
const PROJECT_UNDERSTANDING_DEPTH = TaskDepth.STANDARD_CODING;
const PROJECT_UNDERSTANDING_TIER = ModelTier.STANDARD_ENGINEERING;

const stringArray = Object.freeze({
  type: "array",
  items: { type: "string" },
});
const nonEmptyStringArray = Object.freeze({
  type: "array",
  minItems: 1,
  items: { type: "string", minLength: 1 },
});

const PROJECT_PLATFORMS = Object.freeze([
  "web",
  "mobile",
  "desktop",
  "game",
  "other",
]);

const understandingSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "name",
    "summary",
    "family",
    "platform",
    "primaryActors",
    "outcomes",
    "capabilities",
    "dataConcepts",
    "constraints",
    "architectureDecisions",
    "openQuestions",
    "contextualSuggestions",
    "obligations",
  ],
  properties: {
    name: { type: "string" },
    summary: { type: "string" },
    family: {
      type: "string",
      enum: Object.values(ProjectFamily),
    },
    platform: {
      type: "string",
      enum: PROJECT_PLATFORMS,
    },
    primaryActors: nonEmptyStringArray,
    outcomes: nonEmptyStringArray,
    capabilities: {
      type: "array",
      items: {
        type: "string",
        enum: WEB_STACK_MANIFEST.supportedCapabilities,
      },
    },
    dataConcepts: stringArray,
    constraints: stringArray,
    architectureDecisions: stringArray,
    openQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "reason", "answerOptions"],
        properties: {
          prompt: { type: "string" },
          reason: { type: "string" },
          answerOptions: nonEmptyStringArray,
        },
      },
    },
    contextualSuggestions: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "rationale"],
        properties: {
          label: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
    obligations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "statement",
          "origin",
          "verificationMode",
          "dependencyIndexes",
        ],
        properties: {
          statement: { type: "string" },
          origin: {
            type: "string",
            enum: ["customer-stated", "foundry-derived"],
          },
          verificationMode: {
            type: "string",
            enum: [
              "browser-check",
              "browser-errors",
              "dependency-lock",
              "dependency-install",
              "type-check",
              "lint",
              "production-build",
              "runtime-ready",
              "http-ready",
              "structured-tests",
            ],
          },
          dependencyIndexes: {
            type: "array",
            items: { type: "integer" },
          },
        },
      },
    },
  },
});

function identifier(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function acceptance(mode, checkId) {
  switch (mode) {
    case "browser-check":
      return {
        acceptanceCondition: {
          type: "browser-check-equals",
          check: checkId,
          expected: true,
        },
        evidenceKinds: [ObservationKind.BROWSER_INTERACTION_RESULT],
      };
    case "browser-errors":
      return {
        acceptanceCondition: {
          type: "browser-error-counts",
          maxConsoleErrors: 0,
          maxPageErrors: 0,
        },
        evidenceKinds: [ObservationKind.BROWSER_ERROR_RESULT],
      };
    case "dependency-lock":
    case "dependency-install":
    case "type-check":
    case "lint":
    case "production-build":
      return {
        acceptanceCondition: {
          type: "command-exit-code-equals",
          expectedExitCode: 0,
          checkpointIndependent: true,
        },
        evidenceKinds: [ObservationKind.COMMAND_EXIT_RESULT],
      };
    case "runtime-ready":
      return {
        acceptanceCondition: {
          type: "runtime-readiness-equals",
          expectedReady: true,
          checkpointIndependent: true,
        },
        evidenceKinds: [ObservationKind.RUNTIME_READINESS_RESULT],
      };
    case "http-ready":
      return {
        acceptanceCondition: {
          type: "http-status-equals",
          expectedStatus: 200,
          checkpointIndependent: true,
        },
        evidenceKinds: [ObservationKind.HTTP_RESPONSE_RESULT],
      };
    case "structured-tests":
      return {
        acceptanceCondition: {
          type: "structured-test-counts",
          suiteName: "project-browser-verification",
          minimumPassedCount: 1,
          maximumFailedCount: 0,
          maximumSkippedCount: 0,
        },
        evidenceKinds: [ObservationKind.STRUCTURED_TEST_RESULT],
      };
    default:
      throw new TypeError(`Unsupported verification mode: ${mode}.`);
  }
}

function nonEmptyStrings(values, fallback) {
  const result = Array.isArray(values)
    ? [...new Set(values.map((value) => String(value).trim()).filter(Boolean))]
    : [];
  return result.length > 0 ? result : fallback;
}

function normalizedQuestions(questions) {
  const byPrompt = new Map();
  for (const question of questions ?? []) {
    const prompt = String(question.prompt).trim();
    const key = prompt.toLowerCase().replace(/\s+/gu, " ");
    const existing = byPrompt.get(key);
    if (existing === undefined) {
      byPrompt.set(key, {
        prompt,
        reason: String(question.reason).trim(),
        answerOptions: nonEmptyStrings(question.answerOptions, [
          "Use Foundry's recommended option",
        ]),
      });
      continue;
    }
    existing.answerOptions = nonEmptyStrings(
      [...existing.answerOptions, ...(question.answerOptions ?? [])],
      existing.answerOptions,
    );
  }
  return [...byPrompt.values()];
}

function profileFromUnderstanding(missionId, result, profileVersion) {
  const obligations = Array.isArray(result.obligations)
    ? result.obligations
    : [];
  if (obligations.length === 0) {
    throw new TypeError(
      "The model returned no observable completion obligations.",
    );
  }
  const checks = obligations.map((obligation, index) => {
    const checkId = identifier("obligation", index);
    const observation = acceptance(obligation.verificationMode, checkId);
    const dependencyCheckIds = [
      ...new Set(
        (obligation.dependencyIndexes ?? [])
          .filter(
            (dependency) =>
              Number.isSafeInteger(dependency) &&
              dependency >= 1 &&
              dependency <= obligations.length &&
              dependency !== index + 1,
          )
          .map((dependency) => identifier("obligation", dependency - 1)),
      ),
    ];
    return {
      checkId,
      label: String(obligation.statement).trim(),
      origin: obligation.origin,
      acceptanceCondition: observation.acceptanceCondition,
      evidenceKinds: observation.evidenceKinds,
      dependencyCheckIds,
    };
  });
  return normalizeProjectProfile({
    missionId,
    profileVersion,
    name: String(result.name).trim(),
    summary: String(result.summary).trim(),
    family: result.family,
    platform: String(result.platform).trim(),
    primaryActors: nonEmptyStrings(result.primaryActors, ["Project user"]),
    outcomes: nonEmptyStrings(result.outcomes, [
      "The requested project behavior is observable.",
    ]),
    capabilities: nonEmptyStrings(result.capabilities, []).sort(),
    dataConcepts: nonEmptyStrings(result.dataConcepts, []),
    constraints: nonEmptyStrings(result.constraints, []),
    architectureDecisions: nonEmptyStrings(
      result.architectureDecisions,
      [],
    ),
    openQuestions: normalizedQuestions(result.openQuestions).map((question, index) => ({
      questionId: identifier("question", index),
      prompt: question.prompt,
      reason: question.reason,
      answerOptions: question.answerOptions,
    })),
    contextualSuggestions: (result.contextualSuggestions ?? []).map(
      (suggestion, index) => ({
        suggestionId: identifier("suggestion", index),
        label: String(suggestion.label).trim(),
        rationale: String(suggestion.rationale).trim(),
      }),
    ),
    sourceRequirementIds: ["customer-intent-1"],
    selectedStack: {
      stackId: CERTIFIED_STACK_ID,
      version: CERTIFIED_STACK_VERSION,
    },
    runtimeAdapterId: "nextjs-web-runtime",
    requirementContractVersion: 1,
    verificationPlan: {
      planId: `verification-plan-v${profileVersion}`,
      checks,
    },
  });
}

function latestProfile(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate = records[index]?.fact?.metadata?.projectProfile;
    if (candidate !== undefined) return normalizeProjectProfile(candidate);
  }
  return null;
}

function latestBindings(ledger, missionId) {
  const records = ledger.listEvents(missionId);
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const candidate =
      records[index]?.fact?.metadata?.verificationBindings;
    if (candidate !== undefined) return structuredClone(candidate);
  }
  return null;
}

function understandingPrompt(intent, answers, currentProfile) {
  return [
    "Interpret this project request for Foundry. This is reasoning, not keyword classification.",
    "Behave like a senior designer presenting a proposal to a business owner, not like an intake form. Before asking anything, decide what a professional would build for this specific business by default and put it in outcomes. Be generous and concrete: name every page, screen, or endpoint a competent studio would include without being asked, each phrased as something a real person can do or see. A small trade business normally needs a home page, a services page, an about page, customer reviews, a way to get in touch, an urgent-callout route, and a way to ask for a written estimate. Never return a thin outcome list because the customer wrote a short request.",
    "Ask as few questions as possible. Ask only where the answer would materially change how the work is built, who owns the data, how people sign in, what it integrates with, or the supported platform. Never ask about wording, colours, layout, page names, or anything you can decide well yourself. If the request is sufficiently understood, return no openQuestions.",
    "Write every question, reason, and suggestion for a non-technical business owner. Ask about outcomes and never about implementation. Do not use the words persistence, authentication, delegated, session, runtime, topology, schema, middleware, stateless, or architecture in any customer-visible text. Give each question two to four concrete plain-language options, and make the first option the one you would professionally recommend.",
    "In every reason, explain your thinking in one sentence a business owner would find useful — what the decision affects and why it matters to them. Never justify a question by saying it is required.",
    "Write with the confidence of someone who has done this many times. Say what you would do and why, in phrases like 'I am confident this is the right approach', 'there are two good options here and either works', 'I would lean toward', or 'this depends on how you plan to grow'. Never hedge with 'you may want to consider' and never present a menu instead of a recommendation.",
    "In architectureDecisions, record the judgement calls you made and the trade-off behind each one — what you chose, what you gave up, and why that is the right balance for this business. These are decisions you already made, not options for the customer.",
    "In constraints, record what you deliberately chose to leave out and why, phrased as intentional scope decisions a business owner would understand — for example that something is out of scope for a first version, or would need a service this machine does not have. Do not list vague caveats.",
    "Return at least three contextual suggestions that are specific to this exact business and would make the customer think they would not have thought of that. Ground each rationale in a concrete benefit for this business rather than generic best practice, and prefer a non-obvious idea over a familiar one.",
    `For capabilities, select only applicable identifiers from the certified web stack catalogue: ${WEB_STACK_MANIFEST.supportedCapabilities.join(", ")}.`,
    `All architecture decisions must remain within the selected stack manifest: ${JSON.stringify({
      stackId: WEB_STACK_MANIFEST.stackId,
      stackVersion: WEB_STACK_MANIFEST.stackVersion,
      components: WEB_STACK_MANIFEST.components,
      knownLimitations: WEB_STACK_MANIFEST.knownLimitations,
    })}. Do not propose Vite, Express, another framework, another database, or a different runtime.`,
    "Create individually observable obligations for every requested outcome and the necessary derived quality gates. Include real build success, runtime readiness, HTTP readiness, primary behavior, persistence when requested, and no blocking browser errors when applicable.",
    "Use the distinct dependency-lock, dependency-install, type-check, lint, and production-build verification modes for their corresponding engineering obligations.",
    "Do not invent acceptance claims that cannot be observed using the listed verification modes.",
    `Classify platform using exactly one architecture identifier: ${PROJECT_PLATFORMS.join(", ")}. Foundry currently supports only web projects. Preserve the requested platform honestly so unsupported requests can be rejected rather than silently converted.`,
    `Customer request:\n${intent}`,
    currentProfile === null
      ? "There is no prior ProjectProfile."
      : `Current validated ProjectProfile to revise without losing resolved decisions:\n${JSON.stringify(currentProfile)}`,
    answers.length === 0
      ? "No clarification answers have been supplied."
      : `Clarification answers:\n${JSON.stringify(answers)}`,
  ].join("\n\n");
}

export function createProjectUnderstandingService({
  ledger,
  orchestrator,
  profiles,
  contracts,
  evidence,
  facts,
  modelFacts = facts,
  router,
  providerRegistry,
  routeHistory = () => [],
  clock,
}) {
  return Object.freeze({
    latest(missionId) {
      return latestProfile(ledger, missionId);
    },

    verificationBindings(missionId) {
      return latestBindings(ledger, missionId);
    },

    async understand({
      missionId,
      intent,
      answers = [],
      requestId,
      eventId,
      causationId,
    }) {
      const state = ledger.projectState(missionId).state;
      if (
        state !== MissionState.INTAKE &&
        state !== MissionState.CLARIFYING
      ) {
        throw new TypeError(
          `Project understanding is unavailable while mission is ${state}.`,
        );
      }
      if (typeof intent !== "string" || intent.trim() === "") {
        throw new TypeError("Project intent must be non-empty.");
      }
      const current = latestProfile(ledger, missionId);
      const selection = router.select({
        taskDepth: PROJECT_UNDERSTANDING_DEPTH,
        requiredCapabilities: [
          {
            capability: ModelCapability.ARCHITECTURE,
            minimumScore: 60,
          },
          {
            capability: ModelCapability.STRUCTURED_OUTPUT,
            minimumScore: 80,
          },
        ],
        costConstraints: {
          maximumTotalPerMillionTokensUsd: null,
        },
        userPreferences: {
          priority: "FAST_RESPONSE",
          preferredLatencyProfile: LatencyProfile.FAST,
        },
      });
      const providerCatalog = providerRegistry.list();
      const persistedRouteHistory = routeHistory();
      let candidateRoutes = selection.eligibleModelIds
        .map((modelId) =>
          providerCatalog.find(
            (candidate) => candidate.modelId === modelId,
          ),
        )
        .filter(Boolean);
      candidateRoutes = candidateRoutes.filter(
        (route, index, routes) =>
          routes.findIndex(
            (candidate) => candidate.providerId === route.providerId,
          ) === index,
      );
      candidateRoutes = excludePermanentlyRejectedRoutes(
        candidateRoutes,
        persistedRouteHistory,
      );
      if (candidateRoutes.length === 0) {
        throw new Error(
          "No healthy project-understanding model remains after recorded model rejections.",
        );
      }
      const basePrimaryProvider = candidateRoutes[0]?.providerId;
      candidateRoutes = rankRoutesByPersistedTaskHistory(
        candidateRoutes,
        persistedRouteHistory,
        ModelTaskClass.PROJECT_UNDERSTANDING,
      );
      const historyAdjusted =
        candidateRoutes[0]?.providerId !== basePrimaryProvider;
      const request = {
        taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
        messages: [
          {
            role: "system",
            content:
              "You are Foundry's Project Understanding authority. Return a precise, domain-specific decision brief and observable verification plan as strict JSON.",
          },
          {
            role: "user",
            content: understandingPrompt(
              intent.trim(),
              answers,
              current,
            ),
          },
        ],
        schemaName: "foundry_project_understanding",
        schema: understandingSchema,
      };
      let response = null;
      let result = null;
      let profile = null;
      let selectedRoute = null;
      let failure = null;
      for (
        let routeIndex = 0;
        routeIndex < candidateRoutes.length;
        routeIndex += 1
      ) {
        const route = candidateRoutes[routeIndex];
        const routeAttempt = routeIndex + 1;
        const routeTimestamp = clock();
        const routingReason = [
          ...selection.rationale,
          routeAttempt === 1
            ? "primary eligible route"
            : `failover route ${routeAttempt} after the prior provider failed`,
          historyAdjusted
            ? "persisted project-understanding outcomes promoted a repeatedly successful provider over recent failures"
            : null,
        ].filter(Boolean).join("; ");
        const routeEvidence = evidence.capture({
          evidenceId: `${requestId}.route-${routeAttempt}`,
          missionId,
          kind: ObservationKind.MODEL_CALL_RESULT,
          captureMethod: "project-understanding-route-dispatch",
          producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
          timestamp: routeTimestamp,
          payload: {
            requestId,
            status: "STARTED",
            structuredOutput: null,
            detail: "A live project-understanding request was dispatched.",
          },
          workspaceCheckpointReference: null,
          commandReference: requestId,
          workUnitReference: requestId,
          metadata: {
            provider: route.providerId,
            modelId: route.modelId,
            providerFamily: route.providerFamily,
            taskClass: "PROJECT_UNDERSTANDING",
            depthLevel: PROJECT_UNDERSTANDING_DEPTH,
            routingReason,
            routeAttempt,
          },
        });
        modelFacts.recordResultFact({
          missionId,
          eventId: `${requestId}.route-${routeAttempt}.fact`,
          causationId,
          occurredAt: routeTimestamp,
          producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
          statement: `Dispatched project understanding to eligible live route ${routeAttempt}.`,
          evidenceReferences: [
            {
              evidenceId: routeEvidence.evidenceId,
              workspaceCheckpointReference: null,
            },
          ],
          workspaceCheckpointReference: null,
          workUnitReference: requestId,
          metadata: { modelRouteStart: routeEvidence.metadata },
        });
        try {
          const candidateResponse = await providerRegistry.generate(
            route.providerId,
            request,
            { modelId: route.modelId },
          );
          const candidateResult = validateStructuredModelOutput(
            candidateResponse.output,
            understandingSchema,
          );
          const candidateProfile = profileFromUnderstanding(
            missionId,
            candidateResult,
            (current?.profileVersion ?? 0) + 1,
          );
          response = candidateResponse;
          result = candidateResult;
          profile = candidateProfile;
          selectedRoute = {
            ...route,
            routeAttempt,
            routingReason,
            startTimestamp: routeTimestamp,
          };
          failure = null;
          break;
        } catch (error) {
          failure = error;
          const failedAt = clock();
          const failureDisposition = classifyModelRouteFailure(error);
          const failureEvidence = evidence.capture({
            evidenceId: `${requestId}.route-${routeAttempt}.failure`,
            missionId,
            kind: ObservationKind.MODEL_CALL_RESULT,
            captureMethod: "project-understanding-route-failure",
            producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
            timestamp: failedAt,
            payload: {
              requestId,
              status: "FAILED",
              structuredOutput: null,
              detail: String(error?.message ?? error).slice(0, 240),
            },
            workspaceCheckpointReference: null,
            commandReference: requestId,
            workUnitReference: requestId,
            metadata: {
              provider: route.providerId,
              modelId: route.modelId,
              providerFamily: route.providerFamily,
              taskClass: "PROJECT_UNDERSTANDING",
              depthLevel: PROJECT_UNDERSTANDING_DEPTH,
              routingReason,
              routeAttempt,
              failureCategory: failureDisposition.category,
              retryable: failureDisposition.retryable,
            },
          });
          facts.recordResultFact({
            missionId,
            eventId: `${requestId}.route-${routeAttempt}.failure.fact`,
            causationId,
            occurredAt: failedAt,
            producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
            statement: `Project-understanding route ${routeAttempt} failed safely.`,
            evidenceReferences: [
              {
                evidenceId: failureEvidence.evidenceId,
                workspaceCheckpointReference: null,
              },
            ],
            workspaceCheckpointReference: null,
            workUnitReference: requestId,
            metadata: {
              modelRouteFailure: {
                requestId,
                provider: route.providerId,
                providerFamily: route.providerFamily,
                modelId: route.modelId,
                taskClass: "PROJECT_UNDERSTANDING",
                depthLevel: PROJECT_UNDERSTANDING_DEPTH,
                routingReason,
                routeAttempt,
                failureCategory: failureDisposition.category,
                retryable: failureDisposition.retryable,
              },
            },
          });
        }
      }
      if (
        result === null ||
        profile === null ||
        response === null ||
        selectedRoute === null
      ) {
        throw failure ?? new Error("No live understanding route completed.");
      }
      const verificationBindings = Object.fromEntries(
        result.obligations.map((obligation, index) => [
          identifier("obligation", index),
          obligation.verificationMode,
        ]),
      );
      const occurredAt = clock();
      const evidenceId = `${requestId}.understanding`;
      evidence.capture({
        evidenceId,
        missionId,
        kind: ObservationKind.MODEL_CALL_RESULT,
        captureMethod: "live-provider-structured-project-understanding",
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        timestamp: occurredAt,
        payload: {
          requestId,
          status: "SUCCEEDED",
          structuredOutput: profile,
          detail: "Live model output validated as a ProjectProfile.",
        },
        metadata: {
          providerId: selectedRoute.providerId,
          modelId: selectedRoute.modelId,
          providerFamily: selectedRoute.providerFamily,
          routingRationale: selectedRoute.routingReason,
          depthLevel: PROJECT_UNDERSTANDING_DEPTH,
          tokenUsage: response.usage,
        },
        commandReference: requestId,
        workUnitReference: requestId,
      });
      const modelCallRecord = normalizeModelCallRecord({
        requestId,
        missionId,
        workUnitId: requestId,
        purpose: "Interpret project intent into a validated ProjectProfile.",
        taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
        modelId: selectedRoute.modelId,
        modelTier: PROJECT_UNDERSTANDING_TIER,
        provider: selectedRoute.providerId,
        providerFamily: selectedRoute.providerFamily,
        depthLevel: PROJECT_UNDERSTANDING_DEPTH,
        routingReason: selectedRoute.routingReason,
        idempotencyKey: `${requestId}-key`,
        contextReferences: [],
        expectedStructuredOutputSchema: understandingSchema,
        structuredOutput: result,
        tokenMetadata: {
          inputTokens: response.usage?.inputTokens ?? 0,
          outputTokens: response.usage?.outputTokens ?? 0,
        },
        costMetadata: {
          attemptCount: selectedRoute.routeAttempt,
          costUsd: response.usage?.costUsd ?? 0,
        },
        startTimestamp: selectedRoute.startTimestamp,
        endTimestamp: occurredAt,
        status: "SUCCEEDED",
      });
      modelFacts.recordResultFact({
        missionId,
        eventId: `${requestId}.model.fact`,
        causationId,
        occurredAt,
        producingSubsystem: MODEL_GATEWAY_SOURCE,
        statement:
          "Project-understanding model request completed with operational status SUCCEEDED.",
        evidenceReferences: [
          {
            evidenceId,
            workspaceCheckpointReference: null,
          },
        ],
        workspaceCheckpointReference: null,
        workUnitReference: requestId,
        metadata: { modelCallRecord },
      });
      facts.recordResultFact({
        missionId,
        eventId,
        causationId,
        producingSubsystem: PROJECT_UNDERSTANDING_SOURCE,
        statement: "Project intent interpreted into a validated profile.",
        evidenceReferences: [
          {
            evidenceId,
            workspaceCheckpointReference: null,
          },
        ],
        workUnitReference: requestId,
        metadata: {
          projectProfile: profile,
          verificationBindings,
          clarificationAnswers: structuredClone(answers),
        },
        occurredAt,
      });

      const afterFactState = ledger.projectState(missionId).state;
      if (
        profile.openQuestions.length > 0 &&
        afterFactState === MissionState.INTAKE
      ) {
        orchestrator.transition({
          missionId,
          eventId: `${eventId}.clarifying`,
          causationId: eventId,
          to: MissionState.CLARIFYING,
          reason:
            "The live ProjectProfile contains unresolved architecture-changing questions.",
        });
      } else if (
        profile.openQuestions.length === 0 &&
        afterFactState === MissionState.CLARIFYING
      ) {
        orchestrator.transition({
          missionId,
          eventId: `${eventId}.resolved`,
          causationId: eventId,
          to: MissionState.INTAKE,
          reason:
            "Live interpretation resolved all architecture-changing questions.",
        });
      }
      return Object.freeze({
        profile,
        experience: profiles.experience(profile),
        routing: selection,
      });
    },

    contract({ missionId, eventId, causationId }) {
      const profile = latestProfile(ledger, missionId);
      if (profile === null) {
        throw new TypeError("A recorded ProjectProfile is required.");
      }
      if (profile.openQuestions.length > 0) {
        throw new TypeError(
          "A contract cannot be created while architecture-changing questions remain unresolved.",
        );
      }
      if (profile.platform.toLowerCase() !== "web") {
        throw new TypeError(
          `Foundry does not yet support the requested platform "${profile.platform}".`,
        );
      }
      const draft = profiles.contractDraft(profile);
      const contract = contracts.createContract({
        missionId,
        eventId,
        causationId,
        contractVersion: draft.contractVersion,
        obligations: draft.obligations,
      });
      orchestrator.transition({
        missionId,
        eventId: `${eventId}.contracted`,
        causationId: eventId,
        to: MissionState.CONTRACTED,
        reason:
          "A valid model-derived Requirement Contract is recorded in the Mission Ledger.",
      });
      return contract;
    },
  });
}
