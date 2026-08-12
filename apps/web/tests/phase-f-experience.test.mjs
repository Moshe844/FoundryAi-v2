import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createProductionMissionService } from "../../../src/work-plane/production-mission-service.js";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("an explicit customer stop records CANCELLED without requiring a runtime", async () => {
  let state = "PROVISIONING";
  const transitions = [];
  const service = createProductionMissionService({
    ledger: {
      projectState() {
        return {
          state,
          lastEventId: "last-event",
        };
      },
    },
    orchestrator: {
      transition(input) {
        transitions.push(input);
        state = input.to;
      },
    },
    runtime: {
      listSessions() {
        return [];
      },
    },
  });

  const result = await service.cancel("mission-phase-f");
  assert.equal(result.state, "CANCELLED");
  assert.deepEqual(transitions, [
    {
      missionId: "mission-phase-f",
      eventId: "mission-phase-f-cancelled",
      causationId: "last-event",
      to: "CANCELLED",
      reason:
        "The customer stopped this build. The recorded plan and workspace were preserved.",
    },
  ]);

  await service.cancel("mission-phase-f");
  assert.equal(transitions.length, 1, "terminal cancellation is idempotent");
});

test("customer cancellation and internal worker cleanup remain separate", async () => {
  const [worker, server, production] = await Promise.all([
    source("../local-api/mission-worker.mjs"),
    source("../local-api/server.mjs"),
    source("../../../src/work-plane/production-mission-service.js"),
  ]);

  assert.match(worker, /message\?\.type === "stop"\) void cancel\(\)/);
  assert.match(worker, /message\?\.type === "shutdown"\) void cleanup\(\)/);
  assert.match(worker, /control\.production\.cancel\(missionId\)/);
  assert.match(worker, /control\.production\.stop\(missionId\)/);
  assert.match(server, /stopMissionWork\(missionRoute\.missionId, \{ cancel: true \}\)/);
  assert.match(server, /type: cancel \? "stop" : "shutdown"/);
  assert.match(production, /async cancel\(missionId\)/);
  assert.match(production, /to: MissionState\.CANCELLED/);
});

test("Phase F lifecycle surfaces are modular and consume the sourced model", async () => {
  const [page, completion, outcome, unsupported, selectors, contracts] =
    await Promise.all([
      source("../app/page.tsx"),
      source("../app/components/completion-handoff.tsx"),
      source("../app/components/lifecycle-outcome.tsx"),
      source("../app/components/unsupported-request.tsx"),
      source("../experience/selectors.ts"),
      source("../experience/contracts.ts"),
    ]);

  assert.match(page, /<CompletionHandoff experience=\{experience\}/);
  assert.match(page, /<LifecycleOutcome/);
  assert.match(page, /<UnsupportedRequest/);
  assert.match(contracts, /export type LifecycleOutcome/);
  assert.match(contracts, /export type UnsupportedSummary/);
  assert.match(selectors, /function completion\(mission: Mission\)/);
  assert.match(selectors, /function lifecycleOutcome\(/);
  assert.match(selectors, /function unsupported\(mission: Mission\)/);
  assert.match(selectors, /const recordedTerminalError = mission\.error/);
  assert.match(selectors, /\.slice\(0, 500\)/);
  assert.match(selectors, /generated bundle still failed deterministic admission/);
  assert.match(selectors, /exact technical reason is preserved in Engineering details/);

  assert.doesNotMatch(completion, /mission\.executionProjection|mission\.profile|mission\.error/);
  assert.doesNotMatch(outcome, /mission\.executionProjection|mission\.profile|mission\.error/);
  assert.doesNotMatch(unsupported, /mission\./);
});

test("completion is literal, evidence-backed, and attributes decisions", async () => {
  const [completion, selectors] = await Promise.all([
    source("../app/components/completion-handoff.tsx"),
    source("../experience/selectors.ts"),
  ]);

  assert.match(selectors, /outcome\.result === "SATISFIED"/);
  assert.match(selectors, /unverified = verification\.filter/);
  assert.match(selectors, /unverified\.length === 0/);
  assert.match(selectors, /delegatedDecisionAnswer/);
  assert.match(selectors, /foundryMade \? "foundry-assumption" : "customer-answer"/);
  for (const label of [
    "What you got",
    "Launch readiness",
    "What I proved",
    "What I couldn’t check",
    "Why I built it this way",
    "What I left out on purpose",
    "If this became Version 2",
  ]) {
    assert.match(completion, new RegExp(label));
  }
  assert.match(completion, /completion\.verifiedOutcomes/);
  assert.match(completion, /completion\.unverifiedOutcomes/);
  assert.match(completion, /completion\.launchRequirements/);
  assert.match(completion, /controlled preview environment/);
  assert.match(completion, /completion\.limitations/);
  assert.match(
    selectors,
    /profile\?\.customerContent\.missingBeforeLaunch/,
  );
  assert.match(completion, /completion\.nextSteps/);
  assert.doesNotMatch(completion, /14 of 14/);
});

test("every non-cancelled terminal outcome renders all required sections", async () => {
  const outcome = await source("../app/components/lifecycle-outcome.tsx");
  for (const label of [
    "What I was doing",
    "What happened",
    "What I did prove",
    "What I couldn’t prove",
    "What I’d try next",
    "What I need from you",
    "EngineeringDetails",
  ]) {
    assert.match(outcome, new RegExp(label));
  }
  assert.match(outcome, /lifecycle-cancelled/);
  assert.match(outcome, /What I finished/);
  assert.match(outcome, /The plan is saved/);
  assert.doesNotMatch(
    outcome,
    /oops|something went wrong|sorry|apologi|unexpected error|please try again/iu,
  );
});

test("unsupported requests preserve the understood platform and offer one real alternative", async () => {
  const [unsupported, selectors] = await Promise.all([
    source("../app/components/unsupported-request.tsx"),
    source("../experience/selectors.ts"),
  ]);
  assert.match(unsupported, /unsupported\.requestedDescription\.value/);
  assert.match(unsupported, /unsupported\.supportedOutcome\.value/);
  assert.match(unsupported, /unsupported\.alternative\.value/);
  assert.match(unsupported, /Design a web version/);
  assert.match(unsupported, /Start something else/);
  assert.match(selectors, /mission\.profile\.platform/);
  assert.doesNotMatch(unsupported, /coming soon/i);
});

test("Phase F production surfaces contain no prototype fixture intelligence", async () => {
  const production = (
    await Promise.all([
      source("../app/components/completion-handoff.tsx"),
      source("../app/components/lifecycle-outcome.tsx"),
      source("../app/components/unsupported-request.tsx"),
      source("../experience/selectors.ts"),
    ])
  ).join("\n");
  for (const fixtureOnly of [
    "Ridgeway Plumbing",
    "Studio Booking",
    "Team Directory",
    "burst pipe",
    "emergency callout",
    "written estimate",
    "postcode checker",
    "0800 555 0134",
    "localhost:4310",
  ]) {
    assert.doesNotMatch(production, new RegExp(fixtureOnly, "iu"));
  }
});

test("Phase A through F remain mandatory web regression gates", async () => {
  const packageJson = JSON.parse(await source("../package.json"));
  for (const suite of [
    "rendered-html.test.mjs",
    "phase-a-foundation.test.mjs",
    "phase-b-experience.test.mjs",
    "phase-c-experience.test.mjs",
    "phase-d-experience.test.mjs",
    "phase-e-experience.test.mjs",
    "phase-f-experience.test.mjs",
  ]) {
    assert.match(packageJson.scripts.test, new RegExp(suite));
  }
});
