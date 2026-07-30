# 5. Typography system

The current build uses one font — `Segoe UI Variable Text` — at every size
including 40px display, which is why headings read loose and unconfident
(`globals.css:41-45`). Segoe UI Variable is an optical-size family: its `Text`
face is drawn for small sizes and its `Display` face for large ones. Using the
wrong face at the wrong size is the typographic defect.

## 5.1 Families

Three roles, zero web fonts. Every face below is already present on Windows 11,
so there is no network request, no FOIT/FOUT, and no new dependency in a local
-first product.

```css
:root {
  /* Small text: 11–18px. Windows 11's text-optical face. */
  --font-text:
    "Segoe UI Variable Text", "Segoe UI Variable Static Text", "Segoe UI",
    Inter, system-ui, -apple-system, BlinkMacSystemFont, "Helvetica Neue",
    Arial, sans-serif;

  /* Large text: 20px and up. Tighter, more confident drawing. */
  --font-display:
    "Segoe UI Variable Display", "Segoe UI Variable Static Display",
    "Segoe UI Semibold", "Segoe UI", Inter, system-ui, -apple-system,
    BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;

  /* Brand voice. Exactly two uses in the entire product. */
  --font-brand: "Georgia Pro", Georgia, "Iowan Old Style", "Palatino Linotype",
    "Times New Roman", serif;

  /* Engineering details only. */
  --font-mono: "Cascadia Mono", "Cascadia Code", Consolas, "SF Mono",
    ui-monospace, "Liberation Mono", monospace;
}
```

**`--font-brand` is used in exactly two places**: the Home H1 and the delivery
headline. Two uses make it read as deliberate. A third use makes it read as
decoration, and the brief forbids decorative.

Weights available and used: **400** body, **500** labels/nav/selected options,
**600** headings and buttons, **700** display only. No 300 (thin warm text turns
pale), no 800.

## 5.2 The scale

16px base, roughly a 1.2 ratio, every value an integer, every line-height
declared in **px** (not unitless) so vertical rhythm is deterministic.

| Token | Size/Line | Weight | Tracking | Family | Use |
|---|---|---|---|---|---|
| `--type-display-xl` | 40/46 | 700 | -0.02em | brand / display | Home H1, delivery headline |
| `--type-display-l` | 32/38 | 600 | -0.018em | display | Act headings: project name, "The plan", current phase |
| `--type-title-l` | 24/30 | 600 | -0.014em | display | Approval headings, section leads |
| `--type-title-m` | 20/26 | 600 | -0.010em | display | Section headings: "Worth adding", "Your projects" |
| `--type-title-s` | 18/26 | 600 | -0.006em | text | Question prompts, card titles, the "why" line |
| `--type-body-l` | 16/26 | 400 | 0 | text | Lead paragraphs, project summary |
| `--type-body-m` | 15/24 | 400 | 0 | text | Default body, options, buttons, inputs |
| `--type-body-s` | 14/22 | 400 | 0 | text | Supporting text, card summaries, definition values |
| `--type-label` | 13/18 | 500 | +0.005em | text | Field labels, definition-list keys, badges |
| `--type-caption` | 12/16 | 400 | +0.010em | text | Metadata, timestamps, consequence lines |
| `--type-micro` | 11/14 | 600 | +0.060em | text | Eyebrows only, uppercase |
| `--type-mono` | 13/20 | 400 | 0 | mono | Engineering details only |

Family switch threshold: **20px**. `--type-title-m` and above use
`--font-display`; `--type-title-s` and below use `--font-text`. Implement as two
classes, not a `clamp()` — optical face selection is categorical, not fluid.

### Heading hierarchy

```text
h1  --type-display-xl   Home, delivery            (brand serif)
h1  --type-display-l    project name, "The plan"  (display sans)
h2  --type-title-m      section headings
h3  --type-title-s      card titles, question prompts
h4  --type-label        definition-list keys
```

One `h1` per surface. The current build has the project name as `h1` on three
different acts of the same page — correct, because each act is a separate
rendered surface, but the DOM must never contain two at once.

### Body styles

- Default paragraph: `--type-body-m`, `--ink-secondary`, `max-width: 720px`.
- Lead paragraph (directly under an h1): `--type-body-l`, `--ink-secondary`.
- The "why it matters" line under a phase: `--type-title-s`, `--ink-secondary`,
  weight **400** not 600 — it is a sentence, not a heading, and 18px at 400 in
  the Text face is the most readable line in the product.
- Lists: 8px between items, no bullets in definition lists, `•` at
  `--ink-tertiary` where bullets are genuinely needed.

### Label, caption, badge

- Label: `--type-label`, `--ink-tertiary`, sentence case. **Not uppercase** —
  uppercase labels at 13px are a dashboard signature.
- Caption: `--type-caption`, `--ink-tertiary`.
- Eyebrow: `--type-micro`, uppercase, `--ink-tertiary`, letter-spacing 0.06em.
  Maximum one per surface. The current build uses six ("Replayed from disk",
  "Persisted Mission Ledger", "Advanced routing", …) and they read as noise.
- Badge (`Recommended`): `--type-micro` without uppercase-only tracking —
  11/14, 600, +0.02em, sentence case.

### Button type

`--type-body-m` at weight **600**, no letter-spacing adjustment, no uppercase.
Button labels are sentences: "Start building", not "START BUILDING".

## 5.3 Windows rendering guidance

This is the section that determines whether the product looks crisp or cheap on
the target platform. Foundry runs locally on Windows 11; DirectWrite is the
renderer.

### Required

```css
body {
  font-family: var(--font-text);
  font-size: 16px;
  -webkit-font-smoothing: auto;      /* NEVER antialiased — greys out DirectWrite */
  -moz-osx-font-smoothing: auto;
  text-rendering: auto;              /* NEVER optimizeLegibility — disables hinting */
  font-synthesis: none;              /* no faux bold/italic */
  font-variant-ligatures: none;      /* Segoe's default ligatures blur at 13px */
}
```

The existing build already gets `-webkit-font-smoothing: auto` right
(`globals.css:47`). Preserve that.

### The seven rules

1. **Integer font sizes and integer px line-heights.** Every value in §5.2 is an
   integer. Never use `em`/`rem` line-heights that compute to fractions, and
   never `line-height: 1.5` on a 15px size (22.5px).

2. **Never transform a text container.** No `transform`, `scale`, `rotate`, or
   `translate` on any element containing a glyph — including hover lifts, card
   scale-ups, and animated entrances. This is the single largest cause of blurred
   text on Windows, because a transformed layer is composited off the
   pixel grid and loses subpixel positioning. It is why §4.7 forbids it globally.

3. **Never `filter`, `opacity` animation, or `backdrop-filter` over text.**
   Each promotes the element to its own composited layer and switches
   DirectWrite from subpixel to greyscale antialiasing mid-animation, producing
   a visible "text goes fuzzy then sharp" flicker. Opacity *end states* are
   fine; animating opacity on a text block is not. The skeleton pulse is
   permitted because skeletons contain no glyphs.

4. **Whole-pixel geometry where a human controls it.** Be precise about the
   mechanism here, because the naive version of this rule is unachievable.
   Fractional *layout* widths are normal and harmless: a fluid grid column of
   387.2px is rounded once when the box is painted, and DirectWrite still
   positions glyphs on the pixel grid inside it. What actually blurs text is a
   fractional **compositing** offset — an element promoted to its own layer and
   drawn at a sub-pixel position, which is why rules 2 and 3 exist.

   So the requirement applies only where a value is set imperatively and would
   otherwise persist a fraction:
   - the preview dock's width is an integer, snapped on drag release and on
     restore from `localStorage` (§4.5) — a dragged 483.6px dock would keep
     re-laying-out its contents on a fraction across sessions;
   - `.dock-layout` uses `1fr` + an integer `px` column rather than `60% / 40%`,
     so the dock's width is the value the customer chose;
   - flex children carry `min-width: 0` and integer `gap`, so text wraps rather
     than overflowing;
   - animated width or height on a text container is forbidden outright — a
     fraction *in motion* is the blur case, not a fraction at rest.

   Fluid `1fr` and `auto-fit` grids are explicitly permitted and expected.

5. **No sub-pixel borders.** 1px minimum. `0.5px` and `1px` at 125% scaling
   round differently and produce visible hairline inconsistency across cards.

6. **No letter-spacing below 13px beyond ±0.01em**, except the uppercase
   `--type-micro`, where +0.06em is required for legibility. Tight tracking on
   small Segoe text collides glyphs at 100% scaling.

7. **Text shadows: none.** Not for depth, not for contrast. Contrast comes from
   the token pairs in §4.1.

### Scaling verification: 100% / 125% / 150%

Windows display scaling multiplies CSS px by 1.0, 1.25, and 1.5. Because every
size and line-height is an integer, the results are:

| Token | 100% | 125% | 150% |
|---|---|---|---|
| display-xl 40/46 | 40/46 | 50/57.5 | 60/69 |
| display-l 32/38 | 32/38 | 40/47.5 | 48/57 |
| title-m 20/26 | 20/26 | 25/32.5 | 30/39 |
| title-s 18/26 | 18/26 | 22.5/32.5 | 27/39 |
| body-m 15/24 | 15/24 | 18.75/30 | 22.5/36 |
| body-s 14/22 | 14/22 | 17.5/27.5 | 21/33 |
| label 13/18 | 13/18 | 16.25/22.5 | 19.5/27 |
| caption 12/16 | 12/16 | 15/20 | 18/24 |
| micro 11/14 | 11/14 | 13.75/17.5 | 16.5/21 |

Fractional *font sizes* at 125% are expected and harmless: DirectWrite renders
fractional sizes cleanly and positions glyphs at subpixel precision. Fractional
**line-heights** are the risk, because they accumulate down a long column and
push later baselines off-grid. Mitigation, and it is sufficient:

- Line-heights are declared in px, so the browser rounds each line box once
  rather than compounding a ratio.
- Every element that stacks more than ~8 lines uses an even line-height
  (26, 24, 22, 16, 14 — all even), so ×1.25 yields a `.5` at worst and ×1.5
  yields an integer.
- Section spacing uses `--space-*` tokens, all of which are integer-safe at both
  scale factors (§4.2), so a `.5` in one line box never propagates into the
  layout above or below it.

Verification is not theoretical — it is a required review step. See
[08-acceptance-criteria.md § Visual review](08-acceptance-criteria.md) for the
screenshot matrix: every act captured at 100%, 125%, and 150% and compared for
baseline drift, hairline consistency, and glyph blur.

### Font fallback behaviour

`Segoe UI Variable Display` exists on Windows 11 (build 22000+) and not on
Windows 10 or non-Windows. The fallback chain degrades in the right order:
`Segoe UI Variable Static Display` → `Segoe UI Semibold` → `Segoe UI` → `Inter`
→ `system-ui`. On Windows 10 the product renders in `Segoe UI` throughout,
which is correct and unremarkable rather than broken. No layout depends on
metric compatibility between the faces, because all vertical rhythm comes from
px line-heights.

`Georgia Pro` falls back to `Georgia`, which is present on effectively every
Windows and macOS install. The brand line therefore always renders in a serif.

## 5.4 Accessibility interaction

- Body text is 15px minimum for content and 12px minimum anywhere. Nothing below
  12px exists in the system.
- Text reflows to 320px width with no horizontal scroll at 400% browser zoom
  (WCAG 1.4.10). The reading measure and stacked `.field-row` make this hold.
- No text is rendered as an image.
- Line length is capped at 720px ≈ 80 characters at 15px, the readable maximum.
- `Appearance → Text size: Large` [Tier 2] multiplies the base from 16px to 18px
  via a single `:root` font-size change; because the scale is token-driven,
  every size follows and no layout is hardcoded to a px text width.
