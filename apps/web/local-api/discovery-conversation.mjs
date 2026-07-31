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
]);

function customerInputKind(answer, records) {
  if (answer?.selection?.kind === "customer-message") {
    const revision = records.find(
      (record) =>
        record.profile.profileVersion === answer.selection.sourceProfileVersion + 1,
    );
    const revisionIndex = revision === undefined ? -1 : records.indexOf(revision);
    const sections =
      revisionIndex <= 0
        ? []
        : changedSections(records[revisionIndex - 1].profile, revision.profile);
    if (sections.includes("Design direction")) return "design";
    if (sections.includes("Workflows")) return "workflow";
    if (sections.includes("Useful ideas")) return "feature";
    if (sections.includes("Decisions")) return "business-rule";
    if (sections.includes("Understanding")) return "understanding";
    return "context";
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
    const kind = customerInputKind(record.answer, records);
    if (kind === null) continue;
    const key = `${record.answer.questionId}\u0000${record.answer.answer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({
      messageId: record.answer.questionId,
      kind,
      text: record.answer.answer,
      profileVersion: record.profileVersion,
      occurredAt: record.occurredAt,
    });
  }
  for (const record of records) {
    for (const answer of record.answers) {
      const kind = customerInputKind(answer, records);
      if (kind === null) continue;
      const key = `${answer.questionId}\u0000${answer.answer}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({
        messageId: answer.questionId,
        kind,
        text: answer.answer,
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
