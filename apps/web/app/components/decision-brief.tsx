"use client";

import { useRef, useState } from "react";

import type {
  ClarificationDecision,
  CustomerFollowUpAnswer,
  DecisionBrief as DecisionBriefModel,
  ProductBlueprint,
} from "../../experience/contracts";

type ClarifyAnswer = CustomerFollowUpAnswer;

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

function DecisionEditor({
  busy,
  decision,
  onCancel,
  onSave,
}: Readonly<{
  busy: boolean;
  decision: ClarificationDecision;
  onCancel: () => void;
  onSave: (answer: string) => Promise<void>;
}>) {
  const currentAnswer = decision.answer?.value ?? "";
  const initialChoice = decision.choices.value.includes(currentAnswer)
    ? currentAnswer
    : currentAnswer.startsWith("Left to Foundry")
      ? decision.recommendation.value
      : "";
  const [selected, setSelected] = useState(initialChoice);
  const [other, setOther] = useState(
    initialChoice === "" ? currentAnswer : "",
  );
  const [otherSelected, setOtherSelected] = useState(
    initialChoice === "" && currentAnswer !== "",
  );
  const answer = selected || (otherSelected ? other.trim() : "");

  return (
    <div className="brief-decision-editor">
      <p className="t-body-s ink-secondary">{decision.prompt.value}</p>
      <div className="brief-choice-list">
        {decision.choices.value.map((choice) => (
          <label className="brief-choice t-body-s" key={choice}>
            <input
              type="radio"
              name={`decision-${decision.questionId}`}
              checked={selected === choice}
              onChange={() => {
                setSelected(choice);
                setOther("");
                setOtherSelected(false);
              }}
            />
            <span>{choice}</span>
          </label>
        ))}
      </div>
      <label className="brief-choice t-body-s">
        <input
          type="radio"
          name={`decision-${decision.questionId}`}
          checked={otherSelected}
          onChange={() => {
            setOtherSelected(true);
            setSelected("");
          }}
        />
        <span>Something else</span>
      </label>
      {otherSelected && (
        <textarea
          className="plain-textarea"
          id={`decision-other-${decision.questionId}`}
          aria-label="Describe another choice"
          rows={2}
          value={other}
          onChange={(event) => setOther(event.target.value)}
        />
      )}
      <div className="brief-inline-actions">
        <button
          className="btn btn-secondary btn-compact"
          disabled={busy || answer === ""}
          onClick={() => void onSave(answer)}
          type="button"
        >
          Update the plan
        </button>
        <button
          className="btn-quiet small"
          disabled={busy}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DecisionBrief({
  brief,
  blueprint,
  busy,
  missionRunning,
  onClarify,
  profileVersion,
  onStart,
}: Readonly<{
  brief: DecisionBriefModel;
  blueprint: ProductBlueprint | null;
  busy: boolean;
  missionRunning: boolean;
  onClarify: (answers: ClarifyAnswer[]) => Promise<boolean>;
  profileVersion: number;
  onStart: () => Promise<boolean>;
}>) {
  const decisionsRef = useRef<HTMLDivElement>(null);
  const assumptionsRef = useRef<HTMLDivElement>(null);
  const [editingDecision, setEditingDecision] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [assumptionOpen, setAssumptionOpen] = useState(false);
  const [assumption, setAssumption] = useState("");
  const [showAllChecks, setShowAllChecks] = useState(false);
  const [departing, setDeparting] = useState(false);
  const checks = brief.verificationObligations.value;
  const visibleChecks = showAllChecks ? checks : checks.slice(0, 4);
  const working = busy || missionRunning || departing;
  const technical = brief.technicalShape;
  const framework = technical.frameworkVersion.value
    ? `${technical.framework.value} ${technical.frameworkVersion.value}`
    : technical.framework.value;
  const productShape = blueprint === null
    ? ""
    : blueprint.selectedSubtypes
        .filter((subtype) => !["web-application", "website"].includes(subtype.toLowerCase()))
        .join(" + ") || blueprint.productName;

  function changeSomething() {
    if (brief.decisions.length > 0) {
      const first = brief.decisions[0];
      setEditingDecision(first.questionId);
      window.requestAnimationFrame(() => {
        decisionsRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
      return;
    }
    setAssumptionOpen(true);
    window.requestAnimationFrame(() => {
      assumptionsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }

  async function beginBuilding() {
    setDeparting(true);
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    if (blueprint !== null) {
      const approved = await onClarify([{
        questionId: `product-blueprint-approval-v${blueprint.blueprintVersion}`,
        answer: `Approve Product Blueprint v${blueprint.blueprintVersion} with integrity hash ${blueprint.integrityHash}.`,
        selection: {
          kind: "blueprint-approval",
          subjectId: "product-blueprint",
          mode: "confirm",
          optionId: `blueprint-v${blueprint.blueprintVersion}`,
          value: blueprint.integrityHash,
          reason: "The customer approved the complete versioned Product Blueprint shown before execution.",
          classification: "blueprint approval",
          sourceProfileVersion: blueprint.blueprintVersion,
        },
      }]);
      if (!approved) {
        setDeparting(false);
        return;
      }
    }
    const accepted = await onStart();
    if (!accepted) setDeparting(false);
  }

  return (
    <section
      className={`act decision-brief${departing ? " is-departing" : ""}`}
      aria-busy={working}
    >
      <div className="measure">
        <span className="voice-mark" aria-hidden="true" />
        <p className="t-label voice-label">Before I start</p>
        <h1 className="t-display-l">The plan</h1>
        <p className="t-body-l lead">
          This is what I&rsquo;ll build and what I&rsquo;ll prove before I call
          it done.
        </p>
      </div>

      <dl className="decision-brief-fields">
        {blueprint !== null && (
          <div className="field-row blueprint-identity">
            <dt>Approved product shape</dt>
            <dd>
              <p className="t-body-m">
                <strong>{productShape}</strong>
                {" — "}{blueprint.oneSentenceOutcome}
              </p>
              <p className="t-caption ink-tertiary">
                Blueprint v{blueprint.blueprintVersion} · {blueprint.integrityHash.slice(0, 12)}
              </p>
            </dd>
          </div>
        )}
        <div className="field-row">
          <dt>What I&rsquo;ll build</dt>
          <dd className="t-body-m">
            <strong>{brief.projectName.value}</strong> &mdash;{" "}
            {brief.whatWillBeBuilt.value}
          </dd>
        </div>
        {blueprint !== null && (
          <>
            <div className="field-row">
              <dt>Product structure</dt>
              <dd>
                <p className="t-body-s ink-secondary">Required surfaces</p>
                <ul className="bullets t-body-m stack-list">
                  {blueprint.requiredSurfaces.map((surface) => <li key={surface}>{surface}</li>)}
                </ul>
                <p className="t-body-s ink-secondary">
                  {blueprint.navigationApproach} · {blueprint.contentStructure}
                </p>
              </dd>
            </div>
            <div className="field-row">
              <dt>Operational needs</dt>
              <dd>
                <p className="t-body-m">Data: {blueprint.dataAndPersistenceNeeds.join(", ")}</p>
                <p className="t-body-s ink-secondary">
                  Security: {blueprint.securityConsiderations.join(" · ")}
                </p>
                <p className="t-body-s ink-secondary">
                  Responsive: {blueprint.responsivePriorities}
                </p>
              </dd>
            </div>
            {blueprint.recommendedLater.length > 0 && (
              <div className="field-row">
                <dt>Recommended later</dt>
                <dd>
                  <ul className="bullets t-body-m stack-list">
                    {blueprint.recommendedLater.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </dd>
              </div>
            )}
          </>
        )}
        <div className="field-row">
          <dt>Who it&rsquo;s for</dt>
          <dd className="t-body-m">
            <div className="inline-list">
              {brief.audiences.value.map((actor) => (
                <span key={actor}>{actor}</span>
              ))}
            </div>
          </dd>
        </div>
        <div className="field-row">
          <dt>How people will use it</dt>
          <dd>
            <ol className="numbered t-body-m stack-list">
              {brief.journeys.map((journey) => (
                <li key={journey.id}>{journey.description.value}</li>
              ))}
            </ol>
          </dd>
        </div>
        <div className="field-row">
          <dt>Design direction</dt>
          <dd>
            <p className="t-body-m">
              <strong>
                {brief.designDirection.recommendedStyle.value}
              </strong>
              {" — "}
              {brief.designDirection.reason.value}
            </p>
            <p className="t-body-s ink-secondary">
              {brief.designDirection.layoutApproach.value}{" · "}
              {brief.designDirection.tone.value}{" · "}
              {brief.designDirection.mobilePriority.value}
            </p>
          </dd>
        </div>
        <div className="field-row">
          <dt>How it&rsquo;s put together</dt>
          <dd>
            <p className="t-body-m">{brief.structure.value}</p>
            <details className="technical-shape">
              <summary className="t-label">
                <Chevron />
                Technical shape
              </summary>
              <p className="t-body-s ink-secondary">
                {framework} &middot; {technical.language.value} &middot;{" "}
                {technical.database.value} &middot;{" "}
                {technical.packageManager.value} &middot;{" "}
                {technical.browserTesting.value} for browser testing. I chose
                this because it&rsquo;s the one setup I&rsquo;ve certified end
                to end: I can generate it, build it, run it, test it, and watch
                it work.
              </p>
              <p className="t-caption ink-tertiary">
                Certified shape: {technical.stackId.value}@
                {technical.stackVersion.value}
              </p>
              <ul className="bullets t-body-s ink-tertiary stack-list">
                {technical.knownLimitations.value.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </details>
          </dd>
        </div>
        {brief.foundryChoices.value.length > 0 && (
          <div className="field-row">
            <dt>Choices Foundry made</dt>
            <dd>
              <ul className="bullets t-body-m stack-list">
                {brief.foundryChoices.value.map((choice) => (
                  <li key={choice}>{choice}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {brief.explicitExclusions.value.length > 0 && (
          <div className="field-row">
            <dt>What I will not include</dt>
            <dd>
              <ul className="bullets t-body-m stack-list">
                {brief.explicitExclusions.value.map((exclusion) => (
                  <li key={exclusion}>{exclusion}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {brief.decisions.length > 0 && (
          <div className="field-row" ref={decisionsRef}>
            <dt>Your decisions</dt>
            <dd className="brief-decision-list">
              {brief.decisions.map((decision) => (
                <div className="brief-decision" key={decision.questionId}>
                  <div>
                    <p className="t-body-s ink-tertiary">
                      {decision.prompt.value}
                    </p>
                    <p className="t-body-m">{decision.answer?.value}</p>
                  </div>
                  <button
                    className="btn-quiet small"
                    disabled={working}
                    onClick={() =>
                      setEditingDecision((current) =>
                        current === decision.questionId
                          ? null
                          : decision.questionId,
                      )
                    }
                    type="button"
                  >
                    Change
                  </button>
                  {editingDecision === decision.questionId && (
                    <DecisionEditor
                      busy={working}
                      decision={decision}
                      onCancel={() => setEditingDecision(null)}
                      onSave={async (answer) => {
                        const optionIndex = decision.choices.value.indexOf(answer);
                        await onClarify([
                          {
                            questionId: decision.questionId,
                            answer,
                            selection: {
                              kind: "decision",
                              subjectId: decision.questionId,
                              mode:
                                optionIndex < 0
                                  ? "other"
                                  : answer === decision.recommendation.value
                                    ? "accept-recommendation"
                                    : "select-option",
                              optionId:
                                optionIndex < 0
                                  ? null
                                  : `${decision.questionId}-option-${optionIndex + 1}`,
                              value: answer,
                              reason:
                                decision.consequences.value[optionIndex] ??
                                decision.reason.value,
                              classification: "project decision",
                              sourceProfileVersion: profileVersion,
                            },
                          },
                        ]);
                        setEditingDecision(null);
                      }}
                    />
                  )}
                </div>
              ))}
            </dd>
          </div>
        )}
        {brief.selectedEnhancements.length > 0 && (
          <div className="field-row">
            <dt>Ideas you added</dt>
            <dd className="brief-idea-list">
              {brief.selectedEnhancements.map((enhancement) => (
                <div className="brief-idea" key={enhancement.id}>
                  <div>
                    <p className="t-body-m">{enhancement.title.value}</p>
                    <p className="t-body-s ink-secondary">
                      {enhancement.reason.value}
                    </p>
                  </div>
                  <button
                    className="btn-quiet small"
                    disabled={working}
                    onClick={() =>
                      void onClarify([
                        {
                          questionId: enhancement.id,
                          answer: `Remove this project idea: ${enhancement.title.value}. It should no longer be included.`,
                          selection: {
                            kind: "recommendation",
                            subjectId: enhancement.id,
                            mode: "exclude",
                            optionId: enhancement.id,
                            value: enhancement.title.value,
                            reason: enhancement.reason.value,
                            classification: "feature recommendation",
                            sourceProfileVersion: profileVersion,
                          },
                        },
                      ])
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </dd>
          </div>
        )}
        {brief.assumptions.value.length > 0 && (
          <div className="field-row" ref={assumptionsRef}>
            <dt>What I&rsquo;m assuming</dt>
            <dd>
              <ul className="bullets t-body-m stack-list">
                {brief.assumptions.value.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button
                className="btn-quiet small brief-row-action"
                onClick={() => setAssumptionOpen((value) => !value)}
                type="button"
              >
                Change an assumption
              </button>
              {assumptionOpen && (
                <div className="brief-inline-form">
                  <label
                    htmlFor="assumption"
                    className="t-body-s ink-secondary"
                  >
                    What should I understand differently?
                  </label>
                  <textarea
                    id="assumption"
                    className="plain-textarea"
                    suppressHydrationWarning
                    rows={3}
                    value={assumption}
                    onChange={(event) => setAssumption(event.target.value)}
                  />
                  <button
                    className="btn btn-secondary btn-compact"
                    disabled={working || !assumption.trim()}
                    onClick={async () => {
                      await onClarify([
                        {
                          questionId: "customer-assumption-change",
                          answer: assumption.trim(),
                          selection: {
                            kind: "customer-message",
                            subjectId: "customer-assumption-change",
                            mode: "message",
                            optionId: null,
                            value: assumption.trim(),
                            reason: "The customer corrected a plan assumption.",
                            classification: "assumption correction",
                            sourceProfileVersion: profileVersion,
                          },
                        },
                      ]);
                      setAssumption("");
                      setAssumptionOpen(false);
                    }}
                    type="button"
                  >
                    Update the plan
                  </button>
                </div>
              )}
            </dd>
          </div>
        )}
        <div className="field-row">
          <dt>What I&rsquo;ll prove</dt>
          <dd>
            <p className="t-body-m">{checks.length} things, including:</p>
            <ul className="proved t-body-m stack-list brief-checks">
              {visibleChecks.map((check) => (
                <li key={check}>{check}</li>
              ))}
            </ul>
            {checks.length > 4 && !showAllChecks && (
              <button
                className="btn-quiet small brief-row-action"
                onClick={() => setShowAllChecks(true)}
                type="button"
              >
                Show all {checks.length}
              </button>
            )}
          </dd>
        </div>
      </dl>

      <div className="continue-row">
        <button
          className="btn btn-primary"
          disabled={working}
          onClick={() => void beginBuilding()}
          type="button"
        >
          {working ? "Starting\u2026" : "Approve blueprint · Start building"}
        </button>
        <button
          className="btn-quiet small"
          disabled={working}
          onClick={changeSomething}
          type="button"
        >
          Change something
        </button>
        <button
          className="btn-quiet small"
          disabled={working}
          onClick={() => setNoteOpen((value) => !value)}
          type="button"
        >
          Add a note
        </button>
        <button
          className="btn-quiet small"
          disabled={working}
          onClick={() =>
            void onClarify([
              {
                questionId: "customer-reconsider",
                answer:
                  "Reconsider the plan and tell me if you'd do it differently.",
                selection: {
                  kind: "customer-message",
                  subjectId: "customer-reconsider",
                  mode: "message",
                  optionId: null,
                  value: "Reconsider the plan and tell me if you'd do it differently.",
                  reason: "The customer asked Foundry to reconsider its recommendation.",
                  classification: "plan reconsideration",
                  sourceProfileVersion: profileVersion,
                },
              },
            ])
          }
          type="button"
        >
          Reconsider this
        </button>
      </div>

      {noteOpen && (
        <div className="brief-note">
          <label htmlFor="plan-note" className="t-body-s ink-secondary">
            Anything else I should know?
          </label>
          <textarea
            id="plan-note"
            className="plain-textarea"
            suppressHydrationWarning
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            className="btn btn-secondary btn-compact"
            disabled={working || !note.trim()}
            onClick={async () => {
              await onClarify([
                {
                  questionId: "customer-note",
                  answer: note.trim(),
                  selection: {
                    kind: "customer-message",
                    subjectId: "customer-note",
                    mode: "message",
                    optionId: null,
                    value: note.trim(),
                    reason: "The customer added a final plan instruction.",
                    classification: "plan instruction",
                    sourceProfileVersion: profileVersion,
                  },
                },
              ]);
              setNote("");
              setNoteOpen(false);
            }}
            type="button"
          >
            Add it to the plan
          </button>
        </div>
      )}
    </section>
  );
}
