function observations(history, taskClass) {
  const results = new Map();
  const attemptsByRequest = new Map();
  const failures = [];
  for (const entry of Array.isArray(history) ? history : []) {
    if (taskClass !== null && entry?.taskClass !== taskClass) continue;
    if (entry?.kind === "result" && typeof entry.requestId === "string") {
      results.set(entry.requestId, entry);
    } else if (entry?.kind === "route" && typeof entry.requestId === "string") {
      const attempts = attemptsByRequest.get(entry.requestId) ?? [];
      attempts.push(entry);
      attemptsByRequest.set(entry.requestId, attempts);
    } else if (entry?.kind === "failure" && typeof entry.providerId === "string") {
      failures.push(entry);
    }
  }
  const providers = new Map();
  const models = new Map();
  function observe(providerId, modelId, succeeded) {
    if (typeof providerId !== "string") return;
    const statistics = typeof modelId === "string" ? models : providers;
    const key = typeof modelId === "string" ? `${providerId}\u0000${modelId}` : providerId;
    const record = statistics.get(key) ?? { succeeded: 0, failed: 0 };
    record[succeeded ? "succeeded" : "failed"] += 1;
    statistics.set(key, record);
  }
  for (const result of results.values()) {
    const attempts = [...(attemptsByRequest.get(result.requestId) ?? [])]
      .sort((left, right) => left.routeAttempt - right.routeAttempt);
    attempts.forEach((attempt, index) => {
      const isFinal = index === attempts.length - 1;
      observe(
        attempt.providerId,
        attempt.modelId,
        isFinal && result.status === "SUCCEEDED" &&
          attempt.providerId === result.providerId &&
          (typeof result.modelId !== "string" ||
            typeof attempt.modelId !== "string" ||
            attempt.modelId === result.modelId),
      );
    });
  }
  for (const failure of failures.filter((entry) => !results.has(entry.requestId))) {
    observe(failure.providerId, failure.modelId, false);
  }
  return { providers, models };
}

function reliabilityRecord(statistics, providerId, modelId) {
  const modelKey = `${providerId}\u0000${modelId}`;
  const record = statistics.models.get(modelKey) ??
    statistics.providers.get(providerId) ?? { succeeded: 0, failed: 0 };
  const observations = record.succeeded + record.failed;
  return Object.freeze({
    succeeded: record.succeeded,
    failed: record.failed,
    observations,
    estimatedFailureRate: (record.failed * 2 + 1) /
      (record.succeeded + record.failed * 2 + 2),
  });
}

export function modelRouteReliability(route, history, taskClass = null) {
  return reliabilityRecord(
    observations(history, taskClass),
    route.providerId,
    route.modelId,
  );
}

export function rankRoutesByPersistedTaskHistory(routes, history, taskClass) {
  if (!Array.isArray(routes) || !Array.isArray(history)) return routes;
  const statistics = observations(history, taskClass);
  return routes
    .map((route, baseIndex) => ({
      route,
      baseIndex,
      reliability: reliabilityRecord(
        statistics,
        route.providerId,
        route.modelId,
      ),
    }))
    .sort((left, right) =>
      left.reliability.estimatedFailureRate -
        right.reliability.estimatedFailureRate ||
      left.baseIndex - right.baseIndex,
    )
    .map(({ route }) => route);
}
