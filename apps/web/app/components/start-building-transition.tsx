"use client";

import { useEffect, useState } from "react";

const PHASES = [
  "Understanding what you need",
  "Designing the experience",
  "Creating the application structure",
  "Building the main workflows",
  "Connecting data",
  "Preparing it to run",
  "Running the application",
  "Testing important actions",
  "Verifying the result",
] as const;

export function StartBuildingTransition({
  activityArrived,
  executionStarted,
  onComplete,
  onStop,
  projectName,
  startedAt,
}: Readonly<{
  activityArrived: boolean;
  executionStarted: boolean;
  onComplete: () => void;
  onStop: () => void;
  projectName: string;
  startedAt: number;
}>) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const elapsed = Date.now() - startedAt;
    const timer = window.setTimeout(
      () => setSlow(true),
      Math.max(0, 20_000 - elapsed),
    );
    return () => window.clearTimeout(timer);
  }, [startedAt]);

  useEffect(() => {
    if (!activityArrived || !executionStarted) return;
    const elapsed = Date.now() - startedAt;
    const timer = window.setTimeout(onComplete, Math.max(0, 1_200 - elapsed));
    return () => window.clearTimeout(timer);
  }, [activityArrived, executionStarted, onComplete, startedAt]);

  return (
    <section className="act start-transition" aria-live="polite">
      <ol className="spine start-transition-spine">
        {PHASES.map((phase, index) => (
          <li className={index === 0 ? "done" : ""} key={phase}>
            <span className="spine-mark">
              <span className="spine-dot" aria-hidden="true">
                {index === 0 ? "\u2713" : ""}
              </span>
              <span className="spine-line" aria-hidden="true" />
            </span>
            <span className="spine-body">
              <span className="spine-text">{phase}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="start-transition-message">
        <h1 className="t-title-l">Starting work on {projectName}.</h1>
        <p className="t-body-m ink-tertiary">
          You can leave this page. I&rsquo;ll keep going and everything is
          recorded.
        </p>
        {slow && (
          <div className="start-transition-slow">
            <p className="t-body-s ink-secondary">
              The build worker hasn&rsquo;t reported yet. This is recorded and
              safe to leave.
            </p>
            <button className="btn-quiet small" onClick={onStop} type="button">
              Stop
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
