# Foundry v2 Phase F implementation report

Date: 2026-07-30

Status: Phase F is ready for sign-off. Phase G has not been started. Automated
and real-browser sign-off gates pass, and the normal Foundry web and API
services have been restored.

## Scope delivered

Phase F implements the approved lifecycle outcomes:

- completion;
- failure;
- blocked;
- cancelled;
- unsupported.

The implementation does not add follow-up versions, in-place terminal-state
resume, native build adapters, public deployment, or customer approvals. Those
backend contracts do not exist and no control claims that they do.

## Architecture

Raw mission, contract, runtime, repair and verdict projections are transformed
once in `apps/web/experience/selectors.ts`. The Phase F components consume the
sourced customer experience model:

- `completion-handoff.tsx`
- `lifecycle-outcome.tsx`
- `unsupported-request.tsx`

The page router chooses the surface but does not recalculate lifecycle meaning,
proof counts, limitations, decisions, or unsupported-platform copy.

The pre-implementation source mapping is recorded in
`docs/phase-f-implementation-map.md`.

## Completion truth

- A proof is counted only when the recorded result is `SATISFIED`.
- `PENDING`, `NOT_SATISFIED`, and `UNVERIFIABLE` are never counted as proved.
- A recorded `SUCCEEDED` mission with a customer-projection deficiency uses the
  incomplete handoff and does not receive the success headline.
- The handoff separates `What I proved` from `What I couldn't check`.
- Customer answers are labelled `you chose this`.
- Delegated answers are labelled `my call, because {recorded reason}`.
- Selected enhancements are retained as attributed customer decisions.
- Limitations combine profile constraints, missing launch content, and
  certified-stack limitations. The section never disappears.
- Suggested Version 2 work comes only from unselected live profile
  recommendations.
- Raw evidence and failure output remain under Engineering details.

## Failure, blocked and exhaustion truth

Every non-cancelled terminal surface contains:

1. What I was doing
2. What happened
3. What I did prove
4. What I couldn't prove
5. What I'd try next
6. What I need from you
7. Engineering details

The customer-facing explanation is derived from typed lifecycle state, phase,
repair classification and verdict result. Raw job errors are not rendered as
customer copy.

Blocked missions name the affected customer area when the repair projection
contains one. Because a post-clarification blocker-resolution contract does not
exist, the interface offers an honest revised-project path rather than a fake
resume action.

## Cancellation integration correction

Before Phase F, the Stop endpoint could stop the runtime without recording
`CANCELLED`. Phase F separates:

- explicit customer cancellation: stop the runtime when one exists, append the
  legal `CANCELLED` transition, and preserve the plan/workspace;
- internal worker or server cleanup: stop the runtime without misreporting a
  customer cancellation.

Cancellation also works before a runtime session exists and is idempotent once
terminal. The cancelled surface is neutral and does not use the fault treatment.

## Unsupported requests

The unsupported surface uses the understood `profile.platform`, name and
summary. It names the requested platform, states the certified web outcomes,
offers one real web alternative, and provides one exit. It does not promise a
roadmap or create a native preview.

## Fixture isolation

The Phase F structural test rejects prototype-only terms from the production
components and selector. No production Phase F component imports a fixture or
demo directory.

The lifecycle visual replay prepared for review reads the real deleted mission
ledger only through sequence 94, its genuine `SUCCEEDED` boundary. It does not
modify the immutable ledger or restore a deleted catalogue entry.

## Automated acceptance

- Phase F focused tests: 8/8 pass.
- Phase A–F web suite: 45/45 pass.
- production web build: pass.
- TypeScript: pass.
- ESLint: pass with no errors.
- fixture-intelligence structural scan: pass.
- customer cancellation / cleanup separation: pass.
- complete repository suite: 240/240 pass, 0 fail, 0 cancelled, 0 skipped;
- complete repository duration: 765.85 seconds (12 minutes 45.85 seconds);
- repository suite timeout: none.

## Browser and screenshot status

The in-app browser loaded the real Phase F components at
`http://127.0.0.1:3000/`. A read-only lifecycle replay used the deleted Business
Website mission through sequence 94, its genuine completion boundary, without
changing the customer ledger. Typed replay variants exercised the other
lifecycle surfaces; they were test-harness data only and were never added to the
customer catalogue.

The browser pass verified:

- completion truth at 14 of 15 promises, including the draft notice, live
  preview, browser evidence, attributed decisions, limitations and Version 2
  suggestions;
- neutral cancellation with saved-plan language;
- the seven required sections on blocked and exhausted outcomes;
- a direct unsupported-native request explanation with one real web
  alternative and one exit;
- no horizontal page overflow at 375, 768 or 1024 CSS pixels;
- stacked handoff/preview layout at 375 and 768 CSS pixels;
- side-by-side handoff/preview layout at 1024 and 1280 CSS pixels;
- phone preview mode at an exact 375 CSS-pixel iframe width;
- no browser console warnings or errors during the completion pass.

The captured evidence is in `docs/phase-f-screenshots/`:

- `completion-375.png`
- `completion-768.png`
- `completion-1024.png`
- `completion-1280.png`
- `cancelled-1024.png`
- `blocked-1024.png`
- `exhausted-1024.png`
- `unsupported-1024.png`

After the replay, the regular web/API service was restored. Its health endpoint
reports ready, provider discovery returns live Anthropic, Google Gemini and
OpenAI catalogues, and the real Admin sign-in page project is again visible in
the browser.

## Remaining limitations

- True in-place follow-up versions require a new mission/version backend
  contract.
- Terminal failed, exhausted, blocked, and cancelled missions cannot legally
  resume in place.
- Blocker resolution after clarification has no typed answer endpoint.
- Native mobile, desktop and game build/preview adapters do not exist.
- Phase G responsive, accessibility, visual-regression and dynamic-project
  certification has not started.
