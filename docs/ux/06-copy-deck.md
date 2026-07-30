# 6. Copy deck

Every customer-facing string. `{}` marks an interpolation. Strings are
implemented as a single exported map so review and translation are possible, and
so no component invents wording inline.

## Voice rules

- Foundry says **I**. The UI chrome says nothing about itself.
- Short declaratives. One idea per sentence.
- No exclamation marks. No emoji. No "Oops". No apologies. No "please".
- Never "Great choice", "I'd be happy to", "Let's get started", "You're all set".
- State the decision, then the reason. Never hedge with "you may want to".
- Sentence case everywhere, including buttons and labels.
- Technical nouns are banned in customer text: *persistence, authentication,
  session, runtime, topology, provider strategy, schema, ORM, framework,
  middleware, stateless, contract, obligation, ledger, mission, evidence,
  checkpoint, adapter, stack*. Their replacements are in the tables below.

## Vocabulary translation

| Internal | Customer-facing |
|---|---|
| mission | project |
| intent | what you asked for |
| ProjectProfile | what I understand |
| Requirement Contract | the plan |
| obligation | a promise / something I'll prove |
| verification | checking that it really works |
| evidence | proof |
| observable contract | what "done" means |
| selected stack | how it's put together |
| runtime | running on your machine |
| preview URL | the preview |
| repair | correcting an issue |
| provider / model | *(only in the two places named in §25)* |
| profileVersion N | "Updated with your answers" |
| SATISFIED | Proved |
| NOT_SATISFIED | Didn't hold |
| UNVERIFIABLE | Couldn't be checked |
| COMPLETE | Ready |
| INCOMPLETE | Not finished |

---

## 1. Home

```text
h1            What should I build for you?
lead          Describe the outcome in a sentence. I'll design it,
              choose how it's built, build it, run it, and prove it works.

placeholder   A booking site for my studio
primary       Start
trust line    I'll come back with a plan before anything is built.

chips label   Try
chips         A website for my business
              An appointment booking system
              A customer portal with logins
              An internal tool for my team
              An API for reservations

capability    I build for the web today — web apps, business websites,
              customer portals, internal tools, and web APIs. Ask me for a
              mobile, desktop, or native game build and I'll tell you honestly
              instead of substituting something else.

projects h2   Your projects
projects link Show all {n} →
empty         Nothing here yet. Your first project will appear here and stay
              resumable.
```

**Zero providers**

```text
heading       I can't start without a model provider.
body          Add an OpenAI, Anthropic, or Google key to the .env file in your
              project folder, then re-check. I won't substitute anything for
              real intelligence.
action        Re-check providers
busy          Checking…
start hover   Add a model provider first.
```

## 2. Project card

```text
phase pills   Reading your request · Waiting on you · Plan ready · Building ·
              Testing · Correcting an issue · Needs you · Delivered · Stopped ·
              Cancelled
time          Just now · {n}m ago · {n}h ago · Yesterday · {date}
actions       Open · Answer · Review the plan · Watch · Continue · Resolve ·
              Reopen
overflow      Rename · Duplicate · Delete
```

## 4. Dynamic suggestions

Lexicon: trigger word → appendable completions. Whole-word, case-insensitive.
No entry may lead to an unbuildable project family.

```text
booking / appointment   …for a hair studio
                        …for a dental practice
                        …with staff calendars
                        …that takes a deposit
shop / store / sell     …with a catalogue and prices
                        …that takes card payments
                        …that tracks what is left
website / site          …with a contact form
                        …with service pages
                        …with customer reviews
portal / login / account …where customers see their own records
                        …with password reset
                        …with staff and customer roles
records / catalogue    …with search and filters
                        …that tracks who changed what
                        …with a printable report
api                     …for another team to call
                        …with rate limiting
                        …with documentation
dashboard / report      …for my team
                        …with a weekly summary
                        …that exports to a spreadsheet
crm / customers         …with notes and history
                        …with a follow-up reminder

4+ words                That's enough to start. I'll ask if anything's
                        genuinely unclear.
```

## 5. Project understanding

```text
eyebrow       What I understand
h1            {profile.name}
lead          {profile.summary}
revision      Updated with your answers            (only when profileVersion > 1)

who h3        Who it's for
journeys h3   How they'll use it

included h2   Already in the plan — I didn't need to ask
included sub  These come with a project like yours. I've included them without
              asking.
```

## 7. Clarification

```text
h2 (1)        One decision changes what you get.
h2 (2+)       {n} decisions change what you get.
sub           Everything else I've decided myself. You can change any of it
              later.

decide label  Let me choose the best option
decide badge  Recommended
decide detail {answerOptions[0]}

other link    Something else…
other label   In your own words
other place   What should I do instead?

skip link     Skip for now
skip note     Anything you'd like Foundry to keep in mind?
skip confirm  I'll decide this one.

why summary   Why I'm asking
why body      {question.reason}

more options  More options
continue      Continue
continue busy Updating the plan…
progress      {answered} answered · {remaining} left to me
all decided   All {n} left to me — that's a perfectly good answer.

decisions h3  Your decisions
change        Change
```

**Submitted answer values** (not customer-visible, but normative):

```text
Foundry decides  Foundry decides. Recommended: {answerOptions[0]}.
                 Use your professional judgement.
Skip             Skipped by the customer. Use your professional judgement.
Skip + note      Skipped by the customer. Use your professional judgement.
                 Keep in mind: {note}
Other            {customer text, trimmed}
Choice           {option, verbatim}
```

## 9. Optional enhancements

```text
h2            Worth adding
sub           Ideas that fit this specific project. Pick any — I'll fold them
              into the plan and into what I test.
add           Add
added         Added
remove        Remove
count         {n} added
none          Nothing selected. That's fine — the plan stands on its own.
```

Group headings by family (§2.7), used only above four suggestions:

```text
marketing-website   Getting found · Getting in touch · Looking right
web-application     Who can do what · Working with records · Staying informed
api-service         Who can call it · Keeping it healthy · Making it usable
automation          When it runs · What it does · When it goes wrong
```

## 10. Decision brief

```text
eyebrow       Before I start
h1            The plan
sub           This is what I'll build and what I'll prove before I call it done.

labels        What I'll build
              Who it's for
              How people will use it
              How it's put together
              Your decisions
              Ideas you added
              What I'm assuming
              What I'll prove

structure     A web application with its own database, built the way it would
              really ship, running on your machine.
structure alt A website built the way it would really ship, running on your
              machine.                                 (no persistence)
tech summary  Technical shape
tech body     Next.js {version} · TypeScript · SQLite · npm · Playwright for
              browser testing. I chose this because it's the one setup I've
              certified end to end: I can generate it, build it, run it, test
              it, and watch it work.
tech limits   Worth knowing: the database suits a single copy of the
              application, and browser testing runs in Chromium-based browsers.

prove count   {n} things, including:
prove all     Show all {n}
assume change Change an assumption
assume label  What should I understand differently?

primary       Start building
primary busy  Starting…
secondary     Change something
note          Add a note
note label    Anything else I should know?
reconsider    Reconsider this
reconsider ok I'll look at this again.
```

## 11. Start-building transition

```text
heading       Starting work on {project name}.
body          You can leave this page. I'll keep going and everything is
              recorded.
slow (20s)    The build worker hasn't reported yet. This is recorded and safe
              to leave.
```

## 12. Active execution

```text
header phase  Building · {elapsed}
stop          Stop

phases        Understanding what you need
              Designing the experience
              Creating the application structure
              Building the main workflows
              Connecting data
              Preparing it to run
              Running the application
              Testing important actions
              Verifying the result

why lines     Working out the pages and how people move between them.
              Setting up the project so everything has a place.
              So {outcomes[0], lowercased}.
              So {dataConcepts[0]} is saved and still there after a refresh.
              Installing what it needs and building it the way it would really
              ship.
              Starting it for real and waiting until it actually answers.
              Doing the things a real person would do, in a real browser.
              Checking every promise I made in the plan.

fallback      Building your product.
proved count  {n} proved
resumed       Picking this back up where it stopped.
needs you     Needs you
queued        1 more waiting
```

## 13. Preview

```text
title         Preview
open          Open it ↗
reload        Reload
collapse      Collapse
restore       Show preview
widths        Desktop · Tablet · Phone

starting      Starting it up
live          Live · {host}
rebuilding    Rebuilding — this preview is from a moment ago
disconnected  Lost the connection
reconnect     Reconnect
crashed       It stopped running. I'm looking at why.
stopped       The preview isn't running any more.
failed        It didn't start. {plain cause}
unsupported   I can't show this kind of project in a preview yet. The real
              thing is in your project folder.
```

## 14. Engineering details

```text
summary       Engineering details
count         Engineering details · {n} records
intro         Everything below is reconstructed from records Foundry can't
              rewrite. It's here for proof, not for you to act on.
sections      Activity · Model routing · Counters · Verification · Workspace
no routes     No model route has been recorded yet.
cost missing  cost unavailable locally
```

## 15. Approvals

```text
labels        What · Why · Impact
recommended   Recommended

install h      I need to install a browser to test this
install what   Download and install Chromium for browser testing.
install why    Your plan promises the booking form works in a real browser.
               I can't prove that without one.
install impact About {size}, on this machine only. Nothing leaves your computer.
install yes    Install it
install no     Skip browser testing
install cons   Removes {n} promises from the plan
install later  Not now
install cons2  The build pauses here

delete h       Delete {project name}?
delete body    It's removed from your projects. The record of what happened
               stays on disk.
delete yes     Delete
delete no      Keep it

stop h         Stop this build?
stop body      Work so far is kept and the plan stays saved. You can reopen
               this and start again.
stop yes       Stop the build
stop no        Keep building
```

## 17. Repair

```text
detected      A workflow didn't behave as expected.
cause         I found the likely cause.
fixing        I'm correcting the affected part.
rechecking    I'm rerunning only the checks that matter.
retry         That correction didn't hold. I'm trying a different approach.
budget        I've tried {n} approaches to this. {m} remain before I stop and
              tell you what I know.
external      Something outside your project isn't responding: {service}.
              This isn't a problem with your build.
incomplete    I fixed the failure, but I couldn't re-prove {n} promises.
              I won't call those done.
exhausted     I stopped. I couldn't make this work, and I won't tell you it's
              done.
```

## 18. Blocked

```text
h             I need a decision before I can carry on
labels        What's blocking · What I'd do · What I need
primary       Do it your way
other         Something else…
stop          Stop this build
```

## 19. Follow-ups

```text
h2            What next?
placeholder   Make the buttons larger
disclosure    I'll start a new version and carry this project's plan and
              decisions into it. The files from this build stay where they are.
submit        Send it
versions h3   Versions
version row   {name} · {date} · {phase}
explain       Explain why you chose this
explain h     Why it's built this way
```

## 21. Completion

```text
headline      Your booking site is ready.               (family-specific)
              Your web app is ready.
              Your internal tool is ready.
              Your API is ready.
              Your site is ready.

labels        What you got
              What I proved
              What I couldn't check
              Decisions I made
              What I didn't do
              What I'd do next

proved        {n} of {m}
proved all    Show all {m}
mine          my call, because {reason}
yours         you chose this
next label    What I'd do next
```

## 27. Empty states

```text
home          Nothing here yet. Your first project will appear here and stay
              resumable.
projects      You haven't started anything yet.
search        Nothing matches "{q}".
search clear  Clear search
no decisions  That's enough to begin — nothing here materially changes what
              I'd build.
no decisions2 Review the plan
```

## 28. Loading

```text
reading h     Reading your request
reading model {provider} · {model} is working out what you need.
reading none  Choosing a model for this.
reading safe  This is already recorded. You can leave and come back.
slow          This is taking longer than usual. It's recorded and safe to
              leave.
```

## 29. Failure

```text
labels        What I was doing
              What happened
              What I did prove
              What I couldn't prove
              What I'd try next
              What I need from you

failed        I stopped, and I couldn't finish this.
exhausted     I ran out of safe approaches.
incomplete    It's close, but {n} of {m} promises didn't hold. I won't call it
              done.
understanding I couldn't work out what you need from that.
und retry     Try again
und reword    Reword it
providers     No model provider is answering right now.
prov action   Re-check providers
unreachable   I can't reach the Foundry service on this machine.
unreach body  Start it with: cd apps\web && npm.cmd run dev
timeout       Foundry didn't answer within 30 seconds. This project is
              recorded and safe to reopen.
integrity     {server message, verbatim}
integrity act Start a replacement
deleted       This project was deleted.
deleted act   Start something new
```

## 30. Cancelled

```text
h             You stopped this build.
labels        What I finished · What I proved · The plan is saved
proved        {n} of {m} promises held before I stopped.
saved         Every decision and assumption is still here.
primary       Start again from the plan
secondary     Change the plan first
delete        Delete
```

## 31. Unsupported

```text
h             I can't build this one — and I won't fake it.
body          You asked for {a native iPhone app}. Today I build for the web:
              web apps, business websites, customer portals, internal tools,
              and web APIs. I could build something that looks close and
              doesn't run on a phone, but I'd rather tell you.
alternative   A web version would work in a phone's browser, and people
              wouldn't need to install anything. If that's useful, I'll design
              that instead.
primary       Design a web version
secondary     Start something else
```

Per-platform substitutions for `{a native iPhone app}`:

```text
mobile        a native mobile app
desktop       a desktop application you install
game          a native game
other         something I don't have a certified way to build
```

## 25. Providers

```text
rail chip     {n} providers ready
rail chip 0   No providers
rail busy     Checking providers…
settings h    Model providers
settings body Foundry reads provider keys from the .env file in your project
              folder. They stay in the local server process — they're never
              sent to this page and never written into your project's history.
available     Available
unavailable   Unavailable
reason        {provider.reason}
disclaimer    These are the models Foundry could use, not models fixed to one
              project. I pick an eligible model for each step based on the work
              being done. Your provider's billing is the authority on cost.
refresh       Validate providers again
refresh busy  Validating…
```

## 26. Settings

```text
nav           Model providers · Appearance · Data · About
appearance    Text size · Motion
text size     Default · Large
motion        Follow system · Always reduce
about h       What Foundry can build today
about body    Foundry builds for the web: web applications, business
              websites, customer portals, internal tools, and web APIs.
              It doesn't build mobile apps, desktop applications, or native
              games, and it will tell you rather than substituting something
              else.
about limits  Worth knowing: the database suits a single copy of the
              application, browser testing runs in Chromium-based browsers, and
              projects run on this machine rather than being published.
```

## Accessibility strings

```text
sr composer   Describe what you want built. Press Enter to start, Shift plus
              Enter for a new line.
sr phase      Now: {phase}. {why}
sr proved     {n} of {m} promises proved.
sr needs      Needs your attention: {heading}
sr preview    Preview of {project name}, live
sr live dot   Live
sr building   Building, in progress
sr dock       Preview panel. Use arrow keys to resize.
sr collapse   Collapse the preview panel
sr expand     Expand the preview panel
sr decide     Let Foundry choose. Recommended: {option}.
sr skip       Skip this decision and let Foundry choose.
sr required   Nothing here is required. Anything you skip, I'll decide.
```
