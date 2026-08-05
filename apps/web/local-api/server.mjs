import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";

import {
  ProviderHealth,
  ProviderId,
  MODEL_GOVERNANCE_POLICY,
  WEB_STACK_MANIFEST,
  createLiveAiAdapters,
  createModelLifecycleSourceService,
  createConceptPrototypeContract,
  createPrototypeGenerationService,
  createPrototypeWorkspaceService,
  createPrototypeRuntimeService,
  createChromePrototypeBrowserVerifier,
  createPrototypeVerificationService,
  createPrototypeStudioSessionService,
  createConceptEvolutionService,
  ConceptStrategy,
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
  // Two bounded attempts so a single structured-output validation miss during
  // understanding retries with the exact failure fed back, instead of pushing
  // the customer to a manual retry.
  maxModelProviderAttempts: 2,
  requireProductBlueprintApproval: true,
});
const activeJobs = new Map();
const activeUnderstandingJobs = new Map();
const activeConceptJobs = new Map();
const prototypeRoot = resolve(stateRoot, "prototype-root");
const prototypeWorkspaces = createPrototypeWorkspaceService({ prototypeRoot });
const prototypeRuntimes = createPrototypeRuntimeService({
  workspaceService: prototypeWorkspaces,
  previewParentOrigins: ["http://127.0.0.1:3001", "http://localhost:3001"],
});
const prototypeGeneration = createPrototypeGenerationService({
  modelGateway: control.models,
  workspaceService: prototypeWorkspaces,
});
const prototypeVerification = createPrototypeVerificationService({
  browserVerifier: createChromePrototypeBrowserVerifier({ timeoutMs: 30_000 }),
  workspaceService: prototypeWorkspaces,
  runtimeService: prototypeRuntimes,
});
const prototypeSessions = createPrototypeStudioSessionService({ prototypeRoot });
const conceptEvolution = createConceptEvolutionService();

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
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  const job = { child, error: null, completed: false, stderr: "" };
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    job.stderr = `${job.stderr}${chunk}`.slice(-2_000);
  });
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
          : `The mission worker exited with code ${String(code)}${job.stderr.trim() === "" ? "." : `: ${job.stderr.trim().slice(-500)}`}`;
    }
    if (job.completed) activeJobs.delete(missionId);
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

function uniqueText(values, fallback) {
  const seen = new Set();
  const result = [];
  for (const value of values ?? []) {
    const normalized = String(value ?? "").trim();
    const key = normalized.toLowerCase();
    if (normalized !== "" && !seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result.length > 0 ? result : [fallback];
}

function conceptUnderstandingFromProfile(profile) {
  const value = (entry) => ({ value: entry });
  return {
    projectName: value(profile.name),
    proposal: {
      designDirection: {
        accessibilityConsiderations: value(profile.designDirection.accessibilityConsiderations),
      },
      exclusions: value(profile.constraints.filter(
        (constraint) => !profile.architectureDecisions.includes(constraint),
      )),
      alternatives: profile.designAlternatives.map((alternative, index) => ({
        id: `alternative-${index + 1}`,
        name: value(alternative.approach),
        whyItFits: value(alternative.whyItFits ?? alternative.rationale),
        layoutApproach: value(alternative.layoutApproach ?? profile.designDirection.layoutApproach),
        visualPersonality: value(alternative.visualPersonality ?? alternative.approach),
        informationDensity: value(alternative.informationDensity ?? alternative.rationale),
        navigationApproach: value(alternative.navigationApproach ?? alternative.rationale),
        mobileBehavior: value(alternative.mobileBehavior ?? profile.designDirection.mobilePriority),
        tradeoff: value(alternative.tradeoff ?? alternative.tradeoffs?.[0] ?? alternative.rationale),
        preview: {
          hierarchy: value(alternative.preview?.hierarchy ?? alternative.layoutApproach ?? alternative.rationale),
        },
        visualSystem: alternative.visualSystem,
        creativeDNA: alternative.creativeDNA,
        recommended: value(alternative.recommended),
      })),
    },
  };
}

function conceptContractFromAlternative({ missionId, understanding, alternative, sourceProjectDesignVersion, conceptVersion = 1 }) {
  const dna = alternative.creativeDNA;
  const visual = alternative.visualSystem;
  if (dna === undefined || visual === undefined) {
    throw new TypeError(`Design alternative "${alternative.id}" has no execution-ready creative contract.`);
  }
  return createConceptPrototypeContract({
    conceptId: alternative.id,
    missionId,
    conceptVersion,
    conceptName: alternative.name.value,
    creativeThesis: dna.thesis,
    intendedAudienceResponse: dna.audienceResponse,
    designRationale: alternative.whyItFits.value,
    projectSurfaces: uniqueText(dna.surfaceLabels, "Primary experience"),
    pageOrScreenSequence: uniqueText(dna.surfaceSequence, "Primary experience"),
    navigationModel: alternative.navigationApproach.value,
    compositionRules: uniqueText([
      alternative.layoutApproach.value,
      `Use the ${dna.compositionPrimitive} composition primitive.`,
      `Maintain ${alternative.informationDensity.value} information density.`,
    ], "Use a project-specific composition."),
    typographySystem: {
      category: visual.typographyCategory,
      voice: dna.typeVoice,
      scale: dna.typeScale,
      hierarchy: alternative.preview.hierarchy.value,
    },
    colorSystem: visual.colorRoles,
    spacingSystem: {
      baseUnit: 8,
      scale: visual.density === "dense" ? [4, 8, 12, 20, 32, 48] : [8, 16, 24, 40, 64, 96],
    },
    imageryStrategy: `${visual.imageStrategy}. ${dna.imageryTreatment}.`,
    componentCharacter: `${alternative.visualPersonality.value}. ${visual.surfaceTreatment}.`,
    interactionRules: uniqueText([
      visual.interactionModel,
      `The primary action is ${dna.primaryAction}.`,
      alternative.navigationApproach.value,
    ], "Use clear local navigation and lightweight interaction."),
    motionRules: uniqueText([
      dna.motionStrategy,
      "Honor prefers-reduced-motion without removing content or meaning.",
    ], "Use restrained motion and honor reduced motion."),
    responsiveRules: uniqueText([
      dna.responsiveTransform,
      alternative.mobileBehavior.value,
    ], "Transform deliberately for mobile."),
    accessibilityRules: uniqueText([
      ...understanding.proposal.designDirection.accessibilityConsiderations.value,
      "Use semantic landmarks, visible keyboard focus, and accessible contrast.",
    ], "Use semantic, keyboard-accessible markup."),
    deliberateExclusions: uniqueText([
      ...dna.exclusions,
      ...understanding.proposal.exclusions.value,
      "No external scripts, network calls, credentials, authentication, database, payments, or production integrations.",
    ], "No production integrations."),
    sampleContentPolicy: `Use fictional, clearly representative content for ${understanding.projectName.value}; never claim real customers, results, credentials, or contact details.`,
    expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [
      { checkId: "runtime-load", kind: "runtime", statement: "The isolated runtime loads the complete prototype." },
      { checkId: "responsive-browser", kind: "browser", statement: "Desktop, tablet, and mobile render without blocking errors or horizontal overflow." },
      { checkId: "sandbox-boundary", kind: "security", statement: "The prototype has no external network, host, secret, or parent-window access." },
      { checkId: "cross-concept-distinction", kind: "differentiation", statement: "The concept is structurally and visually distinct from the other admitted concepts." },
    ],
    sourceProjectDesignVersion,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
  });
}

function publicConceptStudio(missionId) {
  const session = prototypeSessions.read(missionId);
  if (session === null) return null;
  const generating = activeConceptJobs.has(missionId);
  return {
    ...session,
    status: generating ? "GENERATING" : session.status,
    error: generating ? null : session.error,
    concepts: session.concepts.map((concept) => ({
      ...concept,
      thumbnailUrl:
        concept.verificationStatus === "PASSED"
          ? `http://127.0.0.1:${port}/missions/${missionId}/concepts/${concept.contract.conceptId}/evidence/root-desktop.png`
          : null,
    })),
    generating,
  };
}

function persistedConceptVerification(concept) {
  const content = prototypeWorkspaces.readEvidenceFile(
    concept.contract,
    `${concept.verificationId}/verification.json`,
  );
  const record = JSON.parse(content.toString("utf8"));
  if (
    record?.conceptId !== concept.contract.conceptId ||
    record?.conceptVersion !== concept.contract.conceptVersion ||
    record?.contractIntegrityHash !== concept.contract.integrityHash ||
    record?.contentHash !== concept.contentHash
  ) {
    throw new TypeError(`Concept "${concept.contract.conceptName}" has stale or mismatched browser evidence.`);
  }
  return record;
}

function verifyStudioDifferentiation(concepts, currentRecords = []) {
  const current = new Map(currentRecords.map((record) => [
    `${record.conceptId}:v${record.conceptVersion}`,
    record,
  ]));
  const records = concepts.map((concept) =>
    current.get(`${concept.contract.conceptId}:v${concept.contract.conceptVersion}`) ?? persistedConceptVerification(concept),
  );
  return prototypeVerification.verifyDifferentiation(records);
}

function startConceptGenerationJob({ missionId, understanding, sourceProjectDesignVersion }) {
  if (activeConceptJobs.has(missionId)) return activeConceptJobs.get(missionId);
  const alternatives = understanding.proposal.alternatives.slice(0, 3);
  if (alternatives.length < 3) {
    throw new TypeError("Live Concept Studio requires three model-authored design alternatives before generation.");
  }
  let session = prototypeSessions.begin({ missionId, sourceProjectDesignVersion });
  const operation = (async () => {
    // Yield once so the operation is registered before a restart audit that needs
    // no provider or browser awaits can reach its cleanup path.
    await Promise.resolve();
    const verified = [];
    try {
      for (const alternative of alternatives) {
        const existing = session.concepts.find(
          (concept) => concept.contract.conceptId === alternative.id && concept.verificationStatus === "PASSED",
        );
        if (existing !== undefined) continue;
        let admitted = false;
        let admissionFeedback = (session.attemptFailures ?? [])
          .filter((failure) => failure.conceptId === alternative.id)
          .slice(-1)
          .map((failure) => failure.error);
        for (let attempt = 1; attempt <= 2 && !admitted; attempt += 1) {
          const previousVersions = prototypeWorkspaces
            .list(missionId)
            .filter((workspace) => workspace.conceptId === alternative.id)
            .map((workspace) => workspace.conceptVersion);
          const conceptVersion = Math.max(0, ...previousVersions) + 1;
          const contract = conceptContractFromAlternative({
            missionId,
            understanding,
            alternative,
            sourceProjectDesignVersion,
            conceptVersion,
          });
          try {
            const generated = await prototypeGeneration.generate({
              conceptContract: contract,
              admissionFeedback,
            });
            const verification = await prototypeVerification.verify({
              conceptContract: contract,
              verificationId: `${contract.conceptId}-v${contract.conceptVersion}-admission`,
            });
            const concept = {
              contract,
              recommended: alternative.recommended.value === true,
              recommendationReason: alternative.whyItFits.value,
              keyDistinction: `${dnaSummary(alternative)}`,
              tradeoff: alternative.tradeoff.value,
              verificationId: verification.verificationId,
              verificationStatus: verification.status,
              verificationFindings: verification.findings,
              screenshotEvidenceReferences: verification.screenshotEvidenceReferences,
              contentHash: generated.workspace.contentHash,
              usage: generated.usage,
              generatedAt: verification.completedAt,
            };
            session = prototypeSessions.save({
              ...session,
              concepts: [
                ...session.concepts.filter((entry) => entry.contract.conceptId !== contract.conceptId),
                concept,
              ],
              generation: {
                ...session.generation,
                inputTokens: session.generation.inputTokens + generated.usage.inputTokens,
                outputTokens: session.generation.outputTokens + generated.usage.outputTokens,
                costUsd: session.generation.costUsd + generated.usage.costUsd,
              },
            });
            if (verification.status !== "PASSED") {
              throw new TypeError(`Concept "${contract.conceptName}" failed browser admission: ${verification.findings.join(" ")}`);
            }
            verified.push(verification);
            admitted = true;
          } catch (error) {
            admissionFeedback = [String(error?.message ?? error).slice(0, 1_000)];
            session = prototypeSessions.save({
              ...session,
              attemptFailures: [
                ...(session.attemptFailures ?? []),
                {
                  conceptId: contract.conceptId,
                  conceptVersion: contract.conceptVersion,
                  attempt,
                  error: String(error?.message ?? error).slice(0, 1_000),
                  occurredAt: new Date().toISOString(),
                },
              ],
            });
            if (attempt === 2) throw error;
          }
        }
      }
      const admitted = session.concepts.filter((concept) => concept.verificationStatus === "PASSED");
      if (admitted.length !== 3) throw new TypeError("Three admitted concepts were not produced.");
      const differentiation = verifyStudioDifferentiation(admitted, verified);
      if (differentiation.status !== "PASSED") throw new TypeError(differentiation.finding);
      const recommended = admitted.find((concept) => concept.recommended) ?? admitted[0];
      session = prototypeSessions.save({
        ...session,
        status: "READY",
        differentiationStatus: "PASSED",
        differentiationSignatures: differentiation.signatures,
        recommendedConceptId: recommended.contract.conceptId,
        recommendationReason: recommended.recommendationReason,
        generation: { ...session.generation, completedAt: new Date().toISOString() },
        error: null,
      });
      return session;
    } catch (error) {
      session = prototypeSessions.save({
        ...session,
        status: "FAILED",
        generation: { ...session.generation, completedAt: new Date().toISOString() },
        error: String(error?.message ?? error).slice(0, 1_000),
      });
      throw error;
    } finally {
      activeConceptJobs.delete(missionId);
    }
  })();
  activeConceptJobs.set(missionId, operation);
  operation.catch((error) => {
    process.stderr.write(`${new Date().toISOString()} concept generation ${missionId}: ${String(error?.stack ?? error).slice(0, 4_000)}\n`);
  });
  return operation;
}

function startConceptEvolutionJob({
  missionId,
  contract,
  classification,
  composition = null,
  sourceConceptId = null,
  kind,
}) {
  if (activeConceptJobs.has(missionId)) return activeConceptJobs.get(missionId);
  let session = prototypeSessions.read(missionId);
  if (session?.status !== "READY") throw new TypeError("A ready concept session is required.");
  session = prototypeSessions.save({
    ...session,
    evolution: {
      kind,
      status: "GENERATING",
      conceptId: contract.conceptId,
      conceptVersion: contract.conceptVersion,
      changedScopes: classification?.scopes ?? [],
      changedSummary: [],
      conflicts: [],
      error: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
    },
  });
  const operation = (async () => {
    await Promise.resolve();
    try {
      const source = sourceConceptId === null
        ? null
        : session.concepts.find((entry) => entry.contract.conceptId === sourceConceptId) ?? null;
      let activeContract = contract;
      let admitted = null;
      let admissionFeedback = [];
      for (let attempt = 1; attempt <= 2 && admitted === null; attempt += 1) {
        let generated = null;
        try {
          generated = await prototypeGeneration.generate({
            conceptContract: activeContract,
            admissionFeedback,
          });
          session = prototypeSessions.save({
            ...session,
            generation: {
              ...session.generation,
              inputTokens: session.generation.inputTokens + generated.usage.inputTokens,
              outputTokens: session.generation.outputTokens + generated.usage.outputTokens,
              costUsd: session.generation.costUsd + generated.usage.costUsd,
            },
          });
          const verification = await prototypeVerification.verify({
            conceptContract: activeContract,
            verificationId: `${activeContract.conceptId}-v${activeContract.conceptVersion}-admission`,
          });
          if (verification.status !== "PASSED") {
            throw new TypeError(`Concept "${activeContract.conceptName}" failed browser admission: ${verification.findings.join(" ")}`);
          }
          const concept = {
            contract: activeContract,
            recommended: source?.recommended ?? false,
            recommendationReason: source?.recommendationReason ?? "This customer-composed direction preserves the explicitly selected qualities.",
            keyDistinction: kind === "revision"
              ? `Revised ${classification.scopes.join(", ")}`
              : `Composed from ${activeContract.sourceConceptIds.join(", ")}`,
            tradeoff: kind === "revision"
              ? "A focused change that deliberately preserves unaffected design decisions."
              : "Combining systems adds coordination constraints that the generated prototype must resolve.",
            verificationId: verification.verificationId,
            verificationStatus: verification.status,
            verificationFindings: verification.findings,
            screenshotEvidenceReferences: verification.screenshotEvidenceReferences,
            contentHash: generated.workspace.contentHash,
            usage: generated.usage,
            generatedAt: verification.completedAt,
          };
          const nextConcepts = kind === "revision"
            ? [...session.concepts.filter((entry) => entry.contract.conceptId !== sourceConceptId), concept]
            : [...session.concepts, concept];
          const differentiation = verifyStudioDifferentiation(nextConcepts, [verification]);
          if (differentiation.status !== "PASSED") throw new TypeError(differentiation.finding);
          admitted = { concept, nextConcepts, differentiation };
        } catch (error) {
          const failure = String(error?.message ?? error).slice(0, 1_000);
          admissionFeedback = [failure];
          session = prototypeSessions.save({
            ...session,
            evolution: {
              ...session.evolution,
              conceptVersion: activeContract.conceptVersion,
              attemptFailures: [
                ...(session.evolution?.attemptFailures ?? []),
                { attempt, conceptVersion: activeContract.conceptVersion, error: failure, occurredAt: new Date().toISOString() },
              ],
            },
          });
          if (attempt === 2) throw error;
          const next = structuredClone(activeContract);
          delete next.schemaVersion;
          delete next.integrityHash;
          next.conceptVersion += 1;
          activeContract = createConceptPrototypeContract(next);
          session = prototypeSessions.save({
            ...session,
            evolution: { ...session.evolution, conceptVersion: activeContract.conceptVersion },
          });
        }
      }
      if (admitted === null) throw new TypeError("The concept evolution did not produce an admitted artifact.");
      session = prototypeSessions.save({
        ...session,
        concepts: admitted.nextConcepts,
        conceptHistory: kind === "revision" && source !== null
          ? [...(session.conceptHistory ?? []), source]
          : session.conceptHistory ?? [],
        compositions: composition === null
          ? session.compositions ?? []
          : [...(session.compositions ?? []), composition],
        selectedConceptId: admitted.concept.contract.conceptId,
        differentiationStatus: "PASSED",
        differentiationSignatures: admitted.differentiation.signatures,
        evolution: {
          ...session.evolution,
          status: "PASSED",
          conceptVersion: admitted.concept.contract.conceptVersion,
          changedSummary: kind === "revision"
            ? classification.scopes.map((scope) => `${scope} changed; unaffected contract fields were preserved.`)
            : composition.selectedTraits.map((trait) => `${trait.trait} from ${trait.conceptId}.`),
          conflicts: composition?.conflicts ?? [],
          completedAt: new Date().toISOString(),
        },
      });
      return session;
    } catch (error) {
      session = prototypeSessions.save({
        ...session,
        evolution: {
          ...session.evolution,
          status: "FAILED",
          error: String(error?.message ?? error).slice(0, 1_000),
          completedAt: new Date().toISOString(),
        },
      });
      throw error;
    } finally {
      activeConceptJobs.delete(missionId);
    }
  })();
  activeConceptJobs.set(missionId, operation);
  operation.catch((error) => {
    process.stderr.write(`${new Date().toISOString()} concept evolution ${missionId}: ${String(error?.stack ?? error).slice(0, 4_000)}\n`);
  });
  return operation;
}

function dnaSummary(alternative) {
  const dna = alternative.creativeDNA;
  return dna === undefined
    ? alternative.layoutApproach.value
    : `${dna.compositionPrimitive}; ${dna.typeVoice}; ${dna.imageryTreatment}; ${dna.responsiveTransform}`;
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
      EXHAUSTED: ["Build needs review", "Foundry stopped after bounded, distinct corrections did not resolve the verified issue. No additional paid repair was attempted."],
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
  const productTypeDiscovery =
    control.understanding.latestProductTypeDiscovery(missionId);
  const productBlueprint = control.understanding.blueprint(missionId);
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
  const approvedProjectContract = control.approvedContracts.latest(missionId);
  const executionProjection = projectExecutionProjection({
    contract,
    events,
    profile,
    projectDesign,
    approvedProjectContract,
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
  const generatedMissionCall = control.models
    .listCalls(missionId)
    .filter(
      (call) =>
        call.taskClass === "FILE_GENERATION" &&
        call.status === "SUCCEEDED" &&
        call.structuredOutput?.contractHash !== undefined,
    )
    .at(-1) ?? null;
  const generatedMissionPlan = generatedMissionCall === null
    ? null
    : {
        requestId: generatedMissionCall.requestId,
        provider: generatedMissionCall.provider,
        modelId: generatedMissionCall.modelId,
        contractHash: generatedMissionCall.structuredOutput.contractHash,
        contractVersion: generatedMissionCall.structuredOutput.contractVersion,
        supportedPlatform: generatedMissionCall.structuredOutput.supportedPlatform,
        designDirectionHash:
          generatedMissionCall.structuredOutput.designDirectionHash,
        requirementClaims:
          generatedMissionCall.structuredOutput.requirementClaims,
        explicitExclusionIds:
          generatedMissionCall.structuredOutput.explicitExclusionIds,
        files: generatedMissionCall.structuredOutput.files.map((file) => ({
          path: file.path,
          contractRequirementIds: file.contractRequirementIds,
          contentHash: createHash("sha256").update(file.content).digest("hex"),
        })),
      };
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
    productTypeDiscovery,
    productBlueprint,
    conceptStudio: publicConceptStudio(missionId),
    proposalConfirmed,
    experience,
    contract,
    approvedProjectContract,
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
    generatedMissionPlan,
    activeModelRoute:
      [...routing].reverse().find((route) => route.status === "ACTIVE") ??
      null,
    executionMetrics: control.production.metrics(missionId, events),
    updatedAt: events.at(-1)?.occurredAt ?? null,
  };
}

function missionSummary(missionId) {
  const events = control.ledger.reportEvents(missionId);
  const productTypeDiscovery =
    control.understanding.latestProductTypeDiscovery(missionId);
  const productBlueprint = control.understanding.blueprint(missionId);
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
    productTypeDiscovery,
    productBlueprint,
    conceptStudio: publicConceptStudio(missionId),
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
  if (
    job?.child !== null &&
    job?.child !== undefined &&
    job.child.connected &&
    job.child.exitCode === null
  ) {
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

function routeConceptStudio(pathname) {
  const generate = /^\/missions\/([A-Za-z0-9_-]+)\/concepts\/generate$/u.exec(pathname);
  if (generate !== null) return { kind: "generate", missionId: generate[1], conceptId: null, fileName: null };
  const compose = /^\/missions\/([A-Za-z0-9_-]+)\/concepts\/compose$/u.exec(pathname);
  if (compose !== null) return { kind: "compose", missionId: compose[1], conceptId: null, fileName: null };
  const revise = /^\/missions\/([A-Za-z0-9_-]+)\/concepts\/([A-Za-z0-9._-]+)\/revise$/u.exec(pathname);
  if (revise !== null) return { kind: "revise", missionId: revise[1], conceptId: revise[2], fileName: null };
  const preview = /^\/missions\/([A-Za-z0-9_-]+)\/concepts\/([A-Za-z0-9._-]+)\/preview$/u.exec(pathname);
  if (preview !== null) return { kind: "preview", missionId: preview[1], conceptId: preview[2], fileName: null };
  const evidence = /^\/missions\/([A-Za-z0-9_-]+)\/concepts\/([A-Za-z0-9._-]+)\/evidence\/([A-Za-z0-9._-]+\.png)$/u.exec(pathname);
  if (evidence !== null) return { kind: "evidence", missionId: evidence[1], conceptId: evidence[2], fileName: evidence[3] };
  return null;
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
  const executionRecovery = executionRecoveryDecision(events);
  if (executionRecovery.reason === "provider-attempt-interrupted") {
    activeJobs.set(missionId, {
      child: null,
      error:
        "Project generation was interrupted after provider dispatch. Start explicitly to avoid an automatic duplicate provider charge.",
      completed: false,
    });
  }
  if (executionRecovery.recover) {
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
    const conceptRoute = routeConceptStudio(url.pathname);
    if (request.method === "POST" && conceptRoute?.kind === "generate") {
      const prior = await missionView(conceptRoute.missionId);
      if (prior.state !== "INTAKE" || prior.profile === null) {
        return json(response, 409, { error: "Concepts can be generated only after project understanding and before production execution." });
      }
      const ready = prototypeSessions.read(conceptRoute.missionId);
      if (ready?.status !== "READY" || ready?.differentiationStatus !== "PASSED") {
        startConceptGenerationJob({
          missionId: conceptRoute.missionId,
          understanding: conceptUnderstandingFromProfile(prior.profile),
          sourceProjectDesignVersion: prior.profile?.profileVersion ?? 1,
        });
      }
      return json(response, 202, await missionView(conceptRoute.missionId));
    }
    if (request.method === "POST" && conceptRoute?.kind === "revise") {
      if (activeConceptJobs.has(conceptRoute.missionId)) {
        return json(response, 409, { error: "Foundry is already generating or revising a concept for this project." });
      }
      const session = prototypeSessions.read(conceptRoute.missionId);
      const source = session?.concepts.find((entry) => entry.contract.conceptId === conceptRoute.conceptId);
      if (session?.status !== "READY" || source?.verificationStatus !== "PASSED") {
        return json(response, 409, { error: "Only an admitted concept can be revised." });
      }
      const input = await body(request);
      const priorVersions = prototypeWorkspaces
        .list(conceptRoute.missionId)
        .filter((workspace) => workspace.conceptId === source.contract.conceptId)
        .map((workspace) => workspace.conceptVersion);
      const revision = conceptEvolution.revise({
        sourceConcept: source.contract,
        instruction: input.instruction,
        availableConcepts: [
          ...session.concepts.map((concept) => concept.contract),
          ...(session.conceptHistory ?? []).map((concept) => concept.contract),
        ],
        targetConceptVersion: Math.max(source.contract.conceptVersion, ...priorVersions) + 1,
      });
      startConceptEvolutionJob({
        missionId: conceptRoute.missionId,
        contract: revision.contract,
        classification: revision.classification,
        sourceConceptId: source.contract.conceptId,
        kind: "revision",
      });
      return json(response, 202, {
        accepted: true,
        conceptId: revision.contract.conceptId,
        conceptVersion: revision.contract.conceptVersion,
        changedScopes: revision.classification.scopes,
      });
    }
    if (request.method === "POST" && conceptRoute?.kind === "compose") {
      if (activeConceptJobs.has(conceptRoute.missionId)) {
        return json(response, 409, { error: "Foundry is already generating or revising a concept for this project." });
      }
      const session = prototypeSessions.read(conceptRoute.missionId);
      if (session?.status !== "READY") return json(response, 409, { error: "A ready concept session is required." });
      const input = await body(request);
      const sourceIds = Array.isArray(input.sourceConceptIds) ? input.sourceConceptIds : [];
      const sourceConcepts = sourceIds.map((conceptId) =>
        session.concepts.find((entry) => entry.contract.conceptId === conceptId)?.contract,
      );
      if (sourceConcepts.length < 2 || sourceConcepts.some((contract) => contract === undefined)) {
        return json(response, 400, { error: "Choose at least two admitted source concepts." });
      }
      const compositionId = typeof input.compositionId === "string" && input.compositionId !== ""
        ? input.compositionId
        : `composition-${randomUUID().slice(0, 8)}`;
      const priorCompositionVersions = prototypeWorkspaces
        .list(conceptRoute.missionId)
        .filter((workspace) => workspace.conceptId === compositionId)
        .map((workspace) => workspace.conceptVersion);
      const result = conceptEvolution.compose({
        missionId: conceptRoute.missionId,
        compositionId,
        sourceConcepts,
        selectedTraits: input.selectedTraits,
        customerNotes: Array.isArray(input.customerNotes) ? input.customerNotes : [],
        conflictResolution: Array.isArray(input.conflictResolution) ? input.conflictResolution : [],
        targetConceptVersion: Math.max(0, ...priorCompositionVersions) + 1,
      });
      if (result.status === "CONFLICT") {
        return json(response, 409, {
          error: "Some selected concept qualities need a design resolution before they can be combined.",
          compositionId,
          conflicts: result.conflicts,
        });
      }
      startConceptEvolutionJob({
        missionId: conceptRoute.missionId,
        contract: result.contract,
        classification: { scopes: result.composition.selectedTraits.map((entry) => entry.trait) },
        composition: result.composition,
        kind: "composition",
      });
      return json(response, 202, {
        accepted: true,
        conceptId: result.contract.conceptId,
        conceptVersion: result.contract.conceptVersion,
        composition: result.composition,
      });
    }
    if (request.method === "POST" && conceptRoute?.kind === "preview") {
      const session = prototypeSessions.read(conceptRoute.missionId);
      const concept = session?.concepts.find(
        (entry) => entry.contract.conceptId === conceptRoute.conceptId && entry.verificationStatus === "PASSED",
      );
      if (session?.status !== "READY" || concept === undefined) {
        return json(response, 409, { error: "This concept has not passed live browser admission." });
      }
      const suffix = randomUUID().slice(0, 8);
      const runtime = await prototypeRuntimes.start({
        conceptContract: concept.contract,
        sessionId: `${concept.contract.conceptId}-preview-${suffix}`,
        idempotencyKey: `${concept.contract.conceptId}-preview-key-${suffix}`,
        timeoutMs: 20_000,
        expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
      });
      return json(response, 200, {
        conceptId: concept.contract.conceptId,
        conceptVersion: concept.contract.conceptVersion,
        previewUrl: runtime.previewUrl,
        expiresAt: runtime.expiresAt,
      });
    }
    if (request.method === "GET" && conceptRoute?.kind === "evidence") {
      const session = prototypeSessions.read(conceptRoute.missionId);
      const concept = session?.concepts.find(
        (entry) => entry.contract.conceptId === conceptRoute.conceptId && entry.verificationStatus === "PASSED",
      );
      if (concept === undefined || !concept.screenshotEvidenceReferences.some(
        (reference) => reference.endsWith(`/${conceptRoute.fileName}`),
      )) return json(response, 404, { error: "Concept evidence not found." });
      const workspace = prototypeWorkspaces.get(concept.contract);
      const image = readFileSync(resolve(workspace.evidencePath, concept.verificationId, conceptRoute.fileName));
      response.writeHead(200, {
        "content-type": "image/png",
        "content-length": image.length,
        "cache-control": "private, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
        "x-content-type-options": "nosniff",
      });
      response.end(image);
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
      if (
        answers.length === 1 &&
        answers[0].selection?.kind === "blueprint-approval"
      ) {
        const suffix = `${prior.productBlueprint?.blueprintVersion ?? 0}-${Date.now()}`;
        control.understanding.approveBlueprint({
          missionId: missionRoute.missionId,
          answer: answers[0],
          eventId: `${missionRoute.missionId}-blueprint-approval-${suffix}`,
          causationId: `${missionRoute.missionId}-customer-approval-${suffix}`,
        });
        return json(response, 200, await missionView(missionRoute.missionId));
      }
      const generatedOptionSelectionsOnly =
        answers.length > 0 &&
        answers.every(
          (answer) =>
            answer.selection !== undefined &&
            (answer.selection.mode !== "other" ||
              (answer.selection.kind === "design-direction" &&
                answer.selection.designContract?.selectionMode === "custom" &&
                answer.selection.designContract?.customComposition?.complete === true)) &&
            answer.selection.kind !== "customer-message" &&
            answer.selection.kind !== "product-subtype",
        );
      if (generatedOptionSelectionsOnly) {
        const suffix = `${nextProfileVersion}-${Date.now()}`;
        control.understanding.recordSelections({
          missionId: missionRoute.missionId,
          answers,
          requestId: `${missionRoute.missionId}-selections-${suffix}`,
          eventId: `${missionRoute.missionId}-selection-profile-${suffix}`,
          causationId: `${missionRoute.missionId}-customer-selections-${suffix}`,
        });
        return json(response, 200, await missionView(missionRoute.missionId));
      }
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
  await prototypeRuntimes.stopAll({ reason: "local-api-shutdown" });
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
