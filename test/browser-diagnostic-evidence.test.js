import assert from "node:assert/strict";
import test from "node:test";

import { parseBrowserResult } from "../src/domain/runtime-preview.js";
import { runtimeSourceManifest } from "../src/work-plane/runtime-preview-service.js";
import {
  ProductionRepairScope,
  browserCheckObservationFailure,
  bindFoundryObservationHarness,
  deepestRepairScope,
  foundryObservationHarness,
  repairPatchFiles,
  validateBrowserObservationTestSource,
  validateBrowserRepairProposal,
} from "../src/work-plane/production-mission-service.js";

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

test("a helper that computes checks is accepted, but not one that fakes them", () => {
  // Asking every check to compute in its own try/catch makes a helper the
  // natural shape. The gate demanded a literal checks["id"] = assignment and
  // so rejected exactly what the instructions ask for — three identical
  // times on one build before it gave up.
  const scaffold = `
    const captureProbeErrors: string[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const checks: Record<string, boolean> = { 'obligation-001': false };
    const diagnostics: Record<string, Record<string, boolean>> = {};
    async function observe(id: string, run: () => Promise<boolean>) {
      try { checks[id] = await run(); } catch (error) { diagnostics[id] = { threw: false }; }
    }
  `;
  const emit = `
    try {
      await observe('obligation-001', async () => (await page.locator('.card').count()) >= 1);
    } finally {
      console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({ captureProbeErrors, checks, diagnostics, consoleErrors, pageErrors }));
    }
  `;
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(scaffold + emit, ["obligation-001"], {}),
  );

  // The same helper shape may not hand back a bare literal.
  const faked = scaffold.replace("checks[id] = await run();", "checks[id] = true;");
  assert.throws(
    () => validateBrowserObservationTestSource(faked + emit, ["obligation-001"], {}),
    /literal success value through a helper/u,
  );

  // A check that appears nowhere at all is still rejected.
  assert.throws(
    () => validateBrowserObservationTestSource(scaffold + emit, ["obligation-001", "obligation-002"], {}),
    /must compute required check "obligation-002"/u,
  );
});

test("Foundry's observation harness satisfies every scaffolding gate itself", () => {
  // Fifty gates policed how the model wrote its browser test, and three times a
  // model wrote correct, well-factored code and was rejected for its style.
  // The harness removes the premise: Foundry writes the scaffolding, so those
  // gates are satisfied by construction and the model supplies only assertions.
  const ids = ["obligation-001", "obligation-004", "obligation-007"];
  const harness = foundryObservationHarness(ids);
  const checksModule = `
    export const obligationChecks = {
      'obligation-001': async ({ page }) => {
        const heading = await page.getByRole('heading', { level: 1 }).count();
        return { passed: heading >= 1, diagnostics: { headingPresent: heading >= 1 } };
      },
      'obligation-004': async ({ page, responsiveEvidence }) => {
        const readable = (await page.locator('main').count()) >= 1;
        return { passed: readable && responsiveEvidence.phoneNoHorizontalOverflow, diagnostics: { readable } };
      },
      'obligation-007': async ({ page, accessibilityEvidence }) => {
        const labels = await page.locator('label').count();
        return { passed: accessibilityEvidence.keyboardFocusObservable && labels >= 1, diagnostics: { labels: labels >= 1 } };
      },
    };
  `;
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource([harness, checksModule].join("\n"), ids, {
      responsiveCheckIds: ["obligation-004"],
      accessibilityCheckIds: ["obligation-007"],
    }),
  );

  // The harness alone still owns the protocol pieces the gates look for.
  assert.match(harness, /const captureProbeErrors: string\[\] = \[\]/u);
  assert.match(harness, /finally\s*\{[\s\S]*FOUNDRY_BROWSER_RESULT:/u);
  assert.match(harness, /scrollWidth/u);
  assert.match(harness, /clientWidth/u);
  assert.match(harness, /keyboard\.press\("Tab"\)/u);
  assert.match(harness, /activeElement/u);
  // Per-check isolation: one failing check cannot leave another unobserved.
  assert.match(harness, /try \{[\s\S]*await check\(/u);
  assert.match(harness, /catch \(error: unknown\)[\s\S]*checks\[id\] = false/u);
});

test("one repair corrects a failure whose causes span several files", () => {
  // The real defect: a fidelity verdict failed typography, colors, navigation
  // and surface order at once. Typography and color are declared in the
  // stylesheet; the navigation landmark and surface order are written in the
  // page. A patch that could name one file corrected the page, left the
  // approved font and palette untouched, and spent the next paid round undoing
  // the check its markup edit had broken — so the budget ran out with the
  // design still wrong.
  const currentFiles = [
    {
      path: "app/globals.css",
      content: "body{font-family:ui-rounded;color:#333333}",
    },
    {
      path: "app/page.tsx",
      content:
        "export default function Page(){return <main><h1>Stock</h1></main>}",
    },
  ];
  const accepted = validateBrowserRepairProposal({
    structuredOutput: {
      files: [
        {
          path: "app/globals.css",
          replacements: [
            { oldText: "ui-rounded", newText: "'Trebuchet MS'" },
            { oldText: "#333333", newText: "#263244" },
          ],
        },
        {
          path: "app/page.tsx",
          replacements: [
            { oldText: "<main>", newText: "<nav aria-label='Filters'/><main>" },
          ],
        },
      ],
    },
    currentFiles,
    requiredBrowserCheckIds: [],
  });

  assert.deepEqual(
    accepted.files.map((file) => file.path),
    ["app/globals.css", "app/page.tsx"],
  );
  assert.match(accepted.files[0].content, /Trebuchet MS/u);
  assert.match(accepted.files[0].content, /#263244/u);
  assert.match(accepted.files[1].content, /<nav/u);

  // Both files are still ordinary source, so the repair reruns the source
  // pipeline rather than the dependency one.
  assert.equal(
    deepestRepairScope(["BROWSER_TEST_REPAIR", "SOURCE_CODE_REPAIR"]),
    ProductionRepairScope.SOURCE_CODE,
  );
  assert.equal(
    deepestRepairScope(["SOURCE_CODE_REPAIR", "DEPENDENCY_REPAIR"]),
    ProductionRepairScope.DEPENDENCY,
  );

  // Naming one file twice would apply both edits against the same starting
  // content and silently discard the first.
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          files: [
            {
              path: "app/globals.css",
              replacements: [{ oldText: "ui-rounded", newText: "serif" }],
            },
            {
              path: "app/globals.css",
              replacements: [{ oldText: "#333333", newText: "#263244" }],
            },
          ],
        },
        currentFiles,
        requiredBrowserCheckIds: [],
      }),
    /named the same file twice/u,
  );

  // A repeated hypothesis is still refused across the whole file set, in any
  // order, so the budget cannot be spent re-proposing one correction.
  const proposal = {
    files: [
      {
        path: "app/page.tsx",
        replacements: [{ oldText: "<main>", newText: "<nav/><main>" }],
      },
    ],
  };
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: proposal,
        currentFiles,
        requiredBrowserCheckIds: [],
        priorStructuredOutputs: [proposal],
      }),
    /repeats an existing hypothesis/u,
  );

  // Proposals recorded before this change named a single path; every reader
  // still sees them.
  assert.deepEqual(
    repairPatchFiles({ path: "app/page.tsx", replacements: [] }),
    [{ path: "app/page.tsx", replacements: [] }],
  );
});

test("only Foundry may emit the evidence marker", () => {
  // Two markers would make the observation ambiguous, so a model-written spec
  // that emits one is discarded while its assertions module is kept.
  const plan = {
    files: [
      { path: "tests/foundry-checks.ts", content: "export const obligationChecks={};", contractRequirementIds: ["r1"] },
      { path: "tests/mine.spec.ts", content: 'console.log("FOUNDRY_BROWSER_RESULT:"+JSON.stringify({}));', contractRequirementIds: ["r1"] },
      { path: "app/page.tsx", content: "export default function P(){return null}", contractRequirementIds: ["r1"] },
    ],
  };
  const bound = bindFoundryObservationHarness(plan, ["obligation-001"]);
  const paths = bound.files.map((file) => file.path);

  assert.ok(paths.includes("tests/foundry-observation.spec.ts"));
  assert.ok(paths.includes("tests/foundry-checks.ts"), "the model's assertions are kept");
  assert.ok(!paths.includes("tests/mine.spec.ts"), "a competing marker is discarded");
  assert.ok(paths.includes("app/page.tsx"), "application source is untouched");
  assert.equal(
    bound.files.filter((file) => /FOUNDRY_BROWSER_RESULT/u.test(file.content)).length,
    1,
  );

  // With no required checks there is nothing to observe, so nothing is injected.
  assert.deepEqual(bindFoundryObservationHarness(plan, []), plan);
});
