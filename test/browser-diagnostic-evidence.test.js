import assert from "node:assert/strict";
import test from "node:test";

import { parseBrowserResult } from "../src/domain/runtime-preview.js";
import { runtimeSourceManifest } from "../src/work-plane/runtime-preview-service.js";
import { browserCheckObservationFailure } from "../src/work-plane/production-mission-service.js";

test("browser observations retain deterministic scalar diagnostics", () => {
  const parsed = parseBrowserResult(
    `FOUNDRY_BROWSER_RESULT:${JSON.stringify({
      captureProbeErrors: [],
      checks: { "obligation-visual": true },
      diagnostics: {
        "obligation-visual": {
          paletteMatches: true,
          heroFontSize: 76.8,
          backgroundColor: "rgb(17, 17, 17)",
          optionalMeasurement: null,
        },
      },
      consoleErrors: [],
      pageErrors: [],
    })}`,
  );

  assert.deepEqual(parsed.diagnostics["obligation-visual"], {
    backgroundColor: "rgb(17, 17, 17)",
    heroFontSize: 76.8,
    optionalMeasurement: null,
    paletteMatches: true,
  });
});

test("browser observations reject structured diagnostic values", () => {
  for (const invalid of [[], {}]) {
    assert.throws(
      () =>
        parseBrowserResult(
          `FOUNDRY_BROWSER_RESULT:${JSON.stringify({
            captureProbeErrors: [],
            checks: { "obligation-visual": true },
            diagnostics: { "obligation-visual": { invalid } },
            consoleErrors: [],
            pageErrors: [],
          })}`,
        ),
      /malformed checks or errors/u,
    );
  }
});

test("evidence written by the observation is not treated as changed source", () => {
  // The injected fidelity spec writes screenshots to evidence/ during browser
  // verification. Counting those as source made the post-observation
  // checkpoint differ from the running artifact, so a build whose fidelity
  // fully passed was still rejected as if its source had been swapped.
  const source = [
    { path: "app/page.tsx", contentHash: "a".repeat(64), size: 100 },
    { path: "app/globals.css", contentHash: "b".repeat(64), size: 200 },
    { path: "package.json", contentHash: "c".repeat(64), size: 300 },
  ];
  const started = { contentManifest: [...source] };
  const observed = {
    contentManifest: [
      ...source,
      { path: "evidence/foundry-design-phone.png", contentHash: "d".repeat(64), size: 900 },
      { path: "evidence/foundry-design-tablet.png", contentHash: "e".repeat(64), size: 900 },
      { path: "evidence/foundry-design-desktop.png", contentHash: "f".repeat(64), size: 900 },
      { path: "data/app.db", contentHash: "1".repeat(64), size: 50 },
      { path: "tests/verification.spec.ts", contentHash: "2".repeat(64), size: 50 },
    ],
  };
  assert.equal(runtimeSourceManifest(started), runtimeSourceManifest(observed));

  // Real source drift must still be detected.
  const tampered = {
    contentManifest: [
      { ...source[0], contentHash: "9".repeat(64) },
      source[1],
      source[2],
    ],
  };
  assert.notEqual(runtimeSourceManifest(started), runtimeSourceManifest(tampered));
});

test("a check that was never computed is not reported as an application defect", () => {
  // The real failure: the test aborted after the first check, so 13 checks
  // emitted their initial false with no diagnostics. Calling those "false"
  // sent three repair proposals chasing defects that did not exist.
  const failed = ["obligation-002", "obligation-003", "obligation-004"];
  const noDiagnostics = browserCheckObservationFailure(failed, {
    "obligation-001": { switched: true },
  });
  assert.match(noDiagnostics, /stopped before it computed 3 of its required checks/u);
  assert.match(noDiagnostics, /are the initial values, not observations/u);
  assert.match(noDiagnostics, /Do not treat these as application defects/u);
  assert.doesNotMatch(noDiagnostics, /real browser checks were false/u);

  // A genuinely observed failure still reads as one, with its sub-checks.
  const observed = browserCheckObservationFailure(["obligation-012"], {
    "obligation-012": { controlsExpand: false, noOverflow: true },
  });
  assert.match(observed, /real browser checks were false: obligation-012/u);
  assert.match(observed, /controlsExpand/u);
  assert.doesNotMatch(observed, /stopped before it computed/u);

  // Mixed: the observed one is the defect, the uncomputed ones are called out
  // separately so the repair does not touch source on their account.
  const mixed = browserCheckObservationFailure(
    ["obligation-005", "obligation-006"],
    { "obligation-005": { submitted: false } },
  );
  assert.match(mixed, /were false: obligation-005/u);
  assert.match(mixed, /never computed because the test stopped early/u);
  assert.match(mixed, /not observations: obligation-006/u);
  assert.match(mixed, /do not change application source on their account/u);
});
