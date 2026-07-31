# Phase B implementation report

Date: 2026-07-30

Status: complete. Phase C has not started.

## Delivered surfaces

- Home is a modular customer surface backed by the live mission catalogue.
- The composer has the approved five starter prompts, generic language-only
  completions, 180 ms suggestion debounce, three-to-eight-row growth,
  Enter/Shift+Enter behavior, trimmed submission, and retained focus.
- Projects has phase filters, 200 ms cancellable server search, two-character
  minimum query execution, `?q=` URL state, Ctrl/Cmd+K focus, highlighted
  matches, dimmed previous results, and a recoverable empty state.
- Project cards render canonical sourced summaries, customer phases, real
  activity times, phase-dependent actions, and a truthful overflow menu.
  Rename and Duplicate remain absent because their Tier 2 capabilities do not
  exist. Delete still uses the existing confirmation and optimistic tombstone
  workflow.
- Model providers is a full main-content surface rather than a modal. Provider
  names, availability, reasons, model names, and model states come from the
  live provider catalogue. Refresh performs provider discovery again.
- No model IDs or model-family preference tables were added to the customer
  experience. Production discovery continues to retain each provider's live
  eligible catalogue without name-based tier inference.

## Acceptance mapping

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Home and zero-provider behavior | `app/components/home-view.tsx`, `app/components/project-composer.tsx` | Phase B contract test; live browser |
| Dynamic starter/completion behavior | `experience/intake.ts` | Phase B contract test; live browser |
| Real project cards and actions | `experience/selectors.ts`, `app/components/project-card.tsx` | Phase B contract test; live browser |
| Projects filters and search | `app/components/project-list.tsx`, `app/page.tsx` | Phase B contract test; live browser |
| Live provider transparency | `app/components/provider-view.tsx`, provider registry API | Phase B contract test; live refresh |
| Responsive and accessible interaction | `app/globals.css`, Phase A shell | 375, 768, 1024, 1280, and 1440 browser passes |

## Verification evidence

- Complete repository suite: 203 passed, 0 failed, 0 skipped, 0 cancelled.
  Duration: 624.6 seconds. This command was allowed to finish without the
  previous ten-minute cutoff.
- Current web production build and focused suite: 18 passed, 0 failed.
- TypeScript: passed.
- ESLint: passed.
- `git diff --check`: passed.
- Browser console: no warning or error entries.
- Live provider health: three providers available. A manual refresh returned
  live, provider-specific catalogue counts and preserved the billing
  disclaimer.
- Browser interactions verified: suggestion replacement and refocus,
  Shift+Enter newline, global search shortcut, URL query synchronization,
  loading-to-settled search, highlighted matches, empty-result recovery,
  phase filtering, overflow-menu Escape dismissal and focus return, mobile
  navigation focus return, and provider refresh.
- No page-level horizontal overflow was observed at the required widths.
  All tested interactive controls below 1280 px met the 44 by 44 px minimum.

## Visual comparison

Exact matches include the approved Home heading, lead, five starter chips,
trust line, capability boundary, Projects filters/search, provider copy, and
provider billing disclaimer.

Intentional differences:

- Only Delete appears in project overflow because Rename and Duplicate remain
  Tier 2.
- The provider catalogue is collapsed by provider so a large live API response
  does not dominate the settings surface.
- Mobile phase filters scroll horizontally without exposing a native scrollbar.

Mismatches found and corrected during this phase:

- Tablet/mobile targets below 44 px were raised to the contract minimum.
- The native mobile filter scrollbar was removed while preserving horizontal
  keyboard/touch scrolling.
- A legacy deletion regression asserted a stable source shape; the existing
  stale-response filter was restored to that compatible form and the entire
  suite was rerun.

Open visual mismatches: none.

## Screenshots

- `phase-b-screenshots/home-375x812.jpg`
- `phase-b-screenshots/home-768x1024.jpg`
- `phase-b-screenshots/home-1024x768.jpg`
- `phase-b-screenshots/home-1280x768.jpg`
- `phase-b-screenshots/home-1440x900.jpg`
- `phase-b-screenshots/projects-375x812.jpg`
- `phase-b-screenshots/projects-1440x900.jpg`
- `phase-b-screenshots/providers-375x812.jpg`
- `phase-b-screenshots/providers-1440x900.jpg`
