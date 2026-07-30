# 7. Responsive rules and accessibility requirements

## 7.1 Breakpoints and layout behaviour

```text
mobile    0 – 767px
tablet    768 – 1279px
desktop   1280 – 1679px
wide      1680px +
```

| Region | Mobile | Tablet | Desktop | Wide |
|---|---|---|---|---|
| Rail | 56px top bar + sheet | 64px icon rail | 240px, collapsible | 240px |
| Content measure | fluid, 20px gutters | 640px | 720px prose / 1100px max | unchanged |
| Preview | full-screen sheet | segmented tab (`Build` \| `Preview`) | right dock 40%, min 480px | dock takes the extra width |
| Phase spine | current phase + "{n} of 9 done", expandable | vertical, full | vertical, full; horizontal when docked | as desktop |
| Option grid | 1 per row | 2 per row ≥900px, else 1 | 2 per row | 2 per row |
| `.field-row` | stacked, label above | stacked | 160px label + value | as desktop |
| Primary action | sticky bottom bar, safe-area inset | in flow | in flow | in flow |
| Project cards | 1 column | 2 columns | 3 columns | 3 columns |
| Delivery card | stacked, preview first | stacked | labelled rows | labelled rows |

### Mobile specifics

- Bottom action bar: 64px + `env(safe-area-inset-bottom)`, `--surface-raised`,
  1px top `--line`. Holds one primary action and, during a build, a
  `View preview` button once a preview is real.
- The nav sheet covers the full height, is focus-trapped, and closes on
  `Escape`, on backdrop tap, and on route change.
- Question option rows are 48px minimum height with 12px vertical gaps, so the
  44px touch target is met with margin.
- The build header condenses to project name + phase pill. Elapsed time and
  `Stop` move into a `⋯` menu.
- The preview sheet is full-screen with a `Done` control top-left and the width
  presets removed (the device *is* the width).
- No horizontal scrolling at any width down to 320px. The only horizontally
  scrollable elements permitted are the routing table and activity list inside
  `Engineering details`, each in its own `overflow-x: auto` container.

### Tablet specifics

A 40% dock inside 768px leaves a 460px build column and a 300px preview — both
useless. So the preview becomes a segmented control at the top of the project
surface. Switching tabs preserves scroll position in the inactive tab, and the
`Build` tab shows a `Live` dot on the `Preview` tab label when a runtime is
healthy, so the customer knows the artifact is ready without switching.

### Desktop and wide specifics

- Rail collapse state persists in `localStorage`.
- Dock width persists per project, integer px, snapped on release.
- Above 1680px the content column is capped at 1100px and the prose measure at
  720px. Extra width is given to the dock, up to 70% of the viewport. Prose
  never widens, because line length is a legibility constraint, not a
  space-filling opportunity.

## 7.2 Accessibility requirements — WCAG 2.1 AA

### Contrast

Every token pair in use, verified. `--surface-canvas` = #FBF8F4 unless stated.

| Pair | Ratio | Requirement | Result |
|---|---|---|---|
| `--ink-primary` on canvas | 15.2:1 | 4.5:1 | pass |
| `--ink-primary` on `--surface-raised` | 15.7:1 | 4.5:1 | pass |
| `--ink-secondary` on canvas | 7.3:1 | 4.5:1 | pass |
| `--ink-tertiary` on canvas | 4.6:1 | 4.5:1 | pass |
| `--ink-tertiary` on `--surface-inset` | 4.5:1 | 4.5:1 | pass (at the limit — never use on `--surface-cream`) |
| `--ink-inverse` on `--accent-fill` | 5.4:1 | 4.5:1 | pass |
| `--accent-fill` on canvas | 5.1:1 | 4.5:1 | pass |
| `--accent-fill` on `--accent-tint` | 4.6:1 | 4.5:1 | pass |
| `--accent-line` on canvas | 3.8:1 | 3:1 (UI / ≥20px) | pass — **never small text** |
| `--verified` on canvas | 5.7:1 | 4.5:1 | pass |
| `--verified` on `--verified-tint` | 5.2:1 | 4.5:1 | pass |
| `--attention` on canvas | 5.5:1 | 4.5:1 | pass |
| `--attention` on `--attention-tint` | 4.9:1 | 4.5:1 | pass |
| `--fault` on canvas | 6.9:1 | 4.5:1 | pass |
| `--fault` on `--fault-tint` | 6.2:1 | 4.5:1 | pass |
| `--line-strong` on canvas | 3.1:1 | 3:1 (component boundary) | pass |
| `--ink-inverse` on `--surface-ink` | 15.1:1 | 4.5:1 | pass |

Prohibited pairs, enforced in review: `--accent-line` as text under 20px;
`--ink-tertiary` on `--surface-cream` (4.1:1); any retired token from
[04-design-system.md § retired](04-design-system.md#retired-tokens).

### Non-text contrast (1.4.11)

- Input and card borders: `--line` at 2.2:1 is **insufficient alone**, so every
  input additionally carries `--shadow-well` and sits on a surface distinct from
  the page. The *focus* indicator is the AA-critical one and uses `--accent-line`
  at 3.8:1.
- Status dots are never the only signal — each pill has a text label.
- The current-phase mark is distinguished by fill *and* text weight *and* the
  "now" heading, not by colour alone.

### Keyboard navigation

| Surface | Behaviour |
|---|---|
| Global | `Tab` order follows DOM order, which follows visual order. No positive `tabindex` anywhere. |
| Skip link | First focusable element: "Skip to main content" → `#main`. |
| Command | `Ctrl+K` / `⌘K` opens search from any surface. |
| Composer | `Enter` submits, `Shift+Enter` newline, both in `aria-describedby`. |
| Question options | `role="radiogroup"`; `Tab` enters the group once, arrows move and select, `Tab` exits. |
| `Something else` / `Skip` | Standard buttons; expanding moves focus into the revealed field. |
| Suggestion cards | `role="switch"`, `Space` toggles. |
| Disclosure | Native `<details>`; `Enter`/`Space` toggles. |
| Preview dock | Handle is focusable: `←`/`→` resize 40px, `Home`/`End` min/max, `Escape` collapses. |
| Sheets | Focus trapped, first focusable is the safe option, `Escape` closes to safe, focus restored to invoker. |
| Iframe | Reachable by `Tab`; a preceding visually-hidden note says the preview is the generated project and `Tab` will enter it. |

Nothing in the product is reachable only by hover or only by pointer.
The card overflow `⋯` is always in the DOM, revealed on hover *and* on focus.

### Focus behaviour

- Visible indicator on every interactive element: 3px `rgba(200,98,44,0.32)` at
  2px offset, never removed without an equivalent.
- `:focus-visible` for keyboard, no ring on mouse click — except inputs, which
  always show the accent border.
- Focus is moved programmatically in exactly four cases: arriving at the
  understanding surface (to the `h1`, `tabindex="-1"`), arriving via `Answer`
  (to the first open decision), a `Needs you` card appearing (to its heading),
  and a sheet opening (to its safe action). Every one restores focus on exit.
- Focus is never moved by a polling update. This matters: `GET /missions/:id`
  runs every second, and a re-render must not steal focus from a textarea the
  customer is typing in. Inputs are keyed and uncontrolled during a build.

### Screen-reader semantics

```html
<a class="skip" href="#main">Skip to main content</a>
<nav aria-label="Foundry">…</nav>
<main id="main" tabindex="-1">
  <section aria-labelledby="understand-h">
    <h1 id="understand-h" tabindex="-1">Studio Booking</h1>
  </section>
  <section aria-labelledby="decisions-h">
    <h2 id="decisions-h">Two decisions change what you get.</h2>
    <fieldset>
      <legend>How should people sign in?</legend>
      <div role="radiogroup" aria-describedby="q1-why">…</div>
      <p id="q1-why">Sign-in decides whether every page…</p>
    </fieldset>
  </section>
</main>
```

- Landmarks: one `<nav aria-label="Foundry">`, one `<main>`, `<section>` with
  `aria-labelledby` per act. No `<header>`/`<footer>` landmarks inside cards.
- Every question is a `<fieldset>` with a `<legend>` carrying the prompt —
  preserving what the current build gets right (`page.tsx:511-512`).
- Icon-only controls have an `aria-label` from the copy deck's `sr *` strings.
  No control's accessible name is a symbol.
- Status is announced as plain language: "Building, in progress" — never
  "PROVISIONING".
- The preview iframe has `title="Preview of {project name}"`.
- Decorative marks (`✓` glyphs, dots, monograms) are `aria-hidden="true"`, with
  the meaning carried by adjacent text.

### Live regions — exactly one per surface

The current build's single `aria-live` on the counters band announced telemetry.
The redesign announces meaning, once:

| Surface | Live region | Politeness | Announces |
|---|---|---|---|
| Understanding (loading) | the narrated wait | `polite` | "Reading your request" and the model, once |
| Build | the "now" block | `polite`, `aria-atomic` | "Now: {phase}. {why}" on change only |
| Repair | the repair narrative | `polite` | each new repair line |
| `Needs you` | the card | `assertive` | the heading, on appearance |
| Completion | the delivery headline | `polite` | "{headline} {n} of {m} promises proved." |
| Errors | the inline message | `assertive` | the message |

Individual activity events are **never** announced. The phase spine is not a
live region. Two live regions must never be active on the same surface at the
same time; the `Needs you` assertive region suppresses the polite one while
present.

### Error announcements

- Errors render adjacent to their control, not at the bottom of the surface
  (fixing `page.tsx:658`).
- `aria-invalid="true"` and `aria-describedby` pointing at the message.
- `role="alert"` on the message container, inserted into the DOM on error so the
  announcement fires.
- Error text says what to do, never just what failed.

### Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Plus behavioural changes: the current-phase halo and the skeleton pulse are
removed entirely; the building pill reads "Building · live" as static text; the
sheet appears without translation; the start-building transition renders its end
state immediately. No meaning is carried by motion alone anywhere in the system,
so nothing is lost.

### Touch targets

44×44px minimum on mobile and tablet for every interactive element. Where a
control is visually smaller (the 28×28 suggestion toggle, the card overflow),
the hit area is expanded with padding or a `::before` overlay — never by
enlarging the visual. Adjacent targets have 8px minimum separation.

### Zoom and reflow (1.4.4, 1.4.10)

- 200% text-only zoom: no clipping, no overlap, no loss of function.
- 400% browser zoom at 1280px (≈320px effective): single column, no
  two-dimensional scrolling, `.field-row` stacked, sticky action bar retained.
- No `maximum-scale` or `user-scalable=no` in the viewport meta.

### Forms and required fields (3.3.2)

Nothing in the clarification flow is required. This is both a product principle
and an accessibility benefit: there is no error state to recover from, and the
group is introduced with the visually-hidden note *"Nothing here is required.
Anything you skip, I'll decide."*

### High contrast / forced colours

```css
@media (forced-colors: active) {
  /* Selected state must not rely on background fill */
  .option[aria-checked="true"] { border: 2px solid Highlight; }
  .option[aria-checked="true"] .check { forced-color-adjust: none; }
  .pill { border: 1px solid CanvasText; }
}
```

Because selected state uses fill + border + icon (§4.6), it survives forced
colours. Status pills gain a border so they remain distinguishable when tints
are dropped.

### What is explicitly not claimed

- No dark theme, so `prefers-color-scheme: dark` is not honoured. Committing to
  light and meeting AA in light is honest; shipping an unverified dark palette is
  not.
- The generated project inside the preview iframe is **not** covered by these
  guarantees. Foundry's own chrome is AA; what Foundry builds is governed by the
  customer's plan. Where a project's plan includes accessibility obligations,
  they appear in `What I'll prove` like any other promise.
