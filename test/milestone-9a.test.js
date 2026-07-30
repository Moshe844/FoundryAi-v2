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

test("live discovery exposes task-tier candidates instead of one arbitrary model", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: [
          {
            id: "claude-opus-current",
            display_name: "Claude Opus Current",
            max_input_tokens: 200_000,
            capabilities: {
              structured_outputs: { supported: true },
              thinking: { supported: true },
              image_input: { supported: true },
            },
          },
          {
            id: "claude-sonnet-current",
            display_name: "Claude Sonnet Current",
            max_input_tokens: 200_000,
            capabilities: {
              structured_outputs: { supported: true },
              thinking: { supported: true },
              image_input: { supported: true },
            },
          },
          {
            id: "claude-haiku-current",
            display_name: "Claude Haiku Current",
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
      ["claude-haiku-current", LatencyProfile.FAST],
      ["claude-sonnet-current", LatencyProfile.BALANCED],
      ["claude-opus-current", LatencyProfile.THOROUGH],
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

test("project understanding records a canonical model call and replays safely", async (t) => {
  const fixture = createDeterministicLocalModelProvider({
    providerId: ProviderId.OPENAI,
    providerFamily: "GPT",
    modelId: "understanding-fixture",
    handler() {
      return {
        output: {
          name: "Customer portal",
          summary: "A secure portal for customers to review account activity.",
          family: "web-application",
          platform: "web",
          primaryActors: ["Customer"],
          outcomes: ["Customers can review their account activity."],
          capabilities: ["web-application", "typescript"],
          dataConcepts: ["Customer account"],
          constraints: ["Use the certified web stack."],
          architectureDecisions: ["Use server-rendered authenticated pages."],
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
          obligations: [
            {
              statement: "The application builds successfully.",
              origin: "foundry-derived",
              verificationMode: "production-build",
              dependencyIndexes: [],
            },
          ],
        },
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
  assert.equal(call.depthLevel, TaskDepth.STANDARD_CODING);
  assert.equal(call.modelTier, "STANDARD_ENGINEERING");
});

test("project understanding fails over when structured output is only superficially valid", async (t) => {
  let firstInvalidAttempts = 0;
  let secondInvalidAttempts = 0;
  let validAttempts = 0;
  const output = (primaryActors) => ({
    name: "Customer portal",
    summary: "A secure portal for customers to review account activity.",
    family: "web-application",
    platform: "web",
    primaryActors,
    outcomes: ["Customers can review their account activity."],
    capabilities: ["web-application", "typescript"],
    dataConcepts: ["Customer account"],
    constraints: ["Use the certified web stack."],
    architectureDecisions: ["Use server-rendered authenticated pages."],
    openQuestions: [],
    contextualSuggestions: [
      {
        label: "Account activity timeline",
        rationale: "Makes recent customer activity easy to review.",
      },
    ],
    obligations: [
      {
        statement: "The application builds successfully.",
        origin: "foundry-derived",
        verificationMode: "production-build",
        dependencyIndexes: [],
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

  assert.equal(firstInvalidAttempts, 1);
  assert.equal(secondInvalidAttempts, 1);
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
