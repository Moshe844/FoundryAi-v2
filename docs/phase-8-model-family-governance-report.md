# Phase 8 — Centralized model-family governance

## Outcome

Phase 8 replaces scattered family eligibility checks with one immutable,
configuration-driven policy shared by governed catalog discovery and the legacy
discovery-manifest compatibility path.

Provider discovery remains dynamic. A provider-reported model is classified by
authoritative metadata when available, then by maintained family rules as a
fail-safe. Neither mechanism grants normal routing eligibility by itself. Exact
engineering-family validation, lifecycle, endpoint compatibility, freshness,
capability evidence, and Phase 7 task contracts still have to pass.

## Authoritative policy

`src/config/model-governance-policy.js` now owns:

- conditional general-engineering family rules for OpenAI, Anthropic, and
  Google Gemini;
- default-denied family rules for robotics, embeddings, image generation,
  video generation, speech, audio/music, moderation, deep research,
  computer use, realtime/live audio, and search;
- explicit `allowedTaskClasses` on every rule;
- stable rule IDs, exclusion reasons, metadata match evidence, and policy
  version `2026-08-02`;
- a fail-closed unknown-family rule with no allowed engineering tasks.

## Enforcement flow

1. Provider metadata is checked for authoritative purpose signals.
2. Maintained family rules act as a generic fail-safe.
3. Specialized or unknown families receive `DENIED`, an empty task scope, and
   a specific reason.
4. Broad provider families receive only `CONDITIONAL`; this is not routing
   approval.
5. The existing exact engineering-family, lifecycle, endpoint, freshness, and
   capability gates determine final eligibility.
6. Persisted routing manifests retain the family rule ID and policy version for
   auditability.

The router contains no model-family or model-ID classification rules.

## Regression coverage

`test/phase-8-model-family-governance.test.js` proves:

- all production providers have centralized family rules;
- excluded rules are default-denied with no engineering task scope;
- robotics, embedding, image, video, speech, audio/music, research, and
  computer-use families cannot become engineering eligible;
- provider metadata overrides a general-looking model ID;
- unknown families fail closed;
- valid general families retain explicit task scope;
- the legacy discovery path consumes the same centralized decision;
- specialized patterns are not scattered into domain or adapter code.

`scripts/eval-phase-8-model-family-governance.mjs` provides a standalone,
deterministic certification artifact.

## Certification

- Phase 8 + model governance + dynamic discovery + Phase 7: 36/36 passed.
- Phase 8 standalone evaluator: passed all four architectural checks.
- Domain-independence correction gate: 27/27 passed.
- Complete repository regression: 312/312 passed, with no skips or timeouts.
- Web production build and regression: 61/61 passed.
- Web TypeScript validation: passed.
- Patch whitespace validation: passed (line-ending notices only).
- Restarted local API: ready; all three providers are available, fresh, and
  Auto-routing ready, with 15 currently approved engineering models across 193
  dynamically connected catalog records.
