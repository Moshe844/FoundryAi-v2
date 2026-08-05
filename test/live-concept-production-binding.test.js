import assert from "node:assert/strict";
import test from "node:test";

import { contractBoundModelPrompt } from "../src/domain/contract-bound-execution.js";
import { designExecutionBrief, validateGeneratedDesignFidelity } from "../src/domain/design-fidelity.js";
import { bindApprovedPrototypeFidelityIdentity } from "../src/work-plane/production-mission-service.js";
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
