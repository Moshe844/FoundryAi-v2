# Milestone 10 validation record

Date: 2026-07-29  
Product URL: `http://localhost:3000/`  
Local API: `http://127.0.0.1:3927`

This record distinguishes focused checks, live mission evidence, and the full
regression suite.

## Live production-path evidence

### Booking mission

Mission: `mission-1785349433957-1d1acea5`

- final state: `SUCCEEDED`;
- real runtime: `mission-1785349433957-1d1acea5-runtime-29`;
- real browser observation: Ledger sequence 671;
- runtime health `HEALTHY`: sequence 672;
- transition to `VERIFYING`: sequence 673;
- Completion Verdict `COMPLETE`: sequence 674; and
- Orchestrator transition to `SUCCEEDED`: sequence 675.

The repair used the selected live route and changed generated test source only
through an evidence-backed Execution Engine work unit. The final resource
classification is generic: an unrelated 404 is non-blocking only when exact
response evidence identifies a non-API static/decorative path. API and
workflow failures cannot be suppressed by generic 404 text.

### Repeated photographer request

The same customer description was executed in:

- `mission-1785339245880-0ab1dd66`
- `mission-1785361549054-f70e1b82`

For the generated project trees, excluding `node_modules`, `.next`, `data`,
and `package-lock.json`:

- each tree contained 30 files;
- their complete relative-path/content-hash digests differed;
- 13 relative paths were shared;
- 12 shared paths had different content;
- 17 paths were unique to each execution; and
- only one shared derived/generated file was byte-identical.

The second mission completed generation, installation, production builds,
runtime readiness, and real Chrome observations, but ended `EXHAUSTED` after
six evidence-backed corrections to its model-generated Playwright verifier.
It was not marked successful. The first photographer mission remains
`SUCCEEDED`; the repeated request is retained as both a generation-diversity
proof and a truthful bounded-failure example.

### REST API mission

Mission: `mission-1785361244590-4a77c143`

The live run produced a dynamic REST-API ProjectProfile and Requirement
Contract, generated source through a selected model, installed dependencies,
type-checked, linted, and reached a successful production build after bounded
repairs. One repair added a missing `app/layout.tsx` through a validated
`write-file` work unit; later repairs corrected a SQLite build-lock defect.

This extra workload ultimately ended `EXHAUSTED`, not `SUCCEEDED`: after a
successful build and ready runtime, browser-state restoration exposed the
SQLite lock again. The sixth persisted build repair had already been used, so
Foundry stopped instead of looping or claiming certification.

## Provider and routing evidence

Live discovery originally returned one healthy current candidate from each
configured provider:

- Anthropic: Claude Opus 5
- Google Gemini: Gemini 2.5 Flash
- OpenAI: gpt-5.6-luna

Gemini accepted the configured current authorization key and participated in
real failover routing. Production source contains no hardcoded discovered
model ID. Every model attempt records a route-start fact before the provider
call. The UI displays provider, exact model, task class, depth, status,
rationale, token counts, and known/unknown cost for each task.

Observed failover history includes Anthropic to Google Gemini to OpenAI. The
read projection distinguishes `FAILED`, `SUCCEEDED`, and `INTERRUPTED`
attempts, and exposes no active route after a terminal mission.

## Local API and visual validation

The read-only mission catalogue was measured before and after the reporting
replay correction:

- before: 3.4-5.3 seconds for six missions;
- after, cold: 334 ms; and
- after, warm: 109-114 ms.

A detailed replay of the completed booking mission measured 56 ms. Ledger
writes and authoritative transition validation still use the full
evidence/checkpoint validation path. Only read-only UI reporting avoids
recomputing an unrelated global evidence fingerprint.

### Background project-understanding recovery

The customer-portal intake bug was reproduced: `POST /missions` waited inline
for a provider request with a 120-second timeout, leaving the Begin button in
an indefinite local busy state.

After correction, the actual browser submission entered its persisted mission
in 3.480 seconds with no refresh or browser errors. The page showed
`Claude / claude-opus-5` as active, remained navigable, and could reopen the
same mission. Claude then failed safely, automatic routing selected
`OpenAI / gpt-5.6-luna`, and OpenAI completed the validated ProjectProfile.

Mission `mission-1785370108487-deea9d74` reached `CLARIFYING` with a dynamic
`Customer portal` profile and four architecture-changing questions. After an
API restart, the exact state and routing history replayed as:

- Anthropic / Claude Opus 5: `FAILED`
- OpenAI / gpt-5.6-luna: `SUCCEEDED`

The replacement mission's authoritative replay is valid. The earlier failed
intake is preserved rather than having its Ledger overwritten.

Chrome, Edge, and Firefox were exercised at 1440x900, 1920x1080, 2560x1440,
125% scale, 150% scale, and an 820px tablet viewport. Every observation
reported no horizontal overflow, page errors, or console errors. At 1440x900
all three browsers showed:

- three healthy provider candidates;
- the exact latest route `Claude / claude-opus-5`;
- task `repair implementation`, depth 2;
- the real booking preview at `http://127.0.0.1:53568`; and
- collapsed engineering details by default.

A final Chrome customer-path check opened all three required live scenarios
through the actual Foundry UI:

- photographer: `SUCCEEDED`, real preview `http://127.0.0.1:57396`, latest
  exact route visible;
- booking: `SUCCEEDED`, real preview `http://127.0.0.1:53568`, latest exact
  route visible; and
- reservations REST API: `EXHAUSTED`, no stale preview, with the visible
  explanation "Foundry stopped after exhausting novel repair strategies."

All three UI assertions passed with no browser console or page errors. The
REST path's earlier build, runtime, and preview evidence remains in its Ledger;
its final unavailable state is represented honestly.

## Automated results

- Complete repository regression suite: **162/162 passed** in
  **1,486.417 s**; zero failures, skips, cancellations, or stderr.
- Three clean real inventory certification missions: **passed** in
  **700.675 s**.
- Three clean real compile/browser/persistence repair missions: **passed** in
  **729.850 s**.
- Milestone 1 after the reporting optimization: **11/11 passed** in
  **11.668 s**.
- Domain-independence focused suite: **8/8 passed** in **0.300 s**.
- Milestone 10 production build and rendered-interface tests:
  **6/6 passed** in **0.252 s** after a successful build.
- Milestone 10 ESLint: **passed with zero warnings or errors**.
- Background-understanding browser checks: **passed**, including immediate
  intake, navigation/reopen, failover, final clarification UI, and restart
  replay.
- Updated Milestone 9A/model replay suite: **20/20 passed**.
- Focused Execution Engine and Model Gateway suite: **12/12 passed**.

## Commands executed

```powershell
node --test --test-concurrency=1 test\domain-independence.test.js
node --test --test-concurrency=1 test\milestone-1.test.js
cd apps\web
npm.cmd run lint
npm.cmd test
cd ..\..
npm.cmd test
node --use-system-ca node_modules\playwright\cli.js install firefox
node C:\tmp\foundry-m10-visual-review.mjs
node C:\tmp\foundry-m10-three-scenarios.mjs
node C:\tmp\foundry-create-background-understanding.mjs
node C:\tmp\foundry-understanding-recovery-ui.mjs
node C:\tmp\foundry-customer-portal-result-ui.mjs
node --test --test-concurrency=1 test\milestone-7.test.js
node --test --test-concurrency=1 test\milestone-9a.test.js
```

The reported results above come from actual command output and persisted
mission evidence. Neither `EXHAUSTED` live workload is presented as a success.

## Task-tier routing correction — 2026-07-29

The earlier one-candidate discovery policy and unconditional depth-4
`CAPABILITY` project-understanding route were corrected. Live discovery now
persists one current fast, balanced, and thorough representative per provider
when the provider advertises them.

The current live catalog is:

- Anthropic: Claude Haiku 4.5, Claude Sonnet 5, Claude Opus 5
- Google Gemini: Gemini 2.5 Flash, Gemma 4 26B A4B IT, Gemini 2.5 Pro
- OpenAI: gpt-5.4-mini, gpt-5.6-luna, gpt-5.5-pro-2026-04-23

A read-only decision against the persisted live registry selected:

- mechanical: `claude-haiku-4-5-20251001` (`FAST`)
- normal project understanding/generation: `claude-sonnet-5` (`BALANCED`)
- architecture review: `claude-opus-5` (`THOROUGH`)

Those names are results, not production routing rules. If health, discovered
catalog, capability scores, known cost, or observed performance changes,
another eligible Anthropic, Gemini, or OpenAI model may be selected.

Validation after the correction:

- focused Execution Engine and AI Registry suites: **35/35 passed**
- non-Milestone-9 repository groups: **159/159 passed**
- five deterministic Milestone 9 diagnosis/repair tests: **5/5 passed**
- web production build and rendered-interface suite: **6/6 passed**
- web lint: **passed**

The combined one-shot repository command timed out because the real three-run
Milestone 8 certification workload took about 494 seconds and Milestone 9's
separate three-real-repair-mission workload exceeded a further ten minutes.
The latter long certification workload is therefore not reported as passing
for this correction.
