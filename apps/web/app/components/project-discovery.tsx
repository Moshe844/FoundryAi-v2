"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

type StageId =
  | "read"
  | "direction"
  | "design"
  | "ideas"
  | "decisions"
  | "conversation"
  | "review";

type DiscoveryStage = Readonly<{
  id: StageId;
  short: string;
  title: string;
}>;

function buildStages(
  understanding: ProjectUnderstandingModel,
  decisions: readonly ClarificationDecision[],
): DiscoveryStage[] {
  const proposal = understanding.proposal;
  const stages: DiscoveryStage[] = [
    { id: "read", short: "Understanding", title: "What I understood" },
  ];

  if (
    proposal.observations.length > 0 ||
    understanding.journeys.length > 0 ||
    proposal.reasoning.value.length > 0
  ) {
    stages.push({
      id: "direction",
      short: "Product direction",
      title: "What I recommend building",
    });
  }

  if (
    proposal.alternatives.length > 0 ||
    proposal.designDirection.recommendedStyle.value.trim().length > 0
  ) {
    stages.push({
      id: "design",
      short: "Visual direction",
      title: "How it should feel",
    });
  }

  if (proposal.recommendations.length > 0) {
    stages.push({
      id: "ideas",
      short: "Useful ideas",
      title: "Ideas worth considering",
    });
  }

  if (decisions.length > 0) {
    stages.push({
      id: "decisions",
      short: "Important choices",
      title: "Choices that change the result",
    });
  }

  stages.push(
    { id: "conversation", short: "Your input", title: "Anything else?" },
    { id: "review", short: "Review", title: "Ready for the plan" },
  );

  return stages;
}

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
  const stages = useMemo(
    () => buildStages(understanding, decisions),
    [understanding, decisions],
  );
  const [stageId, setStageId] = useState<StageId>("read");
  const [furthestStageIndex, setFurthestStageIndex] = useState(0);
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
  const currentStageIndex = Math.max(
    0,
    stages.findIndex((item) => item.id === stageId),
  );
  const currentStage = stages[currentStageIndex];

  useEffect(() => {
    if (!stages.some((item) => item.id === stageId)) {
      setStageId(stages[0].id);
      setFurthestStageIndex(0);
    }
  }, [stageId, stages]);

  useEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
  }, [stageId]);

  function moveToIndex(next: number, allowFuture = false) {
    const bounded = Math.max(0, Math.min(stages.length - 1, next));
    if (!allowFuture && bounded > furthestStageIndex) return;
    setStageId(stages[bounded].id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function advance() {
    const next = Math.min(stages.length - 1, currentStageIndex + 1);
    setFurthestStageIndex((current) => Math.max(current, next));
    setStageId(stages[next].id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function inviteInput() {
    document
      .querySelector<HTMLTextAreaElement>("#customer-conversation-message")
      ?.focus();
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
          ? `Customer-approved custom design direction: ${value}.`
          : `Customer-approved design direction: ${value}.`,
      selection: {
        kind: "design-direction",
        subjectId: "design-direction",
        mode,
        optionId: selectedDirection?.id ?? null,
        value,
        reason:
          selectedDirection?.whyItFits.value ??
          proposal.designDirection.reason.value,
        classification: "design preference",
        sourceProfileVersion: profileVersion,
      },
    };
  }

  async function continueFromDesign() {
    if (designChoice.mode === "other" && !designChoice.value?.trim()) return;
    if (await onClarify([designFollowUp()])) advance();
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

  return (
    <section
      className="discovery-session"
      aria-label="Project discovery working session"
    >
      <header className="discovery-progress">
        <div>
          <p className="t-label ink-tertiary">Working session</p>
          <p className="t-body-s ink-secondary">
            {currentStage.title} &middot; {currentStageIndex + 1} of{" "}
            {stages.length}
          </p>
        </div>
        <nav aria-label="Discovery progress">
          <ol>
            {stages.map((item, index) => {
              const available = index <= furthestStageIndex;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={stageId === item.id ? "step" : undefined}
                    aria-label={`${item.short}${available ? "" : " — available after the previous step"}`}
                    disabled={!available}
                    onClick={() => moveToIndex(index)}
                  >
                    <span>{index + 1}</span>
                    <em>{item.short}</em>
                  </button>
                </li>
              );
            })}
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

          {stageId === "read" && (
            <>
              <ProjectUnderstanding understanding={understanding} />
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={advance}>
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

          {stageId === "direction" && (
            <>
              <FoundryObservations observations={proposal.observations} />
              <FoundryProposal
                audiences={understanding.audiences.value}
                journeys={understanding.journeys}
                proposal={proposal}
              />
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={advance}>
                  Use this product direction
                </button>
                <button className="btn btn-secondary" onClick={inviteInput}>
                  Change something
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Ask Foundry to revise it
                </button>
              </div>
            </>
          )}

          {stageId === "design" && (
            <>
              <DesignDirection
                alternatives={proposal.alternatives}
                choice={designChoice}
                direction={proposal.designDirection}
                onChange={setDesignChoice}
              />
              <div className="stage-actions">
                <button
                  className="btn btn-primary"
                  disabled={
                    interactionBusy ||
                    (designChoice.mode === "other" &&
                      !designChoice.value?.trim())
                  }
                  onClick={() => void continueFromDesign()}
                >
                  {interactionBusy
                    ? "Saving the design…"
                    : designChoice.mode === "other"
                      ? "Use my custom direction"
                      : designChoice.mode === "alternative"
                        ? "Use selected direction"
                        : "Use Foundry’s recommendation"}
                </button>
                {designChoice.mode !== "other" && (
                  <button className="btn-quiet" onClick={inviteInput}>
                    Add a design note
                  </button>
                )}
              </div>
            </>
          )}

          {stageId === "ideas" && (
            <>
              <FoundryRecommendations
                recommendations={proposal.recommendations.slice(0, 5)}
                selected={effectiveSelected}
                onToggle={(id) => void toggleRecommendation(id)}
              />
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={advance}>
                  Keep these choices
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Add my own idea
                </button>
              </div>
            </>
          )}

          {stageId === "decisions" && (
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
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={advance}>
                  Continue with Foundry&rsquo;s recommendations
                </button>
                <span className="t-body-s continue-note">
                  {answeredCount === 0
                    ? `You can leave all ${decisions.length} to Foundry.`
                    : `${answeredCount} answered · ${decisions.length - answeredCount} left to Foundry`}
                </span>
              </div>
            </>
          )}

          {stageId === "conversation" && (
            <section
              className="act conversation-measure anything-else"
              aria-label="Anything else?"
            >
              <div className="conversation-heading">
                <p className="t-label ink-tertiary">Open conversation</p>
                <h2 className="t-title-l">Anything else Foundry should know?</h2>
                <p className="t-body-m ink-secondary">
                  Write naturally. Add a workflow, design preference, role,
                  business rule, limitation, integration, or anything else.
                  Foundry will classify it and revise only the affected parts of
                  the proposal.
                </p>
              </div>
              {(proposal.observations.length > 0 ||
                proposal.reasoning.value.length > 0 ||
                proposal.exclusions.value.length > 0) && (
                <details className="conversation-details rationale-details">
                  <summary className="t-body-m">
                    Why Foundry recommends this
                  </summary>
                  {proposal.observations.length > 0 && (
                    <div>
                      <h3 className="t-title-s">What Foundry noticed</h3>
                      <ul className="detail-list">
                        {proposal.observations.map((item) => (
                          <li key={item.id}>{item.observation.value}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {proposal.reasoning.value.length > 0 && (
                    <div>
                      <h3 className="t-title-s">The decisions Foundry made</h3>
                      <ul className="detail-list">
                        {proposal.reasoning.value.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {proposal.exclusions.value.length > 0 && (
                    <div>
                      <h3 className="t-title-s">What is intentionally left out</h3>
                      <ul className="detail-list">
                        {proposal.exclusions.value.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </details>
              )}
              <div className="stage-actions">
                <button className="btn btn-primary" onClick={advance}>
                  Review the plan
                </button>
              </div>
            </section>
          )}

          {stageId === "review" && (
            <section className="act confirm-band conversation-measure">
              <p className="t-label ink-tertiary">Final review</p>
              <h2 className="t-title-l">Ready when you are</h2>
              <p className="t-body-m lead">{understanding.summary.value}</p>
              <dl className="discovery-review-summary">
                <div>
                  <dt>Design</dt>
                  <dd>
                    {designChoice.value?.trim() ||
                      proposal.designDirection.recommendedStyle.value}
                  </dd>
                </div>
                <div>
                  <dt>Your instructions</dt>
                  <dd>{conversation.messages.length}</dd>
                </div>
                <div>
                  <dt>Decisions</dt>
                  <dd>
                    {answeredCount} yours &middot;{" "}
                    {decisions.length - answeredCount} delegated
                  </dd>
                </div>
                <div>
                  <dt>Additional ideas</dt>
                  <dd>{selectedRecommendations.length}</dd>
                </div>
              </dl>
              <p className="t-body-s ink-secondary">
                Leaving an item unchanged means Foundry will use its current
                recommendation and record that decision in the plan before
                execution.
              </p>
              <div className="continue-row">
                <button
                  className="btn btn-primary btn-large"
                  disabled={interactionBusy}
                  onClick={() => void submit()}
                >
                  {interactionBusy
                    ? "Updating the plan…"
                    : "Continue to the Decision Brief"}
                </button>
                <button className="btn-quiet" onClick={inviteInput}>
                  Add another instruction
                </button>
              </div>
            </section>
          )}

          {currentStageIndex > 0 && (
            <button
              className="stage-back btn-quiet small"
              onClick={() => moveToIndex(currentStageIndex - 1)}
            >
              Back to {stages[currentStageIndex - 1].short}
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
