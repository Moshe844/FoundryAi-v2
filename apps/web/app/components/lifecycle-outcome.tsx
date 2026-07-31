import type {
  LifecycleOutcome as LifecycleOutcomeModel,
  Mission,
} from "../../experience/contracts";
import { EngineeringDetails } from "./engineering-details";

function ProofList({
  outcome,
}: {
  outcome: LifecycleOutcomeModel;
}) {
  if (outcome.provedOutcomes.length === 0) {
    return <p className="t-body-m">Nothing had been proved yet.</p>;
  }
  return (
    <>
      <p className="t-body-m">
        <span className="count-strong">
          {outcome.provedCount.value} of {outcome.totalCount.value}
        </span>{" "}
        promises held before work stopped.
      </p>
      <ul className="proved stack-list">
        {outcome.provedOutcomes.map((proof) => (
          <li key={proof.obligationId} className="t-body-m">
            {proof.statement.value}
          </li>
        ))}
      </ul>
    </>
  );
}

export function LifecycleOutcome({
  mission,
  outcome,
  onBack,
  onStartSomethingNew,
}: {
  mission: Mission;
  outcome: LifecycleOutcomeModel;
  onBack: () => void;
  onStartSomethingNew: () => void;
}) {
  const cancelled = outcome.kind.value === "cancelled";
  if (cancelled) {
    return (
      <section className="act lifecycle-workspace lifecycle-cancelled">
        <article className="lifecycle-card">
          <p className="t-micro eyebrow">
            {outcome.projectName.value}
          </p>
          <h1 className="t-display-l" aria-live="polite">
            {outcome.headline.value}
          </h1>
          <dl className="lifecycle-details">
            <div className="field-row">
              <dt>What I finished</dt>
              <dd>
                {outcome.completedPhases.value.length === 0 ? (
                  <p className="t-body-m">
                    The build stopped before a phase was completed.
                  </p>
                ) : (
                  <ul className="proved stack-list">
                    {outcome.completedPhases.value.map((phase) => (
                      <li key={phase} className="t-body-m">
                        {phase}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            <div className="field-row">
              <dt>What I proved</dt>
              <dd>
                <ProofList outcome={outcome} />
              </dd>
            </div>
            <div className="field-row">
              <dt>The plan is saved</dt>
              <dd className="t-body-m">
                {outcome.planSaved.value
                  ? "Every recorded decision and assumption is still here."
                  : "The original request remains in the mission record."}
              </dd>
            </div>
          </dl>
          <div className="lifecycle-actions">
            <button className="btn btn-primary" onClick={onStartSomethingNew}>
              Start something new
            </button>
            <button className="btn btn-secondary" onClick={onBack}>
              Back to your projects
            </button>
          </div>
          <EngineeringDetails mission={mission} />
        </article>
      </section>
    );
  }

  return (
    <section
      className={`act lifecycle-workspace lifecycle-${outcome.kind.value}`}
    >
      <article className="lifecycle-card">
        <p className="t-micro eyebrow">
          {outcome.projectName.value}
        </p>
        <h1 className="t-display-l" aria-live="assertive">
          {outcome.headline.value}
        </h1>
        <dl className="lifecycle-details">
          <div className="field-row">
            <dt>What I was doing</dt>
            <dd className="t-body-m">{outcome.whatWasHappening.value}</dd>
          </div>
          <div className="field-row">
            <dt>What happened</dt>
            <dd className="t-body-m">{outcome.whatHappened.value}</dd>
          </div>
          <div className="field-row">
            <dt>What I did prove</dt>
            <dd>
              <ProofList outcome={outcome} />
            </dd>
          </div>
          <div className="field-row">
            <dt>What I couldn’t prove</dt>
            <dd>
              {outcome.unprovedOutcomes.length === 0 ? (
                <p className="t-body-m">
                  No contract promise had reached verification yet.
                </p>
              ) : (
                <ul className="unproved stack-list">
                  {outcome.unprovedOutcomes.map((unproved) => (
                    <li key={unproved.obligationId} className="t-body-m">
                      <strong>{unproved.statement.value}</strong>
                      {unproved.detail.value === null
                        ? ""
                        : ` — ${unproved.detail.value}`}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div className="field-row">
            <dt>What I’d try next</dt>
            <dd className="t-body-m">{outcome.whatToTryNext.value}</dd>
          </div>
          <div className="field-row">
            <dt>What I need from you</dt>
            <dd className="t-body-m">{outcome.whatINeed.value}</dd>
          </div>
        </dl>
        <div className="lifecycle-actions">
          <button className="btn btn-primary" onClick={onStartSomethingNew}>
            Start a revised project
          </button>
          <button className="btn btn-secondary" onClick={onBack}>
            Back to your projects
          </button>
        </div>
        <EngineeringDetails mission={mission} />
      </article>
    </section>
  );
}
