# Foundry v2 — Customer Experience Redesign

Complete, implementation-ready redesign of the Foundry customer experience.
Authored as the product-design authority for the surfaces a customer touches.
Nothing here changes Foundry's backend architecture.

## Read in this order

| # | Document | Purpose |
|---|---|---|
| 1 | [01-diagnosis.md](01-diagnosis.md) | What is wrong with the current experience, anchored to code |
| 2 | [02-principles-and-architecture.md](02-principles-and-architecture.md) | Experience principles, information architecture, end-to-end journey |
| 3 | [03-screens.md](03-screens.md) | Page-by-page specification for all 35 surfaces |
| 4 | [04-design-system.md](04-design-system.md) | Tokens, components, every component state, motion |
| 5 | [05-typography.md](05-typography.md) | Exact type system and Windows rendering guidance |
| 6 | [06-copy-deck.md](06-copy-deck.md) | Exact customer-facing copy, string by string |
| 7 | [07-responsive-and-accessibility.md](07-responsive-and-accessibility.md) | Breakpoint rules and WCAG AA requirements |
| 8 | [08-acceptance-criteria.md](08-acceptance-criteria.md) | Codex-ready acceptance criteria + visual review checklist |
| — | [prototype/index.html](prototype/index.html) | Coded interactive prototype of the design language and key flows |

## The governing constraint

Foundry builds **web projects only**. This is not a soft limit:

- `src/domain/toolchain-stack.js:300` — one certified stack,
  `nextjs-typescript-sqlite-npm-playwright@1.0.0`,
  `supportedProjectCategories: ["web-application"]`, `platform: "web"`.
- `src/domain/toolchain-stack.js:550` — manifest validation *rejects* any
  components other than Next.js / TypeScript / SQLite / npm / Playwright.
- `src/understanding-plane/project-understanding-service.js:379` — the model is
  told to classify platform honestly because "Foundry currently supports only
  web projects… so unsupported requests can be rejected rather than silently
  converted."

Every screen in this redesign is honest about that boundary. Requests for
mobile, desktop, native games, or CLI tools get a designed, respectful decline
(see [03-screens.md § 31](03-screens.md#31-unsupported-request)) — never a
silent substitution, and never a home-screen chip that leads there.

## Capability tiers

Each surface is tagged. Codex implements Tier 1 completely before Tier 2.

**Tier 1 — Buildable now.** Uses only the existing local API:

```text
GET    /health
GET    /providers
POST   /providers/refresh
GET    /missions?q=
POST   /missions                      { intent }
GET    /missions/:id
DELETE /missions/:id
POST   /missions/:id/clarify          { answers: [{ questionId, answer }] }
POST   /missions/:id/understand
POST   /missions/:id/start
POST   /missions/:id/stop
```

**Tier 2 — Designed, needs a backend capability that does not exist yet.**
Specified in full so the design is settled before the capability lands, and
rendered in the UI only when a capability probe reports it available. Tier 2
surfaces must never ship as inert decoration.

| Surface | Missing capability |
|---|---|
| Follow-up on a finished project (§19) | No endpoint accepts new intent on a `SUCCEEDED` mission; `/clarify` is rejected outside `INTAKE`/`CLARIFYING` (`project-understanding-service.js:421`) |
| Approvals (§15) | No approval gate or resume-on-approval endpoint |
| Credentials and integrations (§16) | Credentials are read from local `.env` only and deliberately never reach the browser |
| Settings (§26) | No settings persistence of any kind |
| Undo a change (§19) | Workspace checkpoints exist internally; no customer-facing revert endpoint |
| Preview variants beyond web (§13) | One runtime adapter, `nextjs-web-runtime` |
| Public deployment (§15) | Not implemented at any layer |

## The one backend text change this redesign requires

The redesign asks for no architectural change, with a single exception that is
copy, not architecture. "Never expose technical terminology" is unachievable
while question text is generated without a plain-language constraint, because
the UI renders `openQuestions[].prompt` verbatim (`page.tsx:512`).

Add one line to the existing prompt array in
`src/understanding-plane/project-understanding-service.js`
(`understandingPrompt`, around line 366):

```text
Write every question, reason, and suggestion for a non-technical business
owner. Ask about outcomes and never about implementation. Never use the words
persistence, authentication, database, session, runtime, topology, provider,
schema, framework, or architecture in customer-visible text. Each question
must offer two to four concrete plain-language options, and the first option
must be the one you would professionally recommend.
```

Rationale, exact placement, and the fallback if this is refused are in
[03-screens.md § 7](03-screens.md#7-clarification).

## Forbidden vocabulary in UI copy (enforced by tests)

`test/domain-independence.test.js:61` scans every `.js/.ts/.tsx` file under
`src/` and `apps/web/app/` and fails the build if any of these appear:

```text
inventory   stock   product / products   quantity
inventoryPageLoaded   productCreated   startingStockVisible   stockEdited
Northstar   product-add   preview/inventory
```

This is the domain-independence invariant: the first inventory workload is a
permanent certification fixture, so production code must carry no trace of its
vocabulary (`docs/architecture-correction-domain-independence.md`).

It constrains customer copy in ways that are easy to trip over:

- "I build web products today" is illegal → **"I build for the web today"**
- "Understanding the product" is illegal → **"Understanding what you need"**
- Example chips and the suggestion lexicon may not mention inventory or stock.

Any new copy must be checked against this list before it ships. The word
"product" in particular is a natural thing to write and is not allowed.

## What this redesign does not do

- No change to the Mission Ledger, Requirement Contract, Stack Registry,
  Verification Authority, Execution Engine, or model routing.
- No new project families, stacks, or runtime adapters.
- No visual concept that cannot be built against the endpoints above.
