import assert from "node:assert/strict";
import test from "node:test";

import { contractBoundModelPrompt } from "../src/domain/contract-bound-execution.js";
import { designExecutionBrief, validateGeneratedDesignFidelity } from "../src/domain/design-fidelity.js";
import {
  approvedDesignPromptSegments,
  bindApprovedPrototypeBrowserEvidence,
  bindApprovedPrototypeFidelityIdentity,
  bindApprovedPrototypeSourceGuardrails,
  bundleBudgetInstruction,
  comparablePrototypeDesign,
  generationProfileView,
} from "../src/work-plane/production-mission-service.js";
import {
  ConceptStrategy,
  createApprovedDesignContract,
  createConceptPrototypeContract,
} from "../src/domain/live-concept-studio.js";
import { validateStructuredSelectionsAgainstCurrent } from "../src/understanding-plane/project-understanding-service.js";

function fixture() {
  const concept = createConceptPrototypeContract({
    conceptId: "concept-cinematic",
    missionId: "mission-production-binding",
    conceptVersion: 3,
    conceptName: "Cinematic Commission",
    creativeThesis: "A cinematic opening moves into a precise commercial project index.",
    intendedAudienceResponse: "Confidence that the photographer can handle a major commission.",
    designRationale: "The experience balances impact with proof.",
    projectSurfaces: ["Opening story", "Selected work", "Inquiry"],
    pageOrScreenSequence: ["Opening story", "Selected work", "Inquiry"],
    navigationModel: "Overlay navigation that becomes an inline mobile menu.",
    compositionRules: ["Use a split cinematic opening and an offset project index."],
    typographySystem: { display: "Fraunces", body: "Inter" },
    colorSystem: {
      background: "#12100f",
      surface: "#211d1a",
      text: "#f5efe5",
      primary: "#eadac8",
      accent: "#c98555",
    },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40, 64] },
    imageryStrategy: "Large edge-to-edge commission imagery.",
    componentCharacter: "Quiet controls over editorial surfaces.",
    interactionRules: ["Project links reveal concise commission details."],
    motionRules: ["static"],
    responsiveRules: ["The split opening becomes one deliberate mobile sequence."],
    accessibilityRules: ["Visible keyboard focus", "Semantic landmarks"],
    deliberateExclusions: ["No generic card dashboard"],
    sampleContentPolicy: "Use fictional commercial photography commissions.",
    expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [{ checkId: "responsive", kind: "browser", statement: "Render at three viewports." }],
    sourceProjectDesignVersion: 2,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
  });
  const approved = createApprovedDesignContract({
    missionId: concept.missionId,
    selectedConcept: concept,
    customerModifications: ["Make mobile the priority."],
    prototypeFileManifest: concept.expectedFiles.map((path, index) => ({
      path,
      contentHash: String(index + 1).repeat(64),
      size: 100 + index,
    })),
    screenshotEvidenceReferences: ["evidence/desktop.png", "evidence/tablet.png", "evidence/mobile.png"],
    browserEvidenceReferences: ["evidence/verification.json"],
    prototypeContentHash: "d".repeat(64),
    approvalTimestamp: "2026-08-05T02:00:00.000Z",
  });
  const contract = {
    selectedDesignDirection: { interactionStyle: "Quiet and direct." },
    productBlueprint: {
      designSpecification: {
        selectedDirectionName: concept.conceptName,
        composition: {
          layoutApproach: concept.compositionRules.join(" "),
          navigationApproach: concept.navigationModel,
          informationDensity: "Measured",
          mobileBehavior: concept.responsiveRules.join(" "),
        },
        visualCharacter: {
          personality: concept.creativeThesis,
          typography: "Fraunces with Inter",
          colorMood: "Dark editorial warmth",
          hierarchy: "Cinematic opening before project proof",
          spacingDensity: "Measured",
        },
        renderContract: { renderContractId: "obsolete-card-renderer" },
        approvedDesignContract: approved,
        accessibilityRequirements: concept.accessibilityRules,
      },
    },
  };
  return { approved, contract };
}

test("production binding makes the real prototype seed authoritative", () => {
  const { approved, contract } = fixture();
  const brief = designExecutionBrief(contract);

  assert.equal(brief.approvedPrototypeSeed.authority, "IMMUTABLE_LIVE_PROTOTYPE");
  assert.equal(brief.approvedPrototypeSeed.approvedDesignId, approved.approvedDesignId);
  assert.equal(brief.approvedPrototypeSeed.prototypeContentHash, approved.prototypeContentHash);
  assert.deepEqual(brief.approvedPrototypeSeed.prototypeFileManifest, approved.prototypeFileManifest);
  assert.deepEqual(brief.approvedPrototypeSeed.screenshotEvidenceReferences, approved.screenshotEvidenceReferences);
  assert.equal(brief.renderContract, null, "the card-era renderer must not compete with real HTML prototype files");

  const prompt = contractBoundModelPrompt({ approvedContract: { designExecutionBrief: brief } }, ["Build it."]);
  assert.match(prompt, /primary and immutable design authority/u);
  assert.match(prompt, new RegExp(approved.prototypeContentHash, "u"));
});

test("production admission rejects a bundle that changes the approved prototype binding", () => {
  const { approved, contract } = fixture();
  const source = `export default function Page(){return <main><section>Opening story split cinematic</section><section>Selected work offset project index</section><section>Inquiry</section></main>}`;
  const css = `:root{--bg:#12100f;--surface:#211d1a;--text:#f5efe5;--primary:#eadac8;--accent:#c98555}main{display:grid;font-family:Fraunces,serif;font-size:1rem;color:var(--text);background:var(--bg);max-width:90rem;width:100%;margin:auto}@media(max-width:768px){main{grid-template-columns:1fr}}`;
  const browser = `await page.setViewportSize({width:390,height:844});await page.screenshot({path:'phone.png'});await page.setViewportSize({width:768,height:1024});await page.screenshot({path:'tablet.png'});await page.setViewportSize({width:1280,height:900});await page.screenshot({path:'desktop.png'});await page.evaluate(()=>{const e=document.querySelector('main');const s=getComputedStyle(e);return {box:e.getBoundingClientRect(),fontFamily:s.fontFamily,fontSize:s.fontSize,backgroundColor:s.backgroundColor,color:s.color,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,focus:document.activeElement}});`;
  const plan = {
    designFidelity: {
      approvedDesignId: approved.approvedDesignId,
      approvedPrototypeContentHash: approved.prototypeContentHash,
      approvedConceptVersion: approved.selectedConceptVersion,
      compositionImplementation: "The split cinematic Opening story leads to Selected work in an offset project index and then Inquiry.",
      typographyImplementation: "Fraunces display typography and Inter body typography preserve the approved hierarchy.",
      colorImplementation: "The exact dark background, light text, and warm accent tokens are preserved.",
      responsiveImplementation: "The split opening becomes one deliberate mobile sequence without overflow.",
      interactionImplementation: "Project links reveal concise commission details with quiet direct controls.",
      sourceFiles: ["app/page.tsx", "app/styles.css"],
      browserEvidence: {
        capturesScreenshots: true,
        measuresComposition: true,
        measuresTypography: true,
        measuresColor: true,
        measuresResponsiveTransformation: true,
      },
    },
    files: [
      { path: "app/page.tsx", content: source },
      { path: "app/styles.css", content: css },
      { path: "tests/design.spec.ts", content: browser },
    ],
  };
  const fail = (message) => { throw new Error(message); };

  assert.doesNotThrow(() => validateGeneratedDesignFidelity(plan, contract, fail));
  const tampered = structuredClone(plan);
  tampered.designFidelity.approvedPrototypeContentHash = "e".repeat(64);
  assert.throws(
    () => validateGeneratedDesignFidelity(tampered, contract, fail),
    /content hash/u,
  );
});

test("a browser-approved revised or shock concept is a valid structured design choice", () => {
  const { approved } = fixture();
  const selection = {
    kind: "design-direction",
    subjectId: "design-direction",
    mode: "select-option",
    optionId: approved.selectedConceptId,
    value: "Cinematic Commission",
    reason: "The customer selected the real live concept.",
    classification: "design preference",
    sourceProfileVersion: 2,
    designContract: { approvedPrototypeContract: approved },
  };
  const profile = { missionId: approved.missionId, profileVersion: 2 };
  const design = { designAlternatives: [], recommendations: [], decisions: [] };

  assert.doesNotThrow(() => validateStructuredSelectionsAgainstCurrent(
    [{ questionId: "customer-design-direction", answer: "Use it.", selection }],
    profile,
    design,
  ));
  assert.throws(() => validateStructuredSelectionsAgainstCurrent(
    [{ questionId: "customer-design-direction", answer: "Use it.", selection: { ...selection, optionId: "another-concept" } }],
    profile,
    design,
  ), /immutable approval evidence/u);
});

test("production binds immutable approval bookkeeping locally before semantic admission", () => {
  const { approved } = fixture();
  const plan = {
    designFidelity: {
      approvedDesignId: "model-typo",
      approvedPrototypeContentHash: "e".repeat(64),
      approvedConceptVersion: 1,
    },
  };
  const bound = bindApprovedPrototypeFidelityIdentity(plan, {
    productBlueprint: {
      designSpecification: { approvedDesignContract: approved },
    },
  });

  assert.equal(bound.designFidelity.approvedDesignId, approved.approvedDesignId);
  assert.equal(bound.designFidelity.approvedPrototypeContentHash, approved.prototypeContentHash);
  assert.equal(bound.designFidelity.approvedConceptVersion, approved.selectedConceptVersion);
  assert.notEqual(bound, plan);
});

test("the approved design reaches the generator that writes production source", () => {
  const { contract } = fixture();
  const prompt = approvedDesignPromptSegments(contract).join("\n\n");

  // The design the customer approved has to be visible to the model. Without
  // it the generator invents its own art direction and the fidelity comparison
  // against the approved prototype can only fail.
  assert.match(prompt, /#12100f/u);
  assert.match(prompt, /#c98555/u);
  assert.match(prompt, /Fraunces/u);
  assert.match(prompt, /Inter/u);
  assert.match(prompt, /Opening story/u);
  assert.match(prompt, /Overlay navigation/u);
  assert.match(prompt, /split cinematic opening/u);
  assert.match(prompt, /No generic card dashboard/u);
  assert.match(prompt, /Make mobile the priority\./u);
  assert.match(prompt, /Visible keyboard focus/u);
  assert.match(prompt, /design floor, not the finish ceiling/u);
  assert.match(prompt, /complete hover\/focus\/pressed\/loading\/error\/success states/u);
  assert.deepEqual(approvedDesignPromptSegments(null), []);
});

test("the production generator receives the integrity-verified prototype source", () => {
  const { contract, approved } = fixture();
  const prompt = approvedDesignPromptSegments(contract, {
    approvedDesignId: approved.approvedDesignId,
    prototypeContentHash: approved.prototypeContentHash,
    files: [
      {
        path: "index.html",
        content: '<main class="cinematic-opening"><h1>Commissioned light</h1></main>',
        contentHash: "a".repeat(64),
      },
      {
        path: "styles.css",
        content: ".cinematic-opening{min-height:100svh;color:#c98555}",
        contentHash: "b".repeat(64),
      },
    ],
  }).join("\n\n");

  assert.match(prompt, /APPROVED LIVE PROTOTYPE SOURCE/u);
  assert.match(prompt, /Commissioned light/u);
  assert.match(prompt, /min-height:100svh/u);
  assert.match(prompt, /faithful production evolution/u);
});

test("an approved multi-surface design gets a budget it can actually be built in", () => {
  const { contract } = fixture();
  const plain = bundleBudgetInstruction(null);
  const approved = bundleBudgetInstruction(contract);

  // The plain path keeps the compact budget that already builds quickly.
  assert.match(plain, /no more than 10 generated files/u);
  assert.match(plain, /18,000 characters/u);

  // An approved design must not be squeezed into a budget the mandatory
  // Playwright test alone consumes more than half of.
  const characterBudget = Number(
    /below ([\d,]+) characters/u.exec(approved)[1].replaceAll(",", ""),
  );
  const fileBudget = Number(/no more than (\d+) generated files/u.exec(approved)[1]);
  assert(characterBudget >= 38_000, `character budget too small: ${characterBudget}`);
  assert(fileBudget >= 14, `file budget too small: ${fileBudget}`);
  assert.match(approved, /single condensed page is a fidelity failure/u);
  assert.match(approved, /never drop an approved surface/u);
});

test("the generator is not sent the design alternatives the customer rejected", () => {
  const { contract } = fixture();
  const profile = {
    missionId: "mission-production-binding",
    customerContent: { supplied: [], missingBeforeLaunch: [] },
    capabilities: ["web-application"],
    designAlternatives: [{ id: "alternative-1" }, { id: "alternative-2" }],
    contextualSuggestions: [{ id: "suggestion-1" }],
    verificationPlan: [{ checkId: "obligation-001" }],
  };
  const trimmed = generationProfileView(profile, contract);

  assert.equal(trimmed.designAlternatives, undefined);
  assert.equal(trimmed.contextualSuggestions, undefined);
  assert.equal(trimmed.verificationPlan, undefined);
  // Everything the generator actually needs survives.
  assert.deepEqual(trimmed.customerContent, profile.customerContent);
  assert.deepEqual(trimmed.capabilities, profile.capabilities);
  assert.equal(trimmed.missionId, profile.missionId);
  // The plain path has no binding task contract, so nothing may be removed.
  assert.deepEqual(generationProfileView(profile, null), profile);
});

test("an armed deferred shock departs from the prototype instead of reproducing it", () => {
  const { contract } = fixture();
  const shocked = structuredClone(contract);
  shocked.productBlueprint.designSpecification.approvedDesignContract = {
    ...contract.productBlueprint.designSpecification.approvedDesignContract,
    shockDirectives: [
      "Foundry is deliberately departing from the approved prototype for this build. Do not reproduce it.",
      "Reject the most common composition for this product type outright.",
    ],
  };

  // Without a shock the approved design is authority and is comparable.
  assert.notEqual(comparablePrototypeDesign(contract), null);
  const faithful = approvedDesignPromptSegments(contract).join("\n\n");
  assert.match(faithful, /faithful production evolution/u);

  // With a shock armed the instruction inverts and fidelity is switched off.
  assert.equal(comparablePrototypeDesign(shocked), null);
  const surprising = approvedDesignPromptSegments(shocked).join("\n\n");
  assert.match(surprising, /asked Foundry to surprise them/u);
  assert.match(surprising, /context to react against/u);
  assert.match(surprising, /Reject the most common composition/u);
  assert.doesNotMatch(surprising, /faithful production evolution/u);

  // The approved palette must not be force-injected into a shock build.
  const plan = {
    files: [{ path: "app/globals.css", content: "body { margin: 0; }", contractRequirementIds: ["r1"] }],
    designFidelity: { sourceFiles: ["app/globals.css"] },
  };
  assert.equal(bindApprovedPrototypeSourceGuardrails(plan, shocked), plan);
  assert.notEqual(bindApprovedPrototypeSourceGuardrails(plan, contract), plan);
});

test("Foundry owns deterministic browser fidelity evidence when a model omits it", () => {
  const { contract } = fixture();
  const plan = {
    files: [{
      path: "tests/workflow.spec.ts",
      content: "test('workflow', async ({ page }) => { await page.goto('/'); });",
      contractRequirementIds: ["approved-design-direction"],
    }],
  };
  const bound = bindApprovedPrototypeBrowserEvidence(plan, contract);
  const evidence = bound.files.find((file) =>
    file.path.startsWith("tests/foundry-design-fidelity-evidence"),
  );

  assert(evidence);
  assert.match(evidence.content, /page\.screenshot/u);
  assert.match(evidence.content, /getComputedStyle/u);
  assert.match(evidence.content, /getBoundingClientRect/u);
  assert.match(evidence.content, /390/u);
  assert.match(evidence.content, /768/u);
  assert.match(evidence.content, /1280/u);
  assert.match(evidence.content, /scrollWidth/u);
  assert.match(evidence.content, /keyboard\.press/u);
  assert.deepEqual(evidence.contractRequirementIds, ["approved-design-direction"]);
});

test("Foundry owns browser fidelity evidence for a simple site without a prototype", () => {
  const contract = {
    verificationPlan: [{
      acceptanceMethod: "browser-check",
      observableOutcome: "The public site remains usable on a phone.",
    }],
    acceptanceObligations: [{
      obligationId: "obligation-responsive",
      statement: "The public site remains usable on a phone.",
    }],
    productBlueprint: {
      designSpecification: { approvedDesignContract: null },
    },
  };
  const bound = bindApprovedPrototypeBrowserEvidence(
    {
      files: [{
        path: "tests/workflow.spec.ts",
        content: "test('workflow', async ({ page }) => { await page.goto('/'); });",
        contractRequirementIds: ["obligation-responsive"],
      }],
    },
    contract,
  );
  const evidence = bound.files.find((file) =>
    file.path.startsWith("tests/foundry-design-fidelity-evidence"),
  );
  assert(evidence);
  assert.match(evidence.content, /page\.screenshot/u);
  assert.deepEqual(evidence.contractRequirementIds, ["obligation-responsive"]);
});

test("Foundry's own evidence spec satisfies every gate Foundry applies to it", () => {
  // The recurring failure mode: an instruction telling the model not to
  // duplicate Foundry's evidence, and a gate requiring that evidence in the
  // model's own source. The two drifted and every build paid a correction
  // round. The invariant that prevents it is that Foundry's injected spec is
  // self-sufficient, so the model genuinely never needs to repeat it.
  const { contract } = fixture();
  const bound = bindApprovedPrototypeBrowserEvidence(
    { files: [{ path: "tests/workflow.spec.ts", content: "test('x', async () => {});", contractRequirementIds: ["r1"] }] },
    contract,
  );
  const spec = bound.files.find((file) =>
    file.path.startsWith("tests/foundry-design-fidelity-evidence"),
  ).content;

  // Exactly the checks in validateGeneratedDesignFidelity.
  const gates = {
    screenshot: /\.screenshot\s*\(/u,
    geometry: /(?:getComputedStyle|getBoundingClientRect|boundingBox\s*\()/u,
    typography: /(?:fontFamily|fontSize|fontWeight|lineHeight|letterSpacing)/u,
    color: /(?:backgroundColor|color\b|getComputedStyle)/u,
    phone: /(?:375|390|414)/u,
    tablet: /(?:768|810|834|1024)/u,
    desktop: /(?:1280|1440|1512|1728)/u,
    overflow: /scrollWidth|clientWidth|documentElement/u,
    focus: /focus\s*\(|:focus|focus-visible|activeElement/u,
  };
  for (const [name, pattern] of Object.entries(gates)) {
    assert.ok(pattern.test(spec), `Foundry's own spec fails its own ${name} gate`);
  }

  // The viewport gate counts occurrences in source text, so a loop is not
  // enough however many viewports it visits at runtime.
  const viewportCount = (spec.match(/setViewportSize\s*\(|viewport\s*:\s*\{/gu) ?? []).length;
  assert.ok(viewportCount >= 3, `viewport gate needs >= 3 textual occurrences, found ${viewportCount}`);
});
