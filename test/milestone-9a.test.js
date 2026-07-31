import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  LatencyProfile,
  MODEL_CAPABILITIES,
  ModelCapability,
  ModelOutputValidationError,
  ModelStatus,
  ModelTaskClass,
  ProviderHealth,
  ProviderId,
  RoutingPriority,
  TaskDepth,
  TaskKind,
  classifyModelRouteFailure,
  createDeterministicLocalModelProvider,
  createEnvironmentService,
  createLiveAiAdapters,
  excludePermanentlyRejectedRoutes,
  normalizeProviderError,
  openMissionControl,
} from "../src/index.js";
import { rankRoutesByPersistedTaskHistory } from "../src/work-plane/model-gateway.js";

const clock = () => "2026-07-29T12:00:00.000Z";
const validEnvironment = Object.freeze({
  OPENAI_API_KEY: "sk-openai_fixture_123456789",
  ANTHROPIC_API_KEY: "sk-ant-anthropic_fixture_123456789",
  GOOGLE_API_KEY: "AIzaGoogle_fixture_123456789",
});

function temporaryControl(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "foundry-v2-ai-registry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    control: openMissionControl({
      ledgerDirectory: join(root, "ledger"),
      registryDirectory: join(root, "registry"),
      environmentVariables: validEnvironment,
      clock,
      ...options,
    }),
  };
}

function providerMetadata(providerId, overrides = {}) {
  return {
    providerId,
    displayName: {
      [ProviderId.OPENAI]: "OpenAI",
      [ProviderId.ANTHROPIC]: "Anthropic",
      [ProviderId.GOOGLE_GEMINI]: "Google Gemini",
    }[providerId],
    version: "fixture-adapter-v1",
    enabled: true,
    rateLimits: {
      requestsPerMinute: 100,
      tokensPerMinute: 100_000,
    },
    costMetadata: {
      currency: "USD",
      source: "deterministic-test-fixture",
    },
    ...overrides,
  };
}

function capabilityScores(overrides = {}) {
  return Object.fromEntries(
    MODEL_CAPABILITIES.map((capability) => [
      capability,
      overrides[capability] ?? 70,
    ]),
  );
}

function modelManifest({
  modelId,
  providerId,
  totalCost = 2,
  latencyProfile = LatencyProfile.BALANCED,
  scores = {},
  status = ModelStatus.AVAILABLE,
  enabled = true,
}) {
  const capabilities = capabilityScores(scores);
  return {
    modelId,
    providerId,
    displayName: `Discovered ${modelId}`,
    status,
    enabled,
    contextWindow: 128_000,
    supportsVision: capabilities[ModelCapability.VISION] > 0,
    supportsToolCalling:
      capabilities[ModelCapability.TOOL_CALLING] > 0,
    supportsStructuredOutput:
      capabilities[ModelCapability.STRUCTURED_OUTPUT] > 0,
    supportsReasoning: capabilities[ModelCapability.REASONING] > 0,
    supportsStreaming: true,
    latencyProfile,
    costProfile: {
      inputPerMillionTokensUsd: totalCost / 2,
      outputPerMillionTokensUsd: totalCost / 2,
    },
    capabilities,
  };
}

function registerHealthyProvider(
  control,
  providerId,
  suffix = providerId,
) {
  control.ai.providers.register({
    eventId: `provider-${suffix}`,
    metadata: providerMetadata(providerId),
  });
  control.ai.providers.recordHealth({
    eventId: `health-${suffix}`,
    providerId,
    observation: {
      health: ProviderHealth.HEALTHY,
      detail: "Deterministic provider-health fixture passed.",
    },
  });
}

function registerModels(
  control,
  providerId,
  models,
  suffix = providerId,
) {
  control.ai.models.registerDiscovery({
    eventId: `models-${suffix}`,
    discoveryId: `discovery-${suffix}`,
    providerId,
    discoveredModels: models,
  });
}

test("registers only supported providers and preserves provider metadata", (t) => {
  const { control } = temporaryControl(t);
  control.ai.providers.register({
    eventId: "provider-openai",
    metadata: providerMetadata(ProviderId.OPENAI),
  });

  const provider = control.ai.providers.get(ProviderId.OPENAI);
  assert.equal(provider.displayName, "OpenAI");
  assert.equal(provider.version, "fixture-adapter-v1");
  assert.equal(provider.rateLimits.requestsPerMinute, 100);
  assert.equal(provider.costMetadata.currency, "USD");
  assert.equal(provider.credential.valid, true);
  assert.equal(Object.isFrozen(provider), true);
  assert.throws(
    () =>
      control.ai.providers.register({
        eventId: "provider-unsupported",
        metadata: providerMetadata("other-provider"),
      }),
    /not supported/,
  );
});

test("loads environment centrally and detects missing and malformed keys", () => {
  const service = createEnvironmentService({
    environment: {
      OPENAI_API_KEY: validEnvironment.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: "bad key",
    },
  });

  assert.deepEqual(service.inspectProvider(ProviderId.OPENAI), {
    providerId: ProviderId.OPENAI,
    environmentVariable: "OPENAI_API_KEY",
    configured: true,
    valid: true,
    reason:
      "OPENAI_API_KEY is configured and format-valid.",
  });
  assert.equal(
    service.inspectProvider(ProviderId.ANTHROPIC).valid,
    false,
  );
  assert.match(
    service.inspectProvider(ProviderId.ANTHROPIC).reason,
    /must use/,
  );
  assert.equal(
    service.inspectProvider(ProviderId.GOOGLE_GEMINI).configured,
    false,
  );
  assert.throws(
    () =>
      service.withCredential(ProviderId.GOOGLE_GEMINI, () => null),
    /missing/,
  );
});

test("accepts current Gemini authorization keys without assuming a legacy prefix", () => {
  const service = createEnvironmentService({
    environment: {
      GOOGLE_API_KEY: "AQAuthorization_fixture_1234567890",
    },
  });

  assert.equal(
    service.inspectProvider(ProviderId.GOOGLE_GEMINI).valid,
    true,
  );
  assert.equal(
    createEnvironmentService({
      environment: { GOOGLE_API_KEY: "too-short" },
    }).inspectProvider(ProviderId.GOOGLE_GEMINI).valid,
    false,
  );
});

test(".env.example contains blank placeholders and local environment files are ignored", () => {
  assert.equal(
    readFileSync(new URL("../.env.example", import.meta.url), "utf8"),
    "OPENAI_API_KEY=\nANTHROPIC_API_KEY=\nGOOGLE_API_KEY=\n",
  );
  const ignore = readFileSync(
    new URL("../.gitignore", import.meta.url),
    "utf8",
  );
  assert.match(ignore, /^\.env$/m);
  assert.match(ignore, /^\.env\.\*$/m);
  assert.match(ignore, /^!\.env\.example$/m);
});

test("deterministic fixture execution stays behind the private Provider Registry boundary", (t) => {
  const fixture = createDeterministicLocalModelProvider({
    providerId: "private-fixture-provider",
    handler() {
      return {
        output: { result: "unused" },
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      };
    },
  });
  const { control } = temporaryControl(t, {
    modelProviders: [fixture],
  });

  assert.equal("execution" in control.ai, false);
  assert.deepEqual(Object.keys(control.models), ["request", "listCalls"]);
  assert.equal(
    JSON.stringify(control).includes("private-fixture-provider"),
    false,
  );
});

test("provider availability follows credential, enablement, and health", (t) => {
  const { control } = temporaryControl(t);
  registerHealthyProvider(control, ProviderId.OPENAI);
  assert.equal(
    control.ai.providers.get(ProviderId.OPENAI).availability.available,
    true,
  );

  control.ai.providers.setEnabled({
    eventId: "disable-openai",
    providerId: ProviderId.OPENAI,
    enabled: false,
    reason: "Exercise deterministic disable behavior.",
  });
  assert.equal(
    control.ai.providers.get(ProviderId.OPENAI).availability.available,
    false,
  );
  control.ai.providers.setEnabled({
    eventId: "enable-openai",
    providerId: ProviderId.OPENAI,
    enabled: true,
    reason: "Exercise deterministic re-enable behavior.",
  });
  assert.equal(
    control.ai.providers.get(ProviderId.OPENAI).availability.available,
    true,
  );
  assert.equal(
    control.ai.providers.get(ProviderId.OPENAI).history.length,
    4,
  );
});

test("registers dynamically discovered models and rejects duplicate model IDs", (t) => {
  const { control } = temporaryControl(t);
  registerHealthyProvider(control, ProviderId.ANTHROPIC);
  const model = modelManifest({
    modelId: "fixture-coding-model",
    providerId: ProviderId.ANTHROPIC,
  });
  registerModels(control, ProviderId.ANTHROPIC, [model]);

  assert.deepEqual(
    control.ai.models.get("fixture-coding-model").costProfile,
    model.costProfile,
  );
  assert.throws(
    () =>
      control.ai.models.registerDiscovery({
        eventId: "models-duplicate",
        discoveryId: "discovery-duplicate",
        providerId: ProviderId.ANTHROPIC,
        discoveredModels: [model],
      }),
    /already registered/,
  );
});

test("model discovery adapters are registry-owned and credentials are never persisted", async (t) => {
  let observedCredential = null;
  const { control } = temporaryControl(t, {
    aiDiscoveryAdapters: {
      [ProviderId.GOOGLE_GEMINI]: {
        async discoverModels({ credential }) {
          observedCredential = credential;
          return [
            modelManifest({
              modelId: "dynamically-returned-model",
              providerId: ProviderId.GOOGLE_GEMINI,
            }),
          ];
        },
      },
    },
  });
  registerHealthyProvider(control, ProviderId.GOOGLE_GEMINI);
  await control.ai.models.discover({
    eventId: "models-google",
    discoveryId: "discovery-google",
    providerId: ProviderId.GOOGLE_GEMINI,
  });

  assert.equal(observedCredential, validEnvironment.GOOGLE_API_KEY);
  assert.equal(
    control.ai.models.get("dynamically-returned-model").providerId,
    ProviderId.GOOGLE_GEMINI,
  );
  assert.equal(
    readFileSync(control.ai.registryPath, "utf8").includes(
      validEnvironment.GOOGLE_API_KEY,
    ),
    false,
  );
});

test("live discovery retains the provider catalogue without model-name tier inference", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "provider-model-one",
            display_name: "Provider Model One",
            max_input_tokens: 200_000,
            capabilities: {
              structured_outputs: { supported: true },
              thinking: { supported: true },
              image_input: { supported: true },
            },
          },
          {
            id: "provider-model-two",
            display_name: "Provider Model Two",
            max_input_tokens: 200_000,
            capabilities: {
              structured_outputs: { supported: true },
              thinking: { supported: true },
              image_input: { supported: true },
            },
          },
          {
            id: "provider-model-three",
            display_name: "Provider Model Three",
            max_input_tokens: 200_000,
            capabilities: {
              structured_outputs: { supported: true },
              thinking: { supported: true },
              image_input: { supported: true },
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  const adapters = createLiveAiAdapters({ environment: {} });
  const models =
    await adapters.discoveryAdapters[ProviderId.ANTHROPIC].discoverModels({
      credential: "not-persisted",
    });
  assert.deepEqual(
    models.map((model) => [model.modelId, model.latencyProfile]),
    [
      ["provider-model-one", LatencyProfile.BALANCED],
      ["provider-model-two", LatencyProfile.BALANCED],
      ["provider-model-three", LatencyProfile.BALANCED],
    ],
  );
});

test("model catalog refresh is append-only and replays the current tier catalogue", async (t) => {
  const replacement = modelManifest({
    modelId: "balanced-current",
    providerId: ProviderId.OPENAI,
    latencyProfile: LatencyProfile.BALANCED,
  });
  const discoveryAdapter = {
    async discoverModels() {
      return [replacement];
    },
  };
  const { root, control } = temporaryControl(t, {
    aiDiscoveryAdapters: {
      [ProviderId.OPENAI]: discoveryAdapter,
    },
  });
  registerHealthyProvider(control, ProviderId.OPENAI);
  registerModels(control, ProviderId.OPENAI, [
    modelManifest({
      modelId: "thorough-old",
      providerId: ProviderId.OPENAI,
      latencyProfile: LatencyProfile.THOROUGH,
    }),
  ]);
  await control.ai.models.refresh({
    eventId: "models-refresh-openai",
    discoveryId: "refresh-openai",
    providerId: ProviderId.OPENAI,
  });
  assert.deepEqual(
    control.ai.models.list({ providerId: ProviderId.OPENAI }).map(
      (model) => model.modelId,
    ),
    ["balanced-current"],
  );
  assert.match(
    readFileSync(control.ai.registryPath, "utf8"),
    /MODEL_CATALOG_REFRESHED/u,
  );

  const restarted = openMissionControl({
    ledgerDirectory: join(root, "ledger"),
    registryDirectory: join(root, "registry"),
    environmentVariables: validEnvironment,
    aiDiscoveryAdapters: {
      [ProviderId.OPENAI]: discoveryAdapter,
    },
    clock,
  });
  assert.equal(
    restarted.ai.models.get("balanced-current").latencyProfile,
    LatencyProfile.BALANCED,
  );
  assert.throws(
    () => restarted.ai.models.get("thorough-old"),
    /not registered/u,
  );
});

test("Capability Registry exposes the complete scorecard", (t) => {
  const { control } = temporaryControl(t);
  registerHealthyProvider(control, ProviderId.OPENAI);
  registerModels(control, ProviderId.OPENAI, [
    modelManifest({
      modelId: "capability-model",
      providerId: ProviderId.OPENAI,
      scores: { [ModelCapability.CODING]: 91 },
    }),
  ]);

  assert.deepEqual(
    [...control.ai.capabilities.list()].sort(),
    [...MODEL_CAPABILITIES].sort(),
  );
  assert.equal(
    control.ai.capabilities.score(
      "capability-model",
      ModelCapability.CODING,
    ),
    91,
  );
  assert.equal(
    Object.keys(
      control.ai.capabilities.forModel("capability-model"),
    ).length,
    MODEL_CAPABILITIES.length,
  );
});

test("routing selects the cheapest capable available model deterministically", (t) => {
  const { control } = temporaryControl(t);
  registerHealthyProvider(control, ProviderId.OPENAI);
  registerHealthyProvider(control, ProviderId.ANTHROPIC);
  registerModels(control, ProviderId.OPENAI, [
    modelManifest({
      modelId: "higher-cost-model",
      providerId: ProviderId.OPENAI,
      totalCost: 8,
      scores: {
        [ModelCapability.REASONING]: 90,
        [ModelCapability.CODING]: 90,
      },
    }),
  ]);
  registerModels(control, ProviderId.ANTHROPIC, [
    modelManifest({
      modelId: "lower-cost-model",
      providerId: ProviderId.ANTHROPIC,
      totalCost: 3,
      scores: {
        [ModelCapability.REASONING]: 80,
        [ModelCapability.CODING]: 85,
      },
    }),
  ]);
  const request = {
    taskDepth: TaskDepth.MULTI_FILE_ENGINEERING,
    requiredCapabilities: [
      { capability: ModelCapability.CODING, minimumScore: 80 },
    ],
    costConstraints: {
      maximumTotalPerMillionTokensUsd: 10,
    },
    userPreferences: {
      priority: RoutingPriority.BALANCED,
      preferredLatencyProfile: null,
    },
  };

  const first = control.ai.router.select(request);
  const second = control.ai.router.select(request);
  assert.equal(first.selectedModel.modelId, "lower-cost-model");
  assert.deepEqual(first, second);
  assert.deepEqual(first.eligibleModelIds, [
    "lower-cost-model",
    "higher-cost-model",
  ]);
});

test("routing rejects unavailable, non-available, incapable, and over-budget models", (t) => {
  const { control } = temporaryControl(t);
  control.ai.providers.register({
    eventId: "provider-openai",
    metadata: providerMetadata(ProviderId.OPENAI),
  });
  registerModels(control, ProviderId.OPENAI, [
    modelManifest({
      modelId: "ineligible-model",
      providerId: ProviderId.OPENAI,
      totalCost: 100,
      status: ModelStatus.DEGRADED,
      scores: {
        [ModelCapability.REASONING]: 10,
        [ModelCapability.ARCHITECTURE]: 10,
      },
    }),
  ]);

  assert.throws(
    () =>
      control.ai.router.select({
        taskDepth: TaskDepth.ARCHITECTURE,
        requiredCapabilities: [
          {
            capability: ModelCapability.ARCHITECTURE,
            minimumScore: 80,
          },
        ],
        costConstraints: {
          maximumTotalPerMillionTokensUsd: 20,
        },
        userPreferences: {
          priority: RoutingPriority.CAPABILITY,
          preferredLatencyProfile: LatencyProfile.THOROUGH,
        },
      }),
    /No registered model satisfies/,
  );
});

test("task kinds map deterministically to depths 1 through 5", (t) => {
  const { control } = temporaryControl(t);
  const expectations = [
    [TaskKind.RENAME, 1],
    [TaskKind.COMPILE_ERROR, 2],
    [TaskKind.DATABASE_WORK, 3],
    [TaskKind.LARGE_REFACTOR, 4],
    [TaskKind.LARGE_MIGRATION, 5],
  ];
  for (const [kind, depth] of expectations) {
    assert.equal(control.ai.router.classifyTaskDepth(kind), depth);
  }
  assert.throws(
    () => control.ai.router.classifyTaskDepth("FREE_TEXT_GUESS"),
    /not registered/,
  );
});

test("Prompt Builder constructs all sections in stable order", (t) => {
  const { control } = temporaryControl(t);
  const prompt = control.ai.prompts.build({
    system: "Foundry system boundary.",
    projectContext: { category: "web" },
    workspaceContext: { checkpointId: "cp-1" },
    requirementContract: { version: 1 },
    codingStandards: ["TypeScript"],
    currentFiles: [{ path: "app/page.tsx", hash: "abc" }],
    acceptanceCriteria: ["Build succeeds"],
  });

  assert.deepEqual(
    prompt.sections.map((section) => section.name),
    [
      "system",
      "projectContext",
      "workspaceContext",
      "requirementContract",
      "codingStandards",
      "currentFiles",
      "acceptanceCriteria",
    ],
  );
  assert.equal(Object.isFrozen(prompt.sections), true);
});

test("Context Builder assembles mission-scoped context without memory", (t) => {
  const { control } = temporaryControl(t);
  const context = control.ai.context.assemble({
    mission: { missionId: "mission-1" },
    workspace: { checkpointId: "checkpoint-1" },
    stack: { stackId: "web-stack" },
    contract: { contractId: "contract-1", version: 1 },
    relevantFiles: [{ path: "package.json", hash: "def" }],
  });

  assert.equal(context.mission.missionId, "mission-1");
  assert.equal(context.relevantFiles[0].path, "package.json");
  assert.equal("memory" in context, false);
  assert.equal(Object.isFrozen(context.contract), true);
});

test("Model Response Validator accepts schema-conforming JSON", (t) => {
  const { control } = temporaryControl(t);
  const schema = {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    },
    required: ["files"],
    additionalProperties: false,
  };

  assert.deepEqual(
    control.ai.responses.validate(
      '{"files":[{"path":"app/page.tsx"}]}',
      schema,
    ),
    { files: [{ path: "app/page.tsx" }] },
  );
});

test("Model Response Validator rejects empty, malformed, and schema-invalid output", (t) => {
  const { control } = temporaryControl(t);
  const schema = {
    type: "object",
    properties: { result: { type: "string" } },
    required: ["result"],
    additionalProperties: false,
  };

  for (const response of ["", "{bad-json", {}, { other: true }]) {
    assert.throws(
      () => control.ai.responses.validate(response, schema),
      ModelOutputValidationError,
    );
  }
});

test("provider errors normalize without leaking provider response text", () => {
  const secretBearingError = Object.assign(
    new Error("upstream leaked secret-value"),
    { status: 429, code: "RATE_LIMITED" },
  );
  const normalized = normalizeProviderError(
    secretBearingError,
    ProviderId.OPENAI,
  );
  assert.deepEqual(normalized, {
    providerId: ProviderId.OPENAI,
    category: "RATE_LIMIT",
    code: "RATE_LIMITED",
    retryable: true,
    message: 'Provider "openai" request failed (RATE_LIMIT).',
  });
  assert.equal(JSON.stringify(normalized).includes("secret-value"), false);
});

test("registry replays providers, models, health, and enablement after restart", (t) => {
  const { root, control } = temporaryControl(t);
  registerHealthyProvider(control, ProviderId.OPENAI);
  registerModels(control, ProviderId.OPENAI, [
    modelManifest({
      modelId: "replayed-model",
      providerId: ProviderId.OPENAI,
    }),
  ]);
  control.ai.providers.setEnabled({
    eventId: "disable-before-restart",
    providerId: ProviderId.OPENAI,
    enabled: false,
    reason: "Persist disablement before restart.",
  });

  const reopened = openMissionControl({
    ledgerDirectory: join(root, "ledger"),
    registryDirectory: join(root, "registry"),
    environmentVariables: validEnvironment,
    clock,
  });
  assert.equal(
    reopened.ai.providers.get(ProviderId.OPENAI).enabled,
    false,
  );
  assert.equal(
    reopened.ai.models.get("replayed-model").discoveryId,
    "discovery-openai",
  );
  assert.equal(reopened.ai.listRegistryEvents().length, 4);
});

test("restart detects persisted AI registry tampering", (t) => {
  const { root, control } = temporaryControl(t);
  registerHealthyProvider(control, ProviderId.OPENAI);
  const persisted = readFileSync(control.ai.registryPath, "utf8");
  writeFileSync(
    control.ai.registryPath,
    persisted.replace("OpenAI", "Altered"),
    "utf8",
  );

  assert.throws(
    () => {
      const reopened = openMissionControl({
        ledgerDirectory: join(root, "ledger"),
        registryDirectory: join(root, "registry"),
        environmentVariables: validEnvironment,
        clock,
      });
      reopened.ai.providers.get(ProviderId.OPENAI);
    },
    /integrity validation/,
  );
});

function phaseOneUnderstandingOutput(legacy) {
  const actors = legacy.audiences ?? legacy.primaryActors;
  const primaryJourney = legacy.primaryJourneys[0];
  const primaryCapability = legacy.proposedFeatures[0];
  return {
    name: legacy.name,
    family: legacy.family,
    platform: legacy.platform,
    projectIntent: {
      customerOutcome: `${legacy.summary} Customers can complete the intended account workflow confidently.`,
      businessContext: "The business needs customers to understand sensitive account activity without support staff explaining every update.",
      intendedUsers: actors,
      primaryGoal: "Let customers review recent account activity and understand what changed without contacting support.",
      secondaryGoals: ["Reduce avoidable account-status support questions."],
      successDefinition: "A customer can sign in, identify the newest activity, and understand its status without assistance.",
      constraints: legacy.constraints,
      confidence: { score: 0.86, rationale: "The requested audience and account-review outcome are explicit." },
    },
    userExperiencePlan: {
      primaryJourneys: legacy.primaryJourneys,
      secondaryJourneys: ["A customer returns later to compare newer account activity."],
      criticalMoments: ["The customer first sees whether recent activity needs attention."],
      failureStates: ["Access is refused clearly when customer details do not match."],
      trustMoments: ["Sensitive activity is explained without exposing another customer's records."],
      repeatedTasks: ["Review the newest account activity."],
      adminResponsibilities: ["Maintain accurate customer activity records."],
    },
    productProposal: {
      essentialCapabilities: legacy.proposedFeatures,
      recommendedCapabilities: legacy.includedDefaults,
      intentionallyExcludedCapabilities: ["Staff account administration is outside this customer-facing first version."],
      futureCapabilities: ["Customer-controlled notification preferences."],
      rationale: "The first version centers the recurring account-review task and avoids unrelated administration work.",
      dependencies: ["A reliable source of customer account activity."],
      scopeImpact: "This keeps the first release focused on trustworthy customer self-service.",
    },
    designDirection: {
      visualPersonality: legacy.designDirection.recommendedStyle,
      tone: legacy.designDirection.tone,
      layoutStrategy: legacy.designDirection.layoutApproach,
      informationDensity: "Show the newest activity first with details available on demand.",
      navigationApproach: "Keep account overview and activity history within one predictable customer path.",
      responsivePriority: legacy.designDirection.mobilePriority,
      accessibilityNeeds: legacy.designDirection.accessibilityConsiderations,
      contentStrategy: "Use plain status language and explain the consequence of each account event.",
      interactionStyle: "Prefer direct review actions with immediate, reassuring feedback.",
      rationale: legacy.designDirection.reason,
    },
    designAlternatives: [
      {
        name: legacy.designDirection.recommendedStyle,
        description: "A calm account workspace leads customers from recent activity to the next appropriate action.",
        whyItFits: "Customers reviewing sensitive account activity need clarity and trust before taking the next action.",
        layoutApproach: "A focused account overview with the newest activity and status first.",
        visualPersonality: legacy.designDirection.recommendedStyle,
        informationDensity: "Moderate density with details available on demand",
        navigationApproach: "A shallow path from account overview to activity detail",
        mobileBehavior: "Recent activity and its status remain first on small screens",
        tradeoff: "Uses less decorative storytelling to preserve fast account comprehension.",
        confidence: { score: 0.92, rationale: "The recurring account review workflow strongly favors calm evidence-led presentation." },
        recommended: true,
        preview: {
          typographyCharacter: "Measured and highly legible",
          spacingDensity: "Balanced account-review spacing",
          colorMood: "Quiet trustworthy neutrals",
          hierarchy: "Recent activity first, status second, evidence third",
        },
      },
      {
        name: "Guided account explanation",
        description: "A stepwise account journey explains each recent activity item before presenting available actions.",
        whyItFits: "Customers unfamiliar with account events may need additional explanation before trusting a recorded status.",
        layoutApproach: "A guided sequence from account summary through dated activity evidence.",
        visualPersonality: "Guided, reassuring, and explanatory",
        informationDensity: "Low density with progressive explanation",
        navigationApproach: "A stepwise path through each account activity explanation",
        mobileBehavior: "Explanations become a focused vertical reading sequence",
        tradeoff: "Experienced customers take longer to reach repeated review actions.",
        confidence: { score: 0.78, rationale: "First-time account review benefits from explicit status explanation." },
        recommended: false,
        preview: {
          typographyCharacter: "Friendly explanatory headings",
          spacingDensity: "Open guided spacing",
          colorMood: "Warm reassuring neutrals",
          hierarchy: "Explanation first, evidence second, action third",
        },
      },
      {
        name: "Dense account activity desk",
        description: "A compact account workspace places several recent activity records into one scannable operational view.",
        whyItFits: "Frequent customers comparing several account events can identify changes without unnecessary navigation or explanation.",
        layoutApproach: "A compact comparison workspace grouped by account activity status.",
        visualPersonality: "Dense, efficient, and operational",
        informationDensity: "High density with scannable activity rows",
        navigationApproach: "Activity-first navigation across related account records",
        mobileBehavior: "Comparison rows collapse into prioritized activity summaries",
        tradeoff: "The denser presentation requires greater familiarity from first-time customers.",
        confidence: { score: 0.7, rationale: "Frequent account review may reward faster comparison." },
        recommended: false,
        preview: {
          typographyCharacter: "Compact utilitarian labels",
          spacingDensity: "Tight operational spacing",
          colorMood: "Cool focused neutrals",
          hierarchy: "Activity list first, change second, action third",
        },
      },
    ],
    foundryInsights: {
      observations: legacy.observations,
      opportunities: ["Explain unusual account events before they become support calls."],
      risks: ["Customers may distrust activity that lacks a date, source, or clear status."],
      ambiguities: legacy.importantDecisions.map((decision) => decision.prompt),
      assumptions: legacy.assumptions,
      confidence: { score: 0.82, rationale: "The main review journey is clear while access choice may still need confirmation." },
    },
    decisions: legacy.importantDecisions.map((decision) => ({
      customerFriendlyQuestion: decision.prompt,
      whyItMatters: decision.reason,
      recommendation: decision.answerOptions[0],
      recommendationReason: "It gives customers a familiar access path while keeping recovery understandable.",
      alternatives: [...decision.answerOptions, "Staff-assisted account access"].slice(0, 3),
      consequenceOfEachChoice: [...decision.answerOptions, "Staff-assisted account access"].slice(0, 3).map((option) => `${option} changes how customers receive and recover account access.`),
      canFoundryDecide: false,
      architectureImpact: "The access choice changes identity and recovery responsibilities.",
      scopeImpact: "The choice changes initial setup and account-support work.",
    })),
    recommendations: [
      {
        title: legacy.recommendations[0]?.label ?? "Account activity timeline",
        specificValue: `${legacy.recommendations[0]?.rationale ?? "Makes recent customer activity easy to review."} It keeps the newest account activity easy to identify.`,
        whyThisProjectNeedsIt: "Customers reviewing sensitive account activity need chronology and status context to trust what they see.",
        impact: "Adds focused interface scope without a new external integration.",
        selectedByDefault: true,
        confidence: { score: 0.9, rationale: "The recurring review journey directly benefits from chronological context." },
        requiredDependencies: ["Customer account activity records"],
      },
      {
        title: "Explain unusual account events",
        specificValue: "Highlights an unusual account event and explains its likely consequence before the customer asks for help.",
        whyThisProjectNeedsIt: "Customers reviewing sensitive account activity need unfamiliar events explained before they can trust the current status.",
        impact: "Adds bounded explanation content using existing account activity records.",
        selectedByDefault: true,
        confidence: { score: 0.86, rationale: "Unfamiliar account events are a predictable source of support questions." },
        requiredDependencies: ["Customer account activity records"],
      },
      {
        title: "Show the responsible support owner",
        specificValue: "Names who can resolve an account activity exception when the customer cannot continue through self-service.",
        whyThisProjectNeedsIt: "Customers need a trustworthy next step when an account activity exception cannot be resolved in the portal.",
        impact: "Adds clear ownership content without expanding account administration scope.",
        selectedByDefault: true,
        confidence: { score: 0.84, rationale: "The bounded exception path needs visible ownership." },
        requiredDependencies: ["Customer support ownership records"],
      },
    ],
    verificationPlan: legacy.obligations.map((obligation) => ({
      observableOutcome: `${primaryCapability} ${obligation.statement}`,
      acceptanceMethod: obligation.verificationMode,
      evidenceRequired: ["Recorded verification evidence for the observable customer outcome"],
      sourceRequirement: "customer-intent-1",
      origin: obligation.origin,
      dependencyIndexes: obligation.dependencyIndexes,
    })),
    capabilities: legacy.capabilities,
    dataConcepts: legacy.dataConcepts,
    architectureDecisions: legacy.architectureDecisions,
    customerSuppliedContent: legacy.customerSuppliedContent,
    missingCustomerContent: legacy.missingCustomerContent,
  };
}

test("project understanding records a canonical model call and replays safely", async (t) => {
  const fixture = createDeterministicLocalModelProvider({
    providerId: ProviderId.OPENAI,
    providerFamily: "GPT",
    modelId: "understanding-fixture",
    handler() {
      return {
        output: phaseOneUnderstandingOutput({
          name: "Customer portal",
          summary: "A secure portal for customers to review account activity.",
          family: "web-application",
          platform: "web",
          audiences: ["Customer"],
          primaryJourneys: [
            "A customer signs in and reviews recent account activity.",
          ],
          designDirection: {
            recommendedStyle: "Calm and trustworthy",
            reason:
              "Customers need to understand sensitive account activity without distraction.",
            layoutApproach:
              "A focused account overview with the newest activity first.",
            tone: "Clear and reassuring",
            mobilePriority:
              "Keep the activity overview readable on smaller screens.",
            accessibilityConsiderations: [
              "Use visible focus, readable contrast, and clear activity labels.",
            ],
          },
          proposedFeatures: [
            "Customers can review their account activity.",
          ],
          includedDefaults: [
            "Clear loading, empty, and error states",
          ],
          recommendations: [
            {
              label: "Account activity timeline",
              rationale: "Makes recent customer activity easy to review.",
            },
          ],
          importantDecisions: [
            {
              prompt: "How should customers sign in?",
              reason: "This changes how customers get and recover access.",
              answerOptions: ["Email and password", "Single sign-on"],
            },
          ],
          assumptions: [
            "Customers should see their newest account activity first.",
          ],
          primaryActors: ["Customer"],
          outcomes: ["Customers can review their account activity."],
          capabilities: ["web-application", "typescript"],
          dataConcepts: ["Customer account"],
          constraints: ["Use the certified web stack."],
          architectureDecisions: ["Use server-rendered authenticated pages."],
          observations: [
            "Customers need to understand recent account activity at a glance.",
          ],
          designAlternatives: [],
          openQuestions: [
            {
              prompt: "How should customers authenticate?",
              reason: "Authentication changes security architecture.",
              answerOptions: ["Email and password", "Single sign-on"],
            },
          ],
          contextualSuggestions: [
            {
              label: "Account activity timeline",
              rationale: "Makes recent customer activity easy to review.",
            },
          ],
          customerSuppliedContent: [
            {
              kind: "other",
              value: "customer portal",
            },
          ],
          missingCustomerContent: [],
          obligations: [
            {
              statement: "The application builds successfully.",
              origin: "foundry-derived",
              verificationMode: "production-build",
              dependencyIndexes: [],
              outcomeIndexes: [1],
            },
          ],
        }),
        usage: { inputTokens: 20, outputTokens: 40, costUsd: 0 },
      };
    },
  });
  const { control } = temporaryControl(t, {
    modelProviders: [fixture],
  });
  registerHealthyProvider(control, ProviderId.OPENAI);
  registerModels(control, ProviderId.OPENAI, [
    modelManifest({
      modelId: "fast-understanding-fixture",
      providerId: ProviderId.OPENAI,
      latencyProfile: LatencyProfile.FAST,
      scores: {
        [ModelCapability.ARCHITECTURE]: 70,
        [ModelCapability.STRUCTURED_OUTPUT]: 100,
        [ModelCapability.REASONING]: 70,
      },
    }),
    modelManifest({
      modelId: "understanding-fixture",
      providerId: ProviderId.OPENAI,
      scores: {
        [ModelCapability.ARCHITECTURE]: 90,
        [ModelCapability.STRUCTURED_OUTPUT]: 100,
        [ModelCapability.REASONING]: 90,
      },
    }),
  ]);
  const discoverySelection = control.ai.router.select({
    taskDepth: TaskDepth.STANDARD_CODING,
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
    costConstraints: { maximumTotalPerMillionTokensUsd: null },
    userPreferences: {
      priority: "FAST_RESPONSE",
      preferredLatencyProfile: LatencyProfile.FAST,
    },
  });
  assert.equal(
    discoverySelection.selectedModel.modelId,
    "fast-understanding-fixture",
  );
  control.orchestrator.createMission({
    missionId: "understanding-replay",
    eventId: "understanding-replay-created",
    causationId: "understanding-replay-intent",
    reason: "Customer requested: Build a customer portal",
  });

  await control.understanding.understand({
    missionId: "understanding-replay",
    intent: "Build a customer portal",
    requestId: "understanding-replay-request",
    eventId: "understanding-replay-profile",
    causationId: "understanding-replay-intent",
  });

  assert.equal(
    control.ledger.projectState("understanding-replay").state,
    "CLARIFYING",
  );
  const [call] = control.models.listCalls("understanding-replay");
  assert.equal(call.taskClass, ModelTaskClass.PROJECT_UNDERSTANDING);
  assert.equal(call.status, "SUCCEEDED");
  // The fixture adapter exposes one executable model identity. The direct
  // router assertion above proves that a live multi-model provider selects
  // the FAST candidate.
  assert.equal(call.modelId, "understanding-fixture");
  assert.equal(call.depthLevel, TaskDepth.ARCHITECTURE);
  assert.equal(call.modelTier, "ARCHITECTURE");
});

test("project understanding corrects superficially valid output before provider failover", async (t) => {
  let firstInvalidAttempts = 0;
  let secondInvalidAttempts = 0;
  let validAttempts = 0;
  const output = (primaryActors) => phaseOneUnderstandingOutput({
    name: "Customer portal",
    summary: "A secure portal for customers to review account activity.",
    family: "web-application",
    platform: "web",
    audiences: primaryActors,
    primaryJourneys: [
      "A customer signs in and reviews recent account activity.",
    ],
    designDirection: {
      recommendedStyle: "Calm and trustworthy",
      reason:
        "Customers need to understand sensitive account activity without distraction.",
      layoutApproach:
        "A focused account overview with the newest activity first.",
      tone: "Clear and reassuring",
      mobilePriority:
        "Keep the activity overview readable on smaller screens.",
      accessibilityConsiderations: [
        "Use visible focus, readable contrast, and clear activity labels.",
      ],
    },
    proposedFeatures: [
      "Customers can review their account activity.",
    ],
    includedDefaults: ["Clear loading, empty, and error states"],
    recommendations: [
      {
        label: "Account activity timeline",
        rationale: "Makes recent customer activity easy to review.",
      },
    ],
    importantDecisions: [],
    assumptions: [
      "Customers should see their newest account activity first.",
    ],
    primaryActors,
    outcomes: ["Customers can review their account activity."],
    capabilities: ["web-application", "typescript"],
    dataConcepts: ["Customer account"],
    constraints: ["Use the certified web stack."],
    architectureDecisions: ["Use server-rendered authenticated pages."],
    observations: [
      "Customers need to understand recent account activity at a glance.",
    ],
    designAlternatives: [],
    openQuestions: [],
    contextualSuggestions: [
      {
        label: "Account activity timeline",
        rationale: "Makes recent customer activity easy to review.",
      },
    ],
    customerSuppliedContent: [
      {
        kind: "other",
        value: "Customer portal",
      },
    ],
    missingCustomerContent: [],
    obligations: [
      {
        statement: "The application builds successfully.",
        origin: "foundry-derived",
        verificationMode: "production-build",
        dependencyIndexes: [],
        outcomeIndexes: [1],
      },
    ],
  });
  const invalidProvider = createDeterministicLocalModelProvider({
    providerId: ProviderId.ANTHROPIC,
    providerFamily: "Claude",
    modelId: "a-invalid-understanding",
    handler() {
      firstInvalidAttempts += 1;
      return {
        output: output([":"]),
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      };
    },
  });
  const secondInvalidProvider = createDeterministicLocalModelProvider({
    providerId: ProviderId.GOOGLE_GEMINI,
    providerFamily: "Gemini",
    modelId: "b-invalid-understanding",
    handler() {
      secondInvalidAttempts += 1;
      return {
        output: output([":"]),
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      };
    },
  });
  const validProvider = createDeterministicLocalModelProvider({
    providerId: ProviderId.OPENAI,
    providerFamily: "GPT",
    modelId: "c-valid-understanding",
    handler() {
      validAttempts += 1;
      return {
        output: output(["Customer"]),
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      };
    },
  });
  const { control } = temporaryControl(t, {
    modelProviders: [
      invalidProvider,
      secondInvalidProvider,
      validProvider,
    ],
  });
  for (const providerId of [
    ProviderId.ANTHROPIC,
    ProviderId.GOOGLE_GEMINI,
    ProviderId.OPENAI,
  ]) {
    registerHealthyProvider(control, providerId);
  }
  registerModels(control, ProviderId.ANTHROPIC, [
    modelManifest({
      modelId: "a-invalid-understanding",
      providerId: ProviderId.ANTHROPIC,
      scores: {
        [ModelCapability.ARCHITECTURE]: 90,
        [ModelCapability.STRUCTURED_OUTPUT]: 100,
        [ModelCapability.REASONING]: 90,
      },
    }),
  ]);
  registerModels(control, ProviderId.GOOGLE_GEMINI, [
    modelManifest({
      modelId: "b-invalid-understanding",
      providerId: ProviderId.GOOGLE_GEMINI,
      scores: {
        [ModelCapability.ARCHITECTURE]: 90,
        [ModelCapability.STRUCTURED_OUTPUT]: 100,
        [ModelCapability.REASONING]: 90,
      },
    }),
  ]);
  registerModels(control, ProviderId.OPENAI, [
    modelManifest({
      modelId: "c-valid-understanding",
      providerId: ProviderId.OPENAI,
      scores: {
        [ModelCapability.ARCHITECTURE]: 90,
        [ModelCapability.STRUCTURED_OUTPUT]: 100,
        [ModelCapability.REASONING]: 90,
      },
    }),
  ]);
  control.orchestrator.createMission({
    missionId: "understanding-domain-failover",
    eventId: "understanding-domain-failover-created",
    causationId: "understanding-domain-failover-intent",
    reason: "Customer requested: Build a customer portal",
  });

  await control.understanding.understand({
    missionId: "understanding-domain-failover",
    intent: "Build a customer portal",
    requestId: "understanding-domain-failover-request",
    eventId: "understanding-domain-failover-profile",
    causationId: "understanding-domain-failover-intent",
  });

  assert.equal(firstInvalidAttempts, 3);
  assert.equal(secondInvalidAttempts, 3);
  assert.equal(validAttempts, 1);
  assert.equal(
    control.models.listCalls("understanding-domain-failover")[0].modelId,
    "c-valid-understanding",
  );
  assert.equal(
    control.evidence
      .findByMission("understanding-domain-failover")
      .some(
        (record) =>
          record.captureMethod === "project-understanding-route-failure",
      ),
    true,
  );
});

test("permanent model rejection is classified and removed from future routes", () => {
  const disposition = classifyModelRouteFailure(
    "google-gemini request failed: This model models/gemini-old is no longer available to new users.",
  );
  assert.deepEqual(disposition, {
    category: "MODEL_UNAVAILABLE",
    retryable: false,
  });
  assert.deepEqual(
    excludePermanentlyRejectedRoutes(
      [
        {
          providerId: ProviderId.GOOGLE_GEMINI,
          modelId: "gemini-old",
        },
        {
          providerId: ProviderId.OPENAI,
          modelId: "gpt-current",
        },
      ],
      [
        {
          kind: "failure",
          providerId: ProviderId.GOOGLE_GEMINI,
          modelId: "gemini-old",
          failureCategory: "MODEL_UNAVAILABLE",
          retryable: false,
        },
      ],
    ).map((route) => route.modelId),
    ["gpt-current"],
  );
});

test("a background-only API agent is excluded from synchronous model work", () => {
  const error = new Error(
    "google-gemini request failed: background=true is required for agent interactions.",
  );
  error.status = 400;

  assert.deepEqual(classifyModelRouteFailure(error), {
    category: "MODEL_UNAVAILABLE",
    retryable: false,
  });
});

test("persisted routing outcomes demote the failed model, not every model from its provider", () => {
  const routes = [
    {
      providerId: ProviderId.ANTHROPIC,
      modelId: "new-model-that-timed-out",
    },
    {
      providerId: ProviderId.ANTHROPIC,
      modelId: "other-live-model",
    },
    {
      providerId: ProviderId.OPENAI,
      modelId: "openai-live-model",
    },
  ];
  const ranked = rankRoutesByPersistedTaskHistory(
    routes,
    [
      {
        kind: "failure",
        requestId: "request-1",
        providerId: ProviderId.ANTHROPIC,
        modelId: "new-model-that-timed-out",
        taskClass: ModelTaskClass.PROJECT_UNDERSTANDING,
      },
    ],
    ModelTaskClass.PROJECT_UNDERSTANDING,
  );

  assert.equal(ranked.at(-1).modelId, "new-model-that-timed-out");
  assert.deepEqual(
    ranked.slice(0, 2).map((route) => route.modelId),
    ["other-live-model", "openai-live-model"],
  );
});
