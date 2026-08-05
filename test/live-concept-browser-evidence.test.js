import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConceptStrategy, createConceptPrototypeContract } from "../src/domain/live-concept-studio.js";
import {
  createChromePrototypeBrowserVerifier,
  resolveCertifiedPrototypeBrowser,
} from "../src/work-plane/prototype-browser-verifier.js";
import { createPrototypeRuntimeService } from "../src/work-plane/prototype-runtime-service.js";
import { createPrototypeVerificationService } from "../src/work-plane/prototype-verification-service.js";
import { createPrototypeWorkspaceService } from "../src/work-plane/prototype-workspace-service.js";

function contract(conceptId) {
  return createConceptPrototypeContract({
    conceptId,
    missionId: "mission-live-browser-evidence",
    conceptVersion: 1,
    conceptName: conceptId === "concept-cinematic" ? "Cinematic Field Notes" : "Editorial Index",
    creativeThesis: conceptId === "concept-cinematic" ? "Use immersive visual chapters." : "Use a precise assignment index.",
    intendedAudienceResponse: "Understand the work and confidently make contact.",
    designRationale: "The composition gives the project a specific visual and interaction proof.",
    projectSurfaces: ["Opening", "Work", "Inquiry"],
    pageOrScreenSequence: ["Opening", "Selected work", "Inquiry"],
    navigationModel: "Anchor navigation with persistent project context.",
    compositionRules: ["Use a project-specific responsive composition."],
    typographySystem: { display: "Georgia", body: "Arial", scale: "editorial" },
    colorSystem: { background: "#111111", surface: "#202020", text: "#f5f0e8", primary: "#f5f0e8", accent: "#d49a64" },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40, 64] },
    imageryStrategy: "Use local CSS art direction with fictional sample assignments.",
    componentCharacter: "Sharp editorial plates with calm controls.",
    interactionRules: ["Navigation moves to real representative surfaces."],
    motionRules: ["Honor reduced motion."],
    responsiveRules: ["Transform to one column on mobile."],
    accessibilityRules: ["Use semantic landmarks.", "Keep keyboard focus visible."],
    deliberateExclusions: ["No external scripts.", "No production integrations."],
    sampleContentPolicy: "Use fictional, clearly representative content.",
    expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [
      { checkId: "browser", kind: "browser", statement: "Desktop, tablet, and mobile render without errors or overflow." },
    ],
    sourceProjectDesignVersion: 1,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
  });
}

function files(kind = "good") {
  const overflow = kind === "overflow" ? "width:1400px" : "max-width:80rem";
  const composition = kind === "alternate"
    ? "display:flex;flex-direction:column-reverse;gap:3rem"
    : "display:grid;grid-template-columns:1.4fr .6fr;gap:4rem";
  const alternateDecoration = kind === "alternate" ? "section{border-left:10px solid #d49a64}" : "";
  return {
    "index.html": '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sample commercial portfolio</title><link rel="stylesheet" href="/styles.css"><script type="module" src="/concept.js"></script></head><body><header><nav aria-label="Primary"><a href="#work">Work</a><a href="#inquiry">Inquiry</a></nav></header><main><section><h1>Light shaped for ambitious campaigns.</h1><p>Fictional sample portfolio for concept review.</p></section><section id="work"><h2>Selected assignments</h2><article><h3>Sample Northline campaign</h3></article></section><section id="inquiry"><h2>Start an inquiry</h2><button type="button">Open sample inquiry</button></section></main><footer>Sample content only</footer></body></html>',
    "styles.css": `*{box-sizing:border-box}body{margin:0;background:#111;color:#f5f0e8;font:18px Arial,sans-serif}header,footer{padding:1.5rem}nav{display:flex;gap:2rem}a{color:inherit}main{${overflow};margin:auto;padding:4rem;${composition}}section{min-height:12rem}${alternateDecoration}button{padding:1rem}@media(max-width:640px){main{grid-template-columns:1fr!important;padding:1.25rem;gap:1.5rem}nav{flex-wrap:wrap}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`,
    "concept.js": kind === "browser-error"
      ? "throw new Error('deterministic concept crash')"
      : "document.querySelector('button').addEventListener('click',()=>document.body.dataset.inquiry='open');",
  };
}

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-live-browser-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspaceService = createPrototypeWorkspaceService({ prototypeRoot: root });
  const runtimeService = createPrototypeRuntimeService({ workspaceService });
  t.after(() => runtimeService.stopAll({ reason: "test-cleanup" }));
  const executablePath = resolveCertifiedPrototypeBrowser();
  assert.notEqual(executablePath, null, "A certified local Chrome/Edge browser is required for live evidence tests.");
  const browserVerifier = createChromePrototypeBrowserVerifier({ executablePath, timeoutMs: 30_000 });
  return {
    root,
    workspaceService,
    runtimeService,
    verification: createPrototypeVerificationService({ browserVerifier, workspaceService, runtimeService }),
  };
}

function materialize(workspaceService, concept, sourceFiles) {
  workspaceService.provision(concept);
  workspaceService.writeFiles(concept, sourceFiles);
  return workspaceService.finalize(concept);
}

test("live Chrome admits a responsive concept and persists immutable screenshots and DOM evidence", async (t) => {
  const services = setup(t);
  const concept = contract("concept-cinematic");
  const workspace = materialize(services.workspaceService, concept, files());
  const result = await services.verification.verify({
    conceptContract: concept,
    verificationId: "cinematic-v1-verification",
  });

  assert.equal(result.status, "PASSED", result.findings.join("\n"));
  assert.equal(result.observations.length, 3);
  assert(result.observations.every((entry) => entry.measurement.horizontalOverflow === false));
  assert(result.observations.every((entry) => entry.browserErrors.length === 0));
  assert.equal(result.screenshotEvidenceReferences.length, 3);
  for (const reference of result.screenshotEvidenceReferences) {
    const path = join(workspace.rootPath, reference);
    assert.equal(existsSync(path), true, path);
    assert(readFileSync(path).length > 1_000);
  }
  const recordPath = join(workspace.evidencePath, "cinematic-v1-verification", "verification.json");
  assert.equal(JSON.parse(readFileSync(recordPath, "utf8")).integrityHash, result.integrityHash);
  assert.throws(
    () => services.workspaceService.writeEvidenceFiles(concept, {
      "cinematic-v1-verification/verification.json": "tamper",
    }),
    /immutable/u,
  );
});

test("overflow is rejected before display and duplicate concept evidence fails differentiation", async (t) => {
  const services = setup(t);
  const broken = contract("concept-overflow");
  materialize(services.workspaceService, broken, files("overflow"));
  const rejected = await services.verification.verify({
    conceptContract: broken,
    verificationId: "overflow-v1-verification",
  });
  assert.equal(rejected.status, "REJECTED");
  assert.match(rejected.findings.join("\n"), /horizontal overflow/u);

  const first = contract("concept-editorial-a");
  const second = contract("concept-editorial-b");
  materialize(services.workspaceService, first, files());
  materialize(services.workspaceService, second, files());
  const firstResult = await services.verification.verify({ conceptContract: first, verificationId: "editorial-a-verification" });
  const secondResult = await services.verification.verify({ conceptContract: second, verificationId: "editorial-b-verification" });
  const differentiation = services.verification.verifyDifferentiation([firstResult, secondResult]);
  assert.equal(differentiation.status, "REJECTED");

  const alternate = contract("concept-alternate");
  materialize(services.workspaceService, alternate, files("alternate"));
  const alternateResult = await services.verification.verify({ conceptContract: alternate, verificationId: "alternate-verification" });
  assert.equal(services.verification.verifyDifferentiation([firstResult, alternateResult]).status, "PASSED");
});

test("a blocking browser exception is rejected with persisted diagnostic evidence", async (t) => {
  const services = setup(t);
  const broken = contract("concept-browser-error");
  materialize(services.workspaceService, broken, files("browser-error"));
  const rejected = await services.verification.verify({
    conceptContract: broken,
    verificationId: "browser-error-verification",
  });
  assert.equal(rejected.status, "REJECTED");
  assert.match(rejected.findings.join("\n"), /browser errors|concept crash/iu);
  assert(rejected.observations.some((observation) => observation.browserErrors.length > 0));
});
