# Foundry v2 - through Milestone 10

Foundry is a local, evidence-backed software engineering system. The
localhost experience connects a customer description to the existing
production authorities: Mission Ledger, Requirement Contract, Stack Registry,
Workspace Service, Model Gateway, Execution Engine, Runtime Service,
Observation and Evidence Store, Verification Authority, and the Orchestrator
completion gate.

Milestone 10 does not publish Foundry and does not introduce a separate
customer-state store. Mission status, model activity, contracts, previews,
and completion are reconstructed from persisted records.

## Local product

Requirements:

- Node.js 22 or newer
- npm
- Git
- Chrome for Playwright verification
- at least one live provider credential in the repository-root `.env`

Credential names:

```text
OPENAI_API_KEY
ANTHROPIC_API_KEY
GOOGLE_API_KEY
```

`GEMINI_API_KEY` is accepted as a local alias for `GOOGLE_API_KEY`.
`.env.example` is a blank template and is never loaded as a credential
source. Secrets remain in the local server/worker process and are never
returned to the browser or persisted in the Ledger or Evidence Store.

Start Foundry:

```powershell
cd apps\web
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000/`. The local API listens on
`http://127.0.0.1:3927`.

Long-running missions execute in a separate `mission-worker.mjs` process so
model calls, installs, builds, runtimes, and Playwright cannot block the
reporting API. The catalogue endpoint uses a hash-validated, read-only Ledger
projection. Authoritative writes still perform complete evidence and
checkpoint validation.

Project understanding also runs as a recoverable background job. Creating a
mission returns immediately, the browser polls its persisted Ledger state, and
the current provider/model is shown while bounded provider failover continues.
An operational failure produces an explicit retry instead of leaving the
creation button indefinitely busy.

## What the interface shows

- arbitrary project descriptions and model-generated architecture questions;
- the model-produced ProjectProfile, assumptions, stack rationale, and
  observable contract before execution;
- customer-readable activity derived from real Ledger events;
- the active or latest provider, exact model, task class, and reasoning depth;
- complete per-task routing history, rationale, token usage, and known cost
  under collapsed engineering details;
- the real generated application only after an HTTP readiness observation;
  and
- final success only after the evidence-backed completion gate.

The provider panel is explicitly an eligibility/discovery view. It is not
presented as the route currently handling a task.

Model selection is task-tiered and provider-neutral:

- mechanical transformations prefer a discovered `FAST` model;
- project understanding, file generation, and routine repair prefer a
  discovered `BALANCED` model; and
- deep decomposition, architecture work, exceptional reasoning, and escalated
  depth-4/5 repair prefer a discovered `THOROUGH` model.

Each live provider contributes at most one current eligible model per tier.
Health, capability thresholds, known cost, and observed performance are
evaluated before a deterministic tie-break. Bounded failover prefers another
healthy provider before retrying another model from the same provider.
Provider/model names are discovered at runtime; production project-domain code
does not select a named vendor or model.

## Domain independence

The first inventory workload remains a certification fixture and permanent
regression. Production source contains no inventory-specific entities,
branches, routes, generator, verification rules, or UX.

Project behavior enters through:

- live interpreted requirements;
- a validated ProjectProfile;
- the selected certified stack and runtime adapter;
- the generated Requirement Contract;
- model-generated source; and
- a project-specific verification plan.

Structural tests scan `src` and `apps/web/app` for forbidden certification
vocabulary. Separate marketing-site and REST-API fixtures prove that profile
validation, contract generation, UX wording, architecture decisions, and
verification bindings do not require core changes.

## Repairs and truthful failure

Build and browser repairs are bounded, model-routed, evidence-grounded, and
applied only through the Execution Engine. A repair may replace an existing
generated source/configuration file or add one validated file inside an
existing generated directory. It cannot target dependencies, build output,
data, secrets, the lockfile, or a path outside the workspace.

Foundry records and exposes real failures. It does not weaken checks, modify a
generated project from test code, use a canned domain generator, or call an
incomplete mission successful.

## Validation

```powershell
npm.cmd test
cd apps\web
npm.cmd run lint
npm.cmd test
```

The exact commands, results, live mission outcomes, performance measurements,
and three-browser visual matrix are in
`docs/milestone-10-validation.md`.

## Storage

```text
<ledgerDirectory>/<mission-id>.jsonl
<evidenceDirectory>/records/<evidence-id>.json
<workspaceDirectory>/live/<workspace-id>/root/
<workspaceDirectory>/checkpoints/<checkpoint-id>.json
<workspaceDirectory>/blobs/<sha256>
<registryDirectory>/registry-events.jsonl
<registryDirectory>/ai/ai-registry-events.jsonl
```

There is no mutable mission, contract, evidence, provider, or model snapshot
that can supersede replayed authority.

## Architecture references

- `docs/milestone-10-production-path.md`
- `docs/architecture-correction-domain-independence.md`
- `docs/milestone-10-validation.md`
