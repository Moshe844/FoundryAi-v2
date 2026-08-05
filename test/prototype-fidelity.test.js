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
