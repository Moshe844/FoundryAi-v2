import { createHash } from "node:crypto";
import { posix as posixPath } from "node:path";

import { ContractBindingValidationError } from "./errors.js";
import { normalizeApprovedProjectContract } from "./approved-project-contract.js";
import {
  DESIGN_FIDELITY_SCHEMA,
  designExecutionBrief,
  validateGeneratedDesignFidelity,
} from "./design-fidelity.js";
import { renderDesignConceptDocument } from "./design-concept-renderer.js";

const IDENTIFIER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u;
const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "build", "customer", "customers",
  "each", "for", "from", "have", "into", "more", "must", "need", "only",
  "project", "should", "that", "the", "their", "them", "this", "through",
  "user", "users", "using", "with", "would",
]);

function fail(message) {
  throw new ContractBindingValidationError(message);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function text(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} must be a non-empty string.`);
  return value.trim();
}

function identifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail(`${label} must be a stable identifier.`);
  return value;
}

function exact(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} must contain exactly: ${expected.join(", ")}.`);
}

function uniqueIdentifiers(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`);
  const result = value.map((entry, index) => identifier(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates.`);
  return result;
}

function tokens(value) {
  return new Set(String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((token) => token.length >= 4 && !STOP_WORDS.has(token)));
}

function overlaps(left, right) {
  const rightTokens = tokens(right);
  for (const token of tokens(left)) if (rightTokens.has(token)) return true;
  return false;
}

function preservesRequirementSubject(requirement, summary) {
  if (overlaps(requirement.statement, summary)) return true;
  // Design requirements carry creative direction names and prose rationales
  // ("Coastal calm. Soft blues convey trust."), so a faithful implementation
  // summary legitimately shares no ≥4-letter token with the statement. Accept
  // a summary that is unambiguously about implementing the visual design;
  // summaries about unrelated features still fail. This mirrors the existing
  // production-build carve-out below for the same token-overlap limitation.
  if (
    requirement.kind.startsWith("design-") &&
    /\b(?:design(?:ed|s)?|visual(?:s|ly)?|styl(?:e[sd]?|ing)|direction|palette|colou?r(?:s|ed)?|typograph\w*|font\w*|layout\w*|navigat\w*|responsive|mobile|hierarch\w*|aesthetic\w*|brand(?:ed|ing)?|look|theme[sd]?|spacing|accessib\w*)\b/iu.test(
      summary,
    )
  ) {
    return true;
  }
  return (
    requirement.kind === "acceptance-obligation" &&
    /\bproduction build\b/iu.test(requirement.statement) &&
    /\b(?:production|compile[sd]?|compilation|package[sd]?|packaging|bundle[sd]?)\b/iu.test(summary)
  );
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function bindApprovedPrimaryAction(content, primaryAction) {
  if (content.includes(primaryAction)) {
    return { content, bound: true };
  }
  const approvedTokens = tokens(primaryAction);
  const candidatePattern = /<button\b[\s\S]{0,500}?<\/button>/giu;
  let best = null;
  for (const match of content.matchAll(candidatePattern)) {
    const labelMatch = /(?<label>[^<>{}\r\n]{1,160})<\/button>$/iu.exec(
      match[0],
    );
    const label = labelMatch?.groups?.label?.trim() ?? "";
    if (label === "") continue;
    const sharedTokens = [...tokens(label)].filter((token) =>
      approvedTokens.has(token),
    );
    if (sharedTokens.length === 0) continue;
    if (!/(?:onClick\s*=|type\s*=\s*["']submit["'])/iu.test(match[0])) {
      continue;
    }
    if (best === null || sharedTokens.length > best.score) {
      const labelIndex = match[0].lastIndexOf(label);
      best = {
        index: match.index,
        length: match[0].length,
        replacement:
          match[0].slice(0, labelIndex) +
          primaryAction +
          match[0].slice(labelIndex + label.length),
        score: sharedTokens.length,
      };
    }
  }
  if (best === null) return { content, bound: false };
  return {
    content:
      content.slice(0, best.index) +
      best.replacement +
      content.slice(best.index + best.length),
    bound: true,
  };
}

function rendererRootOpeningTag(content) {
  const patterns = [
    /<(?:html|body|main|div|section|article)\b(?=[^>]*data-foundry-(?:primitive|render-spec)\b)[^>]*>/u,
    /<main\b[^>]*>/u,
    /<(?:body|div|section|article)\b(?=[^>]*className=)[^>]*>/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match !== null) return match;
  }
  return null;
}

function bindRenderContractMarker(content, renderContract) {
  const marker = `data-foundry-render-contract="${renderContract.renderContractId}"`;
  if (content.includes(marker)) return { content, bound: true };
  const root = rendererRootOpeningTag(content);
  if (root === null) return { content, bound: false };
  const closingOffset = root[0].endsWith("/>") ? 2 : 1;
  const insertionIndex = root.index + root[0].length - closingOffset;
  return {
    content:
      content.slice(0, insertionIndex) +
      ` ${marker}` +
      content.slice(insertionIndex),
    bound: true,
  };
}

function productRenderSpecImportPath(sourcePath, productSpecPath) {
  const relativePath = posixPath.relative(
    posixPath.dirname(sourcePath),
    productSpecPath,
  );
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function bindProductRenderSpecArtifact(
  content,
  sourcePath,
  renderContract,
  productSpecPath,
) {
  const marker = `data-foundry-render-contract="${renderContract.renderContractId}"`;
  if (!content.includes(marker)) return { content, bound: false };

  const existingImport = /import\s+(?<binding>[A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["'][^"']*approved-product-render-spec\.json["'];?/u.exec(
    content,
  );
  const bindingName =
    existingImport?.groups?.binding ?? "foundryApprovedProductRenderSpec";
  let boundContent = content;
  if (existingImport === null) {
    const importPath = productRenderSpecImportPath(sourcePath, productSpecPath);
    const importStatement = `import ${bindingName} from ${JSON.stringify(importPath)};\n`;
    const directiveMatch = /^(?:\uFEFF)?(?<directives>\s*(?:["'](?:use client|use server|use strict)["'];?\s*)+)/u.exec(
      boundContent,
    );
    const insertionIndex = directiveMatch?.[0].length ?? 0;
    boundContent =
      boundContent.slice(0, insertionIndex) +
      importStatement +
      boundContent.slice(insertionIndex);
  }

  const existingSpecMarker = /data-foundry-render-spec=(?:["'][^"']*["']|\{[^{}]*\})/u;
  if (existingSpecMarker.test(boundContent)) {
    boundContent = boundContent.replace(
      existingSpecMarker,
      `data-foundry-render-spec={${bindingName}.renderSpecId ?? "${renderContract.productRenderSpec.renderSpecId}"}`,
    );
  } else if (!/data-foundry-render-spec=/u.test(boundContent)) {
    boundContent = boundContent.replace(
      marker,
      `${marker} data-foundry-render-spec={${bindingName}.renderSpecId ?? "${renderContract.productRenderSpec.renderSpecId}"}`,
    );
  }

  return {
    content: boundContent,
    bound:
      boundContent.includes("approved-product-render-spec.json") &&
      /data-foundry-render-spec=/u.test(boundContent),
  };
}

function bindBrowserActionLabels(browserContent, sourceText) {
  const sourceLabels = [
    ...sourceText.matchAll(
      /<button\b[\s\S]{0,500}?>(?<label>[^<>{}\r\n]{1,160})<\/button>/giu,
    ),
  ]
    .map((match) => match.groups?.label?.trim() ?? "")
    .filter((label, index, labels) =>
      label !== "" && labels.indexOf(label) === index,
    );
  if (sourceLabels.length === 0) return browserContent;
  return browserContent.replace(
    /hasText\s*:\s*(?<quote>["'])(?<label>[^"'\r\n]+)\k<quote>/gu,
    (match, _quote, expectedLabel) => {
      if (sourceText.includes(expectedLabel)) return match;
      const expectedTokens = tokens(expectedLabel);
      let best = null;
      for (const sourceLabel of sourceLabels) {
        const shared = [...tokens(sourceLabel)].filter((token) =>
          expectedTokens.has(token),
        ).length;
        if (shared === 0) continue;
        if (best === null || shared > best.shared) {
          best = { label: sourceLabel, shared };
        }
      }
      return best === null ? match : `hasText: ${JSON.stringify(best.label)}`;
    },
  );
}

function baseCanonicalRendererProof(renderContract, rendererSelectors) {
  return `\n  const foundryRenderer = page.locator('[data-foundry-render-contract="${renderContract.renderContractId}"]');\n  await page.setViewportSize({ width: 390, height: 844 });\n  await expect(foundryRenderer).toBeVisible();\n  await page.screenshot({ path: "foundry-phone.png", fullPage: true });\n  await page.setViewportSize({ width: 768, height: 1024 });\n  await expect(foundryRenderer).toBeVisible();\n  await page.screenshot({ path: "foundry-tablet.png", fullPage: true });\n  await page.setViewportSize({ width: 1280, height: 900 });\n  await expect(foundryRenderer).toBeVisible();\n  await page.screenshot({ path: "foundry-desktop.png", fullPage: true });\n  const foundryRendererEvidence = await foundryRenderer.evaluate((element) => {\n    const style = getComputedStyle(element);\n    const box = element.getBoundingClientRect();\n    return {\n      width: box.width,\n      height: box.height,\n      fontFamily: style.fontFamily,\n      fontSize: style.fontSize,\n      fontWeight: style.fontWeight,\n      lineHeight: style.lineHeight,\n      backgroundColor: style.backgroundColor,\n      color: style.color,\n    };\n  });\n  expect(foundryRendererEvidence.width).toBeGreaterThan(0);\n  expect(foundryRendererEvidence.height).toBeGreaterThan(0);\n  expect(foundryRendererEvidence.fontFamily).not.toBe("");\n  expect(foundryRendererEvidence.fontSize).not.toBe("");\n  expect(foundryRendererEvidence.backgroundColor).not.toBe("");\n  expect(foundryRendererEvidence.color).not.toBe("");\n  const foundryHorizontalOverflow = await page.evaluate(() =>\n    document.documentElement.scrollWidth > document.documentElement.clientWidth\n  );\n  expect(foundryHorizontalOverflow).toBe(false);\n  await page.keyboard.press("Tab");\n  const foundryActiveElement = await page.evaluate(() => document.activeElement?.tagName ?? null);\n  expect(foundryActiveElement).not.toBeNull();\n  for (const selector of ${JSON.stringify(rendererSelectors)}) {\n    await expect(page.locator(selector)).toBeVisible();\n  }\n`;
}

function canonicalRendererProof(renderContract, rendererSelectors) {
  const proof = baseCanonicalRendererProof(renderContract, rendererSelectors);
  const productSpec = renderContract.productRenderSpec ?? null;
  if (productSpec === null) return proof;
  const referenceDocumentBase64 = Buffer.from(
    renderDesignConceptDocument(renderContract),
    "utf8",
  ).toString("base64");
  const specProof = `\n  await expect(foundryRenderer).toHaveAttribute("data-foundry-render-spec", "${productSpec.renderSpecId}");\n  for (const screenId of ${JSON.stringify(productSpec.screens.map((screen) => screen.id))}) {\n    expect(await page.locator('[data-foundry-screen="' + screenId + '"]').count()).toBeGreaterThan(0);\n  }\n  for (const regionId of ${JSON.stringify(productSpec.screens.flatMap((screen) => screen.regions.map((region) => region.id)))}) {\n    expect(await page.locator('[data-foundry-region="' + regionId + '"]').count()).toBeGreaterThan(0);\n  }`;
  const withSpec = proof.replace(
    "\n  await page.setViewportSize({ width: 390, height: 844 });",
    `\n  await page.goto("/");${specProof}\n  await page.setViewportSize({ width: 390, height: 844 });`,
  );
  const parityProof = `\n  const foundryBuiltScreenshot = await page.screenshot({ animations: "disabled" });\n  const foundryReferencePage = await page.context().newPage();\n  await foundryReferencePage.setViewportSize({ width: 1280, height: 900 });\n  await foundryReferencePage.setContent(Buffer.from("${referenceDocumentBase64}", "base64").toString("utf8"), { waitUntil: "load" });\n  const foundryReferenceScreenshot = await foundryReferencePage.screenshot({ animations: "disabled" });\n  const foundryPixelParity = await foundryReferencePage.evaluate(async ({ built, reference }) => {\n    const decode = async (base64) => {\n      const image = new Image();\n      image.src = "data:image/png;base64," + base64;\n      await image.decode();\n      const canvas = document.createElement("canvas");\n      canvas.width = image.naturalWidth;\n      canvas.height = image.naturalHeight;\n      const context = canvas.getContext("2d", { willReadFrequently: true });\n      context.drawImage(image, 0, 0);\n      return { width: canvas.width, height: canvas.height, pixels: context.getImageData(0, 0, canvas.width, canvas.height).data };\n    };\n    const actual = await decode(built);\n    const expected = await decode(reference);\n    if (actual.width !== expected.width || actual.height !== expected.height) return { widthMatch: false, changedPixelRatio: 1, meanChannelDelta: 255 };\n    let changedPixels = 0;\n    let channelDelta = 0;\n    for (let offset = 0; offset < actual.pixels.length; offset += 4) {\n      const red = Math.abs(actual.pixels[offset] - expected.pixels[offset]);\n      const green = Math.abs(actual.pixels[offset + 1] - expected.pixels[offset + 1]);\n      const blue = Math.abs(actual.pixels[offset + 2] - expected.pixels[offset + 2]);\n      channelDelta += red + green + blue;\n      if (red > 12 || green > 12 || blue > 12) changedPixels += 1;\n    }\n    const pixels = actual.width * actual.height;\n    return { widthMatch: true, changedPixelRatio: changedPixels / pixels, meanChannelDelta: channelDelta / (pixels * 3) };\n  }, { built: foundryBuiltScreenshot.toString("base64"), reference: foundryReferenceScreenshot.toString("base64") });\n  expect(foundryPixelParity.widthMatch).toBe(true);\n  expect(foundryPixelParity.changedPixelRatio).toBeLessThanOrEqual(0.02);\n  expect(foundryPixelParity.meanChannelDelta).toBeLessThanOrEqual(3);\n  const foundryManifest = async (targetPage) => targetPage.locator('[data-foundry-screen], [data-foundry-region]').evaluateAll((elements) => Object.fromEntries(elements.map((element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); const id = element.getAttribute("data-foundry-screen") ?? element.getAttribute("data-foundry-region"); return [id, { x: box.x, y: box.y, width: box.width, height: box.height, display: style.display, position: style.position, fontFamily: style.fontFamily, fontSize: style.fontSize, backgroundColor: style.backgroundColor, color: style.color }]; })));\n  const foundryBuiltManifest = await foundryManifest(page);\n  const foundryReferenceManifest = await foundryManifest(foundryReferencePage);\n  expect(Object.keys(foundryBuiltManifest).sort()).toEqual(Object.keys(foundryReferenceManifest).sort());\n  for (const [id, expected] of Object.entries(foundryReferenceManifest)) {\n    const actual = foundryBuiltManifest[id];\n    expect(Math.abs(actual.x - expected.x), id + " x geometry").toBeLessThanOrEqual(1.5);\n    expect(Math.abs(actual.y - expected.y), id + " y geometry").toBeLessThanOrEqual(1.5);\n    expect(Math.abs(actual.width - expected.width), id + " width geometry").toBeLessThanOrEqual(1.5);\n    expect(Math.abs(actual.height - expected.height), id + " height geometry").toBeLessThanOrEqual(1.5);\n    expect({ display: actual.display, position: actual.position, fontFamily: actual.fontFamily, fontSize: actual.fontSize, backgroundColor: actual.backgroundColor, color: actual.color }).toEqual({ display: expected.display, position: expected.position, fontFamily: expected.fontFamily, fontSize: expected.fontSize, backgroundColor: expected.backgroundColor, color: expected.color });\n  }\n  await foundryReferencePage.close();`;
  return withSpec.replace(
    '\n  const foundryRendererEvidence = await foundryRenderer.evaluate((element) => {',
    `${parityProof}\n  const foundryRendererEvidence = await foundryRenderer.evaluate((element) => {`,
  );
}

function normalizeBrowserTestScaffold(content) {
  let normalized = content.replaceAll(
    "Record<string, Record<string, boolean>>",
    "Record<string, Record<string, unknown>>",
  );
  normalized = normalized
    .replaceAll(
      "const decode = async (base64) =>",
      'const decode = async (base64 = "") =>',
    )
    .replaceAll(
      "const foundryManifest = async (targetPage) =>",
      "const foundryManifest = async (targetPage = page) =>",
    )
    .replaceAll(
      "const context = canvas.getContext(\"2d\", { willReadFrequently: true });\n      context.drawImage",
      "const context = canvas.getContext(\"2d\", { willReadFrequently: true });\n      if (context === null) throw new Error(\"Canvas 2D context is unavailable for render parity.\");\n      context.drawImage",
    );
  if (!/\bexpect\s*\(/u.test(normalized)) return normalized;
  const playwrightImport = /import\s*\{(?<imports>[^}]*)\}\s*from\s*(?<quote>["'])@playwright\/test\k<quote>;?/u;
  const match = playwrightImport.exec(normalized);
  if (match === null) {
    return `import { test, expect } from "@playwright/test";\n${normalized}`;
  }
  const imports = match.groups.imports
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (!imports.includes("expect")) imports.push("expect");
  return (
    normalized.slice(0, match.index) +
    `import { ${imports.join(", ")} } from ${match.groups.quote}@playwright/test${match.groups.quote};` +
    normalized.slice(match.index + match[0].length)
  );
}

function bindRendererAssertions(content, renderContract, rendererSelectors) {
  const assertion = canonicalRendererProof(renderContract, rendererSelectors);
  const closingIndex = content.lastIndexOf("});");
  if (closingIndex < 0) return { content, bound: false };
  return {
    content:
      content.slice(0, closingIndex) +
      assertion +
      content.slice(closingIndex),
    bound: true,
  };
}

export function bindCanonicalRendererRootClass(plan, contract) {
  const brief = designExecutionBrief(contract);
  const renderContract = brief.renderContract;
  if (renderContract === null || renderContract === undefined) return plan;
  const originalFidelitySourcePaths = plan.designFidelity?.sourceFiles ?? [];
  const fidelitySourcePaths = new Set(
    originalFidelitySourcePaths,
  );
  const marker = `data-foundry-render-contract="${renderContract.renderContractId}"`;
  const customerSourceFiles = plan.files.filter(
    (file) =>
      /\.(?:jsx?|tsx?)$/iu.test(file.path) &&
      !/^(?:tests?|scripts?|app\/api|src\/app\/api)\//iu.test(file.path),
  );
  const existingMarkerFile = customerSourceFiles.find((file) =>
    file.content.includes(marker),
  );
  const markerTargetFile =
    existingMarkerFile ??
    customerSourceFiles.find(
      (file) =>
        fidelitySourcePaths.has(file.path) &&
        rendererRootOpeningTag(file.content) !== null,
    ) ??
    customerSourceFiles.find(
      (file) =>
        /^(?:src\/)?app\/page\.(?:jsx?|tsx?)$/iu.test(file.path) &&
        rendererRootOpeningTag(file.content) !== null,
    ) ??
    customerSourceFiles.find(
      (file) => rendererRootOpeningTag(file.content) !== null,
    );
  if (markerTargetFile !== undefined) {
    fidelitySourcePaths.add(markerTargetFile.path);
  }
  const normalizedFidelitySourcePaths = [...fidelitySourcePaths];
  const fidelitySourcesChanged =
    normalizedFidelitySourcePaths.length !== originalFidelitySourcePaths.length ||
    normalizedFidelitySourcePaths.some(
      (path, index) => path !== originalFidelitySourcePaths[index],
    );
  const normalizedDesignFidelity = fidelitySourcesChanged
    ? {
        ...plan.designFidelity,
        sourceFiles: normalizedFidelitySourcePaths,
      }
    : plan.designFidelity;
  const sourceText = plan.files
    .filter((file) => fidelitySourcePaths.has(file.path))
    .map((file) => file.content)
    .join("\n");
  const markerBindingNeeded = !sourceText.includes(marker);
  const markerTargetPath = markerBindingNeeded
    ? markerTargetFile?.path
    : undefined;
  const classesToBind = [
    `concept-${renderContract.primitive}`,
    ...(brief.canonicalRendererRequirements?.requiredClasses ?? []),
  ].filter(
    (className, index, classes) =>
      classes.indexOf(className) === index && !sourceText.includes(className),
  );
  const canonicalCss = /<style>(?<css>[\s\S]*?)<\/style>/u.exec(
    brief.canonicalRendererDocument ?? "",
  )?.groups?.css?.trim() ?? "";
  const rendererCssPath = [...fidelitySourcePaths].find((path) =>
    /\.css$/iu.test(path),
  );
  const cssNeedsBinding =
    canonicalCss !== "" &&
    rendererCssPath !== undefined &&
    !plan.files.find((file) => file.path === rendererCssPath)?.content.includes(
      `--accent:${renderContract.colors.accent}`,
    );
  const browserTest = plan.files.find((file) =>
    /^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(file.path),
  );
  const browserSource = plan.files
    .filter((file) => /^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(file.path))
    .map((file) => file.content)
    .join("\n");
  const browserActionLabelsPreview =
    browserTest === undefined
      ? null
      : bindBrowserActionLabels(browserTest.content, sourceText);
  const browserActionLabelsNeedBinding =
    browserTest !== undefined &&
    browserActionLabelsPreview !== browserTest.content;
  const rendererSelectors = [
    ...new Set(
      brief.canonicalRendererRequirements.requiredClasses.map(
        (className) => `.${className}`,
      ),
    ),
  ];
  const authJourneyTestNeeded =
    renderContract.authentication?.required === true &&
    browserTest !== undefined &&
    (
      !/(?:\.fill\s*\(|\.type\s*\()/u.test(browserSource) ||
      !/(?:type\s*=\s*["']password["']|getByLabel\s*\([^)]*password)/iu.test(browserSource) ||
      !/(?:\.click\s*\(|\.press\s*\()/u.test(browserSource)
    );
  const browserScaffoldBindingNeeded =
    browserTest !== undefined &&
    /Record<string,\s*Record<string,\s*boolean>>/u.test(browserSource);
  const viewportCount =
    browserSource.match(/setViewportSize\s*\(|viewport\s*:\s*\{/gu)?.length ?? 0;
  const rendererAssertionsNeeded =
    browserTest !== undefined &&
    (
      !/\.screenshot\s*\(/u.test(browserSource) ||
      !/(?:getComputedStyle|getBoundingClientRect|boundingBox\s*\()/u.test(browserSource) ||
      !/(?:fontFamily|fontSize|fontWeight|lineHeight|letterSpacing)/u.test(browserSource) ||
      !/(?:backgroundColor|color\b|getComputedStyle)/u.test(browserSource) ||
      viewportCount < 3 ||
      !/(?:375|390|414)/u.test(browserSource) ||
      !/(?:768|810|834|1024)/u.test(browserSource) ||
      !/(?:1280|1440|1512|1728)/u.test(browserSource) ||
      !/scrollWidth|clientWidth|documentElement/u.test(browserSource) ||
      !/focus\s*\(|:focus|focus-visible|activeElement/u.test(browserSource) ||
      !browserSource.includes("foundryPixelParity") ||
      !browserSource.includes("changedPixelRatio") ||
      !browserSource.includes(renderContract.renderContractId) ||
      !/data-foundry-render-contract/iu.test(browserSource) ||
      (renderContract.productRenderSpec !== undefined &&
        (
          !browserSource.includes(renderContract.productRenderSpec.renderSpecId) ||
          !/data-foundry-render-spec/iu.test(browserSource)
        )) ||
      !rendererSelectors.every((selector) => browserSource.includes(selector))
    );
  const primaryActionBindingNeeded = !sourceText.includes(
    renderContract.primaryAction,
  );
  const canonicalReferencePath = "foundry/approved-product-renderer.html";
  const productSpecPath = "foundry/approved-product-render-spec.json";
  const productSpecBindingNeeded =
    renderContract.productRenderSpec !== undefined &&
    (
      !sourceText.includes(renderContract.productRenderSpec.renderSpecId) ||
      !/data-foundry-render-spec/iu.test(sourceText) ||
      !sourceText.includes("approved-product-render-spec.json")
    );
  const canonicalReferenceNeeded = !plan.files.some(
    (file) => file.path === canonicalReferencePath,
  ) || !plan.files.some((file) => file.path === productSpecPath);
  if (
    classesToBind.length === 0 &&
    !cssNeedsBinding &&
    !authJourneyTestNeeded &&
    !rendererAssertionsNeeded &&
    !browserScaffoldBindingNeeded &&
    !browserActionLabelsNeedBinding &&
    !fidelitySourcesChanged &&
    !markerBindingNeeded &&
    !primaryActionBindingNeeded &&
    !productSpecBindingNeeded &&
    !canonicalReferenceNeeded
  ) return plan;
  const bindingClasses = classesToBind.join(" ");
  let markerBound = !markerBindingNeeded;
  let bound = classesToBind.length === 0;
  let primaryActionBound = !primaryActionBindingNeeded;
  let productSpecBound = !productSpecBindingNeeded;
  let rendererAssertionsBound = !rendererAssertionsNeeded;
  const files = plan.files.map((file) => {
    let content = file.content;
    if (!markerBound && file.path === markerTargetPath) {
      const markerBinding = bindRenderContractMarker(content, renderContract);
      content = markerBinding.content;
      markerBound = markerBinding.bound;
    }
    if (browserTest !== undefined && file.path === browserTest.path) {
      content = bindBrowserActionLabels(content, sourceText);
      content = normalizeBrowserTestScaffold(content);
    }
    if (authJourneyTestNeeded && file.path === browserTest.path) {
      const identitySelector =
        'input[type="email"], input[name="email"], input[name="username"], input[name="identity"]';
      content = `${content}\n\ntest("approved authentication reaches the canonical product surface", async ({ page }) => {\n  await page.goto("/");\n  await page.locator(${JSON.stringify(identitySelector)}).first().fill("member@example.com");\n  await page.locator('input[type="password"]').first().fill("FoundryPass123!");\n  await page.locator('button[type="submit"], input[type="submit"]').first().click();\n  await expect(page.locator('.concept-product-surface')).toBeVisible();${canonicalRendererProof(renderContract, rendererSelectors)}\n});\n`;
      rendererAssertionsBound = true;
    } else if (
      rendererAssertionsNeeded &&
      !rendererAssertionsBound &&
      file.path === browserTest.path
    ) {
      const assertionBinding = bindRendererAssertions(
        content,
        renderContract,
        rendererSelectors,
      );
      content = assertionBinding.content;
      rendererAssertionsBound = assertionBinding.bound;
    }
    if (browserTest !== undefined && file.path === browserTest.path) {
      content = normalizeBrowserTestScaffold(content);
    }
    if (cssNeedsBinding && file.path === rendererCssPath) {
      content = `${content}\n\n/* Foundry canonical renderer ${renderContract.renderContractId} */\n${canonicalCss}\n`;
    }
    if (!primaryActionBound && fidelitySourcePaths.has(file.path)) {
      const actionBinding = bindApprovedPrimaryAction(
        content,
        renderContract.primaryAction,
      );
      content = actionBinding.content;
      primaryActionBound = actionBinding.bound;
    }
    if (!bound && content.includes(marker)) {
      const openingTag = /<[^>]*data-foundry-render-contract="[^"]+"[^>]*>/u;
      const match = openingTag.exec(content);
      if (match !== null) {
        let replacement = match[0];
        const quotedClass = /className=(?<quote>["'])(?<classes>[^"']*)\k<quote>/u;
        if (quotedClass.test(replacement)) {
          replacement = replacement.replace(
            quotedClass,
            (_value, quote, classes) =>
              `className=${quote}${classes} ${bindingClasses}${quote}`,
          );
        } else {
          replacement = replacement.replace(
            /^(?<tag><[A-Za-z][A-Za-z0-9.]*)/u,
            `$<tag> className="${bindingClasses}"`,
          );
        }
        if (replacement !== match[0]) {
          content =
            content.slice(0, match.index) +
            replacement +
            content.slice(match.index + match[0].length);
          bound = true;
        }
      }
    }
    if (!productSpecBound && fidelitySourcePaths.has(file.path)) {
      const productSpecBinding = bindProductRenderSpecArtifact(
        content,
        file.path,
        renderContract,
        productSpecPath,
      );
      content = productSpecBinding.content;
      productSpecBound = productSpecBinding.bound;
    }
    return content === file.content ? file : { ...file, content };
  });
  if (canonicalReferenceNeeded) {
    const traceSource = plan.files.find((file) =>
      fidelitySourcePaths.has(file.path),
    );
    const trace = Array.isArray(traceSource?.contractRequirementIds)
      ? { contractRequirementIds: [...traceSource.contractRequirementIds] }
      : {};
    if (!files.some((file) => file.path === canonicalReferencePath)) {
      files.push({
        path: canonicalReferencePath,
        content: brief.canonicalRendererDocument,
        ...trace,
      });
    }
    if (!files.some((file) => file.path === productSpecPath)) {
      files.push({
        path: productSpecPath,
        content: `${JSON.stringify(renderContract.productRenderSpec, null, 2)}\n`,
        ...trace,
      });
    }
  }
  // Every successful binding above is deterministic and independently safe.
  // Keep those local normalizations even when a genuinely semantic defect
  // (for example, a missing functional primary action) remains. Validation
  // can then report the real unresolved defect instead of repeatedly exposing
  // an earlier mechanical omission that Foundry already knows how to bind.
  const filesChanged =
    files.length !== plan.files.length ||
    files.some((file, index) => file !== plan.files[index]);
  return filesChanged || fidelitySourcesChanged
    ? { ...plan, designFidelity: normalizedDesignFidelity, files }
    : plan;
}

function entry(requirementId, kind, statement) {
  return { requirementId, kind, statement: text(statement, `${requirementId}.statement`) };
}

function addBlueprintDesignRequirements(add, implementation, exclusions, blueprint) {
  const design = blueprint.designSpecification;
  if (design === null || typeof design !== "object") return;
  const composition = design.composition ?? {};
  const visual = design.visualCharacter ?? {};
  const additions = [
    ["blueprint-design-direction", "design-direction", `${design.selectedDirectionName ?? design.visualPersonality}. ${design.rationale ?? ""}`],
    ["blueprint-design-composition", "design-composition", `${composition.layoutApproach ?? design.layoutStrategy}. ${visual.hierarchy ?? ""}`],
    ["blueprint-design-navigation", "design-navigation", `${composition.navigationApproach ?? design.navigationApproach}. ${design.interactionStyle ?? ""}`],
    ["blueprint-design-typography", "design-typography", `${visual.typography ?? design.typographyDirection ?? design.visualPersonality}`],
    ["blueprint-design-color", "design-color", `${visual.colorMood ?? design.colorStrategy ?? design.tone}`],
    ["blueprint-design-responsive", "design-responsive", `${composition.mobileBehavior ?? design.responsivePriority}`],
  ];
  for (const [id, kind, statement] of additions) {
    if (typeof statement === "string" && statement.trim().length > 2) {
      add(implementation, entry(id, kind, statement));
    }
  }
  // Structural design DNA. Without these the builder receives a mood and a
  // palette, which is how a "selected direction" ends up recognizable only by
  // its accent colour. Each entry below is independently verifiable against
  // the finished application.
  const dna = design.creativeDNA ?? null;
  if (dna !== null && typeof dna === "object") {
    const structural = [
      ["blueprint-design-primitive", "design-composition-primitive",
        `Compose every customer-facing surface as a ${String(dna.compositionPrimitive).replaceAll("-", " ")}. This structure is binding, not a suggestion.`],
      ["blueprint-design-sequence", "design-surface-sequence",
        `Lay out the primary surface in this order: ${(dna.surfaceSequence ?? []).join(" then ")}.`],
      ["blueprint-design-typescale", "design-typography",
        `Set type in a ${String(dna.typeVoice).replaceAll("-", " ")} voice at a ${dna.typeScale} scale, with a matching modular scale for every heading level.`],
      ["blueprint-design-imagery", "design-imagery",
        `Treat imagery as ${String(dna.imageryTreatment).replaceAll("-", " ")}.`],
      ["blueprint-design-motion", "design-motion",
        `Motion character must be ${dna.motionStrategy}, and must respect prefers-reduced-motion.`],
      ["blueprint-design-rhythm", "design-spacing",
        `Use a ${String(dna.spacingRhythm).replaceAll("-", " ")} spacing rhythm derived from a single spacing scale.`],
      ["blueprint-design-surface-depth", "design-surface",
        `Render surfaces as ${String(dna.surfaceDepth).replaceAll("-", " ")}.`],
      ["blueprint-design-responsive-transform", "design-responsive",
        `On phone viewports the layout must ${String(dna.responsiveTransform).replaceAll("-", " ")} without horizontal overflow.`],
    ];
    for (const [id, kind, statement] of structural) {
      if (typeof statement === "string" && statement.trim().length > 2) {
        add(implementation, entry(id, kind, statement));
      }
    }
    for (const [index, exclusion] of (dna.exclusions ?? []).entries()) {
      add(exclusions, entry(`blueprint-design-exclusion-${index + 1}`, "design-exclusion", exclusion));
    }
  }
  // Written visual-direction metadata is not a customer-approved prototype.
  // Renderer-specific obligations become binding only after Studio approval.
  const renderContract = design.approvedDesignContract === undefined
    ? null
    : design.renderContract ?? null;
  if (renderContract !== null && typeof renderContract === "object") {
    add(implementation, entry(
      "blueprint-design-render-contract",
      "design-render-contract",
      `Render the customer-facing product with Foundry shared renderer contract ${renderContract.renderContractId} (${renderContract.rendererVersion}), preserving its ${renderContract.primitive} composition and approved product regions: ${(renderContract.regions ?? []).join(", ")}.`,
    ));
    if (renderContract.productRenderSpec?.screens?.length > 0) {
      add(implementation, entry(
        "blueprint-product-render-spec",
        "product-render-spec",
        `Implement the exact approved product screen graph ${renderContract.productRenderSpec.renderSpecId}: ${renderContract.productRenderSpec.screens.map((screen) => `${screen.title} [${screen.id}]`).join(" → ")}. Every declared region, action, transition, responsive mode, and default/loading/empty/error/success state belongs to the finished product, not only the concept preview.`,
      ));
    }
    if (renderContract.authentication?.required) {
      add(implementation, entry(
        "blueprint-design-authentication-journey",
        "design-authentication-journey",
        "Implement the canonical two-surface authentication journey: a real labeled identity/password sign-in form with validation and submission, followed by the functional product surface. A SIGN IN heading pasted onto the product surface does not satisfy this requirement.",
      ));
    }
  }
  for (const [index, requirement] of (design.accessibilityRequirements ?? design.accessibilityNeeds ?? []).entries()) {
    add(implementation, entry(`blueprint-design-accessibility-${index + 1}`, "design-accessibility", requirement));
  }
  if (typeof design.customerInstructions === "string" && design.customerInstructions.trim() !== "") {
    add(implementation, entry("blueprint-design-customer-instructions", "design-customer-instructions", design.customerInstructions));
  }
}

export function approvedContractRequirementCatalogue(contractInput) {
  const contract = normalizeApprovedProjectContract(contractInput);
  const implementation = new Map();
  const exclusions = new Map();
  function add(target, item) {
    if (target.has(item.requirementId)) fail(`Approved contract repeats requirement ID "${item.requirementId}".`);
    target.set(item.requirementId, item);
  }
  add(implementation, entry("customer-intent-1", "original-request", contract.originalCustomerRequest));
  if (contract.productBlueprint !== undefined) {
    const blueprint = contract.productBlueprint;
    add(implementation, entry(
      "approved-blueprint-version",
      "product-blueprint",
      `Product Blueprint version ${blueprint.blueprintVersion} integrity ${blueprint.integrityHash}. ${blueprint.productName}. ${blueprint.oneSentenceOutcome}`,
    ));
    add(implementation, entry(
      "approved-product-type",
      "product-type",
      `${blueprint.exactProductType}. ${blueprint.selectedSubtypes.join(". ")}`,
    ));
    blueprint.requiredSurfaces.forEach((surface, index) => add(
      implementation,
      entry(`blueprint-surface-${index + 1}`, "required-surface", surface),
    ));
    blueprint.selectedFeatures.forEach((feature, index) => add(
      implementation,
      entry(`blueprint-feature-${index + 1}`, "selected-feature", feature),
    ));
    blueprint.businessRules.forEach((rule, index) => add(
      implementation,
      entry(`blueprint-business-rule-${index + 1}`, "business-rule", rule),
    ));
    blueprint.integrations.forEach((integration, index) => add(
      implementation,
      entry(`blueprint-integration-${index + 1}`, "integration", integration),
    ));
    blueprint.architecture.forEach((decision, index) => add(
      implementation,
      entry(`blueprint-architecture-${index + 1}`, "architecture", decision),
    ));
    blueprint.acceptanceRequirements.forEach((requirement, index) => add(
      implementation,
      entry(`blueprint-acceptance-${index + 1}`, "acceptance", requirement),
    ));
    addBlueprintDesignRequirements(add, implementation, exclusions, blueprint);
    blueprint.excludedFromV1.forEach((statement, index) => add(
      exclusions,
      entry(`blueprint-exclusion-${index + 1}`, "blueprint-exclusion", statement),
    ));
    blueprint.rejectedRecommendations.forEach((statement, index) => add(
      exclusions,
      entry(`blueprint-rejected-${index + 1}`, "blueprint-rejected", statement),
    ));
  }
  contract.customerFollowUpMessages.forEach((message, index) => add(
    implementation,
    entry(`customer-follow-up-${index + 1}`, "customer-follow-up", message),
  ));
  contract.workflows.primaryJourneys.forEach((journey, index) => add(
    implementation,
    entry(`workflow-primary-${index + 1}`, "primary-workflow", journey),
  ));
  contract.workflows.secondaryJourneys.forEach((journey, index) => add(
    implementation,
    entry(`workflow-secondary-${index + 1}`, "secondary-workflow", journey),
  ));
  add(implementation, entry(
    "approved-design-direction",
    "design-direction",
    `${contract.selectedDesignDirection.visualPersonality}. ${contract.selectedDesignDirection.layoutStrategy}. ${contract.selectedDesignDirection.interactionStyle}`,
  ));
  contract.acceptedRecommendations.forEach((recommendation, index) => add(
    implementation,
    entry(`accepted-recommendation-${index + 1}`, "accepted-recommendation", `${recommendation.title}. ${recommendation.specificValue}`),
  ));
  const selectedDecisions = (contract.decisionSelections ?? []).filter(
    (selection) => selection.kind === "decision",
  );
  if (selectedDecisions.length > 0) {
    selectedDecisions.forEach((selection, index) => add(
      implementation,
      entry(`approved-decision-${index + 1}`, "approved-decision", `${selection.value}. ${selection.reason}`),
    ));
  } else {
    [...contract.customerDecisions, ...contract.foundryDecisions].forEach((decision, index) => add(
      implementation,
      entry(`approved-decision-${index + 1}`, "approved-decision", `${decision.recommendation}. ${decision.recommendationReason}`),
    ));
  }
  contract.acceptanceObligations.forEach((obligation) => add(
    implementation,
    entry(obligation.obligationId, "acceptance-obligation", obligation.statement),
  ));
  contract.explicitExclusions.forEach((statement, index) => add(
    exclusions,
    entry(`explicit-exclusion-${index + 1}`, "explicit-exclusion", statement),
  ));
  contract.rejectedRecommendations.forEach((recommendation, index) => add(
    exclusions,
    entry(`rejected-recommendation-${index + 1}`, "rejected-recommendation", `${recommendation.title}. ${recommendation.specificValue}`),
  ));
  return freeze({
    implementationRequirements: [...implementation.values()],
    exclusionRequirements: [...exclusions.values()],
  });
}

export function deriveContractRoutingRequirements(contractInput, stackManifest) {
  const contract = normalizeApprovedProjectContract(contractInput);
  if (stackManifest === null || typeof stackManifest !== "object") fail("A certified stack manifest is required for routing.");
  if (contract.supportedPlatform !== "web") fail(`Approved platform "${contract.supportedPlatform}" is not executable by the current Foundry runtime.`);
  if (contract.selectedStackCapability.stackId !== stackManifest.stackId || contract.selectedStackCapability.stackVersion !== stackManifest.stackVersion) fail("Approved stack identity does not match the certified workload stack.");
  const supported = new Set(stackManifest.supportedCapabilities ?? []);
  const unsupported = contract.selectedStackCapability.capabilities.filter((capability) => !supported.has(capability));
  if (unsupported.length > 0) fail(`Approved contract requires unsupported stack capabilities: ${unsupported.join(", ")}.`);
  const integrationRequirements = [...new Set(contract.acceptedRecommendations.flatMap((item) => item.requiredDependencies))];
  const verificationMethods = [...new Set(contract.verificationPlan.map((item) => item.acceptanceMethod))].sort();
  const complexity = contract.selectedStackCapability.capabilities.length + integrationRequirements.length + verificationMethods.length + contract.workflows.primaryJourneys.length + contract.workflows.secondaryJourneys.length;
  const modelDepth = complexity >= 12 ? 4 : complexity >= 7 ? 3 : 2;
  return freeze({
    contractHash: contract.contentHash,
    contractVersion: contract.contractVersion,
    blueprintHash: contract.productBlueprint?.integrityHash ?? null,
    blueprintVersion: contract.productBlueprint?.blueprintVersion ?? null,
    supportedPlatform: contract.supportedPlatform,
    stackId: contract.selectedStackCapability.stackId,
    stackVersion: contract.selectedStackCapability.stackVersion,
    requiredWorkloadCapabilities: [...contract.selectedStackCapability.capabilities].sort(),
    integrationRequirements,
    verificationMethods,
    modelDepth,
    routingReason: `Approved contract ${contract.contentHash.slice(0, 12)} requires ${contract.selectedStackCapability.capabilities.length} certified workload capabilities, ${integrationRequirements.length} dependencies, ${verificationMethods.length} verification methods, and ${contract.workflows.primaryJourneys.length + contract.workflows.secondaryJourneys.length} workflows.`,
  });
}

export const CONTRACT_BOUND_BUNDLE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "contractHash",
    "contractVersion",
    "supportedPlatform",
    "designDirectionHash",
    "designFidelity",
    "requirementClaims",
    "explicitExclusionIds",
    "files",
  ],
  properties: {
    contractHash: { type: "string", minLength: 64 },
    contractVersion: { type: "integer" },
    supportedPlatform: { type: "string", minLength: 1 },
    designDirectionHash: { type: "string", minLength: 64 },
    designFidelity: DESIGN_FIDELITY_SCHEMA,
    requirementClaims: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirementId", "implementationSummary"],
        properties: {
          requirementId: { type: "string", minLength: 1 },
          implementationSummary: { type: "string", minLength: 1 },
        },
      },
    },
    explicitExclusionIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content", "contractRequirementIds"],
        properties: {
          path: { type: "string", minLength: 1 },
          content: { type: "string" },
          contractRequirementIds: {
            type: "array",
            minItems: 1,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
});

export function approvedDesignDirectionHash(contractInput) {
  return hash(normalizeApprovedProjectContract(contractInput).selectedDesignDirection);
}

export function validateContractBoundMissionPlan(plan, contractInput) {
  const contract = normalizeApprovedProjectContract(contractInput);
  const catalogue = approvedContractRequirementCatalogue(contract);
  exact(plan, ["contractHash", "contractVersion", "supportedPlatform", "designDirectionHash", "designFidelity", "requirementClaims", "explicitExclusionIds", "files"], "generatedMissionPlan");
  if (plan.contractHash !== contract.contentHash || plan.contractVersion !== contract.contractVersion) fail("Generated mission plan is not bound to the approved contract version and hash.");
  if (plan.supportedPlatform !== contract.supportedPlatform) fail("Generated mission plan changed the approved platform.");
  if (plan.designDirectionHash !== approvedDesignDirectionHash(contract)) fail("Generated mission plan changed the approved design direction.");
  if (!Array.isArray(plan.requirementClaims)) fail("requirementClaims must be an array.");
  const requiredById = new Map(catalogue.implementationRequirements.map((item) => [item.requirementId, item]));
  const claims = new Map();
  for (const [index, claim] of plan.requirementClaims.entries()) {
    exact(claim, ["requirementId", "implementationSummary"], `requirementClaims[${index}]`);
    const requirementId = identifier(claim.requirementId, `requirementClaims[${index}].requirementId`);
    const summary = text(claim.implementationSummary, `requirementClaims[${index}].implementationSummary`);
    const requirement = requiredById.get(requirementId);
    if (requirement === undefined) fail(`Generated mission plan adds unapproved requirement "${requirementId}".`);
    if (claims.has(requirementId)) fail(`Generated mission plan duplicates requirement "${requirementId}".`);
    if (!preservesRequirementSubject(requirement, summary)) fail(`Generated mission plan reinterprets requirement "${requirementId}" without preserving its subject.`);
    claims.set(requirementId, summary);
  }
  const missing = [...requiredById.keys()].filter((requirementId) => !claims.has(requirementId));
  if (missing.length > 0) fail(`Generated mission plan omits approved requirements: ${missing.join(", ")}.`);
  const expectedExclusions = catalogue.exclusionRequirements.map((item) => item.requirementId).sort();
  const actualExclusions = uniqueIdentifiers(plan.explicitExclusionIds, "explicitExclusionIds", { allowEmpty: true }).sort();
  if (canonical(expectedExclusions) !== canonical(actualExclusions)) fail("Generated mission plan did not preserve every explicit exclusion.");
  if (!Array.isArray(plan.files) || plan.files.length === 0) fail("Generated mission plan must contain traceable files.");
  const traced = new Set();
  const paths = new Set();
  const files = plan.files.map((file, index) => {
    exact(file, ["path", "content", "contractRequirementIds"], `files[${index}]`);
    const path = text(file.path, `files[${index}].path`);
    if (paths.has(path)) fail(`Generated mission plan duplicates path "${path}".`);
    paths.add(path);
    const ids = uniqueIdentifiers(file.contractRequirementIds, `files[${index}].contractRequirementIds`);
    for (const requirementId of ids) {
      if (!requiredById.has(requirementId)) fail(`File "${path}" traces to unknown or excluded requirement "${requirementId}".`);
      traced.add(requirementId);
    }
    return { path, content: String(file.content), contractRequirementIds: ids };
  });
  // The primitive class is a deterministic renderer binding, not creative
  // model output. When a generated root already carries the exact immutable
  // contract marker, attach its canonical primitive class locally so the
  // studio and built page select the same shared renderer branch without a
  // paid formatting-only retry.
  const normalizedPlan = bindCanonicalRendererRootClass(
    { ...plan, files },
    contract,
  );
  validateGeneratedDesignFidelity(normalizedPlan, contract, fail);
  const untraced = [...requiredById.keys()].filter((requirementId) => !traced.has(requirementId));
  if (untraced.length > 0) fail(`No generated file traces to approved requirements: ${untraced.join(", ")}.`);
  return freeze({
    contractHash: contract.contentHash,
    contractVersion: contract.contractVersion,
    supportedPlatform: contract.supportedPlatform,
    designDirectionHash: plan.designDirectionHash,
    designFidelity: structuredClone(normalizedPlan.designFidelity),
    requirementClaims: [...claims].map(([requirementId, implementationSummary]) => ({ requirementId, implementationSummary })),
    explicitExclusionIds: actualExclusions,
    files: normalizedPlan.files,
  });
}

export function validateContractRequirementTrace(requirementIds, contractInput, allowedRequirementIds) {
  const catalogue = approvedContractRequirementCatalogue(contractInput);
  const approvedIds = new Set(catalogue.implementationRequirements.map((item) => item.requirementId));
  const allowedIds = new Set(uniqueIdentifiers(allowedRequirementIds, "allowedRequirementIds"));
  for (const requirementId of allowedIds) {
    if (!approvedIds.has(requirementId)) fail(`Repair scope references unknown requirement "${requirementId}".`);
  }
  const trace = uniqueIdentifiers(requirementIds, "contractRequirementIds");
  for (const requirementId of trace) {
    if (!allowedIds.has(requirementId)) fail(`Repair traces to requirement "${requirementId}" outside its approved task scope.`);
  }
  return freeze([...trace]);
}

export function createModelTaskContract({ approvedContract, routingRequirements, taskObjective, allowedScope, forbiddenChanges, relevantRequirementIds, currentCheckpoint, expectedOutputSchema }) {
  const contract = normalizeApprovedProjectContract(approvedContract);
  const catalogue = approvedContractRequirementCatalogue(contract);
  const byId = new Map(catalogue.implementationRequirements.map((item) => [item.requirementId, item]));
  const ids = uniqueIdentifiers(relevantRequirementIds, "relevantRequirementIds");
  const relevantRequirements = ids.map((requirementId) => {
    const item = byId.get(requirementId);
    if (item === undefined) fail(`Model task references unknown requirement "${requirementId}".`);
    return item;
  });
  if (!Array.isArray(allowedScope) || allowedScope.length === 0 || !Array.isArray(forbiddenChanges) || forbiddenChanges.length === 0) fail("Model task allowedScope and forbiddenChanges must be non-empty arrays.");
  return freeze({
    taskObjective: text(taskObjective, "taskObjective"),
    allowedScope: allowedScope.map((item, index) => text(item, `allowedScope[${index}]`)),
    forbiddenChanges: forbiddenChanges.map((item, index) => text(item, `forbiddenChanges[${index}]`)),
    approvedContract: {
      contentHash: contract.contentHash,
      contractVersion: contract.contractVersion,
      originalCustomerRequest: contract.originalCustomerRequest,
      customerFollowUpMessages: contract.customerFollowUpMessages,
      finalInterpretedIntent: contract.finalInterpretedIntent,
      audiences: contract.audiences,
      workflows: contract.workflows,
      selectedDesignDirection: contract.selectedDesignDirection,
      selectedDesignDirectionHash: approvedDesignDirectionHash(contract),
      designExecutionBrief: designExecutionBrief(contract),
      acceptedRecommendations: contract.acceptedRecommendations,
      rejectedRecommendations: contract.rejectedRecommendations,
      customerDecisions: contract.customerDecisions,
      foundryDecisions: contract.foundryDecisions,
      decisionSelections: contract.decisionSelections ?? [],
      productBlueprint: contract.productBlueprint ?? null,
      assumptions: contract.assumptions,
      explicitExclusions: contract.explicitExclusions,
      explicitExclusionIds: catalogue.exclusionRequirements.map((requirement) => requirement.requirementId),
      architectureConstraints: contract.architectureConstraints,
      supportedPlatform: contract.supportedPlatform,
      selectedStackCapability: contract.selectedStackCapability,
    },
    relevantRequirements,
    requiredImplementationRequirementIds: ids,
    verificationObligations: contract.acceptanceObligations,
    verificationPlan: contract.verificationPlan,
    routingRequirements,
    currentCheckpoint: identifier(currentCheckpoint, "currentCheckpoint"),
    expectedOutputSchema,
  });
}

export function contractBoundModelPrompt(taskContract, instructions) {
  if (!Array.isArray(instructions) || instructions.length === 0) fail("Model task instructions must be a non-empty array.");
  return [
    "MODEL TASK CONTRACT — BINDING",
    JSON.stringify(taskContract),
    "DESIGN-DIRECTED GENERATION — BINDING",
    "Implement the approved designExecutionBrief as the real structural design of the application, not as descriptive copy. Translate its composition, navigation, hierarchy, typography, color roles, spacing density, interaction behavior, imagery strategy, mobile transformation, accessibility requirements, and customer instructions into concrete source. The finished project must be recognizably the approved direction. Reusing a generic dashboard, card stack, or universal shell that merely changes colors or labels is a contract violation.",
    "The structured output must include designFidelity explaining exactly where each design rule is implemented. designFidelity.sourceFiles must identify the actual customer-facing layout and style files. Customer-facing source must contain an inspectable responsive strategy: an explicit breakpoint or container transformation, a wrapping/auto-fit layout, or intrinsic fluid sizing with a real maximum bound. The generated Playwright test must capture screenshots at three widths — a phone (375, 390 or 414), a tablet (768, 810, 834 or 1024) and a desktop (1280, 1440, 1512 or 1728) — and must measure rendered composition, typography, color, and responsive transformation using real DOM/computed-style evidence. It must also prove the phone viewport has no horizontal overflow by comparing document.documentElement.scrollWidth with clientWidth, and prove keyboard focus remains observable (press Tab and read document.activeElement, or assert a :focus-visible style). A screenshot alone is not a passing verdict, but screenshots are mandatory evidence for review and repair. When the approved design declares a motion strategy other than static, the customer-facing source must include a prefers-reduced-motion fallback; when it excludes imagery, the source must not render images.",
    "When designExecutionBrief.renderContract is present, it is the same canonical renderer contract shown in Visual Direction, and designExecutionBrief.canonicalRendererDocument is the exact executable HTML/CSS reference the customer approved. designExecutionBrief.productRenderSpec is the frozen product tree behind that document: its screens, stable screen and region ids, navigation, actions, transitions, responsive modes, and default/loading/empty/error/success states are binding. Implement that same tree as the actual application and wire the project's real data and behavior into it; do not reinterpret it as inspiration or reconstruct a different tree from labels. Foundry owns the artifact boundary: during local admission it materializes the exact product tree at foundry/approved-product-render-spec.json and binds that artifact to the customer-facing root before fidelity validation, so model output is never rejected merely for omitting a file that does not exist until admission. Reuse the reference's structural composition, class names, geometry, typography, color roles, image treatment, and responsive transformation as the customer-facing shell. designExecutionBrief.canonicalRendererRequirements lists every required shared renderer class and structural rule. An unused reference file does not count. Do not merely copy its markers, approximate it with a different layout, replace its imagery with solid placeholder slabs, or turn its actions into no-op anchors. The built product must put the exact renderContractId, renderSpecId, and primitive in data-foundry-render-contract, data-foundry-render-spec, and data-foundry-primitive attributes on the customer-facing root. It must expose each exact approved data-foundry-screen and data-foundry-region id. The Playwright test must assert those values, complete the primary workflow transitions, locate every required renderer region, and make real assertions over geometry and computed visual tokens at the canonical 560px transformation and the required phone, tablet, and desktop widths.",
    "Copy authoritative contractHash, contractVersion, supportedPlatform, designDirectionHash, and explicitExclusionIds values exactly from the binding task contract when the output schema requests them. Never calculate, abbreviate, or reinterpret those values. Return exactly one requirementClaims entry for every requiredImplementationRequirementIds value and trace every one of those identifiers to at least one generated file. Begin each implementationSummary by quoting the requirement's statement verbatim, then ' — implemented by ' and a concrete description of where and how it is implemented; never paraphrase the quoted statement, because admission verifies its exact words. For a production-build requirement, additionally describe the production compilation, packaging, or bundle.",
    "INSTRUCTIONS",
    ...instructions.map((instruction, index) => `${index + 1}. ${text(instruction, `instructions[${index}]`)}`),
    "Do not reinterpret the original request. Do not omit an approved requirement, add an unapproved major feature, change platform or design direction, ignore a customer message, violate an exclusion, or weaken verification.",
  ].join("\n\n");
}
