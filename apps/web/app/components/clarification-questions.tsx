"use client";

import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  ClarificationDecision,
  CustomerFollowUpAnswer,
} from "../../experience/contracts";
import { internalLanguageTerm } from "../../experience/plain-language";

export type ClarificationAnswer = Readonly<{
  mode: "none" | "decide" | "choice" | "other";
  choice?: string;
  text?: string;
}>;

export function clarificationAnswerPayload(
  question: ClarificationDecision,
  answer: ClarificationAnswer,
  profileVersion: number,
): CustomerFollowUpAnswer {
  const recommended = question.recommendation.value;
  const selectedValue =
    answer.mode === "choice" && answer.choice
      ? answer.choice
      : answer.mode === "other" && answer.text?.trim()
        ? answer.text.trim()
        : recommended;
  const optionIndex = question.choices.value.indexOf(selectedValue);
  const mode =
    answer.mode === "other"
      ? "other"
      : answer.mode === "choice"
        ? selectedValue === recommended
          ? "accept-recommendation"
          : "select-option"
        : "delegate";
  const payload: CustomerFollowUpAnswer = {
    questionId: question.questionId,
    answer:
      mode === "delegate"
        ? `Foundry decides. Recommended: ${recommended}. Use your professional judgement.`
        : selectedValue,
    selection: {
      kind: "decision",
      subjectId: question.questionId,
      mode,
      optionId:
        optionIndex < 0
          ? null
          : `${question.questionId}-option-${optionIndex + 1}`,
      value: selectedValue,
      reason:
        mode === "delegate"
          ? question.recommendationReason.value
          : question.consequences.value[optionIndex] ?? question.reason.value,
      classification: "project decision",
      sourceProfileVersion: profileVersion,
    },
  };
  return payload;
}

export function answerIsExplicit(answer: ClarificationAnswer | undefined) {
  if (answer === undefined || answer.mode === "none") return false;
  if (answer.mode === "other") return Boolean(answer.text?.trim());
  return true;
}

function Chevron() {
  return (
    <svg
      className="chev"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.5 6.5 5 3 8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QuestionCard({
  answer,
  designReview,
  onChange,
  question,
}: Readonly<{
  answer: ClarificationAnswer;
  designReview: boolean;
  onChange: (next: ClarificationAnswer) => void;
  question: ClarificationDecision;
}>) {
  const [showAll, setShowAll] = useState(false);
  const radioGroupRef = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const options = question.choices.value;
  const visible = showAll ? options : options.slice(0, 4);
  const reviewTerm = internalLanguageTerm(
    [
      question.prompt.value,
      question.reason.value,
      ...question.choices.value,
    ].join(" "),
  );
  const promptId = `question-${question.questionId}`;

  useEffect(() => {
    if (answer.mode === "other") otherRef.current?.focus();
  }, [answer.mode]);

  function moveRadio(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    if (
      !["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(
        event.key,
      )
    ) {
      return;
    }
    const radios = radioGroupRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    if (!radios?.length) return;
    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = radios.length - 1;
    else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % radios.length;
    } else {
      nextIndex = (currentIndex - 1 + radios.length) % radios.length;
    }
    radios[nextIndex].click();
    radios[nextIndex].focus();
  }

  return (
    <fieldset className="question">
      <legend className="t-title-s question-prompt" id={promptId}>
        {question.prompt.value}
      </legend>
      {designReview && reviewTerm !== null && (
        <p className="design-review-flag t-caption">Needs plain language</p>
      )}

      <div
        ref={radioGroupRef}
        className="question-options"
        role="radiogroup"
        aria-labelledby={promptId}
      >
        <button
          type="button"
          className="opt opt-decide"
          role="radio"
          aria-checked={answer.mode === "decide"}
          tabIndex={
            answer.mode === "none" || answer.mode === "decide" ? 0 : -1
          }
          onKeyDown={(event) => moveRadio(event, 0)}
          onClick={() => onChange({ mode: "decide" })}
        >
          <span className="opt-row">
            <span className="opt-check" aria-hidden="true">
              &#10003;
            </span>
            <span>
              <span className="opt-decide-head">
                <span className="opt-decide-lead">
                  Let Foundry choose
                </span>
                <span className="badge">Flexible</span>
              </span>
              <span className="opt-decide-detail t-body-s">
                Current recommendation: {question.recommendation.value}
              </span>
              <span className="opt-consequence t-caption">
                Foundry may reconsider this before final approval if later input changes what fits best.
              </span>
            </span>
          </span>
        </button>

        <div className="opt-grid">
          {visible.map((option, index) => {
            const selected =
              answer.mode === "choice" && answer.choice === option;
            return (
              <button
                type="button"
                key={option}
                className="opt"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onKeyDown={(event) => moveRadio(event, index + 1)}
                onClick={() => onChange({ mode: "choice", choice: option })}
              >
                <span className="opt-row">
                  <span className="opt-check" aria-hidden="true">
                    &#10003;
                  </span>
                  <span>
                    {option}
                    {option === question.recommendation.value && (
                      <span className="badge">Recommended now</span>
                    )}
                  </span>
                </span>
                <span className="opt-consequence t-caption">
                  {question.consequences.value[index]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {options.length > 4 && !showAll && (
        <div className="q-links">
          <button
            type="button"
            className="btn-quiet small"
            onClick={() => setShowAll(true)}
          >
            More options
          </button>
        </div>
      )}

      <div className="q-links">
        <button
          type="button"
          className="btn-quiet small"
          onClick={() =>
            onChange(
              answer.mode === "other"
                ? { mode: "none" }
                : { mode: "other", text: "" },
            )
          }
        >
          Something else&hellip;
        </button>
      </div>

      {answer.mode === "other" && (
        <div className="q-extra">
          <label htmlFor={`other-${question.questionId}`} className="t-body-s">
            In your own words
          </label>
          <textarea
            ref={otherRef}
            id={`other-${question.questionId}`}
            suppressHydrationWarning
            rows={2}
            placeholder="What should I do instead?"
            value={answer.text ?? ""}
            onChange={(event) =>
              onChange({ mode: "other", text: event.target.value })
            }
          />
        </div>
      )}


      <details className="why">
        <summary className="t-body-s">
          <Chevron />
          Why I&rsquo;m asking
        </summary>
        <p className="t-body-s">{question.reason.value}</p>
      </details>
    </fieldset>
  );
}

export function ClarificationQuestions({
  answers,
  decisions,
  onAnswer,
}: Readonly<{
  answers: Readonly<Record<string, ClarificationAnswer>>;
  decisions: readonly ClarificationDecision[];
  onAnswer: (questionId: string, answer: ClarificationAnswer) => void;
}>) {
  const [designReview, setDesignReview] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDesignReview(
        new URL(window.location.href).searchParams.get("design-review") === "1",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    for (const decision of decisions) {
      const term = internalLanguageTerm(
        [
          decision.prompt.value,
          decision.reason.value,
          ...decision.choices.value,
        ].join(" "),
      );
      if (term !== null) {
        console.warn(
          `[foundry] Question "${decision.questionId}" needs plain language; found "${term}".`,
        );
      }
    }
  }, [decisions]);

  if (decisions.length === 0) return null;
  return (
    <section className="act">
      <div className="rule-head">
        <span className="rule-mark" aria-hidden="true" />
        <p className="t-label ink-tertiary">Only if you want to weigh in</p>
        <h2 className="t-title-l">
          {decisions.length === 1
            ? "One decision that actually matters"
            : `${decisions.length} decisions that actually matter`}
        </h2>
      </div>
      <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
        You can leave everything as-is. I&rsquo;ll use the recommended choices.
      </p>
      <p className="t-body-s ink-tertiary">
        Nothing here is required. Anything you leave unanswered, I&rsquo;ll
        decide.
      </p>

      <div className="questions-list">
        {decisions.map((decision) => (
          <QuestionCard
            key={decision.questionId}
            question={decision}
            answer={answers[decision.questionId] ?? { mode: "none" }}
            designReview={designReview}
            onChange={(answer) => onAnswer(decision.questionId, answer)}
          />
        ))}
      </div>
    </section>
  );
}
