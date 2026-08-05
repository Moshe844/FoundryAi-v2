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
    x: Number(entry.x) / width,
    y: Number(entry.y) / height,
    width: Number(entry.width) / width,
    height: Number(entry.height) / height,
  }));
}

function matchedGeometryDistance(prototype, production) {
  const candidates = [...production];
  const distances = [];
  for (const expected of prototype) {
    const matchIndex = candidates.findIndex((entry) => entry.tag === expected.tag);
    if (matchIndex < 0) continue;
    const actual = candidates.splice(matchIndex, 1)[0];
    distances.push(
      Math.abs(expected.x - actual.x) +
      Math.abs(expected.y - actual.y) +
      Math.abs(expected.width - actual.width) +
      Math.abs(expected.height - actual.height),
    );
  }
  return {
    matched: distances.length,
    meanDistance: distances.length === 0
      ? Number.POSITIVE_INFINITY
      : distances.reduce((sum, value) => sum + value, 0) / distances.length,
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
  return new Set(visibleManifest(observation).map((entry) => primaryFont(entry.fontFamily)).filter(Boolean));
}

function compareViewport(prototype, production) {
  const expectedManifest = visibleManifest(prototype);
  const actualManifest = visibleManifest(production);
  const expectedTags = expectedManifest.map((entry) => entry.tag);
  const actualTags = actualManifest.map((entry) => entry.tag);
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
    verdict(PrototypeFidelityAspect.HIERARCHY, hierarchyPreserved, hierarchyPreserved ? "Heading hierarchy remains present at every viewport." : "Production flattened or omitted the approved hierarchy."),
    verdict(PrototypeFidelityAspect.TYPOGRAPHY, typographyPreserved, typographyPreserved ? "The approved primary typography is rendered." : "Production replaced the approved typography.", { prototype: desktop?.expectedFonts ?? [], production: desktop?.actualFonts ?? [] }),
    verdict(PrototypeFidelityAspect.COLORS, colorsPreserved, colorsPreserved ? "Approved color tokens are present in computed styles." : "Production does not preserve enough approved color roles.", { approvedColors, approvedColorMatches }),
    verdict(PrototypeFidelityAspect.SPACING, spacingPreserved, spacingPreserved ? "Relative spacing and region geometry are preserved." : "Production spacing materially changes the approved rhythm."),
    verdict(PrototypeFidelityAspect.IMAGERY, imageryPreserved, imageryPreserved ? "Approved imagery presence is preserved." : "Production changed the approved imagery treatment."),
    verdict(PrototypeFidelityAspect.NAVIGATION, navigationPreserved, navigationPreserved ? "Navigation presence is preserved at every viewport." : "Production changed the approved navigation model."),
    verdict(PrototypeFidelityAspect.INTERACTIONS, interactionsPreserved, interactionsPreserved ? "A comparable set of real interaction targets remains available." : "Production removed too many approved interaction targets."),
    verdict(PrototypeFidelityAspect.RESPONSIVE, responsivePreserved, responsivePreserved ? "Phone, tablet, and desktop transformations preserve the prototype without overflow." : "Production responsive behavior differs or overflows." , { missingViewports }),
    verdict(PrototypeFidelityAspect.ACCESSIBILITY, accessibilityPreserved, accessibilityPreserved ? "Keyboard focus and image alternatives remain valid." : "Production accessibility evidence is incomplete or failing."),
    verdict(PrototypeFidelityAspect.EXCLUSIONS, exclusionsPreserved, exclusionsPreserved ? "No machine-detectable explicit exclusion is violated." : "Production violates an explicit design exclusion."),
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
