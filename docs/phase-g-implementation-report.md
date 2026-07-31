# Foundry v2 Phase G implementation report

Date: 2026-07-31

Status: implementation, automated certification, and the reloaded in-app
browser verification are complete.

## Scope delivered

Phase G closes responsive and accessibility gaps across the Phase A–F
experience and adds permanent certification gates.

- Mobile builds use a compact project header, an expandable phase summary, and
  a sticky safe-area-aware `View preview` action.
- Mobile preview is a full-screen modal sheet with `Done`, no redundant device
  presets, Escape support, focus containment, and invoker focus restoration.
- Tablet builds use `Build` / `Preview` tabs rather than an unusable side dock.
  The live tab carries a labelled green status mark and each tab restores its
  own saved page position.
- Desktop builds retain the real resizable, collapsible, per-project preview
  dock at 1280px and above.
- Delete and stop confirmation sheets now trap focus, initially focus the safe
  action, close safely on Escape or backdrop activation, restore the invoker,
  and do not steal focus when mission polling rerenders the page.
- `Something else` and `Skip for now` move focus into the field they reveal.
- Tablet rail controls keep permanent accessible names and show visual labels
  on hover and keyboard focus.
- Small text no longer uses the lower-contrast `--accent-line` token.
- Preview links and controls meet the 44px touch-target and 8px separation
  rules below 1280px.
- Repair narration is suppressed when an assertive `Needs you` message is
  active, so only one meaningful live stream is announced.
- Reading errors suppress the polite reading announcement and use the inline
  alert instead.
- Reduced-motion mode keeps the single sourced phase label and disables the
  animation loops. It no longer renders a second `Building · live` string.
- The elapsed build clock advances every ten seconds and displays seconds
  (`1 min 20 sec`) instead of appearing frozen on a whole-minute value.
- The time chip is labelled `Elapsed`, so the header no longer repeats
  `Building` / `build`.
- Completed projects now separate technical verification from launch
  readiness. Contract checks can pass in Foundry's controlled preview while
  missing customer credentials, brand assets, or other launch content remain
  explicitly listed.
- Future credential-gated builds must label Foundry's runtime-only access as
  development-only and may not imply that the customer's final access details
  were supplied.
- The 320px reflow no longer inherits a fixed 320px body minimum, so a classic
  vertical scrollbar cannot create horizontal page movement.
- Confirmation sheets now receive their invoker explicitly. Escape and safe
  cancellation return focus to the project-actions control even after its
  menu unmounts.
- Preview health is sourced only from the recorded runtime projection. An
  iframe-local error event can no longer falsely override a healthy HTTP 200
  runtime with `Lost connection`.

The pre-implementation source and capability mapping is recorded in
`docs/phase-g-implementation-map.md`.

## Certification architecture

`apps/web/tests/phase-g-certification.test.mjs` permanently checks:

- mobile, tablet, desktop, and wide responsive contracts;
- real preview URL provenance;
- sheet focus traps and restoration;
- clarification field focus;
- absence of positive `tabindex` and native browser dialogs;
- token contrast ratios;
- the small-text accent-colour prohibition;
- reduced-motion, forced-colour, focus-ring, touch-size, and safe-area rules;
- one meaningful live stream with a silent engineering activity list;
- fixture/demo import prohibition;
- prototype-intelligence and fixed completion-count prohibition;
- continued inclusion of every Phase A–G web suite.

`test/project-conversation-diversity.test.js` now certifies the eight approved
Phase G workloads both sequentially and concurrently. It checks unique
summaries, audiences, journeys, design directions, recommendations, decisions,
assumptions, and verification promises, plus independent project-owned arrays,
plans, and mission identifiers.

The workloads are:

1. photographer portfolio;
2. appointment booking application;
3. restaurant reservations REST API;
4. internal employee directory;
5. customer support portal;
6. expense-management web application;
7. plumbing company website;
8. AI-assisted document-review tool.

## Automated results

- Phase A–G web suite: 57 passed, 0 failed.
- Production build: passed.
- TypeScript: passed.
- ESLint: passed.
- Focused Phase G and dynamic-isolation tests: passed.
- Domain-independence regression: 21 passed, 0 failed.
- Fixture-intelligence scan: passed.
- Git whitespace check: passed.
- Complete repository suite: 254 passed, 0 failed, 0 skipped, 0 cancelled.
- Complete repository duration: 851.913 seconds (14 minutes 11.913 seconds).
- Repository timeout: none.

## Accessibility results

Automated checks pass for semantic labels, keyboard implementations, visible
focus infrastructure, focus containment/restoration, live-region suppression,
contrast tokens, touch sizes, reduced motion, forced colours, and 320px reflow
rules.

A human NVDA listening session is not automatable from Foundry and is not
claimed as passed. It remains the one explicit external accessibility check.

## Visual evidence

The reloaded in-app browser opened the real delivered Admin Login System and
confirmed:

- the completion heading says every **contract check** passed rather than
  making an unqualified launch claim;
- the preview carries `Verified preview · Final launch content still needs
  your input`;
- a dedicated `Launch readiness` section explains that the workflow passed in
  Foundry's controlled preview and lists the administrator credential and logo
  still required;
- `What I left out on purpose` now contains actual scope limitations rather
  than misclassifying missing launch content.
- 1440px desktop, 1024px and 768px tablet, 375px mobile, and 320px reflow have
  zero horizontal scroll;
- every visible interactive control measured at least 44px below 1280px;
- the mobile navigation sheet initially focuses its close control, wraps focus
  in both directions, closes on Escape, and restores the menu invoker;
- the delete confirmation initially focuses `Keep it`, wraps between its safe
  and destructive actions, closes on Escape, and restores the exact project
  actions button;
- `Ctrl+K` focuses project search with a visible focus ring while the URL-backed
  search keeps the previous project cards visible during refresh;
- the preview remained `Live Â· 127.0.0.1:60810` at every certified viewport.

The final viewport captures are:

- `docs/phase-g-screenshots/desktop-delivery-viewport.png`;
- `docs/phase-g-screenshots/tablet-delivery-viewport.png`;
- `docs/phase-g-screenshots/mobile-delivery-viewport.png`;
- `docs/phase-g-screenshots/reflow-delivery-viewport.png`.

The live pass found and repaired three defects before sign-off: scrollbar-width
reflow at 320px, lost confirmation focus restoration, and a false disconnected
preview state. The Phase Aâ€“G suite was rerun after all three repairs.

Normal Foundry services remain available:

- `http://127.0.0.1:3000/`: HTTP 200;
- local API health: `ready`;
- live-discovered providers: 3.

## Missing capabilities and intentional limits

- Native operating-system scale cannot be changed by the application. The
  automatable review uses browser scale/device emulation for 100%, 125%, and
  150%, plus a 320px effective viewport for the 400% reflow condition.
- A human NVDA listening pass remains external.
- There is no repository pixel-baseline CI service. Phase G keeps screenshots,
  deterministic geometry assertions, and structural visual rules locally
  instead of pretending a remote visual-diff service exists.
- Preview content inside the generated project iframe is governed by that
  project's own requirement contract; this certification applies to Foundry's
  customer-facing chrome.
