# Foundry v2 Phase F implementation map

Date: 2026-07-30

Phase boundary: completion, failure, blocked, cancelled, and unsupported.
Phase G is explicitly out of scope.

| Approved UX surface | Existing production source | Required adapter / selector / view model | Missing backend capability |
|---|---|---|---|
| Completion headline and delivered artifact | Terminal `SUCCEEDED` transition, project profile, workspace and runtime projection | `CompletionSummary` must derive a delivery state from the terminal lifecycle and evidence projection | None for the delivered artifact already recorded on disk |
| Literal proved count | Requirement Contract plus the recorded Completion Verdict exposed through `executionProjection.verification` | Count only `SATISFIED`; keep `NOT_SATISFIED`, `UNVERIFIABLE`, and `PENDING` separate | None |
| What was delivered | `ProjectProfile.summary`, runtime readiness and workspace identity | Sourced completion field; no component-level reconstruction | None |
| What could not be checked | Completion Verdict obligation results and deficiencies | Sourced unverified outcomes with the real obligation statement | None |
| Decisions and attribution | Immutable clarification answers and each question's recommendation/reason | Parse recorded delegated answers as Foundry decisions; all other recorded answers remain customer decisions | None |
| What was intentionally left out | Profile constraints, missing launch content and certified-stack known limitations | Deduplicated sourced limitations with a truthful non-empty fallback | None |
| Suggested next steps | Unselected `contextualSuggestions` | Ordered sourced next-step projection | True in-place follow-up versions remain unsupported and must not be rendered as working |
| Failure | `FAILED` transition, repair projection, phase projection, Completion Verdict and Engineering details | Typed lifecycle outcome with all seven required sections; raw errors stay in Engineering details | No generic restart-from-checkpoint endpoint |
| Exhaustion | `EXHAUSTED` transition, repair finding and surviving verification results | Distinct honest-exhaustion outcome | No resume transition from terminal exhaustion |
| Blocked | `BLOCKED` transition and typed repair affected area | Distinct customer-action outcome naming the affected area and the safe next move | No typed in-place blocker-resolution contract after clarification |
| Cancelled | `CANCELLED` transition, phase and verification projections | Neutral cancellation outcome, completed phases, proved count and saved-plan statement | The customer stop path currently stops the runtime but does not record `CANCELLED`; Phase F must add the narrow cancellation transition |
| Unsupported | `ProjectProfile.platform` and understood name/summary | Sourced unsupported projection with specific platform wording and one truthful web alternative | The web redesign action can re-run understanding; native preview/build adapters do not exist and remain unavailable |

Implementation rules:

- Lifecycle components consume the canonical sourced experience model, not raw
  Ledger records or activity text.
- Completion never treats `UNVERIFIABLE` as proved.
- A recorded `SUCCEEDED` transition whose customer projection contains an
  unverified claim uses the incomplete handoff, not the success headline.
- Customer cancellation and production-failure cleanup are separate operations;
  only an explicit customer stop records `CANCELLED`.
- No follow-up, resume, approval, native build, or deployment control is rendered
  unless a real backend contract exists.
