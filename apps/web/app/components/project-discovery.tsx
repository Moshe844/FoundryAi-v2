"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ClarificationDecision,
  CustomerFollowUpAnswer,
  DiscoveryConversation,
  LiveConceptStudio,
  ProjectUnderstanding as ProjectUnderstandingModel,
} from "../../experience/contracts";
import {
  buildApprovedDesignContract,
  type ApprovedPrototypeContract,
  type StructuredCustomerFollowUpAnswer,
} from "../../experience/design-contract";
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

const API = "http://127.0.0.1:3927";

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
      title: "Complete visual concepts",
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
  missionId,
  conceptStudio,
  onClarify,
  initialStage,
  onStageChange,
  profileVersion,
  understanding,
}: Readonly<{
  busy: boolean;
  conversation: DiscoveryConversation;
  decisions: readonly ClarificationDecision[];
  missionRunning: boolean;
  missionId: string;
  conceptStudio: LiveConceptStudio | null;
  onClarify: (answers: CustomerFollowUpAnswer[]) => Promise<boolean>;
  initialStage?: string | null;
  onStageChange?: (stage: string) => void;
  profileVersion: number;
  understanding: ProjectUnderstandingModel;
}>) {
  const stages = useMemo(
    () => buildStages(understanding, decisions),
    [understanding, decisions],
  );
  const initialStageIndex = Math.max(
    0,
    stages.findIndex((item) => item.id === initialStage),
  );
  const [requestedStageId, setStageId] = useState<StageId>(
    stages[initialStageIndex]?.id ?? "read",
  );
  const [furthestStageIndex, setFurthestStageIndex] = useState(initialStageIndex);
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
  const [approvedPrototype, setApprovedPrototype] = useState<ApprovedPrototypeContract | null>(null);
  const [designSubmissionError, setDesignSubmissionError] = useState<string | null>(null);
  const [customerInputPending, setCustomerInputPending] = useState(false);
  const hasPendingInstructions = conversation.messages.some(
    (message) => message.status === "pending",
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const proposal = understanding.proposal;
  const interactionBusy = busy || missionRunning;
  // The studio admits a session once it can offer a choice, which is two
  // proven directions. Requiring three here left a READY studio showing its
  // concepts with the button still reading "Building live concepts…", so the
  // customer could select a direction and had no way to continue.
  const conceptStudioReady =
    conceptStudio?.status === "READY" &&
    conceptStudio.concepts.filter(
      (concept) => concept.verificationStatus === "PASSED",
    ).length >= 2;
  const effectiveSelected = Object.fromEntries(
    proposal.recommendations.map((recommendation) => [
      recommendation.id,
      selected[recommendation.id] ??
        recommendation.selectedByDefault.value === true,
    ]),
  );
  const selectedRecommendations = proposal.recommendations.filter(
    (recommendation) => effectiveSelected[recommendation.id],
  );
  const answeredCount = decisions.filter((decision) =>
    answerIsExplicit(answers[decision.questionId]),
  ).length;
  const stageId = stages.some((item) => item.id === requestedStageId)
    ? requestedStageId
    : stages[0].id;
  const currentStageIndex = Math.max(
    0,
    stages.findIndex((item) => item.id === stageId),
  );
  const currentStage = stages[currentStageIndex];
  const stage = currentStageIndex;

  useEffect(() => {
    stageRef.current?.focus({ preventScroll: true });
    onStageChange?.(stageId);
  }, [onStageChange, stageId]);

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
    return onClarify([answer]);
  }

  function designFollowUp(approvedPrototypeContract: ApprovedPrototypeContract | null = approvedPrototype): StructuredCustomerFollowUpAnswer {
    const selectedDirection = proposal.alternatives.find(
      (alternative) =>
        alternative.id === designChoice.optionId ||
        (designChoice.mode === "recommended" && alternative.recommended.value),
    );
    const selectedLiveConcept = conceptStudio?.concepts.find(
      (concept) => concept.contract.conceptId === designChoice.optionId,
    );
    const value =
      designChoice.value?.trim() ||
      selectedLiveConcept?.contract.conceptName ||
      selectedDirection?.name.value ||
      proposal.designDirection.recommendedStyle.value;
    const mode =
      designChoice.mode === "other"
        ? "other"
        : designChoice.mode === "alternative"
          ? "select-option"
          : "accept-recommendation";
    const designContract = buildApprovedDesignContract({
      alternatives: proposal.alternatives,
      direction: proposal.designDirection,
      mode: designChoice.mode,
      optionId: designChoice.optionId,
      customValue: designChoice.value,
      customComposition: designChoice.composition,
      outcome: understanding.summary.value,
      productName: understanding.projectName.value,
      sourceProfileVersion: profileVersion,
      workflows: understanding.journeys.map((journey) => journey.description.value),
      audiences: understanding.audiences.value,
      capabilities: [
        ...proposal.items.value,
        ...proposal.includedDefaults.value,
      ],
      dataConcepts: proposal.items.value,
      approvedPrototypeContract,
    });

    return {
      questionId: "customer-design-direction",
      answer:
        mode === "other"
          ? `Customer-approved custom design direction: ${value}. Preserve the attached structured design contract during generation and verification.`
          : `Customer-approved design direction: ${value}. Preserve the attached structured design contract during generation and verification.`,
      selection: {
        kind: "design-direction",
        subjectId: "design-direction",
        mode,
        optionId: designChoice.optionId ?? selectedDirection?.id ?? null,
        value,
        reason:
          selectedLiveConcept?.contract.designRationale ??
          selectedDirection?.whyItFits.value ??
          proposal.designDirection.reason.value,
        classification: "design preference",
        sourceProfileVersion: profileVersion,
        designContract,
      },
    };
  }

  async function continueFromDesign() {
    // Both of these used to return in silence. A project whose understanding
    // had failed reached this screen with no concepts, and every click did
    // nothing at all -- no message, no movement, nothing to act on.
    if (!conceptStudioReady) {
      setDesignSubmissionError(
        conceptStudio === null
          ? "Foundry has not produced any visual directions for this project yet, so there is nothing to continue with. If this does not resolve, the project understanding behind it did not finish."
          : "Foundry needs two browser-admitted directions before you can continue. It is still proving them.",
      );
      return;
    }
    // A combined direction is valid once traits are selected. Typing is never
    // required, so completeness is read from the structured composition.
    if (designChoice.mode === "other" && designChoice.composition?.complete !== true) {
      setDesignSubmissionError(
        "Choose the traits for your combined direction before continuing.",
      );
      return;
    }
    setDesignSubmissionError(null);
    try {
      const selectedConceptId = designChoice.optionId ?? conceptStudio?.selectedConceptId ?? conceptStudio?.recommendedConceptId;
      if (selectedConceptId === null || selectedConceptId === undefined) {
        throw new Error("Select a browser-admitted concept before continuing.");
      }
      const approvalResponse = await fetch(`${API}/missions/${missionId}/concepts/${selectedConceptId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(30_000),
      });
      const approvalPayload = await approvalResponse.json() as {
        approvedDesignContract?: ApprovedPrototypeContract;
        error?: string;
      };
      if (!approvalResponse.ok || approvalPayload.approvedDesignContract === undefined) {
        throw new Error(approvalPayload.error ?? "Foundry could not freeze the selected prototype evidence.");
      }
      setApprovedPrototype(approvalPayload.approvedDesignContract);
      const accepted = await onClarify([designFollowUp(approvalPayload.approvedDesignContract)]);
      if (accepted) {
        advance();
      } else {
        setDesignSubmissionError(
          "Foundry could not save this visual direction. The concept is still selected; no design decision was lost.",
        );
      }
    } catch (failure) {
      setDesignSubmissionError(
        failure instanceof Error
          ? failure.message
          : "Foundry could not prepare this visual direction for the build.",
      );
    }
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
    setApprovedPrototype(null);
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
            {currentStage.title} &middot; Step {stage + 1} of {stages.length}
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
                choice={designChoice}
                missionId={missionId}
                onChange={(choice) => {
                  setDesignChoice(choice);
                  setApprovedPrototype(null);
                }}
                studio={conceptStudio}
              />
              <div className="stage-actions">
                <button
                  className="btn btn-primary"
                  disabled={
                    interactionBusy ||
                    !conceptStudioReady ||
                    (designChoice.mode === "other" &&
                      designChoice.composition?.complete !== true)
                  }
                  onClick={() => void continueFromDesign()}
                >
                  {interactionBusy
                    ? "Saving the design…"
                    : !conceptStudioReady
                      ? "Building live concepts…"
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
              {designSubmissionError && (
                <div className="banner banner-fault" role="alert">
                  <div className="banner-body">
                    <p className="t-body-s">{designSubmissionError}</p>
                  </div>
                </div>
              )}
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
                <button className="btn btn-primary" disabled={customerInputPending || hasPendingInstructions} onClick={advance}>
                  {customerInputPending
                    ? "Save or clear your instruction first"
                    : hasPendingInstructions
                      ? "Retry the pending instruction first"
                      : "Review the plan"}
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
                      proposal.alternatives.find((item) => item.recommended.value)?.name.value ||
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
                The approved design is now recorded as structured composition,
                navigation, typography, color, mobile, and accessibility rules —
                not only as a design name.
              </p>
              <div className="continue-row">
                <button
                  className="btn btn-primary btn-large"
                  disabled={interactionBusy || hasPendingInstructions}
                  onClick={() => void submit()}
                >
                  {interactionBusy
                    ? "Updating the plan…"
                    : hasPendingInstructions
                      ? "Retry the pending instruction first"
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
          onPendingChange={setCustomerInputPending}
          onSubmit={submitCustomerInput}
        />
      </div>
    </section>
  );
}
