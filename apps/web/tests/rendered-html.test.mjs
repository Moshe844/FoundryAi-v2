import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set(
    "test",
    `${pathname}-${process.pid}-${Date.now()}`,
  );
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: {
        accept: "text/html",
        host: "foundry.example",
        "x-forwarded-proto": "https",
      },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the domain-agnostic live Foundry home", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Foundry — Software, thoughtfully made<\/title>/i);
  assert.match(html, /What should I build for you\?/);
  assert.match(html, /Tell Foundry what outcome you want/);
  assert.doesNotMatch(html, /A website for my business/);
  // The approved capability boundary remains explicit without starter content.
  assert.match(html, /I build for the web today/);
  assert.match(html, /tell you honestly instead of substituting/);
  assert.match(html, /https:\/\/foundry\.example\/og\.png/);
  assert.match(html, /href="\/favicon\.svg"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("the production experience consumes replayed ProjectProfile data", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const selectors = await readFile(
    new URL("../experience/selectors.ts", import.meta.url),
    "utf8",
  );
  const componentNames = [
    "project-understanding",
    "foundry-proposal",
    "design-direction",
    "foundry-recommendations",
    "clarification-questions",
    "customer-input-composer",
    "project-discovery",
    "decision-brief",
    "start-building-transition",
    "active-execution",
    "phase-spine",
    "preview-dock",
    "engineering-details",
  ];
  const components = await Promise.all(
    componentNames.map((name) =>
      readFile(new URL(`../app/components/${name}.tsx`, import.meta.url), "utf8"),
    ),
  );
  const source = [page, selectors, ...components].join("\n");
  for (const requiredExperience of [
    // Foundry proposes before it interrogates.
    "Here&rsquo;s what I think you need",
    "What I&rsquo;d build",
    "These are working, responsive prototypes—not design descriptions",
    "What I&rsquo;d include automatically",
    "I&rsquo;d also recommend",
    "decisions that actually matter",
    "Anything else Foundry should know?",
    "Continue with Foundry&rsquo;s recommendations",
    // Every question offers a recommendation, generated options, and custom input.
    "Let Foundry choose",
    "Recommended",
    "Something else&hellip;",
    "Tell Foundry anything else",
    "Why I&rsquo;m asking",
    // Ideas, plan, build, delivery, engineering proof.
    "The plan",
    "Technical shape",
    "Engineering details",
    "Reading your request",
    "Try again",
    // Real replayed data bindings.
    "profile.architectureDecisions",
    "profile.verificationPlan.checks",
    "profile.contextualSuggestions",
    "profile.observations",
    "profile.designAlternatives",
    "mission.modelRouting",
    "mission.executionMetrics",
    "customerPhase",
  ]) {
    assert.match(
      source,
      new RegExp(
        requiredExperience.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
  }
  assert.match(page, /\/missions\/\$\{missionId\}\/clarify/);
  assert.match(page, /\/missions\/\$\{current\.missionId\}\/understand/);
  assert.match(page, /\/missions\/\$\{current\.missionId\}\/start/);
  assert.match(page, /AbortSignal\.timeout\(30_000\)/);
  // The preview frame is bound to the mission's real readiness-observed URL.
  assert.match(source, /const url = preview\.readinessUrl\.value/);
  assert.match(source, /src=\{url\}/);
  assert.doesNotMatch(source, /interpretProjectDescription/);
  assert.match(source, /foundry:preview-width:/);
  assert.match(source, /foundry:engineering-details:/);
  assert.doesNotMatch(source, /About 7 minutes|functionally equivalent/);
  assert.doesNotMatch(source, /GPT-5|Claude Sonnet|Gemini Pro/);
});

test("Foundry proposes before it asks", async () => {
  const discovery = await readFile(
    new URL("../app/components/project-discovery.tsx", import.meta.url),
    "utf8",
  );
  const questionsSource = await readFile(
    new URL("../app/components/clarification-questions.tsx", import.meta.url),
    "utf8",
  );
  // Order is the whole point: the proposal, its reasoning, and the curated
  // recommendations must all precede anything the customer has to answer.
  // Scope to TheRead's render body — component definitions appear earlier in
  // the file than the JSX that renders them, so whole-file offsets lie.
  const proposal = discovery.indexOf("<FoundryProposal");
  const design = discovery.indexOf("<DesignDirection", proposal + 1);
  const recommend = discovery.indexOf("<FoundryRecommendations");
  const questions = discovery.indexOf("<ClarificationQuestions");
  const optional = discovery.indexOf("Anything else Foundry should know?");
  const confirm = discovery.indexOf("Ready when you are");
  for (const [name, index] of Object.entries({
    proposal, design, recommend, questions, optional, confirm,
  })) {
    assert.ok(index > -1, `${name} section is missing from ProjectDiscovery`);
  }
  assert.ok(proposal < design, "design direction must follow the proposal");
  assert.ok(design < recommend, "recommendations must follow design direction");
  assert.ok(recommend < questions, "decisions must follow recommendations");
  assert.ok(questions < optional, "the optional note must follow decisions");
  assert.ok(optional < confirm, "the confirmation closes the surface");
  // The question's reason is shown, not hidden behind a disclosure.
  assert.match(questionsSource, /<details className="why">/);
  assert.match(questionsSource, /Why I&rsquo;m asking/);
});

test("clarification never blocks the customer on a decision", async () => {
  const discovery = await readFile(
    new URL("../app/components/project-discovery.tsx", import.meta.url),
    "utf8",
  );
  const questions = await readFile(
    new URL("../app/components/clarification-questions.tsx", import.meta.url),
    "utf8",
  );
  const source = `${discovery}\n${questions}`;
  // Unanswered questions are submitted as Foundry's professional default,
  // so Continue is never disabled by an unanswered decision.
  assert.match(source, /Foundry decides\. Recommended: \$\{recommended\}/);
  assert.match(source, /left to Foundry/);
  // Selected ideas still travel through the existing clarification contract.
  assert.match(
    source,
    /kind: "recommendation"/,
  );
  // The old forced-answer gate and native dialogs are gone.
  assert.doesNotMatch(source, /unresolved\.some\(/);
  assert.doesNotMatch(source, /window\.(confirm|alert|prompt)/);
});

test("the browser shell delegates intelligence and execution to the local production API", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const applicationShell = await readFile(
    new URL("../app/components/application-shell.tsx", import.meta.url),
    "utf8",
  );
  const discovery = await readFile(
    new URL("../app/components/project-discovery.tsx", import.meta.url),
    "utf8",
  );
  const experienceSource = `${page}\n${applicationShell}\n${discovery}`;
  const server = await readFile(
    new URL("../local-api/server.mjs", import.meta.url),
    "utf8",
  );
  const worker = await readFile(
    new URL("../local-api/mission-worker.mjs", import.meta.url),
    "utf8",
  );
  const understanding = await readFile(
    new URL(
      "../../../src/understanding-plane/project-understanding-service.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(page, /http:\/\/127\.0\.0\.1:3927/);
  assert.match(server, /createLiveAiAdapters/);
  assert.match(server, /openMissionControl/);
  assert.match(server, /control\.understanding\s*\.understand/);
  assert.match(server, /activeUnderstandingJobs/);
  assert.match(server, /startUnderstandingJob/);
  assert.match(server, /json\(response, 201, created\)/);
  assert.match(server, /setImmediate\(\(\) =>/);
  assert.match(server, /void control\.understanding/);
  assert.doesNotMatch(server, /await control\.understanding\s*\.understand/);
  assert.match(server, /mission-worker\.mjs/);
  assert.match(worker, /control\.production\.execute/);
  assert.match(server, /control\.catalogue\s*\.listMissionIds/);
  assert.match(server, /function missionSummary/);
  assert.match(server, /\.map\(missionSummary\)/);
  assert.doesNotMatch(server, /Promise\.all\(\s*control\.catalogue[\s\S]*missionView/);
  assert.doesNotMatch(server, /evidence\s*\.findByMission/);
  assert.match(server, /evidence\.getById/);
  assert.match(server, /route\.status = "FAILED"/);
  assert.match(server, /route\.status = "INTERRUPTED"/);
  assert.match(server, /active\.status = completed\.status/);
  assert.match(understanding, /selection\.eligibleModelIds/);
  assert.match(understanding, /candidateRoutes/);
  assert.match(understanding, /project-understanding-route-dispatch/);
  assert.match(understanding, /project-understanding-route-failure/);
  assert.match(experienceSource, /Checking providers/);
  assert.match(discovery, /selected\[recommendation\.id\]/);
  // Live missions poll every second; a recorded failure backs off to three.
  assert.match(page, /1000 : 3000/);
  assert.doesNotMatch(
    `${server}\n${worker}`,
    /createDeterministicLocalModelProvider|fixtureOnly/,
  );
});

test("production UX source contains no certification-workload vocabulary", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const server = await readFile(
    new URL("../local-api/server.mjs", import.meta.url),
    "utf8",
  );
  const production = `${page}\n${server}`;
  for (const forbidden of [
    /\binventory\b/iu,
    /\bNorthstar\b/u,
    /\bproductCreated\b/u,
    /\bstockEdited\b/u,
    /preview\/inventory/iu,
  ]) {
    assert.doesNotMatch(production, forbidden);
  }
});

test("no internal lifecycle vocabulary reaches customer-facing copy", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // Lifecycle states are translated by customerPhase. Each enum may appear
  // only as a quoted comparison value ("EXECUTING"), never as bare source text
  // that could be rendered — so every occurrence must be quote-delimited.
  assert.doesNotMatch(
    page,
    /(?<!")\b(INTAKE|CLARIFYING|CONTRACTED|PROVISIONING|EXECUTING|VERIFYING|REPAIRING|EXHAUSTED)\b(?!")/u,
  );
  // Implementation nouns the customer must never be shown.
  for (const banned of [
    /"persistence model"/u,
    /"authentication ownership"/u,
    /"runtime topology"/u,
    /nextjs-typescript-sqlite-npm-playwright/u,
  ]) {
    assert.doesNotMatch(page, banned);
  }
});

test("responsive and accessibility foundations preserve clear focus", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /--ring-accent/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.preview\b/);
  assert.match(css, /\.opt\b/);
  assert.match(css, /\.sug\b/);
  assert.match(css, /\.spine\b/);
  assert.doesNotMatch(css, /#000000|#0a0a0a|neon/i);
  // Retired tokens that failed AA contrast must not return.
  assert.doesNotMatch(css, /#f2a879|#9a8d85/i);
});

test("mock preview routes and the keyword interpreter are absent", async () => {
  await assert.rejects(
    access(new URL("../app/preview/project/page.tsx", import.meta.url)),
  );
  await assert.rejects(
    access(new URL("../app/project-profile.ts", import.meta.url)),
  );
  await access(new URL("../public/og.png", import.meta.url));
});
