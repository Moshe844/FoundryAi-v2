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
  if (!/(?:display\s*:\s*(?:grid|flex)|grid-template|position\s*:\s*(?:sticky|fixed|absolute))/iu.test(sourceText)) {
    fail("Customer-facing source does not contain a concrete composition mechanism for the approved design.");
  }
  if (!/(?:font-family|font-size|font-weight|line-height|letter-spacing|next\/font)/iu.test(sourceText)) {
    fail("Customer-facing source does not implement an explicit typography system.");
  }
  if (!/(?:--[a-z0-9-]+\s*:|#[a-f0-9]{3,8}\b|(?:rgb|hsl)a?\s*\()/iu.test(sourceText)) {
    fail("Customer-facing source does not implement an explicit color system.");
  }
  if (!/(?:@media|clamp\s*\(|minmax\s*\(|container-type|useMediaQuery)/iu.test(sourceText)) {
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
  if (viewportCount < 2 || !/(?:375|390|414)/u.test(browserSource) || !/(?:1024|1280|1440)/u.test(browserSource)) {
    fail("Design-fidelity verification must compare at least one phone and one desktop viewport.");
  }

  return Object.freeze({
    specification,
    declaration: fidelity,
  });
}
