# Phase 1 — Project intelligence and approval contract

Status: implemented and stopped at the approved Phase 1 boundary.

## Root causes confirmed before editing

1. Recommendations and decisions were shallow projections, so project-specific value, defaults, confidence, dependencies, consequences, and impact were discarded.
2. The legacy profile normalizer manufactured generic audiences, outcomes, journeys, design language, and accessibility text when understanding was absent.
3. Discovery was reduced to a flat `ProjectProfile`, while approval persisted only verification obligations; the customer request, follow-ups, design, recommendations, decisions, assumptions, exclusions, platform, and stack were not frozen together.
4. Understanding routes were optimized for fast response and validated JSON shape, without a semantic project-design quality contract.
5. Verification obligations pointed to numbered proposed features rather than stable customer/foundry requirement references, allowing discovery and verification to drift.

## Implemented

- Added a strict deep project-design domain model containing `ProjectIntent`, `UserExperiencePlan`, `ProductProposal`, `DesignDirection`, `FoundryInsights`, `Decision`, `Recommendation`, and source-traceable `VerificationPlan` structures.
- Replaced the active understanding response contract with the deep schema while retaining `ProjectProfile` only as an explicit compatibility projection for existing execution components.
- Removed generic `ProjectProfile` fallback generation. Missing project intelligence now fails validation.
- Added semantic validation for vague intent, generic or ungrounded recommendations, duplicate recommendations, missing rationale, technical customer questions, contradictory confidence, unsupported acceptance methods, and essential capabilities without verification coverage.
- Bound semantic validation to the existing multi-provider route loop. Weak schema-valid output records failure evidence and advances to another discovered provider/model.
- Raised project-understanding routing to architecture depth, capability priority, thorough latency preference, and explicit reasoning/architecture/structured-output capability thresholds. No provider model names are embedded in this path.
- Added immutable, content-addressed, versioned `ApprovedProjectContract` creation and replay in the Mission Ledger.
- The approved contract freezes the original request, follow-ups, interpreted intent, audiences, workflows, design, accepted/rejected recommendations, customer/foundry decisions, assumptions, exclusions, architecture constraints, platform, stack capabilities, acceptance obligations, verification plan, version, SHA-256 content hash, and approval timestamp.
- Existing “Build this” contract creation now validates and records the approved contract beside the executable `RequirementContract`, supported by the same immutable understanding evidence.
- The local API exposes the deep design and latest approved contract from replayed records.

## Verification

- Phase 1 project-intelligence tests: 5/5 passed.
- Consolidated non-long regression suite: 249/249 passed in 20.7 seconds.
- Full repository run completed in 914.1 seconds. Its real clean-build and repair-certification workloads passed. It surfaced two stale source assertions (legacy fallback expectations and the Phase G focus-restoration deletion signature); both assertions were corrected, and their containing suites pass in the 249-test rerun.
- Web lint: passed.
- Web TypeScript check: passed.
- Web production build: passed.
- `git diff --check`: passed (line-ending notices only).
- Static model-name audit of the new project-intelligence/contract path: no Claude, GPT, Gemini, or Opus model identifiers found.

## Explicitly not started

Phase 2 contract-bound routing, generation prompt binding, file/work-unit traceability, and generated-output validation have not been implemented in this phase.
