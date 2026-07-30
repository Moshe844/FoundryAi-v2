# Foundry v2 Phase A implementation map

This map records the production source for each approved customer surface before
broader UX work. A blank capability is represented as unavailable in the
experience model; it is never reconstructed from copy or fixture data.

| Approved UX surface | Existing production source | Phase A adapter / selector | Missing backend capability |
|---|---|---|---|
| Application shell and primary navigation | Client view state in `apps/web/app/page.tsx` | `ApplicationShell` and `NavigationRail` | URL-backed routing and persisted desktop rail collapse |
| Home and project list | `GET /missions`, `missionSummary()` | `validateMissionList`, `ProjectSummary` | None for saved projects; dynamic composer assistance remains Phase B |
| Provider status | `GET /providers`, Provider Registry, Model Registry | `validateProviderList`, `ProviderTransparency` | Browser-safe credential management is intentionally absent |
| Project understanding | latest validated `ProjectProfile` reconstructed from Ledger facts | `ProjectUnderstanding` | Dedicated journeys, proposal items, observations, alternatives, recommendation impact, and confidence are not present in `ProjectProfile` |
| Clarification | `ProjectProfile.openQuestions`; answers are submitted to `/clarify` | `ClarificationDecision` | The customer API does not expose persisted answer provenance or an explicit recommended-option field |
| Decision Brief | `ProjectProfile`, Requirement Contract | `DecisionBrief` | Selected recommendation persistence and customer-answer provenance are not exposed |
| Mission lifecycle | latest `MISSION_TRANSITION` | `customerPhase`, `MissionNarrative` | None for top-level lifecycle translation |
| Execution phase spine | activity summaries derived by the local API | `MissionPhase` marks detailed execution phases unavailable | Typed, domain-neutral execution phase metadata is missing; Phase A deliberately removed text-fragment inference |
| Repair narrative | `REPAIRING`, mission error, repair/evidence records behind the API | `RepairNarrative` with nullable evidence-backed fields | Typed affected area, correction, rerun-check bindings, and customer-action contract are not exposed |
| Preview | runtime record plus readiness-tested `previewUrl` | `PreviewState` | Preview preference persistence and non-web adapters are absent |
| Approval | none | `ApprovalRequest.available = false` | Approval request, decision, and resume endpoint/state transition |
| Blocker | `BLOCKED` lifecycle plus mission error | `Blocker` | Typed customer action is not exposed |
| Completion | Completion Verdict exists in the truth plane but is omitted from `missionView()` | `CompletionSummary.available = false` | Customer API must expose the validated Completion Verdict and evidence references |
| Failure / stopped | terminal lifecycle and mission error | canonical `surface` selection | Structured failure cause and safe next action are not exposed |
| Search | `GET /missions?q=` over persisted project/Ledger facts | validated mission summaries | None |
| Model catalog | Provider Registry discovery adapters | full eligible provider-returned catalog; Anthropic and Gemini pagination | OpenAI’s Models endpoint supplies identity/ownership/availability but not capability metadata, so endpoint compatibility remains conservatively filtered and runtime failures remain authoritative |

## Provider model discovery authority

- OpenAI: `GET /v1/models` is the live availability source. The official schema
  describes the response as basic model identity, owner, and availability
  metadata; it does not publish per-model structured-output capabilities.
- Anthropic: `GET /v1/models` supplies cursor pagination and model capability
  metadata, including structured outputs, thinking, image input, and context.
- Google Gemini: `GET /v1beta/models` supplies pagination, supported generation
  methods, token limits, and thinking metadata.

Phase A removed version/family ranking words and the three-representative
catalog reduction. Provider-returned IDs are not copied into production source.
