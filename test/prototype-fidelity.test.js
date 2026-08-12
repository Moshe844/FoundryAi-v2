import assert from "node:assert/strict";
import test from "node:test";

import { evaluatePrototypeFidelity } from "../src/domain/prototype-fidelity.js";

const APPROVED = Object.freeze({
  approvedDesignId: "approved-concept-a-v2",
  prototypeContentHash: "a".repeat(64),
  colorTokens: {
    background: "#111111",
    surface: "#222222",
    text: "#f5f5f5",
    primary: "#e2d4c0",
    accent: "#c87a45",
  },
  explicitExclusions: ["No generic card dashboard"],
});

function observation(name, width, height, overrides = {}) {
  const manifest = [
    { tag: "header", x: 0, y: 0, width, height: 96, fontFamily: "Georgia, serif", fontSize: "18px", color: "#f5f5f5", backgroundColor: "#111111" },
    { tag: "nav", x: width * 0.65, y: 20, width: width * 0.3, height: 44, fontFamily: "Inter, sans-serif", fontSize: "16px", color: "#e2d4c0", backgroundColor: "transparent" },
    { tag: "main", x: 0, y: 96, width, height: 900, fontFamily: "Inter, sans-serif", fontSize: "16px", color: "#f5f5f5", backgroundColor: "#111111" },
    { tag: "section", x: 0, y: 96, width, height: 520, fontFamily: "Georgia, serif", fontSize: "64px", color: "#f5f5f5", backgroundColor: "#222222" },
    { tag: "section", x: 0, y: 640, width, height: 320, fontFamily: "Inter, sans-serif", fontSize: "16px", color: "#f5f5f5", backgroundColor: "#111111" },
    { tag: "footer", x: 0, y: 984, width, height: 120, fontFamily: "Inter, sans-serif", fontSize: "14px", color: "#e2d4c0", backgroundColor: "#222222" },
  ];
  return {
    route: "/",
    viewport: { name, width, height },
    measurement: {
      headingCount: 4,
      semanticSurfaceCount: manifest.length,
      horizontalOverflow: false,
      scrollWidth: width,
      clientWidth: width,
      scrollHeight: 1104,
      activeElement: "A",
      focusVisible: true,
      focusableCount: 9,
      navigationPresent: true,
      missingImageAltCount: 0,
      imageCount: 2,
      manifest,
      ...overrides,
    },
  };
}

function evidence(observations) {
  return { contentHash: APPROVED.prototypeContentHash, observations };
}

const VIEWPORTS = [
  observation("mobile", 390, 844),
  observation("tablet", 768, 1024),
  observation("desktop", 1280, 900),
];

test("the same experience passes deterministic prototype-to-production fidelity", () => {
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: structuredClone(VIEWPORTS) },
  });

  assert.equal(result.passed, true, JSON.stringify(result.verdicts, null, 2));
  assert.equal(result.comparedViewports.length, 3);
  assert.equal(result.failedAspects.length, 0);
  assert.equal(result.integrityHash.length, 64);
});

test("a stateful initial screen does not pad controls to match a multi-surface concept", () => {
  const initialStateOnly = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    copy.measurement.focusableCount = 2;
    return copy;
  });
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: initialStateOnly },
  });

  assert.ok(!result.failedAspects.includes("interactions"), JSON.stringify(result.failedAspects));
  assert.equal(
    result.verdicts.find((entry) => entry.aspect === "interactions").detail.comparisons[0].minimumRequired,
    1,
  );
});

test("matching colors cannot hide a generic replacement composition", () => {
  const flat = VIEWPORTS.map((entry) => ({
    ...structuredClone(entry),
    measurement: {
      ...structuredClone(entry.measurement),
      semanticSurfaceCount: 1,
      manifest: [entry.measurement.manifest[2]],
    },
  }));
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: flat },
  });

  assert.equal(result.passed, false);
  assert.ok(result.failedAspects.includes("surface-order"));
  assert.ok(result.failedAspects.includes("composition"));
  assert.ok(result.failedAspects.includes("exclusions"));
});

test("missing mobile evidence and overflow block completion", () => {
  const production = structuredClone(VIEWPORTS.slice(1));
  production[0].measurement.horizontalOverflow = true;
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: production },
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.missingViewports, ["/:390x844"]);
  assert.ok(result.failedAspects.includes("responsive"));
});

test("prototype evidence cannot be swapped after approval", () => {
  assert.throws(() => evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: { ...evidence(VIEWPORTS), contentHash: "b".repeat(64) },
    productionBrowserResult: { results: VIEWPORTS },
  }), /content hash/u);
});

test("an equivalent implementation with different markup is not a composition failure", () => {
  // The production build expresses the same regions with different element
  // names and slightly different nesting, exactly as a React implementation of
  // a hand-written prototype does. Geometry is materially the same.
  const reimplemented = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    const swap = { header: "banner", nav: "navigation", main: "main", section: "region", footer: "contentinfo" };
    copy.measurement.manifest = copy.measurement.manifest.map((surface) => ({
      ...surface,
      tag: "div",
      role: swap[surface.tag],
      x: surface.x + 1,
      y: surface.y + 1,
    }));
    return copy;
  });
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: reimplemented },
  });

  assert.ok(!result.failedAspects.includes("composition"), JSON.stringify(result.failedAspects));
  assert.ok(!result.failedAspects.includes("surface-order"), JSON.stringify(result.failedAspects));
  assert.ok(!result.failedAspects.includes("spacing"), JSON.stringify(result.failedAspects));
});

test("a resolved generic font family is not a typography replacement", () => {
  // ui-monospace and the SF Mono the browser resolves it to are one decision.
  const monoPrototype = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    copy.measurement.manifest = copy.measurement.manifest.map((surface) => ({ ...surface, fontFamily: "ui-monospace, monospace" }));
    return copy;
  });
  const monoProduction = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    copy.measurement.manifest = copy.measurement.manifest.map((surface) => ({ ...surface, fontFamily: '"SF Mono", monospace' }));
    return copy;
  });
  const resolved = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(monoPrototype),
    productionBrowserResult: { results: monoProduction },
  });
  assert.ok(!resolved.failedAspects.includes("typography"), JSON.stringify(resolved.failedAspects));

  // A genuine face swap must still fail.
  const swapped = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    copy.measurement.manifest = copy.measurement.manifest.map((surface) => ({ ...surface, fontFamily: "Fraunces, serif" }));
    return copy;
  });
  const replaced = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(monoPrototype),
    productionBrowserResult: { results: swapped },
  });
  assert.ok(replaced.failedAspects.includes("typography"), JSON.stringify(replaced.failedAspects));
});

test("a genuinely relocated composition still fails on geometry", () => {
  // Same roles, same markup, but the regions are moved and resized materially.
  const moved = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    copy.measurement.manifest = copy.measurement.manifest.map((surface) => ({
      ...surface,
      x: surface.x + entry.viewport.width * 0.45,
      width: Math.max(10, surface.width * 0.4),
    }));
    return copy;
  });
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: moved },
  });

  assert.equal(result.passed, false);
  assert.ok(result.failedAspects.includes("composition"), JSON.stringify(result.failedAspects));
});

test("a failed spacing verdict carries the measurements a repair needs", () => {
  // y normalizes against scrollHeight (1104), so the shift has to exceed the
  // 0.75 tolerance in normalized units to be a real spacing failure.
  const moved = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    copy.measurement.manifest = copy.measurement.manifest.map((surface) => ({ ...surface, y: surface.y + 1000 }));
    return copy;
  });
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: moved },
  });
  const spacing = result.verdicts.find((entry) => entry.aspect === "spacing");

  assert.equal(spacing.verdict, "FAIL");
  assert.ok(Array.isArray(spacing.detail.comparisons));
  assert.ok(spacing.detail.comparisons.every((entry) => typeof entry.meanDistance === "number"));
  assert.ok(spacing.detail.comparisons.some((entry) => Array.isArray(entry.pairs) && entry.pairs.length > 0));
});

test("every failing aspect carries diagnostics a first repair attempt can act on", () => {
  // A repair should not need a second attempt to discover what went wrong.
  // Break composition, navigation, hierarchy, imagery, interactions, and
  // accessibility at once, then require that no failed verdict is empty.
  const degraded = VIEWPORTS.map((entry) => {
    const copy = structuredClone(entry);
    copy.measurement.manifest = copy.measurement.manifest
      .filter((surface) => surface.tag !== "nav")
      .map((surface) => ({ ...surface, x: surface.x + entry.viewport.width * 0.5, width: Math.max(8, surface.width * 0.3) }));
    copy.measurement.headingCount = 0;
    copy.measurement.imageCount = 0;
    copy.measurement.focusableCount = 0;
    copy.measurement.navigationPresent = false;
    copy.measurement.activeElement = "BODY";
    copy.measurement.missingImageAltCount = 3;
    return copy;
  });
  const result = evaluatePrototypeFidelity({
    approvedDesignContract: APPROVED,
    prototypeVerification: evidence(VIEWPORTS),
    productionBrowserResult: { results: degraded },
  });

  assert.equal(result.passed, false);
  const failed = result.verdicts.filter((entry) => entry.verdict === "FAIL");
  assert.ok(failed.length >= 5, `expected several failures, got ${failed.length}`);
  for (const entry of failed) {
    assert.ok(
      Object.keys(entry.detail).length > 0,
      `${entry.aspect} failed with no diagnostics a repair could use`,
    );
  }

  // Navigation in particular must say which side has the landmark.
  const navigation = failed.find((entry) => entry.aspect === "navigation");
  assert.ok(navigation, "navigation should fail when the landmark is removed");
  assert.equal(navigation.detail.comparisons[0].prototypeHasNavigationLandmark, true);
  assert.equal(navigation.detail.comparisons[0].productionHasNavigationLandmark, false);
  assert.match(navigation.detail.remedy, /<nav> landmark/u);
});
