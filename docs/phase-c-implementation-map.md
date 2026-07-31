# Phase C implementation map

Date: 2026-07-30

| Approved UX surface | Existing production source | Required selector / component | Missing backend capability |
| --- | --- | --- | --- |
| Project identity and summary | `ProjectProfile.name`, `summary`, `profileVersion` | `ProjectUnderstanding` selector and component | None |
| Intended users | `ProjectProfile.primaryActors` | Sourced `audiences` field | None |
| Customer journeys | `ProjectProfile.outcomes` (the UX contract's normative mapping) | Sourced `ProjectJourney[]` | None |
| Complete proposal | `ProjectProfile.outcomes`, `capabilities` | Sourced `FoundryProposal`; capability translation remains canonical | None |
| Expert observations | Not currently stored | Add backward-compatible `observations: string[]`, sourced observation view models, and an optional section | Existing profiles need an empty-array default before exact-key validation |
| Meaningful alternatives | Not currently stored | Add backward-compatible `designAlternatives[]`, validate at most one recommendation, and omit when fewer than two | Existing profiles need an empty-array default before exact-key validation |
| Judgement calls | `ProjectProfile.architectureDecisions` | Sourced proposal reasoning section | None |
| Deliberate exclusions | `ProjectProfile.constraints` | Add sourced proposal exclusions | None |
| Recommendations | `ProjectProfile.contextualSuggestions` | Sourced recommendations component; preserve `suggestionId` clarify payload | None |
| Clarification questions | `ProjectProfile.openQuestions` | Sourced `ClarificationDecision[]`; four mandatory affordances | None |
| Clarification submission | `POST /missions/:id/clarify` returning 202 | One full answer payload plus selected suggestions | None |
| Plain-language quality | Understanding prompt plus validated question/suggestion strings | Strengthen the domain-neutral prompt; add design-review-only term flags | None |
| Previously answered decision list | Answers exist in Ledger facts but are not exposed by the customer API as resolved decisions | Do not invent a frontend projection | Customer-facing resolved-decision payload belongs to Phase D assumption editing |
| Dynamic live-model routing | Provider Models APIs, capability manifests, and persisted model-call evidence | Rank API-returned release/capacity metadata before provider reduction; learn outcomes per model ID | None |

The Mission Ledger, Orchestrator, Requirement Contract Service, provider/model
registry boundaries, execution authority, and recovery boundaries remain
unchanged. Catalogue scoring and Project Understanding route ordering were
corrected inside those existing boundaries.
