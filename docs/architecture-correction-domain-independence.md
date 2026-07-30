# Domain-independence architecture correction

## Inventory-specific production references found

The correction audit found first-workload assumptions in:

- the Milestone 10 page, suggestions, stages, search, verification labels,
  and mock preview;
- a domain-named production preview route;
- the runtime browser-result schema;
- evidence validation and Verification Authority acceptance-condition checks;
- repair failure classification; and
- runtime structured-suite naming.

## What moved to fixtures

`test/fixtures/certification/project-workloads.js` owns the inventory
certification workload plus independent marketing-site and REST-API fixtures.
The successful inventory vertical slice remains a permanent Milestone 8
regression.

No production file, route, component, suggestion, contract rule, browser
check, repair branch, or runtime adapter is inventory-named.

## What was generalized

- Live Project Understanding produces a normalized `ProjectProfile`.
- The profile supplies actors, outcomes, capabilities, data concepts,
  constraints, architecture decisions, contextual suggestions, selected
  stack, open questions, and verification checks.
- Requirement Contract obligations are generated from that profile and
  persisted through the Mission Ledger.
- Browser evidence accepts the active plan's check IDs rather than a fixed
  workload schema.
- Verification evaluates ordinary contract bindings.
- Repair classification uses evidence kinds and generic execution/browser
  phases.
- The main UX renders the active profile and real runtime URL. There is no
  mock preview route or keyword interpreter.
- Generated source is returned by the selected live model route and applied
  only by the Execution Engine.

Replacing a certification fixture does not require modifying the Mission
Orchestrator, Execution Engine, Evidence Store, Verification Authority,
Workspace Service, Runtime Service, or customer UX.

## Structural tests

`test/domain-independence.test.js`:

- scans `src` and `apps/web/app` for inventory vocabulary, former fixed
  browser-check IDs, and domain-named routes;
- validates inventory, marketing-site, and REST-API ProjectProfiles;
- persists all three profile-generated contracts through the Mission Ledger;
- proves browser-result parsing accepts project-specific check IDs;
- preserves the permanent certification fixture;
- allows API-only verification to omit UI checks only when explicit; and
- proves bounded repair may add one safe generic source file while rejecting
  traversal, dependency paths, and nonexistent parent directories.

`apps/web/tests/rendered-html.test.mjs`:

- scans the production UX for certification vocabulary;
- verifies per-task provider/model route presentation;
- verifies the worker-process execution boundary;
- checks responsive and accessibility foundations; and
- asserts that mock preview and keyword-interpreter modules are absent.

The production-source scan is:

```powershell
rg -n -i '\b(stock|inventory|products|quantity)\b' src apps\web\app
```

Certification fixtures and regression tests are intentionally outside this
boundary. Exact validation results are in
`docs/milestone-10-validation.md`.
