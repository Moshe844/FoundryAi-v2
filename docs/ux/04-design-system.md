# 4. Design system

Warm, premium, light-first. The failure mode to avoid is *pale* — warmth comes
from hue in the surfaces, and confidence comes from high-contrast ink and dense,
purposeful typography. Not from more whitespace, more rounding, or more colour.

## 4.1 Colour tokens

Every value below is checked against the surface it is used on. Contrast ratios
are computed against `--surface-canvas` (#FBF8F4) unless noted.

```css
:root {
  /* Surfaces */
  --surface-canvas:      #FBF8F4;  /* page */
  --surface-raised:      #FFFDFB;  /* cards, composer */
  --surface-inset:       #F4EEE7;  /* wells, inputs at rest, skeletons */
  --surface-cream:       #F7EFE3;  /* section bands, quiet emphasis */
  --surface-ink:         #241F1C;  /* inverted surfaces, code blocks */
  --surface-scrim:       rgba(36, 31, 28, 0.44);

  /* Ink */
  --ink-primary:         #1F1A17;  /* 15.2:1  headings, body */
  --ink-secondary:       #574C45;  /*  7.3:1  supporting text */
  --ink-tertiary:        #7A6C63;  /*  4.6:1  captions, metadata — AA min */
  --ink-inverse:         #FDFBF8;  /* on --surface-ink and accent fills */

  /* Accent — peach. Three values, three jobs. Never interchangeable. */
  --accent-fill:         #A94E1F;  /*  5.1:1 on canvas · 5.4:1 with inverse ink
                                       button fills, small accent text */
  --accent-line:         #C8622C;  /*  3.8:1  borders, focus rings, 20px+ text */
  --accent-tint:         #FBEADF;  /* selected fills */
  --accent-wash:         #FEF6F0;  /* hover fills, banded backgrounds */

  /* Semantic */
  --verified:            #3F6B4E;  /*  5.7:1  proved, live, healthy */
  --verified-tint:       #EAF2EC;
  --attention:           #8A5A12;  /*  5.5:1  needs you, repair, budget warning */
  --attention-tint:      #FBF0DC;
  --fault:               #9B3126;  /*  6.9:1  honest failure only */
  --fault-tint:          #FBEAE7;

  /* Lines */
  --line-hairline:       rgba(74, 52, 38, 0.10);
  --line:                rgba(74, 52, 38, 0.16);
  --line-strong:         rgba(74, 52, 38, 0.28);

  /* Elevation — warm, restrained */
  --shadow-1: 0 1px 2px rgba(74, 52, 38, 0.06);
  --shadow-2: 0 2px 8px rgba(74, 52, 38, 0.07), 0 1px 2px rgba(74, 52, 38, 0.05);
  --shadow-3: 0 12px 32px rgba(74, 52, 38, 0.10), 0 2px 6px rgba(74, 52, 38, 0.06);
  --shadow-well: inset 0 1px 2px rgba(74, 52, 38, 0.05);
  --ring-accent: 0 0 0 3px rgba(200, 98, 44, 0.32);
  --ring-fault:  0 0 0 3px rgba(155, 49, 38, 0.28);
}
```

### Colour rules

1. **The accent is for action and for truth, never for decoration.** Primary
   buttons, focus, selected state, and the "live" indicator. A peach panel
   border because it looks nice is a defect.
2. **`--accent-line` may not carry text below 20px.** At 3.8:1 it passes AA for
   large text and UI components only. Small accent text uses `--accent-fill`.
3. **Exactly one accent surface per viewport.** If a screen has a primary button
   and a selected option and a tinted banner all competing, the hierarchy is
   broken.
4. **No gradients on text-bearing surfaces.** The current radial hero gradient
   (`globals.css:38`) is removed; warmth comes from the flat surface ramp.
5. **`--fault` is reserved for honest failure.** Cancellation, skipping, and
   declining are neutral. Nothing the customer chose is ever red.
6. **No dark theme in this release.** The brief specifies light-first and the
   token set is not yet dark-validated. Shipping a half-checked dark mode would
   break the AA guarantee. `prefers-color-scheme: dark` is explicitly not
   honoured; the design is committed to light.

### Retired tokens

| Removed | Reason | Replacement |
|---|---|---|
| `--peach: #f2a879` | ~2.0:1 as text — fails AA | `--accent-fill` / `--accent-line` |
| `--ink-faint: #9a8d85` | ~2.9:1 — fails AA | `--ink-tertiary` |
| `--radius-lg: 28px` | Reads consumer, not premium | `--radius-xl: 20px` |
| `--rose-soft: #fceded` | Unused pink; drifts childish | `--accent-wash` |
| body radial gradient | Blur risk over text, pale result | flat `--surface-canvas` |

## 4.2 Spacing

4px base. Tokens only — no arbitrary values in component CSS.

```css
--space-1:  4px;   --space-2:  8px;   --space-3: 12px;   --space-4: 16px;
--space-5: 20px;   --space-6: 24px;   --space-8: 32px;   --space-10: 40px;
--space-14: 56px;  --space-20: 80px;
```

Every token is divisible such that ×1.25 and ×1.5 Windows scaling produces
whole pixels (4→5→6, 12→15→18, 20→25→30, 56→70→84).

Vertical rhythm: 80px between acts, 56px between major sections, 32px between
cards, 24px inside cards, 12px between a label and its value.

## 4.3 Radii

```css
--radius-xs:  4px;   /* chips, marks, tags */
--radius-sm:  6px;   /* buttons, inputs, options */
--radius-md: 10px;   /* cards — the default */
--radius-lg: 14px;   /* panels, composer, question cards */
--radius-xl: 20px;   /* preview shell, sheets — the maximum */
--radius-pill: 999px;/* status pills only */
```

Nothing exceeds 20px. Nested radii step down by at least 4px so corners stay
concentric.

## 4.4 Borders

1px only. Never `0.5px` (renders inconsistently at 125%/150%). Never 2px except
on a selected option, where the border replaces the 1px rather than adding to it
so nothing reflows.

Cards are **border-first, shadow-second**: `1px --line-hairline` + `--shadow-1`.
Elevation alone reads as generic SaaS.

## 4.5 Component inventory

Every component, every state. `default · hover · active/pressed · focus-visible ·
selected · disabled · loading · error` where each applies.

### Button — primary

| State | Spec |
|---|---|
| default | `--accent-fill` bg, `--ink-inverse` text, no border, `--radius-sm`, 40px h, 20px pad-x, label 15/24 600, `--shadow-1` |
| hover | bg `#96431A`, shadow unchanged |
| pressed | bg `#853B16`, `translateY(0)` — **never** a transform on the label |
| focus-visible | `--ring-accent`, offset 2px, border unchanged |
| disabled | bg `--surface-inset`, text `--ink-tertiary`, `cursor: not-allowed`, no opacity fade (opacity on text blurs on Windows) |
| loading | label swaps to its own gerund ("Starting…"), width locked to the wider of the two labels, no spinner |

### Button — secondary

Border `1px --line-strong`, bg `--surface-raised`, text `--ink-primary`.
Hover: bg `--accent-wash`, border `--accent-line`. Same geometry as primary.

### Button — quiet / text link

No bg, no border, text `--accent-fill`, 15/24 500, 1px underline at 0.25 alpha
that reaches full alpha on hover. Used for `Something else…`, `Skip for now`,
`Change`, `Show all`.

### Button — destructive

Border `1px --fault`, text `--fault`, bg `--surface-raised`. Filled `--fault`
only as the confirming action *inside* an approval sheet, never on a card face.

### Input / textarea

| State | Spec |
|---|---|
| default | bg `--surface-raised`, `1px --line`, `--radius-sm`, 15/24, 12px pad, `--shadow-well` |
| hover | border `--line-strong` |
| focus | border `--accent-line`, `--ring-accent`, `--shadow-well` removed |
| error | border `--fault`, `--ring-fault`, message directly below, `aria-describedby` linked |
| disabled | bg `--surface-inset`, text `--ink-tertiary` |

The composer is the same component at `--radius-lg`, 20px padding,
`--shadow-2`, auto-growing 3→8 rows.

### Card

bg `--surface-raised`, `1px --line-hairline`, `--radius-md`, 24px padding,
`--shadow-1`. Hover (only when the whole card is a target): border `--line`,
`--shadow-2`. No lift transform — it moves text.

### Project card

Card, plus: 40×40 monogram at `--radius-sm` filled `--surface-cream` with
`--accent-fill` initial; name 16/24 600; summary 14/22 `--ink-secondary`
clamped to 2 lines; phase pill; relative time `caption --ink-tertiary`; primary
action (label per §2); `⋯` overflow revealed on hover and always present for
keyboard.

### Choice control — question option

The most important control in the product.

| State | Spec |
|---|---|
| default | bg `--surface-raised`, `1px --line`, `--radius-sm`, min-h 48px, 12/16 pad, text 15/24 |
| hover | bg `--accent-wash`, border `--accent-line` |
| focus-visible | `--ring-accent` |
| **selected** | bg `--accent-tint`, border `1px --accent-line`, `✓` mark at 16px `--accent-fill`, text weight 500 |
| disabled | bg `--surface-inset`, text `--ink-tertiary` |

Semantics: `role="radiogroup"` on the container, `role="radio"` +
`aria-checked` on each option. Arrow keys move and select; `Tab` enters and
leaves the group once.

### Choice control — Foundry decides

The same control, full width, always first, with:
- a `Recommended` badge: `--verified-tint` bg, `--verified` text, 11/14 600,
  uppercase, `--radius-xs`, 2/6 pad;
- a second line at 13/18 `--ink-secondary` naming the actual recommendation;
- selected state uses `--verified` for the check mark rather than accent, so
  "Foundry's choice" is visually distinct from "my choice".

### Recommendation card (Worth adding)

Card at `--radius-md`, 20px pad. Title 15/24 600; value line 14/22
`--ink-secondary`; toggle affordance top-right, 28×28, `[+]` → `[✓]`.
Selected: bg `--accent-tint`, border `--accent-line`. Whole card is the click
target; `role="switch"` with `aria-checked`.

### Status pill

`--radius-pill`, 22px h, 0/10 pad, 12/16 500, 6px dot before the label.
Text is always a **customer phase**, never an enum.

| Phase group | Dot | Text | Bg |
|---|---|---|---|
| Delivered | `--verified` | `--verified` | `--verified-tint` |
| Building / Testing | `--accent-line` | `--accent-fill` | `--accent-wash` |
| Needs you / Correcting | `--attention` | `--attention` | `--attention-tint` |
| Stopped | `--fault` | `--fault` | `--fault-tint` |
| Cancelled / Reading | `--ink-tertiary` | `--ink-secondary` | `--surface-inset` |

The building dot pulses opacity 1 → 0.45 → 1 over 1.8s. Under
`prefers-reduced-motion` it is static and the pill reads "Building · live".

### Progress surface — phase spine

Vertical list, 9 rows, 40px each, 1px `--line-hairline` connector behind the
marks.

| Row state | Mark | Text |
|---|---|---|
| complete | 16px `✓` in a `--verified-tint` disc | 15/24 500 `--ink-secondary` |
| current | 10px filled `--accent-fill` disc with a 1.8s pulsing 3px halo | 15/24 600 `--ink-primary` |
| pending | 8px `--line-strong` ring | 15/24 400 `--ink-tertiary` |
| interrupted | 10px `--attention` disc | 15/24 600 `--ink-primary` + nested repair narrative |
| skipped (phase not applicable) | *row absent* | — |

Compressed variant (preview docked, or tablet): horizontal 9 dots, 8px each,
12px gap, current dot 12px and labelled beside the rail.

The spine never regresses and never animates position — only mark fill and text
weight change.

### Preview shell

`--radius-xl`, `1px --line`, `--shadow-3`, `overflow: hidden`, bg
`--surface-ink` behind the frame so a loading iframe never flashes white.
36px header bar with the title and the five controls (§13). 28px footer with the
runtime state dot and host. The iframe fills the remainder at exact integer
dimensions.

Drag handle: 8px hit area on the left edge, `cursor: col-resize`, 2px visible
`--line-strong` on hover, `--accent-line` while dragging. Keyboard: focusable,
arrow keys resize by 40px, `Home`/`End` jump to min/max.

### Drawer / sheet

Only two exist: the mobile nav sheet and the approval confirm sheet.
`--radius-xl` top corners, `--surface-raised`, `--shadow-3`, `--surface-scrim`
behind. Enters 240ms translateY (the sheet moves, its text does not re-layout).
Focus trapped, `Escape` closes to the safe option, focus restored to the invoker
on close. The scrim is a `<div>` with a sibling close button — never a
full-width `<button>` as in `page.tsx:175`.

### Dialog

Not used. Every decision that would be a dialog is either the `Needs you` slot
(in-flow) or a sheet. Modal dialogs interrupt work; this product's work is the
point.

### Banner

Full-width inside the content column, `--radius-md`, `1px` of the semantic
colour at 0.4 alpha, tinted bg, 16px pad, 20px leading icon, text 14/22.
Variants: `attention` (needs you), `fault` (error), `neutral` (recovery notice).
Never dismissible if it describes a live blocking condition.

### Approval card

`--radius-lg`, bg `--surface-raised`, `1px --attention` at 0.4 alpha, 24px pad,
`--shadow-2`, with a 3px `--attention` left edge. Heading 20/26 600. A
definition list for what / why / impact at 14/22, labels `--ink-tertiary` 13/18
500. Action row: recommended primary, then alternatives as secondary/quiet, each
with a `caption --ink-tertiary` consequence line beneath.

### Completion card

The delivery surface's container: `--surface-raised`, `--radius-xl`, 40px pad,
`1px --line-hairline`, `--shadow-2`. Serif headline. Section labels in a left
column at 13/18 500 `--ink-tertiary` (160px, collapsing above content on
mobile), values right at 15/24. Proved rows carry a 14px `--verified` `✓`.

### Navigation rail

240px, bg `--surface-canvas` with a 1px `--line-hairline` right edge — not a
raised panel. Brand at top (24px), two nav items, spacer, provider chip,
settings. Nav item: 40px h, `--radius-sm`, 15/24 500; active is
`--surface-cream` bg + `--ink-primary` + a 2px `--accent-fill` left bar;
hover is `--accent-wash`. Collapsed (64px): icon centred, label as a tooltip on
hover and as the accessible name always.

### Disclosure

`<details>` with a 40px summary row: 15/24 500, a 12px chevron rotating 90°
(the chevron is an inline SVG, and it is the only rotating element in the
system). Content 20px pad, bg `--surface-inset`, `--radius-md`. Open state
persists per project in `localStorage`.

### Skeleton

`--surface-inset` blocks at the real content's dimensions, `--radius-xs`,
opacity 1 → 0.55 → 1 over 1.6s. Never a shimmer sweep (a moving gradient over
text-shaped blocks reads cheap and repaints constantly).

### Mark (search highlight)

`<mark>` with `--accent-tint` bg, `--ink-primary` text, no weight change, 1px
padding-x, `--radius-xs`.

## 4.6 Interaction states — global rules

- **Focus** is always visible: 3px `--ring-accent` at 2px offset. Never
  `outline: none` without an equivalent. Focus is never conveyed by colour alone.
- **Hover** never changes geometry. No scale, no lift, no letter-spacing change.
- **Pressed** changes fill only.
- **Disabled** changes fill and text colour, never opacity, and always has a
  reason available (title or adjacent text).
- **Selected** is conveyed by fill + border + an icon — three channels, so it
  survives colour-blindness and high-contrast mode.
- **Loading** locks control width to prevent layout shift.

## 4.7 Motion

```css
--dur-micro: 120ms;   /* hover, press, fill changes */
--dur-enter: 180ms;   /* content fade-in, chip cross-fade */
--dur-panel: 240ms;   /* sheets, dock collapse */
--ease: cubic-bezier(0.2, 0, 0.2, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
```

Rules:

1. **Never animate the position of text.** No `translate` on any element that
   contains a glyph. This is the primary Windows blur cause and it is
   non-negotiable.
2. Phase transitions cross-fade **opacity only**, and only on the mark and
   container — the phase label's weight changes instantly.
3. No `will-change`, no `filter`, no `backdrop-filter` anywhere in the system.
4. Layout-affecting animation is limited to the preview dock and the two sheets,
   which animate their own box, not their contents.
5. The only looping animations are the current-phase halo and the skeleton pulse,
   both opacity-only.
6. `@media (prefers-reduced-motion: reduce)` sets every duration to `0.01ms`,
   removes both loops, and keeps every end state. Text alternatives ("live",
   "loading") carry the meaning the motion carried.

## 4.8 Breakpoints

```css
--bp-mobile:  0;      /* single column, sheets, sticky action bar */
--bp-tablet:  768px;  /* 64px icon rail, segmented preview tab */
--bp-desktop: 1280px; /* 240px rail, side preview dock */
--bp-wide:    1680px; /* extra width goes to the dock, not the prose */
```

Container widths: content max 1100px, reading measure 720px (tablet 640px,
mobile fluid with 20px gutters). The reading measure is a hard cap — prose never
spans a 1600px window.

## 4.9 Layout primitives

- `.act` — a vertical section with 80px bottom margin, its own `<section>` and
  heading.
- `.measure` — `max-width: 720px`, applied to all prose.
- `.field-row` — 160px label column + fluid value column, collapsing to stacked
  below 768px. Used by the brief and delivery card.
- `.option-grid` — `repeat(auto-fit, minmax(240px, 1fr))`, `gap: 12px`,
  max 2 columns. Never 3 — three choices in a row reads as pricing tiers.
- `.dock-layout` — CSS grid, `1fr` + resizable dock column, `gap: 24px`.
  Integer-pixel dock width; grid never uses fractional `%` for the dock.
