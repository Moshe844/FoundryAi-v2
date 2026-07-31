# Phase C implementation report

Date: 2026-07-30
Scope: understanding, proposal, observations, alternatives, recommendations,
and clarification. Phase D was not implemented.

## Outcome

Phase C now presents one live, model-generated customer proposal before the
Decision Brief or build-start surface:

- project identity, summary, audiences, and journeys;
- Foundry observations;
- the complete proposed product and included professional defaults;
- meaningful design alternatives when the live model finds more than one good
  direction;
- judgement calls and deliberate exclusions;
- contextual recommendations that can be selected;
- material clarification questions with all four approved affordances; and
- an explicit, non-blocking confirmation.

The first valid profile is always shown for review, including when the model
needs no clarification. Continuing records
`customer-proposal-confirmation`, every selected recommendation, and the
Foundry-recommended answer for every unanswered decision through the normal
project-understanding record. Only a confirmed proposal projects to the Phase
D plan.

## Architecture and truthfulness

The customer-facing experience is split into small components under
`apps/web/app/components/`. All project claims come through the typed,
validated experience contracts and selectors in `apps/web/experience/`.

`ProjectProfile` now owns backward-compatible `observations` and
`designAlternatives` fields. Legacy profiles replay with empty arrays. A
profile may recommend at most one alternative.

The frontend does not invent previously resolved decisions because the current
customer API does not expose a complete resolved-decision list. The detailed
source mapping is in `docs/phase-c-implementation-map.md`.

## Dynamic provider catalogues and API negotiation

Production contains no Opus, Sonnet, Haiku, GPT-generation, or
Gemini-generation ranking table. Provider catalogues are fetched from the
configured live APIs, persisted append-only, and routed by the metadata those
APIs return plus model-specific runtime outcomes.

The original Phase C claim was incomplete: live catalogue presence had been
flattened into identical capability scores, the registry then alphabetized
model IDs, and Project Understanding reduced the routes to one entry per
provider before model-specific performance could be considered. That made an
alphabetically early entry such as `claude-fable-5` win incorrectly.

The corrected path now:

- uses OpenAI `created` and Anthropic `created_at` release metadata;
- uses Gemini `version`, input-token, output-token, generation-method, and
  thinking metadata;
- retains the complete eligible catalogue until after capability and
  model-history ranking;
- records routing success, timeout, and permanent rejection by provider and
  model ID rather than by provider alone;
- removes a permanently rejected catalogue entry from later requests; and
- bounds an individual Project Understanding call at 20 seconds so another
  live provider can take over instead of leaving the customer on a stalled
  screen.

Live Phase C testing found two current API behaviors and now handles them by
API response rather than model name:

- OpenAI: attempt strict Responses JSON Schema first. If that selected live
  model reports that `json_schema` is unsupported, retry the same catalogue
  model with Responses JSON mode and include the exact schema in the prompt.
  Project Understanding uses the documented low reasoning effort and low text
  verbosity controls so a current reasoning model can complete this
  latency-sensitive structured task without losing the schema contract.
- Gemini: attempt `generateContent` first. If the selected catalogue entry
  reports that it only supports the Interactions API, negotiate the current
  Interactions request shape. If the API then identifies the entry as a
  background-only agent, record that specific entry as unavailable for
  synchronous structured work and route around it on future attempts.

These behaviors follow the current official
[OpenAI latest-model guidance](https://developers.openai.com/api/docs/guides/latest-model),
[OpenAI GPT-5.6 migration guidance](https://developers.openai.com/api/docs/guides/upgrading-to-gpt-5p6-sol.md),
[Google Gemini Models API](https://ai.google.dev/api/models), and
[Google Gemini Interactions API](https://ai.google.dev/api/interactions-api-v1).
No provider key is exposed or persisted in customer data.

Provider catalogue refresh now runs sequentially in the background. The local
customer API becomes ready immediately while catalogue health is being
established; normal development startup uses Node's Windows system CA support.

## Live customer verification

Mission:
`mission-1785439040036-f54e55ca`

Intent:

> Create a simple web dashboard for a small nonprofit to schedule volunteers
> and track attendance.

The screenshot-reported route was reproduced before the correction. The live
catalogue initially exposed the flattening defect and two Gemini entries that
the provider listed as generation-capable but rejected at request time as
unavailable. Those entries were recorded as permanently unavailable.

After the corrected service restarted, the same customer mission completed in
one attempt with the API-discovered OpenAI `gpt-5.6-luna` route:

- dispatch: `2026-07-30T19:23:40.851Z`;
- success: `2026-07-30T19:23:57.158Z`;
- elapsed: 16.307 seconds;
- input: 1,497 tokens;
- output: 1,785 tokens; and
- result: validated `ProjectProfile`, rendered as
  **Nonprofit Volunteer Scheduling Dashboard**.

The completed profile contains eight customer journeys, three observations,
three recommendations, three explicit architecture decisions, four deliberate
scope exclusions, and one non-blocking customer decision. `claude-fable-5` was
not selected by the corrected run.

Browser checks proved:

- the initial profile remains on the Phase C proposal until confirmation;
- all live project copy is sourced from the recorded profile;
- recommendation switches update their accessible checked state;
- Continue remains enabled when no question is answered;
- the provider status shows all three live catalogues ready; and
- the browser console contains zero errors.

Responsive captures:

- `docs/screenshots/phase-c/phase-c-375.jpg`
- `docs/screenshots/phase-c/phase-c-768.jpg`
- `docs/screenshots/phase-c/phase-c-1024.jpg`
- `docs/screenshots/phase-c/phase-c-1280.jpg`
- `docs/screenshots/phase-c/phase-c-1440.jpg`

## Verification

| Check | Result |
| --- | --- |
| TypeScript | Pass |
| ESLint | Pass |
| Focused dynamic-routing/provider tests | 35 passed, 0 failed |
| Production web build and web suite | 24 passed, 0 failed |
| Complete repository suite | 217 passed, 0 failed, 0 cancelled, 0 skipped |
| Complete-suite duration | 711349.8075 ms (about 11m51s), natural completion |
| `git diff --check` | Pass |

The complete repository suite was not timed out. Its process exited normally
with code 0.
