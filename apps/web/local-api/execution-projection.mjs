const PREPARE_PROCEDURES = new Set([
  "dependencyLock",
  "install",
  "typeCheck",
  "lint",
  "productionBuild",
]);

function phaseSignal(record, hasPersistence) {
  if (record.type === "MISSION_TRANSITION") {
    return {
      PROVISIONING: 2,
      EXECUTING: 3,
      VERIFYING: 8,
      REPAIRING: 3,
      SUCCEEDED: 8,
    }[record.transition.to] ?? 0;
  }
  if (record.type === "REQUIREMENT_CONTRACT_CREATED") return 1;
  if (record.type === "COMPLETION_VERDICT_RECORDED") return 8;

  const execution =
    record.fact?.metadata?.executionRecord ??
    record.fact?.metadata?.executionStart?.fingerprint;
  if (execution !== undefined) {
    const procedure = execution.inputs?.procedureName;
    if (procedure === "browserVerification") return 7;
    if (PREPARE_PROCEDURES.has(procedure)) return 5;
    if (
      ["apply-file-bundle", "write-file", "replace-file"].includes(
        execution.actionType,
      )
    ) {
      return hasPersistence ? 4 : 3;
    }
    return 3;
  }

  const runtime = record.fact?.metadata?.runtimeRecord;
  if (runtime?.eventType === "BROWSER_OBSERVATION") return 7;
  if (runtime !== undefined) return 6;
  return 0;
}

function latestState(events) {
  return events
    .filter((record) => record.type === "MISSION_TRANSITION")
    .at(-1)?.transition.to ?? null;
}

const BUILD_TERMINAL_STATES = new Set([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "EXHAUSTED",
  "CANCELLED",
]);

function timingProjection(events) {
  const transitions = events.filter(
    (record) => record.type === "MISSION_TRANSITION",
  );
  const started = transitions.find(
    (record) => record.transition.to === "CONTRACTED",
  );
  if (started === undefined) {
    return {
      startedAt: null,
      completedAt: null,
    };
  }
  const completed = transitions.find(
    (record) =>
      Date.parse(record.occurredAt) >= Date.parse(started.occurredAt) &&
      BUILD_TERMINAL_STATES.has(record.transition.to),
  );
  return {
    startedAt: started.occurredAt,
    completedAt: completed?.occurredAt ?? null,
  };
}

// "Testing important actions" showed the same words at the first observation
// and the seventh. A build that passes spends under a minute there; one that is
// grinding through corrections can spend eleven, and looked identical the whole
// time. Report which round is running and what is still outstanding, so a long
// stage reads as work in progress rather than a frozen screen.
function observationProjection(events) {
  const started = events.filter((record) =>
    /browser-verification-runtime-\d+-attempt-\d+\.started$/u.test(record.eventId ?? ""),
  );
  if (started.length === 0) return null;
  // Corrections between rounds are the reason a long observation stage is long,
  // so counting them tells the customer the difference between "still working"
  // and "stuck".
  const corrections = events.filter((record) =>
    /-(?:browser-repair|design-fidelity-repair)-\d+\.model\.fact$/u.test(record.eventId ?? ""),
  ).length;
  return Object.freeze({
    round: started.length,
    maximumRounds: 7,
    corrections,
  });
}

function repairProjection(events) {
  const repairStart = events.findLastIndex(
    (record) =>
      record.type === "MISSION_TRANSITION" &&
      record.transition.to === "REPAIRING",
  );
  if (repairStart < 0) return null;

  const cycle = events.slice(repairStart);
  const admissions = cycle
    .map((record) => record.fact?.metadata?.repairAdmission)
    .filter(Boolean);
  const attempts = cycle
    .map((record) => record.fact?.metadata?.repairAttempt)
    .filter(Boolean);
  const finding =
    cycle
      .map((record) => record.fact?.metadata?.repairFinding)
      .filter(Boolean)
      .at(-1) ?? null;
  const executionAfterAdmission =
    admissions.length > 0 &&
    cycle.some(
      (record) =>
        record.fact?.metadata?.executionStart !== undefined ||
        record.fact?.metadata?.executionRecord !== undefined,
    );
  const verifyingAfterRepair = cycle.some(
    (record) =>
      record.type === "MISSION_TRANSITION" &&
      record.transition.to === "VERIFYING",
  );
  const lines = ["A workflow didn't behave as expected."];
  if (admissions.length > 0) lines.push("I found the likely cause.");
  if (executionAfterAdmission) {
    lines.push("I'm correcting the affected part.");
  }
  if (verifyingAfterRepair) {
    lines.push("I'm rerunning only the checks that matter.");
  }

  let state = admissions.length > 1 ? "different-strategy" : "automatic";
  if (finding?.findingType === "BUDGET_EXHAUSTED") state = "budget-warning";
  if (finding?.findingType === "STRATEGIES_EXHAUSTED") {
    state = "different-strategy";
  }
  if (finding?.findingType === "EXTERNAL_BLOCKER") state = "external-service";
  if (
    attempts.at(-1)?.verificationResult?.overallResult === "INCOMPLETE"
  ) {
    state = "verification-incomplete";
  }
  const stateNow = latestState(events);
  if (stateNow === "BLOCKED") state = "customer-action-required";
  if (stateNow === "EXHAUSTED") state = "honest-exhaustion";

  const latestAdmission = admissions.at(-1) ?? null;
  return {
    state,
    lines,
    targetObligationIds: latestAdmission?.targetObligationIds ?? [],
    affectedArea: latestAdmission?.failureClassification ?? null,
    findingDetail: finding?.detail ?? null,
    attempts: attempts.length,
  };
}

function runtimeProjection(events) {
  const latestEvent = events.findLast(
    (record) => record.fact?.metadata?.runtimeRecord !== undefined,
  );
  const latest = latestEvent?.fact?.metadata?.runtimeRecord;
  if (latest === undefined) return null;
  return {
    status: latest.status,
    eventType: latest.eventType,
    previewUrl: latest.previewUrl,
    workspaceId: latest.workspaceId,
    checkpointId: latest.checkpointId,
    sessionId: latest.sessionId,
    evidenceReferences: latest.evidenceReferences,
    plainCause:
      latest.status === "STARTUP_FAILED"
        ? "The recorded startup check did not succeed."
        : latest.status === "CRASHED"
          ? "The running application process stopped unexpectedly."
          : null,
  };
}

function workspaceProjection(events, profile) {
  const facts = events
    .map((record) => record.workspaceFact)
    .filter(Boolean);
  const workspaceId = facts.at(-1)?.workspaceId ?? null;
  return {
    workspaceId,
    checkpointIds: [
      ...new Set(facts.map((fact) => fact.checkpointId).filter(Boolean)),
    ],
    runtimeAdapterId: profile?.runtimeAdapterId ?? "nextjs-web-runtime",
  };
}

function verificationProjection(events, contract, profile) {
  const verdict =
    events
      .map((record) => record.completionVerdict)
      .filter(Boolean)
      .at(-1) ?? null;
  const verdicts = new Map(
    (verdict?.obligationVerdicts ?? []).map((entry) => [
      entry.obligationId,
      entry,
    ]),
  );
  return (contract?.obligations ?? []).map((obligation) => {
    const result = verdicts.get(obligation.obligationId);
    const missingCustomerProvenance =
      /\b(?:supplied|provided)\s+(?:business\s+)?(?:content|wording|images?|logo|contact|details?)\b/iu.test(
        obligation.statement,
      ) &&
      (profile?.customerContent?.supplied?.length ?? 0) === 0;
    return {
      obligationId: obligation.obligationId,
      statement: obligation.statement,
      result: missingCustomerProvenance
        ? "UNVERIFIABLE"
        : result?.result ?? "PENDING",
      detail:
        missingCustomerProvenance
          ? "No customer-provided content provenance was recorded for this claim."
          : result?.deficiency ??
            result?.unverifiableCondition ??
            null,
      evidenceReferences: result?.evidenceReferences ?? [],
    };
  });
}

export function projectExecutionProjection({
  contract,
  events,
  profile,
}) {
  const hasPersistence =
    [profile, ...events.map(
      (record) => record.fact?.metadata?.projectProfile,
    )]
      .filter(Boolean)
      .some((candidate) =>
        candidate.capabilities?.some((capability) =>
          [
            "sqlite-persistence",
            "create-records",
            "update-records",
            "refresh-persistence",
          ].includes(capability),
        ),
      );
  const currentIndex = Math.min(
    8,
    events.reduce(
      (maximum, record) =>
        Math.max(maximum, phaseSignal(record, hasPersistence)),
      0,
    ),
  );
  const state = latestState(events);
  return {
    timing: timingProjection(events),
    phase: {
      currentIndex,
      completedThrough: state === "SUCCEEDED" ? 8 : currentIndex - 1,
      interrupted: state === "REPAIRING",
      includesDataPhase: hasPersistence,
    },
    observation: observationProjection(events),
    repair: repairProjection(events),
    runtime: runtimeProjection(events),
    workspace: workspaceProjection(events, profile),
    verification: verificationProjection(events, contract, profile),
  };
}
