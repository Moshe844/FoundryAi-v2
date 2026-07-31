function projectProfileRecords(events) {
  return events
    .filter((record) => record.fact?.metadata?.projectProfile !== undefined)
    .map((record) => ({
      profile: record.fact.metadata.projectProfile,
      answers: Array.isArray(record.fact.metadata.clarificationAnswers)
        ? record.fact.metadata.clarificationAnswers
        : [],
    }));
}

function selectedIdeaAnswer(response) {
  if (response?.selection?.kind === "recommendation") {
    if (response.selection.mode === "include") return "include";
    if (response.selection.mode === "exclude") return "remove";
  }
  const answer = response?.answer ?? "";
  if (answer.startsWith("Include this project idea:")) return "include";
  if (answer.startsWith("Remove this project idea:")) return "remove";
  return null;
}

export function projectDecisionHistory(events) {
  const records = projectProfileRecords(events);
  const knownQuestions = new Map();
  const knownSuggestions = new Map();
  const decisions = new Map();
  const selectedEnhancements = new Map();

  for (const record of records) {
    for (const response of record.answers) {
      if (
        typeof response?.questionId !== "string" ||
        typeof response?.answer !== "string"
      ) {
        continue;
      }
      const question = knownQuestions.get(
        response.selection?.kind === "decision"
          ? response.selection.subjectId
          : response.questionId,
      );
      if (question !== undefined) {
        decisions.set(response.questionId, {
          questionId: response.questionId,
          prompt: question.prompt,
          reason: question.reason,
          choices: question.answerOptions,
          recommendation: question.answerOptions[0],
          answer: response.answer,
        });
        continue;
      }

      const ideaAction = selectedIdeaAnswer(response);
      if (ideaAction === null) continue;
      if (ideaAction === "remove") {
        selectedEnhancements.delete(response.questionId);
        continue;
      }
      const suggestion = knownSuggestions.get(
        response.selection?.kind === "recommendation"
          ? response.selection.subjectId
          : response.questionId,
      );
      if (suggestion !== undefined) {
        selectedEnhancements.set(response.questionId, {
          suggestionId: response.questionId,
          label: suggestion.label,
          rationale: suggestion.rationale,
        });
      }
    }

    for (const question of record.profile.openQuestions ?? []) {
      knownQuestions.set(question.questionId, question);
    }
    for (const suggestion of record.profile.contextualSuggestions ?? []) {
      knownSuggestions.set(suggestion.suggestionId, suggestion);
    }
  }

  return {
    decisions: [...decisions.values()],
    selectedEnhancements: [...selectedEnhancements.values()],
  };
}
