"use client";

import { useEffect, useRef, useState } from "react";

import type {
  ClarificationDecision,
  CustomerFollowUpAnswer,
  DiscoveryConversation,
  ProjectUnderstanding as ProjectUnderstandingModel,
} from "../../experience/contracts";
import {
  answerIsExplicit,
  type ClarificationAnswer,
  clarificationAnswerPayload,
  ClarificationQuestions,
} from "./clarification-questions";
import { CustomerInputComposer } from "./customer-input-composer";
import {
  DesignDirection,
  type DesignDirectionChoice,
} from "./design-direction";
import { FoundryProposal } from "./foundry-proposal";
import { FoundryObservations } from "./foundry-observations";
import { FoundryRecommendations } from "./foundry-recommendations";
import { ProjectUnderstanding } from "./project-understanding";

const stages = [
  { id: "read", short: "Foundry's read", title: "What I understood" },
  { id: "direction", short: "Direction", title: "The experience direction" },
  { id: "design", short: "Design", title: "How it should feel" },
  { id: "ideas", short: "Ideas", title: "Useful ideas" },
  { id: "decisions", short: "Decisions", title: "Choices that matter" },
  { id: "conversation", short: "Your input", title: "Your instructions" },
  { id: "review", short: "Review", title: "Ready for the plan" },
] as const;

export function ProjectDiscovery({
  busy,
  conversation,
  decisions,
  missionRunning,
  onClarify,
  profileVersion,
  understanding,
}: Readonly<{
  busy: boolean;
  conversation: DiscoveryConversation;
  decisions: readonly ClarificationDecision[];
  missionRunning: boolean;
  onClarify: (
    answers: CustomerFollowUpAnswer[],
  ) => Promise<boolean>;
  profileVersion: number;
  understanding: ProjectUnderstandingModel;
}>) {
  const [stage, setStage] = useState(0);
  const [answers, setAnswers] = useState<Record<string, ClarificationAnswer>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      understanding.proposal.recommendations.map((recommendation) => [
        recommendation.id,
        recommendation.selectedByDefault.value === true,
      ]),
    ),
  );
  const [designChoice, setDesignChoice] =
    useState<DesignDirectionChoice>({ mode: "recommended" });
  const stageRef = useRef<HTMLDivElement>(null);
  const proposal = understanding.proposal;
  const interactionBusy = busy || missionRunning;
  const effectiveSelected = Object.fromEntries(
    proposal.recommendations.map((recommendation) => [
      recommendation.id,
      selected[recommendation.id] ??
        (recommendation.selectedByDefault.value === true),
    ]),
  );
  const selectedRecommendations = proposal.recommendations.filter(
    (recommendation) => effectiveSelected[recommendation.id],
  );
  const answeredCount = decisions.filter((decision) =>
    answerIsExplicit(answers[decision.questionId]),
  ).length;

  useEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, [stage]);

  function moveTo(next: number) {
    setStage(Math.max(0, Math.min(stages.length - 1, next)));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function inviteInput() {
    document.querySelector<HTMLTextAreaElement>("#customer-conversation-message")?.focus();
  }

  async function submitCustomerInput(answer: CustomerFollowUpAnswer) {
    await onClarify([answer]);
  }

  function designFollowUp(): CustomerFollowUpAnswer {
    const selectedDirection = proposal.alternatives.find(
      (alternative) =>
        alternative.id === designChoice.optionId ||
        (designChoice.mode === "recommended" && alternative.recommended.value),
    );
    const value =
      designChoice.value?.trim() ||
      selectedDirection?.name.value ||
      proposal.designDirection.recommendedStyle.value;
    const mode =
      designChoice.mode === "other"
        ? "other"
        : designChoice.mode === "alternative"
          ? "select-option"
          : "accept-recommendation";
    return {
      questionId: "customer-design-direction",
      answer:
        mode === "other"
          ? `Customer design direction: ${value}.`
          : `Use this design direction: ${value}.`,
      selection: {
        kind: "design-direction",
        subjectId: "design-direction",
        mode,
        optionId: selectedDirection?.id ?? null,
        value,
        reason:
          selectedDirection?.whyItFits.value ?? proposal.designDirection.reason.value,
        classification: "design preference",
        sourceProfileVersion: profileVersion,
      },
    };
  }

  async function continueFromDesign() {
    if (designChoice.mode === "other" && !designChoice.value?.trim()) return;
    if (await onClarify([designFollowUp()])) moveTo(3);
  }

  async function toggleRecommendation(id: string) {
    const include = !effectiveSelected[id];
    const recommendation = proposal.recommendations.find(
      (item) => item.id === id,
    );
    if (
      recommendation !== undefined &&
      (await onClarify([recommendationFollowUp(recommendation, include)]))
    ) {
      setSelected((current) => ({ ...current, [id]: include }));
    }
  }

  function recommendationFollowUp(
    recommendation: (typeof proposal.recommendations)[number],
    include: boolean,
  ): CustomerFollowUpAnswer {
    return {
      questionId: recommendation.id,
      answer: include
        ? `Include this project idea: ${recommendation.title.value}. ${recommendation.reason.value}`
        : `Remove this project idea: ${recommendation.title.value}. Do not include it in the approved plan.`,
      selection: {
        kind: "recommendation",
        subjectId: recommendation.id,
        mode: include ? "include" : "exclude",
        optionId: recommendation.id,
        value: recommendation.title.value,
        reason: recommendation.reason.value,
        classification: "feature recommendation",
        sourceProfileVersion: profileVersion,
      },
    };
  }

  async function submit() {
    const decisionAnswers = decisions.map((decision) =>
      clarificationAnswerPayload(
        decision,
        answers[decision.questionId] ?? { mode: "none" },
        profileVersion,
      ),
    );
    const recommendationAnswers = proposal.recommendations.map(
      (recommendation) =>
        recommendationFollowUp(
          recommendation,
          effectiveSelected[recommendation.id] === true,
        ),
    );
    const recorded = await onClarify([
      ...decisionAnswers,
      ...recommendationAnswers,
      designFollowUp(),
      {
        questionId: "customer-proposal-confirmation",
        answer:
          "The proposal sounds right. Use these recorded decisions and continue to the plan.",
        selection: {
          kind: "proposal-confirmation",
          subjectId: "customer-proposal-confirmation",
          mode: "confirm",
          optionId: null,
          value: "Continue to the approved plan",
          reason: "The customer confirmed the complete proposal.",
          classification: "proposal confirmation",
          sourceProfileVersion: profileVersion,
        },
      },
    ]);
    if (!recorded) return;
    setAnswers({});
    setSelected(
      Object.fromEntries(
        proposal.recommendations.map((recommendation) => [
          recommendation.id,
          recommendation.selectedByDefault.value === true,
        ]),
      ),
    );
    setDesignChoice({ mode: "recommended" });
  }

  const currentStage = stages[stage];
  return (
    <section className="discovery-session" aria-label="Project discovery working session">
      <header className="discovery-progress">
        <div>
          <p className="t-label ink-tertiary">Working session</p>
          <p className="t-body-s ink-secondary">
            Step {stage + 1} of {stages.length} &middot; {currentStage.title}
          </p>
        </div>
        <nav aria-label="Discovery progress">
          <ol>
            {stages.map((item, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-current={stage === index ? "step" : undefined}
                  aria-label={`Step ${index + 1}: ${item.short}`}
                  onClick={() => moveTo(index)}
                >
                  <span>{index + 1}</span>
                  <em>{item.short}</em>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      <div className="discovery-workspace">
        <main
          ref={stageRef}
          className="discovery-stage"
          tabIndex={-1}
          aria-labelledby={`discovery-stage-${currentStage.id}`}
        >
          <h1 id={`discovery-stage-${currentStage.id}`} className="sr-only">
            {currentStage.title}
          </h1>

          {stage === 0 && (
            <>
              <ProjectUnderstanding understanding={understanding} />
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={() => moveTo(1)}>
                  That&rsquo;s right
                </button>
                <button className="btn btn-secondary" onClick={inviteInput}>
                  Adjust my understanding
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Add context
                </button>
              </div>
            </>
          )}

          {stage === 1 && (
            <>
              <FoundryObservations observations={proposal.observations} />
              <FoundryProposal
                audiences={understanding.audiences.value}
                journeys={understanding.journeys}
                proposal={proposal}
              />
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={() => moveTo(2)}>
                  Use this direction
                </button>
                <button className="btn btn-secondary" onClick={inviteInput}>
                  Change something
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Let Foundry revise it
                </button>
              </div>
            </>
          )}

          {stage === 2 && (
            <>
              <DesignDirection
                alternatives={proposal.alternatives}
                choice={designChoice}
                direction={proposal.designDirection}
                onChange={setDesignChoice}
              />
              <div className="stage-actions">
                <button className="btn btn-primary" disabled={interactionBusy} onClick={() => void continueFromDesign()}>
                  {interactionBusy ? "Adapting choices…" : "Use this direction"}
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Describe another style
                </button>
              </div>
            </>
          )}

          {stage === 3 && (
            <>
              <FoundryRecommendations
                recommendations={proposal.recommendations.slice(0, 5)}
                selected={effectiveSelected}
                onToggle={(id) => void toggleRecommendation(id)}
              />
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={() => moveTo(4)}>
                  Continue
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Add my own idea
                </button>
              </div>
            </>
          )}

          {stage === 4 && (
            <>
              <ClarificationQuestions
                decisions={decisions}
                answers={answers}
                onAnswer={(questionId, answer) =>
                  setAnswers((current) => {
                    if (answer.mode !== "none" && answer.mode !== "other") {
                      const decision = decisions.find(
                        (item) => item.questionId === questionId,
                      );
                      if (decision !== undefined) {
                        void onClarify([
                          clarificationAnswerPayload(
                            decision,
                            answer,
                            profileVersion,
                          ),
                        ]);
                      }
                    }
                    return { ...current, [questionId]: answer };
                  })
                }
              />
              {decisions.length === 0 && (
                <div className="empty-decision-state">
                  <p className="t-label ink-tertiary">Decisions</p>
                  <h2 className="t-title-l">Nothing you need to decide</h2>
                  <p className="t-body-m ink-secondary">
                    I can make the remaining professional choices from the direction you approved.
                  </p>
                </div>
              )}
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={() => moveTo(5)}>
                  Continue with Foundry&rsquo;s recommendations
                </button>
                {decisions.length > 0 && (
                  <span className="t-body-s continue-note">
                    {answeredCount === 0
                      ? `All ${decisions.length} left to me — that's a perfectly good answer.`
                      : `${answeredCount} answered · ${decisions.length - answeredCount} left to me`}
                  </span>
                )}
              </div>
            </>
          )}

          {stage === 5 && (
            <section className="act conversation-measure anything-else" aria-label="Anything else?">
              <div className="conversation-heading">
                <p className="t-label ink-tertiary">Open conversation</p>
                <h2 className="t-title-l">Anything else?</h2>
                <p className="t-body-m ink-secondary">
                  Use the conversation beside this plan to add a workflow, role,
                  rule, integration, limitation, acceptance expectation, or any
                  other instruction. I&rsquo;ll revise the proposal after every message.
                </p>
              </div>
              {(proposal.observations.length > 0 ||
                proposal.reasoning.value.length > 0 ||
                proposal.exclusions.value.length > 0) && (
                <details className="conversation-details rationale-details">
                  <summary className="t-body-m">Why I recommend this</summary>
                  {proposal.observations.length > 0 && (
                    <div>
                      <h3 className="t-title-s">What I noticed</h3>
                      <ul className="detail-list">
                        {proposal.observations.map((item) => (
                          <li key={item.id}>{item.observation.value}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {proposal.reasoning.value.length > 0 && (
                    <div>
                      <h3 className="t-title-s">The calls I made</h3>
                      <ul className="detail-list">
                        {proposal.reasoning.value.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                  {proposal.exclusions.value.length > 0 && (
                    <div>
                      <h3 className="t-title-s">What I left out for now</h3>
                      <ul className="detail-list">
                        {proposal.exclusions.value.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </details>
              )}
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={() => moveTo(6)}>
                  Review the plan
                </button>
              </div>
            </section>
          )}

          {stage === 6 && (
            <section className="act confirm-band conversation-measure">
              <p className="t-label ink-tertiary">Final review</p>
              <h2 className="t-title-l">Ready when you are</h2>
              <p className="t-body-m lead">
                {understanding.summary.value}
              </p>
              <dl className="discovery-review-summary">
                <div>
                  <dt>Design</dt>
                  <dd>{designChoice.value?.trim() || proposal.designDirection.recommendedStyle.value}</dd>
                </div>
                <div>
                  <dt>Your instructions</dt>
                  <dd>{conversation.messages.length}</dd>
                </div>
                <div>
                  <dt>Decisions</dt>
                  <dd>{answeredCount} yours &middot; {decisions.length - answeredCount} delegated</dd>
                </div>
                <div>
                  <dt>Additional ideas</dt>
                  <dd>{selectedRecommendations.length}</dd>
                </div>
              </dl>
              <p className="t-body-s ink-secondary">
                You can leave everything unchanged. Foundry will use the recommended
                choices, record every assumption, and let you revise the Decision Brief
                before execution.
              </p>
              <div className="continue-row">
                <button
                  className="btn btn-primary btn-large"
                  disabled={interactionBusy}
                  onClick={() => void submit()}
                >
                  {interactionBusy ? "Updating the plan\u2026" : "Continue to the Decision Brief"}
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Add another instruction
                </button>
              </div>
            </section>
          )}

          {stage > 0 && (
            <button className="stage-back btn-quiet small" onClick={() => moveTo(stage - 1)}>
              Back to {stages[stage - 1].short}
            </button>
          )}
        </main>

        <CustomerInputComposer
          busy={interactionBusy}
          conversation={conversation}
          profileVersion={profileVersion}
          proposal={proposal}
          onSubmit={submitCustomerInput}
        />
      </div>
    </section>
  );
}
