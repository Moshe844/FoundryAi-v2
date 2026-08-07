"use client";

import { useState } from "react";

import type {
  FoundryExperienceModel,
  Mission,
} from "../../experience/contracts";
import { EngineeringDetails } from "./engineering-details";
import { PreviewDock } from "./preview-dock";

const VISIBLE_PROOFS = 5;

export function CompletionHandoff({
  experience,
  mission,
}: {
  experience: FoundryExperienceModel;
  mission: Mission;
}) {
  const completion = experience.completion;
  const needsLaunchContent = completion.launchRequirements.length > 0;
  const [showAllProofs, setShowAllProofs] = useState(false);
  const visibleProofs = showAllProofs
    ? completion.verifiedOutcomes
    : completion.verifiedOutcomes.slice(0, VISIBLE_PROOFS);
  const remaining =
    completion.totalCount.value - completion.provedCount.value;
  // A build can prove every obligation and still not be the page the customer
  // approved. That combination has its own headline, because "0 of 14 promises
  // didn't hold" describes it as well as "complete" does — which is to say, not
  // at all.
  const designShortfall = completion.designShortfall.value;

  return (
    <section className="act completion-workspace">
      <div
        className={`delivery-layout${
          experience.preview.state.value !== "absent" ? " has-preview" : ""
        }`}
      >
        <article
          className={`delivery delivery-intro${
            completion.complete.value ? "" : " delivery-incomplete"
          }`}
        >
          <p className="t-micro eyebrow">
            {completion.projectName.value ?? "Your project"}
          </p>
          <h1 className="t-display-xl" aria-live="polite">
            {completion.complete.value
              ? "The build is complete, and every contract check passed."
              : remaining === 0 && designShortfall !== null
                ? `Every workflow passed, but I didn’t reproduce the design you approved. ${designShortfall.failedAspects.length} ${designShortfall.failedAspects.length === 1 ? "aspect differs" : "aspects differ"}. I won’t call it done.`
                : `It’s close, but ${remaining} of ${completion.totalCount.value} promises didn’t hold. I won’t call it done.`}
          </h1>
          <p className="t-body-l lead measure">
            Here’s the handover: what I built, what the evidence proves, the
            calls I made, and what remains outside this version.
          </p>

          <ul className="delivery-status" aria-label="Build results">
            <li>
              <span aria-hidden="true">✓</span>
              Build finished
              {completion.buildDuration.value === null
                ? ""
                : ` in ${completion.buildDuration.value}`}
            </li>
            <li>
              <span aria-hidden="true">
                {completion.complete.value ? "✓" : "!"}
              </span>
              {completion.provedCount.value} of {completion.totalCount.value}{" "}
              contract checks verified
            </li>
            {designShortfall !== null && (
              <li>
                <span aria-hidden="true">!</span>
                Approved design not reproduced:{" "}
                {designShortfall.failedAspects.join(", ")}
              </li>
            )}
            {completion.browserEvidencePresent.value && (
              <li>
                <span aria-hidden="true">✓</span>
                Browser evidence recorded
              </li>
            )}
          </ul>
        </article>

        {experience.preview.state.value !== "absent" && (
          <aside className="delivery-preview" aria-label="Live application">
            <PreviewDock
              mission={mission}
              notice={
                completion.complete.value && needsLaunchContent
                  ? "Verified preview · Final launch content still needs your input."
                  : completion.complete.value
                    ? null
                    : remaining === 0 && designShortfall !== null
                      ? "Workflows verified · This does not match the design you approved."
                      : "Draft preview · One or more promises still need evidence."
              }
              preview={experience.preview}
              fullWidth
            />
          </aside>
        )}

        <article className="delivery delivery-body">
          <dl className="delivery-details">
            <div className="field-row">
              <dt>What you got</dt>
              <dd className="t-body-m">
                {completion.deliveredArtifact.value ??
                  "The recorded project workspace."}
              </dd>
            </div>

            {needsLaunchContent && (
              <div className="field-row launch-readiness">
                <dt>Launch readiness</dt>
                <dd>
                  <p className="t-body-m">
                    The build and its workflows passed in Foundry&rsquo;s
                    controlled preview environment. Before launch, replace the
                    development-only setup with your final details:
                  </p>
                  <ul className="unproved stack-list">
                    {completion.launchRequirements.map((requirement) => (
                      <li key={requirement.id} className="t-body-m">
                        {requirement.description.value}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}

            {designShortfall !== null && (
              <div className="field-row">
                <dt>Where this differs from the design you approved</dt>
                <dd>
                  <p className="t-body-m">
                    The workflows below were proven against the running
                    application. The design was not fully reproduced, and I
                    stopped correcting it rather than risk the working build:
                  </p>
                  <ul className="unproved stack-list">
                    {designShortfall.failedAspects.map((aspect) => (
                      <li key={aspect} className="t-body-m">
                        {aspect}
                      </li>
                    ))}
                  </ul>
                  <p className="t-body-m ink-secondary">
                    {designShortfall.reason}
                  </p>
                </dd>
              </div>
            )}

            <div className="field-row">
              <dt>What I proved</dt>
              <dd>
                <p className="t-body-m">
                  <span className="count-strong">
                    {completion.provedCount.value} of{" "}
                    {completion.totalCount.value}
                  </span>
                </p>
                {visibleProofs.length === 0 ? (
                  <p className="t-body-m ink-secondary">
                    No contract promise has enough evidence yet.
                  </p>
                ) : (
                  <ul className="proved t-body-m stack-list">
                    {visibleProofs.map((outcome) => (
                      <li key={outcome.obligationId}>
                        {outcome.statement.value}
                      </li>
                    ))}
                  </ul>
                )}
                {completion.verifiedOutcomes.length > VISIBLE_PROOFS &&
                  !showAllProofs && (
                    <button
                      className="btn-quiet small"
                      onClick={() => setShowAllProofs(true)}
                    >
                      Show all {completion.verifiedOutcomes.length}
                    </button>
                  )}
              </dd>
            </div>

            {completion.unverifiedOutcomes.length > 0 && (
              <div className="field-row">
                <dt>What I couldn’t check</dt>
                <dd>
                  <ul className="unproved stack-list">
                    {completion.unverifiedOutcomes.map((outcome) => (
                      <li key={outcome.obligationId} className="t-body-m">
                        <strong>{outcome.statement.value}</strong>
                        {outcome.detail.value === null
                          ? ""
                          : ` — ${outcome.detail.value}`}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}

            {completion.decisions.length > 0 && (
              <div className="field-row">
                <dt>Why I built it this way</dt>
                <dd>
                  <ul className="decision-attribution stack-list">
                    {completion.decisions.map((decision) => (
                      <li key={decision.id} className="t-body-m">
                        <strong>{decision.label.value}</strong> ·{" "}
                        {decision.answer.value} —{" "}
                        <span className="attribution">
                          {decision.attribution.value === "customer"
                            ? "you chose this"
                            : `my call, because ${decision.reason.value}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}

            <div className="field-row">
              <dt>What I left out on purpose</dt>
              <dd>
                <ul className="left-out stack-list">
                  {completion.limitations.map((limitation) => (
                    <li key={limitation.id} className="t-body-m">
                      {limitation.description.value}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>

            {completion.nextSteps.length > 0 && (
              <div className="field-row">
                <dt>If this became Version 2</dt>
                <dd>
                  <p className="t-body-m">
                    This is the order I’d take the next improvements in.
                  </p>
                  <ol className="numbered t-body-m stack-list">
                    {completion.nextSteps.map((step) => (
                      <li key={step.id}>
                        <span>{step.description.value}</span>
                      </li>
                    ))}
                  </ol>
                </dd>
              </div>
            )}
          </dl>

          <EngineeringDetails mission={mission} />
        </article>
      </div>
    </section>
  );
}
