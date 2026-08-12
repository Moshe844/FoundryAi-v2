import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  ProductionComplexity,
  foundryObservationHarness,
  isFoundryOwnedBrowserHealthObligation,
  obligationRequiresAuthenticationErrorProof,
  obligationRequiresAuthenticatedSurface,
  obligationRequiresCredentialLoginProof,
  productionBrowserRepairPolicy,
  productionPerformancePolicy,
  productionRepairModelTimeoutMs,
  productionRepairBudgets,
  responsiveBrowserCheckIdsForContract,
  validateBrowserObservationTestSource,
} from "../src/work-plane/production-mission-service.js";

test("production repair budgets allow bounded evidence-backed recovery", () => {
  assert.deepEqual(productionRepairBudgets(), {
    generationCorrectionCalls: 0,
    procedureRepairCalls: 0,
    browserRepairCalls: 4,
    designFidelityRepairCalls: 4,
    runtimeRestarts: 2,
  });
  assert.deepEqual(productionRepairBudgets({ approvedPrototype: true }), {
    generationCorrectionCalls: 2,
    procedureRepairCalls: 2,
    browserRepairCalls: 4,
    designFidelityRepairCalls: 4,
    runtimeRestarts: 2,
  });
});

test("procedure repair rounds can correct a cross-file defect without charging per file", async () => {
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  const procedureRepair = source.slice(
    source.indexOf("const priorRepairs = execution"),
    source.indexOf("async function rehydrateRestoredWorkspace"),
  );
  assert.match(
    procedureRepair,
    /priorRepairCalls\.length >= repairBudgets\.procedureRepairCalls/u,
  );
  assert.doesNotMatch(
    procedureRepair,
    /priorRepairs\.length >= repairBudgets\.procedureRepairCalls/u,
  );
  assert.match(
    procedureRepair,
    /return a files array containing the complete corrected content of every implicated/u,
  );
  assert.match(procedureRepair, /validateGeneratedRepairSet\(\{/u);
  assert.match(procedureRepair, /for \(const repairFile of repairFiles\)/u);
});

test("production time and repair policy follows product complexity", () => {
  const simple = productionPerformancePolicy({
    profile: {
      primaryJourneys: [{ id: "calculate" }],
      secondaryJourneys: [{ id: "reset" }],
      requiredSurfaces: [{ id: "calculator" }],
      primaryActors: [{ id: "visitor" }],
    },
    approvedContract: {
      productBlueprint: {
        primaryWorkflows: [{ id: "calculate" }],
        supportingWorkflows: [{ id: "reset" }],
        requiredSurfaces: [{ id: "calculator" }],
      },
      audiences: [{ id: "visitor" }],
      acceptedRecommendations: [],
      acceptanceObligations: Array.from({ length: 15 }, (_, index) => ({
        obligationId: `obligation-${index + 1}`,
      })),
    },
  });
  assert.deepEqual(simple, {
    complexity: ProductionComplexity.SIMPLE,
    targetDurationMs: 120_000,
    browserCheckBudgetMs: 8_000,
    browserVerificationBudgetMs: 60_000,
    browserObservationAttempts: 2,
    browserRepairCalls: 1,
    designFidelityRepairCalls: 1,
    runtimeRestarts: 2,
  });
  assert.deepEqual(
    productionRepairBudgets({ approvedPrototype: true, performancePolicy: simple }),
    {
      generationCorrectionCalls: 2,
      procedureRepairCalls: 2,
      browserRepairCalls: 1,
      designFidelityRepairCalls: 1,
      runtimeRestarts: 2,
    },
  );

  const focusedAuthentication = productionPerformancePolicy({
    profile: {
      primaryJourneys: [
        "A visitor creates an account.",
        "A returning user signs in, refreshes the session, and signs out.",
        "A user corrects invalid credentials.",
      ],
      secondaryJourneys: [],
      primaryActors: ["visitor", "returning user"],
    },
    approvedContract: {
      productBlueprint: {
        primaryWorkflows: [
          "Create an account",
          "Sign in and sign out",
          "Recover from an access error",
        ],
        supportingWorkflows: [],
        requiredSurfaces: Array.from({ length: 5 }, (_, id) => ({ id })),
      },
      audiences: ["visitor", "returning user"],
      acceptedRecommendations: [],
      acceptanceObligations: Array.from({ length: 13 }, (_, index) => ({
        statement: `Authentication obligation ${index + 1}`,
      })),
    },
  });
  assert.equal(focusedAuthentication.complexity, ProductionComplexity.SIMPLE);
  assert.equal(focusedAuthentication.targetDurationMs, 120_000);
  assert.equal(focusedAuthentication.browserVerificationBudgetMs, 60_000);
  assert.equal(productionRepairModelTimeoutMs(focusedAuthentication), 20_000);
  assert.deepEqual(
    productionRepairBudgets({
      performancePolicy: focusedAuthentication,
      stateful: true,
    }),
    {
      generationCorrectionCalls: 1,
      procedureRepairCalls: 1,
      browserRepairCalls: 1,
      designFidelityRepairCalls: 1,
      runtimeRestarts: 2,
    },
  );

  const complex = productionPerformancePolicy({
    profile: {
      primaryJourneys: Array.from({ length: 9 }, (_, id) => ({ id })),
      secondaryJourneys: Array.from({ length: 5 }, (_, id) => ({ id })),
      requiredSurfaces: Array.from({ length: 18 }, (_, id) => ({ id })),
      primaryActors: Array.from({ length: 6 }, (_, id) => ({ id })),
    },
  });
  assert.equal(complex.complexity, ProductionComplexity.COMPLEX);
  assert.equal(complex.targetDurationMs, 720_000);
  assert.equal(complex.browserCheckBudgetMs, 15_000);
  assert.equal(complex.browserVerificationBudgetMs, 180_000);
  assert.equal(complex.browserObservationAttempts, 6);

  const compactStateful = productionPerformancePolicy({
    profile: {
      primaryJourneys: [{ id: "create-account" }, { id: "manage-todos" }],
      secondaryJourneys: [{ id: "return-after-refresh" }],
      requiredSurfaces: [{ id: "auth" }, { id: "todo-dashboard" }],
      primaryActors: [{ id: "member" }],
    },
    approvedContract: {
      productBlueprint: {
        primaryWorkflows: [{ id: "create-account" }, { id: "manage-todos" }],
        supportingWorkflows: [{ id: "return-after-refresh" }],
        requiredSurfaces: [{ id: "auth" }, { id: "todo-dashboard" }],
      },
      audiences: [{ id: "member" }],
      acceptedRecommendations: [],
      acceptanceObligations: [
        { statement: "A member can create an account and sign in again." },
        { statement: "Saved todo lists remain after a browser refresh." },
      ],
    },
  });
  assert.equal(compactStateful.complexity, ProductionComplexity.SIMPLE);
  assert.equal(compactStateful.browserCheckBudgetMs, 8_000);
  assert.equal(compactStateful.browserVerificationBudgetMs, 60_000);
  assert.equal(compactStateful.browserObservationAttempts, 2);
  assert.equal(compactStateful.browserRepairCalls, 1);
  assert.equal(compactStateful.designFidelityRepairCalls, 1);
  assert.equal(productionRepairModelTimeoutMs(compactStateful), 20_000);
  assert.deepEqual(
    productionRepairBudgets({
      performancePolicy: compactStateful,
      stateful: true,
    }),
    {
      generationCorrectionCalls: 1,
      procedureRepairCalls: 1,
      browserRepairCalls: 1,
      designFidelityRepairCalls: 1,
      runtimeRestarts: 2,
    },
  );
});

test("browser observation admission rejects reusable identities and ambiguous strict locators", () => {
  const harness = foundryObservationHarness(["check-ready"]);
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${harness}\nconst accountEmail=\`person+${Date.now()}@example.test\`;`,
        ["check-ready"],
      ),
    /declares persistent identity "accountEmail" once at module load/u,
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${harness}\nasync function act(page){await page.locator('.primary').click();}`,
        ["check-ready"],
      ),
    /unscoped class locator/u,
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${harness}\nasync function submit(page){await page.getByRole('form').getByRole('button',{name:'Create account',exact:true}).click();}`,
        ["check-ready"],
      ),
    /unnamed HTML form/u,
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      `${harness}\nasync function submit(page){await page.locator('form').getByRole('button',{name:'Create account',exact:true}).click();}`,
      ["check-ready"],
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      `${harness}\nasync function measure(page){return page.locator('.snapshot').evaluate((element)=>getComputedStyle(element).backgroundColor);}`,
      ["check-ready"],
    ),
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${harness}\nasync function create(page){await page.getByLabel('Todo').fill('One thing');}`,
        ["check-ready"],
      ),
    /without exact matching/u,
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${harness}\nexport const obligationChecks = { "check-ready": async ({ page }) => { const heading = page.getByRole("heading", { name: "Dashboard" }); const passed = await heading.isVisible(); return { passed, diagnostics: { dashboardVisible: passed } }; } };`,
        ["check-ready"],
        { authenticatedCheckIds: ["check-ready"] },
      ),
    /does not establish its own account\/session/u,
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      `${harness}\nconst uniqueEmail=(suffix:string)=>\`person-\${suffix}-\${Date.now()}-\${Math.random()}@test.dev\`;const enroll=async(context:any):Promise<{email:string;password:string}>=>{const email=uniqueEmail('enroll');const password='saved-password';await context.page.goto('/');await context.page.getByLabel('Email address',{exact:true}).fill(email);await context.page.getByRole('button',{name:'Create account',exact:true}).click();await context.page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();return{email,password}};\nexport const obligationChecks = { "check-ready": async (context): Promise<any> => { await enroll(context); const heading = context.page.getByRole("heading", { name: "Dashboard" }); const passed = await heading.isVisible(); return { passed, diagnostics: { dashboardVisible: passed } }; } };`,
      ["check-ready"],
      { authenticatedCheckIds: ["check-ready"] },
    ),
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      `${harness}\nconst enroll=async(context:any):Promise<void>=>{const email=\`person${Date.now()}${Math.random()}@test.dev\`;await context.page.getByLabel('Email address',{exact:true}).fill(email);await context.page.getByRole('button',{name:'Create account',exact:true}).click()};const check=(work:(context:any)=>Promise<boolean>)=>async(context:any)=>({passed:await work(context),diagnostics:{}});export const obligationChecks={"check-ready":check(async context=>{await enroll(context);return await context.page.getByRole('heading',{name:'Dashboard'}).isVisible()})};`,
      ["check-ready"],
      { authenticatedCheckIds: ["check-ready"] },
    ),
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${harness}\nexport const obligationChecks = {}; for (const id of ["check-ready"]) obligationChecks[id] = async (context) => ({ passed: await context.page.locator("main").isVisible(), diagnostics: {} });`,
        ["check-ready"],
        { authenticatedCheckIds: ["check-ready"] },
      ),
    /generated through an opaque shared loop/u,
  );
  const twoCheckHarness = foundryObservationHarness(["check-one", "check-two"]);
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${twoCheckHarness}\nexport const obligationChecks = {}; for (const id of ["check-one", "check-two"]) obligationChecks[id] = async (context) => ({ passed: await context.page.locator("main").isVisible(), diagnostics: {} });`,
        ["check-one", "check-two"],
        { authenticatedCheckIds: ["check-one", "check-two"] },
      ),
    /Browser check "check-one, check-two"/u,
  );
  assert.throws(
    () =>
      validateBrowserObservationTestSource(
        `${harness}\nconst enroll=async(context)=>{await context.page.getByRole('button',{name:'Create account'}).click()}; export const obligationChecks={"check-login":async(context)=>{await enroll(context);await context.page.getByRole('button',{name:'Sign out'}).click();await context.page.getByRole('button',{name:'Sign in'}).click();const passed=await context.page.getByRole('heading',{name:'Dashboard'}).isVisible();return{passed,diagnostics:{}}}};`,
        ["check-login"],
        {
          authenticatedCheckIds: ["check-login"],
          loginCheckIds: ["check-login"],
        },
      ),
    /promises sign-in but does not submit saved credentials/u,
  );
  assert.doesNotThrow(() =>
    validateBrowserObservationTestSource(
      `${harness}\nconst enroll=async(context)=>{const email=\`person${Date.now()}${Math.random()}@test.dev\`,password='saved-password';await context.page.getByLabel('Email address',{exact:true}).fill(email);await context.page.getByLabel('Password',{exact:true}).fill(password);await context.page.getByRole('button',{name:'Create account',exact:true}).click();return{email,password}};const login=async(context,account)=>{await context.page.getByRole('button',{name:'Sign out',exact:true}).click();await context.page.getByLabel('Email address',{exact:true}).fill(account.email);await context.page.getByLabel('Password',{exact:true}).fill(account.password);await context.page.getByRole('button',{name:'Sign in',exact:true}).click()};export const obligationChecks={"check-login":async(context)=>{const account=await enroll(context);await login(context,account);const passed=await context.page.getByRole('heading',{name:'Dashboard',exact:true}).isVisible();return{passed,diagnostics:{}}}};`,
      ["check-login"],
      {
        authenticatedCheckIds: ["check-login"],
        loginCheckIds: ["check-login"],
      },
    ),
  );
});

test("login proof classification does not turn registration outcomes into login journeys", () => {
  assert.equal(
    obligationRequiresAuthenticatedSurface(
      "Durable Authentication preserves accessible keyboard behavior on its login and signup forms.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresAuthenticatedSurface(
      "A person reaches the authenticated account area after login.",
    ),
    true,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "A person can sign up and an account exists afterward so they can sign in.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "A person can sign up with an account available for future login.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "A registered person can log in and reaches their dashboard.",
    ),
    true,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "A person can sign up, sign out, and then sign in with saved credentials.",
    ),
    true,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "Secure Account Access implements the approved composition: Centered card with a clear sign-in and sign-up switch.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "Secure Login and Signup satisfies the approved accessibility design requirements: Keyboard-complete navigation and programmatic labels.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "People can switch clearly between create-account and sign-in modes on desktop and mobile.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "A valid sign-in creates a server-validated session that remains active after refresh.",
    ),
    true,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "Responsive Account Access preserves its approved balanced layout with an obvious sign-in/create-account switch.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "Submitting valid credentials creates a server-validated session that remains authenticated after refresh.",
    ),
    true,
  );
});

test("login proof classification treats a responsive sign-in/signup mode switch as navigation", () => {
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "The desktop page presents responsive two-panel sign-in and create-account modes with an obvious mode switch.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "Submitting valid credentials in sign-in mode creates an authenticated session.",
    ),
    true,
  );
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "A person can clearly choose sign-in or create-account mode in the responsive two-panel page.",
    ),
    false,
  );
});

test("login proof classification does not turn a Foundry-derived approved design composite into login", () => {
  assert.equal(
    obligationRequiresCredentialLoginProof(
      "Responsive Authentication Page preserves its approved Focused authentication workflow with visible validation and session status feedback.; Prioritize credential entry, errors, and the primary action on mobile.; Keep sign-in and create-account modes visibly switchable without page ambiguity.; and accessible keyboard behavior.",
    ),
    false,
  );
});

test("authentication error proof classification selects error outcomes, not accessibility prose", () => {
  assert.equal(
    obligationRequiresAuthenticationErrorProof(
      "Invalid, incomplete, duplicate, and incorrect credentials produce useful server-validated errors beside the relevant form.",
    ),
    true,
  );
  assert.equal(
    obligationRequiresAuthenticationErrorProof(
      "All authentication controls are keyboard usable with visible focus, labels, and accessible error announcements.",
    ),
    false,
  );
  assert.equal(
    obligationRequiresAuthenticationErrorProof(
      "Validation errors are announced beside the affected field.",
    ),
    true,
  );
  const rejectedAuthentication =
    "Invalid authentication attempts show a clear error without entering the dashboard.";
  assert.equal(
    obligationRequiresAuthenticationErrorProof(rejectedAuthentication),
    true,
  );
  assert.equal(
    obligationRequiresAuthenticatedSurface(rejectedAuthentication),
    false,
    "a signed-out rejection check must not be forced to create a session",
  );
});

test("Foundry computes whole-run browser health from owned evidence", () => {
  const statement =
    "Personal Todo Dashboard completes its primary browser workflow without blocking browser errors.";
  assert.equal(isFoundryOwnedBrowserHealthObligation(statement), true);
  assert.equal(
    isFoundryOwnedBrowserHealthObligation(
      "A registered person can log in and reaches their dashboard.",
    ),
    false,
  );
  const harness = foundryObservationHarness(
    ["workflow-check", "browser-health"],
    { foundryOwnedBrowserHealthCheckIds: ["browser-health"] },
  );
  assert.match(
    harness,
    /const foundryOwnedBrowserHealthCheckIds = \["browser-health"\]/u,
  );
  assert.match(
    harness,
    /checks\[id\] = workflowsPassed && noBlockingBrowserErrors/u,
  );
  assert.match(harness, /viewport: \{ width: 1280, height: 900 \}/u);
  assert.doesNotMatch(harness, /checks\[id\] = true/u);
});

test("a dedicated responsive obligation owns phone-layout proof", () => {
  const obligations = [
    {
      obligationId: "combined-design",
      statement:
        "The dashboard preserves its approved spacious direction on narrow screens and accessible keyboard behavior.",
    },
    {
      obligationId: "responsive-priority",
      statement:
        "The dashboard implements the approved responsive priority: collapse cards into a vertical sequence.",
    },
  ];
  const bindings = {
    "combined-design": "browser-check",
    "responsive-priority": "browser-check",
  };
  assert.deepEqual(
    responsiveBrowserCheckIdsForContract(obligations, bindings),
    ["responsive-priority"],
  );
  assert.deepEqual(
    responsiveBrowserCheckIdsForContract(
      [
        {
          obligationId: "only-responsive",
          statement: "The interface works on narrow screens without horizontal overflow.",
        },
      ],
      { "only-responsive": "browser-check" },
    ),
    ["only-responsive"],
  );
});

test("production generation and browser repair guard authenticated session state", async () => {
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /late signed-out response from overwriting a successful sign-up or sign-in/u);
  assert.match(source, /Every check that observes a protected or authenticated surface must establish its own unique account\/session/u);
  assert.match(source, /Shared evidence is never proof of a protected post-authentication surface/u);
  assert.match(source, /repair tests\/foundry-checks\.ts so that check establishes its own fresh session/u);
  assert.equal(
    [...source.matchAll(/authenticatedCheckIds: authenticatedBrowserCheckIds/gu)].length,
    5,
  );
  assert.equal(
    [...source.matchAll(/loginCheckIds: loginBrowserCheckIds/gu)].length,
    4,
  );
});

test("approved-design semantic admission stays inside the bounded correction loop", async () => {
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  const generationSection = source.slice(
    source.indexOf("const generationRequestId"),
    source.indexOf("const bundle ="),
  );

  assert.match(
    generationSection,
    /for \(;;\) \{[\s\S]*validateContractBoundMissionPlan\([\s\S]*catch \(error\)/u,
  );
  assert.doesNotMatch(
    generationSection,
    /structuredOutputValidator:\s*approvedContract/u,
  );
});

test("browser observation and design fidelity repairs have independent budgets", () => {
  const browser = productionBrowserRepairPolicy(
    "The structured browser result did not contain exactly the required browser-check obligation IDs.",
  );
  const fidelity = productionBrowserRepairPolicy(
    "Production design fidelity failed against the approved live prototype: typography.",
  );

  // Both repair loops converge once their failures carry measurements: browser
  // checks fell 8 then 5 then 3, fidelity aspects 6 then 5 then 2, and a budget
  // of two truncated each descent while it was still making progress.
  assert.deepEqual(browser, {
    designFidelity: false,
    requestSegment: "browser-repair",
    maxCalls: 4,
  });
  assert.deepEqual(fidelity, {
    designFidelity: true,
    requestSegment: "design-fidelity-repair",
    maxCalls: 4,
  });
  assert.equal(browser.maxCalls, fidelity.maxCalls);
  assert.notEqual(browser.requestSegment, fidelity.requestSegment);

  const combined = productionBrowserRepairPolicy(
    [
      "The following real browser checks were false: obligation-001.",
      "Production design fidelity failed against the approved live prototype: spacing.",
    ].join("\n"),
    {
      nonFidelityFailureOutstanding: true,
      repairBudgets: {
        browserRepairCalls: 2,
        designFidelityRepairCalls: 2,
      },
    },
  );
  assert.deepEqual(combined, {
    designFidelity: false,
    requestSegment: "browser-repair",
    maxCalls: 2,
  });
});

test("a patch rejected before it touches a file does not spend the repair budget", async () => {
  // The real failure: of four paid fidelity attempts, two were rejected for a
  // mechanical patch mistake — one oldText that no longer matched, one set of
  // replacements that changed nothing — and the budget counted them as if the
  // repair had reasoned wrongly. The build ended at the limit having applied
  // only two corrections, with the approved design still unmatched.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  const budgetGuard = source.slice(
    source.indexOf("const repairCallsSoFar = models"),
    source.indexOf("repair = await requestBrowserRepair"),
  );

  assert.match(
    budgetGuard,
    /appliedRepairs = repairCallsSoFar\.filter\(\s*\(call\) => call\.status === "SUCCEEDED",\s*\)\.length/u,
    "the budget must count corrections that were actually applied",
  );
  assert.match(
    budgetGuard,
    /appliedRepairs >= repairPolicy\.maxCalls/u,
    "the budget must come from the failing loop's own policy, not one constant",
  );
  // Uncounted rejections still need a ceiling of their own.
  assert.match(
    budgetGuard,
    /repairCallsSoFar\.length >=\s*repairPolicy\.maxCalls \* MAX_REPAIR_PROPOSALS_PER_ROUND/u,
  );
});

test("a rejected patch names the text that failed and why", async () => {
  const { validateBrowserRepairProposal } = await import(
    "../src/work-plane/production-mission-service.js"
  );
  const currentFiles = [
    { path: "app/globals.css", content: "body{color:#333;font-family:serif}" },
  ];

  // Absent text: the retry needs to know which edit was unusable, not only
  // that one of them was.
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          files: [
            {
              path: "app/globals.css",
              replacements: [
                { oldText: "font-weight:700", newText: "font-weight:400" },
              ],
            },
          ],
        },
        currentFiles,
        requiredBrowserCheckIds: [],
      }),
    /never appears — oldText: "font-weight:700"[\s\S]*Copy oldText verbatim/u,
  );

  // A no-op patch says so plainly rather than reporting a count.
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          files: [
            {
              path: "app/globals.css",
              replacements: [{ oldText: "color:#333", newText: "color:#333" }],
            },
          ],
        },
        currentFiles,
        requiredBrowserCheckIds: [],
      }),
    /do not change the current file in app\/globals\.css/u,
  );
});

test("a proven application is delivered even when its design falls short", async () => {
  // Of thirty recorded failures on the approved-prototype path, nine had every
  // required browser check observed true — add an item, update a quantity,
  // delete with confirmation, survive a refresh, all proven in a real browser —
  // and the mission was failed anyway because the produced layout was not close
  // enough to the approved prototype. That is working software destroyed over a
  // geometry distance, and it is the single largest cause of "Foundry built
  // nothing" on that path.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  // Behaviour is what must hold: every functional workflow check true, and no
  // failure outstanding other than fidelity. Derived approved-design checks
  // are resolved by the prototype comparator, not counted a second time here.
  assert.match(
    source,
    /const behaviourProven =\s*\n\s*browserResult !== undefined &&\s*\n\s*!nonFidelityFailureOutstanding &&\s*\n\s*functionalBrowserChecks\.every\(\s*\n\s*\(checkId\) => browserResult\.checks\[checkId\] === true,\s*\n\s*\);/u,
    "acceptance must require every functional browser check and no non-fidelity failure",
  );

  // Only a design-fidelity observation may be waived. Anything else — a false
  // check, a console error, an unparseable result — still fails the mission.
  assert.match(
    source,
    /nonFidelityFailureOutstanding = observationFailures\.some\(\s*\n\s*\(failure\) =>\s*\n\s*!\/\^Production design fidelity failed/u,
  );

  // Both places that previously destroyed the build now deliver it. The spent
  // budget path first restores browser-created data, then accepts the proven
  // behavior with an explicit fidelity shortfall.
  const budgetGate = source.slice(
    source.indexOf("if (priorRepairCalls.length >= repairPolicy.maxCalls)"),
    source.indexOf("const repairsWereAttempted"),
  );
  assert.match(budgetGate, /if \(behaviourProven\) \{[\s\S]*acceptWithShortfall/u);

  const finalization = source.slice(
    source.indexOf("const latestObservedRuntime = runtime.getSession"),
    source.indexOf(
      "runtime.captureBrowserVerification",
      source.indexOf("const latestObservedRuntime = runtime.getSession"),
    ) + "runtime.captureBrowserVerification".length,
  );
  assert.match(finalization, /browser\.preWorkCheckpointId/u);
  assert.match(finalization, /session = await startRuntime\(\)/u);
  assert.ok(
    finalization.indexOf("browser.preWorkCheckpointId") <
      finalization.indexOf("session = await startRuntime()"),
  );
  assert.ok(
    finalization.indexOf("session = await startRuntime()") <
      finalization.indexOf("runtime.captureBrowserVerification"),
  );

  const { ObservationAction, browserObservationDecision } = await import(
    "../src/domain/browser-observation-policy.js"
  );
  const stalledButProven = browserObservationDecision({
    attempt: 2,
    maxAttempts: 6,
    outstandingChecks: 0,
    outstandingFidelityAspects: 5,
    previousOutstanding: 5,
    stalledRounds: 1,
    behaviourProven: true,
  });
  assert.equal(stalledButProven.action, ObservationAction.DELIVER_WITH_SHORTFALL);

  // Acceptance must not move the mission's state. It is already EXECUTING and
  // stays there until verification; asking the orchestrator for
  // EXECUTING -> EXECUTING is rejected outright, and that killed a build whose
  // application had been proven and was about to be delivered.
  const acceptanceStart = source.indexOf("const acceptWithShortfall =");
  const acceptance = source.slice(
    acceptanceStart,
    source.indexOf("\n        };", acceptanceStart) + "\n        };".length,
  );
  assert.doesNotMatch(
    acceptance,
    /orchestrator\.transition\(/u,
    "accepting a shortfall must not transition the mission's state",
  );
  assert.match(acceptance, /observationVerified = true/u);

  // The shortfall must be recorded as evidence and named in the verdict, so a
  // delivered project is never silently passed off as fully matching.
  assert.match(source, /\$\{missionId\}-design-fidelity-shortfall/u);
  assert.match(
    source,
    /The approved design was matched except for: \$\{designFidelityShortfall\.failedAspects\.join\(", "\)/u,
  );
});

test("browser observation is bounded by complexity and progress", async () => {
  // A ceiling of four came from builds recorded before repairs could correct
  // every file a failure spanned. Once they could, a build converged 5 then 5
  // then 1 outstanding checks, passed them all, and was cut off at a single
  // failing check because the count ran out — the same mistake the fidelity
  // budget once made of stopping a correction that was still working.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /const MAX_BROWSER_OBSERVATION_ATTEMPTS = 6;/u);
  assert.match(
    source,
    /attempt < performancePolicy\.browserObservationAttempts/u,
  );
  assert.match(source, /maxAttempts: performancePolicy\.browserObservationAttempts/u);
  // The loop must take its decision from the shared policy, so the replay
  // harness measures the same reasoning the customer's build will use.
  assert.match(source, /const decision = browserObservationDecision\(\{/u);
  assert.match(source, /decision\.action === ObservationAction\.HALT_STALLED/u);

  // What actually protects the clock is the stall detector: two consecutive
  // rounds that reduce nothing ends the build, so a generous ceiling costs a
  // failing build nothing while letting a converging one finish.
  const { replayObservationTrajectory } = await import(
    "../src/domain/browser-observation-policy.js"
  );
  const flat = [
    { checks: 4, fidelity: 0 },
    { checks: 4, fidelity: 0 },
    { checks: 4, fidelity: 0 },
  ];
  assert.equal(replayObservationTrajectory(flat, { maxAttempts: 6 }).outcome, "failed");
  const reducing = [
    { checks: 9, fidelity: 0 },
    { checks: 5, fidelity: 0 },
    { checks: 2, fidelity: 0 },
    { checks: 1, fidelity: 0 },
  ];
  assert.equal(
    replayObservationTrajectory(reducing, { maxAttempts: 6 }).outcome,
    "still-converging",
    "a build that keeps reducing failures is never cut off by the ceiling",
  );

  // A check that was true last round and is false now was broken by the
  // correction just applied, and the repair must be told that rather than
  // diagnosing a defect that did not exist a round ago.
  assert.match(source, /previouslyPassingCheckIds\.has\(checkId\)/u);
  assert.match(
    source,
    /broke \$\{nowFalse\.length\} check\(s\) that were passing/u,
  );
  assert.match(source, /do not treat these as pre-existing defects/u);
});

test("functional and approved-design diagnostics are collected in one browser round", async () => {
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  const fidelityGate = source.slice(
    source.indexOf("if (\n              exactChecks"),
    source.indexOf("if (typeof prototypeFidelity?.verify", source.indexOf("if (\n              exactChecks")),
  );
  assert.match(fidelityGate, /exactChecks/u);
  assert.match(fidelityGate, /blockingErrors\.length === 0/u);
  assert.doesNotMatch(fidelityGate, /observationFailures\.length === 0/u);
});

test("a repair re-verifies what it changed, and only once", async () => {
  // Measured on a twelve-minute build: browser verification was 93 seconds
  // across all four rounds, while re-verifying repairs took about 145. Every
  // correction ran tsc --noEmit, then eslint, then next build — and next build
  // type-checks and lints the project itself.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  // Ask what changed, not what did not. A multi-file repair may correct a
  // Playwright spec and a stylesheet together, and reading "some file was a
  // test" as "nothing shipped changed" skipped verification on a real edit.
  assert.match(
    source,
    /const changesApplicationArtifact = acceptedRepair\.files\.some\(\s*\n\s*\(file\) => !file\.repairsTestSource && !file\.repairsPlaywrightConfig,\s*\n\s*\);/u,
    "the build must be required when any shipped artifact changed",
  );

  // Type-check and lint run again only when an obligation reads their own
  // evidence, since skipping those would leave a verdict resolving from a run
  // that predates the repair.
  const block = source.slice(
    source.indexOf("const boundToOwnObligation ="),
    source.indexOf("let brokenByRepair"),
  );
  assert.match(block, /boundToOwnObligation\("typeCheck"\)/u);
  assert.match(block, /boundToOwnObligation\("lint"\)/u);
  assert.match(block, /\["productionBuild", 600_000\],\s*\n\s*\];/u);

  // A repair touching only Playwright files skips the pipeline entirely: since
  // tests are excluded from the build, they cannot affect it.
  const testOnly = {
    files: [
      { path: "tests/foundry-checks.ts", repairsTestSource: true, repairsPlaywrightConfig: false },
    ],
  };
  const mixed = {
    files: [
      { path: "tests/foundry-checks.ts", repairsTestSource: true, repairsPlaywrightConfig: false },
      { path: "app/globals.css", repairsTestSource: false, repairsPlaywrightConfig: false },
    ],
  };
  const changed = (repair) =>
    repair.files.some((file) => !file.repairsTestSource && !file.repairsPlaywrightConfig);
  assert.equal(changed(testOnly), false, "a test-only repair needs no build");
  assert.equal(changed(mixed), true, "a mixed repair still needs the build");

  const { validateBrowserRepairProposal } = await import(
    "../src/work-plane/production-mission-service.js"
  );
  const repairedCheckModule = validateBrowserRepairProposal({
    structuredOutput: {
      files: [
        {
          path: "tests/foundry-checks.ts",
          replacements: [
            {
              oldText: "locator('.missing').isVisible()",
              newText: "getByRole('heading', { name: 'Ready' }).isVisible()",
            },
          ],
        },
      ],
    },
    currentFiles: [
      {
        path: "tests/foundry-checks.ts",
        content: [
          "type C={page:any;expect:any;responsiveEvidence:Record<string,boolean>;accessibilityEvidence:Record<string,boolean>};",
          "export const obligationChecks:Record<string,(context:C)=>Promise<{passed:boolean;diagnostics:Record<string,boolean|string|number|null>}>>={",
          "'check-ready':async({page}:C)=>{const visible=await page.locator('.missing').isVisible();return{passed:visible,diagnostics:{visible}}},",
          "};",
        ].join("\n"),
      },
    ],
    requiredBrowserCheckIds: ["check-ready"],
  });
  assert.equal(repairedCheckModule.files[0].repairsTestSource, true);
  assert.equal(changed(repairedCheckModule), false);
});

test("a rejected repair names which protocol rule it broke", async () => {
  // Six conditions once shared one sentence — "violated the structured
  // observation protocol" — naming no condition, no file and no line. Three
  // proposals died against it in a row and the mission ended after a single
  // observation, four minutes in, with the application's real failures never
  // touched. This is the same defect as every other mute gate fixed today, in
  // the one message that had not been reached.
  const { validateBrowserRepairProposal } = await import(
    "../src/work-plane/production-mission-service.js"
  );
  const propose = (path, content, replacements) =>
    validateBrowserRepairProposal({
      structuredOutput: { files: [{ path, replacements }] },
      currentFiles: [{ path, content }],
      requiredBrowserCheckIds: [],
    });

  // An edit that empties the file says so, and names the file.
  assert.throws(
    () =>
      propose("app/page.tsx", "export default function P(){return null}", [
        { oldText: "export default function P(){return null}", newText: "" },
      ]),
    /would leave app\/page\.tsx empty/u,
  );

  // A repair that unbalances the source reports the position, not a category.
  assert.throws(
    () =>
      propose("app/page.tsx", "export default function P(){return null}", [
        { oldText: "return null}", newText: "return null" },
      ]),
    /has unbalanced delimiters: the "\{" opened at line 1 column \d+ is never closed/u,
  );

  // Each Playwright configuration rule states itself and why it exists.
  const config = 'export default { use: { baseURL: process.env.FOUNDRY_PREVIEW_URL }, projects: [{ use: { channel: "chrome" } }] };';
  assert.throws(
    () =>
      propose("playwright.config.ts", config, [
        { oldText: "process.env.FOUNDRY_PREVIEW_URL", newText: '"http://localhost:3000"' },
      ]),
    /must read its base URL from FOUNDRY_PREVIEW_URL/u,
  );
  assert.throws(
    () =>
      propose("playwright.config.ts", config, [
        { oldText: 'projects:', newText: 'webServer: { command: "npm start" }, projects:' },
      ]),
    /may not declare webServer/u,
  );

  // A valid repair to the same file is still accepted.
  assert.doesNotThrow(() =>
    propose("playwright.config.ts", config, [
      { oldText: 'channel: "chrome"', newText: 'channel: "chrome", headless: true' },
    ]),
  );
});

test("a repair that cannot write a patch is asked for whole files instead", async () => {
  // Two consecutive builds died here with four minutes of correct work already
  // done: three unusable patches end a mission, and neither death was a wrong
  // diagnosis — the search/replace format defeated the model. Every oldText
  // must still match the current content exactly once, and when it does not
  // there is nothing to apply. The last attempt of a round now asks for the
  // corrected file instead, which cannot fail to apply.
  const { patchFromWholeFileRepair, validateBrowserRepairProposal } =
    await import("../src/work-plane/production-mission-service.js");

  const currentFiles = [
    { path: "app/page.tsx", content: "export default function P(){return <main/>}" },
  ];
  const wholeFile = {
    files: [
      {
        path: "app/page.tsx",
        content: "export default function P(){return <main><h1>Stock</h1></main>}",
      },
    ],
  };

  // A whole-file proposal becomes the patch shape the rest of the loop
  // understands: one replacement of the entire file.
  const asPatch = patchFromWholeFileRepair(wholeFile, currentFiles);
  assert.deepEqual(asPatch.files, [
    {
      path: "app/page.tsx",
      replacements: [
        {
          oldText: "export default function P(){return <main/>}",
          newText: "export default function P(){return <main><h1>Stock</h1></main>}",
        },
      ],
    },
  ]);

  // And it passes the same admission every patch passes — nothing is relaxed.
  const accepted = validateBrowserRepairProposal({
    structuredOutput: asPatch,
    currentFiles,
    requiredBrowserCheckIds: [],
  });
  assert.match(accepted.files[0].content, /<h1>Stock<\/h1>/u);

  // A whole file that is unchanged is still refused, so the fallback cannot be
  // used to spend an attempt on nothing.
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: patchFromWholeFileRepair(
          { files: [{ path: "app/page.tsx", content: currentFiles[0].content }] },
          currentFiles,
        ),
        currentFiles,
        requiredBrowserCheckIds: [],
      }),
    /do not change the current file/u,
  );

  // The loop reaches for it after the first mechanical patch rejection. Whole
  // files cost more tokens, so they remain a fallback, but a third unusable
  // search/replace proposal should not consume the entire repair round.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /if \(proposalAttempt >= 1\) \{\s*\n\s*wholeFileFallback = true;/u,
  );
  assert.match(source, /await requestBrowserRepair\(\s*\n?\s*semanticRejection,\s*\n?\s*wholeFileFallback,/u);
});

test("a design correction that breaks a working workflow is reverted", async () => {
  // An admin dashboard passed every browser check, reached design fidelity,
  // and the fidelity repair reordered markup that sign-in depended on. The
  // next round reported sign-in false again. Telling the following repair
  // about it only spends another round re-earning what already worked, and
  // the state without the correction is still on disk.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  // The checkpoint a correction was applied over is remembered, along with
  // whether it was a design repair.
  assert.match(source, /repairedOverCheckpointId = browser\.preWorkCheckpointId;/u);
  assert.match(source, /lastRepairWasDesignFidelity = repairPolicy\.designFidelity;/u);

  // A regression is only undone when a design repair caused it — a browser
  // repair chasing a real defect may legitimately disturb other checks while
  // converging, and the stall detector bounds that.
  assert.match(
    source,
    /designRegressionToUndo =\s*\n\s*lastRepairWasDesignFidelity && repairedOverCheckpointId !== null/u,
  );

  // The undo runs before anything reasons about the observation, stops the
  // runtime first, and restarts it against the restored project.
  const undo = source.slice(
    source.indexOf("if (designRegressionToUndo !== null) {"),
    source.indexOf("lastObservationFailure = browserFailure;"),
  );
  assert.match(undo, /runtime\.stop\(\{/u);
  assert.match(undo, /restoreBrowserCheckpoint\(\{\s*\n\s*checkpointId: undone\.checkpointId/u);
  assert.match(undo, /session = await startRuntime\(\);/u);
  assert.match(undo, /continue;/u);

  // The next attempt is told what was reverted and why, so it does not simply
  // repeat the change.
  assert.match(undo, /A design-fidelity correction was reverted/u);
  assert.match(undo, /a closer design is not worth a workflow that no longer runs/u);
  assert.match(undo, /keep the roles, labels and ordering those checks locate/u);

  // Behaviour is proven again after the revert, so a build that cannot improve
  // its design without breaking a workflow still ships, with the shortfall
  // recorded — it does not fail.
  const { ObservationAction, browserObservationDecision } = await import(
    "../src/domain/browser-observation-policy.js"
  );
  assert.equal(
    browserObservationDecision({
      attempt: 4,
      maxAttempts: 6,
      outstandingChecks: 0,
      outstandingFidelityAspects: 3,
      previousOutstanding: 3,
      stalledRounds: 1,
      behaviourProven: true,
    }).action,
    ObservationAction.DELIVER_WITH_SHORTFALL,
  );
});
