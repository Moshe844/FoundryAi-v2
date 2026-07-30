# 2. Principles, information architecture, and the end-to-end journey

## 2.1 The organizing idea

**Foundry is a studio, not a builder.**

A builder gives you controls. A studio gives you a professional who takes a
short brief, comes back with a plan, does the work, proves it, and stays
available. Every design decision in this redesign resolves toward that.

The experience is three acts:

| Act | Customer question | Foundry's job |
|---|---|---|
| **I — The Read** | "Does it understand me?" | Show understanding *before* asking anything |
| **II — The Build** | "Is my product working?" | One calm surface, meaningful progress, the real artifact |
| **III — The Delivery** | "What did I get, and what's next?" | Concrete handover, honest limits, continuity |

## 2.2 Voice

Foundry speaks in the **first person singular** in narrative moments —
understanding, recommending, repairing, delivering. UI chrome uses no pronoun.

- Understanding: "Here's what I think you need."
- Repair: "I found the likely cause. I'm correcting the affected part."
- Delivery: "I proved the booking form creates a real booking."
- Honest failure: "I stopped. I couldn't make this work, and I won't tell you it's done."

This is not chattiness. Foundry never asks how you're doing, never uses
exclamation marks, never emits a message that has no consequence. It writes the
way a senior consultant writes: short declaratives, stated reasoning, owned
decisions. Never "Great choice!" Never "I'd be happy to." Never an emoji.

Chrome is nominal, not conversational: "Your projects", "The plan",
"Engineering details", "Needs you".

## 2.3 Experience principles

**P1 — Understanding precedes interrogation.**
No question appears before Foundry has demonstrated what it already understood.
The first screen after intent is a read of the project, not a form.

**P2 — Every question is skippable, and skipping is a professional answer.**
The customer is never blocked by a decision they don't understand.
`Foundry decides` is always present and always recommended first.

**P3 — Business outcomes in, technical decisions absorbed.**
Nine words in ("a booking site for my studio") must be enough to reach a plan.
Technical vocabulary is a defect in customer-facing text, not a detail level.

**P4 — Progress means engineering outcomes, not activity.**
"Building the main workflows — so the booking form actually creates a booking"
is progress. "4 installs · 2 builds" is telemetry, and lives under a disclosure.

**P5 — One thing wants attention at a time.**
A single `Needs you` slot. One approval. One primary action per screen.
Everything else recedes.

**P6 — The artifact is the hero.**
When a real preview exists it takes the dominant position. Until it exists, its
space is not reserved with a placeholder — the layout is single-column and full.

**P7 — Honest boundaries beat graceful degradation.**
Foundry declines what it cannot build, in specific language, with a real
alternative. It never substitutes something adjacent and calls it done.

**P8 — Nothing restarts from zero.**
Decisions, assumptions, artifacts, and verification history stay attached to the
project and remain visible after the work that produced them collapses.

**P9 — Rigour is available, never imposed.**
Every internal fact the current UI shows — routing, tokens, cost, evidence ids,
commands, checkpoints — is preserved exactly, one disclosure away.

**P10 — The experience adapts to the project family.**
`profile.family` drives suggestions, preview treatment, verification phrasing,
and completion evidence. There is no single canonical project shape.

## 2.4 Information architecture

```text
Foundry
│
├─ Home                                   the only entry point
│   ├─ Intent composer  (primary)
│   ├─ Dynamic suggestions
│   └─ Your projects  (continue / open)
│
├─ Project  /project/:missionId           one continuous surface per project
│   │
│   ├─ Act I  The Read
│   │   ├─ Understanding          what I think you need
│   │   ├─ Decisions              only questions that change the result
│   │   ├─ Worth adding           project-specific ideas
│   │   └─ The plan               decision brief → Start building
│   │
│   ├─ Act II  The Build
│   │   ├─ Build canvas           phase spine + now + why
│   │   ├─ Needs you              approvals, blockers  (0 or 1)
│   │   ├─ Preview dock           appears on real readiness
│   │   └─ Engineering details    everything internal, collapsed
│   │
│   └─ Act III  The Delivery
│       ├─ Delivery card          built / proved / decided / limits / next
│       ├─ Timeline               prior work, collapsed, reopenable
│       └─ What next              follow-up composer            [Tier 2]
│
├─ Projects                               search + full history
│
└─ Settings                                                     [Tier 2]
    ├─ Model providers            moved out of primary nav
    ├─ Credentials                                              [Tier 2]
    └─ Preferences                                              [Tier 2]
```

### Navigation rules

- **Two primary destinations**: Home and Projects. Nothing else earns the rail.
- **Model providers leave the rail.** Provider health becomes a quiet status
  chip in the rail footer that opens Settings → Model providers. It is
  diagnostics, not navigation. The one exception: when zero providers are
  available, the chip becomes a blocking `Needs you` banner on Home, because
  Foundry genuinely cannot start.
- **A project is one URL and one scroll.** Discovery, building, and delivery are
  acts on the same surface, not separate pages. This is what makes continuity
  feel real: new work appends below, old work collapses in place.
- **The rail collapses to 64px on tablet and disappears behind a sheet on
  mobile.** Project context always survives the collapse.

## 2.5 State translation table

The customer never sees a lifecycle enum. This mapping is normative — implement
it as a single pure function, `customerPhase(mission)`, and use it everywhere.

| `MissionState` | Customer phase | Customer status line |
|---|---|---|
| `INTAKE` | Reading your request | "Working out what you need" |
| `CLARIFYING` | Waiting on you | "Waiting for your decisions" |
| `CONTRACTED` | Plan ready | "Ready to build" |
| `PROVISIONING` | Preparing the workspace | "Setting up a clean workspace" |
| `EXECUTING` | *derived, see below* | *derived* |
| `VERIFYING` | Testing important actions | "Checking that it really works" |
| `REPAIRING` | Correcting an issue | "Fixing something that didn't behave" |
| `SUCCEEDED` | Delivered | "Ready" |
| `FAILED` | Stopped | "I stopped and couldn't finish this" |
| `BLOCKED` | Needs you | "I need something from you" |
| `EXHAUSTED` | Stopped | "I ran out of safe approaches" |
| `CANCELLED` | Cancelled | "You stopped this" |

`EXECUTING` covers most of the build and must be subdivided from real ledger
activity, not invented. Derive the sub-phase from the most recent activity
`kind` and statement already produced by `apps/web/local-api/server.mjs:296-413`:

| Signal in ledger activity | Customer phase |
|---|---|
| First execution step recorded | Designing the experience |
| File-generation steps, no runtime yet | Creating the application structure |
| Generation steps referencing routes/pages/actions | Building the main workflows |
| Steps referencing persistence/records | Connecting data |
| Dependency install / production build | Preparing it to run |
| Runtime startup, before HTTP readiness | Running the application |
| Runtime readiness observed | Running the application ✓ |

If no signal maps, fall back to "Building your product" — never to the raw enum,
and never to a filename.

### Phase spine

The nine customer-facing phases, in fixed order, are the build screen's spine:

1. Understanding what you need
2. Designing the experience
3. Creating the application structure
4. Building the main workflows
5. Connecting data
6. Preparing it to run
7. Running the application
8. Testing important actions
9. Verifying the result

*Correcting an issue* is not a spine position. It appears inline, attached to the
phase it interrupts, and the spine does not regress — matching reality, where
`REPAIRING → EXECUTING` re-enters work already in progress
(`src/domain/lifecycle.js:70-75`).

Phases 5 and 8's presence depends on the project: "Connecting data" is shown
only when the profile's `capabilities` include a persistence capability
(`sqlite-persistence`, `create-records`, `update-records`, `refresh-persistence`).
Never show a phase that will not run.

## 2.6 End-to-end journey

Traced against the real API. `→` is a customer action, `⟳` is polling.

```text
HOME
 → types "a booking site for my studio"            (9 words is enough)
 → Start
   POST /missions { intent }                        → 201, mission INTAKE
   understanding job starts in background

READING  (INTAKE, profile === null)
 ⟳ GET /missions/:id every 1s
   Screen: "Reading your request" + which model is thinking
   Recoverable: customer may leave and return; mission is already recorded
   On failure: explicit retry → POST /missions/:id/understand

THE READ  (INTAKE, profile !== null)
   Screen order, top to bottom:
     1. Understanding      name, summary, who it's for, main journeys
     2. In the plan already   capabilities Foundry included without asking
     3. Decisions          0–4 questions, each with Foundry decides / choices /
                           Something else / Skip for now
     4. Worth adding       contextualSuggestions as valued recommendations
 → Continue
   POST /missions/:id/clarify { answers }           → 202, profileVersion + 1
   ⟳ until openQuestions is empty

THE PLAN  (INTAKE or CONTRACTED, openQuestions === [])
   Decision brief: what / who / journeys / how it's put together /
                   assumptions / selected ideas / what I'll prove
 → Start building
   POST /missions/:id/start                         → 202

THE BUILD  (PROVISIONING → EXECUTING → VERIFYING ⇄ REPAIRING)
 ⟳ GET /missions/:id every 1s
   Phase spine advances; "now" line states the phase and why it matters
   Preview dock materialises on first real previewUrl
   Repair appears inline, calm, cause-first
 → Stop  (optional)
   POST /missions/:id/stop                          → CANCELLED

THE DELIVERY  (SUCCEEDED)
   Delivery card: what you got / the working preview / what I proved /
                  decisions I made / what I didn't do / what I'd do next
 → What next  ("Make the buttons larger")           [Tier 2]

HONEST FAILURE  (FAILED, EXHAUSTED, BLOCKED)
   What I proved / what I couldn't / what I'd try next / what I need from you
```

## 2.7 Project-family adaptation

`profile.family` (`src/domain/project-profile.js:5`) selects a variant. The
layout, tokens, and interaction model never change; the content does.

| Family | Suggestion themes | Preview | Completion evidence emphasis |
|---|---|---|---|
| `marketing-website` | Call to action, contact form, testimonials, service pages, search visibility, mobile navigation | Page view, mobile width toggle | Pages render, form submits, no blocking errors |
| `web-application` | Sign-in, roles, saved records, search and filtering, empty states, notifications | App view, seeded state | Primary workflow completes, data persists across refresh |
| `api-service` | Sign-in for callers, rate limiting, documentation, pagination, validation, error conventions | Endpoint console: request → real response | Endpoints answer, status codes correct, validation rejects bad input |
| `automation` | Schedule, inputs, failure handling, notifications, run history, retries | Run view: trigger → result | Run completes, output written, failure path handled |
| `mobile-application` | — | — | Declined (§31) |
| `desktop-application` | — | — | Declined (§31) |
| `game` | — | — | Declined (§31) |
| `other` | Derived from the model's own suggestions | Generic web view | Contract obligations as written |

Suggestion *content* always comes from `profile.contextualSuggestions` — the
model's real output. The table sets the theme Foundry asks for and the grouping
the UI applies. Nothing in this table is hardcoded per project.

## 2.8 What "done" means to a customer

The Requirement Contract's obligations are the truth
(`src/domain/verification.js:13` — `SATISFIED` / `NOT_SATISFIED` /
`UNVERIFIABLE`; completion is `COMPLETE` / `INCOMPLETE`). Customer-facing
translation:

| Internal | Customer wording |
|---|---|
| `SATISFIED` | "Proved" |
| `NOT_SATISFIED` | "Didn't hold" |
| `UNVERIFIABLE` | "Couldn't be checked" |
| `COMPLETE` | "Ready" |
| `INCOMPLETE` | "Not finished — here's exactly what's missing" |
| obligation | "what I'll prove" (before) / "what I proved" (after) |
| `verificationPlan.checks[].label` | shown verbatim; it is already written for people |

`UNVERIFIABLE` is never quietly folded into success. It gets its own line in the
delivery card under "What I couldn't check," because that distinction is the
product's integrity.
