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
  generatedFileReconciliationAction,
  hasBalancedJavaScriptDelimiters,
  repairScopeForPath,
  validateGeneratedRepairPath,
  validateGeneratedRepairProposal,
  verificationTargetsForProcedure,
  validateBrowserRepairProposal,
  validateBrowserObservationTestSource,
  validateProjectBundleForStack,
} from "../src/work-plane/production-mission-service.js";
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
    /\bproducts?\b/iu,
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
    /protected generated path/u,
  );
  assert.throws(
    () => validateGeneratedRepairPath("../outside.ts", generatedFiles),
    /unsafe project-relative path/u,
  );
  assert.throws(
    () => validateGeneratedRepairPath("missing/deep/file.ts", generatedFiles),
    /existing generated project directory/u,
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
    /does not change/u,
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
    /repeats an unchanged hypothesis/u,
  );
});

test("browser recovery keeps Runtime Service authoritative and budgets repairs across restarts", () => {
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
  assert.match(source, /browser-repairs-exhausted/u);
  assert.match(source, /Prior evidence-backed browser repairs/u);
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
        "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-visible': true}; try { checks['check-visible'] = true; } finally { process.stdout.write('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
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
    /missing required check/u,
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
    "const captureProbeErrors: string[] = []; const consoleErrors: string[] = []; const pageErrors: string[] = []; const checks = {'check-visible': false}; try { checks['check-visible'] = true; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }";
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
        "const captureProbeErrors = []; const consoleErrors = []; const pageErrors = []; const checks = {'check-visible': false}; try { void checks; } finally { console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({captureProbeErrors, checks, consoleErrors, pageErrors})); }",
    },
  ];
  const valid = {
    path: "tests/workflow.spec.ts",
    replacements: [
      {
        oldText: "'check-visible': false",
        newText: "'check-visible': observedVisible",
      },
    ],
  };
  assert.equal(
    validateBrowserRepairProposal({
      structuredOutput: valid,
      currentFiles,
      requiredBrowserCheckIds: ["check-visible"],
    }).content.includes("observedVisible"),
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
    /repeats an existing hypothesis/u,
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
