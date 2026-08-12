import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ModelTaskClass } from "../src/domain/execution.js";
import { MissionState } from "../src/domain/lifecycle.js";
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
  modelsTimedOutForWorkload,
  rankPrototypeCandidates,
  routingPreferencesForRequest,
} from "../src/work-plane/model-gateway.js";

test("two-minute simple production prefers a fast capable generation route", () => {
  assert.deepEqual(
    routingPreferencesForRequest({
      taskClass: ModelTaskClass.FILE_GENERATION,
      purpose:
        "Adaptive production policy: SIMPLE complexity with a 2-minute completion target.",
      selectedTier: "STANDARD_ENGINEERING",
    }),
    {
      priority: "FAST_RESPONSE",
      preferredLatencyProfile: "FAST",
    },
  );
  assert.deepEqual(
    routingPreferencesForRequest({
      taskClass: ModelTaskClass.FILE_GENERATION,
      purpose:
        "Adaptive production policy: SIMPLE complexity with a 2-minute completion target. Use a server-validated session and a high-entropy session token for credentials.",
      selectedTier: "STANDARD_ENGINEERING",
    }),
    {
      priority: "LOW_COST",
      preferredLatencyProfile: "BALANCED",
    },
  );
  assert.deepEqual(
    routingPreferencesForRequest({
      taskClass: ModelTaskClass.FILE_GENERATION,
      purpose: "Generate a complex production bundle.",
      selectedTier: "STANDARD_ENGINEERING",
    }),
    {
      priority: "LOW_COST",
      preferredLatencyProfile: "BALANCED",
    },
  );
});

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

test("shock concept generation receives the deliberate high-originality strategy without relaxing constraints", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-shock-"));
  let purpose = "";
  try {
    const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
    const base = structuredClone(concept("concept-base"));
    delete base.schemaVersion;
    delete base.integrityHash;
    const shock = createConceptPrototypeContract({
      ...base,
      conceptId: "shock-concept",
      strategy: ConceptStrategy.SHOCK,
      sourceConceptIds: ["concept-base"],
    });
    const generation = createPrototypeGenerationService({
      workspaceService,
      modelGateway: {
        async request(input) {
          purpose = input.purpose;
          return { requestId: input.requestId, structuredOutput: structuredClone(generated), tokenMetadata: {}, costMetadata: {} };
        },
      },
    });
    await generation.generate({ conceptContract: shock });
    assert.match(purpose, /HIGH_ORIGINALITY_STRATEGY/u);
    assert.match(purpose, /uncommon but purposeful composition/u);
    assert.match(purpose, /still satisfy the project outcome/u);
    assert.match(purpose, /Do not create a generic SaaS shell/u);
    assert.match(purpose, /Forbidden literal patterns/u);
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

test("pre-production concepts use the real Model Gateway during clarification while ordinary calls remain forbidden", async (t) => {
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
  control.orchestrator.transition({
    missionId: contract.missionId,
    eventId: `${contract.missionId}-clarifying`,
    causationId: `${contract.missionId}-created`,
    to: MissionState.CLARIFYING,
    reason: "A customer-visible decision remains open while design prototypes are explored.",
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

test("a production timeout does not demote the model that generates prototypes", () => {
  // Design prototypes and production bundles share the FILE_GENERATION task
  // class but differ in output size and timeout budget. Keying the timeout
  // cooldown on task class alone demoted the prototype model on the strength
  // of production timeouts, pushing that work onto heavyweight routes that
  // returned empty files and failed the studio.
  const history = [
    {
      kind: "failure",
      failureCategory: "TIMEOUT",
      taskClass: "FILE_GENERATION",
      executionStage: "PRODUCTION_EXECUTION",
      modelId: "slow-in-production",
    },
    {
      kind: "failure",
      failureCategory: "TIMEOUT",
      taskClass: "FILE_GENERATION",
      executionStage: "DESIGN_PROTOTYPE",
      modelId: "slow-in-prototypes",
    },
    {
      kind: "failure",
      failureCategory: "TRANSIENT_PROVIDER_FAILURE",
      taskClass: "FILE_GENERATION",
      executionStage: "PRODUCTION_EXECUTION",
      modelId: "merely-flaky",
    },
  ];

  const production = modelsTimedOutForWorkload(history, "FILE_GENERATION", "PRODUCTION_EXECUTION");
  assert.equal(production.has("slow-in-production"), true);
  assert.equal(production.has("slow-in-prototypes"), false, "a prototype timeout must not demote a production route");
  assert.equal(production.has("merely-flaky"), false, "only timeouts trigger the cooldown");

  const prototype = modelsTimedOutForWorkload(history, "FILE_GENERATION", "DESIGN_PROTOTYPE");
  assert.equal(prototype.has("slow-in-prototypes"), true);
  assert.equal(prototype.has("slow-in-production"), false, "a production timeout must not demote the prototype route");

  // A different task class is never affected, and an absent stage defaults to
  // production rather than matching everything.
  assert.equal(modelsTimedOutForWorkload(history, "PROJECT_UNDERSTANDING", "PRODUCTION_EXECUTION").size, 0);
  assert.equal(
    modelsTimedOutForWorkload(
      [{ kind: "failure", failureCategory: "TIMEOUT", taskClass: "FILE_GENERATION", modelId: "no-stage" }],
      "FILE_GENERATION",
      "PRODUCTION_EXECUTION",
    ).has("no-stage"),
    true,
  );
});

test("an unsafe prototype is told where the violation is and what to do", async () => {
  // Four concepts in one session were refused with only "files[0] contains
  // unsafe inline styling", each regeneration reproducing the same defect
  // because nothing said where to look. The studio was then left with too few
  // directions to offer a choice and the mission stopped before a build began.
  const { createPrototypeGenerationService } = await import(
    "../src/work-plane/prototype-generation-service.js"
  );
  assert.equal(typeof createPrototypeGenerationService, "function");

  const source = await readFile(
    new URL("../src/work-plane/prototype-generation-service.js", import.meta.url),
    "utf8",
  );

  // The match already holds the offending text and its position; both are now
  // reported, with the file it is in.
  assert.match(source, /const match = unsafe\.pattern\.exec\(file\.content\);/u);
  assert.match(source, /at line \$\{line\} column \$\{column\}/u);
  assert.match(source, /\$\{file\.path\}/u);

  // And each rule says what to do instead, rather than only what is refused.
  assert.match(source, /Move those declarations into styles\.css/u);
  assert.match(source, /CSS gradients, shapes, or inline SVG/u);
  assert.match(source, /Toggle a class or a data attribute/u);
  assert.match(source, /\.setAttribute\\\(\\s\*\["'\]style/u);
  assert.match(source, /native <progress max=/u);
  assert.match(source, /prototype-file-correction/u);
  assert.match(source, /UNSAFE_REMEDY\[unsafe\.reason\]/u);
  assert.match(
    source,
    /Never use eval, new Function, Function\(\), or any string-to-code execution/u,
    "the first calculator attempt must receive the rule that previously cost every direction a retry",
  );
});

test("inline-style output receives one scoped correction before browser admission", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-scoped-correction-"));
  const calls = [];
  try {
    const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
    const unsafe = structuredClone(generated);
    unsafe.files.find((file) => file.path === "concept.js").content =
      "document.querySelector('.progress').setAttribute('style', 'width: 50%')";
    const generation = createPrototypeGenerationService({
      workspaceService,
      modelGateway: {
        async request(input) {
          calls.push(input);
          if (input.requestId.endsWith("prototype-file-correction")) {
            return {
              requestId: input.requestId,
              structuredOutput: {
                files: [
                  {
                    path: "concept.js",
                    content:
                      "const progress=document.querySelector('progress');if(progress)progress.value=50;",
                  },
                ],
              },
              tokenMetadata: { inputTokens: 100, outputTokens: 80 },
              costMetadata: { costUsd: 0.001 },
            };
          }
          return {
            requestId: input.requestId,
            structuredOutput: unsafe,
            tokenMetadata: { inputTokens: 500, outputTokens: 400 },
            costMetadata: { costUsd: 0.01 },
          };
        },
      },
    });
    const result = await generation.generate({
      conceptContract: concept("concept-scoped-correction"),
    });

    assert.equal(calls.length, 2);
    assert.match(calls[1].requestId, /prototype-file-correction$/u);
    assert.match(calls[1].purpose, /native progress element/u);
    assert.equal(result.workspace.status, "FINALIZED");
    assert.equal(result.usage.costUsd, 0.011);
    assert.doesNotMatch(
      readFileSync(join(result.workspace.sourcePath, "concept.js"), "utf8"),
      /setAttribute\(['"]style/iu,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a concept with no heading is refused before it costs a browser round trip", async () => {
  // A calculator direction was admitted-checked at three viewports and refused
  // for "visual hierarchy has no heading", losing half a minute and one of the
  // three directions the studio is meant to offer. A heading is deterministic
  // markup and belongs in this validator.
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-heading-"));
  try {
    const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
    const headless = structuredClone(generated);
    const html = headless.files.find((file) => file.path === "index.html");
    html.content = html.content
      .replace("<h1>Commercial assignments, clearly seen.</h1>", "<p>7 8 9</p>")
      .replace("<h2>Sample: Northline Campaign</h2>", "<p>Sample</p>");
    const generation = createPrototypeGenerationService({
      workspaceService,
      modelGateway: {
        async request(input) {
          return { requestId: input.requestId, structuredOutput: headless, tokenMetadata: {}, costMetadata: {} };
        },
      },
    });
    await assert.rejects(
      generation.generate({ conceptContract: concept("concept-headless") }),
      /at least one heading element/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a concept that has a heading is not refused for lacking one", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-generation-heading-ok-"));
  try {
    const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
    const withHeading = structuredClone(generated);
    withHeading.files.find((file) => file.path === "index.html").content =
      withHeading.files
        .find((file) => file.path === "index.html")
        .content.replace('href="/styles.css"', 'href="styles.css"');
    const generation = createPrototypeGenerationService({
      workspaceService,
      modelGateway: {
        async request(input) {
          return { requestId: input.requestId, structuredOutput: withHeading, tokenMetadata: {}, costMetadata: {} };
        },
      },
    });
    await assert.doesNotReject(
      generation.generate({ conceptContract: concept("concept-with-heading") }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
