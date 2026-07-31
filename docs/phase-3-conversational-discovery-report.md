# Phase 3 — Conversational discovery and custom input

## Scope

This phase replaces the long discovery report with a seven-step working session and adds durable, customer-created input. It does not implement Phase 4.

## Delivered

- One active discovery stage at a time: understanding, direction, design, ideas, decisions, customer input, and review.
- A first-class “Continue with Foundry’s recommendations” path when the customer wants Foundry to decide safely.
- Persistent free-text input for context, corrections, workflows, features, design, business rules, roles, integrations, limitations, and acceptance expectations.
- Customer messages are recorded in the append-only Mission Ledger before model re-evaluation starts, so provider failure cannot lose customer input.
- Every revision uses the live capability catalogue and router. There is no provider or model-name table in the Phase 3 flow.
- Revisions use a compact, input-scoped leaf-operation protocol, then rebuild and validate the complete Project Design before publishing a new profile.
- A bounded correction turn gives a dynamically selected provider the precise validation defect when its first change set is almost valid; invalid contract data is never silently accepted.
- Successful revisions show the customer which proposal sections changed. All messages remain part of the eventual Approved Project Contract.
- The old 20-second project-understanding cutoff was removed; the normal guarded provider request boundary now applies.

## Regression evidence

- Core and prior-phase suite: 205 passed, 0 failed.
- Web A–G and Phase 3 suite: 59 passed, 0 failed.
- Focused Phase 3 suite: 7 passed, 0 failed.
- Web production build: passed.
- TypeScript: passed.
- ESLint: passed.
- `git diff --check`: passed.

## Phase boundary

Phase 3 stops at conversational discovery, durable customer input, and validated proposal revision. Phase 4 has not been started.
