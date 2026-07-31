import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectDecisionHistory } from "../local-api/decision-history.mjs";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function profileRecord({
  answers = [],
  questions = [],
  suggestions = [],
  version,
}) {
  return {
    fact: {
      metadata: {
        projectProfile: {
          profileVersion: version,
          openQuestions: questions,
          contextualSuggestions: suggestions,
        },
        clarificationAnswers: answers,
      },
    },
  };
}

test("decision history replays customer answers and selected ideas from immutable profiles", () => {
  const question = {
    questionId: "question-1",
    prompt: "Who signs in?",
    reason: "This changes access control.",
    answerOptions: ["Customers", "Staff"],
  };
  const suggestion = {
    suggestionId: "suggestion-1",
    label: "Add reminders",
    rationale: "People are less likely to miss a booking.",
  };
  const initial = profileRecord({
    version: 1,
    questions: [question],
    suggestions: [suggestion],
  });
  const selected = profileRecord({
    version: 2,
    answers: [
      { questionId: "question-1", answer: "Customers" },
      {
        questionId: "suggestion-1",
        answer:
          "Include this project idea: Add reminders. People are less likely to miss a booking.",
      },
      {
        questionId: "customer-proposal-confirmation",
        answer: "The customer approved this proposal.",
      },
    ],
  });

  assert.deepEqual(projectDecisionHistory([initial, selected]), {
    decisions: [
      {
        questionId: "question-1",
        prompt: "Who signs in?",
        reason: "This changes access control.",
        choices: ["Customers", "Staff"],
        recommendation: "Customers",
        answer: "Customers",
      },
    ],
    selectedEnhancements: [suggestion],
  });

  const revised = profileRecord({
    version: 3,
    answers: [
      { questionId: "question-1", answer: "Staff" },
      {
        questionId: "suggestion-1",
        answer:
          "Remove this project idea: Add reminders. It should no longer be included.",
      },
    ],
  });
  assert.deepEqual(projectDecisionHistory([initial, selected, revised]), {
    decisions: [
      {
        questionId: "question-1",
        prompt: "Who signs in?",
        reason: "This changes access control.",
        choices: ["Customers", "Staff"],
        recommendation: "Customers",
        answer: "Staff",
      },
    ],
    selectedEnhancements: [],
  });
});

test("Phase D is a modular sourced decision brief", async () => {
  const [page, brief, selectors, server] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/decision-brief.tsx"),
    source("../experience/selectors.ts"),
    source("../local-api/server.mjs"),
  ]);

  assert.match(page, /import \{ DecisionBrief \}/);
  assert.match(page, /<DecisionBrief/);
  assert.doesNotMatch(page, /function ThePlan\(/);
  assert.doesNotMatch(brief, /mission\.profile/);
  assert.match(selectors, /mission\.decisionHistory\.map/);
  assert.match(selectors, /mission\.selectedEnhancements\.map/);
  assert.match(
    selectors,
    /profile\.verificationPlan\.checks\.map\(\(check\) => check\.label\)/,
  );
  assert.doesNotMatch(
    selectors,
    /if \(profile === null \|\| contract === null\) return null/,
  );
  assert.match(server, /WEB_STACK_MANIFEST/);
  assert.match(server, /projectDecisionHistory\(events\)/);
});

test("the brief implements the approved copy, editing, and truth constraints", async () => {
  const brief = await source("../app/components/decision-brief.tsx");
  for (const copy of [
    "Before I start",
    "The plan",
    "What I&rsquo;ll build",
    "Who it&rsquo;s for",
    "How people will use it",
    "How it&rsquo;s put together",
    "Your decisions",
    "Ideas you added",
    "What I&rsquo;m assuming",
    "What I&rsquo;ll prove",
    "Start building",
    "Change something",
    "Add a note",
    "Reconsider this",
  ]) {
    assert.match(
      brief,
      new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(brief, /brief\.verificationObligations\.value/);
  assert.match(brief, /checks\.length/);
  assert.match(brief, /customer-note/);
  assert.match(brief, /customer-assumption-change/);
  assert.match(brief, /customer-reconsider/);
  assert.match(
    brief,
    /Reconsider the plan and tell me if you'd do it differently\./,
  );
  assert.match(brief, /scrollIntoView/);
  assert.match(brief, /Remove this project idea:/);
  assert.match(brief, /technical\.stackId\.value/);
  assert.doesNotMatch(
    brief,
    /web-nextjs-typescript-sqlite-npm-playwright/,
  );
});

test("the accepted start request has an honest bounded handoff", async () => {
  const [page, transition, server] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/start-building-transition.tsx"),
    source("../local-api/server.mjs"),
  ]);
  assert.match(page, /baselineActivitySequence/);
  assert.match(page, /activity\.sequence > startHandoff\.baselineActivitySequence/);
  assert.match(transition, /Starting work on \{projectName\}\./);
  assert.match(transition, /everything is\s+recorded/);
  assert.match(transition, /20_000/);
  assert.match(transition, /1_200/);
  assert.match(transition, /build worker hasn&rsquo;t reported yet/);
  assert.match(transition, />\s*Stop\s*</);
  assert.equal(
    (
      transition.slice(
        transition.indexOf("const PHASES"),
        transition.indexOf("] as const"),
      ).match(/^\s+"/gmu) ?? []
    ).length,
    9,
  );
  assert.doesNotMatch(transition, /progress/i);
  assert.match(
    server,
    /missionRoute\?\.action === "start"[\s\S]*json\(response, 202/,
  );
});
