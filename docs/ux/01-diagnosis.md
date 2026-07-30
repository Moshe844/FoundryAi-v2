# 1. Diagnosis of the current Foundry experience

Every finding below is anchored to the shipped code. The entire customer
experience is one 1,121-line component, `apps/web/app/page.tsx`, styled by
`apps/web/app/globals.css` (3,965 lines with no token discipline).

## 1.1 The product does not say what it does

`page.tsx:254-260`:

```tsx
<p className="eyebrow">Build from an outcome, not a template</p>
<h1>What should exist when we&apos;re done?</h1>
<p>
  Describe the project in your own words. Foundry will use a live model
  to identify only the decisions that change the architecture, then
  turn the result into an observable contract.
</p>
```

A customer who wants a booking site reads a philosophical question, then a
sentence containing "live model," "architecture," and "observable contract."
Nothing states that Foundry designs, builds, runs, tests, and delivers a real
working web product. The strongest claim Foundry can make is absent from the
screen that has to make it.

## 1.2 The home screen advertises three products Foundry cannot build

`page.tsx:6-15` hardcodes eight chips, three of which are guaranteed declines:

```tsx
"Create a mobile app",
"Create a desktop application",
"Build a game",
```

The honest caveat exists but is a 12px hint *below* the composer
(`page.tsx:286`): "Arbitrary web projects are supported; other platforms are
declined honestly." The chips promise; the fine print retracts. A customer who
clicks "Build a game" spends a real model call to be told no.

## 1.3 Clarification is structurally a technical questionnaire

`page.tsx:504-553` renders raw model output as a required radio form:

- `<legend>{question.prompt}</legend>` — model text, verbatim, no plain-language guarantee.
- `question.answerOptions.map(...)` — the only choices are whatever the model returned.
- `disabled={... unresolved.some((question) => !answers[question.questionId])}` — **every question is mandatory.**

There is no *Foundry decide*, no *Other*, no *Skip*. The brief's core principle —
the customer describes intent, Foundry makes the professional decisions — is
contradicted by the submit button's disabled condition. This is the single most
damaging defect in the product.

## 1.4 Internal vocabulary is used as UI chrome

Section labels are truth-plane implementation terms:

| Location | String shown to customers |
|---|---|
| `page.tsx:313` | "Replayed from disk" |
| `page.tsx:1089` | "Persisted Mission Ledger" |
| `page.tsx:791` | "Real artifact" |
| `page.tsx:497` | "Live project understanding · revision 3" |
| `page.tsx:179` | "Advanced routing" |
| `page.tsx:588` | "12 observable obligations" |

`StatePill` (`page.tsx:153-160`) lowercases raw lifecycle enums, so the primary
status a customer sees is `provisioning`, `contracted`, or `exhausted` —
`src/domain/lifecycle.js` vocabulary rendered as the headline fact.

`page.tsx:579` prints the raw stack identifier as the architecture summary:
`nextjs-typescript-sqlite-npm-playwright`. This is the moment Foundry should
sound like an architect and instead sounds like a registry key.

## 1.5 Execution is a counter dashboard, not engineering progress

`page.tsx:709-720` gives the most prominent band on the build screen to:

```text
Live execution counters
12 provider calls · 3 repair hypotheses
4 installs · 2 builds · 1 runtime restarts
```

None of these tell a customer whether their booking form works. Reinstall and
rebuild counts are internal efficiency telemetry. Below it, `page.tsx:732-743`
renders a reverse-chronological list of ledger events — a command log. The
screen answers "what has the machine done" and never "is my product working."

## 1.6 Preview and activity compete for attention

`page.tsx:723` puts narrative and preview in `.mission-columns` as two peer
sections. The real artifact — the single most valuable thing on the screen —
gets equal billing with a scrolling event log, and the preview's empty state is
plain text with two variants only (`page.tsx:807-818`): "No runtime URL exists
yet" and "The runtime is no longer available." Loading, rebuilding, crashed,
and disconnected are all indistinguishable.

## 1.7 Optional ideas are disguised as questions

Suggestions are collected as checkboxes (`page.tsx:464-490`) and then submitted
through the clarification endpoint by fabricating an answer string
(`page.tsx:440`):

```tsx
answer: `Include this project idea: ${suggestion.label}. ${suggestion.rationale}`
```

The mechanism is sound. The presentation is not: ideas appear as another form to
complete rather than as a designer's recommendations with stated value.

## 1.8 There is no completion experience

`page.tsx:1106-1110` routes every non-discovery state to the same `MissionView`.
`SUCCEEDED` therefore renders the same counters, the same log, and a green pill.
The delivery moment — what was built, what was proven, what was decided, what is
missing, what to do next — does not exist as a designed surface.

## 1.9 Terminal means dead

Once a mission reaches `SUCCEEDED`, the UI offers no input. The polling effect
stops (`page.tsx:883-895`), and the only actions are *Open ↗* and *Delete*.
A customer who wants larger buttons has to start a new project from zero, losing
every recorded decision. "Foundry preserves context for future improvements" is
true of the Ledger and false of the product.

## 1.10 Routing plumbing occupies top-level navigation

The sidebar has two nav items and one persistent status button reading
"2 live providers · Automatic routing · details" (`page.tsx:1067-1079`), opening
a modal listing raw model identifiers. Model routing is genuinely
differentiating engineering, but it is promoted above the customer's own
projects and framed as configuration they must supervise.

## 1.11 Approvals and destructive actions are undesigned

Project deletion uses `window.confirm` (`page.tsx:1013`) with a message
containing "immutable audit history." There is no approval component, so every
future approval — install a tool, use a credential, deploy — has nowhere to go.

## 1.12 Visual and typographic weakness

- One font family, `Segoe UI Variable Text`, used at every size including
  40px+ display, where its text-optical face looks loose and unconfident.
- No type scale; sizes are declared ad hoc across 3,965 CSS lines.
- `--peach: #f2a879` (`globals.css:11`) fails WCAG AA as text on
  `--canvas: #fbf9f5` at roughly 2.0:1, and `--ink-faint: #9a8d85` reaches only
  about 2.9:1 — both are used for real content.
- The hero is a centred column under a large radial gradient
  (`globals.css:38`), producing wide empty margins with little information.
- Radii run to 28px (`--radius-lg`) on large surfaces, pushing the product
  toward soft and consumer rather than premium and precise.

## 1.13 Accessibility gaps

- `ProviderPanel` (`page.tsx:174`) sets `role="dialog"` and `aria-modal` but
  implements no focus trap, no focus restoration, and no `Escape` handler.
- The scrim is a `<button>` with `aria-label="Close"`, so screen-reader users
  meet a full-width unlabelled-purpose control before the dialog content.
- Only one region is announced (`aria-live="polite"` on `.mission-now`,
  `page.tsx:683`); phase changes, repairs, and verification results are silent.
- Errors render as `<p role="alert">` at the *bottom* of long forms
  (`page.tsx:658`), far from the control that failed.
- State is conveyed by pill colour plus raw enum text; no state has an
  accessible plain-language name.
- No `prefers-reduced-motion` handling for the pulsing working indicator.

## 1.14 The experience does not adapt across project types

One layout, one question pattern, and one preview treatment serve every request.
`profile.family` is available on every mission
(`src/domain/project-profile.js:5` defines eight families) and is used for
nothing in the UI. A marketing website, an internal CRUD tool, and a web API
should not present identical suggestions, previews, or completion evidence.

## 1.15 Summary

The engineering underneath is unusually honest and rigorous — evidence-backed
verification, bounded repair, replayable state, no canned generators. The
customer experience exposes that rigour as raw machinery and hides the value.
The redesign's job is not to add polish. It is to translate.
