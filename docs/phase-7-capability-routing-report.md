# Phase 7 capability-driven routing

Implementation date: 2026-08-01

## Outcome

Normal live model routing now begins with a versioned task-capability contract. A provider model must be engineering eligible, `ACTIVE_STABLE`, fresh, healthy, within budget, explicitly approved for the task class, and backed by validated support evidence for every required capability. A numeric score cannot substitute for missing capability evidence.

## Task contracts

Foundry defines explicit requirements for project understanding, file generation, structured transformation, work decomposition, repair diagnosis, and repair implementation. A call may add requirements such as vision or a stronger structured-output threshold. Added requirements merge by taking the stronger threshold and cannot weaken the task contract or depth requirement.

## Candidate order

Only completely capable candidates enter ordering. Persisted success and failure outcomes for the exact task class are applied before the configured cost/latency tie-breaks. With no observations, every candidate receives the same neutral prior, so the cheapest sufficiently capable model wins. Provider health, lifecycle, freshness, budget, and task depth remain fail-closed eligibility gates.

## Production boundary

The live Model Gateway consumes the Model Router's exact provider/model candidates and records the required capabilities and considered candidates with route evidence. Capability aliases are descriptive output only and cannot make a model eligible. Deterministic certification fixtures remain isolated behind the explicit `fixtureOnly` boundary.

## Evidence

- `test/phase-7-capability-routing.test.js` proves all task classes have contracts, explicit requirements merge safely, numeric scores cannot bypass evidence, neutral-history routing chooses the cheapest capable model, persisted reliability changes ordering, aliases cannot qualify a model, and live execution consumes router candidates.
- Existing model governance and Milestone 9A routing tests remain mandatory.
- Production gateway regressions include real build, preview, browser verification, and certification workloads.
