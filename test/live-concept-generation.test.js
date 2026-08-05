import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ModelTaskClass } from "../src/domain/execution.js";
import { openMissionControl } from "../src/control-plane/mission-control.js";
import {
  ConceptStrategy,
  createConceptPrototypeContract,
} from "../src/domain/live-concept-studio.js";
import {
  CONCEPT_GENERATION_OUTPUT_SCHEMA,
  createPrototypeGenerationService,
} from "../src/work-plane/prototype-generation-service.js";
import { createPrototypeWorkspaceService } from "../src/work-plane/prototype-workspace-service.js";
import {
  ModelExecutionStage,
  createDeterministicLocalModelProvider,
  prototypeModelsInCooldown,
  rankPrototypeCandidates,
} from "../src/work-plane/model-gateway.js";

function concept(conceptId = "concept-editorial") {
  return createConceptPrototypeContract({
    conceptId,
    missionId: "mission-commercial-photographer",
    conceptVersion: 1,
    conceptName: "Editorial Assignments",
    creativeThesis: "Present commercial work as decisive visual case studies.",
    intendedAudienceResponse: "See range and production confidence immediately.",
    designRationale: "An editorial sequence supports art buyers without becoming a generic agency page.",
    projectSurfaces: ["Opening", "Assignments", "Capabilities", "Inquiry"],
    pageOrScreenSequence: ["Opening image", "Assignment index", "Production proof", "Inquiry"],
    navigationModel: "Compact index navigation with persistent inquiry access.",
    compositionRules: ["Use an asymmetric image-led editorial grid."],
    typographySystem: { display: "Georgia", body: "Arial", scale: "dramatic" },
    colorSystem: { background: "#121212", surface: "#1d1d1d", text: "#f4f1ea", primary: "#f4f1ea", accent: "#d3a86f" },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40, 64, 96] },
    imageryStrategy: "Large fictional assignment plates with concise captions.",
    componentCharacter: "Sharp, editorial, and image dominant.",
    interactionRules: ["Project links reveal details without losing index position."],
    motionRules: ["Use restrained transitions.", "Honor reduced motion."],
    responsiveRules: ["Reflow into an image-first single column below 640px."],
    accessibilityRules: ["Visible focus.", "Descriptive alternatives."],
    deliberateExclusions: ["No generic agency hero.", "No external scripts."],
    sampleContentPolicy: "Use fictional assignments and clients clearly marked as sample content.",
    expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [
      { checkId: "loads", kind: "runtime", statement: "The concept loads." },
      { checkId: "responsive", kind: "browser", statement: "The concept reflows without overflow." },
    ],
    sourceProjectDesignVersion: 4,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
  });
}

const generated = {
  files: [
    {
      path: "index.html",
      content: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/styles.css"></head><body><header><a href="#work">Assignments</a></header><main><section><h1>Commercial assignments, clearly seen.</h1></section><section id="work"><article><h2>Sample: Northline Campaign</h2></article></section><a href="#inquiry">Discuss an assignment</a></main><script type="module" src="/concept.js"></script></body></html>',
    },
    {
      path: "styles.css",
      content: ':root{--bg:#121212;--text:#f4f1ea}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Arial,sans-serif}main{display:grid;grid-template-columns:1.4fr .6fr;gap:4rem;max-width:90rem;margin:auto;padding:4rem}@media(max-width:640px){main{grid-template-columns:1fr;padding:1.25rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}',
    },
    {
      path: "concept.js",
      content: "document.querySelectorAll('a[href^=\"#\"]').forEach((link)=>link.addEventListener('click',()=>document.body.dataset.navigated='true'));",
    },
  ],
  generationSummary: "Generated the exact editorial photographer concept contract.",
};

test("prototype generation routes the exact contract and writes real isolated files once", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-"));
  const calls = [];
  const modelGateway = {
    async request(input) {
      calls.push(input);
      return {
        requestId: input.requestId,
        structuredOutput: structuredClone(generated),
        tokenMetadata: { inputTokens: 1200, outputTokens: 900 },
        costMetadata: { costUsd: 0.012 },
      };
    },
  };
  try {
    const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
    const generation = createPrototypeGenerationService({ modelGateway, workspaceService });
    const contract = concept();
    const first = await generation.generate({ conceptContract: contract });
    const second = await generation.generate({ conceptContract: contract });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].taskClass, ModelTaskClass.FILE_GENERATION);
    assert.equal(calls[0].executionStage, ModelExecutionStage.DESIGN_PROTOTYPE);
    assert.equal(calls[0].depthLevel, 2);
    assert.match(calls[0].purpose, new RegExp(contract.integrityHash, "u"));
    assert.match(calls[0].purpose, /Present commercial work as decisive visual case studies/u);
    assert.deepEqual(calls[0].contextReferences, [
      { kind: "concept-prototype-contract", id: contract.integrityHash },
      { kind: "project-design-version", id: "mission-commercial-photographer-v4" },
    ]);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(first.workspace.contentHash, second.workspace.contentHash);
    assert.match(readFileSync(join(first.workspace.sourcePath, "index.html"), "utf8"), /Northline Campaign/u);
    assert.equal(first.usage.costUsd, 0.012);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prototype admission rejects unsafe or contract-incomplete model output before writes", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-reject-"));
  const unsafeGateway = {
    async request(input) {
      return {
        requestId: input.requestId,
        structuredOutput: {
          files: [
            ...generated.files.filter((file) => file.path !== "concept.js"),
            { path: "concept.js", content: "fetch('https://example.com/steal')" },
          ],
          generationSummary: "Unsafe output",
        },
        tokenMetadata: { inputTokens: 1, outputTokens: 1 },
        costMetadata: { costUsd: 0 },
      };
    },
  };
  try {
    const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
    const generation = createPrototypeGenerationService({ modelGateway: unsafeGateway, workspaceService });
    const contract = concept("concept-unsafe");
    await assert.rejects(generation.generate({ conceptContract: contract }), /network|unsafe/iu);
    assert.equal(workspaceService.get(contract).status, "PROVISIONED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prototype safety admits ordinary CSS top positioning but rejects real parent-window access", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-css-safety-"));
  try {
    const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
    const safeOutput = structuredClone(generated);
    safeOutput.files.find((file) => file.path === "index.html").content =
      safeOutput.files.find((file) => file.path === "index.html").content.replace('href="/styles.css"', 'href="styles.css"');
    safeOutput.files.find((file) => file.path === "styles.css").content += ".sticky{position:sticky;top:0}";
    safeOutput.files.find((file) => file.path === "concept.js").content =
      "// Keep this interaction local.\ndocument.body.dataset.ready='true'";
    const safeGeneration = createPrototypeGenerationService({
      workspaceService,
      modelGateway: {
        async request(input) {
          return { requestId: input.requestId, structuredOutput: safeOutput, tokenMetadata: {}, costMetadata: {} };
        },
      },
    });
    await safeGeneration.generate({ conceptContract: concept("concept-safe-css-top") });

    const unsafeContract = concept("concept-real-parent-access");
    const unsafeGeneration = createPrototypeGenerationService({
      workspaceService,
      modelGateway: {
        async request(input) {
          const output = structuredClone(generated);
          output.files.find((file) => file.path === "concept.js").content = "window.parent.postMessage('escape', '*')";
          return { requestId: input.requestId, structuredOutput: output, tokenMetadata: {}, costMetadata: {} };
        },
      },
    });
    await assert.rejects(
      unsafeGeneration.generate({ conceptContract: unsafeContract }),
      /parent-window control/u,
    );

    const embeddedUrlContract = concept("concept-data-url");
    const embeddedUrlGeneration = createPrototypeGenerationService({
      workspaceService,
      modelGateway: {
        async request(input) {
          const output = structuredClone(generated);
          output.files.find((file) => file.path === "index.html").content = output.files
            .find((file) => file.path === "index.html")
            .content.replace("</head>", '<link rel="stylesheet" href="data:text/css,"></head>');
          return { requestId: input.requestId, structuredOutput: output, tokenMetadata: {}, costMetadata: {} };
        },
      },
    });
    await assert.rejects(
      embeddedUrlGeneration.generate({ conceptContract: embeddedUrlContract }),
      /unsafe embedded or executable URL/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prototype routing prefers low-cost fast capable models over historical heavyweight defaults", () => {
  const ranked = rankPrototypeCandidates([
    { modelId: "slow-opus", totalCostPerMillionTokensUsd: 30, latencyProfile: "THOROUGH", reliability: { estimatedFailureRate: 0.1 } },
    { modelId: "fast-low-cost", totalCostPerMillionTokensUsd: 1, latencyProfile: "FAST", reliability: { estimatedFailureRate: 0.4 } },
    { modelId: "balanced-low-cost", totalCostPerMillionTokensUsd: 1, latencyProfile: "BALANCED", reliability: { estimatedFailureRate: 0.2 } },
  ]);
  assert.deepEqual(ranked.map((candidate) => candidate.modelId), [
    "fast-low-cost",
    "balanced-low-cost",
    "slow-opus",
  ]);
});

test("prototype routing cools down a model after consecutive admission failures even when it succeeded historically", () => {
  const cooldowns = prototypeModelsInCooldown([
    { kind: "result", status: "SUCCEEDED", modelId: "historically-good" },
    { kind: "failure", modelId: "historically-good" },
    { kind: "failure", modelId: "historically-good" },
    { kind: "failure", modelId: "one-miss" },
  ]);
  assert.equal(cooldowns.has("historically-good"), true);
  assert.equal(cooldowns.has("one-miss"), false);
  assert.equal(prototypeModelsInCooldown([
    { kind: "failure", modelId: "recovered" },
    { kind: "failure", modelId: "recovered" },
    { kind: "result", status: "SUCCEEDED", modelId: "recovered" },
  ]).has("recovered"), false);
});

test("INTAKE concepts use the real Model Gateway while ordinary pre-execution calls remain forbidden", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-gateway-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let providerCalls = 0;
  const provider = createDeterministicLocalModelProvider({
    providerId: "concept-generation-fixture",
    handler() {
      providerCalls += 1;
      return {
        output: structuredClone(generated),
        usage: { inputTokens: 500, outputTokens: 700, costUsd: 0.004 },
      };
    },
  });
  const control = openMissionControl({
    ledgerDirectory: join(root, "ledger"),
    evidenceDirectory: join(root, "evidence"),
    workspaceDirectory: join(root, "production-workspaces"),
    registryDirectory: join(root, "registry"),
    modelProviders: [provider],
    clock: () => "2026-08-04T12:00:00.000Z",
  });
  const contract = concept();
  control.orchestrator.createMission({
    missionId: contract.missionId,
    eventId: `${contract.missionId}-created`,
    causationId: `${contract.missionId}-intent`,
    occurredAt: "2026-08-04T12:00:00.000Z",
    reason: "Generate approval prototypes before production execution.",
  });
  const workspaceService = createPrototypeWorkspaceService({
    prototypeRoot: join(root, "prototype-root"),
  });
  const generation = createPrototypeGenerationService({
    modelGateway: control.models,
    workspaceService,
  });

  const result = await generation.generate({ conceptContract: contract });
  assert.equal(providerCalls, 1);
  assert.equal(result.workspace.status, "FINALIZED");
  assert.equal(control.models.listCalls(contract.missionId).length, 1);
  assert.equal(
    control.evidence.findByMission(contract.missionId).at(-1).metadata.executionStage,
    ModelExecutionStage.DESIGN_PROTOTYPE,
  );

  await assert.rejects(
    control.models.request({
      requestId: "ordinary-intake-call",
      missionId: contract.missionId,
      workUnitId: "ordinary-intake-work",
      idempotencyKey: "ordinary-intake-key",
      purpose: "This call has no prototype authority.",
      taskClass: ModelTaskClass.FILE_GENERATION,
      contextReferences: [{ kind: "project-design-version", id: "version-4" }],
      expectedStructuredOutputSchema: CONCEPT_GENERATION_OUTPUT_SCHEMA,
      sensitiveValues: [],
    }),
    /only during EXECUTING/u,
  );
});
