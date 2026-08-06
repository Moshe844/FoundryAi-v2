import assert from "node:assert/strict";
import test from "node:test";

import {
  ObservationAction,
  browserObservationDecision,
  replayObservationTrajectory,
} from "../src/domain/browser-observation-policy.js";
import { recordedTrajectory } from "../src/work-plane/observation-replay.js";

const budgets = { maxAttempts: 6 };

test("a converging build is not stopped by the attempt ceiling", () => {
  // Recorded from mission ec4b06fb, which was cut off at a single outstanding
  // check by a ceiling of four while it was still reducing failures. The
  // ceiling was a guess; this is what the guess cost.
  const converging = [
    { checks: 5, fidelity: 0 },
    { checks: 1, fidelity: 0 },
    { checks: 0, fidelity: 4 },
    { checks: 1, fidelity: 0 },
  ];

  assert.equal(
    replayObservationTrajectory(converging, { maxAttempts: 4 }).outcome,
    "failed",
    "the old ceiling stopped this build",
  );
  assert.equal(
    replayObservationTrajectory(converging, budgets).outcome,
    "still-converging",
    "the current policy lets it keep reducing failures",
  );
});

test("a build whose behaviour is proven is delivered, never failed", () => {
  // Recorded from 871c70fe: every browser check passed and one design aspect
  // remained when the ceiling ran out.
  const behaviourProvenAtTheEnd = [
    { checks: 10, fidelity: 0 },
    { checks: 2, fidelity: 0 },
    { checks: 2, fidelity: 0 },
    { checks: 0, fidelity: 1 },
  ];
  const replayed = replayObservationTrajectory(behaviourProvenAtTheEnd, {
    maxAttempts: 4,
  });
  assert.equal(replayed.outcome, "delivered-with-shortfall");

  // Behaviour is never waived. The same trajectory with one check still false
  // is a failure at the same point.
  const behaviourNotProven = [
    ...behaviourProvenAtTheEnd.slice(0, 3),
    { checks: 1, fidelity: 1 },
  ];
  assert.equal(
    replayObservationTrajectory(behaviourNotProven, { maxAttempts: 4 }).outcome,
    "failed",
  );
});

test("two rounds that reduce nothing stop the build, and one does not", () => {
  // This, not the ceiling, is what protects the clock: a stalled build costs
  // about three minutes before it stops.
  const oneFlatRound = replayObservationTrajectory(
    [
      { checks: 4, fidelity: 0 },
      { checks: 4, fidelity: 0 },
      { checks: 2, fidelity: 0 },
    ],
    budgets,
  );
  assert.equal(oneFlatRound.outcome, "still-converging");

  const twoFlatRounds = replayObservationTrajectory(
    [
      { checks: 4, fidelity: 0 },
      { checks: 4, fidelity: 0 },
      { checks: 4, fidelity: 0 },
    ],
    budgets,
  );
  assert.equal(twoFlatRounds.outcome, "failed");
  assert.equal(twoFlatRounds.stoppedBy, ObservationAction.HALT_STALLED);
});

test("the decision is a pure function of the numbers a ledger already holds", () => {
  // Every wrong version of this decision cost a real build, and none was
  // visible in a test of the loop around it.
  const stalling = browserObservationDecision({
    attempt: 2,
    maxAttempts: 6,
    outstandingChecks: 3,
    outstandingFidelityAspects: 0,
    previousOutstanding: 3,
    stalledRounds: 1,
    behaviourProven: false,
  });
  assert.equal(stalling.action, ObservationAction.HALT_STALLED);
  assert.equal(stalling.stalledRounds, 2);

  // The same stall with behaviour proven delivers instead of failing.
  const stallingButProven = browserObservationDecision({
    attempt: 2,
    maxAttempts: 6,
    outstandingChecks: 0,
    outstandingFidelityAspects: 3,
    previousOutstanding: 3,
    stalledRounds: 1,
    behaviourProven: true,
  });
  assert.equal(stallingButProven.action, ObservationAction.DELIVER_WITH_SHORTFALL);

  // A spent repair budget stops the build even while it is still reducing.
  const budgetSpent = browserObservationDecision({
    attempt: 1,
    maxAttempts: 6,
    outstandingChecks: 2,
    previousOutstanding: 5,
    stalledRounds: 0,
    behaviourProven: false,
    appliedRepairs: 4,
    maxRepairCalls: 4,
  });
  assert.equal(budgetSpent.action, ObservationAction.HALT_REPAIR_BUDGET);
});

test("a round is read from an observation, not from each repair it bought", () => {
  // One round can buy several proposals, because a patch whose oldText no
  // longer matches is rejected and re-bought without a new observation.
  // Counting repair prompts made a build that observed four times read as five
  // rounds of [5,5,5,1,1], which made the policy look like it stalled on a
  // build that in fact succeeded — the harness reporting a regression that
  // never happened.
  const repair = (sequence, failures) => ({
    eventId: `m-contract-v1-browser-repair-${sequence}.model.fact`,
    fact: {
      metadata: {
        modelCallRecord: {
          purpose: `Observation failure:\nThe following real browser checks were false: ${failures}.`,
        },
      },
    },
  });
  const observation = (round) => ({
    eventId: `m-0${round}-browser-verification-runtime-${round}-attempt-${round}.started`,
  });

  const events = [
    observation(1),
    repair(1, "a, b, c, d, e"),
    repair(2, "a, b, c, d, e"), // same round, rejected patch re-bought
    repair(3, "a, b, c, d, e"), // same round again
    observation(2),
    repair(4, "a"),
  ];

  assert.deepEqual(recordedTrajectory(events), [
    { checks: 5, fidelity: 0 },
    { checks: 1, fidelity: 0 },
  ]);
});
