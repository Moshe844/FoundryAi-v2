import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

import {
  AcceptanceConditionType,
  ObservationKind,
  WorkUnitAction,
  WorkUnitStatus,
  createProjectProfileService,
  normalizeAcceptanceCondition,
  normalizeProjectProfile,
  openMissionControl,
  parseBrowserResult,
} from "../src/index.js";
import {
  ProductionRepairScope,
  classifyProductionFailure,
  ensureCertifiedStackScaffold,
  generatedFileReconciliationAction,
  hasBalancedJavaScriptDelimiters,
  hasBalancedJsxTags,
  repairScopeForPath,
  validateGeneratedRepairPath,
  validateGeneratedRepairProposal,
  verificationTargetsForProcedure,
  validateBrowserRepairProposal,
  validateBrowserObservationTestSource,
  validateProjectBundleForStack,
  validateCustomerContentIntegrity,
} from "../src/work-plane/production-mission-service.js";
import { modelRequestTimeoutMs } from "../src/capability-plane/live-ai-adapters.js";

test("live model requests use one adequate timeout instead of short-call retry pressure", () => {
  assert.equal(modelRequestTimeoutMs({ taskClass: "PROJECT_UNDERSTANDING" }), 120_000);
  assert.equal(modelRequestTimeoutMs({ taskClass: "FILE_GENERATION" }), 300_000);
});

test("repository test commands exclude generated customer workspaces", () => {
  const packageManifest = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "..", "package.json"), "utf8"),
  );
  assert.equal(
    packageManifest.scripts.test,
    "node --test --test-concurrency=1 \"test/*.test.js\"",
  );
  assert.equal(
    packageManifest.scripts["test:certification"],
    "node scripts/run-live-certification-tests.mjs",
  );
  assert.equal(
    packageManifest.scripts["test:coverage"],
    "node --test --test-concurrency=1 --experimental-test-coverage \"test/*.test.js\"",
  );
});

test("certified stack scaffold deterministically owns readiness, icon, and browser infrastructure", () => {
  const files = ensureCertifiedStackScaffold(
    [
      { path: "src/app/page.tsx", content: "export default function Page() { return null; }" },
      { path: "src/app/icon.tsx", content: "export function GET() {}" },
      { path: "src/app/icon.svg/route.ts", content: "export function GET() {}" },
      { path: "src/app/api/health/route.ts", content: "throw new Error('generated');" },
      { path: "playwright.config.ts", content: "export default { webServer: {} };" },
      { path: "tests/live.spec.ts", content: "try {} finally { console.log('FOUNDRY_BROWSER_RESULT:'); }" },
    ],
    ["obligation-runtime"],
  );
  for (const path of [
    "src/app/api/health/route.ts",
    "src/app/icon.svg",
    "playwright.config.ts",
  ]) {
    const file = files.find((candidate) => candidate.path === path);
    assert(file);
    assert.deepEqual(file.contractRequirementIds, ["obligation-runtime"]);
  }
  assert.equal(files.some((file) => file.path === "src/app/icon.tsx"), false);
  assert.equal(files.some((file) => file.path === "src/app/icon.svg/route.ts"), false);
  assert.match(
    files.find((file) => file.path.endsWith("health/route.ts")).content,
    /status: "ready"/u,
  );
  const browserTest = files.find((file) => file.path === "tests/live.spec.ts");
  for (const collection of ["captureProbeErrors", "consoleErrors", "pageErrors"]) {
    assert.match(browserTest.content, new RegExp(`const ${collection}: string\\[\\] = \\[\\]`, "u"));
  }
  const playwright = files.find((file) => file.path === "playwright.config.ts");
  assert.match(playwright.content, /FOUNDRY_PREVIEW_URL/u);
  assert.match(playwright.content, /channel: "chrome"/u);
  assert.match(playwright.content, /viewport: \{ width: 375, height: 667 \}/u);
  assert.doesNotMatch(playwright.content, /webServer/u);
});

test("certified stack scaffold pins packages and shares measured quality probes without paid corrections", () => {
  const files = ensureCertifiedStackScaffold(
    [
      {
        path: "package.json",
        content: JSON.stringify({
          scripts: {
            build: "next build",
            start: "next start",
            typecheck: "tsc --noEmit",
            lint: "eslint .",
            test: "playwright test",
          },
          dependencies: {
            next: "15.4.4",
            react: "19.1.0",
            "react-dom": "19.1.0",
            "better-sqlite3": "13.0.1",
          },
          devDependencies: {
            "@playwright/test": "1.54.2",
            "@types/react-dom": "19.1.0",
            typescript: "5.8.3",
          },
        }),
      },
      {
        path: "tests/live.spec.ts",
        content: [
          "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
          "let checks: Record<string, boolean> = { 'check-phone': false, 'check-access': false };",
          "try {",
          "  await page.goto('/');",
          "  const productVisible = (await page.locator('main').count()) > 0;",
          "  checks['check-phone'] = productVisible;",
          "  checks['check-access'] = productVisible;",
          "} finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
        ].join("\n"),
      },
    ],
    [],
    {
      responsiveCheckIds: ["check-phone"],
      accessibilityCheckIds: ["check-access"],
    },
  );
  const packageDefinition = JSON.parse(
    files.find((file) => file.path === "package.json").content,
  );
  assert.equal(packageDefinition.devDependencies["@types/react-dom"], "19.1.2");
  const browserTest = files.find((file) => file.path === "tests/live.spec.ts").content;
  assert.match(browserTest, /__foundryResponsiveEvidence/u);
  assert.match(browserTest, /__foundryAccessibilityEvidence/u);
  assert.match(browserTest, /const checks: Record<string, boolean>/u);
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      browserTest,
      ["check-phone", "check-access"],
      {
        responsiveCheckIds: ["check-phone"],
        accessibilityCheckIds: ["check-access"],
      },
    ),
  );
});

test("certified stack scaffold does not mistake an unlinked public favicon for Next metadata", () => {
  const files = ensureCertifiedStackScaffold([
    { path: "app/page.tsx", content: "export default function Page() { return null; }" },
    { path: "public/favicon.svg", content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"></svg>' },
  ]);
  assert(files.some((file) => file.path === "public/favicon.svg"));
  assert(files.some((file) => file.path === "app/icon.svg"));
});

test("certified stack scaffold stabilizes color probes and emits failed sub-check diagnostics", () => {
  const files = ensureCertifiedStackScaffold([{
    path: "tests/design.spec.ts",
    content: [
      "import { test } from '@playwright/test';",
      "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
      "const checks: Record<string, boolean> = { 'check-design': false };",
      "const hasPalette = true; const hasHierarchy = false;",
      "try {",
      "  const btnBg = await page.evaluate(() => getComputedStyle(document.querySelector('button')!).backgroundColor);",
      "  void btnBg;",
      "  checks['check-design'] = hasPalette && hasHierarchy;",
      "} finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
    ].join("\n"),
  }]);
  const source = files.find((file) => file.path === "tests/design.spec.ts").content;
  assert.match(source, /await page\.mouse\.move\(0, 0\)/u);
  assert.match(source, /await page\.waitForTimeout\(200\)/u);
  assert.match(source, /diagnostics\["check-design"\] = \{ hasPalette, hasHierarchy \}/u);
  assert.match(source, /JSON\.stringify\(\{ captureProbeErrors, checks, diagnostics, consoleErrors, pageErrors \}\)/u);
});

test("certified stack scaffold preserves application mutations misplaced at the health route", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "app/api/health/route.ts",
      content: "export async function POST() { return Response.json({ ok: true }); }",
    },
    {
      path: "app/page.tsx",
      content: "export async function save() { return fetch('/api/health', { method: 'POST' }); }",
    },
  ]);
  assert.match(
    files.find((file) => file.path === "app/api/health/route.ts").content,
    /status: "ready"/u,
  );
  assert.match(
    files.find((file) => file.path === "app/api/foundry-application/route.ts").content,
    /function POST/u,
  );
  assert.match(
    files.find((file) => file.path === "app/page.tsx").content,
    /\/api\/foundry-application/u,
  );
});

test("certified stack scaffold normalizes protocol-specific catch typing without a paid repair", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/live.spec.ts",
      content:
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = []; try {} catch (e: any) { captureProbeErrors.push(e.message || String(e)); } finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/live.spec.ts");
  assert.doesNotMatch(browserTest.content, /catch\s*\([^)]*:\s*any\)/u);
  assert.match(browserTest.content, /catch \(e: unknown\)/u);
  assert.match(browserTest.content, /e instanceof Error \? e\.message : String\(e\)/u);
});

test("certified stack scaffold replaces nondeterministic browser network-idle waits", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/live.spec.ts",
      content:
        `const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = []; await page.goto('/', { waitUntil: 'networkidle' }); await page.waitForLoadState("networkidle"); console.log('FOUNDRY_BROWSER_RESULT:');`,
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/live.spec.ts");
  assert.doesNotMatch(browserTest.content, /networkidle/u);
  assert.match(browserTest.content, /waitUntil: "domcontentloaded"/u);
  assert.match(browserTest.content, /waitForLoadState\("domcontentloaded"\)/u);
});

test("certified stack scaffold enforces a real phone viewport before responsive measurement", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/live.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "try { const scrollWidth = await page.evaluate(() => document.body.scrollWidth); void scrollWidth; }",
        "finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
      ].join("\n"),
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/live.spec.ts");
  assert.match(
    browserTest.content,
    /try \{\n\s*await page\.setViewportSize\(\{ width: 375, height: 667 \}\)/u,
  );
});

test("certified stack scaffold keeps browser channel out of context options", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/live.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "const context = await browser.newContext({ viewport: { width: 375, height: 667 }, channel: 'chrome' });",
        "try {} finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
      ].join("\n"),
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/live.spec.ts");
  assert.doesNotMatch(browserTest.content, /newContext\([^\n]*channel/u);
  assert.match(browserTest.content, /viewport: \{ width: 375, height: 667 \}/u);
});

test("certified stack scaffold selects an enabled observed appointment time", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/booking.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "try { await page.locator('.slot-btn', { hasText: '09:00' }).last().click(); }",
        "finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
      ].join("\n"),
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/booking.spec.ts");
  assert.doesNotMatch(browserTest.content, /hasText: '09:00'/u);
  assert.match(browserTest.content, /\.slot-btn:not\(\[disabled\]\)/u);
  assert.match(browserTest.content, /hasText: \/\^\\d\{2\}:\\d\{2\}\//u);
});

test("certified stack scaffold waits for asynchronously loaded semantic slots", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/booking.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "try {",
        "  const slotButtons = page.locator('button[aria-label^=\"Book appointment on\"]');",
        "  const slotCount = await slotButtons.count();",
        "} finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
      ].join("\n"),
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/booking.spec.ts");
  assert.match(
    browserTest.content,
    /await slotButtons\.first\(\)\.waitFor\(\{ state: 'visible' \}\);/u,
  );
});

test("certified stack scaffold waits for required collections and fails false evidence", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/app.spec.ts",
      content: `import { test } from '@playwright/test';
test('flow', async ({ page }) => {
  const captureProbeErrors: string[] = [];
  const checks: Record<string, boolean> = { booking: false };
  const diagnostics: Record<string, Record<string, unknown>> = {};
  try {
    const bookingCards = await page.$$('.booking-card');
    const hasBookings = bookingCards.length > 0;
    checks.booking = hasBookings;
  } finally {
    const result = JSON.stringify({ captureProbeErrors, checks, diagnostics });
    console.log('FOUNDRY_BROWSER_RESULT: ' + result);
  }
});`,
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/app.spec.ts");
  assert.match(browserTest.content, /locator\("\.booking-card"\)\.first\(\)\.waitFor/u);
  assert.match(browserTest.content, /__foundryFailedChecks/u);
  assert.match(browserTest.content, /throw new Error/u);
});

test("certified stack scaffold excludes Next's hidden route announcer from alert evidence", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/error.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "try { const errorVisible = await page.locator('[role=\"alert\"]').isVisible(); }",
        "finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
      ].join("\n"),
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/error.spec.ts");
  assert.match(browserTest.content, /:not\(#__next-route-announcer__\)/u);
  assert.match(browserTest.content, /\.first\(\)\.isVisible\(\)/u);
});

test("certified stack scaffold disambiguates text actions from repeated headings", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/actions.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "try { await page.click('text=Add Record'); }",
        "finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
      ].join("\n"),
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/actions.spec.ts");
  assert.match(
    browserTest.content,
    /getByRole\('button', \{ name: 'Add Record', exact: true \}\)\.click\(\)/u,
  );
});

test("certified stack scaffold distinguishes booking slots from Back buttons", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "tests/booking.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "try { const slot = page.locator('button.btn-secondary').first(); checks['staff'] = (hasTable || true) && hasSlots; void slot; }",
        "finally { console.log('FOUNDRY_BROWSER_RESULT:'); }",
      ].join("\n"),
    },
  ]);
  const browserTest = files.find((file) => file.path === "tests/booking.spec.ts");
  assert.match(browserTest.content, /aria-label\^="Select time"/u);
  assert.doesNotMatch(browserTest.content, /button\.btn-secondary/u);
  assert.doesNotMatch(browserTest.content, /\|\|\s*true/u);
  assert.match(browserTest.content, /checks\['staff'\] = hasTable && hasSlots/u);
});

test("certified stack scaffold types SQLite rows and strengthens browser evidence semantics", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "lib/db.ts",
      content: "const count = (db.prepare('SELECT COUNT(*) as c FROM items').get() as any).c;",
    },
    {
      path: "tests/live.spec.ts",
      content: [
        "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = [];",
        "const visibleRows = await page.locator('[data-row]').count();",
        "page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });",
        "const labelledInputs = await page.locator('input[aria-label], textarea[aria-label]').count();",
        "const responsiveOk = noOverflow && boundedHeight && interactionDensityOk && labelledInputs > 0;",
        "checks['phone'] = (visibleRows >= 0) && responsiveOk;",
        "console.log('FOUNDRY_BROWSER_RESULT:');",
      ].join("\n"),
    },
  ]);
  const database = files.find((file) => file.path === "lib/db.ts");
  const browserTest = files.find((file) => file.path === "tests/live.spec.ts");
  assert.match(database.content, /as \{ c: number \}/u);
  assert.doesNotMatch(database.content, /as any/u);
  assert.match(browserTest.content, /visibleRows > 0/u);
  assert.doesNotMatch(browserTest.content, /visibleRows\s*>=\s*0/u);
  assert.match(browserTest.content, /Unprocessable Entity/u);
  assert.match(browserTest.content, /button:not\(:empty\):visible/u);
});

test("certified stack scaffold makes narrowed JSON body assertions type-safe", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "app/api/items/route.ts",
      content: [
        "const body = await request.json() as { action: string; [key: string]: unknown };",
        "const { itemId, name } = body as { itemId: number; name: string };",
      ].join("\n"),
    },
  ]);
  const route = files.find((file) => file.path === "app/api/items/route.ts");
  assert.match(
    route.content,
    /body as unknown as \{ itemId: number; name: string \}/u,
  );
});

test("certified stack scaffold normalizes internal Next navigation before lint", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "app/layout.tsx",
      content:
        `'use client';\nimport './globals.css';\nexport default function Layout() { return <nav><a href="/">Home</a><a href='/profile'>Profile</a><a href="https://example.com">External</a></nav>; }`,
    },
    { path: "app/requests/page.tsx", content: `import Link from 'next/link'; export default function Page() { return <Link href="/requests/new">New request</Link>; }` },
  ]);
  const layout = files.find((file) => file.path === "app/layout.tsx");
  assert.match(layout.content, /^'use client';\nimport FoundryLink from "next\/link";/u);
  assert.match(layout.content, /<FoundryLink href="\/">Home<\/FoundryLink>/u);
  assert.match(layout.content, /<FoundryLink href='\/profile'>Profile<\/FoundryLink>/u);
  assert.match(layout.content, /<a href="https:\/\/example\.com">External<\/a>/u);
  const requests = files.find((file) => file.path === "app/requests/page.tsx");
  assert.match(requests.content, /href="\/requests"/u);
  assert.doesNotMatch(requests.content, /\/requests\/new/u);
});

test("certified stack scaffold removes an unused generated Next Link import", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "app/page.tsx",
      content: `'use client';\nimport Link from 'next/link';\nexport default function Page() { return <button>Continue</button>; }`,
    },
  ]);
  const page = files.find((file) => file.path === "app/page.tsx");
  assert.doesNotMatch(page.content, /next\/link/u);
  assert.match(page.content, /^'use client';\n+export default/u);
});

test("certified stack scaffold replaces an unmistakable JavaScript stylesheet stub", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "app/globals.css",
      content: "export default function GlobalStyles() { return null; }",
    },
  ]);
  const stylesheet = files.find((file) => file.path === "app/globals.css");
  assert.doesNotMatch(stylesheet.content, /export|function/u);
  assert.match(stylesheet.content, /box-sizing: border-box/u);
  assert.match(stylesheet.content, /button, input, select, textarea/u);
});

test("certified stack scaffold resets a completed booking flow when its tab is reopened", () => {
  const files = ensureCertifiedStackScaffold([
    {
      path: "app/page.tsx",
      content: [
        "const resetBooking = () => { setStep(0); setSuccess(null); };",
        "const tabs = TABS.map(t => <button onClick={() => { setTab(t); setEditing(null); }}>{t}</button>);",
      ].join("\n"),
    },
  ]);
  const page = files.find((file) => file.path === "app/page.tsx");
  assert.match(page.content, /if \(t === 'Book'\) resetBooking\(\)/u);
});

test("certified stack scaffold repairs one excess span close and JSX admission detects mismatches", () => {
  const malformed = "export default function Page() { return <div><span>Status</span><span>Confirmed</span></span></div>; }";
  assert.equal(hasBalancedJsxTags(malformed), false);
  assert.equal(
    hasBalancedJsxTags("export const smaller = bodyWidth < breakpoint;"),
    true,
  );
  assert.equal(
    hasBalancedJsxTags(
      `<html><head><link rel="icon" href="data:image/svg+xml,<svg><rect /></svg>" /></head><body /></html>`,
    ),
    true,
  );
  assert.equal(
    hasBalancedJsxTags(
      "const [value, setValue] = useState<number | null>(null); return <main />;",
    ),
    true,
  );
  const files = ensureCertifiedStackScaffold([
    { path: "app/page.tsx", content: malformed },
  ]);
  const page = files.find((file) => file.path === "app/page.tsx");
  assert.equal(hasBalancedJsxTags(page.content), true);
  assert.doesNotMatch(page.content, /<\/span><\/span><\/div>/u);
});
import {
  certificationProjectFixtures,
  inventoryCertificationFixture,
  marketingWebsiteFixture,
  restApiFixture,
} from "./fixtures/certification/project-workloads.js";

function productionFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return productionFiles(path);
    }
    return /\.(?:js|ts|tsx)$/u.test(entry.name) ? [path] : [];
  });
}

test("core production subsystems contain no certification-domain vocabulary", () => {
  const root = resolve(import.meta.dirname, "..");
  const productionRoots = [
    resolve(root, "src"),
    resolve(root, "apps", "web", "app"),
  ];
  const banned = [
    /\binventory\b/iu,
    /\bstock\b/iu,
    /\bquantity\b/iu,
    /\binventoryPageLoaded\b/u,
    /\bproductCreated\b/u,
    /\bstartingStockVisible\b/u,
    /\bstockEdited\b/u,
    /\bNorthstar\b/u,
    /product-add/iu,
    /preview\/inventory/iu,
  ];
  const violations = [];

  for (const file of productionRoots.flatMap(productionFiles)) {
    const content = readFileSync(file, "utf8");
    for (const pattern of banned) {
      if (pattern.test(content)) {
        violations.push(`${relative(root, file)} matched ${pattern}`);
      }
    }
  }

  assert.deepEqual(violations, []);
  assert.equal(
    statSync(
      resolve(
        root,
        "test",
        "fixtures",
        "certification",
        "project-workloads.js",
      ),
    ).isFile(),
    true,
  );
});

test("bounded repair can add a missing generic source file but rejects unsafe paths", () => {
  const generatedFiles = [
    { path: "app/page.tsx", content: "export default function Page() {}" },
    { path: "next.config.ts", content: "export default {}" },
  ];

  assert.equal(
    validateGeneratedRepairPath("app/layout.tsx", generatedFiles),
    "write",
  );
  assert.equal(
    validateGeneratedRepairPath("next.config.ts", generatedFiles),
    "replace",
  );
  assert.equal(
    validateGeneratedRepairPath("app/icon.svg", generatedFiles),
    "write",
  );
  assert.throws(
    () =>
      validateGeneratedRepairPath(
        "node_modules/example/index.js",
        generatedFiles,
      ),
    /which Foundry owns and regenerates/u,
  );
  assert.throws(
    () => validateGeneratedRepairPath("../outside.ts", generatedFiles),
    /is not a safe project-relative path/u,
  );
  assert.throws(
    () => validateGeneratedRepairPath("missing/deep/file.ts", generatedFiles),
    /a directory this project does not have/u,
  );
});

test("source repair proposals reject unchanged and repeated work before execution", () => {
  const currentFiles = [
    { path: "app/icon.svg", content: "<svg></svg>" },
  ];

  assert.doesNotThrow(() =>
    validateGeneratedRepairProposal({
      structuredOutput: {
        path: "app/icon.svg",
        content: '<svg viewBox="0 0 64 64"></svg>',
      },
      currentFiles,
    }),
  );
  assert.throws(
    () =>
      validateGeneratedRepairProposal({
        structuredOutput: {
          path: "app/icon.svg",
          content: "<svg></svg>",
        },
        currentFiles,
      }),
    /byte-for-byte unchanged/u,
  );
  assert.throws(
    () =>
      validateGeneratedRepairProposal({
        structuredOutput: {
          path: "app/icon.svg",
          content: '<svg viewBox="0 0 64 64"></svg>',
        },
        currentFiles,
        priorStructuredOutputs: [
          {
            path: "app/icon.svg",
            content: '<svg viewBox="0 0 64 64"></svg>',
          },
        ],
      }),
    /exactly the same[\s\S]*as an earlier attempt/u,
  );
});

test("browser verification keeps Runtime Service authoritative and forbids automatic paid reruns", () => {
  const source = readFileSync(
    resolve(
      import.meta.dirname,
      "..",
      "src",
      "work-plane",
      "production-mission-service.js",
    ),
    "utf8",
  );

  assert.match(source, /must not declare webServer/u);
  assert.match(source, /FOUNDRY_PREVIEW_URL/u);
  assert.match(source, /describe the runtime value as development-only/u);
  assert.match(source, /never imply that final customer access was supplied/u);
  assert.match(source, /channel\\s\*:\\s\*\["'\]chrome/u);
  assert.match(source, /\^playwright\\\.config/u);
  assert.match(source, /latestPriorBrowserWorkUnit\.preWorkCheckpointId/u);
  assert.match(
    source,
    /latestPriorBrowserWorkUnit\.workUnitId\}-restore/u,
  );
  assert.match(source, /preflight-checkpoint-/u);
  assert.match(
    source,
    /rehydrationBeforeCommands\.endTimestamp\s*<\s*restoreBeforeCommands\.occurredAt/u,
  );
  assert.match(source, /rehydratedBeforeCommands/u);
  // Admission failures must never trigger an automatic paid correction chain.
  assert.match(source, /MAX_GENERATION_CORRECTION_CALLS = 0/u);
  assert.match(source, /MAX_PROCEDURE_REPAIR_CALLS = 0/u);
  // Browser repair is bounded but larger than the others: its failures were
  // observed converging (8, then 5, then 3 across attempts) once every check
  // carried diagnostics, so the old limit of two truncated a descent that was
  // still making progress. It stays a small fixed number, never unbounded.
  assert.match(source, /MAX_BROWSER_REPAIR_CALLS = 4/u);
  assert.match(source, /MAX_DESIGN_FIDELITY_REPAIR_CALLS = 4/u);
  assert.match(source, /MAX_RUNTIME_RESTARTS = 2/u);
  assert.match(source, /browser-first-pass-failed/u);
  assert.match(source, /browser-repair-budget-exhausted/u);
  assert.match(source, /Prior evidence-backed browser repairs/u);
  assert.match(source, /sourceOnlyBrowserRepair/u);
  assert.match(source, /changing Playwright tests or configuration is not permitted/u);
  assert.match(source, /reusableTransientDirectories\(checkpointId\)/u);
  assert.match(source, /checkpointFingerprint/u);
  assert.match(
    source,
    /preserveTransientDirectories: reusableDirectories/u,
  );
  assert.doesNotMatch(
    source,
    /await rehydrateRestoredWorkspace\(browser\.workUnitId\)/u,
  );
});

test("browser server failures route to application source rather than test repair", () => {
  const classified = classifyProductionFailure({
    stage: "browserVerification",
    stdout:
      'FOUNDRY_BROWSER_RESULT: {"captureProbeErrors":["Booking request failed with status 500"],"checks":{},"consoleErrors":["500 (Internal Server Error)"],"pageErrors":[]}',
    observationFailure: "The browser observation recorded blocking errors.",
  });
  assert.equal(classified.scope, ProductionRepairScope.SOURCE_CODE);
  assert.match(classified.hypothesis, /repair application source/u);

  const protocolFailure = classifyProductionFailure({
    stage: "browserVerification",
    observationFailure:
      "The structured browser result did not contain exactly the required browser-check obligation IDs.",
  });
  assert.equal(protocolFailure.scope, ProductionRepairScope.BROWSER_TEST);

  const fidelityFailure = classifyProductionFailure({
    stage: "browserVerification",
    observationFailure:
      "Production design fidelity failed against the approved live prototype: composition, spacing.",
  });
  assert.equal(fidelityFailure.scope, ProductionRepairScope.SOURCE_CODE);
  assert.match(fidelityFailure.hypothesis, /immutable approved prototype/u);
});

test("worker and local API clean failed mission runtimes without closed-channel crashes", () => {
  const workerSource = readFileSync(
    resolve(
      import.meta.dirname,
      "..",
      "apps",
      "web",
      "local-api",
      "mission-worker.mjs",
    ),
    "utf8",
  );
  const serverSource = readFileSync(
    resolve(
      import.meta.dirname,
      "..",
      "apps",
      "web",
      "local-api",
      "server.mjs",
    ),
    "utf8",
  );
  assert.match(
    workerSource,
    /catch \(error\)[\s\S]*await control\.production\.stop\(missionId\)/u,
  );
  assert.match(serverSource, /job\.child\.connected/u);
  assert.match(serverSource, /job\.child\.exitCode === null/u);
  assert.match(serverSource, /activeJobs\.delete\(missionId\)/u);
});

test("repair scope classification distinguishes test, source, configuration, dependency, and runtime failures", () => {
  assert.equal(
    repairScopeForPath("tests/workflow.spec.ts"),
    ProductionRepairScope.BROWSER_TEST,
  );
  assert.equal(
    repairScopeForPath("app/page.tsx"),
    ProductionRepairScope.SOURCE_CODE,
  );
  assert.equal(
    repairScopeForPath("next.config.ts"),
    ProductionRepairScope.CONFIGURATION,
  );
  assert.equal(
    repairScopeForPath("package.json"),
    ProductionRepairScope.DEPENDENCY,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "browserVerification",
      stderr:
        "browserType.launch: Executable doesn't exist at ms-playwright/chromium/chrome.exe",
    }).scope,
    ProductionRepairScope.CONFIGURATION,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "browserVerification",
      stderr: "page.goto: net::ERR_CONNECTION_REFUSED",
    }).scope,
    ProductionRepairScope.RUNTIME,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "productionBuild",
      stderr: "'next' is not recognized as an internal or external command",
    }).scope,
    ProductionRepairScope.DEPENDENCY,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "lint",
      stderr:
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'node_modules/eslint-config-next/core-web-vitals' imported from eslint.config.mjs",
    }).scope,
    ProductionRepairScope.CONFIGURATION,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "typeCheck",
      stdout:
        "app/page.tsx(1,24): error TS2307: Cannot find module '@/lib/content' or its corresponding type declarations.",
    }).scope,
    ProductionRepairScope.SOURCE_CODE,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "typeCheck",
      stdout:
        "app/page.tsx(1,24): error TS2307: Cannot find module './content' or its corresponding type declarations.",
    }).scope,
    ProductionRepairScope.SOURCE_CODE,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "typeCheck",
      stdout:
        "app/page.tsx(1,24): error TS2307: Cannot find module 'missing-package' or its corresponding type declarations.",
    }).scope,
    ProductionRepairScope.DEPENDENCY,
  );
  assert.equal(
    classifyProductionFailure({
      stage: "productionBuild",
      stderr: "ReferenceError: require is not defined in ES module scope",
    }).scope,
    ProductionRepairScope.CONFIGURATION,
  );
});

test("certified-stack bundle admission rejects structural defects before install or build", () => {
  const baseFiles = [
    {
      path: "package.json",
      content: JSON.stringify({
        dependencies: {
          "better-sqlite3": "13.0.1",
          next: "15.4.4",
          react: "19.1.0",
          "react-dom": "19.1.0",
        },
        devDependencies: {
          "@playwright/test": "1.54.2",
          typescript: "5.8.3",
        },
        scripts: {
          build: "next build",
          start: "next start",
          typecheck: "tsc --noEmit",
          lint: "eslint .",
          test: "playwright test",
        },
      }),
    },
    { path: "app/layout.tsx", content: "export default function Layout({children}) { return children; }" },
    { path: "app/page.tsx", content: "export default function Page() { return null; }" },
    {
      path: "app/api/health/route.ts",
      content: "export function GET() { return Response.json({ready:true}); }",
    },
    {
      path: "app/icon.svg",
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16"/></svg>',
    },
    {
      path: "eslint.config.mjs",
      content: 'export default [{ ignores: [".next/**"] }];',
    },
    {
      path: "playwright.config.ts",
      content:
        "export default { use: { baseURL: process.env.FOUNDRY_PREVIEW_URL, channel: 'chrome' } };",
    },
    {
      path: "tests/workflow.spec.ts",
      content:
        "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-visible': false}; const observedVisible = document.title.length > 0; try { checks['check-visible'] = observedVisible; } finally { process.stdout.write('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
    },
  ];

  assert.equal(
    validateProjectBundleForStack(baseFiles, ["check-visible"]).length,
    baseFiles.length,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.filter((file) => file.path !== "app/layout.tsx"),
        ["check-visible"],
      ),
    /root app\/layout/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.filter((file) => file.path !== "app/icon.svg"),
        ["check-visible"],
      ),
    /application icon or favicon/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "app/icon.svg"
            ? {
                ...file,
                content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
              }
            : file,
        ),
        ["check-visible"],
      ),
    /intrinsic dimensions or viewBox/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "eslint.config.mjs"
            ? { ...file, content: "export default [];" }
            : file,
        ),
        ["check-visible"],
      ),
    /ignore the generated "\.next"/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "eslint.config.mjs"
            ? {
                ...file,
                content:
                  "import nextVitals from 'eslint-config-next/core-web-vitals'; export default [...nextVitals, { ignores: ['.next/**'] }];",
              }
            : file,
        ),
        ["check-visible"],
      ),
    /Next\.js 16-style direct flat-config imports/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "eslint.config.mjs"
            ? {
                ...file,
                content:
                  "import { FlatCompat } from '@eslint/eslintrc'; const compat = new FlatCompat({ baseDirectory: __dirname }); export default [...compat.extends('next/core-web-vitals'), { ignores: ['.next/**'] }];",
              }
            : file,
        ),
        ["check-visible"],
      ),
    /cannot use CommonJS __dirname/u,
  );
  const aliasBundle = baseFiles.map((file) =>
    file.path === "app/page.tsx"
      ? {
          ...file,
          content:
            "import { value } from '@/lib/content'; export default function Page(){return <main>{value}</main>}",
        }
      : file,
  );
  aliasBundle.push({
    path: "lib/content.ts",
    content: "export const value = 'ready';",
  });
  aliasBundle.push({
    path: "tsconfig.json",
    content: JSON.stringify({ compilerOptions: {} }),
  });
  assert.throws(
    () => validateProjectBundleForStack(aliasBundle),
    /does not define a safe compilerOptions\.paths/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "playwright.config.ts"
            ? {
                ...file,
                content:
                  "export default { webServer: {}, use: { baseURL: process.env.FOUNDRY_PREVIEW_URL, channel: 'chrome' } };",
              }
            : file,
        ),
        ["check-visible"],
      ),
    /must not own a webServer/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "playwright.config.ts"
            ? {
                ...file,
                content:
                  "export default { reporter: './tests/silent-reporter.ts', use: { baseURL: process.env.FOUNDRY_PREVIEW_URL, channel: 'chrome' } };",
              }
            : file,
        ),
        ["check-visible"],
      ),
    /must not suppress evidence/u,
  );
  assert.throws(
    () => validateProjectBundleForStack(baseFiles, ["missing-check"]),
    /must compute required check/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "tests/workflow.spec.ts"
            ? {
                ...file,
                content:
                  "const captureProbeErrors = false; const consoleErrors = []; const pageErrors = []; const checks = {'check-visible': true}; try {} finally { process.stdout.write('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
              }
            : file,
        ),
        ["check-visible"],
      ),
    /initialize captureProbeErrors as an empty array/u,
  );
  assert.throws(
    () =>
      validateProjectBundleForStack(
        baseFiles.map((file) =>
          file.path === "package.json"
            ? {
                ...file,
                content: file.content.replace(
                  '"typescript":"5.8.3"',
                  '"typescript":"99.0.0"',
                ),
              }
            : file,
        ),
        ["check-visible"],
      ),
    /must use certified version/u,
  );
});

test("browser observation protocol remains inspectable when a browser action throws", () => {
  const valid =
    "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = []; const checks = {'check-visible': false}; const observedVisible = document.title.length > 0; try { checks['check-visible'] = observedVisible; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }";
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(valid, ["check-visible"]),
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        valid.replace("finally", "if (true)"),
        ["check-visible"],
      ),
    /finally block/u,
  );
});

test("browser observation rejects literal verdicts and requires measured responsive quality", () => {
  const literalVerdict =
    "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-phone': false}; try { checks['check-phone'] = true; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }";
  assert.throws(
    () => validateBrowserObservationTestSource(literalVerdict, ["check-phone"]),
    /literal success value/u,
  );

  const measuredResponsive = [
    "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-phone': false};",
    "const context = await browser.newContext({ viewport: { width: 375, height: 812 } });",
    "const layout = await page.evaluate(() => ({ noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth, boundedHeight: document.documentElement.scrollHeight <= window.innerHeight * 4 }));",
    "const interactionCount = await page.locator('[data-primary-choice] button').count();",
    "const phoneInteractionDensityOk = interactionCount <= 12;",
    "try { checks['check-phone'] = layout.noOverflow && layout.boundedHeight && phoneInteractionDensityOk; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
  ].join("\n");
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      measuredResponsive,
      ["check-phone"],
      { responsiveCheckIds: ["check-phone"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      measuredResponsive.replace(
        "const phoneInteractionDensityOk = interactionCount <= 12;",
        "const MAX_CONTROL_BOUND = 12; const phoneInteractionDensityOk = interactionCount <= MAX_CONTROL_BOUND;",
      ),
      ["check-phone"],
      { responsiveCheckIds: ["check-phone"] },
    ),
  );
  const collectionMeasuredResponsive = [
    "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-phone': false};",
    "const phoneWidth = 375; const phoneHeight = 667; await page.setViewportSize({ width: phoneWidth, height: phoneHeight });",
    "const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);",
    "const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);",
    "const noHorizontalOverflow = scrollWidth <= clientWidth;",
    "const workflowHeight = await page.evaluate(() => document.querySelector('main').getBoundingClientRect().height);",
    "const workflowFitsReasonably = workflowHeight > 0 && workflowHeight / phoneHeight < 4;",
    "const MAX_CONTROLS_BOUND = 10;",
    "const interactiveCount = await page.evaluate(() => { const main = document.querySelector('main'); const controls = main.querySelectorAll('button, select, input, a'); return controls.length; });",
    "const controlDensityWithinBound = interactiveCount > 0 && interactiveCount <= MAX_CONTROLS_BOUND;",
    "try { checks['check-phone'] = noHorizontalOverflow && workflowFitsReasonably && controlDensityWithinBound; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
  ].join("\n");
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      collectionMeasuredResponsive,
      ["check-phone"],
      { responsiveCheckIds: ["check-phone"] },
    ),
  );
  const responsiveAlias = collectionMeasuredResponsive
    .replace(
      "checks['check-phone'] = noHorizontalOverflow && workflowFitsReasonably && controlDensityWithinBound;",
      "const resp2 = noHorizontalOverflow && workflowFitsReasonably && controlDensityWithinBound; checks['check-phone'] = (visibleRows >= 0) && resp2;",
    );
  const aliasedFiles = ensureCertifiedStackScaffold([
    { path: "tests/aliased.spec.ts", content: responsiveAlias },
  ]);
  const normalizedAlias = aliasedFiles.find(
    (file) => file.path === "tests/aliased.spec.ts",
  ).content;
  assert.match(normalizedAlias, /visibleRows > 0/u);
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      normalizedAlias,
      ["check-phone"],
      { responsiveCheckIds: ["check-phone"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      measuredResponsive.replace(
        "const context = await browser.newContext({ viewport: { width: 375, height: 812 } });",
        "await page.setViewportSize({ width: 375, height: 812 });",
      ),
      ["check-phone"],
      { responsiveCheckIds: ["check-phone"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      measuredResponsive.replace(
        "const context = await browser.newContext({ viewport: { width: 375, height: 812 } });",
        "const phoneWidth = 375; const context = await browser.newContext({ viewport: { width: phoneWidth, height: 812 } });",
      ),
      ["check-phone"],
      { responsiveCheckIds: ["check-phone"] },
    ),
  );
  const declaredViewportResponsive = measuredResponsive
    .replace(
      "const context = await browser.newContext({ viewport: { width: 375, height: 812 } });",
      "const phoneWidth = 375; const phoneHeight = 812; const context = await browser.newContext({ viewport: { width: phoneWidth, height: phoneHeight } });",
    )
    .replace("document.documentElement.clientWidth", "phoneWidth")
    .replace("window.innerHeight", "phoneHeight");
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      declaredViewportResponsive,
      ["check-phone"],
      { responsiveCheckIds: ["check-phone"] },
    ),
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        measuredResponsive.replace("scrollWidth", "contentWidth"),
        ["check-phone"],
        { responsiveCheckIds: ["check-phone"] },
      ),
    /horizontal overflow/u,
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        measuredResponsive.replace(
          "phoneInteractionDensityOk = interactionCount <= 12",
          "phoneInteractionDensityOk = interactionCount >= 0",
        ),
        ["check-phone"],
        { responsiveCheckIds: ["check-phone"] },
      ),
    /vacuous zero-or-more/u,
  );
});

test("accessibility browser checks require real labels and keyboard focus", () => {
  const accessible = [
    "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-access': false};",
    "await page.keyboard.press('Tab'); const focused = await page.evaluate(() => document.activeElement?.tagName === 'BUTTON');",
    "const accessibleLabelCount = await page.locator('button[aria-label], label').count(); const labelsPresent = accessibleLabelCount > 0;",
    "try { checks['check-access'] = focused && labelsPresent; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
  ].join("\n");
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      accessible,
      ["check-access"],
      { accessibilityCheckIds: ["check-access"] },
    ),
  );
  const booleanLabelEvidence = [
    "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-access': false};",
    "let focusCount = 0; let hasLabel = false; await page.keyboard.press('Tab');",
    "const tag = await page.evaluate(() => { const el = document.activeElement; return el ? { label: el.getAttribute('aria-label') || '', focused: el.matches(':focus-visible') } : null; });",
    "if (tag && tag.focused) focusCount++; if (tag && tag.label.length > 0) hasLabel = true;",
    "const accessibleFocus = focusCount > 0 && hasLabel; checks['check-access'] = accessibleFocus;",
    "try { void checks; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
  ].join("\n");
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      booleanLabelEvidence,
      ["check-access"],
      { accessibilityCheckIds: ["check-access"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      accessible.replace(
        "accessibleLabelCount > 0",
        "accessibleLabelCount >= 2",
      ),
      ["check-access"],
      { accessibilityCheckIds: ["check-access"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      accessible.replace(
        "accessibleLabelCount > 0",
        "accessibleLabelCount > 2",
      ),
      ["check-access"],
      { accessibilityCheckIds: ["check-access"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      accessible.replace(
        "accessibleLabelCount > 0",
        "firstSlotLabel.length > 0",
      ),
      ["check-access"],
      { accessibilityCheckIds: ["check-access"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      accessible
        .replaceAll("accessibleLabelCount", "labeledCount")
        .replace("labeledCount > 0", "labeledCount >= 3"),
      ["check-access"],
      { accessibilityCheckIds: ["check-access"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      accessible.replace(
        "focused && labelsPresent",
        "focused\n      && labelsPresent",
      ),
      ["check-access"],
      { accessibilityCheckIds: ["check-access"] },
    ),
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        accessible.replace("await page.keyboard.press('Tab'); ", ""),
        ["check-access"],
        { accessibilityCheckIds: ["check-access"] },
      ),
    /keyboard Tab navigation/u,
  );
});

test("scoped pipeline commands retain their verification-obligation bindings", () => {
  const bindings = {
    "obligation-lock": "dependency-lock",
    "obligation-install": "dependency-install",
    "obligation-typecheck": "type-check",
    "obligation-lint": "lint",
    "obligation-build": "production-build",
    "obligation-browser": "browser-check",
  };
  assert.deepEqual(
    verificationTargetsForProcedure(bindings, "typeCheck", ["fallback"]),
    ["obligation-typecheck"],
  );
  assert.deepEqual(
    verificationTargetsForProcedure(
      bindings,
      "productionBuild",
      ["fallback"],
    ),
    ["obligation-build"],
  );
  assert.deepEqual(
    verificationTargetsForProcedure(bindings, "unknown", ["fallback"]),
    ["fallback"],
  );
});

test("corrected full bundles skip identical generated files and replace changed files", () => {
  const original = {
    path: "tsconfig.json",
    content: JSON.stringify({ compilerOptions: {} }),
  };
  const originalHash = createHash("sha256")
    .update(original.content, "utf8")
    .digest("hex");
  const completedWrite = {
    workUnitId: "mission-a-009-write-tsconfig-json",
    actionType: WorkUnitAction.WRITE_FILE,
    status: WorkUnitStatus.SUCCEEDED,
    inputs: {
      path: original.path,
      contentHash: originalHash,
    },
  };
  assert.equal(
    generatedFileReconciliationAction(original, [completedWrite]),
    "skip",
  );
  assert.equal(
    generatedFileReconciliationAction(
      {
        ...original,
        content: JSON.stringify({
          compilerOptions: { paths: { "@/*": ["./*"] } },
        }),
      },
      [completedWrite],
    ),
    WorkUnitAction.REPLACE_FILE,
  );
  assert.equal(
    generatedFileReconciliationAction(
      { path: "lib/content.ts", content: "export const ready = true;" },
      [completedWrite],
    ),
    WorkUnitAction.WRITE_FILE,
  );
});

test("browser repair admission rejects structurally broken TypeScript before execution", () => {
  assert.equal(
    hasBalancedJavaScriptDelimiters(
      "test('flow', async () => { try { await run(); } finally { report(); } });",
    ),
    true,
  );
  assert.equal(
    hasBalancedJavaScriptDelimiters(
      "test('flow', async () => { try { await run(); });",
    ),
    false,
  );
  assert.equal(
    hasBalancedJavaScriptDelimiters(
      "expect(page.getByRole('heading', { name: /Hi, I'm Bea/i })).toBeVisible();",
    ),
    true,
  );
});

test("browser repair admission rejects repeated or inapplicable replacements before rerunning verification", () => {
  const currentFiles = [
    {
      path: "tests/workflow.spec.ts",
      content:
        "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const runtimeEvidence = ['visible']; const checks = {'check-visible': false}; try { checks['check-visible'] = runtimeEvidence.includes('visible'); } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
    },
  ];
  const valid = {
    path: "tests/workflow.spec.ts",
    replacements: [
      {
        oldText: "const runtimeEvidence = ['visible']",
        newText: "const runtimeEvidence = Array.from(['visible'])",
      },
    ],
  };
  assert.equal(
    validateBrowserRepairProposal({
      structuredOutput: valid,
      currentFiles,
      requiredBrowserCheckIds: ["check-visible"],
    }).files[0].content.includes("Array.from"),
    true,
  );
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: valid,
        currentFiles,
        requiredBrowserCheckIds: ["check-visible"],
        priorStructuredOutputs: [valid],
      }),
    /repeats an earlier one exactly/u,
  );
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          path: "tests/workflow.spec.ts",
          replacements: [
            { oldText: "not present", newText: "replacement" },
          ],
        },
        currentFiles,
        requiredBrowserCheckIds: ["check-visible"],
      }),
    /match exactly once/u,
  );
});

test("browser repair may correct a selector but cannot weaken its verdict", () => {
  const source = [
    "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-cancel': false};",
    "const activeCards = page.locator('.card:has([data-status=\"active\"])');",
    "const cancelledOk = (await activeCards.count()) > 0; const slotReleased = observedSlotsAfter >= observedSlotsBefore;",
    "try { checks['check-cancel'] = cancelledOk && slotReleased; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
  ].join("\n");
  assert.doesNotThrow(() =>
    validateBrowserRepairProposal({
      structuredOutput: {
        path: "tests/workflow.spec.ts",
        replacements: [{
          oldText: ".card:has([data-status=\"active\"])",
          newText: ".card[data-status=\"active\"]",
        }],
      },
      currentFiles: [{ path: "tests/workflow.spec.ts", content: source }],
      requiredBrowserCheckIds: ["check-cancel"],
    }),
  );
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          path: "tests/workflow.spec.ts",
          replacements: [{
            oldText: "cancelledOk && slotReleased",
            newText: "cancelledOk || slotReleased",
          }],
        },
        currentFiles: [{ path: "tests/workflow.spec.ts", content: source }],
        requiredBrowserCheckIds: ["check-cancel"],
      }),
    /changed the verdict formula of 1 contract check/u,
  );
});

test("generated customer facts require recorded customer provenance", () => {
  const files = [
    {
      path: "app/page.tsx",
      content:
        "export default function Page(){return <main><a href='mailto:invented@unprovided-business.com'>Email</a><p>Licensed and insured</p></main>}",
    },
  ];
  assert.throws(
    () =>
      validateCustomerContentIntegrity(files, {
        supplied: [],
        missingBeforeLaunch: ["Contact details", "Trust evidence"],
      }),
    /unsupported customer facts/u,
  );
  assert.doesNotThrow(() =>
    validateCustomerContentIntegrity(files, {
      supplied: [
        {
          kind: "contact-details",
          value: "invented@unprovided-business.com",
          source: "customer-request",
        },
        {
          kind: "trust-evidence",
          value: "Licensed and insured",
          source: "customer-request",
        },
      ],
      missingBeforeLaunch: [],
    }),
  );
});

test("reserved fixture email addresses are not treated as customer contact claims", () => {
  const context = { supplied: [], missingBeforeLaunch: ["Contact details"] };
  assert.doesNotThrow(() =>
    validateCustomerContentIntegrity(
      [{
        path: "app/page.tsx",
        content: [
          "const examples = [",
          "  'test@example.com',",
          "  'user@booking.test',",
          "  'seed@test.invalid',",
          "  'seed@business.internal',",
          "  'seed@invalid.local',",
          "  'seed@business.fictional',",
          "];",
        ].join("\n"),
      }],
      context,
    ),
  );
  assert.throws(
    () =>
      validateCustomerContentIntegrity(
        [{ path: "app/page.tsx", content: "const email = 'owner@real-business.com';" }],
        context,
      ),
    /email address/u,
  );
});

test("customer-fact validation distinguishes dates and SVG dimensions from phone numbers", () => {
  const context = { supplied: [], missingBeforeLaunch: ["Contact details"] };
  assert.doesNotThrow(() =>
    validateCustomerContentIntegrity(
      [{
        path: "app/page.tsx",
        content: "const renewal = '2026-09-15'; const icon = '<svg viewBox=\"0 0 32 32\"></svg>';",
      }],
      context,
    ),
  );
  assert.throws(
    () =>
      validateCustomerContentIntegrity(
        [{ path: "app/page.tsx", content: "Call 512-555-0184 for help." }],
        context,
      ),
    /phone number/u,
  );
});

test("browser repair cannot rewrite an asserted customer outcome", () => {
  const source =
    "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-visible': false}; try { expect(page.getByText('Original promise')).toBeVisible(); } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }";
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          path: "tests/workflow.spec.ts",
          replacements: [
            {
              oldText: "Original promise",
              newText: "Different implementation",
            },
          ],
        },
        currentFiles: [{ path: "tests/workflow.spec.ts", content: source }],
        requiredBrowserCheckIds: ["check-visible"],
      }),
    /removed or altered 1 asserted customer outcome/u,
  );
});

test("ProjectProfile drives wording, architecture, contracts, and verification without core changes", () => {
  const profiles = createProjectProfileService();
  const workloads = certificationProjectFixtures.map((fixture, index) =>
    profiles.create(fixture(`domain-independent-${index + 1}`)),
  );
  const experiences = workloads.map(profiles.experience);
  const drafts = workloads.map(profiles.contractDraft);

  assert.deepEqual(
    workloads.map((profile) => profile.family),
    ["web-application", "marketing-website", "api-service"],
  );
  assert.equal(new Set(experiences.map((item) => item.projectName)).size, 3);
  assert.equal(new Set(experiences.map((item) => item.discoveryPrompt)).size, 3);
  assert.equal(new Set(workloads.map((item) => item.verificationPlan.planId)).size, 3);
  assert.deepEqual(
    workloads.map((item) => item.runtimeAdapterId),
    ["web-runtime", "web-runtime", "web-service-runtime"],
  );
  assert.deepEqual(
    drafts.map((draft) => draft.obligations[0].obligationId),
    ["item-created", "offer-visible", "reservation-created"],
  );
  for (const draft of drafts) {
    assert(draft.obligations.length >= 2);
    for (const obligation of draft.obligations) {
      normalizeAcceptanceCondition(obligation.acceptanceCondition);
    }
  }
});

test("ProjectProfile rejects punctuation-only and placeholder completion claims", () => {
  const punctuationActor = marketingWebsiteFixture("invalid-actor-profile");
  punctuationActor.primaryActors = [":"];
  assert.throws(
    () => normalizeProjectProfile(punctuationActor),
    /real project-specific value/u,
  );

  const placeholderCheck = marketingWebsiteFixture(
    "invalid-obligation-profile",
  );
  placeholderCheck.verificationPlan.checks[0].label = "placeholder";
  assert.throws(
    () => normalizeProjectProfile(placeholderCheck),
    /real project-specific value/u,
  );
});

test("ProjectProfiles require explicit observations and validate alternatives", () => {
  const legacyProfile = marketingWebsiteFixture("legacy-profile");
  const missingUnderstanding = { ...legacyProfile };
  delete missingUnderstanding.observations;
  assert.throws(
    () => normalizeProjectProfile(missingUnderstanding),
    /must contain exactly/u,
  );

  const normalized = normalizeProjectProfile(legacyProfile);
  assert(normalized.observations.length > 0);
  assert.deepEqual(normalized.designAlternatives, []);

  assert.throws(
    () =>
      normalizeProjectProfile({
        ...legacyProfile,
        observations: ["The request serves two distinct audiences."],
        designAlternatives: [
          {
            approach: "A guided journey",
            rationale: "Optimises for first-time visitors.",
            recommended: true,
          },
          {
            approach: "A compact dashboard",
            rationale: "Optimises for frequent returning visitors.",
            recommended: true,
          },
        ],
      }),
    /at most one recommended/u,
  );
});

test("three different profile-generated contracts persist through the existing Mission Ledger", (t) => {
  const ledgerDirectory = mkdtempSync(
    join(tmpdir(), "foundry-domain-independent-contracts-"),
  );
  t.after(() => rmSync(ledgerDirectory, { recursive: true, force: true }));
  const control = openMissionControl({ ledgerDirectory });

  certificationProjectFixtures.forEach((fixture, index) => {
    const missionId = `profile-contract-${index + 1}`;
    control.orchestrator.createMission({
      missionId,
      eventId: `${missionId}-created`,
      causationId: `${missionId}-intent`,
      reason: "Interpreted project requirements received.",
      occurredAt: `2026-07-29T00:00:0${index}.000Z`,
    });
    const profile = control.profiles.create(fixture(missionId));
    const draft = control.profiles.contractDraft(profile);
    const contract = control.contracts.createContract({
      missionId,
      eventId: `${missionId}-contract`,
      causationId: `${missionId}-profile`,
      occurredAt: `2026-07-29T00:01:0${index}.000Z`,
      ...draft,
    });

    assert.equal(contract.contractVersion, 1);
    assert.deepEqual(
      contract.obligations.map((obligation) => obligation.obligationId),
      draft.obligations.map((obligation) => obligation.obligationId),
    );
    assert.equal(
      control.ledger.listEvents(missionId).at(-1).type,
      "REQUIREMENT_CONTRACT_CREATED",
    );
  });
});

test("browser observations accept verification-plan check IDs rather than a fixed domain schema", () => {
  const payloads = [
    { primaryOfferVisible: true, enquirySubmitted: true },
    { reservationCreated: true, reservationRetrieved: false },
    { itemCreated: true, quantityPersists: true },
  ];

  for (const checks of payloads) {
    const parsed = parseBrowserResult(
      `FOUNDRY_BROWSER_RESULT:${JSON.stringify({
        checks,
        consoleErrors: [],
        pageErrors: [],
        captureProbeErrors: [],
      })}`,
    );
    assert.deepEqual(parsed.checks, checks);
  }
  const withDiagnostics = parseBrowserResult(
    `FOUNDRY_BROWSER_RESULT:${JSON.stringify({
      captureProbeErrors: [],
      checks: { "check-design": false },
      diagnostics: {
        "check-design": { colorOk: false, typographyOk: true },
      },
      consoleErrors: [],
      pageErrors: [],
    })}`,
  );
  assert.deepEqual(withDiagnostics.diagnostics, {
    "check-design": { colorOk: false, typographyOk: true },
  });
  assert.throws(
    () =>
      parseBrowserResult(
        'FOUNDRY_BROWSER_RESULT:{"checks":{},"consoleErrors":[],"pageErrors":[],"captureProbeErrors":[]}',
      ),
    /checks/i,
  );
});

test("API-only verification may omit UI checks only when the caller explicitly allows it", () => {
  const stdout =
    'FOUNDRY_BROWSER_RESULT:{"captureProbeErrors":[],"checks":{},"consoleErrors":[],"pageErrors":[]}\n';
  assert.throws(() => parseBrowserResult(stdout), /malformed checks/u);
  assert.deepEqual(
    parseBrowserResult(stdout, { allowEmptyChecks: true }).checks,
    {},
  );
});

test("certification workload remains permanent while two non-inventory fixtures prove dynamic behavior", () => {
  const profiles = createProjectProfileService();
  const certification = profiles.create(
    inventoryCertificationFixture("permanent-certification-regression"),
  );
  const website = profiles.create(
    marketingWebsiteFixture("marketing-domain-proof"),
  );
  const api = profiles.create(restApiFixture("api-domain-proof"));

  assert.equal(certification.family, "web-application");
  assert.equal(website.family, "marketing-website");
  assert.equal(api.family, "api-service");
  assert.equal(
    profiles.contractDraft(api).obligations[0].requiredEvidenceKinds[0],
    ObservationKind.HTTP_RESPONSE_RESULT,
  );
  assert.equal(
    website.verificationPlan.checks[0].acceptanceCondition.type,
    AcceptanceConditionType.BROWSER_CHECK_EQUALS,
  );
});
