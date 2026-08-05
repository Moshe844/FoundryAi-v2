const INPUT_KINDS = new Set([
  "context",
  "understanding",
  "workflow",
  "feature",
  "design",
  "business-rule",
  "role",
  "integration",
  "limitation",
  "acceptance",
  "design-preference",
  "workflow-change",
  "feature-request",
  "content-requirement",
  "acceptance-expectation",
  "correction",
  "other",
]);

function customerInputKind(answer, records) {
  if (answer?.selection?.kind === "customer-message") {
    const explicit = String(answer.selection.classification ?? "")
      .trim()
      .toLowerCase()
      .replaceAll(" ", "-");
    if (INPUT_KINDS.has(explicit)) return explicit;
    const revision = records.find(
      (record) =>
        record.profile.profileVersion === answer.selection.sourceProfileVersion + 1,
    );
    const revisionIndex = revision === undefined ? -1 : records.indexOf(revision);
    const sections =
      revisionIndex <= 0
        ? []
        : changedSections(records[revisionIndex - 1].profile, revision.profile);
    if (sections.includes("Design direction")) return "design-preference";
    if (sections.includes("Workflows")) return "workflow-change";
    if (sections.includes("Useful ideas")) return "feature-request";
    if (sections.includes("Decisions")) return "business-rule";
    if (sections.includes("Understanding")) return "correction";
    return "other";
  }
  const questionId = answer?.questionId;
  if (typeof questionId !== "string") return null;
  return (
    [...INPUT_KINDS].find((kind) =>
      questionId.startsWith(`customer-input-${kind}-`),
    ) ?? null
  );
}

function projectProfileRecords(events) {
  return events
    .filter((record) => record.fact?.metadata?.projectProfile !== undefined)
    .map((record) => ({
      occurredAt: record.occurredAt,
      profile: record.fact.metadata.projectProfile,
      answers: Array.isArray(record.fact.metadata.clarificationAnswers)
        ? record.fact.metadata.clarificationAnswers
        : [],
    }));
}

function customerMessageRecords(events) {
  return events.flatMap((record) => {
    const answers = Array.isArray(
      record.fact?.metadata?.customerFollowUpAnswers,
    )
      ? record.fact.metadata.customerFollowUpAnswers
      : [];
    const requestedProfileVersion = Number.isSafeInteger(
      record.fact?.metadata?.requestedProfileVersion,
    )
      ? record.fact.metadata.requestedProfileVersion
      : 0;
    return answers.map((answer) => ({
      occurredAt: record.occurredAt,
      profileVersion: requestedProfileVersion,
      answer,
    }));
  });
}

function changedSections(previous, current) {
  if (previous === undefined || current === undefined) return [];
  const sections = [
    ["Understanding", ["summary", "primaryActors", "outcomes"]],
    ["Workflows", ["primaryJourneys"]],
    ["Proposed direction", ["proposedFeatures", "includedDefaults"]],
    ["Design direction", ["designDirection", "designAlternatives"]],
    ["Useful ideas", ["contextualSuggestions"]],
    ["Decisions", ["openQuestions", "architectureDecisions"]],
    ["Assumptions and exclusions", ["assumptions", "constraints"]],
    ["Verification promises", ["verificationPlan"]],
  ];
  return sections
    .filter(([, keys]) =>
      keys.some(
        (key) =>
          JSON.stringify(previous[key]) !== JSON.stringify(current[key]),
      ),
    )
    .map(([label]) => label);
}

export function projectDiscoveryConversation(events) {
  const records = projectProfileRecords(events);
  const messages = [];
  const seen = new Set();
  for (const record of customerMessageRecords(events)) {
    // A customer message is recorded before model re-evaluation so it cannot
    // be lost. It is not, however, a successfully interpreted conversation
    // item until the requested profile revision exists. Publishing it early
    // mislabeled transient failures as "other" and falsely claimed the plan
    // had been revised.
    const pending =
      record.answer?.selection?.kind === "customer-message" &&
      !records.some(
        (item) => item.profile.profileVersion === record.profileVersion,
      );
    const kind = pending ? "other" : customerInputKind(record.answer, records);
    if (kind === null) continue;
    const key =
      record.answer?.selection?.kind === "customer-message"
        ? `customer-message\u0000${record.profileVersion}\u0000${record.answer.answer}`
        : `${record.answer.questionId}\u0000${record.answer.answer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({
      messageId: record.answer.questionId,
      kind,
      text: record.answer.answer,
      ...(record.answer?.selection?.kind === "customer-message"
        ? {
            status: pending ? "pending" : "applied",
            interpretation: pending
              ? "This instruction is preserved, but the plan revision has not completed yet."
              : `Foundry treated this as ${kind.replaceAll("-", " ")} based on the sections revised by the model.`,
            affectedSections: pending ? [] : (() => {
              const matching = records.find((item) => item.profile.profileVersion === record.profileVersion);
              const index = matching === undefined ? -1 : records.indexOf(matching);
              return index > 0 ? changedSections(records[index - 1].profile, matching.profile) : [];
            })(),
          }
        : {}),
      profileVersion: record.profileVersion,
      occurredAt: record.occurredAt,
    });
  }
  for (const record of records) {
    for (const answer of record.answers) {
      const kind = customerInputKind(answer, records);
      if (kind === null) continue;
      const key = answer?.selection?.kind === "customer-message"
        ? `customer-message\u0000${record.profile.profileVersion}\u0000${answer.answer}`
        : `${answer.questionId}\u0000${answer.answer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({
        messageId: answer.questionId,
        kind,
        text: answer.answer,
        ...(answer?.selection?.kind === "customer-message"
          ? {
              status: "applied",
              interpretation: `Foundry treated this as ${kind.replaceAll("-", " ")} based on the model-authored revision.`,
              affectedSections: changedSections(records.at(-2)?.profile, record.profile),
            }
          : {}),
        profileVersion: record.profile.profileVersion,
        occurredAt: record.occurredAt,
      });
    }
  }
  const latest = records.at(-1);
  const prior = records.at(-2);
  return {
    messages,
    latestRevision: {
      profileVersion: latest?.profile.profileVersion ?? 0,
      changedSections: changedSections(prior?.profile, latest?.profile),
    },
  };
}
