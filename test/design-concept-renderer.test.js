import assert from "node:assert/strict";
import test from "node:test";

import {
  createDesignRenderContract,
  designRendererRequirements,
  renderDesignConceptDocument,
} from "../src/domain/design-concept-renderer.js";
import { validateGeneratedDesignFidelity } from "../src/domain/design-fidelity.js";
import { bindCanonicalRendererRootClass } from "../src/domain/contract-bound-execution.js";
import {
  ConceptStrategy,
  createApprovedDesignContract,
  createConceptPrototypeContract,
} from "../src/domain/live-concept-studio.js";

const base = {
  productName: "Fine-art photographer portfolio",
  outcome: "Present bodies of work and make considered inquiries easy.",
  workflows: ["Browse selected work", "Open a project", "Make an inquiry"],
};

function concept(overrides) {
  return createDesignRenderContract({
    ...base,
    directionName: overrides.directionName,
    personality: overrides.personality,
    creativeDNA: {
      primaryAction: overrides.primaryAction,
      compositionPrimitive: overrides.primitive,
      typeScale: overrides.typeScale,
      typeVoice: overrides.typeVoice,
      imageryTreatment: overrides.imageryTreatment,
      motionStrategy: overrides.motionStrategy,
      responsiveTransform: overrides.responsiveTransform,
      surfaceSequence: overrides.regions,
      surfaceLabels: overrides.labels,
    },
    visualSystem: {
      density: overrides.density,
      navigationType: overrides.navigationType,
      buttonTreatment: overrides.buttonTreatment,
      colorRoles: overrides.colors,
      sampleLabels: overrides.labels,
    },
  });
}

function approvedPrototypeEvidence(renderContract) {
  const selectedConcept = createConceptPrototypeContract({
    conceptId: "concept-digital-exhibition",
    missionId: "mission-design-test",
    conceptVersion: 1,
    conceptName: renderContract.directionName,
    creativeThesis: renderContract.personality,
    intendedAudienceResponse: "Experience the work as a deliberate exhibition.",
    designRationale: "The live prototype was reviewed as a complete responsive experience.",
    projectSurfaces: [...renderContract.regions],
    pageOrScreenSequence: [...renderContract.regions],
    navigationModel: renderContract.navigationType,
    compositionRules: [`Use the ${renderContract.primitive} composition.`],
    typographySystem: { voice: renderContract.typeVoice, scale: renderContract.typeScale },
    colorSystem: { ...renderContract.colors },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40, 64] },
    imageryStrategy: renderContract.imageryTreatment,
    componentCharacter: renderContract.primitive,
    interactionRules: ["Keep the approved primary action functional."],
    motionRules: [renderContract.motionStrategy, "Honor reduced motion."],
    responsiveRules: [renderContract.responsiveTransform],
    accessibilityRules: ["Keep focus visible."],
    deliberateExclusions: ["No generic replacement layout."],
    sampleContentPolicy: "Use project-specific fictional content.",
    expectedFiles: ["app/page.tsx", "app/styles.css", "tests/design.spec.ts"],
    expectedPreviewRoutes: ["/"],
    verificationPlan: [
      { checkId: "renderer", kind: "browser", statement: "The approved renderer is visible at all required widths." },
    ],
    sourceProjectDesignVersion: 1,
    strategy: ConceptStrategy.STANDARD,
    parentConceptId: null,
    sourceConceptIds: [],
  });
  return createApprovedDesignContract({
    missionId: selectedConcept.missionId,
    selectedConcept,
    customerModifications: [],
    prototypeFileManifest: selectedConcept.expectedFiles.map((path, index) => ({
      path,
      contentHash: String(index + 1).repeat(64),
      size: 100 + index,
    })),
    screenshotEvidenceReferences: ["evidence://design/desktop"],
    browserEvidenceReferences: ["evidence://design/browser"],
    approvalTimestamp: "2026-08-04T20:00:00.000Z",
  });
}

test("shared concept renderer produces complete, immutable, distinct product concepts", () => {
  const exhibition = concept({
    directionName: "The Digital Exhibition",
    personality: "Quiet, cinematic, and museum-like.",
    primaryAction: "Explore the work",
    primitive: "immersive-hero",
    typeScale: "dramatic",
    typeVoice: "serif-authority",
    imageryTreatment: "full-bleed",
    motionStrategy: "restrained",
    responsiveTransform: "collapse-to-stack",
    regions: ["Opening image", "Selected projects", "Artist context", "Inquiry path"],
    labels: ["Selected work", "Project view", "About", "Inquiries"],
    density: "spacious",
    navigationType: "top-bar",
    buttonTreatment: "quiet",
    colors: { background: "#111111", surface: "#1b1b1b", primary: "#f3f0ea", accent: "#c9b79c", text: "#e6e1d8" },
  });
  const archive = concept({
    directionName: "The Contemporary Archive",
    personality: "Precise, contemporary, and archival.",
    primaryAction: "Enter archive",
    primitive: "modular-gallery",
    typeScale: "measured",
    typeVoice: "grotesque-neutral",
    imageryTreatment: "contact-sheet",
    motionStrategy: "responsive",
    responsiveTransform: "carousel-horizontal",
    regions: ["Archive landing", "Series filter", "Image grid", "Detail view"],
    labels: ["Archive", "Series", "Image detail", "Inquiry"],
    density: "dense",
    navigationType: "tabs",
    buttonTreatment: "compact",
    colors: { background: "#f7f7f5", surface: "#ffffff", primary: "#191919", accent: "#b04a35", text: "#292929" },
  });

  assert.notEqual(exhibition.renderContractId, archive.renderContractId);
  assert.equal(createDesignRenderContract({
    ...base,
    directionName: exhibition.directionName,
    personality: exhibition.personality,
    creativeDNA: {
      primaryAction: exhibition.primaryAction,
      compositionPrimitive: exhibition.primitive,
      typeScale: exhibition.typeScale,
      typeVoice: exhibition.typeVoice,
      imageryTreatment: exhibition.imageryTreatment,
      motionStrategy: exhibition.motionStrategy,
      responsiveTransform: exhibition.responsiveTransform,
      surfaceSequence: exhibition.regions,
      surfaceLabels: exhibition.labels,
    },
    visualSystem: {
      density: exhibition.density,
      navigationType: exhibition.navigationType,
      buttonTreatment: exhibition.buttonTreatment,
      colorRoles: exhibition.colors,
      sampleLabels: exhibition.labels,
    },
  }).renderContractId, exhibition.renderContractId);

  const exhibitionDocument = renderDesignConceptDocument(exhibition);
  const archiveDocument = renderDesignConceptDocument(archive);
  for (const [contract, document] of [[exhibition, exhibitionDocument], [archive, archiveDocument]]) {
    assert.match(document, new RegExp(`data-foundry-render-contract="${contract.renderContractId}"`, "u"));
    assert.match(document, new RegExp(`class="concept-${contract.primitive}"`, "u"));
    assert.match(document, new RegExp(contract.productName, "u"));
    assert.match(document, new RegExp(contract.primaryAction, "u"));
    assert.match(document, /@media\(max-width:560px\)/u);
    assert.match(document, /prefers-reduced-motion/u);
  }
  assert.match(exhibitionDocument, /concept-editorial/u);
  assert.match(archiveDocument, /concept-gallery/u);
  assert.notEqual(exhibitionDocument, archiveDocument);
});

test("authentication concepts show a real sign-in surface and the post-sign-in product", () => {
  const contract = createDesignRenderContract({
    productName: "Admin operations",
    outcome: "A real sign-in page that opens a functional admin dashboard.",
    directionName: "Clear Operations",
    personality: "Calm, precise, and operational.",
    workflows: [
      "Sign in successfully and enter the dashboard",
      "Navigate between operational sections",
      "Recover from empty, loading, error, and success states",
    ],
    creativeDNA: {
      primaryAction: "Open an operational section",
      compositionPrimitive: "task-workspace",
      surfaceSequence: ["Sign in", "Overview", "Operational section", "Account"],
      surfaceLabels: ["Sign in", "Overview", "Operations", "Account"],
    },
  });
  const document = renderDesignConceptDocument(contract);
  const requirements = designRendererRequirements(contract);

  assert.equal(contract.authentication.required, true);
  assert.match(document, /class="concept-journey\b/u);
  assert.match(document, /class="concept-auth-surface"/u);
  assert.match(document, /<form class="concept-auth-form">/u);
  assert.match(document, /type="email"/u);
  assert.match(document, /type="password"/u);
  assert.match(document, /type="submit">Sign in/u);
  assert.match(document, /class="concept-product-surface"/u);
  assert.match(document, /<small>Workspace<\/small><h1>Overview<\/h1>/u);
  assert.match(document, /@media\(max-width:520px\)/u);
  assert.doesNotMatch(document, /@media\(max-width:760px\)\{\.concept-journey/u);
  assert.ok(requirements.requiredClasses.includes("concept-auth-form"));
  assert.ok(requirements.requiredClasses.includes("concept-product-surface"));
});

test("registration concepts render account creation rather than relabeling sign-in", () => {
  const contract = createDesignRenderContract({
    productName: "Member access",
    outcome: "A focused sign-up page that creates a member account.",
    directionName: "Guided welcome",
    personality: "Warm and reassuring.",
    workflows: ["Create an account", "Confirm success"],
    creativeDNA: {
      primaryAction: "Create account",
      compositionPrimitive: "guided-flow",
      surfaceSequence: ["Sign up", "Confirmation"],
      surfaceLabels: ["Join", "Account", "Success"],
    },
  });
  const document = renderDesignConceptDocument(contract);

  assert.equal(contract.authentication.mode, "sign-up");
  assert.match(document, /Create your account/u);
  assert.match(document, /name="name"/u);
  assert.match(document, /type="submit">Create account/u);
  assert.doesNotMatch(document, />Welcome back</u);
});

test("generated products must prove that they implement the exact studio render contract", () => {
  assert.match(
    bindCanonicalRendererRootClass.toString(),
    /approved authentication reaches the canonical product surface/u,
  );
  const renderContract = concept({
    directionName: "The Digital Exhibition",
    personality: "Quiet, cinematic, and museum-like.",
    primaryAction: "Explore the work",
    primitive: "immersive-hero",
    typeScale: "dramatic",
    typeVoice: "serif-authority",
    imageryTreatment: "full-bleed",
    motionStrategy: "restrained",
    responsiveTransform: "collapse-to-stack",
    regions: ["Opening image", "Selected projects", "Artist context", "Inquiry path"],
    labels: ["Selected work", "Project view", "About", "Inquiries"],
    density: "spacious",
    navigationType: "top-bar",
    buttonTreatment: "quiet",
    colors: { background: "#111111", surface: "#1b1b1b", primary: "#f3f0ea", accent: "#c9b79c", text: "#e6e1d8" },
  });
  const contract = {
    selectedDesignDirection: {
      interactionStyle: "Restrained transitions keep the work central.",
    },
    productBlueprint: {
      designSpecification: {
        selectedDirectionName: renderContract.directionName,
        visualPersonality: renderContract.personality,
        composition: {
          layoutApproach: "An immersive hero opens into selected projects.",
          navigationApproach: "A quiet top bar.",
          informationDensity: "Spacious and deliberate.",
          mobileBehavior: "Collapse the exhibition into a clear stack.",
        },
        visualCharacter: {
          typography: renderContract.typeVoice,
          colorMood: "Museum-dark with a warm paper accent.",
          hierarchy: "Image-led and dramatic.",
          spacingDensity: renderContract.density,
        },
        renderContract,
        approvedDesignContract: approvedPrototypeEvidence(renderContract),
        accessibilityRequirements: ["Keep focus visible."],
      },
    },
  };
  const approvedScreenTree = renderContract.productRenderSpec.screens.map((screen) =>
    `<section data-foundry-screen="${screen.id}"><button>${screen.primaryAction}</button>${screen.regions.map((region) => `<article data-foundry-region="${region.id}">${region.title}</article>`).join("")}</section>`,
  ).join("");
  const exactSource = `import approvedProductRenderSpec from "../foundry/approved-product-render-spec.json"; export default function Page() { return <><header className="concept-nav">The Digital Exhibition</header><main className="concept-editorial concept-immersive-hero" data-foundry-render-contract="${renderContract.renderContractId}" data-foundry-render-spec={approvedProductRenderSpec.renderSpecId ?? "${renderContract.productRenderSpec.renderSpecId}"} data-foundry-primitive="${renderContract.primitive}" style={{background:"${renderContract.colors.background}",color:"${renderContract.colors.text}",borderColor:"${renderContract.colors.primary}"}}><section className="concept-hero"><div className="concept-photo concept-photo-hero">Opening image</div><div className="concept-hero-copy"><button style={{color:"${renderContract.colors.accent}",background:"${renderContract.colors.surface}"}}>Explore the work</button></div></section><section className="concept-spread">Selected projects</section>${approvedScreenTree}</main></>; }`;
  const approvedPrototype = contract.productBlueprint.designSpecification.approvedDesignContract;
  const plan = {
    designFidelity: {
      approvedDesignId: approvedPrototype.approvedDesignId,
      approvedPrototypeContentHash: approvedPrototype.prototypeContentHash,
      approvedConceptVersion: approvedPrototype.selectedConceptVersion,
      compositionImplementation: "The Digital Exhibition uses an immersive hero, opening image, and selected projects.",
      typographyImplementation: "Serif authority creates dramatic image-led hierarchy.",
      colorImplementation: "Museum dark surfaces use a warm paper accent.",
      responsiveImplementation: "The exhibition collapses into a clear responsive stack on phone.",
      interactionImplementation: "Restrained transitions keep the work central.",
      sourceFiles: ["app/page.tsx", "app/styles.css"],
    },
    files: [
      { path: "app/page.tsx", content: exactSource },
      { path: "app/styles.css", content: ":root{--ink:#111111}.concept-editorial{display:grid;font-family:serif;font-size:1rem;color:var(--ink)}.concept-nav{display:flex}.concept-hero{display:grid;grid-template-columns:1.55fr .75fr}.concept-photo-hero{min-height:310px}.concept-hero-copy{display:flex}.concept-spread{display:grid;grid-template-columns:.65fr 1fr 1.35fr}@media(max-width:560px){.concept-hero{grid-template-columns:1fr}}@media(max-width:414px){.concept-editorial{width:100%}}@media(prefers-reduced-motion:reduce){*{animation:none;transition:none}}" },
      { path: "tests/design.spec.ts", content: `await page.setViewportSize({width:390,height:844}); await page.screenshot({path:'phone.png'}); const phone=await page.locator('main').evaluate((el)=>{const style=getComputedStyle(el);return {box:el.getBoundingClientRect(),fontFamily:style.fontFamily,fontSize:style.fontSize,backgroundColor:style.backgroundColor,color:style.color}}); await page.setViewportSize({width:768,height:1024}); await page.screenshot({path:'tablet.png'}); await page.setViewportSize({width:1280,height:900}); await page.screenshot({path:'desktop.png'}); const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth); await page.keyboard.press('Tab'); const focus=await page.evaluate(()=>document.activeElement); expect(await page.locator('[data-foundry-render-contract="${renderContract.renderContractId}"]').isVisible()).toBeTruthy(); for (const selector of ['.concept-immersive-hero','.concept-nav','.concept-editorial','.concept-hero','.concept-photo-hero','.concept-hero-copy','.concept-spread']) expect(await page.locator(selector).isVisible()).toBeTruthy();` },
    ],
  };
  const fail = (message) => { throw new Error(message); };

  assert.doesNotThrow(() => validateGeneratedDesignFidelity(plan, contract, fail));
  const equivalentScreenAction = structuredClone(plan);
  const approvedBrowseAction = renderContract.productRenderSpec.screens.find(
    (screen) => /^Browse\b/u.test(screen.primaryAction),
  ).primaryAction;
  equivalentScreenAction.files[0].content = equivalentScreenAction.files[0].content.replaceAll(
    approvedBrowseAction,
    "Explore the collection",
  );
  assert.doesNotThrow(() =>
    validateGeneratedDesignFidelity(equivalentScreenAction, contract, fail),
  );
  const missingPrimitiveBinding = structuredClone(plan);
  missingPrimitiveBinding.files[0].content = missingPrimitiveBinding.files[0].content.replace(
    ` ${`concept-${renderContract.primitive}`}`,
    "",
  );
  const rebound = bindCanonicalRendererRootClass(missingPrimitiveBinding, contract);
  assert.match(
    rebound.files[0].content,
    new RegExp(`className="[^"]*concept-${renderContract.primitive}`, "u"),
  );
  for (const className of designRendererRequirements(renderContract).requiredClasses) {
    assert.match(rebound.files.map((file) => file.content).join("\n"), new RegExp(className, "u"));
  }
  assert.match(
    rebound.files.find((file) => file.path === "app/styles.css").content,
    new RegExp(`--accent:${renderContract.colors.accent}`, "u"),
  );
  const missingArtifactBinding = structuredClone(plan);
  missingArtifactBinding.files[0].content = `"use client";\n${missingArtifactBinding.files[0].content
    .replace(
      'import approvedProductRenderSpec from "../foundry/approved-product-render-spec.json"; ',
      "",
    )
    .replace(
      `data-foundry-render-spec={approvedProductRenderSpec.renderSpecId ?? "${renderContract.productRenderSpec.renderSpecId}"}`,
      `data-foundry-render-spec="${renderContract.productRenderSpec.renderSpecId}"`,
    )}`;
  const artifactBound = bindCanonicalRendererRootClass(
    missingArtifactBinding,
    contract,
  );
  const artifactBoundSource = artifactBound.files.find(
    (file) => file.path === "app/page.tsx",
  ).content;
  assert.match(
    artifactBoundSource,
    /^"use client";\s*import foundryApprovedProductRenderSpec from "\.\.\/foundry\/approved-product-render-spec\.json";/u,
  );
  assert.match(
    artifactBoundSource,
    new RegExp(
      `data-foundry-render-spec=\\{foundryApprovedProductRenderSpec\\.renderSpecId \\?\\? "${renderContract.productRenderSpec.renderSpecId}"\\}`,
      "u",
    ),
  );
  assert.equal(
    artifactBound.files.filter(
      (file) => file.path === "foundry/approved-product-render-spec.json",
    ).length,
    1,
  );
  assert.doesNotThrow(() =>
    validateGeneratedDesignFidelity(artifactBound, contract, fail),
  );
  const missingBrowserRegion = structuredClone(plan);
  missingBrowserRegion.files[2].content = `test("renderer", async ({ page }) => {\n${missingBrowserRegion.files[2].content.replaceAll(
    ".concept-spread",
    ".custom-spread",
  )}\n});`;
  const rendererAssertionsBound = bindCanonicalRendererRootClass(
    missingBrowserRegion,
    contract,
  );
  assert.match(
    rendererAssertionsBound.files[2].content,
    /"\.concept-spread"/u,
  );
  assert.match(
    rendererAssertionsBound.files[2].content,
    /import \{ test, expect \} from "@playwright\/test"/u,
  );
  const narrowDiagnostics = structuredClone(plan);
  narrowDiagnostics.files[2].content = `import { test } from '@playwright/test';\nconst diagnostics: Record<string, Record<string, boolean>> = {};\n${narrowDiagnostics.files[2].content}`;
  const diagnosticsBound = bindCanonicalRendererRootClass(
    narrowDiagnostics,
    contract,
  );
  assert.match(
    diagnosticsBound.files[2].content,
    /Record<string, Record<string, unknown>>/u,
  );
  const mismatchedActionLabel = structuredClone(plan);
  mismatchedActionLabel.files[2].content += `\nconst bookButton = page.locator('.btn-primary', { hasText: 'Explore this work' });`;
  const actionLabelBound = bindCanonicalRendererRootClass(
    mismatchedActionLabel,
    contract,
  );
  assert.match(
    actionLabelBound.files[2].content,
    /hasText: "Explore the work"/u,
  );
  const relabelledPrimaryAction = structuredClone(plan);
  relabelledPrimaryAction.files[0].content = relabelledPrimaryAction.files[0].content.replace(
    ">Explore the work</button>",
    ' onClick={() => openWork()}>Explore work</button>',
  );
  const actionBound = bindCanonicalRendererRootClass(
    relabelledPrimaryAction,
    contract,
  );
  assert.match(actionBound.files[0].content, />Explore the work<\/button>/u);
  const missingFunctionalAction = structuredClone(plan);
  missingFunctionalAction.files[0].content = missingFunctionalAction.files[0].content.replace(
    ">Explore the work</button>",
    ">Continue</button>",
  );
  const partiallyBound = bindCanonicalRendererRootClass(
    missingFunctionalAction,
    contract,
  );
  assert.notEqual(partiallyBound, missingFunctionalAction);
  assert.equal(
    partiallyBound.files.filter(
      (file) => file.path === "foundry/approved-product-render-spec.json",
    ).length,
    1,
  );
  assert.throws(
    () => validateGeneratedDesignFidelity(partiallyBound, contract, fail),
    /omitted approved (?:screen action|primary action)/u,
  );
  const missingMarker = structuredClone(plan);
  missingMarker.files[0].content = missingMarker.files[0].content
    .replace(renderContract.renderContractId, "unbound-preview")
    .replace("data-foundry-render-contract", "data-preview");
  const markerRebound = bindCanonicalRendererRootClass(
    missingMarker,
    contract,
  );
  const markerReboundSource = markerRebound.files.find(
    (file) => file.path === "app/page.tsx",
  ).content;
  assert.match(
    markerReboundSource,
    new RegExp(
      `data-foundry-render-contract="${renderContract.renderContractId}"`,
      "u",
    ),
  );
  assert.doesNotThrow(() =>
    validateGeneratedDesignFidelity(markerRebound, contract, fail),
  );
  const delegatedRoot = structuredClone(plan);
  const delegatedRootSource = delegatedRoot.files[0].content
    .replace(renderContract.renderContractId, "delegated-preview")
    .replace("data-foundry-render-contract", "data-preview");
  delegatedRoot.files[0].content =
    'import Catalogue from "./catalogue"; export default function Page() { return <Catalogue />; }';
  delegatedRoot.files.push({
    path: "app/catalogue.tsx",
    content: delegatedRootSource,
    contractRequirementIds: ["blueprint-design-direction"],
  });
  const delegatedRootRebound = bindCanonicalRendererRootClass(
    delegatedRoot,
    contract,
  );
  assert.ok(
    delegatedRootRebound.designFidelity.sourceFiles.includes(
      "app/catalogue.tsx",
    ),
  );
  assert.match(
    delegatedRootRebound.files.find(
      (file) => file.path === "app/catalogue.tsx",
    ).content,
    new RegExp(
      `data-foundry-render-contract="${renderContract.renderContractId}"`,
      "u",
    ),
  );
  assert.doesNotThrow(() =>
    validateGeneratedDesignFidelity(delegatedRootRebound, contract, fail),
  );
  const approximated = structuredClone(plan);
  approximated.files[0].content = approximated.files[0].content
    .replaceAll("concept-hero", "custom-hero")
    .replaceAll("concept-spread", "custom-spread");
  approximated.files[1].content = approximated.files[1].content
    .replaceAll("concept-hero", "custom-hero")
    .replaceAll("concept-spread", "custom-spread");
  assert.throws(
    () => validateGeneratedDesignFidelity(approximated, contract, fail),
    /does not share the canonical renderer class/u,
  );
  const changedGeometry = structuredClone(plan);
  changedGeometry.files[1].content = changedGeometry.files[1].content.replace(
    "grid-template-columns:1.55fr .75fr",
    "grid-template-columns:1fr 1fr",
  );
  assert.throws(
    () => validateGeneratedDesignFidelity(changedGeometry, contract, fail),
    /changed the canonical editorial renderer geometry/u,
  );
  const placeholder = structuredClone(plan);
  placeholder.files[0].content += " const placeholderImage = true;";
  assert.throws(
    () => validateGeneratedDesignFidelity(placeholder, contract, fail),
    /placeholder imagery/u,
  );
  const noOp = structuredClone(plan);
  noOp.files[0].content = noOp.files[0].content.replace(
    "<button style={{color:",
    '<a href="#work">Explore the work</a><button style={{color:',
  );
  assert.throws(
    () => validateGeneratedDesignFidelity(noOp, contract, fail),
    /same-page no-op anchor/u,
  );
});
