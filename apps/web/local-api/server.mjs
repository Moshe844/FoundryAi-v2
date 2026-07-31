import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  ProviderHealth,
  ProviderId,
  MODEL_GOVERNANCE_POLICY,
  WEB_STACK_MANIFEST,
  createLiveAiAdapters,
  createModelLifecycleSourceService,
  openMissionControl,
  projectRequirementContract,
  normalizeCustomerFollowUpAnswers,
} from "../../../src/index.js";
import { projectDecisionHistory } from "./decision-history.mjs";
import { projectDiscoveryConversation } from "./discovery-conversation.mjs";
import { projectExecutionProjection } from "./execution-projection.mjs";
import {
  projectIsDeleted,
  recordProjectDeletion,
} from "./project-deletion.mjs";
import {
  executionRecoveryDecision,
  understandingRecoveryDecision,
} from "./understanding-recovery.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const stateRoot = resolve(repositoryRoot, ".foundry/customer");
const missionWorkerPath = resolve(here, "mission-worker.mjs");
const port = Number(process.env.FOUNDRY_LOCAL_API_PORT ?? 3927);

function parseEnvironment(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[name] = value;
  }
  return result;
}

const configuredEnvironment = {
  ...parseEnvironment(resolve(repositoryRoot, ".env")),
  ...process.env,
};
if (
  !configuredEnvironment.GOOGLE_API_KEY &&
  configuredEnvironment.GEMINI_API_KEY
) {
  configuredEnvironment.GOOGLE_API_KEY =
    configuredEnvironment.GEMINI_API_KEY;
}
mkdirSync(stateRoot, { recursive: true });
const lifecycleSourceService = createModelLifecycleSourceService({
  cachePath: resolve(stateRoot, "registry/ai/model-lifecycle-source-cache.json"),
});
const liveAdapters = createLiveAiAdapters({
  environment: configuredEnvironment,
  lifecycleSourceService,
});
const control = openMissionControl({
  ledgerDirectory: resolve(stateRoot, "ledger"),
  evidenceDirectory: resolve(stateRoot, "evidence"),
  workspaceDirectory: resolve(stateRoot, "workspaces"),
  registryDirectory: resolve(stateRoot, "registry"),
  environmentVariables: configuredEnvironment,
  aiDiscoveryAdapters: liveAdapters.discoveryAdapters,
  modelProviders: liveAdapters.executionAdapters,
  maxModelProviderAttempts: 3,
});
const activeJobs = new Map();
const activeUnderstandingJobs = new Map();

// Build the persisted route index before serving requests. Subsequent reads
// reparse only ledger files that changed, keeping project creation responsive.
control.catalogue.modelRouteHistory();

function startUnderstandingJob({
  missionId,
  intent,
  answers = [],
  profileVersion,
  causationId,
}) {
  const existing = activeUnderstandingJobs.get(missionId);
  if (existing?.active === true) return existing;
  const firstCustomerAttempt =
    existing === undefined &&
    causationId === `${missionId}-customer-intent`;
  const retrySuffix = firstCustomerAttempt
    ? ""
    : `-retry-${Date.now()}`;
  const job = {
    active: true,
    error: null,
    startedAt: new Date().toISOString(),
  };
  activeUnderstandingJobs.set(missionId, job);
  void control.understanding
    .understand({
      missionId,
      intent,
      answers,
      requestId: `${missionId}-understanding-${profileVersion}${retrySuffix}`,
      eventId: `${missionId}-profile-${profileVersion}`,
      causationId,
    })
    .then(() => {
      activeUnderstandingJobs.delete(missionId);
    })
    .catch((error) => {
      job.active = false;
      job.error = String(error?.message ?? error).slice(0, 500);
    });
  return job;
}

function startMissionWorker(missionId) {
  const child = spawn(
    process.execPath,
    ["--use-system-ca", missionWorkerPath, missionId],
    {
      cwd: repositoryRoot,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  const job = { child, error: null, completed: false };
  child.on("message", (message) => {
    if (message?.type === "failed") {
      job.error = String(message.error).slice(0, 500);
    }
    if (message?.type === "completed") {
      job.completed = true;
    }
  });
  child.once("exit", (code) => {
    if (!job.completed && job.error === null) {
      job.error =
        code === 0
          ? "The mission worker stopped before recording completion."
          : `The mission worker exited with code ${String(code)}.`;
    }
    activeJobs.delete(missionId);
  });
  activeJobs.set(missionId, job);
  return job;
}

const providerDefinitions = Object.freeze([
  [ProviderId.OPENAI, "OpenAI"],
  [ProviderId.ANTHROPIC, "Anthropic"],
  [ProviderId.GOOGLE_GEMINI, "Google Gemini"],
]);

async function performProviderRefresh({ forceLifecycleSources = false, trigger = "manual" } = {}) {
  await liveAdapters.refreshLifecycleSources({ force: forceLifecycleSources });
  const registered = new Set(
    control.ai.providers.list().map((provider) => provider.providerId),
  );
  for (const [providerId, displayName] of providerDefinitions) {
    if (!registered.has(providerId)) {
      control.ai.providers.register({
        eventId: `provider-${providerId}-registered`,
        metadata: {
          providerId,
          displayName,
          version: "live-v1",
          enabled: true,
          rateLimits: {
            requestsPerMinute: null,
            tokensPerMinute: null,
          },
          costMetadata: {
            currency: "USD",
            source: "Provider billing; estimate unavailable locally",
          },
        },
      });
    }
  }
  for (const [providerId] of providerDefinitions) {
    const inspection = control.ai.providers.validateCredential(providerId);
    const suffix = `${trigger}-${Date.now()}-${randomUUID().slice(0, 8)}-${providerId}`;
    if (!inspection.valid) {
      control.ai.providers.recordHealth({
        eventId: `provider-health-${suffix}`,
        providerId,
        observation: {
          health: ProviderHealth.UNAVAILABLE,
          detail: inspection.reason,
        },
      });
      continue;
    }
    try {
      if (control.ai.models.list({ providerId }).length === 0) {
        await control.ai.models.discover({
          eventId: `model-discovery-${suffix}`,
          discoveryId: `discovery-${suffix}`,
          providerId,
        });
      } else {
        await control.ai.models.refresh({
          eventId: `model-refresh-${suffix}`,
          discoveryId: `refresh-${suffix}`,
          providerId,
        });
      }
      control.ai.providers.recordHealth({
        eventId: `provider-health-${suffix}`,
        providerId,
        observation: {
          health: ProviderHealth.HEALTHY,
          detail:
            "Credential was accepted and live model discovery succeeded.",
        },
      });
    } catch (error) {
      control.ai.providers.recordHealth({
        eventId: `provider-health-${suffix}`,
        providerId,
        observation: {
          health: ProviderHealth.UNAVAILABLE,
          detail: `Live validation failed: ${String(error.message).slice(0, 180)}`,
        },
      });
    }
  }
}

let providerRefreshPromise = null;
function refreshProviders(options = {}) {
  if (providerRefreshPromise === null) {
    providerRefreshPromise = performProviderRefresh(options).finally(() => {
      providerRefreshPromise = null;
    });
  }
  return providerRefreshPromise;
}

function bootstrapProviders() {
  return refreshProviders({
    forceLifecycleSources: true,
    trigger: "startup",
  });
}

function providerView() {
  return control.ai.providers.list().map((provider) => {
    const discovered = control.ai.models.listDiscovered({ providerId: provider.providerId });
    const validated = new Map(
      control.ai.models.listValidated({ providerId: provider.providerId })
        .map((model) => [model.modelId, model]),
    );
    const approved = control.ai.models.list({ providerId: provider.providerId });
    const approvedIds = new Set(approved.map((model) => model.modelId));
    const refresh = control.ai.models.refreshStatus(provider.providerId);
    const validationSources = [...new Set([...validated.values()]
      .map((model) => model.lifecycleSourceStatus)
      .filter((status) => typeof status === "string"))];
    const connectedModels = discovered.map((model) => {
      const validation = validated.get(model.modelId);
      return {
        modelId: model.modelId,
        displayName: model.displayName,
        purpose: validation?.purpose ?? "UNKNOWN",
        lifecycle: validation?.registryState ?? "UNVERIFIED",
        releaseChannel: validation?.releaseChannel ?? "UNKNOWN",
        validationStatus: validation?.validationStatus ?? "UNVALIDATED",
        catalogPresence: model.catalogPresence ?? "PRESENT",
        lastSeenAt: model.lastSeenAt ?? model.observedAt ?? null,
        missingSince: model.missingSince ?? null,
        lastValidatedAt: validation?.validatedAt ?? null,
        engineeringEligible: approvedIds.has(model.modelId),
        reasons: validation?.validationReasons ?? ["No governance validation is recorded."],
      };
    });
    return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    configured: provider.credential.configured,
    formatValid: provider.credential.valid,
    health: provider.health,
    available: provider.availability.available,
    autoRoutingAvailable:
      provider.availability.available && approved.length > 0 && !refresh.stale,
    lastSuccessfulRefreshAt: refresh.lastSuccessfulRefreshAt,
    refreshStale: refresh.stale,
    refreshMaximumAgeMs: refresh.maximumAgeMs,
    nextScheduledRefreshAt:
      refresh.lastSuccessfulRefreshAt === null
        ? null
        : new Date(
            Date.parse(refresh.lastSuccessfulRefreshAt) +
              modelRefreshIntervalMs,
          ).toISOString(),
    lifecycleSourceStatus:
      validationSources.length === 0 ? "UNAVAILABLE" : validationSources.join(", "),
    reason: provider.availability.available
      ? "Account access and live catalog discovery are available. Engineering approval is evaluated separately."
      : provider.credential.valid
        ? provider.availability.reasons.join(", ")
        : provider.credential.reason,
    connectedModels,
    models: approved
      .map((model) => ({
        modelId: model.modelId,
        displayName: model.displayName,
        status: model.status,
      })),
    };
  });
}

function missionIntent(events) {
  const reason = events[0]?.transition?.reason ?? "";
  const prefix = "Customer requested: ";
  return reason.startsWith(prefix) ? reason.slice(prefix.length) : reason;
}

function activity(record) {
  if (record.type === "MISSION_TRANSITION") {
    const moments = {
      INTAKE: ["Understanding your requirements", "Foundry is turning the request into a precise project brief."],
      CLARIFYING: ["Resolving an important decision", "A decision that changes the architecture needs customer input."],
      CONTRACTED: ["Planning what will be verified", "The requested outcomes now have observable completion conditions."],
      PROVISIONING: ["Preparing the project", "Foundry is creating a protected workspace and checking the selected stack."],
      EXECUTING: ["Building the project", "Foundry is generating and testing the real application."],
      VERIFYING: ["Verifying the finished result", "Every requested workflow is being checked against stored evidence."],
      REPAIRING: ["Resolving an issue", "Foundry found a failed observation and is correcting it through the production path."],
      SUCCEEDED: ["Project verified", "Every binding outcome passed the completion gate."],
      FAILED: ["Build stopped", "A recorded failure prevented completion."],
      BLOCKED: ["Customer decision required", "Foundry cannot continue safely without resolving a blocker."],
      EXHAUSTED: ["Repair budget exhausted", "Foundry stopped after exhausting novel repair strategies."],
      CANCELLED: ["Mission cancelled", "Work stopped and the recorded workspace was preserved."],
    };
    const [title, detail] = moments[record.transition.to] ?? [
      "Mission status changed",
      record.transition.reason,
    ];
    return {
      sequence: record.sequence,
      occurredAt: record.occurredAt,
      kind: "state",
      title,
      detail,
    };
  }
  if (record.type === "REQUIREMENT_CONTRACT_CREATED") {
    return {
      sequence: record.sequence,
      occurredAt: record.occurredAt,
      kind: "contract",
      title: "Requirement Contract recorded",
      detail: `${record.contract.obligations.length} observable obligations became binding.`,
    };
  }
  if (record.type === "COMPLETION_VERDICT_RECORDED") {
    return {
      sequence: record.sequence,
      occurredAt: record.occurredAt,
      kind: "verification",
      title: `Verification ${record.completionVerdict.overallResult}`,
      detail:
        record.completionVerdict.overallResult === "COMPLETE"
          ? "Every contract obligation is supported by stored evidence."
          : "At least one obligation remains incomplete.",
    };
  }
  const fact = record.fact;
  const executionRecord = fact?.metadata?.executionRecord;
  if (executionRecord !== undefined) {
    const procedures = {
      dependencyLock: "Resolving exact project dependencies",
      install: "Installing the project toolchain",
      typeCheck: "Checking the project for type errors",
      lint: "Reviewing source quality",
      productionBuild: "Building the production application",
      browserVerification: "Testing the important workflows",
    };
    const procedure = executionRecord.inputs?.procedureName;
    const actionTitles = {
      "apply-file-bundle": "Writing the generated source bundle",
      "create-directory": `Preparing folder ${executionRecord.inputs?.path ?? ""}`,
      "write-file": `Writing ${executionRecord.inputs?.path ?? "project file"}`,
      "replace-file": `Updating ${executionRecord.inputs?.path ?? "project file"}`,
      "delete-file": `Removing ${executionRecord.inputs?.path ?? "project file"}`,
    };
    return {
      sequence: record.sequence,
      occurredAt: record.occurredAt,
      kind: executionRecord.status === "FAILED" ? "repair" : "observation",
      title:
        procedures[procedure] ??
        actionTitles[executionRecord.actionType] ??
        "Building the project",
      detail:
        executionRecord.status === "SUCCEEDED"
          ? "The real production step completed successfully."
          : executionRecord.status === "FAILED"
            ? "The production step failed and its output was preserved for diagnosis."
            : "The real production step is in progress.",
    };
  }
  const executionStart = fact?.metadata?.executionStart;
  if (executionStart !== undefined) {
    const fingerprint = executionStart.fingerprint;
    const procedure = fingerprint.inputs?.procedureName;
    const procedureTitles = {
      dependencyLock: "Resolving exact project dependencies",
      install: "Installing project dependencies",
      typeCheck: "Checking TypeScript",
      lint: "Checking source quality",
      productionBuild: "Building the production application",
      browserVerification: "Testing browser workflows",
    };
    const actionTitles = {
      "apply-file-bundle": "Writing the generated source bundle",
      "create-directory": `Preparing folder ${fingerprint.inputs?.path ?? ""}`,
      "write-file": `Writing ${fingerprint.inputs?.path ?? "project file"}`,
      "replace-file": `Updating ${fingerprint.inputs?.path ?? "project file"}`,
      "delete-file": `Removing ${fingerprint.inputs?.path ?? "project file"}`,
    };
    return {
      sequence: record.sequence,
      occurredAt: record.occurredAt,
      kind: "observation",
      title:
        procedureTitles[procedure] ??
        actionTitles[fingerprint.actionType] ??
        "Starting a production step",
      detail: "The step started from its immutable workspace checkpoint.",
    };
  }
  const runtimeRecord = fact?.metadata?.runtimeRecord;
  if (runtimeRecord !== undefined) {
    return {
      sequence: record.sequence,
      occurredAt: record.occurredAt,
      kind: "observation",
      title:
        runtimeRecord.eventType === "BROWSER_OBSERVATION"
          ? "Testing the important workflows"
          : "Running the application",
      detail:
        runtimeRecord.status === "READY" ||
        runtimeRecord.status === "HEALTHY"
          ? "The real generated application answered its readiness checks."
          : "The runtime observation was recorded for diagnosis.",
    };
  }
  if (fact?.metadata?.modelRouteStart !== undefined) return null;
  if (fact?.metadata?.modelRouteFailure !== undefined) return null;
  if (fact?.metadata?.modelCallRecord !== undefined) return null;
  if (record.type === "WORKSPACE_FACT_RECORDED") return null;
  return {
    sequence: record.sequence,
    occurredAt: record.occurredAt,
    kind: "observation",
    title: fact?.statement ?? record.type,
    detail:
      fact?.metadata?.runtimeRecord?.status ??
      fact?.metadata?.executionRecord?.status ??
      fact?.metadata?.modelCallRecord?.status ??
      "Recorded in the append-only Mission Ledger.",
  };
}

function modelRouting(events) {
  const routes = [];
  for (const record of events) {
    const started = record.fact?.metadata?.modelRouteStart;
    if (started !== undefined) {
      for (const route of routes) {
        if (
          route.status === "ACTIVE" &&
          route.requestId === record.fact.workUnitReference
        ) {
          route.status = "FAILED";
        }
      }
      routes.push({
        sequence: record.sequence,
        occurredAt: record.occurredAt,
        requestId: record.fact.workUnitReference,
        provider: started.provider,
        providerFamily: started.providerFamily,
        modelId: started.modelId,
        taskClass: started.taskClass,
        depthLevel: started.depthLevel,
        routingReason: started.routingReason,
        status: "ACTIVE",
        attempt: started.routeAttempt,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      });
    }
    const completed = record.fact?.metadata?.modelCallRecord;
    const failed = record.fact?.metadata?.modelRouteFailure;
    if (failed !== undefined) {
      const active = [...routes]
        .reverse()
        .find(
          (route) =>
            route.status === "ACTIVE" &&
            route.requestId === failed.requestId &&
            route.attempt === failed.routeAttempt,
        );
      if (active !== undefined) {
        active.sequence = record.sequence;
        active.occurredAt = record.occurredAt;
        active.status = "FAILED";
      }
    }
    if (completed !== undefined) {
      const active = [...routes]
        .reverse()
        .find(
          (route) =>
            route.status === "ACTIVE" &&
            route.requestId === completed.workUnitId,
        );
      if (active !== undefined) {
        active.sequence = record.sequence;
        active.occurredAt = record.occurredAt;
        active.status = completed.status;
        active.inputTokens = completed.tokenMetadata.inputTokens;
        active.outputTokens = completed.tokenMetadata.outputTokens;
        active.costUsd = completed.costMetadata.costUsd;
      } else {
        routes.push({
          sequence: record.sequence,
          occurredAt: record.occurredAt,
          requestId: completed.workUnitId,
          provider: completed.provider,
          providerFamily: completed.providerFamily,
          modelId: completed.modelId,
          taskClass: completed.taskClass,
          depthLevel: completed.depthLevel,
          routingReason: completed.routingReason,
          status: completed.status,
          attempt: completed.costMetadata.attemptCount,
          inputTokens: completed.tokenMetadata.inputTokens,
          outputTokens: completed.tokenMetadata.outputTokens,
          costUsd: completed.costMetadata.costUsd,
        });
      }
    }
  }
  const understandingRecords = events
    .filter((record) => record.fact?.metadata?.projectProfile !== undefined)
    .flatMap((record) => record.fact.evidenceReferences ?? [])
    .map((reference) => control.evidence.getById(reference.evidenceId))
    .filter(
      (record) =>
        record.kind === "model-call-result" &&
        record.captureMethod ===
          "live-provider-structured-project-understanding",
    );
  for (const record of understandingRecords) {
    if (
      routes.some(
        (route) =>
          route.requestId === record.payload.requestId &&
          route.status === "SUCCEEDED",
      )
    ) {
      continue;
    }
    routes.push({
      sequence: 0,
      occurredAt: record.timestamp,
      requestId: record.payload.requestId,
      provider: record.metadata.providerId,
      providerFamily: null,
      modelId: record.metadata.modelId,
      taskClass: "PROJECT_UNDERSTANDING",
      depthLevel: record.metadata.depthLevel ?? 3,
      routingReason: record.metadata.routingRationale,
      status: record.payload.status,
      attempt: 1,
      inputTokens: record.metadata.tokenUsage?.inputTokens ?? null,
      outputTokens: record.metadata.tokenUsage?.outputTokens ?? null,
      costUsd: record.metadata.tokenUsage?.costUsd ?? null,
    });
  }
  const latestSequence = events.at(-1)?.sequence ?? 0;
  for (const route of routes) {
    if (route.status === "ACTIVE" && route.sequence < latestSequence) {
      route.status = "INTERRUPTED";
    }
  }
  return routes.sort((left, right) =>
    String(left.occurredAt).localeCompare(String(right.occurredAt)),
  );
}

async function missionView(missionId) {
  const events = control.ledger.reportEvents(missionId);
  const decisionHistory = projectDecisionHistory(events);
  const state = events
    .filter((record) => record.type === "MISSION_TRANSITION")
    .at(-1)?.transition.to;
  const recordedProfileRecord =
    events
      .filter(
        (record) => record.fact?.metadata?.projectProfile !== undefined,
      )
      .at(-1) ?? null;
  const recordedProfile =
    recordedProfileRecord?.fact.metadata.projectProfile ?? null;
  const projectDesign =
    recordedProfileRecord?.fact.metadata.projectDesign ?? null;
  const proposalConfirmed =
    recordedProfileRecord?.fact.metadata.clarificationAnswers?.some(
      (answer) =>
        answer?.questionId === "customer-proposal-confirmation",
    ) === true;
  let profile = recordedProfile;
  let experience = null;
  let recordedProfileError = null;
  if (recordedProfile !== null) {
    try {
      experience = control.profiles.experience(recordedProfile);
    } catch (error) {
      profile = null;
      recordedProfileError = [
        "The latest recorded project understanding is invalid and cannot be used to start a build.",
        "Retry understanding to create a new immutable profile revision.",
        String(error?.message ?? error),
      ].join(" ");
    }
  }
  const contract = projectRequirementContract(events, missionId);
  const executionProjection = projectExecutionProjection({
    contract,
    events,
    profile,
    projectDesign,
    approvedProjectContract:
      control.approvedContracts.latest(missionId),
  });
  let previewUrl = null;
  const persistedRuntime = events
    .map((record) => record.fact?.metadata?.runtimeRecord)
    .filter(Boolean)
    .at(-1);
  const persistedUrl =
    persistedRuntime?.status === "STOPPED"
      ? null
      : persistedRuntime?.previewUrl ?? null;
  if (persistedUrl !== null) {
    try {
      const observation = await fetch(persistedUrl, {
        signal: AbortSignal.timeout(1_500),
      });
      if (observation.ok) previewUrl = persistedUrl;
    } catch {}
  }
  const job = activeJobs.get(missionId);
  const understandingJob = activeUnderstandingJobs.get(missionId);
  const activities = events.map(activity).filter(Boolean);
  const routing = modelRouting(events);
  if (understandingJob?.error !== null && understandingJob !== undefined) {
    const activeRoute = [...routing]
      .reverse()
      .find((route) => route.status === "ACTIVE");
    if (activeRoute !== undefined) activeRoute.status = "FAILED";
  }
  return {
    missionId,
    intent: missionIntent(events),
    state,
    profile,
    proposalConfirmed,
    experience,
    contract,
    decisionHistory: decisionHistory.decisions,
    selectedEnhancements: decisionHistory.selectedEnhancements,
    discoveryConversation: projectDiscoveryConversation(events),
    technicalStack: {
      stackId: WEB_STACK_MANIFEST.stackId,
      stackVersion: WEB_STACK_MANIFEST.stackVersion,
      components: WEB_STACK_MANIFEST.components,
      frameworkVersion:
        WEB_STACK_MANIFEST.requiredTools
          .find((tool) => tool.toolId === "nextjs")
          ?.versionRange.replace(/^=/u, "") ?? null,
      knownLimitations: WEB_STACK_MANIFEST.knownLimitations,
    },
    executionProjection,
    previewUrl,
    running:
      (job !== undefined && job.error === null && !job.completed) ||
      understandingJob?.active === true,
    error:
      job?.error ??
      understandingJob?.error ??
      recordedProfileError,
    activities,
    currentActivity: activities.at(-1) ?? null,
    modelRouting: routing,
    activeModelRoute:
      [...routing].reverse().find((route) => route.status === "ACTIVE") ??
      null,
    executionMetrics: control.production.metrics(missionId, events),
    updatedAt: events.at(-1)?.occurredAt ?? null,
  };
}

function missionSummary(missionId) {
  const events = control.ledger.reportEvents(missionId);
  const decisionHistory = projectDecisionHistory(events);
  const state = events
    .filter((record) => record.type === "MISSION_TRANSITION")
    .at(-1)?.transition.to;
  const recordedProfileRecord =
    events
      .filter(
        (record) => record.fact?.metadata?.projectProfile !== undefined,
      )
      .at(-1) ?? null;
  const recordedProfile =
    recordedProfileRecord?.fact.metadata.projectProfile ?? null;
  const proposalConfirmed =
    recordedProfileRecord?.fact.metadata.clarificationAnswers?.some(
      (answer) =>
        answer?.questionId === "customer-proposal-confirmation",
    ) === true;
  let profile = recordedProfile;
  let recordedProfileError = null;
  if (recordedProfile !== null) {
    try {
      control.profiles.experience(recordedProfile);
    } catch {
      profile = null;
      recordedProfileError =
        "The latest recorded project understanding is invalid. Retry understanding to create a valid revision.";
    }
  }
  const job = activeJobs.get(missionId);
  const understandingJob = activeUnderstandingJobs.get(missionId);
  const executionProjection = projectExecutionProjection({
    contract: projectRequirementContract(events, missionId),
    events,
    profile,
  });
  return {
    missionId,
    intent: missionIntent(events),
    state,
    profile,
    proposalConfirmed,
    contract: null,
    decisionHistory: decisionHistory.decisions,
    selectedEnhancements: decisionHistory.selectedEnhancements,
    discoveryConversation: projectDiscoveryConversation(events),
    technicalStack: {
      stackId: WEB_STACK_MANIFEST.stackId,
      stackVersion: WEB_STACK_MANIFEST.stackVersion,
      components: WEB_STACK_MANIFEST.components,
      frameworkVersion:
        WEB_STACK_MANIFEST.requiredTools
          .find((tool) => tool.toolId === "nextjs")
          ?.versionRange.replace(/^=/u, "") ?? null,
      knownLimitations: WEB_STACK_MANIFEST.knownLimitations,
    },
    executionProjection,
    previewUrl: null,
    running:
      (job !== undefined && job.error === null) ||
      understandingJob?.active === true,
    error:
      job?.error ??
      understandingJob?.error ??
      recordedProfileError,
    activities: [],
    currentActivity: null,
    modelRouting: [],
    activeModelRoute: null,
    executionMetrics: null,
    updatedAt: events.at(-1)?.occurredAt ?? null,
    searchEvents: events,
  };
}

async function listMissions(query = "") {
  const normalized = query.trim().toLowerCase();
  return control.catalogue
    .listMissionIds()
    .filter(
      (missionId) =>
        !projectIsDeleted(control.ledger.reportEvents(missionId)),
    )
    .map(missionSummary)
    .filter((mission) => {
      if (normalized === "") return true;
      const searchable = [
        mission.missionId,
        mission.intent,
        mission.profile?.name,
        mission.profile?.summary,
        ...(mission.profile?.outcomes ?? []),
        ...(mission.profile?.observations ?? []),
        ...(mission.profile?.designAlternatives ?? []).flatMap(
          (alternative) => [alternative.approach, alternative.rationale],
        ),
        ...(mission.profile?.architectureDecisions ?? []),
        ...mission.searchEvents
          .flatMap((record) => [
            record.transition?.reason,
            record.fact?.statement,
            record.fact?.metadata?.executionRecord?.inputs?.path,
            record.fact?.metadata?.executionRecord?.inputs?.procedureName,
            record.workspaceFact?.reason,
          ]),
      ]
        .filter(Boolean)
        .join("\n")
        .toLowerCase();
      return searchable.includes(normalized);
    })
    .sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    )
    .map((mission) =>
      Object.fromEntries(
        Object.entries(mission).filter(([key]) => key !== "searchEvents"),
      ),
    );
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(JSON.stringify(body));
}

function isProjectDeleted(missionId) {
  return projectIsDeleted(control.ledger.reportEvents(missionId));
}

async function stopMissionWork(missionId, { cancel = false } = {}) {
  const job = activeJobs.get(missionId);
  if (job !== undefined && job.child.connected && job.child.exitCode === null) {
    await new Promise((resolve) => {
      job.child.send({ type: cancel ? "stop" : "shutdown" }, () => resolve());
    });
    await Promise.race([
      new Promise((resolve) => job.child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 10_000)),
    ]);
  } else {
    try {
      if (cancel) {
        await control.production.cancel(missionId);
      } else {
        await control.production.stop(missionId);
      }
    } catch {}
  }
  activeJobs.delete(missionId);
  activeUnderstandingJobs.delete(missionId);
}

async function deleteProject(missionId) {
  if (isProjectDeleted(missionId)) {
    return { deleted: true, missionId };
  }
  await stopMissionWork(missionId);
  const timestamp = new Date().toISOString();
  const suffix = randomUUID().slice(0, 8);
  recordProjectDeletion({
    control,
    missionId,
    timestamp,
    suffix,
  });
  return { deleted: true, missionId };
}

async function body(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function routeMission(pathname) {
  const match = /^\/missions\/([A-Za-z0-9_-]+)(?:\/(clarify|understand|start|stop))?$/u.exec(
    pathname,
  );
  return match === null
    ? null
    : { missionId: match[1], action: match[2] ?? null };
}

void bootstrapProviders().catch((error) => {
  process.stderr.write(
    `${new Date().toISOString()} provider bootstrap failed: ${String(
      error?.stack ?? error,
    ).slice(0, 4_000)}\n`,
  );
});

const configuredRefreshInterval = Number(
  configuredEnvironment.FOUNDRY_MODEL_REFRESH_INTERVAL_MS ??
    MODEL_GOVERNANCE_POLICY.scheduledRefreshIntervalMs,
);
const modelRefreshIntervalMs =
  Number.isFinite(configuredRefreshInterval) && configuredRefreshInterval >= 60_000
    ? configuredRefreshInterval
    : MODEL_GOVERNANCE_POLICY.scheduledRefreshIntervalMs;
const modelRefreshTimer = setInterval(() => {
  void refreshProviders({ forceLifecycleSources: true, trigger: "scheduled" }).catch((error) => {
    process.stderr.write(
      `${new Date().toISOString()} scheduled provider refresh failed: ${String(
        error?.stack ?? error,
      ).slice(0, 4_000)}\n`,
    );
  });
}, modelRefreshIntervalMs);
modelRefreshTimer.unref();

for (const missionId of control.catalogue.listMissionIds()) {
  const events = control.ledger.reportEvents(missionId);
  const recovery = understandingRecoveryDecision(events);
  if (recovery.reason === "provider-attempt-interrupted") {
    activeUnderstandingJobs.set(missionId, {
      active: false,
      error:
        "Project understanding was interrupted after dispatch. Retry explicitly to avoid an automatic duplicate provider charge.",
      startedAt: null,
    });
  }
  if (recovery.recover) {
    try {
      control.ledger.projectState(missionId);
    } catch {
      activeUnderstandingJobs.set(missionId, {
        active: false,
        error:
          "This earlier intake failed Ledger integrity validation and cannot be resumed. Use the newer replacement mission.",
        startedAt: null,
      });
      continue;
    }
    startUnderstandingJob({
      missionId,
      intent: missionIntent(events),
      profileVersion: 1,
      causationId: `${missionId}-recovered-understanding`,
    });
  }
  if (executionRecoveryDecision(events).recover) {
    startMissionWorker(missionId);
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (request.method === "OPTIONS") return json(response, 204, {});
    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, {
        status: "ready",
        providers: providerView().filter((provider) => provider.available)
          .length,
      });
    }
    if (request.method === "GET" && url.pathname === "/providers") {
      return json(response, 200, { providers: providerView() });
    }
    if (request.method === "POST" && url.pathname === "/providers/refresh") {
      await refreshProviders({ forceLifecycleSources: true, trigger: "manual" });
      return json(response, 200, { providers: providerView() });
    }
    if (request.method === "GET" && url.pathname === "/missions") {
      return json(response, 200, {
        missions: await listMissions(url.searchParams.get("q") ?? ""),
      });
    }
    if (request.method === "POST" && url.pathname === "/missions") {
      const input = await body(request);
      if (typeof input.intent !== "string" || input.intent.trim() === "") {
        return json(response, 400, { error: "Project description is required." });
      }
      const missionId = `mission-${Date.now()}-${randomUUID().slice(0, 8)}`;
      control.orchestrator.createMission({
        missionId,
        eventId: `${missionId}-created`,
        causationId: `${missionId}-customer-intent`,
        reason: `Customer requested: ${input.intent.trim()}`,
      });
      const created = await missionView(missionId);
      json(response, 201, created);
      setImmediate(() => {
        startUnderstandingJob({
          missionId,
          intent: input.intent.trim(),
          profileVersion: 1,
          causationId: `${missionId}-customer-intent`,
        });
      });
      return;
    }
    const missionRoute = routeMission(url.pathname);
    if (
      request.method === "DELETE" &&
      missionRoute !== null &&
      missionRoute.action === null
    ) {
      return json(
        response,
        200,
        await deleteProject(missionRoute.missionId),
      );
    }
    if (
      request.method === "GET" &&
      missionRoute !== null &&
      missionRoute.action === null
    ) {
      if (isProjectDeleted(missionRoute.missionId)) {
        return json(response, 410, {
          error: "This project was deleted from the customer catalogue.",
        });
      }
      return json(response, 200, await missionView(missionRoute.missionId));
    }
    if (
      request.method === "POST" &&
      missionRoute?.action === "clarify"
    ) {
      const input = await body(request);
      if (activeUnderstandingJobs.get(missionRoute.missionId)?.active === true) {
        return json(response, 409, {
          error: "Foundry is already revising this project. Wait for the current revision to finish.",
        });
      }
      let answers;
      try {
        answers = normalizeCustomerFollowUpAnswers(input.answers);
      } catch (error) {
        return json(response, 400, {
          error: String(error?.message ?? error).slice(0, 500),
        });
      }
      const prior = await missionView(missionRoute.missionId);
      const nextProfileVersion = (prior.profile?.profileVersion ?? 0) + 1;
      startUnderstandingJob({
        missionId: missionRoute.missionId,
        intent: prior.intent,
        answers,
        profileVersion: nextProfileVersion,
        causationId: `${missionRoute.missionId}-clarification`,
      });
      return json(response, 202, await missionView(missionRoute.missionId));
    }
    if (
      request.method === "POST" &&
      missionRoute?.action === "understand"
    ) {
      const prior = await missionView(missionRoute.missionId);
      if (prior.profile !== null) {
        return json(response, 409, {
          error: "Project understanding has already completed.",
        });
      }
      const latestRecordedProfileVersion =
        control.ledger
          .reportEvents(missionRoute.missionId)
          .map((record) => record.fact?.metadata?.projectProfile?.profileVersion)
          .filter(Number.isInteger)
          .at(-1) ?? 0;
      startUnderstandingJob({
        missionId: missionRoute.missionId,
        intent: prior.intent,
        profileVersion: latestRecordedProfileVersion + 1,
        causationId: `${missionRoute.missionId}-customer-retry`,
      });
      return json(response, 202, await missionView(missionRoute.missionId));
    }
    if (request.method === "POST" && missionRoute?.action === "start") {
      if (
        activeJobs.has(missionRoute.missionId) &&
        activeJobs.get(missionRoute.missionId).error === null
      ) {
        return json(response, 409, { error: "Mission execution is already active." });
      }
      startMissionWorker(missionRoute.missionId);
      return json(response, 202, {
        accepted: true,
        missionId: missionRoute.missionId,
      });
    }
    if (request.method === "POST" && missionRoute?.action === "stop") {
      await stopMissionWork(missionRoute.missionId, { cancel: true });
      return json(response, 200, await missionView(missionRoute.missionId));
    }
    return json(response, 404, { error: "Not found." });
  } catch (error) {
    process.stderr.write(
      `${new Date().toISOString()} ${request.method} ${request.url}: ${String(
        error?.stack ?? error,
      ).slice(0, 4_000)}\n`,
    );
    return json(response, 500, {
      error: String(error.message ?? error).slice(0, 500),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Foundry local API ready at http://127.0.0.1:${port}\n`);
});

async function shutdown() {
  clearInterval(modelRefreshTimer);
  for (const job of activeJobs.values()) {
    try {
      job.child.send({ type: "stop" });
    } catch {}
  }
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
