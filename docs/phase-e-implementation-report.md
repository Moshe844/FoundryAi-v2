# Phase E implementation report

Date: 2026-07-30

Status: sign-off ready. Phase F has not been started.

## Sign-off hardening

The final Phase E sign-off pass closed three integration defects found by the
first real Business Website mission:

1. **Build time is execution time, not mission age.** The customer timer now
   begins at the recorded transition to `CONTRACTED` and freezes at the first
   recorded terminal transition. Understanding, customer decision time, and
   repository validation are never counted as build time. The recorded
   Business Website mission therefore renders `Build finished in 6 min`, not
   the misleading 79–82 minute mission age.
2. **Customer content has explicit provenance.** New ProjectProfiles distinguish
   verbatim values from the customer request or customer answers from content
   still needed before launch. Generated applications may not invent contact
   details, testimonials, credentials, dates, prices, or business hours to make
   an obligation pass. Deterministic bundle admission rejects unsupported
   customer facts, and browser-test repairs may not remove or rewrite asserted
   customer outcomes.
3. **Outcome-to-contract coverage is binding.** Every model-produced obligation
   now carries one-based outcome references, every outcome must be covered, and
   named pages, screens, workflows, and endpoints must remain explicit in the
   observable obligation.

The customer handoff also now follows the approved conversation/preview
composition:

- result summary first;
- live preview immediately beside it when the viewport has room;
- live preview immediately below it before long handoff details on narrower
  layouts;
- sticky preview on desktop without horizontal page overflow;
- desktop, tablet, and phone iframe controls remain available;
- real preview readiness URL only;
- visible draft-content notice when a content claim lacks customer provenance.

The historical Business Website verdict remains immutable, but the customer
projection no longer repeats its unsupported content claim. It now renders
14 of 15 verified, marks the supplied-content obligation `UNVERIFIABLE`, and
explains that real source material is still needed. A recorded verdict can no
longer turn absent customer provenance into a customer-facing success claim.

## Outcome

Phase E now renders active execution from an immutable, replayed execution
projection. The customer surface no longer guesses progress from activity
strings or from the current lifecycle enum. The implementation includes the
approved phase spine, now/why narrative, bounded repair story, real runtime
preview dock, and lossless engineering disclosure.

The browser review used the real Business Website mission
`mission-1785442114460-4fd8e8ec`. The same production UI and API:

1. updated and recorded its live project profile;
2. created 15 binding verification obligations;
3. generated the project through the dynamically selected live route;
4. provisioned and wrote a real workspace;
5. installed, linted, type-checked, and production-built the application;
6. started the runtime and produced a readiness-observed URL;
7. rendered the real application in the Phase E iframe;
8. drove browser verification;
9. recorded a complete verdict and reached `SUCCEEDED`.

The observed build route was GPT / `gpt-5.6-luna`. That value came from the
live provider catalogue and recorded route; Phase E contains no provider or
model table.

## Architecture

| Approved surface | Production source | Canonical projection or component |
|---|---|---|
| phase spine | mission transitions, requirement contract, typed execution procedures, source mutations, runtime and browser records, completion verdict | `local-api/execution-projection.mjs` → `experience/selectors.ts` → `PhaseSpine` |
| now phase and why | projected phase high-water mark plus the current `ProjectProfile` | `experience/selectors.ts` → `ActiveExecution` |
| repair narrative | repair admission, attempt, finding, verification result, and mission state | `local-api/execution-projection.mjs` → `RepairNarrative` → inline `RepairSteps` |
| preview | authoritative runtime records plus the currently reachable readiness URL | `PreviewState` → `PreviewDock` |
| model routing | immutable model-route records | `EngineeringDetails` |
| counters | production execution metrics | `EngineeringDetails` |
| verification | requirement obligations plus the recorded Completion Verdict and evidence references | `executionProjection.verification` → `EngineeringDetails` |
| workspace | workspace facts, checkpoints, certified stack, runtime adapter | `executionProjection.workspace` → `EngineeringDetails` |

React components do not replay Ledger events. The local API performs the one
domain-neutral replay, validates its payload, and the selector translates it
to customer language.

## Phase projection guarantees

- Nine phases remain in fixed order.
- `Connecting data` is omitted only when no persistence capability has ever
  been recorded for the mission.
- Once persistence has appeared in any immutable profile revision, the data
  phase cannot disappear.
- Phase progress is a replayed high-water mark. A
  `VERIFYING → REPAIRING → EXECUTING` sequence cannot move a completed phase
  back to current or pending.
- The why line is derived from the validated profile and sanitised so it
  cannot expose paths, source filenames, or `npm`.
- Elapsed time updates every 10 seconds.
- Activity and execution counters are absent from the default build surface.

## Repair

Repair lines appear only as their corresponding immutable events arrive:

1. a repair transition records the observed workflow problem;
2. a repair admission proves that a likely area has been identified;
3. execution after admission proves correction has begun;
4. a later verification transition proves the bounded checks are rerunning.

The seven approved states are distinct. Domain findings map as required:

- `BUDGET_EXHAUSTED` → budget warning;
- `STRATEGIES_EXHAUSTED` → different strategy;
- `EXTERNAL_BLOCKER` → external service unavailable.

Raw errors and classification enums remain inside Engineering details.

## Preview

- No placeholder is rendered before runtime evidence exists.
- Starting, live, rebuilding, disconnected, crashed, stopped, startup error,
  and unsupported/unavailable presentations are textually distinct.
- The iframe uses only the runtime readiness URL.
- Width is rounded to whole pixels and stored per mission.
- Drag resize is bounded to 480px–70% of the viewport.
- Keyboard verification passed:
  - Arrow left: 560 → 600;
  - Arrow right: 600 → 560;
  - Home: 480;
  - End at the tested viewport: 1007;
  - Escape: 44px collapsed bar with `Show preview`.
- Desktop, tablet, and phone controls now change the iframe viewport rather
  than forcing the whole dock to those widths. This correction was made after
  the live visual review exposed a squeezed phase column.
- Expand, open separately, reload, collapse, and reconnect affordances are
  implemented and named for assistive technology.

## Engineering details

The main disclosure is closed by default and remembers its open state per
mission. Its independently collapsible sections are:

1. Activity — newest first, complete kind/title/detail/time records, windowed
   in 200-row increments;
2. Model routing — provider, model, task/depth, status, attempt, reason,
   input/output tokens, and recorded or honestly unavailable cost;
3. Counters — every execution metric, including repair scopes;
4. Verification — every obligation, verdict, detail, and evidence reference;
5. Workspace — mission, workspace, checkpoints, stack/version, and runtime
   adapter.

The live reload/reopen check confirmed that the main disclosure remains open
for the same mission.

## Files introduced for Phase E

- `apps/web/local-api/execution-projection.mjs`
- `apps/web/app/components/active-execution.tsx`
- `apps/web/app/components/phase-spine.tsx`
- `apps/web/app/components/preview-dock.tsx`
- `apps/web/app/components/engineering-details.tsx`
- `apps/web/tests/phase-e-experience.test.mjs`

The existing API, contracts, validation, selectors, page composition, design
tokens, rendered-source tests, and web test script were extended narrowly to
consume these modules.

## Regression and verification results

Final sign-off source state:

- web production build: pass;
- web Phase A–E regression suite: 37/37 pass;
- TypeScript: pass;
- ESLint: pass with no warnings;
- `git diff --check`: pass;
- complete repository suite: 232/232 pass;
- complete repository duration: 744.52 seconds;
- failures, cancellations, skips, and timeouts: 0.

The full suite was allowed to finish. Its duration was not treated as a pass,
failure, or timeout.

## Browser and responsive evidence

The real Phase E surface was checked at 375, 768, 1024, 1280, and 1440 pixels.
At every width, document scroll width equalled client width; no horizontal page
overflow was introduced.

Screenshots:

- `docs/phase-e-screenshots/active-execution-375.png`
- `docs/phase-e-screenshots/active-execution-768.png`
- `docs/phase-e-screenshots/active-execution-1024.png`
- `docs/phase-e-screenshots/active-execution-1280.png`
- `docs/phase-e-screenshots/active-execution-1440.png`
- `docs/phase-e-screenshots/engineering-details-1440.png`
- `docs/phase-e-screenshots/preview-live-1440.png`

## Intentionally not included

Completion variants, failure, blocked, cancelled, and unsupported-state
redesigns belong to Phase F. Existing versions of those surfaces were left in
place. Phase E does not claim that Phase F is implemented.
