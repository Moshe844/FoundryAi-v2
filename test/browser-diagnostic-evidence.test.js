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
    /may not be handed a literal true/u,
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
    /named the same file twice: app\/globals\.css/u,
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
    /repeats an earlier one exactly/u,
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

test("an unbalanced delimiter is reported with its position and cause", async () => {
  const { unbalancedJavaScriptDelimiter, hasBalancedJavaScriptDelimiters } =
    await import("../src/work-plane/production-mission-service.js");

  // The real defect, from a build that failed admission three times: one
  // missing ")" inside a nested call. The gate knew exactly where it was and
  // reported only "has unbalanced JavaScript delimiters" about a file of
  // several thousand characters, so each regeneration re-emitted it until the
  // correction budget ran out.
  const truncatedCall =
    "const locations=useMemo(()=>['All',...Array.from(new Set(items.map((i)=>i.location))],[items]);";
  const diagnosis = unbalancedJavaScriptDelimiter(truncatedCall);
  assert.match(diagnosis, /closing "\]" at line 1 column \d+/u);
  assert.match(diagnosis, /does not match the "\(" opened at line 1 column \d+/u);
  assert.match(diagnosis, /Array\.from/u, "the offending line is quoted back");

  // An opener left dangling at end of file names where it was opened.
  assert.match(
    unbalancedJavaScriptDelimiter("export default function P(){return (<main/>;"),
    /the "\(" opened at line 1 column 36 is never closed \(2 delimiters left open/u,
  );
  // A closer with no opener at all is named as such.
  assert.match(
    unbalancedJavaScriptDelimiter("const a = 1);"),
    /closing "\)" at line 1 column 12 has no matching "\("/u,
  );
  // An unterminated string and block comment are distinguished from brackets.
  assert.match(
    unbalancedJavaScriptDelimiter("const a = 'unterminated;"),
    /string opened with ' is never closed/u,
  );
  assert.match(
    unbalancedJavaScriptDelimiter("const a = 1; /* open"),
    /block comment is never closed/u,
  );

  // Balanced sources — including the JSX and apostrophe cases that were
  // previously false positives — stay balanced.
  for (const balanced of [
    "export default function P(){return (<main><h1>Hi</h1></main>)}",
    "export default function P(){return <p>Bea&apos;s desk isn't ready</p>}",
    "const re = /[/]{1,2}/g; const n = [1,2].map((x)=>({x}));",
  ]) {
    assert.equal(unbalancedJavaScriptDelimiter(balanced), null, balanced);
    assert.equal(hasBalancedJavaScriptDelimiters(balanced), true);
  }
});

test("an unbalanced JSX tag is reported with its position and cause", async () => {
  const { unbalancedJsxTag, hasBalancedJsxTags } = await import(
    "../src/work-plane/production-mission-service.js"
  );

  // Rejected builds the same way the delimiter checker did: the regeneration
  // was told only that the file "has unbalanced JSX tags" and had to locate the
  // element itself across the whole page.
  assert.match(
    unbalancedJsxTag("export default function P(){return (<main><div><h1>Hi</h1></main>)}"),
    /closing <\/main> at line 1 column \d+ does not match the <div> opened at line 1 column \d+/u,
  );
  assert.match(
    unbalancedJsxTag("export default function P(){return (<main><h1>Hi</h2></main>)}"),
    /closing <\/h2>[\s\S]*does not match the <h1>/u,
  );

  // Valid JSX — including void elements, expression attributes, and the
  // comparison operators that must not read as tags — stays valid.
  for (const balanced of [
    "export default function P(){return (<main><h1>Hi</h1></main>)}",
    'export default function P(){return (<main><img src="/a.png"/><br/><input value={x}/></main>)}',
    "const n = a < b && c > d;",
  ]) {
    assert.equal(unbalancedJsxTag(balanced), null, balanced);
    assert.equal(hasBalancedJsxTags(balanced), true);
  }
});

test("a Playwright test cannot break the production build", async () => {
  const { foundryObservationHarness } = await import(
    "../src/work-plane/production-mission-service.js"
  );
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/work-plane/production-mission-service.js", import.meta.url),
      "utf8",
    ),
  );

  // The real failure: the observation's own assertions module used expect()
  // without importing it, `next build` type-checks everything the project
  // includes, and the production build failed on ./tests/foundry-checks.ts.
  // A test file must never be able to break the shipped application.
  assert.match(
    source,
    /const exclude = \[\.\.\.new Set\(\[\.\.\.\(configuration\.exclude \?\? \[\]\), "node_modules", "tests"\]\)\]/u,
    "generated tsconfig must exclude the Playwright specs from the build",
  );

  // And the mistake is removed at its source: expect is supplied to each check,
  // so reaching for it needs no import at all.
  const harness = foundryObservationHarness(["obligation-001"]);
  assert.match(
    harness,
    /await check\(\{ page, expect, responsiveEvidence, accessibilityEvidence \}\)/u,
  );
  assert.match(source, /Take expect from the supplied context rather than importing it/u);
});

test("the responsive probe measures the narrow end, where layouts break", async () => {
  // A delivered build passed its responsive obligation and still overflowed by
  // three pixels at 360 — the most common Android width — because 390 is the
  // widest common phone and the only width measured. The narrow end is where a
  // layout actually breaks.
  const harness = foundryObservationHarness(["obligation-001"]);

  assert.match(harness, /setViewportSize\(\{ width: 320, height: 844 \}\)/u);
  assert.match(harness, /narrowNoHorizontalOverflow/u);
  // It must return to the comparison viewport, or every later measurement and
  // the prototype fidelity comparison would be taken at the wrong width.
  assert.match(
    harness,
    /width: 320[\s\S]*setViewportSize\(\{ width: 390, height: 844 \}\)/u,
  );

  // The harness enforces it itself: a capture probe error is blocking, so this
  // does not depend on the model's own check referencing the evidence.
  assert.match(
    harness,
    /if \(!narrowNoHorizontalOverflow\) \{[\s\S]*captureProbeErrors\.push\(/u,
  );
  // And the message names the amount and the offenders, so a repair can act.
  assert.match(harness, /px too wide/u);
  assert.match(harness, /Widest offenders/u);
  assert.match(harness, /min-width:0 on flex and grid children/u);

  // Both widths remain available to a project-specific check.
  assert.match(harness, /phoneNoHorizontalOverflow,\s*\n\s*narrowNoHorizontalOverflow,/u);
});

test("Foundry's own specs are never offered as repair targets", async () => {
  // The real failure: three consecutive repair proposals were aimed at
  // tests/foundry-design-fidelity-evidence.spec.ts, each proposing text
  // identical to what was already there because there was nothing in it to
  // fix. Foundry writes that spec and reinjects it every round, so any
  // correction to it is discarded by construction. The mission ended after a
  // single observation with the application's real failures — added, changed,
  // focus, noOverflow — never addressed.
  const { foundryOwnedTestPath } = await import(
    "../src/work-plane/production-mission-service.js"
  );

  assert.equal(foundryOwnedTestPath("tests/foundry-observation.spec.ts"), true);
  assert.equal(
    foundryOwnedTestPath("tests/foundry-design-fidelity-evidence.spec.ts"),
    true,
  );
  // The evidence spec takes a suffix when a mission needs more than one.
  assert.equal(
    foundryOwnedTestPath("tests/foundry-design-fidelity-evidence-home.spec.ts"),
    true,
  );

  // The model's own assertions module stays repairable — it is the one test
  // file a browser repair legitimately corrects.
  assert.equal(foundryOwnedTestPath("tests/foundry-checks.ts"), false);
  for (const applicationFile of [
    "app/page.tsx",
    "app/globals.css",
    "lib/db.ts",
    "playwright.config.ts",
  ]) {
    assert.equal(foundryOwnedTestPath(applicationFile), false, applicationFile);
  }

  // The eligible-file list must apply it.
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(
      new URL("../src/work-plane/production-mission-service.js", import.meta.url),
      "utf8",
    ),
  );
  assert.match(source, /!foundryOwnedTestPath\(file\.path\),/u);
});

test("a broken gateway is named as the cause of the checks behind it", async () => {
  // The real failure: an admin dashboard reported nine false checks — sign-in,
  // the gated route, the created-user list, the layout behind it — and spent
  // three identical rounds trying to correct nine defects. There was one. The
  // contract declares no dependencies between obligations, so nothing told the
  // repair that a workflow requiring a signed-in session cannot pass while
  // signing in is broken.
  const { blockedByGatewayFailure, browserCheckObservationFailure } =
    await import("../src/work-plane/production-mission-service.js");

  const obligations = [
    { obligationId: "obligation-002", statement: "A registered user can sign in with valid details and reach the dashboard." },
    { obligationId: "obligation-003", statement: "An unauthenticated visitor cannot access the dashboard workspace." },
    { obligationId: "obligation-005", statement: "Submitting a valid new user displays the created user in the list." },
    { obligationId: "obligation-007", statement: "The dashboard preserves its approved accessibility behaviour." },
  ];

  const named = blockedByGatewayFailure(
    ["obligation-002", "obligation-003", "obligation-005", "obligation-007"],
    obligations,
  );
  assert.match(named, /obligation-002 is false/u);
  assert.match(named, /Fix that first/u);
  assert.match(named, /obligation-003, obligation-005, obligation-007/u);
  assert.match(named, /changes nothing observable/u);

  // No gateway among the failures means no such claim is made.
  assert.equal(
    blockedByGatewayFailure(["obligation-005", "obligation-007"], obligations),
    null,
  );
  // A gateway failing alone is not "blocking" anything else.
  assert.equal(blockedByGatewayFailure(["obligation-002"], obligations), null);
  // And a project with no sign-in at all is unaffected.
  assert.equal(
    blockedByGatewayFailure(["a", "b"], [
      { obligationId: "a", statement: "Staff can add a stock item." },
      { obligationId: "b", statement: "The dashboard lists low stock." },
    ]),
    null,
  );

  // The whole observation failure carries it, after the sub-check detail.
  const message = browserCheckObservationFailure(
    ["obligation-002", "obligation-005"],
    { "obligation-002": { signin: false }, "obligation-005": { listed: false } },
    obligations,
  );
  assert.match(message, /real browser checks were false/u);
  assert.match(message, /Failed named sub-checks/u);
  assert.match(message, /every workflow behind it runs only once that succeeds/u);
});

test("a failing workflow reports the request that failed under it", async () => {
  // obligation-004 reported {"added": false} to three consecutive repairs and
  // told none of them whether the form never submitted, the route answered
  // 500, or the row rendered somewhere the locator did not look. One boolean
  // is not a diagnosis. The request the workflow made is, and the harness was
  // watching console and page errors while ignoring the network entirely.
  const harness = foundryObservationHarness(["obligation-004"]);

  assert.match(harness, /page\.on\("response"/u);
  assert.match(harness, /if \(status < 400 \|\| failedRequests\.length >= 25\) return;/u);

  // Each failure is tagged with the check that was running when it arrived, so
  // a 500 during user creation is not attributed to an unrelated check.
  assert.match(harness, /observingCheckId = id;/u);
  assert.match(harness, /check: observingCheckId/u);

  // Reported only for checks that actually failed: a deliberate validation
  // response under a passing check is not noise the repair has to dismiss.
  assert.match(harness, /\.filter\(\(entry\) => checks\[entry\.check\] === false\)/u);
  assert.match(harness, /"While computing " \+ entry\.check \+ ", " \+ entry\.method/u);
  assert.match(harness, /answered " \+ entry\.status/u);

  // The harness must still be valid source and still satisfy its own gates.
  const { unbalancedJavaScriptDelimiter } = await import(
    "../src/work-plane/production-mission-service.js"
  );
  assert.equal(unbalancedJavaScriptDelimiter(harness), null);
  const checksModule = `
    export const obligationChecks = {
      'obligation-004': async ({ page }) => ({
        passed: (await page.locator('tr').count()) >= 1,
        diagnostics: { added: true },
      }),
    };
  `;
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource([harness, checksModule].join("\n"), ["obligation-004"], {}),
  );
});
