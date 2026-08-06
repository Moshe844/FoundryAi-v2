// The decision the browser observation loop makes after each round: continue
// correcting, deliver a proven application whose design fell short, or stop.
//
// It lives here, apart from the loop, because every wrong version of it cost a
// real build. A ceiling of four stopped a correction at one outstanding check
// while it was still converging. A budget counted proposals that never touched
// a file. A stall detector read a stale fidelity count and halted a build that
// was going 5, then 5, then 1. None of those were visible in a unit test of the
// surrounding function, and all of them are visible here, because this is a
// pure function of numbers that recorded builds already contain.
//
// Keeping it pure is the point: the replay harness runs recorded trajectories
// through this exact function rather than a copy of its reasoning, so a policy
// change is measured against every build Foundry has ever run before it is
// measured against the customer's next one.

export const ObservationAction = Object.freeze({
  CONTINUE: "continue",
  DELIVER_WITH_SHORTFALL: "deliver-with-shortfall",
  HALT_STALLED: "halt-stalled",
  HALT_REPAIR_BUDGET: "halt-repair-budget",
  HALT_ATTEMPTS: "halt-attempts",
});

// Two consecutive rounds that reduce nothing means the corrections have run out
// of ideas. Each further round costs about ninety seconds and a paid model
// call, so this — not the attempt ceiling — is what protects the clock.
export const STALLED_ROUNDS_BEFORE_STOPPING = 2;

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function browserObservationDecision({
  attempt,
  maxAttempts,
  outstandingChecks,
  outstandingFidelityAspects = 0,
  previousOutstanding,
  stalledRounds = 0,
  behaviourProven = false,
  appliedRepairs = 0,
  maxRepairCalls = Number.MAX_SAFE_INTEGER,
}) {
  const outstanding = count(outstandingChecks) + count(outstandingFidelityAspects);
  // A round that did not reduce the outstanding failures is a stalled round.
  // Fidelity aspects only become measurable once every check passes, so the
  // first fidelity round usually raises the count; that is a real increase and
  // is treated as one, but a single stalled round never stops anything.
  const nextStalledRounds =
    previousOutstanding !== undefined && outstanding >= previousOutstanding
      ? count(stalledRounds) + 1
      : 0;

  const stopped = (action) =>
    Object.freeze({
      action: behaviourProven ? ObservationAction.DELIVER_WITH_SHORTFALL : action,
      outstanding,
      stalledRounds: nextStalledRounds,
      // Behaviour is what was promised; a design shortfall is reported, never
      // fatal. Every other reason to stop remains fatal.
      deliverable: behaviourProven,
    });

  if (nextStalledRounds >= STALLED_ROUNDS_BEFORE_STOPPING) {
    return stopped(ObservationAction.HALT_STALLED);
  }
  if (count(appliedRepairs) >= maxRepairCalls) {
    return stopped(ObservationAction.HALT_REPAIR_BUDGET);
  }
  if (attempt + 1 >= maxAttempts) {
    return stopped(ObservationAction.HALT_ATTEMPTS);
  }
  return Object.freeze({
    action: ObservationAction.CONTINUE,
    outstanding,
    stalledRounds: nextStalledRounds,
    deliverable: behaviourProven,
  });
}

// Replay a whole recorded trajectory. Each round is { checks, fidelity } — the
// numbers a ledger already holds — and the result says what the loop would do
// today with that same build.
export function replayObservationTrajectory(rounds, budgets) {
  const { maxAttempts, maxRepairCalls = Number.MAX_SAFE_INTEGER } = budgets;
  let previousOutstanding;
  let stalledRounds = 0;
  const timeline = [];
  for (let attempt = 0; attempt < rounds.length; attempt += 1) {
    const round = rounds[attempt];
    const behaviourProven = count(round.checks) === 0;
    if (behaviourProven && count(round.fidelity) === 0) {
      timeline.push({ attempt, action: "verified", outstanding: 0 });
      return Object.freeze({ outcome: "verified", timeline: Object.freeze(timeline) });
    }
    const decision = browserObservationDecision({
      attempt,
      maxAttempts,
      outstandingChecks: round.checks,
      outstandingFidelityAspects: round.fidelity,
      previousOutstanding,
      stalledRounds,
      behaviourProven,
      appliedRepairs: attempt,
      maxRepairCalls,
    });
    timeline.push({ attempt, action: decision.action, outstanding: decision.outstanding });
    if (decision.action !== ObservationAction.CONTINUE) {
      return Object.freeze({
        outcome:
          decision.action === ObservationAction.DELIVER_WITH_SHORTFALL
            ? "delivered-with-shortfall"
            : "failed",
        stoppedBy: decision.action,
        timeline: Object.freeze(timeline),
      });
    }
    previousOutstanding = decision.outstanding;
    stalledRounds = decision.stalledRounds;
  }
  // The recording ended before the loop would have stopped: the build had
  // rounds left that the version which produced this ledger never granted it.
  return Object.freeze({
    outcome: "still-converging",
    roundsRemaining: maxAttempts - rounds.length,
    timeline: Object.freeze(timeline),
  });
}
