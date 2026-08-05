import {
  designRendererRequirements,
  renderDesignConceptDocument,
} from "./design-concept-renderer.js";
import { productRenderSpecRequirements } from "./product-render-spec.js";
import { designFidelityRequiresPrototypeEvidence } from "./live-concept-studio.js";

const GENERIC_LAYOUT_PATTERNS = Object.freeze([
  /\b(?:three|3)\s+(?:generic\s+)?cards?\b/iu,
  /\bgeneric\s+(?:dashboard|portfolio|landing page|layout)\b/iu,
  /\bplaceholder\s+(?:project|content|image|copy)\b/iu,
]);

function words(value) {
  return new Set(
    String(value ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}#]+/gu, " ")
      .split(/\s+/u)
      .filter((token) => token.length >= 4),
  );
}

function overlapCount(left, right) {
  const rightWords = words(right);
  let count = 0;
  for (const token of words(left)) if (rightWords.has(token)) count += 1;
  return count;
}

function hasResponsiveSourceStrategy(sourceText) {
  if (
    /(?:@media|@container|clamp\s*\(|minmax\s*\(|container-type|useMediaQuery|\b(?:sm|md|lg|xl|2xl):[a-z])/iu.test(
      sourceText,
    )
  ) {
    return true;
  }
  if (
    /(?:flex-wrap\s*:\s*wrap|grid-template-columns\s*:\s*repeat\s*\(\s*auto-(?:fit|fill))/iu.test(
      sourceText,
    )
  ) {
    return true;
  }
  const hasBoundedWidth =
    /(?:max-width\s*:|max-inline-size\s*:|\bmaxWidth\s*:|\bmaxInlineSize\s*:|\bmax-w-[a-z0-9[\]./]+)/iu.test(
      sourceText,
    );
  const hasFluidWidth =
    /(?:\b(?:width|inline-size)\s*:\s*["']?(?:100%|100vw|100dvw|min\s*\()|\b(?:width|inlineSize)\s*:\s*["']100%["']|\bw-full\b|\bmargin\s*:\s*[^;{}]*auto|\bpadding(?:-inline)?\s*:)/iu.test(
      sourceText,
    );
  return hasBoundedWidth && hasFluidWidth;
}

function designSpecification(contract) {
  const blueprint = contract.productBlueprint;
  const specification = blueprint?.designSpecification;
  if (specification !== null && typeof specification === "object") {
    return specification;
  }
  return {
    selectedDirectionName: contract.selectedDesignDirection.visualPersonality,
    visualPersonality: contract.selectedDesignDirection.visualPersonality,
    composition: {
      layoutApproach: contract.selectedDesignDirection.layoutStrategy,
      navigationApproach: contract.selectedDesignDirection.navigationApproach,
      informationDensity: contract.selectedDesignDirection.informationDensity,
      mobileBehavior: contract.selectedDesignDirection.responsivePriority,
    },
    visualCharacter: {
      typography: contract.selectedDesignDirection.visualPersonality,
      colorMood: contract.selectedDesignDirection.tone,
      hierarchy: contract.selectedDesignDirection.layoutStrategy,
      spacingDensity: contract.selectedDesignDirection.informationDensity,
    },
    accessibilityRequirements: contract.selectedDesignDirection.accessibilityNeeds,
    customerInstructions: null,
    visualSystem: null,
  };
}

export function designExecutionBrief(contract) {
  const specification = designSpecification(contract);
  const approvedDesignContract = specification.approvedDesignContract ?? null;
  const approvedPrototypeSeed = approvedDesignContract === null
    ? null
    : Object.freeze({
        authority: "IMMUTABLE_LIVE_PROTOTYPE",
        approvedDesignId: approvedDesignContract.approvedDesignId,
        selectedConceptId: approvedDesignContract.selectedConceptId,
        selectedConceptVersion: approvedDesignContract.selectedConceptVersion,
        prototypeIntegrityHash: approvedDesignContract.prototypeIntegrityHash,
        prototypeContentHash: approvedDesignContract.prototypeContentHash,
        creativeThesis: approvedDesignContract.creativeThesis,
        approvedSurfaceSequence: approvedDesignContract.approvedSurfaceSequence,
        compositionRules: approvedDesignContract.compositionRules,
        navigation: approvedDesignContract.navigation,
        typography: approvedDesignContract.typography,
        colorTokens: approvedDesignContract.colorTokens,
        spacingTokens: approvedDesignContract.spacingTokens,
        imagery: approvedDesignContract.imagery,
        components: approvedDesignContract.components,
        interactions: approvedDesignContract.interactions,
        motion: approvedDesignContract.motion,
        responsiveBehavior: approvedDesignContract.responsiveBehavior,
        accessibility: approvedDesignContract.accessibility,
        customerModifications: approvedDesignContract.customerModifications,
        explicitExclusions: approvedDesignContract.explicitExclusions,
        prototypeFileManifest: approvedDesignContract.prototypeFileManifest,
        screenshotEvidenceReferences: approvedDesignContract.screenshotEvidenceReferences,
        browserEvidenceReferences: approvedDesignContract.browserEvidenceReferences,
      });
  const isCertifiedLivePrototypeStack = approvedDesignContract?.prototypeFileManifest?.some(
    (file) => file.path === "index.html",
  ) === true;
  // A legacy visual-direction render contract is discovery input, not approval
  // evidence. Strict renderer binding starts only after a live prototype has
  // been selected and frozen into an ApprovedDesignContract.
  const renderContract = designFidelityRequiresPrototypeEvidence(specification) && !isCertifiedLivePrototypeStack
    ? specification.renderContract ?? null
    : null;
  return Object.freeze({
    direction: specification.selectedDirectionName ?? specification.visualPersonality,
    customerInstructions: specification.customerInstructions ?? null,
    composition: specification.composition ?? {
      layoutApproach: specification.layoutStrategy,
      navigationApproach: specification.navigationApproach,
      informationDensity: specification.informationDensity,
      mobileBehavior: specification.responsivePriority,
    },
    visualCharacter: specification.visualCharacter ?? {
      personality: specification.visualPersonality,
      typography: specification.typographyDirection ?? specification.visualPersonality,
      colorMood: specification.colorStrategy ?? specification.tone,
      hierarchy: specification.layoutStrategy,
      spacingDensity: specification.informationDensity,
    },
    visualSystem: specification.visualSystem ?? null,
    creativeDNA: specification.creativeDNA ?? null,
    approvedDesignContract,
    approvedPrototypeSeed,
    renderContract,
    canonicalRendererDocument:
      renderContract === null
        ? null
        : renderDesignConceptDocument(renderContract),
    canonicalRendererRequirements:
      renderContract === null
        ? null
        : designRendererRequirements(renderContract),
    productRenderSpec: renderContract?.productRenderSpec ?? null,
    productRenderSpecRequirements:
      renderContract?.productRenderSpec === undefined
        ? null
        : productRenderSpecRequirements(renderContract.productRenderSpec),
    accessibilityRequirements:
      specification.accessibilityRequirements ?? specification.accessibilityNeeds ?? [],
    interactionStyle:
      specification.interactionStyle ?? contract.selectedDesignDirection.interactionStyle,
    imageryStrategy:
      specification.imageryStrategy ?? specification.visualSystem?.imageryStrategy ?? null,
  });
}

export const DESIGN_FIDELITY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "compositionImplementation",
    "typographyImplementation",
    "colorImplementation",
    "responsiveImplementation",
    "interactionImplementation",
    "sourceFiles",
    "browserEvidence",
  ],
  properties: {
    approvedDesignId: { type: "string", minLength: 1 },
    approvedPrototypeContentHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    approvedConceptVersion: { type: "integer", minimum: 1 },
    compositionImplementation: { type: "string", minLength: 24 },
    typographyImplementation: { type: "string", minLength: 16 },
    colorImplementation: { type: "string", minLength: 16 },
    responsiveImplementation: { type: "string", minLength: 20 },
    interactionImplementation: { type: "string", minLength: 16 },
    sourceFiles: {
      type: "array",
      minItems: 2,
      items: { type: "string", minLength: 1 },
    },
    browserEvidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "capturesScreenshots",
        "measuresComposition",
        "measuresTypography",
        "measuresColor",
        "measuresResponsiveTransformation",
      ],
      properties: {
        capturesScreenshots: { type: "boolean", const: true },
        measuresComposition: { type: "boolean", const: true },
        measuresTypography: { type: "boolean", const: true },
        measuresColor: { type: "boolean", const: true },
        measuresResponsiveTransformation: { type: "boolean", const: true },
      },
    },
  },
});

export function validateGeneratedDesignFidelity(plan, contract, fail) {
  const specification = designExecutionBrief(contract);
  const fidelity = plan.designFidelity;
  if (fidelity === null || typeof fidelity !== "object") {
    fail("Generated mission plan omitted the binding design-fidelity declaration.");
  }

  const implementationText = [
    fidelity.compositionImplementation,
    fidelity.typographyImplementation,
    fidelity.colorImplementation,
    fidelity.responsiveImplementation,
    fidelity.interactionImplementation,
  ].join(" ");
  const approvedPrototype = specification.approvedPrototypeSeed;
  if (approvedPrototype !== null) {
    if (fidelity.approvedDesignId !== approvedPrototype.approvedDesignId) {
      fail("Generated design fidelity is not bound to the approved live concept ID.");
    }
    if (fidelity.approvedPrototypeContentHash !== approvedPrototype.prototypeContentHash) {
      fail("Generated design fidelity is not bound to the approved prototype content hash.");
    }
    if (fidelity.approvedConceptVersion !== approvedPrototype.selectedConceptVersion) {
      fail("Generated design fidelity changed the approved concept version.");
    }
  }
  const approvedText = JSON.stringify(specification);
  if (overlapCount(approvedText, implementationText) < 5) {
    fail("Generated design-fidelity declaration does not preserve enough of the approved design specification.");
  }
  if (GENERIC_LAYOUT_PATTERNS.some((pattern) => pattern.test(implementationText))) {
    fail("Generated design-fidelity declaration admits a generic or placeholder layout.");
  }

  const filesByPath = new Map(plan.files.map((file) => [file.path, file.content]));
  for (const path of fidelity.sourceFiles) {
    if (!filesByPath.has(path)) {
      fail(`Design fidelity references missing source file "${path}".`);
    }
  }
  const sourceText = fidelity.sourceFiles
    .map((path) => `${path}\n${filesByPath.get(path)}`)
    .join("\n");
  if (approvedPrototype !== null) {
    const bindingText = `${sourceText}\n${implementationText}`;
    const sequence = approvedPrototype.approvedSurfaceSequence.filter(
      (item) => typeof item === "string" && item.trim().length > 3,
    );
    if (sequence.length > 0 && overlapCount(sequence.join(" "), bindingText) === 0) {
      fail("Customer-facing source does not preserve the approved live concept surface sequence.");
    }
    const composition = approvedPrototype.compositionRules.filter(
      (item) => typeof item === "string" && item.trim().length > 3,
    );
    if (composition.length > 0 && overlapCount(composition.join(" "), bindingText) === 0) {
      fail("Customer-facing source does not preserve the approved live concept composition.");
    }
    const approvedColors = Object.values(approvedPrototype.colorTokens)
      .filter((value) => /^#[a-f0-9]{3,8}$/iu.test(String(value)));
    for (const color of approvedColors) {
      if (!sourceText.toLowerCase().includes(String(color).toLowerCase())) {
        fail(`Customer-facing source changed approved live concept color token "${color}".`);
      }
    }
    if (
      approvedPrototype.motion.some((rule) => !/\b(?:none|static|no motion)\b/iu.test(rule)) &&
      !/prefers-reduced-motion/iu.test(sourceText)
    ) {
      fail("Approved live concept motion requires a prefers-reduced-motion fallback.");
    }
  }
  if (!/(?:display\s*:\s*(?:grid|flex)|grid-template|position\s*:\s*(?:sticky|fixed|absolute))/iu.test(sourceText)) {
    fail("Customer-facing source does not contain a concrete composition mechanism for the approved design.");
  }
  if (!/(?:font-family|font-size|font-weight|line-height|letter-spacing|next\/font)/iu.test(sourceText)) {
    fail("Customer-facing source does not implement an explicit typography system.");
  }
  if (!/(?:--[a-z0-9-]+\s*:|#[a-f0-9]{3,8}\b|(?:rgb|hsl)a?\s*\()/iu.test(sourceText)) {
    fail("Customer-facing source does not implement an explicit color system.");
  }
  if (!hasResponsiveSourceStrategy(sourceText)) {
    fail("Customer-facing source does not implement a responsive transformation.");
  }

  const browserSource = plan.files
    .filter((file) => /^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(file.path))
    .map((file) => file.content)
    .join("\n");
  if (!/\.screenshot\s*\(/u.test(browserSource)) {
    fail("Browser verification must capture real screenshots for design-fidelity evidence.");
  }
  if (!/(?:getComputedStyle|getBoundingClientRect|boundingBox\s*\()/u.test(browserSource)) {
    fail("Browser verification must measure rendered composition or computed styles.");
  }
  if (!/(?:fontFamily|fontSize|fontWeight|lineHeight|letterSpacing)/u.test(browserSource)) {
    fail("Browser verification must measure rendered typography.");
  }
  if (!/(?:backgroundColor|color\b|getComputedStyle)/u.test(browserSource)) {
    fail("Browser verification must measure rendered color roles.");
  }
  const viewportCount = browserSource.match(/setViewportSize\s*\(|viewport\s*:\s*\{/gu)?.length ?? 0;
  const hasPhone = /(?:375|390|414)/u.test(browserSource);
  const hasTablet = /(?:768|810|834|1024)/u.test(browserSource);
  const hasDesktop = /(?:1280|1440|1512|1728)/u.test(browserSource);
  if (viewportCount < 3 || !hasPhone || !hasTablet || !hasDesktop) {
    fail("Design-fidelity verification must capture phone, tablet, and desktop viewports.");
  }
  // A layout that overflows horizontally on a phone has failed its responsive
  // transform regardless of what the fidelity declaration claims.
  if (!/scrollWidth|clientWidth|documentElement/u.test(browserSource)) {
    fail("Design-fidelity verification must prove the phone viewport has no horizontal overflow.");
  }
  if (!/focus\s*\(|:focus|focus-visible|activeElement/u.test(browserSource)) {
    fail("Design-fidelity verification must prove keyboard focus remains visible.");
  }

  // Structural DNA must be verified, not just the palette.
  const dna = specification.creativeDNA;
  if (dna !== null && dna !== undefined) {
    const sequenceTerms = (dna.surfaceSequence ?? []).filter(
      (region) => typeof region === "string" && region.length > 3,
    );
    if (
      sequenceTerms.length > 0 &&
      overlapCount(sequenceTerms.join(" "), `${sourceText} ${implementationText}`) === 0
    ) {
      fail(
        `Customer-facing source shows no trace of the approved surface sequence (${sequenceTerms.join(" → ")}).`,
      );
    }
    if (dna.motionStrategy !== "static" && !/prefers-reduced-motion/u.test(sourceText)) {
      fail("An approved motion strategy requires a prefers-reduced-motion fallback in the customer-facing source.");
    }
    if (dna.imageryTreatment === "none" && /<img\b|next\/image/u.test(sourceText)) {
      fail("The approved direction excludes imagery, but the generated source renders images.");
    }
  }

  const renderContract = designFidelityRequiresPrototypeEvidence(specification)
    ? specification.renderContract
    : null;
  if (renderContract !== null && renderContract !== undefined) {
    const rendererRequirements = designRendererRequirements(renderContract);
    const productSpec = renderContract.productRenderSpec ?? null;
    if (!sourceText.includes(renderContract.renderContractId)) {
      fail(
        `Customer-facing source does not use approved render contract "${renderContract.renderContractId}".`,
      );
    }
    if (!/data-foundry-render-contract/iu.test(sourceText)) {
      fail("Customer-facing source does not expose the shared renderer contract marker.");
    }
    if (productSpec !== null) {
      if (
        !sourceText.includes(productSpec.renderSpecId) ||
        !/data-foundry-render-spec/iu.test(sourceText)
      ) {
        fail(`Customer-facing source does not use approved product render spec "${productSpec.renderSpecId}".`);
      }
      if (!sourceText.includes("approved-product-render-spec.json")) {
        fail("Customer-facing source must import the frozen approved-product-render-spec.json artifact instead of reconstructing the product tree from prose.");
      }
      for (const screen of productSpec.screens) {
        if (!sourceText.includes(screen.id)) {
          fail(`Customer-facing source omitted approved product screen "${screen.id}".`);
        }
        // The frozen render-spec artifact owns screen action copy. Exact button
        // wording is not a structural design invariant: the initial screen may
        // have no transition button at all, and equivalent customer-facing copy
        // is verified later by the workflow/browser obligations. Requiring each
        // literal here caused valid generated applications to fail admission.
        for (const region of screen.regions) {
          if (!sourceText.includes(region.id)) {
            fail(`Customer-facing source omitted approved product region "${region.id}".`);
          }
        }
      }
    }
    if (
      !/data-foundry-primitive/iu.test(sourceText) ||
      !sourceText.includes(renderContract.primitive)
    ) {
      fail(
        `Customer-facing source does not expose approved renderer primitive "${renderContract.primitive}".`,
      );
    }
    for (const className of rendererRequirements.requiredClasses) {
      if (!sourceText.includes(className)) {
        fail(
          `Customer-facing source does not share the canonical renderer class "${className}" used by Visual Direction.`,
        );
      }
    }
    if (renderContract.authentication?.required) {
      if (!/<form\b/iu.test(sourceText)) {
        fail("The approved authentication journey requires a real sign-in form, not a decorative sign-in label.");
      }
      if (
        !/<input\b[^>]*(?:type\s*=\s*["'](?:email|text)["']|name\s*=\s*["'](?:email|username|identity)["'])/iu.test(sourceText) ||
        !/<input\b[^>]*type\s*=\s*["']password["']/iu.test(sourceText) ||
        !/(?:type\s*=\s*["']submit["']|onSubmit\s*=|onsubmit\s*=)/iu.test(sourceText)
      ) {
        fail("The approved authentication journey requires labeled identity and password controls wired to submission.");
      }
      if (
        !/(?:\.fill\s*\(|\.type\s*\()/u.test(browserSource) ||
        !/(?:type\s*=\s*["']password["']|getByLabel\s*\([^)]*password)/iu.test(browserSource) ||
        !/(?:\.click\s*\(|\.press\s*\()/u.test(browserSource) ||
        !/concept-product-surface/u.test(browserSource)
      ) {
        fail("Browser verification must complete sign-in and assert the post-authentication product surface.");
      }
    }
    const familyGeometry = {
      editorial: [
        /\.concept-hero[^{}]*\{[^{}]*grid-template-columns\s*:\s*1\.55fr\s+\.75fr/isu,
        /\.concept-spread[^{}]*\{[^{}]*grid-template-columns\s*:\s*\.65fr\s+1fr\s+1\.35fr/isu,
      ],
      gallery: [
        /\.concept-gallery[^{}]*\{[^{}]*grid-template-columns\s*:\s*185px\s+1fr/isu,
        /\.concept-grid[^{}]*\{[^{}]*grid-template-columns\s*:\s*repeat\(\s*4\s*,\s*1fr\s*\)/isu,
      ],
      workspace: [
        /\.concept-workspace[^{}]*\{[^{}]*grid-template-columns\s*:\s*150px\s+1fr/isu,
        /\.concept-metrics[^{}]*\{[^{}]*grid-template-columns\s*:\s*repeat\(\s*3\s*,\s*1fr\s*\)/isu,
      ],
      guided: [
        /\.concept-guided[^{}]*\{[^{}]*grid-template-columns\s*:\s*1\.15fr\s+\.85fr/isu,
      ],
      technical: [
        /\.concept-technical[^{}]*\{[^{}]*grid-template-columns\s*:\s*165px\s+1fr/isu,
      ],
    }[rendererRequirements.family] ?? [];
    if (familyGeometry.some((pattern) => !pattern.test(sourceText))) {
      fail(
        `Customer-facing source changed the canonical ${rendererRequirements.family} renderer geometry shown in Visual Direction.`,
      );
    }
    if (
      !/@media\s*\(\s*max-width\s*:\s*560px\s*\)/iu.test(sourceText) ||
      !new RegExp(
        `\\.${rendererRequirements.responsiveClass}[^{}]*\\{[^{}]*grid-template-columns\\s*:\\s*1fr`,
        "isu",
      ).test(sourceText)
    ) {
      fail(
        "Customer-facing source changed the canonical renderer's 560px responsive transformation.",
      );
    }
    for (const color of Object.values(renderContract.colors ?? {})) {
      if (!sourceText.toLowerCase().includes(String(color).toLowerCase())) {
        fail(`Customer-facing source changed approved renderer color token "${color}".`);
      }
    }
    if (!sourceText.includes(renderContract.primaryAction)) {
      fail(
        `Customer-facing source omitted approved primary action "${renderContract.primaryAction}".`,
      );
    }
    if (
      renderContract.imageryTreatment !== "none" &&
      /placeholder/iu.test(sourceText)
    ) {
      fail(
        "Customer-facing source substitutes placeholder imagery for the approved renderer treatment.",
      );
    }
    const escapedPrimaryAction = renderContract.primaryAction.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    if (
      new RegExp(
        `<a\\b[^>]*href\\s*=\\s*["']#[^"']+["'][^>]*>[\\s\\S]{0,160}${escapedPrimaryAction}[\\s\\S]{0,40}</a>`,
        "iu",
      ).test(sourceText)
    ) {
      fail(
        "The approved primary action is a same-page no-op anchor instead of a working interaction.",
      );
    }
    const regionTerms = (renderContract.regions ?? []).filter(
      (region) => typeof region === "string" && region.length > 3,
    );
    if (
      regionTerms.length > 0 &&
      overlapCount(regionTerms.join(" "), sourceText) <
        Math.min(2, regionTerms.length)
    ) {
      fail("Customer-facing source does not preserve the shared renderer's approved product regions.");
    }
    if (
      !browserSource.includes(renderContract.renderContractId) ||
      !/data-foundry-render-contract/iu.test(browserSource)
    ) {
      fail("Browser verification does not assert the exact shared renderer contract used by the studio preview.");
    }
    if (
      !rendererRequirements.requiredClasses.every((className) =>
        browserSource.includes(className),
      )
    ) {
      fail(
        "Browser verification does not measure every canonical renderer region used by Visual Direction.",
      );
    }
    if (!/(?:expect\s*\(|assert(?:\.|\s*\())/u.test(browserSource)) {
      fail(
        "Browser verification measures the canonical renderer but never asserts its geometry or visual tokens.",
      );
    }
  }

  return Object.freeze({
    specification,
    declaration: fidelity,
  });
}
