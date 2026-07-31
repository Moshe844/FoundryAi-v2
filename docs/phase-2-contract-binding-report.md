# Phase 2 — Contract-Bound Intelligence and Execution

Date: 2026-07-31

Status: complete and ready for review. Phase 3 was not started.

## Outcome

Normal production execution is now bound to the immutable `ApprovedProjectContract`. A build cannot start from the legacy profile alone. The explicit deterministic certification-fixture mode remains available only for the permanent Milestone 8 and Milestone 9 certification workloads.

No provider model IDs or model-family ranking tables were added. Provider catalogues continue to come from live API discovery and the registry. Phase 2 derives required model depth from approved capabilities, integrations, verification methods, and workflow count, then lets the existing dynamic registry select the cheapest capable available discovered model.

## Contract routing

`src/domain/contract-bound-execution.js` now:

- creates stable requirement IDs for the original request, every customer follow-up, primary and secondary workflows, the approved design direction, accepted recommendations, approved decisions, and every acceptance obligation;
- separately records every explicit exclusion and rejected recommendation;
- validates the approved platform and certified stack identity;
- rejects approved capabilities the selected certified stack cannot execute;
- derives integration, verification, workload, and model-depth requirements from contract fields rather than customer-request keywords;
- creates versioned and content-addressed request namespaces so stale generations or repairs cannot be replayed after contract approval changes.

## Prompt construction

Every normal production generation or repair call now passes through one contract gateway in `src/work-plane/production-mission-service.js`. Each call receives:

- task objective;
- allowed scope;
- forbidden changes;
- approved contract version and content hash;
- original customer request and every follow-up message;
- final interpreted intent, audiences, workflows, approved design direction, decisions, recommendations, assumptions, exclusions, architecture constraints, platform, and stack capability;
- relevant requirement records;
- every verification obligation and the verification plan;
- current workspace checkpoint;
- contract-derived routing requirements;
- the exact expected output schema.

## Admission and rejection

The generation schema requires the model to return the exact contract hash/version/platform, approved design-direction hash, a claim for every approved requirement, the complete exclusion-ID set, and a non-empty requirement trace for every generated file.

Semantic validation rejects output that:

- omits an original request, customer follow-up, workflow, approved choice, recommendation, design direction, or acceptance obligation;
- reinterprets a requirement without retaining its material subject;
- adds an unknown major requirement;
- changes the approved platform or design direction;
- drops an explicit exclusion or rejected recommendation;
- traces a generated file to an unknown or excluded requirement;
- leaves any approved requirement without a generated-file trace.

Source and browser repairs use contract-extended schemas. Their requirement traces must be non-empty and must stay inside the exact approved requirement subset assigned to that repair. Trace metadata is persisted with the immutable model-call record; workspace mutation receives only the admitted path/content or replacement payload.

## Regression boundary

`src/control-plane/mission-control.js` supplies the approved-contract service to production execution. Ordinary missions fail closed without a frozen approved contract. The permanent deterministic certification fixtures retain an explicit private legacy compatibility switch; it is not enabled for customer execution.

`src/work-plane/model-gateway.js` accepts explicit depth and routing rationale for generation as well as repair. It still selects only from live/discovered registry entries and preserves semantic-output failover before a rejected response can be persisted as a successful model result.

## Verification evidence

All commands completed without a test timeout:

- Phase 2 adversarial suite: 5/5 passed.
- Broad core regression excluding the separately executed real certification missions: 198/198 passed.
- Milestone 8 real certification: 2/2 passed, including three clean install/build/preview/browser missions; 316.5 seconds.
- Milestone 9 real repair certification: 6/6 passed, including three compile/browser/persistence repair missions; 400.0 seconds.
- Milestone 8 and 9 were run concurrently: approximately 400 seconds wall time, not the sum of both durations.
- Web Phase A–G and proposal conversation regression: 57/57 passed.
- Web lint: passed.
- Web TypeScript check: passed.
- Web production build: passed.
- `git diff --check`: passed (line-ending notices only; no whitespace errors).

Distinct executed sign-off tests: 263 passed, 0 failed, 0 skipped, 0 timed out.

## Files introduced for Phase 2

- `src/domain/contract-bound-execution.js`
- `test/phase-2-contract-binding.test.js`
- `docs/phase-2-contract-binding-report.md`

Supporting integrations were made in:

- `src/control-plane/mission-control.js`
- `src/domain/errors.js`
- `src/index.js`
- `src/work-plane/model-gateway.js`
- `src/work-plane/production-mission-service.js`
