# 9. Completing the vision

Refinement pass against the brief: *every interaction should feel like working
with an elite product designer, UX designer, software architect, principal
engineer, and QA engineer acting as one team.*

Visual language, design system, typography, and direction are unchanged.
Nothing was redesigned from scratch.

---

## 1. UX improvements shipped

### 1.1 The proposal now argues, rather than summarising

The discovery surface previously showed *what* Foundry would build. It now shows
what a designer would actually put in a proposal:

| Section | Source | What it does |
|---|---|---|
| Here's what I'm thinking | `name`, `summary` | Foundry speaks first, in its own voice |
| Here's what I'd build | `outcomes` | The complete product, numbered, editorial |
| Built in as standard | `capabilities` | Professional defaults included without asking |
| **The calls I made, and why** | `architectureDecisions` | Judgement calls **and the trade-off behind each** |
| **What I've deliberately left out** | `constraints` | Scope stated as a decision, not a caveat |
| I'd also recommend | `contextualSuggestions` | Curated advice with the benefit named |
| N things only you can decide | `openQuestions` | Last, and as few as possible |
| Does this sound right? | — | A conversational close, not a submit button |

The two bolded sections are new. Splitting decisions from exclusions is what
makes the proposal read as considered: *"The calls I made"* is only credible
next to *"what I deliberately left out"*. Both carry a lead-in that frames them
as already-weighed positions the customer may overrule — not as options.

Copy: *"These are decisions, not options. I've already weighed them — but if one
looks wrong for your business, say so and I'll rethink it."*
And: *"Knowing what a project isn't matters as much as knowing what it is. None
of this is an oversight — ask for any of it and I'll fold it in."*

### 1.2 Confidence is now instructed, not hoped for

The model is now required to write with the confidence of someone who has done
this many times — *"I'm confident this is the right approach"*, *"there are two
good options here and either works"*, *"I'd lean toward"*, *"this depends on how
you plan to grow"* — and explicitly forbidden from hedging with *"you may want
to consider"* or presenting a menu instead of a recommendation.

### 1.3 Build narration explains reasoning

Phase why-lines were descriptions of machine activity. They are now statements
of intent in Foundry's voice:

| Before | After |
|---|---|
| So bookings are saved and still there after a refresh. | **I'm connecting estimate requests to permanent storage so an inquiry is never lost between the form and your inbox.** |
| Installing what it needs and building it the way it would really ship. | …**not a development shortcut.** |
| Starting it for real and waiting until it actually answers. | **I won't show you a preview until it actually answers a request.** |
| Doing the things a real person would do, in a real browser. | **Driving it in a real browser the way a real person would, rather than trusting that it compiled.** |
| Checking every promise I made in the plan. | …**Anything that doesn't hold, I'll tell you about.** |

### 1.4 Completion is a handover

| Before | After |
|---|---|
| "Your project is ready." | **"It's built, and I've proved it works."** + a handover lead |
| Decisions I made | **Why I built it this way** — reasoning treatment, not bullets |
| What I didn't do | **What I left out on purpose** |
| What I'd do next *(flat chip list)* | **If this became Version 2** — *ordered*, each with its rationale |

Version 2 is numbered because sequence is real information: it is the order
Foundry would actually do the work in.

---

## 2. Updated interaction flow

```text
HOME
 → one sentence
   "I'll come back with a proposal before anything is built —
    and I'll tell you what I'd add that you didn't ask for."

WORKING OUT WHAT YOU NEED
   "I'm thinking through what a business like yours normally needs, so I can
    come back with a proposal rather than a list of questions."

THE PROPOSAL                         ← Foundry leads, customer reads
 1. Here's what I'm thinking          voice, name, summary
 2. Here's what I'd build             the complete product
 3. Built in as standard              defaults included unasked
 4. The calls I made, and why         decisions + trade-offs        [new]
 5. What I've deliberately left out   scope as a decision           [new]
 6. I'd also recommend                curated advice, benefit named
 7. N things only you can decide      as few as possible, last
 8. Does this sound right?            conversational close

THE PLAN                             ← the commitment
   what / who / how it's put together / decisions / assumptions /
   what I'll prove

THE BUILD                            ← reasoning, not activity
   nine phases, each narrated as intent
   repair inline, cause-first
   preview only once it really answers

THE HANDOVER                         ← not "done"
   what I built / why I built it this way / what I left out on purpose /
   if this became Version 2
```

---

## 3. Updated customer copy

```text
proposal decisions   The calls I made, and why
proposal lead        These are decisions, not options. I've already weighed
                     them — but if one looks wrong for your business, say so
                     and I'll rethink it.

left out             What I've deliberately left out
left out lead        Knowing what a project isn't matters as much as knowing
                     what it is. None of this is an oversight — ask for any of
                     it and I'll fold it in.

delivery h1          It's built, and I've proved it works.
delivery lead        Here's the handover: what I built, the calls I made and
                     why, what I left out on purpose, and where I'd take it
                     next.
delivery labels      What you got · What I proved · Why I built it this way ·
                     What I left out on purpose · If this became Version 2
version 2 lead       This is where I'd take it next, in the order I'd do it.

build · data         I'm connecting {concept} to permanent storage so nothing
                     anyone enters is lost.
build · prepare      Installing what it needs and building it the way it would
                     really ship — not a development shortcut.
build · run          Starting it for real. I won't show you a preview until it
                     actually answers a request.
build · test         Driving it in a real browser the way a real person would,
                     rather than trusting that it compiled.
build · verify       Checking every promise I made in the plan. Anything that
                     doesn't hold, I'll tell you about.
```

---

## 4. Updated mockups

- `docs/ux/preview/mockups.html` — links the live stylesheet, tracks the app.
- `docs/ux/preview/foundry-mockups-standalone.html` — self-contained, 0 external
  references, for sharing.

Both now show the new proposal sections, the handover, and the reasoning-led
build narration.

---

## 5. Precise implementation changes for Codex

### 5.1 Observations and alternatives — BLOCKED, and why

The brief's two headline requests cannot be implemented in the UI, because the
data does not exist and cannot be added without a migration.

**The blocker.** `src/domain/project-profile.js:283` validates with
`exactKeys(input, PROFILE_KEYS)` — an *exact* key match. That function runs on
profiles replayed from the Mission Ledger
(`project-understanding-service.js:348`). Adding a key to `PROFILE_KEYS` makes
**every already-persisted profile fail validation**, so every existing project
breaks on reopen.

Do not add a required field. The safe change, in order:

1. **`src/domain/project-profile.js`**
   - Add `observations` and `designAlternatives` to `PROFILE_KEYS`.
   - In `normalizeProjectProfile`, **default them before `exactKeys` runs**:
     ```js
     const input = {
       observations: [],
       designAlternatives: [],
       ...rawInput,
     };
     ```
     This is what makes old ledger records replay unchanged. Without it the
     change is a breaking migration.
   - Normalize `observations` with `uniqueMeaningfulTextList(..., { allowEmpty: true })`.
   - Normalize `designAlternatives` as objects with exact keys
     `["approach", "rationale", "recommended"]`, `recommended` boolean, and
     assert **at most one** `recommended: true`. Zero alternatives is valid and
     must stay valid — alternatives are only shown when genuinely useful.

2. **`src/understanding-plane/project-understanding-service.js`**
   - Add both to `understandingSchema.properties` and to `required`
     (the model must return them; empty arrays are acceptable).
   - Add to the profile object built around line 330.
   - Add two prompt lines:
     ```text
     Return two to four observations — things you noticed while reading the
     request that a business owner would find genuinely insightful. Observations
     are not questions and not assumptions: they are expertise. Examples of the
     register: most of these visitors will be on a phone mid-problem; people
     usually call before reading every page; this request implies two different
     audiences with different needs.

     When there is genuinely more than one good direction, return two or three
     designAlternatives with exactly one marked recommended, and say in each
     rationale what it optimises for and what it gives up. When one direction is
     clearly correct, return an empty array rather than inventing a choice.
     ```

3. **`apps/web/app/page.tsx`** — two new sections in `TheRead`, in this order:
   - **Observations**, immediately after the voice block and *before* the
     proposal, headed *"While reviewing your request, I noticed…"*. Render as
     `.reasoning` list items. Omit the section entirely when the array is empty.
   - **Alternatives**, after the proposal and before "The calls I made", headed
     *"I considered {n} directions"*. Render the recommended one first, marked
     `Recommended`, using the existing `.sug` treatment with the toggle removed;
     alternatives below at `--ink-secondary`. Close with the recommendation's
     rationale as the reason it wins. Omit when the array has fewer than two
     entries.

4. **`apps/web/tests/rendered-html.test.mjs`** — extend the order assertion in
   *"Foundry proposes before it asks"*: observations < proposal < alternatives <
   calls-I-made < left-out < recommendations < questions < confirmation.

5. **Regression test required.** Add a case asserting that a profile object
   *without* `observations` or `designAlternatives` still normalizes — this is
   the guard against the migration hazard above.

### 5.2 Already shipped in this pass

| Change | File |
|---|---|
| Confidence, trade-off, and exclusion instructions | `src/understanding-plane/project-understanding-service.js` |
| "The calls I made, and why" section | `apps/web/app/page.tsx` |
| "What I've deliberately left out" section | `apps/web/app/page.tsx` |
| `.left-out` treatment | `apps/web/app/globals.css` |
| Handover completion + ordered Version 2 | `apps/web/app/page.tsx` |
| Reasoning-led build narration | `apps/web/app/page.tsx` |
| Composer double-focus-ring fix | `apps/web/app/globals.css` |
| Home masthead, split layout, how-panel | both |

---

## 6. Self-critique — what still does not meet the vision

Honest assessment. These are real gaps, not hedging.

### 6.1 Not implemented at all

1. **Observations do not exist.** The single most distinctive item in the brief
   — *"While reviewing your request, I noticed…"* — is blocked on §5.1. Until it
   ships, Foundry demonstrates competence but never demonstrates *noticing*.
   This is the biggest remaining gap between the product and the vision.

2. **Alternatives do not exist.** *"I considered three directions"* is the
   moment a customer feels a designer weighed options on their behalf. Also
   blocked on §5.1.

3. **Foundry never speaks after the plan is agreed.** During the build it
   narrates phases, but it cannot say *"I noticed this flow could be simpler, so
   I'm adjusting it before testing."* That requires the execution engine to emit
   a design-judgement event, which it does not. Every build-time line is
   composed from the profile, so the build is the least "alive" part of the
   journey.

4. **No follow-up after delivery.** Still Tier 2, still no endpoint. The
   handover reads like the end of an engagement rather than the start of a
   relationship, which contradicts brief item 8 directly.

### 6.2 Implemented but weaker than the vision

5. **Section quality is entirely model-dependent and unverified.** The prompt
   now asks for generous proposals, trade-offs, deliberate exclusions, and
   confident voice. **I have not seen a single live response.** If the model
   returns three terse outcomes and two vague constraints, the surface will look
   exactly as sparse as before, with more headings. This is the highest-risk
   item in the entire pass and only a live run resolves it.

6. **"What I've deliberately left out" may not read as deliberate.**
   `constraints` was historically written as assumptions and caveats. I changed
   the prompt's instruction, but old profiles and a non-compliant model will put
   *"times shown in local timezone"* under a heading promising intentional scope
   decisions — which would actively undermine the section.

7. **Recommendations are a flat list.** The brief asks for curated advice, and
   the copy delivers, but there is no ranking, no *"if you only do one of
   these"*, and no sense of relative value. A principal engineer would tell you
   which one matters most.

8. **Questions still look like a form, structurally.** Flattened, reasoned, and
   skippable — but still a prompt with options below it. The brief asks for
   conversational discovery; this is a well-mannered question, not a
   conversation.

9. **No confidence is expressed in the UI itself.** Confidence lives in
   model-generated text. Foundry never says *"I'm confident about this part, less
   so about that part"* in its own chrome, so certainty is uniform across
   everything it presents.

### 6.3 Structural

10. **Every screen after the plan is unchanged in character.** Build, repair,
    failure, and cancellation got copy improvements only. The proposal surface
    is now genuinely consultancy-grade; the build surface is a well-designed
    progress view. That asymmetry is the honest answer to *"does this feel like
    software?"* — the front half no longer does, the back half sometimes still
    does.

11. **Nothing adapts by project family.** `profile.family` is available and
    still unused. A restaurant, a law office, and an API get identical section
    structure. §2.7 of the spec designed this; none of it is built.

12. **The repo still has no commits.** Every improvement across this entire
    engagement is unprotected.
