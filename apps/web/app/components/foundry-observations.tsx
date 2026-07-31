"use client";

import type { FoundryObservation } from "../../experience/contracts";

export function FoundryObservations({
  observations,
}: Readonly<{ observations: readonly FoundryObservation[] }>) {
  if (observations.length === 0) return null;
  return (
    <section className="act">
      <div className="rule-head">
        <span className="rule-mark" aria-hidden="true" />
        <h2 className="t-title-m">
          While reviewing your request, I noticed&hellip;
        </h2>
      </div>
      <ul className="reasoning measure">
        {observations.map((item) => (
          <li className="t-body-m" key={item.id}>
            {item.observation.value}
          </li>
        ))}
      </ul>
    </section>
  );
}
