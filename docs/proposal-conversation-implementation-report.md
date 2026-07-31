# Proposal conversation sign-off

Date: 2026-07-30

Status: ready for Phase F sign-off.

## What changed

The pre-build proposal is now a progressive conversation instead of a dense
requirements document.

- "Here's what I think you need" gives a short, project-specific summary and
  names the likely audience.
- The proposal separates user-facing features from primary journeys.
- Foundry states which sensible defaults it will include automatically.
- A dedicated design-direction step explains the recommended style, layout,
  tone, mobile priority, and accessibility considerations.
- The customer can accept the recommendation, choose another direction, or
  enter a custom direction.
- Recommendations are project-specific rather than a fixed checklist.
- Only decisions that materially change the result are asked.
- Every decision supports Foundry's recommendation, another listed choice,
  custom text, or "Let Foundry choose".
- The final note is optional.
- "Continue with Foundry's recommendations" works without forcing the customer
  to answer every control.
- The decision brief records the chosen design direction, customer note, and
  explicit or delegated decisions.
- Opening or returning to the proposal resets the surface to the beginning, so
  the first heading is not clipped by the previous page's scroll position.

## Dynamic proposal generation

The understanding model now returns a validated structured proposal containing:

- summary
- audiences
- primary journeys
- design direction
- proposed features
- included defaults
- recommendations
- observations
- important decisions
- assumptions

These values come from the active model response and customer requirements. The
production proposal contains no embedded example business, feature, design, or
recommendation content. Older saved profiles receive neutral derived fallbacks
so the new interface remains compatible without inventing a fixed project.

Model availability remains provider-driven. The restored live API reports three
healthy providers and their currently discovered model catalogues; the proposal
work did not replace that with a fixed UI model list.

## Eight-project visual walkthrough

The conversation was exercised with eight distinct, isolated review profiles:

1. Admin sign-in experience
2. Photographer portfolio
3. Appointment booking app
4. Business website
5. Internal employee directory
6. Reservation REST API
7. AI research assistant
8. Customer self-service portal

For every profile, the rendered summary, audience, features, journeys, design
direction, recommendations, and important decision changed with the project.
Each desktop run opened at `scrollY = 0`, with the proposal heading visible near
the top of the surface and no horizontal overflow. The appointment-booking
profile was also checked at 375px wide and rendered in a single column without
horizontal overflow.

Interaction walkthroughs also covered:

- accepting every Foundry default without touching the controls
- entering a custom design direction, custom decision, and customer note
- selecting "Skip" and preserving its optional context in the decision brief

Screenshots are stored in
`docs/proposal-conversation-screenshots/`.

The desktop screenshots were captured immediately before the final removal of a
programmatic heading focus outline, so some may show a thin orange outline that
is no longer present in the implementation. The post-fix mobile screenshot
confirms the final focus treatment. A browser security policy prevented a second
desktop recapture after the service restart; it did not prevent the completed
eight-project walkthrough or interaction checks.

## Regression evidence

- Web application test suite: 50 passed, 0 failed.
- Complete repository test suite: 246 passed, 0 failed, 0 skipped, 0 cancelled.
- Production web build: passed.
- TypeScript validation: passed.
- ESLint validation: passed.
- Git whitespace validation: passed before report creation and repeated at
  sign-off.

The complete repository suite took approximately 12 minutes 28 seconds. This is
reported as a completed pass, not a timeout. The user-facing project build time
and this development regression-suite duration are separate measurements.

## Restored runtime

The temporary eight-profile review API was stopped after verification. Normal
Foundry development services were restored:

- web application: `http://127.0.0.1:3000/` returned HTTP 200
- local API: `http://127.0.0.1:3927/health` returned `ready`
- live providers: 3
- persisted mission catalogue: the original Admin sign-in mission is present
