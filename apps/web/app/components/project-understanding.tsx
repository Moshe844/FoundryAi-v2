"use client";

import { useEffect, useRef } from "react";

import type { ProjectUnderstanding as ProjectUnderstandingModel } from "../../experience/contracts";

export function ProjectUnderstanding({
  understanding,
}: Readonly<{ understanding: ProjectUnderstandingModel }>) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [understanding.projectName.value]);

  return (
    <section className="act conversation-opening">
      <div className="voice conversation-measure">
        <span className="voice-mark" aria-hidden="true" />
        <p className="t-label voice-label">{understanding.projectName.value}</p>
        <h1
          className="t-display-l voice-title"
          ref={headingRef}
          tabIndex={-1}
        >
          Here&rsquo;s what I think you need
        </h1>
        <p className="t-body-l voice-lead">{understanding.summary.value}</p>
        {understanding.isRevised.value && (
          <p className="t-caption revision-note">Updated with your answers</p>
        )}
      </div>

      <div className="audience-line" aria-label="Designed for">
        <span className="t-caption ink-tertiary">For</span>
        {understanding.audiences.value.map((audience) => (
          <span className="audience-pill" key={audience}>
            {audience}
          </span>
        ))}
      </div>

      <div className="understanding-contract conversation-measure">
        <section aria-labelledby="understanding-outcomes">
          <div className="conversation-heading compact">
            <p className="t-label ink-tertiary">Required outcome</p>
            <h2 id="understanding-outcomes" className="t-heading-m">
              What must be true when this is finished
            </h2>
          </div>
          <ol className="understanding-list">
            {understanding.proposal.items.value.map((item, index) => (
              <li key={item}>
                <span className="feature-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="t-body-m">{item}</span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="understanding-journeys">
          <div className="conversation-heading compact">
            <p className="t-label ink-tertiary">Real workflow</p>
            <h2 id="understanding-journeys" className="t-heading-m">
              What people must be able to do
            </h2>
          </div>
          <ol className="understanding-list">
            {understanding.journeys.map((journey, index) => (
              <li key={journey.id}>
                <span className="feature-index" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="t-body-m">{journey.description.value}</span>
              </li>
            ))}
          </ol>
        </section>

        {understanding.proposal.reasoning.value.length > 0 && (
          <section aria-labelledby="understanding-architecture">
            <div className="conversation-heading compact">
              <p className="t-label ink-tertiary">Architecture commitments</p>
              <h2 id="understanding-architecture" className="t-heading-m">
                Decisions you are approving on this page
              </h2>
            </div>
            <ul className="understanding-list understanding-list-plain">
              {understanding.proposal.reasoning.value.map((decision) => (
                <li key={decision}>
                  <span className="understanding-bullet" aria-hidden="true" />
                  <span className="t-body-m">{decision}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {understanding.proposal.exclusions.value.length > 0 && (
          <section aria-labelledby="understanding-limits">
            <div className="conversation-heading compact">
              <p className="t-label ink-tertiary">Explicit limits</p>
              <h2 id="understanding-limits" className="t-heading-m">
                What will not be substituted or invented
              </h2>
            </div>
            <ul className="understanding-list understanding-list-plain">
              {understanding.proposal.exclusions.value.map((exclusion) => (
                <li key={exclusion}>
                  <span className="understanding-bullet" aria-hidden="true" />
                  <span className="t-body-m">{exclusion}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
