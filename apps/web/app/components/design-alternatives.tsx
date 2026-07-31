"use client";

import type { DesignAlternative } from "../../experience/contracts";

export function DesignAlternatives({
  alternatives,
}: Readonly<{ alternatives: readonly DesignAlternative[] }>) {
  if (alternatives.length < 2) return null;
  const ordered = [...alternatives].sort(
    (left, right) =>
      Number(right.recommended.value) - Number(left.recommended.value),
  );
  const recommended = ordered.find((item) => item.recommended.value);

  return (
    <section className="act">
      <div className="rule-head">
        <span className="rule-mark" aria-hidden="true" />
        <h2 className="t-title-m">
          I considered {alternatives.length} directions
        </h2>
      </div>
      <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
        There is more than one good way to approach this. I weighed what each
        direction optimises for and what it gives up.
      </p>
      <div className="alternative-stack">
        {ordered.map((alternative) => (
          <article
            className={
              alternative.recommended.value
                ? "alternative-card recommended"
                : "alternative-card"
            }
            key={alternative.id}
          >
            <div className="alternative-head">
              <h3 className="t-title-s">{alternative.name.value}</h3>
              {alternative.recommended.value && (
                <span className="badge">Recommended</span>
              )}
            </div>
            <p className="t-body-s ink-secondary">
              {alternative.description.value}
            </p>
          </article>
        ))}
      </div>
      {recommended && (
        <p className="t-body-m measure alternative-winner">
          <strong>Why this direction wins:</strong>{" "}
          {recommended.description.value}
        </p>
      )}
    </section>
  );
}
