# Phase A — Broad-request interpretation and dynamic subtype generation

Status: implemented and live-certified. This report intentionally stops after Phase A.

## 1. Root cause

The prior intake path sent every non-empty request directly to the full Project Understanding generator. A one-word request such as `Inventory` therefore had no durable ambiguity-resolution artifact, no subtype-specific quality gate, and no customer surface before Foundry committed to a complete `ProjectDesign`. The UI could only render the assumed proposal returned by that downstream model call.

Phase A inserts one bounded stage before that existing path:

1. Detect a structurally broad initial request (one or two words, with no subtype choice yet).
2. Generate a strict `ProductTypeDiscovery` through the live model registry.
3. Validate relevance, differentiation, feasibility, completeness, and recommendation integrity.
4. Persist the validated discovery in the Mission Ledger.
5. Render the generated options and record the customer's typed choices.
6. Send the selected subtype(s) and context into the existing Project Understanding route.

The existing proposal, approval, contract, execution, repair, and verification responsibilities remain downstream.

## 2. Files created or changed

### Product intelligence and service integration

- `src/domain/product-type-discovery.js` — schema, prompt, normalization, single-discovery quality gate, cross-project differentiation gate, and broad-request trigger.
- `src/understanding-plane/project-understanding-service.js` — early Phase A route, provider correction/failover, evidence and model-call recording, subtype selection validation, and downstream handoff.
- `apps/web/local-api/server.mjs` — exposes the latest discovery and sends product-subtype choices through model re-evaluation rather than local proposal selection.

### Customer experience

- `apps/web/app/components/product-type-discovery.tsx` — generated option cards, recommendation path, compatible multi-select, Other, context note, and Foundry-delegated choice.
- `apps/web/app/page.tsx` — routes a mission with a discovery but no profile to the Phase A surface.
- `apps/web/app/globals.css` — responsive Product Strategy surface styles.
- `apps/web/experience/contracts.ts` — typed discovery and `product-subtype` selection contract.
- `apps/web/experience/validation.ts` — API payload validation for the discovery artifact.

### Tests and evidence

- `test/phase-a-product-type-discovery.test.js` — exact broad inputs, relevance, differentiation, noun-substitution, unsupported-capability, portfolio, prompt, and no-hardcoding tests.
- `apps/web/tests/phase-a-foundation.test.mjs` — production wiring and customer-control regression gate.
- `test/domain-independence.test.js` — retains fixture-specific bans while allowing the newly required generic product-intelligence vocabulary.
- `docs/phase-a-product-type-discovery/screenshots/*.png` — six live UI captures plus the combined-selection capture.

## 3. Structured schema

The provider-facing schema is strict (`additionalProperties: false`) and requires:

```text
ProductTypeDiscoveryModelOutput
├── interpretation
│   ├── summary: string
│   ├── reasoning: string
│   └── confidence: number
└── subtypes: 5..10 items
    ├── title: string
    ├── explanation: string
    ├── likelyUsers: 1..4 strings
    ├── likelyPrimaryOutcome: string
    ├── whyItMayFit: string
    ├── confidence: number
    ├── recommended: boolean
    ├── canCombine: boolean
    ├── combinationNote: string
    ├── deliveryPlatform: "web"
    └── requiredCapabilities: certified capability IDs only
```

Normalization assigns stable option IDs (`subtype-1`, `subtype-2`, …), preserves the original request and context, converts confidence into a customer-facing score/reason record, and deeply freezes the persisted artifact.

Customer choices use the existing structured follow-up envelope with `kind: "product-subtype"`. Generated options carry their option ID and exact generated title. `Other` carries no option ID. Multiple generated choices are accepted only when each is marked combinable.

## 4. Model prompts

The Phase A system prompt defines a separate Product Intelligence authority whose only responsibility is resolving ambiguity before a proposal. The request prompt requires the model to:

- reason from the exact customer wording and supplied context;
- generate six choices (within the schema's permitted 5–10 range);
- avoid stored category lists and category templates;
- differentiate choices by users, operating context, workflow, or outcome;
- recommend exactly one defensible interpretation;
- stay inside the certified web stack and its current limitations;
- use only live certified capability identifiers;
- use customer language rather than implementation choices.

When validation fails, Foundry provides the specific quality defect and requests a complete regeneration using a different reasoning strategy. It may make three correction attempts per provider and may fail over across three distinct eligible providers. Numeric range checks are enforced locally so the schema remains portable across provider-specific structured-output implementations.

The downstream proposal prompt now states that structured subtype selections and context are authoritative. Compatible selections must be composed rather than silently dropping one.

## 5. Product Intelligence Quality Gate

Valid JSON alone is rejected unless all of these pass:

- 5–10 complete choices;
- exactly one recommendation;
- every choice grounded in the original broad request or supplied context;
- unique semantic signatures;
- pairwise semantic overlap below the repetition threshold;
- primary outcomes sufficiently varied to reject noun substitution;
- 1–4 concrete likely-user groups;
- confidence values between 0 and 1;
- web delivery only;
- every required capability present in the certified stack manifest;
- cross-project title/content comparison rejects copied sets across unrelated requests.

Quality failures trigger correction or provider failover and are never persisted as a customer-visible discovery.

## 6. Live screenshots for all six requests

- [Inventory](./screenshots/inventory.png)
- [Website](./screenshots/website.png)
- [Portal](./screenshots/portal.png)
- [Booking](./screenshots/booking.png)
- [API](./screenshots/api.png)
- [Internal tool](./screenshots/internal-tool.png)
- [Inventory — two compatible choices plus context](./screenshots/inventory-combined.png)

## 7. Proof project-specific subtype arrays are not hardcoded

A production scan covered the schema/quality module, understanding service, API projection, and customer component:

```json
{
  "productionFilesScanned": 4,
  "forbiddenMatches": 0,
  "structuredSchemaMentions": 5,
  "dynamicRenderMentions": 2
}
```

The scan checked for example catalogue entries, project-family `if` branches, and named subtype arrays. The component renders `discovery.subtypes.map(...)`; the service accepts only `validateStructuredModelOutput(..., PRODUCT_TYPE_DISCOVERY_SCHEMA)` before normalization and persistence. Exact example choices exist only in tests, where they prove the quality gate.

## 8. Test and live-certification results

### Deterministic gates

- Phase A product-intelligence and domain independence: **34/34 passed**.
- Phase A web foundation: **4/4 passed**.
- Full web experience suite: **65/65 passed**.
- Web TypeScript check: **passed**.
- Web lint: **passed**.
- Production web build: **passed**.
- Node syntax checks for the new domain/service/API path: **passed**.

The broad repository run initially reported 268/272 passing. The Phase A vocabulary conflict in `domain-independence.test.js` was corrected and that complete 30-test file now passes. Three unrelated failures observed in the dirty worktree remain outside Phase A: two long-running “three clean real mission” certification cases and one Milestone 9A correction-attempt assertion (the implementation currently performs one initial correction while that assertion expects three). Phase A does not modify their execution/repair behavior.

### Live Foundry results

| Input | Choices | Foundry recommendation | Result |
|---|---:|---|---|
| Inventory | 6 | Small Retail Boutique Stock Manager | Pass |
| Website | 5 | Local Business Landing Page | Pass |
| Portal | 5 | Employee Self-Service Hub | Pass |
| Booking | 6 | Local Service Appointment Scheduler | Pass |
| API | 5 | Interactive API Documentation Explorer | Pass |
| Internal tool | 5 | IT Equipment and Asset Tracker | Pass |

All six live artifacts passed `validateDiscoveryPortfolioDifferentiation(...)` together, proving the sets were not repeated across the unrelated requests.

The live browser also verified:

- all six surfaces rendered 5–6 model-generated cards;
- the recommendation badge and first-class recommendation path rendered;
- two compatible Inventory choices remained selected simultaneously;
- the primary action changed to `Combine 2 choices and continue`;
- the context note accepted natural text;
- the structured handoff produced the downstream profile `Shop Inventory and Lending Hub`;
- the downstream summary and intended users reflected both selected directions;
- the customer context appeared in the existing conversation ledger;
- no browser console errors were recorded.

Phase A stops here. Phases B–H were not implemented in this change.
