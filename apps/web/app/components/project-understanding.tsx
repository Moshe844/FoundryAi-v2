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
    </section>
  );
}
