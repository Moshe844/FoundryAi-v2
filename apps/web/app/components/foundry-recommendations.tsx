"use client";

import { useEffect, useState } from "react";

import type { FoundryRecommendation } from "../../experience/contracts";
import { internalLanguageTerm } from "../../experience/plain-language";

export function FoundryRecommendations({
  onToggle,
  recommendations,
  selected,
}: Readonly<{
  onToggle: (id: string) => void;
  recommendations: readonly FoundryRecommendation[];
  selected: Readonly<Record<string, boolean>>;
}>) {
  const [designReview, setDesignReview] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const selectedCount = recommendations.filter(
    (item) => selected[item.id],
  ).length;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDesignReview(
        new URL(window.location.href).searchParams.get("design-review") === "1",
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    for (const recommendation of recommendations) {
      const term = internalLanguageTerm(
        `${recommendation.title.value} ${recommendation.reason.value}`,
      );
      if (term !== null) {
        console.warn(
          `[foundry] Recommendation "${recommendation.id}" needs plain language; found "${term}".`,
        );
      }
    }
  }, [recommendations]);

  if (recommendations.length === 0) return null;
  return (
    <section className="act conversation-measure">
      <div className="rule-head">
        <span className="rule-mark" aria-hidden="true" />
        <p className="t-label ink-tertiary">Ideas worth considering</p>
        <h2 className="t-title-l">I&rsquo;d also recommend</h2>
      </div>
      <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
        These fit this specific project. Add any that feel useful; the core plan
        does not depend on them.
      </p>
      <div className="sug-stack">
        {recommendations.map((recommendation) => {
          const on = selected[recommendation.id] === true;
          const reviewTerm = internalLanguageTerm(
            `${recommendation.title.value} ${recommendation.reason.value}`,
          );
          const showingWhy = expanded[recommendation.id] === true;
          return (
            <article
              key={recommendation.id}
              className="sug"
              data-selected={on}
            >
              <span className="sug-toggle" aria-hidden="true">
                {on ? "\u2713" : "+"}
              </span>
              <span className="sug-body">
                <strong className="sug-title">
                  {recommendation.title.value}
                </strong>
                <span className="sug-value t-body-s">
                  {recommendation.value.value}
                </span>
                {recommendation.impact.value !== null && (
                  <span className="sug-impact t-caption">
                    Impact: {recommendation.impact.value}
                  </span>
                )}
                {showingWhy && (
                  <span className="sug-why t-body-s" id={`${recommendation.id}-why`}>
                    <strong>Why this project:</strong>{" "}
                    {recommendation.reason.value}
                  </span>
                )}
                {designReview && reviewTerm !== null && (
                  <span className="design-review-flag t-caption">
                    Needs plain language
                  </span>
                )}
              </span>
              <span className="sug-actions">
                <button
                  type="button"
                  className="btn btn-secondary sug-primary-action"
                  role="switch"
                  aria-checked={on}
                  onClick={() => onToggle(recommendation.id)}
                >
                  {on ? "Remove" : "Add"}
                </button>
                <button
                  type="button"
                  className="btn-quiet small"
                  aria-expanded={showingWhy}
                  aria-controls={`${recommendation.id}-why`}
                  onClick={() =>
                    setExpanded((current) => ({
                      ...current,
                      [recommendation.id]: !current[recommendation.id],
                    }))
                  }
                >
                  {showingWhy ? "Hide why" : "Ask why"}
                </button>
              </span>
            </article>
          );
        })}
      </div>
      <p className="t-body-s ink-tertiary recommendation-count">
        {selectedCount === 0
          ? "Nothing selected. That’s fine — the plan stands on its own."
          : `${selectedCount} added`}
      </p>
    </section>
  );
}
