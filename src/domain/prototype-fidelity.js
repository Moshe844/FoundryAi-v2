import { createHash } from "node:crypto";

export const PrototypeFidelityAspect = Object.freeze({
  SURFACE_ORDER: "surface-order",
  COMPOSITION: "composition",
  HIERARCHY: "hierarchy",
  TYPOGRAPHY: "typography",
  COLORS: "colors",
  SPACING: "spacing",
  IMAGERY: "imagery",
  NAVIGATION: "navigation",
  INTERACTIONS: "interactions",
  RESPONSIVE: "responsive",
  ACCESSIBILITY: "accessibility",
  EXCLUSIONS: "exclusions",
});

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalColor(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(normalized);
  if (match === null) return normalized;
  return `#${match.slice(1, 4).map((channel) => Number(channel).toString(16).padStart(2, "0")).join("")}`;
}

function primaryFont(value) {
  return String(value ?? "").split(",")[0].replaceAll(/["']/gu, "").trim().toLowerCase();
}

// A CSS generic family and the face the browser resolves it to are the same
// typographic decision. Comparing the declared name against the resolved name
// failed builds that followed the approved design exactly: a prototype asking
// for ui-monospace was reported as "sf mono" in production and marked a
// replacement. Only generic and system faces collapse into a shared class;
// a named webface stays itself, so swapping Fraunces for Inter still fails.
const SYSTEM_FONT_CLASSES = Object.freeze([
  ["monospace", [
    "monospace", "ui-monospace", "sf mono", "sfmono-regular", "menlo", "monaco",
    "consolas", "liberation mono", "courier", "courier new", "dejavu sans mono",
    "roboto mono", "cascadia mono", "cascadia code",
  ]],
  ["sans-serif", [
    "sans-serif", "ui-sans-serif", "system-ui", "-apple-system", "blinkmacsystemfont",
    "segoe ui", "helvetica", "helvetica neue", "arial", "roboto", "noto sans",
    "liberation sans", "dejavu sans",
  ]],
  ["serif", [
    "serif", "ui-serif", "georgia", "times", "times new roman", "cambria",
    "liberation serif", "dejavu serif",
  ]],
]);

export function canonicalFontFamily(value) {
  const name = primaryFont(value);
  if (name === "") return "";
  for (const [className, members] of SYSTEM_FONT_CLASSES) {
    if (members.includes(name)) return className;
  }
  return name;
}

// The manifest only ever contains landmark elements, so every entry has a
// semantic role even when the markup does not spell it out. Matching on that
// role instead of the raw tag lets an equivalent React implementation line up
// with a hand-written prototype whose nesting differs.
const TAG_ROLES = Object.freeze({
  header: "banner",
  nav: "navigation",
  main: "main",
  aside: "complementary",
  footer: "contentinfo",
  form: "form",
  table: "table",
  section: "region",
  article: "region",
});

export function semanticRole(entry) {
  const declared = String(entry?.role ?? "").trim().toLowerCase();
  if (declared !== "") return declared;
  return TAG_ROLES[String(entry?.tag ?? "").toLowerCase()] ?? "region";
}

function viewportKey(observation) {
  return `${observation.route ?? "/"}:${observation.viewport?.width}x${observation.viewport?.height}`;
}

function observationsByViewport(record) {
  return new Map((record?.observations ?? record?.results ?? []).map((entry) => [viewportKey(entry), entry]));
}

function visibleManifest(observation) {
  return (observation?.measurement?.manifest ?? []).filter(
    (entry) => Number(entry.width) > 0 && Number(entry.height) > 0,
  );
}

function lcsLength(left, right) {
  let prior = Array(right.length + 1).fill(0);
  for (const leftValue of left) {
    const next = Array(right.length + 1).fill(0);
    for (let index = 1; index <= right.length; index += 1) {
      next[index] = leftValue === right[index - 1]
        ? prior[index - 1] + 1
        : Math.max(prior[index], next[index - 1]);
    }
    prior = next;
  }
  return prior.at(-1);
}

function normalizedGeometry(observation) {
  const measurement = observation?.measurement ?? {};
  const width = Number(measurement.clientWidth) || Number(observation?.viewport?.width) || 1;
  const height = Number(measurement.scrollHeight) || Number(observation?.viewport?.height) || 1;
  return visibleManifest(observation).map((entry) => ({
    tag: entry.tag,
    role: semanticRole(entry),
    x: Number(entry.x) / width,
    y: Number(entry.y) / height,
    width: Number(entry.width) / width,
    height: Number(entry.height) / height,
  }));
}

function geometryDistance(expected, actual) {
  return (
    Math.abs(expected.x - actual.x) +
    Math.abs(expected.y - actual.y) +
    Math.abs(expected.width - actual.width) +
    Math.abs(expected.height - actual.height)
  );
}

// Matching used to pair by exact tag name in document order, so the first
// prototype <section> was compared against the first production <section>
// whatever each actually was. An equivalent implementation with different
// nesting scored as a materially different composition and no source repair
// could move it. Pair on semantic role, and among same-role candidates take
// the geometrically nearest rather than the first one encountered.
function matchedGeometryDistance(prototype, production) {
  const candidates = production.map((entry, index) => ({ entry, index }));
  const taken = new Set();
  const distances = [];
  const pairs = [];
  for (const expected of prototype) {
    let best = null;
    for (const candidate of candidates) {
      if (taken.has(candidate.index)) continue;
      if (candidate.entry.role !== expected.role) continue;
      const distance = geometryDistance(expected, candidate.entry);
      if (best === null || distance < best.distance) {
        best = { candidate, distance };
      }
    }
    if (best === null) continue;
    taken.add(best.candidate.index);
    distances.push(best.distance);
    pairs.push({ role: expected.role, distance: Number(best.distance.toFixed(4)) });
  }
  return {
    matched: distances.length,
    meanDistance: distances.length === 0
      ? Number.POSITIVE_INFINITY
      : distances.reduce((sum, value) => sum + value, 0) / distances.length,
    pairs,
  };
}

function verdict(aspect, passed, summary, detail = {}) {
  return Object.freeze({ aspect, verdict: passed ? "PASS" : "FAIL", summary, detail: Object.freeze(detail) });
}

function colorSet(observation) {
  return new Set(visibleManifest(observation).flatMap((entry) => [
    canonicalColor(entry.color),
    canonicalColor(entry.backgroundColor),
  ]).filter((value) => value !== "" && value !== "rgba(0, 0, 0, 0)" && value !== "transparent"));
}

function fontSet(observation) {
  return new Set(visibleManifest(observation).map((entry) => canonicalFontFamily(entry.fontFamily)).filter(Boolean));
}

function compareViewport(prototype, production) {
  const expectedManifest = visibleManifest(prototype);
  const actualManifest = visibleManifest(production);
  // Surface order is about the sequence of meaningful regions, not the exact
  // element names used to build them.
  const expectedTags = expectedManifest.map((entry) => semanticRole(entry));
  const actualTags = actualManifest.map((entry) => semanticRole(entry));
  const commonOrder = lcsLength(expectedTags, actualTags);
  const orderRatio = commonOrder / Math.max(1, expectedTags.length);
  const geometry = matchedGeometryDistance(
    normalizedGeometry(prototype),
    normalizedGeometry(production),
  );
  const expectedColors = colorSet(prototype);
  const actualColors = colorSet(production);
  const colorMatches = [...expectedColors].filter((color) => actualColors.has(color));
  const expectedFonts = fontSet(prototype);
  const actualFonts = fontSet(production);
  const fontMatches = [...expectedFonts].filter((font) => actualFonts.has(font));
  return {
    key: viewportKey(prototype),
    orderRatio,
    expectedSurfaceCount: expectedManifest.length,
    actualSurfaceCount: actualManifest.length,
    geometry,
    expectedColors: [...expectedColors],
    actualColors: [...actualColors],
    colorMatches,
    expectedFonts: [...expectedFonts],
    actualFonts: [...actualFonts],
    fontMatches,
    prototype: prototype.measurement,
    production: production.measurement,
  };
}

export function evaluatePrototypeFidelity({ approvedDesignContract, prototypeVerification, productionBrowserResult }) {
  if (approvedDesignContract === null || typeof approvedDesignContract !== "object") {
    throw new TypeError("Prototype fidelity requires an ApprovedDesignContract.");
  }
  if (prototypeVerification?.contentHash !== approvedDesignContract.prototypeContentHash) {
    throw new TypeError("Prototype fidelity evidence does not match the approved prototype content hash.");
  }
  const prototypeByViewport = observationsByViewport(prototypeVerification);
  const productionByViewport = observationsByViewport(productionBrowserResult);
  const missingViewports = [...prototypeByViewport.keys()].filter((key) => !productionByViewport.has(key));
  const comparisons = [...prototypeByViewport].flatMap(([key, prototype]) => {
    const production = productionByViewport.get(key);
    return production === undefined ? [] : [compareViewport(prototype, production)];
  });
  const all = (predicate) => comparisons.length > 0 && comparisons.every(predicate);
  const desktop = comparisons.find((item) => /:1280x900$/u.test(item.key)) ?? comparisons.at(-1);
  const approvedColors = Object.values(approvedDesignContract.colorTokens ?? {}).map(canonicalColor);
  const renderedColors = new Set(comparisons.flatMap((item) => item.actualColors));
  const approvedColorMatches = approvedColors.filter((color) => renderedColors.has(color));
  const exactSurfaceOrder = all((item) => item.orderRatio >= 0.65);
  const compositionPreserved = all((item) =>
    item.geometry.matched >= Math.min(3, item.expectedSurfaceCount) && item.geometry.meanDistance <= 0.75,
  );
  const hierarchyPreserved = all((item) => {
    const expected = Number(item.prototype?.headingCount ?? 0);
    const actual = Number(item.production?.headingCount ?? 0);
    return expected > 0 && actual >= Math.max(1, Math.floor(expected * 0.6));
  });
  const typographyPreserved = all((item) => item.fontMatches.length > 0);
  const colorsPreserved = approvedColors.length === 0
    ? all((item) => item.colorMatches.length >= Math.min(2, item.expectedColors.length))
    : approvedColorMatches.length >= Math.min(2, approvedColors.length);
  const spacingPreserved = all((item) => item.geometry.meanDistance <= 0.75);
  const imageryPreserved = all((item) => {
    const expected = Number(item.prototype?.imageCount ?? item.prototype?.images?.length ?? 0);
    const actual = Number(item.production?.imageCount ?? item.production?.images?.length ?? 0);
    return expected === 0 ? actual === 0 : actual >= Math.max(1, Math.floor(expected * 0.6));
  });
  const navigationPreserved = all((item) =>
    Boolean(item.prototype?.navigationPresent ?? item.prototype?.manifest?.some((entry) => entry.tag === "nav")) ===
    Boolean(item.production?.navigationPresent ?? item.production?.manifest?.some((entry) => entry.tag === "nav")),
  );
  const interactionsPreserved = all((item) =>
    Number(item.production?.focusableCount ?? 0) >= Math.max(1, Math.floor(Number(item.prototype?.focusableCount ?? 1) * 0.5)),
  );
  const responsivePreserved = missingViewports.length === 0 && all((item) =>
    item.production?.horizontalOverflow === false && item.orderRatio >= 0.6,
  );
  const accessibilityPreserved = all((item) =>
    item.production?.activeElement !== null &&
    item.production?.activeElement !== "BODY" &&
    Number(item.production?.missingImageAltCount ?? 0) === 0,
  );
  const exclusionsPreserved = ![...approvedDesignContract.explicitExclusions ?? []].some((exclusion) =>
    /no (?:generic )?(?:card )?dashboard/iu.test(exclusion) &&
    Number(desktop?.production?.semanticSurfaceCount ?? 0) <= 2,
  );
  const verdicts = Object.freeze([
    verdict(PrototypeFidelityAspect.SURFACE_ORDER, exactSurfaceOrder, exactSurfaceOrder ? "Approved semantic surface order is preserved." : "Production changed the approved semantic surface order.", { comparisons: comparisons.map(({ key, orderRatio }) => ({ key, orderRatio })) }),
    verdict(PrototypeFidelityAspect.COMPOSITION, compositionPreserved, compositionPreserved ? "Normalized layout geometry remains within the approved tolerance." : "Production composition materially differs from the approved prototype.", { comparisons: comparisons.map(({ key, geometry }) => ({ key, ...geometry })) }),
    // Every verdict below used to fail with an empty detail object, so a repair
    // was told an aspect failed and given nothing to correct toward. That is
    // what forced a second and third attempt: the first one was guessing.
    verdict(PrototypeFidelityAspect.HIERARCHY, hierarchyPreserved, hierarchyPreserved ? "Heading hierarchy remains present at every viewport." : "Production flattened or omitted the approved hierarchy.", { comparisons: comparisons.map((item) => ({ key: item.key, prototypeHeadingCount: Number(item.prototype?.headingCount ?? 0), productionHeadingCount: Number(item.production?.headingCount ?? 0), minimumRequired: Math.max(1, Math.floor(Number(item.prototype?.headingCount ?? 0) * 0.6)) })) }),
    verdict(PrototypeFidelityAspect.TYPOGRAPHY, typographyPreserved, typographyPreserved ? "The approved primary typography is rendered." : "Production replaced the approved typography.", { prototype: desktop?.expectedFonts ?? [], production: desktop?.actualFonts ?? [] }),
    verdict(PrototypeFidelityAspect.COLORS, colorsPreserved, colorsPreserved ? "Approved color tokens are present in computed styles." : "Production does not preserve enough approved color roles.", { approvedColors, approvedColorMatches }),
    // This verdict used to carry no detail at all, so a repair was told spacing
    // failed and given nothing to correct toward.
    verdict(PrototypeFidelityAspect.SPACING, spacingPreserved, spacingPreserved ? "Relative spacing and region geometry are preserved." : "Production spacing materially changes the approved rhythm.", { comparisons: comparisons.map(({ key, geometry }) => ({ key, meanDistance: geometry.meanDistance, pairs: geometry.pairs })) }),
    verdict(PrototypeFidelityAspect.IMAGERY, imageryPreserved, imageryPreserved ? "Approved imagery presence is preserved." : "Production changed the approved imagery treatment.", { comparisons: comparisons.map((item) => ({ key: item.key, prototypeImageCount: Number(item.prototype?.imageCount ?? 0), productionImageCount: Number(item.production?.imageCount ?? 0) })) }),
    verdict(PrototypeFidelityAspect.NAVIGATION, navigationPreserved, navigationPreserved ? "Navigation presence is preserved at every viewport." : "Production changed the approved navigation model.", { comparisons: comparisons.map((item) => ({ key: item.key, prototypeHasNavigationLandmark: Boolean(item.prototype?.navigationPresent ?? item.prototype?.manifest?.some((entry) => entry.tag === "nav")), productionHasNavigationLandmark: Boolean(item.production?.navigationPresent ?? item.production?.manifest?.some((entry) => entry.tag === "nav")) })), remedy: "Match the approved prototype: render a real <nav> landmark (or role=\"navigation\") when the prototype has one, and do not introduce one when it does not." }),
    verdict(PrototypeFidelityAspect.INTERACTIONS, interactionsPreserved, interactionsPreserved ? "A comparable set of real interaction targets remains available." : "Production removed too many approved interaction targets.", { comparisons: comparisons.map((item) => ({ key: item.key, prototypeFocusableCount: Number(item.prototype?.focusableCount ?? 0), productionFocusableCount: Number(item.production?.focusableCount ?? 0), minimumRequired: Math.max(1, Math.floor(Number(item.prototype?.focusableCount ?? 1) * 0.5)) })) }),
    verdict(PrototypeFidelityAspect.RESPONSIVE, responsivePreserved, responsivePreserved ? "Phone, tablet, and desktop transformations preserve the prototype without overflow." : "Production responsive behavior differs or overflows." , { missingViewports }),
    verdict(PrototypeFidelityAspect.ACCESSIBILITY, accessibilityPreserved, accessibilityPreserved ? "Keyboard focus and image alternatives remain valid." : "Production accessibility evidence is incomplete or failing.", { comparisons: comparisons.map((item) => ({ key: item.key, productionActiveElement: item.production?.activeElement ?? null, productionMissingImageAltCount: Number(item.production?.missingImageAltCount ?? 0) })), remedy: "After pressing Tab the focused element must not be null or BODY, and every image needs an alt attribute." }),
    verdict(PrototypeFidelityAspect.EXCLUSIONS, exclusionsPreserved, exclusionsPreserved ? "No machine-detectable explicit exclusion is violated." : "Production violates an explicit design exclusion.", { explicitExclusions: [...approvedDesignContract.explicitExclusions ?? []], desktopSemanticSurfaceCount: Number(desktop?.production?.semanticSurfaceCount ?? 0) }),
  ]);
  const failedAspects = Object.freeze(verdicts.filter((item) => item.verdict === "FAIL").map((item) => item.aspect));
  const summary = {
    schemaVersion: 1,
    approvedDesignId: approvedDesignContract.approvedDesignId,
    approvedPrototypeContentHash: approvedDesignContract.prototypeContentHash,
    comparedViewports: comparisons.map((item) => item.key),
    missingViewports,
    verdicts,
    failedAspects,
    passed: failedAspects.length === 0,
  };
  return Object.freeze({ ...summary, integrityHash: hash(JSON.stringify(summary)) });
}
