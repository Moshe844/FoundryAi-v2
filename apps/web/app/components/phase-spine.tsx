import type {
  FoundryExperienceModel,
  Mission,
  RepairNarrative,
} from "../../experience/contracts";

function RepairSteps({
  announce,
  repair,
}: {
  announce: boolean;
  repair: RepairNarrative;
}) {
  const lines =
    repair.lines.value.length > 0
      ? repair.lines.value
      : [repair.observedProblem.value].filter(
          (line): line is string => line !== null,
        );

  return (
    <div
      className="repair"
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : "off"}
    >
      {repair.affectedArea.value && (
        <p className="repair-cause">
          The problem is in {repair.affectedArea.value}.
        </p>
      )}
      <ol>
        {lines.map((line, index) => (
          <li
            key={`${line}-${index}`}
            className={index === lines.length - 1 ? "active" : ""}
          >
            {line}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PhaseSpine({
  announceRepair = true,
  compact = false,
  experience,
  mission,
}: {
  announceRepair?: boolean;
  compact?: boolean;
  experience: FoundryExperienceModel;
  mission: Mission;
}) {
  const hasPersistence =
    mission.executionProjection.phase.includesDataPhase;
  const visiblePhases = experience.phases.filter(
    (_phase, index) => index !== 4 || hasPersistence,
  );
  const currentPhase =
    visiblePhases.find((phase) =>
      ["current", "interrupted"].includes(phase.status.value),
    ) ??
    [...visiblePhases]
      .reverse()
      .find((phase) => phase.status.value === "complete") ??
    visiblePhases[0];
  const completedCount = visiblePhases.filter(
    (phase) => phase.status.value === "complete",
  ).length;

  const phaseList = (
    <ol className="spine" aria-label="Build phases">
      {visiblePhases.map((phase) => {
        const status = phase.status.value;
        const state =
          status === "complete"
            ? "done"
            : status === "interrupted"
              ? "fixing"
              : status === "current"
                ? "now"
                : "";
        return (
          <li key={phase.id} className={state}>
            <span className="spine-mark">
              <span className="spine-dot" aria-hidden="true">
                {state === "done" ? "✓" : ""}
              </span>
              <span className="spine-line" />
            </span>
            <div className="spine-body">
              <span className="spine-text">{phase.label.value}</span>
              {status === "interrupted" && experience.repair !== null && (
                <RepairSteps
                  announce={announceRepair}
                  repair={experience.repair}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );

  if (!compact) return phaseList;

  return (
    <details className="mobile-phase-spine">
      <summary>
        <span>
          <span className="t-caption ink-tertiary">Now</span>
          <span className="t-title-s">{currentPhase?.label.value}</span>
        </span>
        <span className="t-caption">
          {completedCount} of {visiblePhases.length} done
        </span>
      </summary>
      {phaseList}
    </details>
  );
}
