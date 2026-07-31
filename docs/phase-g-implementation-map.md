# Foundry v2 Phase G implementation map

Date: 2026-07-30

Phase boundary: responsive behavior, accessibility, visual regression, and
dynamic-project certification. All Phase A–F behavior remains a mandatory
regression gate.

| Approved Phase G surface | Existing production source | Required adapter / test | Missing capability |
|---|---|---|---|
| Mobile navigation sheet | `ApplicationShell`, `NavigationRail`, shell CSS | Verify focus trap, Escape/backdrop close, invoker focus restoration, 44px targets | None |
| Confirmation sheets | Page-level typed delete/stop confirmation state | Add a polling-safe focus trap, safe initial focus, Escape/backdrop close, and invoker focus restoration | None |
| Mobile build and preview | Real `PreviewState` and readiness URL through `ActiveExecution` / `PreviewDock` | Mobile preview sheet with a sticky safe-area action; no placeholder or second preview | None |
| Tablet build and preview | Real `PreviewState` and readiness URL | `Build` / `Preview` segmented control, live indicator, and retained build DOM/scroll | None |
| Desktop preview dock | Existing persisted per-mission dock width and runtime projection | Preserve resizer, collapse, width presets and real iframe; certify at desktop/wide widths | None |
| Responsive layout matrix | Existing tokenized CSS and modular Phase A–F surfaces | Browser assertions at 375, 768, 1024, 1280 and 1440 CSS pixels, plus 320px reflow | None |
| Windows scaling / zoom | Browser viewport and device-scale emulation | Visual checks at 100%, 125% and 150%; 400% reflow represented by a 320px effective viewport | Native operating-system scaling cannot be changed from the app; browser emulation is the automatable equivalent |
| Keyboard operation | Native controls, question radiogroups, disclosures, preview handle | Full tab-order and control-behavior assertions; no positive `tabindex` | None |
| Live-region discipline | Sourced reading/build/repair/completion states | Structural and live DOM count tests; activities remain silent | None |
| Reduced motion / forced colours | Existing CSS media queries | Structural checks plus browser media emulation where supported | None |
| Contrast and focus | Design tokens and shared focus ring | Token contrast calculation, computed focus-ring assertions, and small-text accent-line prohibition | None |
| Dynamic project certification | Structured understanding schema, canonical selectors, mission-isolated records | Eight unrelated project profiles through the same view model/UI; assert unique sections, obligations and no leakage | Live paid model calls are not repeated solely for visual certification; the certification harness uses isolated model-shaped outputs and the real production selector/UI |
| Cross-mission isolation | Mission Ledger ownership, sourced experience model, per-mission preview keys | Sequential/concurrent domain tests for understanding, answers, runtime, workspace, evidence, repair and idempotency ownership | None |
| Fixture prohibition | Production source tree and explicit test fixtures | Structural scan for prototype values, fixed model/provider tables, production imports from fixtures/demo | None |
| Visual regression | Approved prototype and real Phase A–F components | Baseline screenshots plus geometry/overflow/state assertions; record intentional dynamic-data differences | Pixel-baseline CI service does not exist; Phase G stores review captures and deterministic geometry evidence locally |
| Screen-reader review | Semantic HTML, labelled controls and landmarks | Automated accessibility-tree/ARIA checks and keyboard review | A human NVDA listening session cannot be truthfully automated; the report must keep this as a manual external check rather than claim it passed |

Implementation rules:

- No responsive variant may invent preview data; every iframe uses the recorded
  runtime readiness URL.
- A hidden responsive surface must be removed from keyboard and accessibility
  navigation.
- Polling must not move focus or replace customer input.
- Certification fixtures remain outside production bundles and may not be
  imported by production components.
- No Phase G test can weaken or replace an earlier phase test.
