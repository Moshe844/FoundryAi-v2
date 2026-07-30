# 8. Acceptance criteria and visual review checklist

Written for Codex. Every criterion is objectively checkable. `AC-n` items are
Tier 1 unless marked. A criterion that cannot be verified from the running
product or the diff is not in this list.

## Implementation order

1. **Foundation** — AC-1 … AC-8 (tokens, type, shell, state translation)
2. **The Read** — AC-9 … AC-24 (home, understanding, clarification, brief)
3. **The Build** — AC-25 … AC-38 (execution, preview, repair, engineering details)
4. **The Delivery** — AC-39 … AC-47 (completion, failure, cancel, continuity)
5. **Cross-cutting** — AC-48 … AC-62 (responsive, accessibility, search, settings)

Nothing in group 2 ships before group 1 is complete. Group 3 assumes group 2.

---

## Group 1 — Foundation

**AC-1 — Token file is the only source of visual values.**
`globals.css` declares every token from
[04-design-system.md](04-design-system.md) §4.1–4.4 and §4.7. A grep for
hex colours, `px` radii, or `px` shadows outside the `:root` block returns
nothing. The retired tokens (`--peach`, `--ink-faint`, `--radius-lg: 28px`,
`--rose-soft`) do not appear anywhere in the repository.

**AC-2 — The body radial gradient is removed.**
`globals.css` `body` background is `var(--surface-canvas)` with no
`radial-gradient`.

**AC-3 — Type scale is implemented as classes, not ad-hoc rules.**
Eleven type tokens exist with the exact size/line/weight/tracking from
[05-typography.md](05-typography.md) §5.2. Every size is an integer and every
`line-height` is declared in `px`.

**AC-4 — Optical face switching works at the 20px boundary.**
Elements at ≥20px use `var(--font-display)`; <20px use `var(--font-text)`.
`var(--font-brand)` appears in exactly two selectors in the whole stylesheet.

**AC-5 — No transform, filter, or backdrop-filter on any text-bearing element.**
A grep for `transform`, `filter:`, `backdrop-filter`, and `will-change` in
`globals.css` returns only: the disclosure chevron rotation, the two sheet
translations, and the preview dock. No rule matching a text container appears.

**AC-6 — `customerPhase(mission)` is a single pure function.**
It maps every one of the twelve `MissionState` values plus derived `EXECUTING`
sub-phases per [02-principles-and-architecture.md](02-principles-and-architecture.md)
§2.5. No component reads `mission.state` directly. A grep for
`"PROVISIONING"`, `"CONTRACTED"`, `"EXHAUSTED"` outside that module and its test
returns nothing.

**AC-7 — No raw lifecycle enum reaches the DOM.**
Rendering a mission in each of the twelve states produces no DOM text matching
`/^(INTAKE|CLARIFYING|CONTRACTED|PROVISIONING|EXECUTING|VERIFYING|REPAIRING|SUCCEEDED|FAILED|BLOCKED|EXHAUSTED|CANCELLED)$/i`
outside `Engineering details`. Automated test required.

**AC-8 — All copy comes from one exported string map.**
No customer-facing literal appears in a component. The map's keys match
[06-copy-deck.md](06-copy-deck.md). A test asserts no banned technical term
(*persistence, authentication, session, runtime, topology, provider strategy,
schema, ORM, framework, middleware, stateless, obligation, ledger, mission,
evidence, checkpoint, adapter, stack*) appears in any map value outside the
`engineering.*` and `providers.*` namespaces.

---

## Group 2 — The Read

**AC-9 — Home states what Foundry does above the fold.**
At 1280×768 the H1, the lead sentence, the composer, and the `Start` button are
all visible without scrolling.

**AC-10 — Home offers exactly five suggestion chips, all buildable.**
No chip's text implies mobile, desktop, native game, or CLI. The strings match
the copy deck exactly.

**AC-11 — The capability line appears after the chips.**
Its DOM position is after the chip container and before `Your projects`.

**AC-12 — Zero-provider state does not disable the composer.**
With no available provider, the textarea accepts input, the `Needs you` banner
renders above the composer, and `Start` is disabled with an accessible reason.

**AC-13 — Submitting navigates immediately.**
`POST /missions` returning 201 navigates to the project surface within one frame.
No spinner is shown on the `Start` button for longer than 200ms.

**AC-14 — Understanding renders before any question.**
With a profile containing `openQuestions.length > 0`, the DOM order is:
name → summary → who it's for → how they'll use it → already in the plan →
decisions. Asserted by a DOM-order test.

**AC-15 — No raw capability identifier is rendered.**
Every string in `profile.capabilities` renders through the translation map in
[03-screens.md § 5](03-screens.md#5-project-understanding). Rendering
`sqlite-persistence` produces "Its own database". An unmapped identifier renders
sentence-cased and logs a warning.

**AC-16 — `profileVersion` is never shown as a number.**
With `profileVersion: 3` the surface shows "Updated with your answers" and no
digit `3`.

**AC-17 — Every question renders four affordances.**
For any question with any `answerOptions`, the card contains: a first full-width
`Foundry decides` option carrying a `Recommended` badge and the text of
`answerOptions[0]`; one option per `answerOptions` entry (max 4 visible); a
`Something else…` control; a `Skip for now` control.

**AC-18 — `Continue` is never disabled by unanswered questions.**
With zero questions answered, `Continue` is enabled. Clicking it issues one
`POST /missions/:id/clarify` containing one answer per question with the
`Foundry decides` payload string. No confirmation dialog appears.

**AC-19 — Skip reveals the exact note field.**
Activating `Skip for now` reveals a textarea labelled
"Anything you'd like Foundry to keep in mind?" — string-exact. Submitting with
text produces the `Skipped by the customer… Keep in mind: {note}` payload;
submitting empty produces the payload without the `Keep in mind` clause.

**AC-20 — Answer progress is stated honestly.**
The helper text reads "{answered} answered · {remaining} left to me" and updates
on every selection.

**AC-21 — More than four options collapse.**
A question with 7 options renders 4 plus a `More options` control. No option
text is truncated with an ellipsis at any viewport width.

**AC-22 — Suggestions submit through the existing mechanism.**
Selecting suggestions and continuing produces clarify answers keyed by
`suggestionId` with the `Include this project idea: {label}. {rationale}` payload
shape preserved from `page.tsx:436-441`.

**AC-23 — The brief never shows the raw stack id.**
`nextjs-typescript-sqlite-npm-playwright` appears nowhere outside the
`Technical shape` disclosure and `Engineering details`. `How it's put together`
renders the plain-language sentence.

**AC-24 — The brief's `What I'll prove` uses check labels verbatim.**
Each rendered line equals a `profile.verificationPlan.checks[].label` string with
no transformation. The count equals `checks.length`.

---

## Group 3 — The Build

**AC-25 — The counters band is gone from the customer surface.**
No DOM text matching `/provider calls|repair hypotheses|installs|rebuilds|runtime restarts/`
exists outside `Engineering details`.

**AC-26 — The phase spine renders nine phases in fixed order.**
Order matches §2.5. `Connecting data` is omitted when the profile has no
persistence capability. No phase is ever removed after being rendered.

**AC-27 — The spine never regresses.**
Driving a mission through `VERIFYING → REPAIRING → EXECUTING`, no phase
transitions from complete back to pending or current. Asserted by a state-machine
test over recorded transitions.

**AC-28 — The "now" block shows one phase and one why line.**
The phase is at `--type-display-l`; the why line at `--type-title-s` weight 400.
The why line is composed from profile data per the §12 table, never from a
filename. A test asserts no rendered why line contains `/`, `.ts`, `.tsx`, or
`npm`.

**AC-29 — Elapsed time updates at 10s intervals, not 1s.**

**AC-30 — The `Needs you` slot holds at most one card.**
With two pending attentions, one renders and a `1 more waiting` marker appears.

**AC-31 — The preview dock does not exist before `previewUrl`.**
With `previewUrl === null` there is no dock element, no placeholder frame, and
the content column is single and full width. Asserted by DOM absence.

**AC-32 — The dock renders all eight runtime states distinctly.**
Each state from the §13 table produces its own footer text. `STARTUP_FAILED`,
`CRASHED`, and `STOPPED` are visually and textually distinct from each other and
from `waiting`.

**AC-33 — Dock width is an integer and persists.**
After dragging, `getBoundingClientRect().width` is a whole number. The value
survives reload, keyed by mission id in `localStorage`.

**AC-34 — Dock is keyboard-resizable.**
The handle is focusable; `←`/`→` change width by 40px; `Home`/`End` reach min
(480px) and max (70%); `Escape` collapses.

**AC-35 — Collapsed preview leaves a restore affordance.**
Collapsing produces a 44px bar with `Show preview`; the dock is never fully
removed once it has existed.

**AC-36 — Repair renders inline, cause-first, without raw errors.**
A repair sequence produces the four narrative lines from the copy deck in event
order, nested under the interrupted phase. No stack trace, error class, or
`FailureClassification` value appears outside `Engineering details`.

**AC-37 — Repair states are all reachable and distinct.**
Each of the seven §17 states renders its own copy. `BUDGET_EXHAUSTED`,
`STRATEGIES_EXHAUSTED`, and `EXTERNAL_BLOCKER` map to the budget-warning,
different-strategy, and external-service strings respectively.

**AC-38 — `Engineering details` preserves everything, losslessly.**
It contains: the full activity list, the complete routing table with tokens and
cost including the "cost unavailable locally" fallback, all `executionMetrics`
fields, every obligation with verdict and evidence references, and mission,
workspace, stack, and adapter identifiers. Opening it does not reflow the spine.

---

## Group 4 — The Delivery

**AC-39 — `SUCCEEDED` renders the delivery surface, not the build surface.**
The delivery card, not `MissionView`, is rendered. The preview is full width.

**AC-40 — Proved counts are literal.**
`{n} of {m}` equals the count of `SATISFIED` verdicts over total obligations.
When `n < m` the success headline is not shown; the `INCOMPLETE` variant is.

**AC-41 — `UNVERIFIABLE` is never counted as proved.**
A mission with an `UNVERIFIABLE` verdict shows it under `What I couldn't check`
and excludes it from `What I proved`.

**AC-42 — Decisions are attributed.**
Customer-answered decisions read "you chose this". `Foundry decides` answers read
"my call, because {reason}".

**AC-43 — `What I didn't do` is never empty.**
It renders constraints, declined suggestions, and customer-relevant stack
limitations. If all three sources are empty, the section states the honest
minimum rather than being hidden.

**AC-44 — Every failure surface has all seven sections.**
`FAILED`, `EXHAUSTED`, `BLOCKED`, and verification-`INCOMPLETE` each render:
what I was doing, what happened, what I did prove, what I couldn't prove, what
I'd try next, what I need from you, `Engineering details`.

**AC-45 — No failure text uses forbidden phrasing.**
A test asserts no rendered failure string matches
`/oops|something went wrong|sorry|apologi|unexpected error|please try again/i`.

**AC-46 — `CANCELLED` is styled neutral, not as a fault.**
No `--fault` token is applied on the cancelled surface. The `Stop` confirm sheet
states the consequence before stopping.

**AC-47 — Follow-up composer is honest about its mechanics. [Tier 1 interim]**
The disclosure line "I'll start a new version and carry this project's plan and
decisions into it. The files from this build stay where they are." is visible
*before* submission. `Undo the last change` is not offered.
`Explain why you chose this` expands in place using
`profile.architectureDecisions` and issues no new mission.

---

## Group 5 — Cross-cutting

**AC-48 — Responsive matrix holds.**
Every row of the [07 § 7.1](07-responsive-and-accessibility.md) table is
verified at 375px, 768px, 1024px, 1280px, and 1680px. No horizontal page scroll
at any width down to 320px.

**AC-49 — Tablet uses a segmented preview tab, not a dock.**
At 768–1279px no side dock exists; a `Build | Preview` segmented control does,
and the `Preview` label carries a live dot when the runtime is healthy.

**AC-50 — Mobile primary action is a sticky bar with safe-area inset.**

**AC-51 — Every contrast pair passes.**
Automated contrast assertion over the token pairs in
[07 § 7.2](07-responsive-and-accessibility.md). `--accent-line` is asserted
absent as a colour on any element with computed `font-size < 20px`.

**AC-52 — Focus is visible on every interactive element.**
Automated pass tabbing the full order on each surface, asserting a non-`none`
computed outline or box-shadow ring on each stop.

**AC-53 — Focus is never stolen by polling.**
With a 1s poll active, focus and caret position in a focused textarea are
retained across at least 10 poll cycles.

**AC-54 — Exactly one live region is active per surface.**
Asserted by counting elements with `aria-live` in the rendered tree per surface.
`Needs you` (assertive) suppresses the polite region while present.

**AC-55 — Individual activities are not announced.**
No element in the activity list carries `aria-live` or `role="status"`.

**AC-56 — Sheets manage focus correctly.**
Opening traps focus and focuses the safe option; `Escape` closes to safe; focus
returns to the invoker. Verified for both the nav sheet and the approval sheet.

**AC-57 — `window.confirm` is gone.**
No `window.confirm`, `window.alert`, or `window.prompt` call remains in
`apps/web/app`.

**AC-58 — Reduced motion removes both loops.**
Under `prefers-reduced-motion: reduce`, the phase halo and skeleton pulse have no
running animation, the building pill reads "Building · live", and all end states
are preserved.

**AC-59 — Touch targets are 44px minimum below 1280px.**
Automated measurement of every interactive element's hit box.

**AC-60 — Search is URL-backed and non-blocking.**
`?q=` reflects the query, `Ctrl+K` focuses the field, 200ms debounce, in-flight
requests cancelled, previous results retained at reduced opacity, no spinner over
the list. Empty result renders the exact copy plus `Clear search`.

**AC-61 — Providers leave primary navigation.**
The rail contains exactly two nav items (Home, Projects). Provider state is a
footer chip opening Settings → Model providers. The provider disclaimer about
live-discovered candidates is present on that surface.

**AC-62 — No Tier 2 surface ships as an inert control.**
`Connections`, `Appearance`, `Data`, `Undo`, non-web preview variants, and
approval types beyond delete/stop are either fully functional or absent from the
DOM. A grep for `disabled` on a nav or tab element returns nothing.

---

## Visual review checklist

Run for every act, at every scale factor, before sign-off. Compare
implementation screenshots against the prototype at
[prototype/index.html](prototype/index.html).

### Screenshot matrix

9 acts × 3 scale factors × 3 viewports. Acts: Home · Understanding ·
Clarification · The plan · Building (no preview) · Building (preview live) ·
Repair · Delivery · Unsupported. Scale: 100% · 125% · 150%.
Viewports: 375 · 768 · 1440.

### Typography

- [ ] Headings ≥20px render in the Display face; body <20px in the Text face — visibly different letterforms, not just size.
- [ ] The serif appears in exactly two places across all screenshots.
- [ ] No glyph blur at 125% or 150%. Zoom to 400% on a heading, a 15px body line, and a 13px label in each screenshot.
- [ ] Baselines align across the two columns of `.field-row` at all three scale factors.
- [ ] No text is clipped, and no line exceeds the 720px measure.
- [ ] No uppercase text except the single `--type-micro` eyebrow per surface.
- [ ] Button labels are sentence case.

### Colour and contrast

- [ ] No retired token present. Sample the composer border, any caption, and any accent text with a colour picker.
- [ ] Accent appears on at most one dominant surface per viewport.
- [ ] `--accent-line` never carries text under 20px.
- [ ] Nothing the customer chose (skip, decline, cancel) is red.
- [ ] Warm hue is visible in the surfaces — the page is not neutral grey and not pink.
- [ ] No gradient anywhere.

### Hierarchy and density

- [ ] Each surface has exactly one primary action, and it is the most prominent element after the heading.
- [ ] No region of empty space larger than 200×200px inside the content column at 1440×900.
- [ ] The build surface's dominant element is the phase name, or the preview when one exists.
- [ ] Nothing on the build surface shows a filename, command, token count, or counter.
- [ ] Radii: nothing exceeds 20px; nested corners are concentric.
- [ ] Borders are 1px and consistent across all cards in one screenshot.

### States

- [ ] Every component state from [04 § 4.5](04-design-system.md) captured and matching: default, hover, pressed, focus, selected, disabled, loading, error.
- [ ] `Foundry decides` selected state uses the verified colour, not the accent — visibly distinct from a customer-chosen option.
- [ ] All eight preview runtime states captured and distinguishable by text alone.
- [ ] All seven repair states captured.
- [ ] Skeletons match the dimensions of the content they replace.

### Behaviour

- [ ] Preview dock absent before a real URL; present and integer-width after.
- [ ] Collapsed dock leaves a restore bar.
- [ ] `Continue` enabled with zero answers.
- [ ] Phase spine does not regress through a repair cycle.
- [ ] `Engineering details` opening does not shift the spine.
- [ ] Elapsed time does not repaint every second.

### Accessibility

- [ ] Keyboard-only pass of each act: every action reachable, focus always visible, no trap outside the two sheets.
- [ ] Screen-reader pass (NVDA on Windows): headings navigable, one live region announcing phase changes, no activity firehose, every icon control named.
- [ ] Forced-colours pass: selected options and status pills remain distinguishable.
- [ ] Reduced-motion pass: no loops, all meaning intact.
- [ ] 400% browser zoom at 1280px: single column, no two-dimensional scroll.

### Honesty

- [ ] No screen promises a capability from the Tier 2 table.
- [ ] No home-screen chip leads to the unsupported surface.
- [ ] The unsupported surface names the specific platform requested.
- [ ] The delivery card's `What I didn't do` is populated.
- [ ] `n of m` proved counts match the verdicts in `Engineering details` exactly.
- [ ] The provider disclaimer is present and unmodified in meaning.
