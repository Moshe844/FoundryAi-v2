export function understandingRecoveryDecision(events) {
  const deleted = events.some(
    (record) =>
      record.fact?.metadata?.projectCatalogueOperation?.operation ===
      "DELETED",
  );
  if (deleted) {
    return Object.freeze({ recover: false, reason: "deleted" });
  }
  const state = events
    .filter((record) => record.type === "MISSION_TRANSITION")
    .at(-1)?.transition.to;
  const hasProfile = events.some(
    (record) => record.fact?.metadata?.projectProfile !== undefined,
  );
  if (state !== "INTAKE" || hasProfile) {
    return Object.freeze({ recover: false, reason: "not-pending-intake" });
  }
  const hasDispatchedProviderAttempt = events.some(
    (record) =>
      record.fact?.metadata?.modelRouteStart?.taskClass ===
      "PROJECT_UNDERSTANDING",
  );
  if (hasDispatchedProviderAttempt) {
    return Object.freeze({
      recover: false,
      reason: "provider-attempt-interrupted",
    });
  }
  return Object.freeze({ recover: true, reason: "never-dispatched" });
}

export function executionRecoveryDecision(events) {
  const deleted = events.some(
    (record) =>
      record.fact?.metadata?.projectCatalogueOperation?.operation ===
      "DELETED",
  );
  if (deleted) {
    return Object.freeze({ recover: false, reason: "deleted" });
  }
  const state = events
    .filter((record) => record.type === "MISSION_TRANSITION")
    .at(-1)?.transition.to;
  if (state === "EXECUTING" || state === "VERIFYING") {
    const hasDispatchedGenerationAttempt = events.some(
      (record) =>
        record.fact?.metadata?.modelRouteStart?.taskClass ===
        "FILE_GENERATION",
    );
    const hasSucceededGenerationAttempt = events.some(
      (record) =>
        record.fact?.metadata?.modelCallRecord?.taskClass ===
          "FILE_GENERATION" &&
        record.fact.metadata.modelCallRecord.status === "SUCCEEDED",
    );
    if (hasDispatchedGenerationAttempt && !hasSucceededGenerationAttempt) {
      return Object.freeze({
        recover: false,
        reason: "provider-attempt-interrupted",
      });
    }
    return Object.freeze({ recover: true, reason: "interrupted-worker" });
  }
  return Object.freeze({ recover: false, reason: "not-recoverable" });
}
