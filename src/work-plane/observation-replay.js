import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { replayObservationTrajectory } from "../domain/browser-observation-policy.js";

// Every build Foundry has ever run is on disk, and each one records how many
// checks and design aspects were still outstanding at each round. That is
// exactly what the observation policy decides on, so a policy change can be
// measured against the whole history before it is measured against the
// customer's next build — for the cost of reading files.
//
// This exists because the opposite was done all day: a ceiling was changed on
// a hunch, and two builds were lost proving it wrong at twelve minutes each.

const ROUND_STARTED = /browser-verification-runtime-\d+-attempt-(\d+)\.started/u;

function ledgerEvents(path) {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function terminalState(events) {
  const transitions = events.filter((event) => event.type === "MISSION_TRANSITION");
  return transitions.at(-1)?.transition?.to ?? null;
}

// A repair request carries the observation that provoked it, so the failure
// counts of each round can be read back out of what the model was told.
function outstandingFromRepairPrompt(purpose) {
  const checks = /real browser checks were false: ([^.\n]+)/u.exec(purpose);
  if (checks !== null) {
    return { checks: checks[1].split(",").length, fidelity: 0 };
  }
  const aspects =
    /design fidelity failed against the approved live prototype: ([^.\n]+)/u.exec(purpose);
  if (aspects !== null) {
    return { checks: 0, fidelity: aspects[1].split(",").length };
  }
  return null;
}

// One observation round can buy several repair proposals — a patch whose
// oldText no longer matches is rejected and re-bought without a new
// observation — so counting repair prompts counts the same round more than
// once. A build that observed four times read as five rounds of [5,5,5,1,1],
// which made the policy look like it stalled on a build that in fact
// succeeded. Rounds are therefore walked in ledger order: an observation opens
// a round, and only the first repair after it reports that round's failures.
export function recordedTrajectory(events) {
  const rounds = [];
  let awaitingFailuresForRound = false;
  for (const event of events) {
    const id = event.eventId ?? "";
    if (ROUND_STARTED.test(id)) {
      awaitingFailuresForRound = true;
      continue;
    }
    if (!awaitingFailuresForRound) continue;
    if (!/(?:browser-repair|design-fidelity-repair)-\d+\.model\.fact/u.test(id)) continue;
    const purpose = event.fact?.metadata?.modelCallRecord?.purpose ?? "";
    const outstanding = outstandingFromRepairPrompt(purpose);
    if (outstanding === null) continue;
    rounds.push(outstanding);
    awaitingFailuresForRound = false;
  }
  return rounds;
}

export function loadRecordedBuilds(ledgerDirectory) {
  const directory = resolve(ledgerDirectory);
  const builds = [];
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".jsonl"))) {
    let events;
    try {
      events = ledgerEvents(resolve(directory, name));
    } catch {
      continue;
    }
    if (events.length === 0) continue;
    const state = terminalState(events);
    if (state !== "SUCCEEDED" && state !== "EXHAUSTED" && state !== "FAILED") continue;
    const rounds = recordedTrajectory(events);
    if (rounds.length === 0) continue;
    const roundsObserved = (events.map((event) => ROUND_STARTED.exec(event.eventId ?? ""))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .at(-1)) ?? rounds.length;
    builds.push(
      Object.freeze({
        missionId: name.replace(/\.jsonl$/u, ""),
        recordedState: state,
        roundsObserved,
        rounds: Object.freeze(rounds),
      }),
    );
  }
  return Object.freeze(builds);
}

// What the current policy would do with each recorded build, and how that
// compares with what actually happened.
export function replayRecordedBuilds(builds, budgets) {
  const results = builds.map((build) => {
    const replayed = replayObservationTrajectory(build.rounds, budgets);
    const recordedFailed = build.recordedState !== "SUCCEEDED";
    const wouldFail = replayed.outcome === "failed";
    return Object.freeze({
      ...build,
      outcome: replayed.outcome,
      stoppedBy: replayed.stoppedBy ?? null,
      // A build the old policy lost and this one does not lose outright.
      recovered: recordedFailed && !wouldFail,
      // A build that used to pass and would now be stopped: never acceptable.
      regressed: !recordedFailed && wouldFail,
    });
  });
  const tally = { recovered: 0, regressed: 0, stillFailing: 0, unchanged: 0 };
  for (const result of results) {
    if (result.recovered) tally.recovered += 1;
    else if (result.regressed) tally.regressed += 1;
    else if (result.outcome === "failed") tally.stillFailing += 1;
    else tally.unchanged += 1;
  }
  return Object.freeze({ results: Object.freeze(results), tally: Object.freeze(tally) });
}
