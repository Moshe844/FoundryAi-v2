"use client";

import type {
  FoundryProposal as FoundryProposalModel,
  ProjectJourney,
} from "../../experience/contracts";

export function FoundryProposal({
  audiences,
  journeys,
  proposal,
}: Readonly<{
  audiences: readonly string[];
  journeys: readonly ProjectJourney[];
  proposal: FoundryProposalModel;
}>) {
  return (
    <section className="act">
      <div className="proposal conversation-measure">
        <div className="conversation-heading">
          <p className="t-label ink-tertiary">The experience</p>
          <h2 className="t-title-l">What I&rsquo;d build</h2>
          <p className="t-body-m ink-secondary">
            I&rsquo;ve filled in the professional details so you don&rsquo;t
            have to write a specification.
          </p>
        </div>

        <ol className="feature-grid">
          {proposal.items.value.map((item, index) => (
            <li className="feature-card" key={`${index}-${item}`}>
              <span className="feature-index" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="t-body-m">{item}</span>
            </li>
          ))}
        </ol>

        {journeys.length > 0 && (
          <details className="conversation-details journey-details">
            <summary className="t-body-s">
              <span>See how the main journey fits together</span>
            </summary>
            <ol className="journey-list">
              {journeys.map((journey, index) => (
                <li key={journey.id}>
                  <span className="journey-step" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="t-body-s">
                    {journey.description.value}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}

        {proposal.includedDefaults.value.length > 0 && (
          <div className="included-defaults">
            <div className="conversation-heading compact">
              <p className="t-label ink-tertiary">Already handled</p>
              <h3 className="t-title-m">
                What I&rsquo;d include automatically
              </h3>
            </div>
            <div className="included-chips">
              {proposal.includedDefaults.value.map((label) => (
                <span className="included-chip" key={label}>
                  <span className="included-tick" aria-hidden="true">
                    &#10003;
                  </span>
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
        <span className="sr-only">
          Designed for {audiences.join(", ")}. {journeys.length} customer
          journey{journeys.length === 1 ? "" : "s"} in the proposal.
        </span>
      </div>
    </section>
  );
}
