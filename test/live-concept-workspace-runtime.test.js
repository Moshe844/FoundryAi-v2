import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import {
  ConceptStrategy,
  createConceptPrototypeContract,
} from "../src/domain/live-concept-studio.js";
import { createPrototypeWorkspaceService } from "../src/work-plane/prototype-workspace-service.js";
import { createPrototypeRuntimeService } from "../src/work-plane/prototype-runtime-service.js";

function contract({ conceptId = "concept-one", missionId = "mission-one", version = 1 } = {}) {
  return createConceptPrototypeContract({
    conceptId,
    missionId,
    conceptVersion: version,
    conceptName: `Concept ${conceptId}`,
    creativeThesis: "A project-specific live concept.",
    intendedAudienceResponse: "Understand the product immediately.",
    designRationale: "The composition makes the primary journey visible.",
    projectSurfaces: ["Opening", "Primary work", "Action"],
    pageOrScreenSequence: ["Opening", "Primary work", "Action"],
    navigationModel: "Direct semantic navigation.",
    compositionRules: ["Use a deliberate responsive composition."],
    typographySystem: { display: "system-ui", body: "system-ui", scale: "measured" },
    colorSystem: {
      background: "#f4f1ea",
      surface: "#ffffff",
      text: "#161616",
      primary: "#161616",
      accent: "#b84d24",
    },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40, 64] },
    imageryStrategy: "CSS-only project-appropriate image fields.",
    componentCharacter: "Clear and editorial.",
    interactionRules: ["Navigation updates the visible section."],
    motionRules: ["Honor reduced motion."],
    responsiveRules: ["Stack content below 640px."],
    accessibilityRules: ["Visible focus states."],
    deliberateExclusions: ["No external scripts."],
    sampleContentPolicy: "Use clearly fictional project content.",
    expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [
      { checkId: "runtime", kind: "runtime", statement: "The prototype loads." },
    ],
    sourceProjectDesignVersion: 1,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
  });
}

function files(name) {
  return {
    "index.html": `<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><main><h1>${name}</h1><button id="change">Change</button></main><script type="module" src="/concept.js"></script></body></html>`,
    "styles.css": "body{margin:0;font-family:system-ui}main{display:grid;max-width:70rem;margin:auto;padding:2rem}@media(max-width:640px){main{grid-template-columns:1fr}}",
    "concept.js": "document.querySelector('#change')?.addEventListener('click',()=>document.body.dataset.changed='true');",
  };
}

test("prototype workspaces are isolated, immutable, idempotent, and restart recoverable", () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-concepts-"));
  try {
    const service = createPrototypeWorkspaceService({ prototypeRoot: root });
    const leftContract = contract({ conceptId: "concept-left" });
    const rightContract = contract({ conceptId: "concept-right" });
    const left = service.provision(leftContract);
    const right = service.provision(rightContract);

    assert.notEqual(left.rootPath, right.rootPath);
    assert.equal(relative(root, left.rootPath).startsWith(".."), false);
    assert.match(left.rootPath.replaceAll("\\", "/"), /mission-one\/concept-left\/v1$/u);
    assert.throws(
      () => service.writeFiles(leftContract, { "../escape.html": "no" }),
      /workspace|expected file|relative/iu,
    );
    assert.throws(
      () => service.writeFiles(leftContract, { "unexpected.html": "no" }),
      /expected file/iu,
    );

    service.writeFiles(leftContract, files("Left concept"));
    service.writeFiles(rightContract, files("Right concept"));
    const leftFinal = service.finalize(leftContract);
    const leftAgain = service.finalize(leftContract);

    assert.equal(leftFinal.contentHash, leftAgain.contentHash);
    assert.equal(leftFinal.fileManifest.length, 3);
    assert.equal(readFileSync(join(left.rootPath, "source", "index.html"), "utf8").includes("Left concept"), true);
    assert.equal(readFileSync(join(right.rootPath, "source", "index.html"), "utf8").includes("Right concept"), true);
    assert.throws(
      () => service.writeFiles(leftContract, { "index.html": "changed" }),
      /immutable|finalized/iu,
    );

    const recovered = createPrototypeWorkspaceService({ prototypeRoot: root });
    const recoveredLeft = recovered.get(leftContract);
    assert.equal(recoveredLeft.contentHash, leftFinal.contentHash);
    assert.equal(recoveredLeft.status, "FINALIZED");
    assert.deepEqual(recovered.list("mission-one").map((entry) => entry.conceptId).sort(), [
      "concept-left",
      "concept-right",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prototype runtime serves real files with strict containment and cleans up", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-runtime-"));
  const workspace = createPrototypeWorkspaceService({ prototypeRoot: root });
  const runtime = createPrototypeRuntimeService({ workspaceService: workspace });
  const selected = contract();
  try {
    workspace.provision(selected);
    workspace.writeFiles(selected, files("Runnable concept"));
    workspace.finalize(selected);

    const session = await runtime.start({
      conceptContract: selected,
      sessionId: "session-one",
      idempotencyKey: "runtime-one",
      timeoutMs: 5_000,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const same = await runtime.start({
      conceptContract: selected,
      sessionId: "session-one",
      idempotencyKey: "runtime-one",
      timeoutMs: 5_000,
      expiresAt: session.expiresAt,
    });

    assert.equal(same.previewUrl, session.previewUrl);
    const response = await fetch(session.previewUrl);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Runnable concept/u);
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/u);
    assert.match(response.headers.get("content-security-policy"), /connect-src 'none'/u);
    assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
    assert.equal((await fetch(`${session.previewUrl}/../manifest.json`)).status, 404);

    const stopped = await runtime.stop({ sessionId: session.sessionId, reason: "preview-closed" });
    assert.equal(stopped.status, "STOPPED");
    await assert.rejects(fetch(session.previewUrl), /fetch failed|ECONNREFUSED/iu);

    const recoveredRuntime = createPrototypeRuntimeService({ workspaceService: workspace });
    assert.equal(recoveredRuntime.get(session.sessionId).status, "STOPPED");
  } finally {
    await runtime.stopAll({ reason: "test-cleanup" });
    rmSync(root, { recursive: true, force: true });
  }
});

test("prototype runtime expires bounded sessions and rejects idempotency drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-runtime-expiry-"));
  const workspace = createPrototypeWorkspaceService({ prototypeRoot: root });
  const runtime = createPrototypeRuntimeService({ workspaceService: workspace });
  const selected = contract({ conceptId: "expiring-concept" });
  try {
    workspace.provision(selected);
    assert.throws(
      () => workspace.writeFiles(selected, { "index.html": "x".repeat(1_000_001) }),
      /output limit/iu,
    );
    workspace.writeFiles(selected, files("Expiring concept"));
    workspace.finalize(selected);
    const expiresAt = new Date(Date.now() + 150).toISOString();
    const session = await runtime.start({
      conceptContract: selected,
      sessionId: "expiring-session",
      idempotencyKey: "expiring-key",
      timeoutMs: 5_000,
      expiresAt,
    });
    await assert.rejects(
      runtime.start({
        conceptContract: selected,
        sessionId: "different-session",
        idempotencyKey: "expiring-key",
        timeoutMs: 5_000,
        expiresAt: new Date(Date.now() + 5_000).toISOString(),
      }),
      /idempotencyKey/iu,
    );
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(runtime.get(session.sessionId).status, "EXPIRED");
    await assert.rejects(fetch(session.previewUrl), /fetch failed|ECONNREFUSED/iu);
  } finally {
    await runtime.stopAll({ reason: "test-cleanup" });
    rmSync(root, { recursive: true, force: true });
  }
});
