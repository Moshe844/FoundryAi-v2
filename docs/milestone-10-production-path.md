# Milestone 10 production path

This is the customer path used by the localhost product. Deterministic
providers and certification fixtures are not reachable from this path.

| Customer step | Production authority | Persisted event or evidence |
| --- | --- | --- |
| Enter a description and press Begin | `apps/web/app/page.tsx` to `POST /missions` | Initial `MISSION_TRANSITION` to `INTAKE` |
| Route project understanding | Project Understanding Service and Provider Registry | Model evidence with provider, model, rationale, and token usage |
| Validate the structured result | Model Gateway and ProjectProfile validator | Result fact containing the validated profile and verification bindings |
| Ask architecture-changing questions | Project Understanding Service | Transition to `CLARIFYING`; revised profiles append rather than overwrite |
| Bind what done means | Requirement Contract Service | `REQUIREMENT_CONTRACT_CREATED` and transition to `CONTRACTED` |
| Select the stack | Toolchain and Stack Registry | Evidence-backed environment, certification, and selection facts |
| Provision a protected workspace | Workspace Service | Immutable workspace facts and baseline checkpoint |
| Generate project-specific files | Model Gateway and Execution Engine | Route facts, model evidence, file work units, and checkpoints |
| Install, check, lint, and build | Execution Engine and selected Stack Manifest | Command, output, exit, work-unit, and checkpoint evidence |
| Start the actual application | Runtime and Preview Service | Process, HTTP readiness, health, and preview URL facts |
| Exercise requested workflows | Playwright through the Execution Engine | Browser interaction, error, and structured-suite evidence |
| Decide completion | Verification Authority | One completion verdict; only the Orchestrator may transition to `SUCCEEDED` |

Long execution runs in `apps/web/local-api/mission-worker.mjs`. The HTTP API
remains a separate reporting/control process and reconstructs customer status
from a hash-validated Ledger reporting projection. It does not keep a mutable
mission-state copy.

## Customer narration

The default interface groups actual Ledger facts into customer-facing
engineering moments. Raw commands, model routes, tokens, evidence, and
checkpoint identity remain under the collapsed **Engineering details**
control. The current-activity card shows the exact active or latest provider,
model, task class, and reasoning depth.

The provider panel separately reports eligible routing candidates and health.
It is not described as the currently selected model.

## Browser error classification

Generated Playwright observations must correlate non-contract browser errors
with exact observed URLs and HTTP statuses. A missing decorative resource may
be non-blocking only when it is outside `/api`, has a recognized static-asset
path, and the exact response or independent request proves the 404. Generic
404 text alone cannot suppress an API or workflow failure.
