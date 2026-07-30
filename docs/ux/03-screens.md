# 3. Screen specifications

Each surface: capability tier, purpose, layout, content, states, behaviour.
Exact strings live in [06-copy-deck.md](06-copy-deck.md); tokens in
[04-design-system.md](04-design-system.md).

Grid reference (desktop ≥1280px): 240px rail · 32px gutter · content column
max 1100px with a 720px reading measure · optional preview dock 40% (min 480px).

---

## 1. Home

**Tier 1.**

**Purpose.** In one screen: state what Foundry does, take a short brief, and
offer continuation. It must produce the reaction *"I can just say what I want."*

**Layout.** Single column, left-aligned at the reading measure, top-weighted.
Not centred — centring is what produced the current empty hero. Content begins
80px from the top and the composer's first pixel is above the fold at 768px
height.

```text
┌ rail ┬──────────────────────────────────────────────────────┐
│      │  What should I build for you?              [display-xl, serif]
│      │  Describe the outcome in a sentence. I'll design the
│      │  product, choose how it's built, build it, run it,
│      │  and prove it works.                        [body-l, ink-secondary]
│      │
│      │  ┌────────────────────────────────────────────────┐
│      │  │ A booking site for my studio                   │  composer
│      │  │                                                │  3 rows, grows to 8
│      │  │                          [Start →]             │
│      │  └────────────────────────────────────────────────┘
│      │  I'll come back with a plan before anything is built.
│      │
│      │  ┌ Try ─────────────────────────────────────────────┐
│      │  │ [A website for my business] [An appointment      │  suggestion chips
│      │  │  booking system] [A customer portal with logins] │  dynamic
│      │  │ [An internal tool for my team] [An API for         │
│      │  │  reservations]                                   │
│      │  └──────────────────────────────────────────────────┘
│      │
│      │  Your projects                                    [title-m]
│      │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│      │  │ Studio       │ │ Team         │ │ Reservations │  project cards
│      │  │ booking      │ │ directory    │ │ API          │
│      │  │ Ready · 2h   │ │ Building · now│ │ Needs you    │
│      │  │ [Continue]   │ │ [Open]        │ │ [Open]       │
│      │  └──────────────┘ └──────────────┘ └──────────────┘
│      │                                        Show all 11 →
└──────┴──────────────────────────────────────────────────────┘
```

**Content rules.**

- The H1 is the only serif element on the screen. It carries the studio voice.
- Composer is the visual anchor: `--surface-raised`, 1px `--line`, radius 14,
  `--shadow-2`, 20px internal padding. On focus the border becomes
  `--accent-line` and a 3px `--accent-ring` appears outside. It never grows a
  drop-shadow on focus (Windows text blur risk).
- `Start` is disabled only while the field is empty or a submit is in flight.
  It is **never** disabled for provider reasons — see the notice below.
- The trust line under the composer is the most important sentence on the page.
  It removes the fear that Foundry will silently start building the wrong thing.
- Capability line, placed after the chips at `caption` / `--ink-tertiary`:
  *"I build for the web today — web apps, business websites, customer portals,
  internal tools, and web APIs. Ask me for a mobile, desktop, or native game
  build and I'll tell you honestly instead of substituting something else."*
  This replaces `page.tsx:286`, and it appears **after** the chips so no chip
  ever promises what the line retracts.

**Chips.** Five, never eight. Every chip is a web project Foundry can actually
build. `Create a mobile app`, `Create a desktop application`, and `Build a game`
are removed (see [01-diagnosis.md § 1.2](01-diagnosis.md)). Clicking a chip
fills the composer and focuses it at the end of the text — it does not submit.

**Zero-provider state.** When `GET /providers` returns no `available` provider,
a `Needs you` banner sits directly above the composer (not below the hero copy
as today) with the exact remedy and a `Re-check providers` action calling
`POST /providers/refresh`. The composer stays interactive so the customer can
draft while fixing credentials; `Start` shows the banner's reason on hover.

**States.** Default · typing · submitting ("Starting…", composer locked) ·
zero-providers · projects loading (3 skeleton cards) · projects empty · error
(inline, above the composer, with retry).

---

## 2. Existing-project continuation

**Tier 1.**

**Purpose.** Make returning cheaper than starting over.

Project cards on Home and Projects show, in this order: project name
(`profile.name`, or the customer's own intent while understanding is still
running), one-line summary, a **customer phase** chip (§2.5 mapping — never a
raw enum), and relative last activity from `updatedAt`.

The primary action is phase-dependent, and the label is the design:

| Phase | Action label | Destination |
|---|---|---|
| Reading your request | `Open` | The Read, in its loading state |
| Waiting on you | `Answer` | The Read, scrolled to the first unanswered decision |
| Plan ready | `Review the plan` | The Plan |
| Building / Testing / Correcting | `Watch` | The Build, live |
| Delivered | `Continue` | The Delivery, follow-up composer focused |
| Needs you | `Resolve` | The Build, focused on the `Needs you` card |
| Stopped / Cancelled | `Reopen` | The failure surface |

`Answer`, `Resolve`, and `Continue` are the continuation affordances the brief
asks for. Distinguishing *creating* from *continuing* is achieved by this
labelling plus placement — the composer is above, projects are below, and they
never share a control.

Secondary action is an overflow `⋯` menu holding `Rename` [Tier 2],
`Duplicate` [Tier 2], and `Delete` (§ this doc, Approvals). Delete is never a
naked button on the card face as it is today (`page.tsx:360-367`).

---

## 3. New-project input

**Tier 1.**

The composer is one component used in three places with the same behaviour:
Home, Projects (empty state), and the follow-up composer (§19).

- `textarea`, auto-growing 3 → 8 rows, then scrolls. Never a single-line input.
- `Enter` submits; `Shift+Enter` newlines. Both announced in the field's
  `aria-describedby`.
- Placeholder is a *short* example, deliberately: "A booking site for my
  studio." A long placeholder teaches customers to write long briefs, which
  contradicts the core principle.
- No character counter, no minimum length, no "add more detail" nudge. Nine
  words must be respected as sufficient.
- Trailing whitespace trimmed; empty submit is a no-op with focus retained.
- On submit: optimistic navigation to the project surface, because
  `POST /missions` returns 201 immediately and understanding continues in the
  background (`server.mjs:857-866`). The customer must never watch a spinner on
  a button for a job that is already recorded and recoverable.

---

## 4. Dynamic project suggestions

**Tier 1.**

**Purpose.** Help a customer say a little more, without making them classify
anything technically.

**Behaviour.** Suggestions are computed client-side from the composer text —
no endpoint exists for this, and inventing one would be a fake capability.
Three tiers of behaviour:

1. **Empty field** — the five starter chips (§1).
2. **1–3 words typed** — chips become *completions* of what's being typed,
   drawn from a static intent lexicon keyed on plain business nouns. Typing
   "booking" yields: "…for a hair studio", "…for a dental practice",
   "…with staff calendars", "…that takes deposits". They append to the text.
3. **4+ words** — chips are replaced by a single quiet line:
   *"That's enough to start. I'll ask if anything's genuinely unclear."*
   This is the moment the product teaches its own principle.

**Rules.**

- Suggestions must never be phrased as categories ("Web app", "CRUD system",
  "Static site"). They are always outcomes in the customer's language.
- Matching is on whole words, case-insensitive, and is never destructive: a
  suggestion appends or completes, never replaces what was typed.
- Maximum five visible; they reflow, never scroll horizontally.
- A suggestion that would produce an unbuildable project family may not exist in
  the lexicon at all.
- Debounce 180ms. Chips cross-fade opacity only — no layout animation, no text
  transform (Windows blur).
- Full lexicon lives in [06-copy-deck.md § 4](06-copy-deck.md).

---

## 5. Project understanding

**Tier 1.** The screen that wins or loses the product.

**Purpose.** Before a single question, prove Foundry read the request like a
product designer.

```text
   What I understand                                    [micro eyebrow]
   Studio Booking                                       [display-l]
   A booking site for a small studio where clients pick
   a service, choose an available time, and confirm
   without phoning.                                     [title-s, ink-secondary]

   ┌ Who it's for ──────────┐ ┌ How they'll use it ──────────────────┐
   │ • Studio clients       │ │ 1. Pick a service                    │
   │ • Studio owner         │ │ 2. See real availability             │
   │ • Front desk staff     │ │ 3. Book and get a confirmation       │
   └────────────────────────┘ │ 4. Owner reviews the day's bookings  │
                              └──────────────────────────────────────┘

   Already in the plan — I didn't need to ask            [title-m]
   ┌───────────────┐┌───────────────┐┌───────────────┐┌───────────────┐
   │ Saved bookings││ Works on phones││ Confirmation  ││ Owner's view  │
   │ that survive  ││                ││ on screen     ││ of the day    │
   │ a refresh     ││                ││               ││               │
   └───────────────┘└───────────────┘└───────────────┘└───────────────┘
```

**Field mapping — no invention.**

| Region | Source |
|---|---|
| Project name | `profile.name` |
| Summary | `profile.summary` |
| Who it's for | `profile.primaryActors` |
| How they'll use it | `profile.outcomes`, in order, numbered |
| Already in the plan | `profile.capabilities` translated (below) + `profile.dataConcepts` |
| Revision indicator | `profile.profileVersion`, shown only when > 1, as "Updated with your answers" — never "revision 3" |

**Capability translation.** `profile.capabilities` are stack identifiers
(`toolchain-stack.js:490`). They must never appear raw. This map is normative
and exhaustive for the current manifest:

| Identifier | Customer wording |
|---|---|
| `web-application` | *(omitted — implied, adds nothing)* |
| `typescript` | *(omitted — implementation detail)* |
| `sqlite-persistence` | "Its own database" |
| `create-records` | "People can add records" |
| `update-records` | "People can change records" |
| `refresh-persistence` | "Data survives a refresh" |
| `production-build` | "Built the way it would really ship" |
| `development-runtime` | "Runs on your machine" |
| `browser-verification` | "Tested in a real browser" |
| `automated-tests` | "Automated tests included" |
| `package-export` | "Portable project folder you own" |

An unmapped future identifier renders as sentence-case with hyphens replaced by
spaces, never as a raw token — and triggers a console warning so it gets a
proper string.

**States.**

- **Understanding in progress** (`profile === null`) — see §28.
- **Understanding failed** — see §29, with `POST /missions/:id/understand` retry.
- **Understanding complete, questions pending** — this screen, then §7 below it.
- **Understanding complete, no questions** — this screen, then §10 directly.
  Copy: *"That's enough to begin — nothing here materially changes what I'd
  build."* This is a moment of confidence, not an empty state.
- **Platform unsupported** (`profile.platform !== "web"`) — §31 replaces
  everything below the summary.

---

## 6. Discovery

**Tier 1.**

Discovery is not a separate screen — it is §5 plus §7 plus §9 on one scroll,
in that fixed order, under one heading. The current product's failure was
treating discovery as a form; this redesign treats it as a designer presenting
work and then raising the two things only the client can decide.

Scroll and focus behaviour:

- Landing here places focus on the H1 (`tabindex="-1"`), so screen-reader users
  hear the understanding before the questions.
- The first unanswered decision is *not* auto-focused on arrival. It is focused
  only when the customer arrives via `Answer` from a project card (§2).
- The primary `Continue` action is sticky to the bottom of the viewport on
  screens under 900px tall, so it never hides behind a long question list.

---

## 7. Clarification

**Tier 1.** The structural fix.

**Purpose.** Ask only what materially changes the result, offer a professional
default for every question, and never block on a decision the customer doesn't
understand.

### Question card anatomy

```text
┌──────────────────────────────────────────────────────────────────┐
│  How should people sign in?                        [title-s, 600] │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │ ✓  Let me choose the best option        Recommended         │  │  ← always first
│  │    Email and password with a secure reset                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────┐ ┌──────────────────────────────┐    │
│  │ Email and password       │ │ Google or Microsoft accounts │    │  ← model options
│  └──────────────────────────┘ └──────────────────────────────┘    │
│  ┌──────────────────────────┐                                     │
│  │ No sign-in — it's a      │                                     │
│  │ visual prototype         │                                     │
│  └──────────────────────────┘                                     │
│                                                                    │
│  Something else…                          Skip for now             │
│                                                                    │
│  ▾ Why I'm asking                                                  │
│    Sign-in decides whether every page needs to know who's looking, │
│    which changes how the whole product is put together.            │
└──────────────────────────────────────────────────────────────────┘
```

### The four mandatory affordances

Every question renders all four, regardless of model output. This is a UI
guarantee, implemented against the existing `POST /missions/:id/clarify`
contract with **zero backend change**:

| Affordance | Presentation | Submitted `answer` value |
|---|---|---|
| **Foundry decides** | First option, full width, `Recommended` badge, shows which option it would pick (`answerOptions[0]`) | `Foundry decides. Recommended: <answerOptions[0]>. Use your professional judgement.` |
| **Plain choices** | `answerOptions`, rendered as a reflowing option grid, 2 per row at ≥720px | the option string, verbatim |
| **Something else** | Text link; expands a 2-row textarea, placeholder "In your own words…" | the customer's text, trimmed |
| **Skip for now** | Text link; expands the optional note field | `Skipped by the customer. Use your professional judgement.` + `" Keep in mind: <note>"` when a note is given |

The skip note field's label is exactly the brief's wording:
**"Anything you'd like Foundry to keep in mind?"** It is optional, never
validated, and its presence must not imply the skip is incomplete.

### Continue is never disabled by unanswered questions

This is the direct replacement for `page.tsx:544-547`. `Continue` is enabled
whenever the mission is not busy. Unanswered questions are submitted as
`Foundry decides` — the recommended default — and the button's helper text says
so, honestly and quietly:

> *3 answered · 1 left to me*

Clicking `Continue` with skipped or untouched questions is a valid, professional
path, not a degraded one. There is no confirmation dialog for it.

### Options that are safe to render

`answerOptions` is validated non-empty with meaningful text
(`project-profile.js:158`), so the option grid always has content. Guards:

- More than 4 options: show 4, collapse the rest behind "More options" —
  a question with 7 choices is a questionnaire.
- Option longer than 60 characters: wrap to two lines, never truncate. An
  ellipsis on a decision is a trap.
- Options are radio semantics (`role="radiogroup"`), single-select, arrow-key
  navigable, and re-selectable to change the answer.

### Plain-language enforcement

Question text comes from the model and is rendered verbatim
(`page.tsx:512`), so no client-side rewrite can honestly guarantee plain
language. Two layers:

1. **Source fix (required).** Add the one prompt line specified in
   [README.md](README.md#the-one-backend-text-change-this-redesign-requires) to
   `understandingPrompt` in `project-understanding-service.js`. This is the only
   backend edit the redesign asks for, and it is prompt copy, not architecture.

2. **Client guard (belt and braces).** A forbidden-term list — *persistence,
   authentication, delegated, application-owned, session, runtime, topology,
   provider strategy, schema, ORM, framework, middleware, stateless* — is
   checked against every rendered question and suggestion. A hit does **not**
   rewrite the text; it logs a design-defect warning in development and renders
   the question inside a `Needs plain language` review flag visible only when
   `?design-review=1` is set. The point is to catch regressions in review, not
   to silently paper over them in front of a customer.

### Submission

One `POST /missions/:id/clarify` with the full answer set — matching current
behaviour (`page.tsx:442-451`). Response is `202`; `profileVersion` increments
and the customer sees §5 again with "Updated with your answers." If
`openQuestions` is then empty, the surface advances to §10.

Answered questions do not vanish. They collapse into a `Your decisions` list
above the brief, each row showing the question, the chosen answer, and a
`Change` link that re-expands it. This is how assumptions stay editable later.

---

## 8. Foundry recommendations

**Tier 1.**

The recommendation *voice* is what makes Foundry feel like a designer rather
than a form. Three placements, all Tier 1:

1. **Inside every question** — the `Foundry decides` option, showing the actual
   recommendation rather than a vague "let Foundry choose."
2. **`Already in the plan`** (§5) — capabilities included without asking, framed
   as professional judgement already exercised.
3. **`How it's put together`** (§10) — architecture stated as a decision with a
   reason, in plain language.

Rules that prevent "generic or system-generated" feel:

- A recommendation always names the specific thing it applies to. "Email and
  password with a secure reset" — not "the standard option."
- A recommendation always carries a *because*, drawn from real profile data
  (`architectureDecisions`, `constraints`, `outcomes`) — never a template.
- Foundry never recommends more than one thing per decision. Ranked lists are
  the absence of a recommendation.
- Never hedge. No "you may want to consider." Foundry decided; the customer can
  overrule.

---

## 9. Optional enhancements

**Tier 1.**

**Purpose.** Turn `profile.contextualSuggestions` from a checkbox list into
recommendations with stated value.

```text
   Worth adding                                          [title-m]
   Ideas that fit this specific project. Pick any — I'll fold
   them into the plan and into what I test.               [body-m]

   ┌────────────────────────────────┐ ┌────────────────────────────────┐
   │ Cancellation window        [+] │ │ Email confirmations        [+] │
   │ Clients cancel themselves up   │ │ Clients get a record of the    │
   │ to 24 hours before, so the     │ │ booking and stop calling to    │
   │ desk stops fielding calls.     │ │ check.                         │
   └────────────────────────────────┘ └────────────────────────────────┘
```

- Source: `profile.contextualSuggestions[]` — `label` as the title, `rationale`
  as the value line. The model is required to return at least three
  (`project-understanding-service.js:109`), so this section always has content.
- Cards are **toggles**, not checkboxes. Selected state: `--accent-tint` fill,
  `--accent-line` border, `[+]` becomes `[✓]`. Never a bare native checkbox as
  in `page.tsx:474`.
- Grouped by theme per project family (§2.7) when there are more than four
  suggestions; ungrouped below that. Group headings come from the family table,
  never from the model.
- Selection is submitted through the existing mechanism
  (`page.tsx:436-441`): one clarify answer per selected suggestion, keyed by
  `suggestionId`. Preserve that exact payload shape.
- Deselecting before submit is free. After submit, a selected idea appears in
  the brief under "Ideas you added" with a `Remove` link that submits a
  corrective clarify answer.
- Empty selection is the default and is never nagged.

---

## 10. Decision brief

**Tier 1.**

**Purpose.** The last screen before real work. It must read like a brief from a
consultancy — short, decisive, complete.

```text
   Before I start                                        [micro eyebrow]
   The plan                                              [display-l]

   What I'll build          Studio Booking — a booking site where clients
                            pick a service, choose a real available time,
                            and confirm without phoning.

   Who it's for             Studio clients · Studio owner · Front desk

   How people will use it   1. Pick a service
                            2. See real availability
                            3. Book and get a confirmation
                            4. Owner reviews the day

   How it's put together    A web application with its own database, built
                            the way it would really ship, running on your
                            machine.
                            ▾ Technical shape

   Your decisions           Sign-in · Email and password        [Change]
                            Reminders · Left to me              [Change]

   Ideas you added          Cancellation window                 [Remove]

   What I'm assuming        • One studio location
                            • Times shown in your local timezone
                            • Staff members are not individually bookable
                            Change an assumption

   What I'll prove          12 things, including:
                            ✓ A client can complete a booking end to end
                            ✓ A booking still exists after a refresh
                            ✓ The site works at phone width
                            ✓ No blocking errors in a real browser
                            Show all 12

   ┌ Start building → ┐  Change something   Add a note   Reconsider this
```

**Field mapping.**

| Region | Source |
|---|---|
| What I'll build | `profile.name` + `profile.summary` |
| Who it's for | `profile.primaryActors` |
| How people will use it | `profile.outcomes` |
| How it's put together | Plain-language sentence composed from `profile.family` + persistence capabilities; the raw `selectedStack` goes inside `Technical shape` |
| Your decisions | Answered `openQuestions` from prior versions |
| Ideas you added | Selected `contextualSuggestions` |
| What I'm assuming | `profile.constraints` + `profile.architectureDecisions` translated |
| What I'll prove | `profile.verificationPlan.checks[].label` — verbatim, already human-readable |

**Architecture in plain language.** `page.tsx:579` currently prints
`nextjs-typescript-sqlite-npm-playwright`. Replace with a composed sentence, and
put the truth one disclosure away:

> A web application with its own database, built the way it would really ship,
> running on your machine.
>
> ▾ **Technical shape** — Next.js 15.4.4 · TypeScript · SQLite · npm ·
> Playwright for browser testing. Chosen because it's the stack Foundry has
> certified end to end: generate, build, run, test, and observe.
> Known limits: SQLite suits a single application instance; browser testing
> targets Chromium-family browsers.

The known limits are real (`toolchain-stack.js:503`) and belong here, not hidden.

**Actions.**

- `Start building` — primary, `POST /missions/:id/start`.
- `Change something` — scrolls to `Your decisions`, expands the first one.
- `Add a note` — a textarea submitting a clarify answer keyed
  `customer-note`; content is additive context, not a question answer.
- `Reconsider this` — submits a clarify answer keyed
  `customer-reconsider` with the text *"Reconsider the plan and tell me if
  you'd do it differently."* Foundry returns a new `profileVersion`.
- The existing `Change an assumption` textarea (`page.tsx:625-654`) is preserved
  as the inline affordance under `What I'm assuming`, keyed
  `customer-assumption-change` exactly as today.

---

## 11. Start-building transition

**Tier 1.**

`POST /missions/:id/start` returns `202` and the worker takes time to produce
its first ledger event. That gap is currently a dead screen. Design it as a
deliberate handoff, 1.2–4s, ending as soon as the first activity arrives:

1. On click, the brief's content fades to 0 opacity over 180ms (opacity only —
   no transform, no text movement).
2. The phase spine draws in, all nine phases at rest, `Understanding the
   product` already complete.
3. Centre line, `title-l`: *"Starting work on Studio Booking."*
   Below, `body-m`, `--ink-tertiary`: *"You can leave this page. I'll keep
   going and everything is recorded."*
4. First real activity arrives → the transition is replaced by §12. If nothing
   arrives within 20s, show the honest waiting line: *"The build worker hasn't
   reported yet. This is recorded and safe to leave."* with a `Stop` action.

No progress bar. A fake bar during a genuinely unknown wait is the kind of
invention this redesign forbids.

---

## 12. Active execution

**Tier 1.** The most important screen.

**Layout — no preview yet (single column, content max 820px):**

```text
   Studio Booking                          Building · 4 min   [Stop]
   ─────────────────────────────────────────────────────────────────
   ✓ Understanding what you need
   ✓ Designing the experience
   ✓ Creating the application structure
   ● Building the main workflows                              ← now
   ○ Connecting data
   ○ Preparing it to run
   ○ Running the application
   ○ Testing important actions
   ○ Verifying the result
   ─────────────────────────────────────────────────────────────────

   Building the main workflows                        [display-l]
   So a client can pick a time and actually get a booking. [title-s, secondary]

   ▾ Engineering details
```

**Layout — preview live (two columns, 60/40, dock right):**
the spine compresses to a horizontal 9-dot rail with the current phase labelled,
the "now" block moves under it, and the preview dock owns the right column at
full height.

**The "now" block.** One phase name at `display-l`, one *why* line at
`title-s`. The why line is the redesign's answer to "progress does not
communicate meaningful engineering outcomes." It is composed from the profile,
not from a filename:

| Phase | Why line pattern |
|---|---|
| Designing the experience | "Working out the pages and how people move between them." |
| Creating the application structure | "Setting up the project so everything has a place." |
| Building the main workflows | "So {outcomes[0], lowercased}." |
| Connecting data | "So {dataConcepts[0]} is saved and still there after a refresh." |
| Preparing it to run | "Installing what it needs and building it the way it would really ship." |
| Running the application | "Starting it for real and waiting until it actually answers." |
| Testing important actions | "Doing the things a real person would do, in a real browser." |
| Verifying the result | "Checking every promise I made in the plan." |

**Completed phases** carry a `✓` and, where the phase produced verified
obligations, a quiet count: `✓ Connecting data · 3 proved`. That count comes
from `executionMetrics.verifiedObligationIds` intersected with the checks whose
labels belong to that phase. If the intersection can't be computed, show no
count — never a fabricated one.

**Not shown by default.** Filenames, shell commands, raw logs, evidence ids,
provider payloads, lifecycle enums, token counts, tool calls, install/rebuild/
restart counters. All of it moves into §14. The band at `page.tsx:709-720` is
deleted from the customer surface.

**Header.** Project name, customer phase, elapsed time, and `Stop`. Elapsed is
computed from the first activity's `occurredAt`, updating every 10s (not every
second — a per-second timer is anxiety, and it repaints text).

**`Needs you` slot.** Directly under the header, zero or one card, ever
(§15, §18). When present it is `--attention` accented and receives focus.

**Live region.** The "now" block is `aria-live="polite"`, `aria-atomic="true"`,
announcing "`{phase}`. `{why}`" on change. Individual activities are **not**
announced — that produced a screen-reader firehose in the current build.

**Stop.** Opens the confirm sheet (§15 pattern), then
`POST /missions/:id/stop` → `CANCELLED` (§30).

---

## 13. Preview workspace

**Tier 1** for web; other variants **Tier 2**.

**Appearance rule.** The dock does not exist until `mission.previewUrl` is
non-null — which the backend only sets after a real HTTP readiness observation
(README.md:69). No placeholder occupies the space beforehand. This is the fix
for both "screens contain too much empty space" and "preview and activity
compete."

**Dock shell.**

```text
┌ Preview ──────────────────── [◧] [⤢] [↗] [⟳] [✕] ┐
│ ┌───────────────────────────────────────────────┐ │
│ │                                               │ │
│ │            real iframe, no chrome             │ │
│ │                                               │ │
│ └───────────────────────────────────────────────┘ │
│ Live · localhost:4310                             │
└───────────────────────────────────────────────────┘
```

Controls, left to right: width preset (desktop / tablet / phone), expand to
full-bleed, open in a new tab (`previewUrl`), reload the frame, collapse.
Collapsed state is a 44px-tall bar reading `Preview · Live` with a restore
control — it never disappears entirely once it has existed.

Resize: drag handle on the dock's left edge, 480px min, 70% max, snapped to
whole pixels on release (fractional dock widths blur adjacent text at 125%).
Width persists per project in `localStorage`.

**Runtime states**, mapped to real values from
`src/domain/runtime-preview.js:12` (`READY`, `STARTUP_FAILED`, `HEALTHY`,
`CRASHED`, `STOPPED`):

| State | Trigger | Presentation |
|---|---|---|
| Waiting | no `previewUrl` | dock absent |
| Starting | `READY`, frame not yet loaded | dock present, warm shimmer panel (no spinner), "Starting it up" |
| Live | `HEALTHY` + frame loaded | iframe, footer "Live · {host}" with a `--verified` dot |
| Rebuilding | new build while a URL exists | iframe dimmed to 40%, footer "Rebuilding — this preview is from a moment ago" |
| Disconnected | frame load error, URL still set | last good frame retained if possible, footer "Lost the connection" + `Reconnect` |
| Crashed | `CRASHED` | frame replaced, "It stopped running. I'm looking at why." — repair narrative takes over (§17) |
| Stopped | `STOPPED` or terminal mission | "The preview isn't running any more." + `Open the project folder` [Tier 2] |
| Error | `STARTUP_FAILED` | "It didn't start." + the plain cause + repair narrative |

**Variants by family.** Only the first is Tier 1 — the rest must be gated behind
a real capability probe and must not appear as inert tabs:

| Family | Treatment | Tier |
|---|---|---|
| Web application / website | iframe + width presets | **1** |
| Web API | Endpoint console: obligation-derived request list, real response body, status, timing | 2 |
| Game (web) | iframe, fixed aspect, focus-capture warning | 2 |
| Mobile application | Declined (§31) — no preview is designed | — |
| Desktop application | Declined (§31) | — |
| Command-line tool | Transcript pane | 2 |
| Database / schema artifact | Entity summary + row sample | 2 |

Where a Tier 2 variant is not yet available for a project Foundry *did* build,
the dock shows the honest line: *"I can't show this kind of project in a preview
yet. The real thing is in your project folder."*

---

## 14. Engineering details

**Tier 1.** Nothing is lost; everything is one click away.

A single `<details>` disclosure, closed by default, at the bottom of the build
and delivery surfaces. Summary: `Engineering details`, with a quiet
`--ink-tertiary` count when relevant ("Engineering details · 47 records").

Sections, in order, each independently collapsible:

1. **Activity** — the full ledger-derived list from `server.mjs:296-413`,
   newest first, with `kind`, `title`, `detail`, timestamp. This is the current
   `page.tsx:732-743` list, moved here intact.
2. **Model routing** — the complete `modelRouting` table: provider, model,
   task class, depth, status, attempt, routing reason, input/output tokens,
   known cost. Preserved exactly as `page.tsx:750-778`, including the honest
   "cost unavailable locally" fallback.
3. **Counters** — `executionMetrics` in full: provider calls, unique repair
   hypotheses, repeated pipeline cost, installs, reinstalls, rebuilds, runtime
   restarts, repair scopes. Moved out of the hero band.
4. **Verification** — every obligation: id, plain label, verdict, evidence
   references.
5. **Workspace** — mission id, workspace id, checkpoint references, stack id and
   version, runtime adapter id.

Rules: monospace only inside this disclosure. Open/closed state persists per
project. Opening it never changes the layout of anything above it (it appends,
it does not reflow the spine). Content is virtualised past 200 rows.

---

## 15. Approvals

**Tier 2**, except *Delete a project* and *Stop the build*, which are **Tier 1**
and use the same component.

**Purpose.** Replace `window.confirm` (`page.tsx:1013`) with one designed
component covering every irreversible or consequential action.

**Approval card anatomy.** Appears in the `Needs you` slot (§12), never as a
modal over the build — an approval is part of the work, not an interruption of
it. Only a genuinely blocking, no-context action (delete from Home) uses a
centred sheet.

```text
┌ Needs you ─────────────────────────────────────────────────────┐
│ I need to install a browser to test this                       │
│                                                                 │
│ What         Download and install Chromium for browser testing. │
│ Why          Your plan promises the booking form works in a     │
│              real browser. I can't prove that without one.      │
│ Impact       About 140 MB, on this machine only. Nothing        │
│              leaves your computer.                              │
│                                                                 │
│ ┌ Install it → ┐   Skip browser testing   Not now              │
│   Recommended       Removes 3 promises      Build pauses        │
└─────────────────────────────────────────────────────────────────┘
```

Every approval states **what / why / impact**, offers a **recommended** primary,
and names the real consequence under each alternative. That consequence line is
mandatory — an approval without stated consequences is a dark pattern.

**Approval catalogue.**

| Approval | Tier | Recommended | Stated consequence of declining |
|---|---|---|---|
| Install a tool | 2 | Install | Named promises are removed from the plan |
| Use a stored credential | 2 | Use it | The feature needing it is dropped |
| Create a paid resource | 2 | Decline by default | — cost is never opt-out |
| Deploy publicly | 2 | Decline by default | Project stays local |
| Delete or replace data | 2 | Show what will be lost | — |
| Delete a project | **1** | Cancel | "Removed from your projects. The audit history stays on disk." |
| Stop the build | **1** | Cancel | "Work so far is kept. You can reopen and start again." |
| Irreversible action (generic) | 2 | Cancel | Explicit, per action |

**Rules.**

- One approval demands attention at a time. A second queues, with a quiet
  `1 more waiting` marker — never stacked cards.
- Approvals never time out silently. An expiring approval says what happens on
  expiry.
- Paid and public actions default to the *safe* choice, and the destructive or
  costly option is never the visually dominant one.
- Focus moves to the approval card's heading on appearance; `Escape` chooses the
  safe option; the safe option is the default focus target.

---

## 16. Credentials and integrations

**Tier 2.** Designed, deliberately inert today.

Foundry reads credentials from the local `.env` and, by explicit architectural
decision, never returns them to the browser or writes them to the Ledger
(README.md:33-35). A credentials UI that appeared to *manage* keys would
misrepresent the system.

**What ships now (Tier 1):** a read-only truth surface in Settings → Model
providers, driven by `GET /providers`. Per provider: display name, whether a
credential is present, whether its format is valid, health, availability, and
the honest `reason` string. Never the key, never a masked key, never an input.

Copy: *"Foundry reads provider keys from the `.env` file in your project folder.
They stay in the local server process — they're never sent to this page and
never written into your project's history."*

**What is designed for later (Tier 2):** a `Connections` surface where a
customer authorises a third-party service a project needs (payments, email
sending, calendars). Design constraints, settled now:

- Foundry never displays, stores in the browser, or logs a secret.
- Every connection is requested *in context*, as an approval (§15), naming the
  feature that needs it: "Email confirmations need a way to send email."
- A connection can be declined; the dependent feature is then visibly removed
  from the plan rather than silently failing.
- Connection state is per project, and shown in the delivery card's limitations
  when absent.

Until the backend supports it, `Connections` is not rendered at all. It does not
ship as a disabled tab.

---

## 17. Automatic repair

**Tier 1.**

**Purpose.** Make bounded, evidence-grounded repair legible and calm. Foundry's
repair machinery is real (`src/domain/repair.js`, `diagnosis-repair-strategist.js`)
and is a genuine differentiator — the customer should feel a professional
handling a problem, not a machine erroring.

**Placement.** Inline, attached to the interrupted phase in the spine. The spine
does not regress. The phase row gains an `--attention` dot and a nested repair
narrative:

```text
   ● Testing important actions
     ↳ A booking didn't save the way the plan promised.
       I found the likely cause.
       I'm correcting the affected part.
       I'm rerunning only the checks that matter.
```

Lines appear as real repair events arrive — never all four at once, never on a
timer. Each line replaces the previous as the active one; earlier lines stay
visible at `--ink-tertiary`. Raw error text is never shown here; it is in §14.

**Repair states**, mapped to the real domain vocabulary
(`repair.js:56` — `BUDGET_EXHAUSTED`, `STRATEGIES_EXHAUSTED`,
`EXTERNAL_BLOCKER`; `RepairVerificationResult` — `COMPLETE`, `INCOMPLETE`):

| State | Copy | Tone |
|---|---|---|
| Automatic repair | "A workflow didn't behave as expected. I found the likely cause. I'm correcting the affected part." | Calm, cause-first |
| Different strategy | "That correction didn't hold. I'm trying a different approach." | Matter-of-fact, no apology |
| Budget warning | "I've tried three approaches to this. Two attempts remain before I stop and tell you what I know." | Honest, sets expectation |
| Customer action required | Escalates to `Needs you` (§15/§18) with the specific thing needed | Direct |
| External service unavailable | "Something outside your project isn't responding: {service}. This isn't a problem with your build." | Clearly not the customer's fault |
| Verification incomplete | "I fixed the failure, but I couldn't re-prove {n} promises. I won't call those done." | Precise |
| Honest exhaustion | "I stopped. I couldn't make this work, and I won't tell you it's done." + what I proved / what I couldn't / what I'd try next / what I need from you | Owned, not defeated |

**Rules.**

- Never show a raw error, stack trace, or classification enum by default.
- Never use "Oops", "Something went wrong", or an apology. Foundry states the
  situation and what it's doing about it.
- Repair is never presented as failure while it is still bounded and running.
- The repair narrative is `aria-live="polite"`.

---

## 18. Blocked states

**Tier 1.**

`BLOCKED` means Foundry genuinely cannot proceed without the customer
(`lifecycle.js:47-51, 70-75`). It is the only state that stops work and waits.

Presentation: the `Needs you` slot, `--attention`, focused on arrival, with the
build spine frozen at its current phase and visibly paused (not spinning).

```text
┌ Needs you ─────────────────────────────────────────────────────┐
│ I need a decision before I can carry on                        │
│                                                                 │
│ What's blocking   The plan promises email confirmations, and    │
│                   there's no way to send email on this machine. │
│ What I'd do       Build the confirmation on screen now and      │
│                   leave email for when you have a mail service. │
│ What I need       Either confirm that, or tell me a different   │
│                   way you want it handled.                      │
│                                                                 │
│ ┌ Do it your way → ┐   Something else…   Stop this build       │
│   Recommended                                                   │
└─────────────────────────────────────────────────────────────────┘
```

`Do it your way` and `Something else…` submit a clarify-shaped answer where the
API allows it; where the mission has advanced past clarification, the primary
resolves to `Stop this build` + `Start a new version with this decision`
[Tier 2 for true in-place resume].

Every blocked state must name: what is blocking, what Foundry would do, and
exactly what it needs. A blocked state that says only "blocked" is a defect.

---

## 19. Follow-up requests

**Tier 2** for true in-place iteration. **Tier 1** for the honest interim.

The brief's requirement — "Make the buttons larger", "Add a customer login",
"Undo the last change", "Continue" — has no backend support:
`POST /clarify` is rejected outside `INTAKE`/`CLARIFYING`
(`project-understanding-service.js:421-428`), and `SUCCEEDED` has no legal
transitions (`lifecycle.js:76`). Designing this as though it works would be
exactly the fake capability the brief forbids.

**Designed target (Tier 2).** A composer pinned to the bottom of the delivered
project surface. On submit, the prior work collapses into a titled, timestamped
band and the new request opens beneath it as a new act on the same surface,
inheriting profile, decisions, workspace, and verification history. Old bands
stay expandable forever. Requirements for the backend capability this needs:
accept new intent against a delivered mission; carry the workspace checkpoint
forward; produce a new contract version; re-verify only affected obligations.

**Honest interim (Tier 1).** The same composer, in the same place, with truthful
mechanics:

- Placeholder: "Make the buttons larger"
- On submit, Foundry creates a **linked follow-up project** via
  `POST /missions` whose intent carries the prior context explicitly:
  the previous summary, the resolved decisions, and the new request.
- The customer sees this stated plainly, before submitting, at `caption` size:
  *"I'll start a new version and carry this project's plan and decisions into
  it. The files from this build stay where they are."*
- The delivery card gains a `Versions` list linking every prior and subsequent
  version of the project, so continuity is real in the customer's mental model
  even though the workspace is not yet continuous.

This is a genuine partial capability, labelled as exactly what it is. `Undo the
last change` is **not** offered at Tier 1 — checkpoints exist internally but no
customer-facing revert endpoint does, and an undo button that starts a new
project would be a lie.

`Explain why you chose this architecture` **is** Tier 1: it needs no new
capability, because the answer is already recorded in
`profile.architectureDecisions` and the stack rationale. It renders as an
expandable answer in place, not as a new mission.

---

## 20. Mission continuity

**Tier 1.**

Continuity is delivered by structure, not by a feature:

- **One URL per project**, `/project/:missionId`. Reload, back, forward, and
  bookmarks all land on the correct act, because the act is derived from state.
- **Leaving is safe, and the product says so.** The line "You can leave this
  page. I'll keep going and everything is recorded" appears in §11 and §12.
  It is true: understanding and execution both run as recoverable background
  jobs (`server.mjs:809-818`).
- **Returning restores position.** Scroll position, `Engineering details`
  open/closed state, and preview dock width persist per project.
- **Nothing is destroyed by progress.** Answered decisions collapse into
  `Your decisions`; completed phases stay in the spine; prior versions stay in
  `Versions`. Collapse is always reversible.
- **Recovery is visible, not hidden.** When a mission resumes after a restart,
  the build surface shows a single quiet line: *"Picking this back up where it
  stopped."* Rather than pretending nothing happened.
- **An unrecoverable intake is stated honestly.** `server.mjs:800-806` produces
  a real message for missions that fail Ledger integrity; render it in the
  failure surface with the `Start a replacement` action it implies.

---

## 21. Mission completion

**Tier 1.**

**Purpose.** Make delivery feel like receiving work from a professional.

```text
   Studio Booking                                        [micro eyebrow]
   Your booking site is ready.                     [display-xl, serif]

   ┌───────────────────────────────────────────────────────────┐
   │                                                           │
   │              real preview, full width, live               │
   │                                                           │
   └───────────────────────────────────────────────────────────┘
     [Open it ↗]  [Desktop | Tablet | Phone]

   What you got             A booking site where clients pick a service,
                            choose a real available time, and confirm.
                            Runs on your machine with its own database.

   What I proved            12 of 12                    [--verified]
                            ✓ A client can complete a booking end to end
                            ✓ A booking still exists after a refresh
                            ✓ The site works at phone width
                            ✓ No blocking errors in a real browser
                            Show all 12

   Decisions I made         Sign-in · Email and password — you chose this
                            Reminders · On-screen only — my call, because
                            there's no mail service on this machine
                            Timezone · Your local timezone

   What I didn't do         • Email confirmations — needs a mail service
                            • Staff members aren't individually bookable
                            • Built for one studio location

   What I'd do next         Add staff calendars  ·  Add a deposit at booking
                            Send confirmations by email

   ┌ What next? ─────────────────────────────────────────────┐
   │ Make the buttons larger                                 │
   └─────────────────────────────────────────────────────────┘

   ▾ Engineering details
```

**Field mapping.**

| Region | Source |
|---|---|
| Headline | Family-specific delivery sentence, project name substituted |
| Preview | `previewUrl`, full width — the artifact is the hero |
| What you got | `profile.summary` + plain capability sentence |
| What I proved | `verificationPlan.checks[].label` filtered to `SATISFIED` verdicts, with `n of m` |
| What I couldn't check | `UNVERIFIABLE` verdicts — separate, never merged into proved |
| Decisions I made | Answered questions (attributed to the customer) + `Foundry decides` answers (attributed to Foundry, with the reason) |
| What I didn't do | `profile.constraints` + declined suggestions + stack `knownLimitations` where customer-relevant |
| What I'd do next | Unselected `contextualSuggestions` |

**Rules.**

- `n of m` must be literal. If 11 of 12 held, the headline is not "ready" — it
  is the incomplete variant (§29), because `CompletionResult` is
  `COMPLETE`/`INCOMPLETE` and the gate is evidence-backed.
- "What I didn't do" is never empty and never softened. If Foundry made a
  judgement call the customer didn't ask for, it says so and says why.
- Attribution matters: a decision Foundry made on the customer's behalf is
  labelled "my call, because {reason}". This is what makes `Foundry decides`
  trustworthy rather than opaque.
- No technical evidence on this surface. It is all in §14.

---

## 22. Project reopening

**Tier 1.**

Opening any project renders the act its state implies, immediately, with no
intermediate loading screen when data is already cached from the catalogue list.

- Delivered project → §21, preview attempting to reconnect. If the runtime is
  gone (the common case — the dev runtime does not survive), the preview slot
  states it plainly: *"The preview isn't running any more."* with `Open the
  project folder` [Tier 2]. This is the honest replacement for
  `page.tsx:810-812`.
- Mid-build project → §12, live, polling resumed.
- Waiting-on-you project → §7, scrolled and focused on the first open decision.
- Stopped project → §29, with everything that was proved before it stopped.
- Deleted project (`410` from `GET /missions/:id`, `server.mjs:886`) → a plain
  surface: *"This project was deleted."* + `Start something new`.

Verification history, decisions, and the plan are all reconstructed from
persisted records and remain readable in every reopened state.

---

## 23. Search

**Tier 1.**

Backed by the real `GET /missions?q=` parameter (`server.mjs:841`).

- Entry: a field in the Projects header, and `⌘K`/`Ctrl+K` from anywhere.
- Debounce 200ms, minimum 2 characters, request cancelled on new input.
- Results are project cards (§2), identical in shape to the unsearched list —
  no separate result row design to maintain.
- Matched substrings in name and summary are marked with `<mark>` styled as
  `--accent-tint` background, not bold (bold reflows text and blurs on Windows).
- Empty result: *"Nothing matches '{q}'."* + `Clear search` + the composer,
  because a failed search is a good moment to start something.
- Search state lives in the URL (`?q=`), so results are shareable and survive
  reload.
- Zero-latency perception: the previous result set stays visible, dimmed to 60%,
  while a new query is in flight. Never a spinner over the list.

---

## 24. Project history

**Tier 1.**

The Projects surface is the full catalogue: a responsive card grid, newest
`updatedAt` first, with a phase filter (All · Building · Needs you · Delivered ·
Stopped) implemented client-side over the already-fetched list.

Per project, history is available on the project surface itself as a
`Versions` list (§19) plus the `Engineering details` activity record (§14).
There is no separate history page — history belongs to the project, not to a
reporting section. A project-management dashboard is explicitly what this
product must not become.

Empty state: §27.

---

## 25. Provider and model transparency

**Tier 1.** Kept in full, relocated.

Foundry's routing honesty is a real asset and the current copy is already
careful (`page.tsx:205-210`). Three placements:

1. **During understanding** (§28) — the model actually thinking, named:
   *"{provider} · {model} is reading your request."* Sourced from
   `activeModelRoute`. This is the one place a model name earns front-of-house
   placement, because it explains a wait.
2. **Rail footer chip** — `{n} providers ready`, opening Settings → Model
   providers. Quiet, `caption` size, `--ink-tertiary`. It is not a nav item.
3. **Settings → Model providers** — the current provider panel content, moved
   from a modal to a real surface: per-provider availability, health, the honest
   `reason`, discovered models with status, and `Validate providers again`
   (`POST /providers/refresh`).

The existing disclaimer is preserved verbatim in spirit and must remain:
these are live-discovered routing candidates, not models fixed to a mission;
Foundry chooses per model call; provider billing is authoritative.

Per-call routing detail — task class, depth, attempt, tokens, cost — stays in
§14 exactly as today, including "cost unavailable locally."

---

## 26. Settings

**Tier 1** for Model providers (read-only). **Tier 2** for everything else,
because no settings persistence exists at any layer.

Structure, when it ships:

- **Model providers** — Tier 1, as §25.
- **Appearance** — Tier 2. Text size (Default / Large), reduced motion
  (Follow system / Always). Both are accessibility affordances, so when Tier 2
  lands they persist in `localStorage` and need no backend.
- **Connections** — Tier 2, as §16. Not rendered until real.
- **Data** — Tier 2. Where projects live on disk, and how to remove them.
- **About** — Tier 1. Version, what Foundry can and cannot build today, and the
  known limits from the stack manifest. This surface is where the capability
  boundary is stated in full, once, plainly.

Settings is reached from the rail footer, not from a top-level nav slot.

---

## 27. Empty states

**Tier 1.** Every empty state does work: it says what belongs here and offers
the one action that fills it. None is decorative, none has an illustration.

| Surface | Copy | Action |
|---|---|---|
| Home, no projects | "Nothing here yet. Your first project will appear here and stay resumable." | — (composer above) |
| Projects, no projects | "You haven't started anything yet." | Composer, inline |
| Search, no matches | "Nothing matches '{q}'." | `Clear search` |
| Decisions, none needed | "That's enough to begin — nothing here materially changes what I'd build." | `Review the plan` |
| Worth adding, none | *(section omitted entirely — the model guarantees ≥1, so this is a defect path)* | — |
| `Needs you`, nothing | *(slot absent — never "no items")* | — |
| Preview, not yet real | *(dock absent — never a placeholder frame)* | — |
| Engineering details, no routes | "No model route has been recorded yet." | — |
| Versions, single version | *(section omitted)* | — |

---

## 28. Loading states

**Tier 1.** Three kinds only.

1. **Skeletons** — for known-shape content arriving fast (<2s): project cards,
   the understanding card. Warm `--surface-inset` blocks at the real content's
   dimensions, opacity-pulsing 1.6s. Never a spinner where a shape is known.
2. **Narrated waits** — for genuinely slow, meaningful work. Understanding is
   the canonical case:

   ```text
        Reading your request
        Anthropic · claude-sonnet-4 is working out what you need.

        This is already recorded. You can leave and come back.
   ```

   Sourced from `activeModelRoute`; falls back to *"Choosing a model for this"*
   when null. No progress bar — the duration is genuinely unknown.
3. **In-place busy** — a control that has been pressed shows its own state
   ("Starting…") and stays the same size. Never a full-surface overlay for a
   local action.

Rules: nothing shows a loading state for under 200ms (flash guard). A wait past
20s gains an honest line and an escape action. `prefers-reduced-motion` replaces
all pulsing with a static state plus text.

---

## 29. Failure states

**Tier 1.** Foundry's integrity is that it reports real failure
(README.md:120-122). The design must make that feel like professionalism.

**Structure — every failure surface, without exception:**

1. What I was doing
2. What happened, in plain language
3. **What I did prove** — the surviving value, never omitted
4. What I couldn't prove
5. What I'd try next
6. What I need from you
7. `Engineering details` (§14) for the real evidence

| Failure | Headline |
|---|---|
| `FAILED` | "I stopped, and I couldn't finish this." |
| `EXHAUSTED` | "I ran out of safe approaches." |
| Verification `INCOMPLETE` | "It's close, but {n} of {m} promises didn't hold. I won't call it done." |
| Understanding failed | "I couldn't work out what you need from that." + `Try again` (`POST /understand`) + `Reword it` |
| Provider unavailable | "No model provider is answering right now." + `Re-check providers` |
| API unreachable | "I can't reach the Foundry service on this machine." + the real start command |
| 30s timeout (`page.tsx:130-134`) | "Foundry didn't answer within 30 seconds. This project is recorded and safe to reopen." |
| Ledger integrity failure | The real message from `server.mjs:800-806` + `Start a replacement` |
| `410` deleted | "This project was deleted." + `Start something new` |

Never: "Oops", "Something went wrong", an apology, a sad face, a raw stack
trace, or an error code as the headline. The headline is always what it means for
the customer's project.

---

## 30. Cancelled states

**Tier 1.**

`POST /missions/:id/stop` → `CANCELLED`. Cancellation is a legitimate outcome,
not a failure, and must not be styled like one — neutral `--ink-tertiary`
accent, never `--fault`.

```text
   You stopped this build.

   What I finished       ✓ Understanding what you need
                         ✓ Designing the experience
                         ✓ Creating the application structure

   What I proved         4 of 12 promises held before I stopped.

   The plan is saved     Every decision and assumption is still here.

   ┌ Start again from the plan → ┐    Change the plan first    Delete
```

`Start again from the plan` is Tier 2 in-place; at Tier 1 it creates a linked
version carrying the plan forward (§19 mechanics), labelled honestly. The
`Stop` confirm sheet (§15) states this consequence *before* stopping, so
cancellation is never a surprise.

---

## 31. Unsupported-request states

**Tier 1.** The screen that proves Foundry is honest.

Trigger: `profile.platform !== "web"`, or `profile.family` in
`{mobile-application, desktop-application, game}` where the plan cannot bind to
the certified web stack.

Placement: replaces everything below the summary on the understanding surface,
so the customer still sees that Foundry *understood* them before it declined.

```text
   What I understand
   Studio Booking (iPhone app)
   A native iPhone app where clients book studio time.

   ┌───────────────────────────────────────────────────────────┐
   │ I can't build this one — and I won't fake it.              │
   │                                                            │
   │ You asked for a native iPhone app. Today I build web        │
   │ products: web apps, business websites, customer portals,    │
   │ internal tools, and web APIs. I could build something that  │
   │ looks close and doesn't run on a phone, but I'd rather      │
   │ tell you.                                                   │
   │                                                            │
   │ A web version would work on a phone's browser, and clients  │
   │ wouldn't need to install anything. If that's useful, I'll   │
   │ design that instead.                                        │
   │                                                            │
   │ ┌ Design a web version → ┐   Start something else          │
   └───────────────────────────────────────────────────────────┘
```

**Rules.**

- Name what they asked for, specifically. "Native iPhone app" — not
  "unsupported platform."
- State what Foundry *does* build, as outcomes, not as a stack.
- Offer one real alternative with its genuine benefit, and one exit.
- Never charge a second model call to repeat the decline.
- `Design a web version` submits a clarify answer stating the web constraint, so
  the customer keeps their original description and Foundry re-reads it.
- Never soften into "not yet supported — coming soon." Foundry does not promise
  a roadmap it does not control.

This surface is also the reason Home's chips changed (§1): the best unsupported
-request experience is not reaching it by accident.

---

## 32. Responsive — mobile (<768px)

See [07-responsive-and-accessibility.md](07-responsive-and-accessibility.md) for
the full rules. Key behaviours:

- Rail becomes a top bar (56px) with a hamburger opening a full-height sheet.
- Everything is one column. The preview becomes a full-screen sheet opened by a
  persistent `View preview` button in a bottom action bar.
- Question option grids go one-per-row, 48px minimum height.
- The phase spine collapses to the current phase plus `4 of 9 done`, expandable.
- The `Continue` / `Start building` primary is a sticky bottom bar with a safe
  -area inset.
- The build header condenses to project name + phase; elapsed and `Stop` move
  into an overflow.
- Delivery card sections stack, and the preview leads.

## 33. Responsive — tablet (768–1279px)

- Rail collapses to a 64px icon bar with accessible labels on focus and hover.
- Content is single-column at a 640px measure with 32px gutters.
- The preview is a **top segmented tab** (`Build` | `Preview`), not a side dock —
  a 40% dock inside 768px leaves neither pane usable.
- Question options stay two-per-row above 900px, one below.
- Two-column regions in the brief and delivery card become one column.

## 34. Responsive — desktop (≥1280px)

- Full 240px rail, collapsible to 64px and remembered.
- Content max 1100px, reading measure 720px, so long text never spans the full
  window.
- The preview docks right at 40% (min 480px, max 70%), drag-resizable, snapped
  to whole pixels on release.
- At ≥1680px the content column does not grow beyond 1100px; the extra space
  goes to the preview dock, because the artifact benefits and prose does not.

## 35. Accessibility behaviour

Specified in full in
[07-responsive-and-accessibility.md](07-responsive-and-accessibility.md).
Non-negotiables: WCAG AA contrast on every token pair in use, a visible
3px focus ring on every interactive element, full keyboard operation of
questions and the preview dock, correct focus management on the two sheets that
exist, one polite live region per surface (never more), plain-language
accessible names for every state, `prefers-reduced-motion` honoured everywhere,
and 44×44px minimum touch targets on mobile.
