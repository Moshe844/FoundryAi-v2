# Decision-Reduction UX — Phase 1 control audit

Status: audit complete. No product implementation was changed in this phase.

## Scope and method

This inventory covers the production React experience in `apps/web/app`, the option projection in `apps/web/experience`, the local API handoff, and the Project Design / Approved Project Contract sources in `src`. Static UX prototypes under `docs/ux` are not production controls and are excluded.

The requested classifications are used as follows:

- **A — infer:** Foundry can determine the value without asking the customer.
- **B — recommend:** Foundry should present a current recommendation and its rationale.
- **C — generated choices:** Foundry should present genuinely project-specific alternatives.
- **D — customer-only:** only the customer can supply the fact, correction, instruction, search term, or original request.

Utility controls such as project search are included for completeness but are not project decisions.

## Executive finding

The current experience is substantially past a generic intake form. Project understanding, recommendations, important decisions, and some design alternatives already originate in validated live model output. The short-request path and the ability to continue without answering questions already exist.

It is not yet the final Decision-Reduction UX for five reasons:

1. The open-conversation textarea is preceded by a fixed ten-item classification dropdown, so the customer still performs Foundry's classification work.
2. Intake chips and short-intent completions are fixed, keyword-routed project examples in production code.
3. Design alternatives are too shallow and too few for the required picker: zero or two-to-three model directions are allowed, and each alternative lacks its own layout, visual personality, density, mobile behavior, confidence, and full project-fit explanation.
4. Choices are not adaptive within the working session. Selecting a design direction only changes local UI state; it does not regenerate the later ideas, navigation, density, workflow, or verification choices.
5. Customer selections are serialized as natural-language follow-up strings and then reinterpreted by the model. They are not first-class, stable selection records written directly into the Approved Project Contract. A profile revision also remounts discovery and resets unsaved local selections.

## Native textbox, dropdown, and radio inventory

| # | Surface and control | Current value/option source | Class | Required disposition | Audit finding |
|---|---|---|---|---|---|
| 1 | Home — “Describe what you want built” textarea | Customer; placeholder and examples are static | D | **Retain as free text** | This is the legitimate customer-owned starting request. It correctly accepts a very short request. Keep it concise and primary. |
| 2 | Home — starter/completion chips beside the request | `STARTER_SUGGESTIONS` plus keyword-matched `LANGUAGE_COMPLETIONS` in `apps/web/experience/intake.ts` | A/C | **Remove or replace** | The five starter projects, fixed keyword table, and fixed completions are prohibited production project intelligence. Empty-state examples may be static instructional copy, but must not masquerade as inferred recommendations. Once context exists, suggestions must come from validated live output. |
| 3 | Projects — search input | Customer search term; filters mission-owned searchable text | D utility | **Retain as free text** | Not a project decision and not subject to inference. |
| 4 | Discovery open conversation — “What kind of change is this?” select | Fixed `inputOptions`: context, understanding, workflow, feature, design, business rule, role, integration, limitation, acceptance | A | **Remove** | This is the exact generic dropdown prohibited by the brief. Foundry must classify the natural message internally, optionally show the inferred classification, and allow correction only when useful. |
| 5 | Discovery open conversation — customer message textarea | Customer natural-language message, but submission is prefixed with the selected fixed category | D, with A classification | **Retain as free-text escape hatch; change the handoff** | Keep the textarea. Remove the required category and prefix. Add live, project/stage-specific suggestion chips before it; clicking a chip must submit real customer context. |
| 6 | Discovery design — “Describe the feeling you want” textarea | Customer text; shown only after “Describe your own style” or when no alternative exists | D | **Retain conditionally** | Correct escape-hatch behavior. It should remain hidden until selected. Persist it as a structured custom design choice, not only a sentence for model reinterpretation. |
| 7 | Discovery important decision — “In your own words” textarea, one per generated question | Customer text; shown only after “Something else…” | D | **Retain conditionally** | Correct escape hatch. The generated choices should remain the lead experience. |
| 8 | Discovery important decision — optional “keep in mind” textarea after “Skip for now” | Customer note | D, attached to B | **Merge/remove** | “Skip for now,” unanswered, and “Let Foundry choose” all delegate the decision. This is confusing duplication. Use one clear delegation behavior; attach an optional note only under that behavior if it proves useful. |
| 9 | Decision Brief — generated radio choices, one group per editable decision | Same live `openQuestions[].answerOptions` used during discovery | C | **Retain, upgrade presentation** | Project-specific source is correct. Use the same decision-card pattern and stable option identifiers as discovery instead of falling back to plain radios. Include the recommendation rationale/consequence that the deep schema already contains but the profile projection discards. |
| 10 | Decision Brief — “Something else” textarea, one per edited decision | Customer text; currently always visible whenever the editor is open | D | **Retain conditionally** | Make “Other” an explicit choice and reveal the textarea only after selection, matching discovery. |
| 11 | Decision Brief — “What should I understand differently?” assumption-correction textarea | Customer correction | D | **Retain as free text** | Only the customer can correct a wrong assumption. The correction should be recorded as a typed contract change rather than an unclassified follow-up string. |
| 12 | Decision Brief — “Anything else I should know?” note textarea | Customer note | D | **Retain as free-text escape hatch** | Legitimate open input. It should use the same internal classification and structured contract-binding path as discovery messages. |

There are no other production `<input>`, `<textarea>`, or `<select>` controls. Providers, execution, preview, completion, unsupported, and lifecycle surfaces contain action buttons/details only. The `docs/ux` prototypes are non-production artifacts.

## Generated question and choice-surface inventory

### 1. Intake suggestion chips

- **Source:** fixed starter list and fixed keyword-to-completion table.
- **Classification:** A/C.
- **Disposition:** remove from project intelligence or replace with validated dynamic suggestions after context is available.
- **Reason:** this is the only direct keyword-to-project-example branching found in the production customer experience.

### 2. Understanding/direction stage actions

The fixed actions “Adjust my understanding,” “Add context,” “Change something,” “Let Foundry revise it,” “Describe another style,” “Add my own idea,” and “Add another instruction” do not supply project options. They only focus the open composer and preselect one of the fixed classification kinds.

- **Classification:** A for classification, D for the eventual message.
- **Disposition:** retain at most as contextual entry points, but stop changing a customer-visible category selector. They should focus a natural composer whose classification is inferred. Where possible, replace generic invitations with generated, stage-specific suggestion chips.

### 3. Design-direction picker

- **Static behavior choices:** “Use Foundry's recommendation,” “Let Foundry decide,” “Choose another direction,” and “Describe your own style.”
- **Project content source:** `ProjectDesign.designDirection` and `ProjectDesign.designAlternatives`, produced by the live routed model and semantically validated.
- **Current cardinality:** alternatives are either empty or two-to-three total directions, exactly one recommended. The UI removes the recommended alternative from “Choose another direction,” leaving only one-to-two selectable alternatives.
- **Classification:** B/C, with D for custom style.
- **Disposition:** replace the shallow alternative model/UI with three-to-seven rich project-specific direction cards where visual direction matters; use domain-appropriate architecture/interaction direction cards for nonvisual projects such as APIs.
- **Missing per alternative:** why it fits this project, layout approach, visual personality, information density, navigation, responsive/mobile behavior, confidence, and a complete tradeoff. The current alternative schema supplies only name, description, tradeoff strings, and recommended flag.
- **Duplication:** “Let Foundry decide” currently serializes “use the recommended direction,” so it does not actually permit later reconsideration. Merge it with “Use Foundry's recommendation,” or implement and clearly record the promised deferred-decision semantics.
- **Adaptation gap:** selecting a direction updates only local choice state and the final four-field review. It does not revise subsequent recommendation or decision options.

### 4. Useful-idea recommendation cards

- **Source:** live `ProjectDesign.recommendations`, projected to `ProjectProfile.contextualSuggestions` with title, specific value, project rationale, impact, default selection, confidence, and dependencies.
- **Classification:** B/C.
- **Disposition:** retain and strengthen.
- **Already good:** model-derived project specificity; add/remove behavior; reason and impact; model-selected default.
- **Gaps:** confidence and dependencies are not displayed; the UI shows only the first five recommendations but final submission records include/remove answers for every recommendation, including invisible ones. No hidden default may be accepted or rejected without appearing in the review. “Add my own idea” should remain a conditional free-text escape hatch or open the natural composer.

### 5. Important-decision cards

- **Source:** live `ProjectDesign.decisions`; only decisions marked `canFoundryDecide === false` are projected into `ProjectProfile.openQuestions`. The first generated alternative is treated as the Foundry recommendation in the UI projection.
- **Classification:** B/C, with D for Other.
- **Disposition:** retain and strengthen.
- **Already good:** the deep schema supplies customer-friendly question, why it matters, recommendation, recommendation reason, alternatives, consequences, Foundry-decidability, architecture impact, and scope impact. The UI leads with generated choices, supports Other, and permits no answer.
- **Projection loss:** recommendation reason, consequence per choice, architecture impact, and scope impact are discarded before the UI. The explicit `recommendation` is also discarded; the selector assumes `answerOptions[0]` is the recommendation.
- **Duplication:** unanswered, “Let Foundry choose,” and “Skip for now” resolve to materially the same delegation behavior. Use one behavior and record whether the current recommendation was accepted or authority was delegated for later reconsideration.
- **Adaptation gap:** answering a card does not affect later cards in the same session. All answers are held locally and submitted together only at the end.

### 6. Decision Brief edit choices

- **Source:** previously generated decision choices and recorded answers.
- **Classification:** C/D.
- **Disposition:** retain, but use the same rich, stable choice model as discovery. Do not regress from cards to plain radios and a permanently visible textarea.

### 7. “Reconsider this” action

- **Source:** fixed instruction string: “Reconsider the plan and tell me if you'd do it differently.”
- **Classification:** A/B.
- **Disposition:** retain only if it performs a meaningful model re-evaluation and reports changes. It is not a customer-owned specification field and needs no textbox.

## Option-source trace

| Option family | Authoritative source today | Dynamic? | Validation today | Phase 1 conclusion |
|---|---|---:|---|---|
| Intake starter projects | Fixed TypeScript array | No | None | Remove from production project intelligence. |
| Intake short-text completions | Fixed keywords and completion arrays | No | None | Remove keyword routing; it violates the no-hardcoding rule. |
| Open-message categories | Fixed component array and fixed API set | No | Identifier parsing only | Infer internally; remove customer selector. |
| Design recommendation | Live model `ProjectDesign.designDirection` | Yes | Schema plus project grounding/rationale checks | Keep source; expand option schema and UI. |
| Design alternatives | Live model `ProjectDesign.designAlternatives` | Yes | Cardinality, unique names, tradeoff length, recommendation consistency | Keep source; require richer three-to-seven choices when relevant and semantic distinctness. |
| Feature/idea recommendations | Live model `ProjectDesign.recommendations` | Yes | Specificity, rationale length, grounding, duplicate-title checks | Keep source; expose all customer-affecting defaults and bind selections structurally. |
| Important questions and choices | Live model `ProjectDesign.decisions` | Yes | Customer-language/technical-term guard and recommendation-in-alternatives check | Keep source; preserve full decision metadata and add option distinctness/relevance validation. |
| Decision Brief edit choices | Replayed/projected generated questions | Yes | Same upstream validation | Keep, but use stable IDs and rich cards. |

## Current contract and state-binding audit

The repository already has a versioned, hashed `ApprovedProjectContract` containing the original request, follow-ups, interpreted intent, audiences, workflows, design direction, recommendations, decisions, assumptions, exclusions, constraints, stack, obligations, and verification plan. That foundation should be retained.

The UI does not yet bind every choice to it exactly:

1. Discovery decisions, recommendation toggles, and design choice are local React state until the customer leaves discovery.
2. They are converted to prose answers such as “Use this design direction: …” or “Include this project idea: …”.
3. The model receives those strings and regenerates the complete Project Design.
4. Contract creation freezes the regenerated design and its model-selected default flags / `canFoundryDecide` flags, not a typed ledger of the exact UI choice records.

Consequences:

- a later model can reinterpret a title-only design selection;
- accepted/rejected and customer/Foundry attribution depend on the regenerated model output;
- stable option identity is absent;
- a profile revision remounts `ProjectDiscovery` via its profile-version key and resets unsaved answer, recommendation, and design state;
- selecting a choice cannot drive immediate adaptive follow-ups because no choice event is persisted/re-evaluated at selection time.

Required later-phase correction: give every generated option a stable ID and complete metadata, append every selection/rejection/delegation/custom value as a typed versioned decision event, derive the Approved Project Contract from those events plus validated project intelligence, and make execution/repair/verification consume the exact approved contract version.

## Required control dispositions

### Infer or remove

- Remove the customer-visible message-category dropdown.
- Infer message classification, with optional correction.
- Remove fixed keyword-routed intake completions as project intelligence.
- Remove duplicated delegation controls that do not have different behavior.
- Stop using generic stage shortcuts to silently preclassify customer messages.

### Replace with generated choices

- Replace the shallow design alternative picker with rich, domain-appropriate generated direction cards.
- Preserve full decision recommendation/consequence metadata in customer-visible cards.
- Add dynamic, project-and-stage-specific suggestion chips before the open composer.
- Where a correction is likely, offer generated project-specific options before asking for prose.
- Make follow-up choices conditional on persisted prior selections.

### Retain as free text

- Initial request.
- Natural open conversation.
- Explicit “Other” for design and generated decisions.
- Customer correction of Foundry's understanding/assumptions.
- Customer note or truly customer-exclusive business facts.
- Project search (utility, not project intelligence).

### Retain as generated/recommended surfaces

- Project understanding and proposed outcomes.
- Model-generated recommendation cards.
- Model-generated important decisions.
- Foundry's recommended design direction.
- Continue-with-recommendations path, after it records every resolved item explicitly.

## Phase 1 acceptance status

Phase 1 is complete as an audit only. No Phase 2 schema, UI, conversation, contract, execution, or verification implementation has been started by this audit.

The implementation is legitimately “almost there” at the intelligence layer. The next work should concentrate on typed option/selection schemas, richer design alternatives, adaptive choice persistence, internal message classification, and exact contract binding rather than rebuilding the existing proposal experience.
