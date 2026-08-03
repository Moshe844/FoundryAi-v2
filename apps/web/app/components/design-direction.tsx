"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import type {
  DesignAlternative,
  ProjectDesignDirection,
} from "../../experience/contracts";

export type DesignDirectionChoice = Readonly<{
  mode: "recommended" | "alternative" | "other";
  optionId?: string;
  value?: string;
}>;

type Refinement = Readonly<{
  id: string;
  label: string;
  value: string;
}>;

function DirectionPreview({
  direction,
}: Readonly<{ direction: DesignAlternative }>) {
  const system = direction.visualSystem;
  const layout = system?.layoutType ?? "custom";
  const labels =
    system?.sampleLabels ?? [
      direction.name.value,
      direction.layoutApproach.value,
      direction.navigationApproach.value,
    ];
  const style = {
    "--preview-bg": system?.colorRoles.background ?? "#f4f2ed",
    "--preview-surface": system?.colorRoles.surface ?? "#ffffff",
    "--preview-primary": system?.colorRoles.primary ?? "#203b36",
    "--preview-accent": system?.colorRoles.accent ?? "#d27b45",
    "--preview-text": system?.colorRoles.text ?? "#17201e",
  } as CSSProperties;

  let composition;
  if (["sidebar", "documentation", "dashboard"].includes(layout)) {
    composition = (
      <div className="preview-shell preview-sidebar-shell">
        <aside>
          {labels.slice(0, 3).map((label) => (
            <span key={label}>{label}</span>
          ))}
        </aside>
        <main>
          <header>
            <b>{labels[0]}</b>
            <i />
          </header>
          <div className="preview-stat-row">
            <span />
            <span />
            <span />
          </div>
          <div className="preview-table">
            <i />
            <i />
            <i />
            <i />
          </div>
        </main>
      </div>
    );
  } else if (layout === "split-screen") {
    composition = (
      <div className="preview-shell preview-split-shell">
        <section>
          <small>{labels[0]}</small>
          <b>{labels[1]}</b>
          <i />
          <button tabIndex={-1}>{labels[2]}</button>
        </section>
        <figure>
          <span />
          <span />
          <span />
        </figure>
      </div>
    );
  } else if (layout === "editorial") {
    composition = (
      <div className="preview-shell preview-editorial-shell">
        <nav>
          {labels.slice(0, 3).map((label) => (
            <span key={label}>{label}</span>
          ))}
        </nav>
        <h4>{labels[0]}</h4>
        <figure />
        <div className="preview-columns">
          <p />
          <p />
        </div>
      </div>
    );
  } else if (layout === "guided-flow") {
    composition = (
      <div className="preview-shell preview-guided-shell">
        <div className="preview-steps">
          <b>1</b>
          <i />
          <b>2</b>
          <i />
          <b>3</b>
        </div>
        <section>
          <small>{labels[0]}</small>
          <h4>{labels[1]}</h4>
          <p />
          <p />
          <button tabIndex={-1}>{labels[2]}</button>
        </section>
      </div>
    );
  } else {
    composition = (
      <div className="preview-shell preview-canvas-shell">
        <nav>
          <b>{labels[0]}</b>
          <span />
          <span />
        </nav>
        <main>
          <section>
            <h4>{labels[1]}</h4>
            <p />
            <button tabIndex={-1}>{labels[2]}</button>
          </section>
          <aside>
            <i />
            <i />
          </aside>
        </main>
      </div>
    );
  }

  return (
    <div
      className="direction-preview"
      data-density={system?.density}
      data-layout={layout}
      style={style}
      aria-hidden="true"
    >
      {composition}
      <span className="direction-preview-mood">
        {system?.typographyCategory ??
          direction.preview.typographyCharacter.value}{" "}
        · {system?.density ?? direction.preview.spacingDensity.value}
      </span>
    </div>
  );
}

function selectedDirectionName(
  choice: DesignDirectionChoice,
  alternatives: readonly DesignAlternative[],
  direction: ProjectDesignDirection,
) {
  if (choice.mode === "other") {
    return choice.value?.trim() || "Custom direction";
  }

  const selected = alternatives.find(
    (item) =>
      item.id === choice.optionId ||
      (choice.mode === "recommended" && item.recommended.value),
  );

  return selected?.name.value ?? direction.recommendedStyle.value;
}

function buildRefinements(
  alternatives: readonly DesignAlternative[],
): readonly Refinement[] {
  const candidates = alternatives.flatMap((alternative) => [
    {
      id: `${alternative.id}-personality`,
      label: alternative.visualPersonality.value,
      value: `Visual personality: ${alternative.visualPersonality.value}`,
    },
    {
      id: `${alternative.id}-composition`,
      label: alternative.layoutApproach.value,
      value: `Composition: ${alternative.layoutApproach.value}`,
    },
    {
      id: `${alternative.id}-type`,
      label: alternative.preview.typographyCharacter.value,
      value: `Typography: ${alternative.preview.typographyCharacter.value}`,
    },
    {
      id: `${alternative.id}-color`,
      label: alternative.preview.colorMood.value,
      value: `Color direction: ${alternative.preview.colorMood.value}`,
    },
    {
      id: `${alternative.id}-navigation`,
      label: alternative.navigationApproach.value,
      value: `Navigation: ${alternative.navigationApproach.value}`,
    },
    {
      id: `${alternative.id}-mobile`,
      label: alternative.mobileBehavior.value,
      value: `Mobile behavior: ${alternative.mobileBehavior.value}`,
    },
  ]);

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = candidate.label.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function customDirectionValue(
  refinements: readonly Refinement[],
  selectedIds: ReadonlySet<string>,
  note: string,
) {
  const selected = refinements
    .filter((refinement) => selectedIds.has(refinement.id))
    .map((refinement) => refinement.value);
  const trimmedNote = note.trim();

  if (trimmedNote) selected.push(`Customer note: ${trimmedNote}`);
  return selected.join(". ");
}

export function DesignDirection({
  alternatives,
  choice,
  direction,
  onChange,
}: Readonly<{
  alternatives: readonly DesignAlternative[];
  choice: DesignDirectionChoice;
  direction: ProjectDesignDirection;
  onChange: (choice: DesignDirectionChoice) => void;
}>) {
  const other = choice.mode === "other";
  const recommended = alternatives.find((item) => item.recommended.value);
  const selectedName = selectedDirectionName(choice, alternatives, direction);
  const selectionLabel =
    choice.mode === "recommended"
      ? "Foundry’s recommendation is selected"
      : choice.mode === "alternative"
        ? "An alternative direction is selected"
        : "Your custom direction is selected";
  const refinements = useMemo(
    () => buildRefinements(alternatives),
    [alternatives],
  );
  const [selectedRefinements, setSelectedRefinements] = useState<Set<string>>(
    () => new Set(),
  );
  const [customNote, setCustomNote] = useState("");

  function publishCustom(nextIds: Set<string>, nextNote: string) {
    onChange({
      mode: "other",
      value: customDirectionValue(refinements, nextIds, nextNote),
    });
  }

  function toggleRefinement(id: string) {
    const next = new Set(selectedRefinements);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRefinements(next);
    publishCustom(next, customNote);
  }

  function resetToRecommended() {
    setSelectedRefinements(new Set());
    setCustomNote("");
    onChange({
      mode: "recommended",
      optionId: recommended?.id,
      value: recommended?.name.value ?? direction.recommendedStyle.value,
    });
  }

  return (
    <section className="act conversation-measure">
      <div className="conversation-heading">
        <p className="t-label ink-tertiary">Visual direction</p>
        <h2 className="t-title-l">Choose the experience you want people to feel</h2>
        <p className="t-body-m ink-secondary">
          These directions came from this project’s audience, workflows, and
          purpose. Pick one, keep Foundry’s recommendation, or combine the
          project-specific ideas that fit your vision.
        </p>
      </div>

      <div className="banner banner-neutral" aria-live="polite">
        <div className="banner-body">
          <strong>{selectionLabel}</strong>
          <p>{selectedName}</p>
        </div>
      </div>

      {recommended !== undefined && (
        <button
          type="button"
          className="design-recommendation direction-accept"
          aria-pressed={choice.mode === "recommended"}
          onClick={resetToRecommended}
        >
          <div>
            <span className="badge">
              {choice.mode === "recommended"
                ? "Selected · Foundry recommends"
                : "Restore Foundry’s recommendation"}
            </span>
            <h3 className="t-title-m">{recommended.name.value}</h3>
            <p className="t-body-m ink-secondary">
              {recommended.whyItFits.value}
            </p>
          </div>
          <span className="choice-check" aria-hidden="true">
            {choice.mode === "recommended" ? "✓" : "↺"}
          </span>
        </button>
      )}

      <div
        className="direction-card-grid"
        role="radiogroup"
        aria-label="Project-specific design directions"
      >
        {alternatives.map((alternative) => {
          const selected =
            (choice.mode === "recommended" && alternative.recommended.value) ||
            (choice.mode === "alternative" &&
              choice.optionId === alternative.id);
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className="direction-card"
              data-selected={selected}
              key={alternative.id}
              onClick={() => {
                setSelectedRefinements(new Set());
                setCustomNote("");
                onChange(
                  alternative.recommended.value
                    ? {
                        mode: "recommended",
                        optionId: alternative.id,
                        value: alternative.name.value,
                      }
                    : {
                        mode: "alternative",
                        optionId: alternative.id,
                        value: alternative.name.value,
                      },
                );
              }}
            >
              <DirectionPreview direction={alternative} />
              <span className="direction-card-head">
                <strong>{alternative.name.value}</strong>
                {alternative.recommended.value && (
                  <span className="badge">Recommended</span>
                )}
              </span>
              <span className="t-body-s ink-secondary">
                {alternative.description.value}
              </span>
              <span className="direction-fit t-body-s">
                <strong>Why it fits this project:</strong>{" "}
                {alternative.whyItFits.value}
              </span>
              <dl className="direction-facts">
                <div>
                  <dt>Composition</dt>
                  <dd>{alternative.layoutApproach.value}</dd>
                </div>
                <div>
                  <dt>Information</dt>
                  <dd>{alternative.informationDensity.value}</dd>
                </div>
                <div>
                  <dt>Navigation</dt>
                  <dd>{alternative.navigationApproach.value}</dd>
                </div>
                <div>
                  <dt>Mobile</dt>
                  <dd>{alternative.mobileBehavior.value}</dd>
                </div>
              </dl>
              <span className="direction-tradeoff t-caption">
                Tradeoff: {alternative.tradeoff.value}
              </span>
              <span className="direction-confidence t-caption">
                {Math.round(alternative.confidence.value * 100)}% confidence
              </span>
            </button>
          );
        })}
      </div>

      <div className="continue-row">
        <button
          type="button"
          className={other ? "btn btn-secondary" : "btn-quiet"}
          aria-expanded={other}
          onClick={() => {
            if (other) resetToRecommended();
            else onChange({ mode: "other", value: "" });
          }}
        >
          {other ? "Cancel custom direction" : "Create another direction"}
        </button>
      </div>

      {other && (
        <section className="design-other" aria-label="Create a custom design direction">
          <div>
            <p className="t-label ink-tertiary">Project-specific design ideas</p>
            <h3 className="t-title-m">Choose any ideas that feel right</h3>
            <p className="t-body-s ink-secondary">
              These choices were taken from the directions Foundry created for
              this project. Pick none, one, or several, then add your own note if
              needed.
            </p>
          </div>

          <div className="continue-row" role="group" aria-label="Design refinements">
            {refinements.slice(0, 12).map((refinement) => {
              const selected = selectedRefinements.has(refinement.id);
              return (
                <button
                  type="button"
                  className={selected ? "btn btn-primary small" : "btn btn-secondary small"}
                  aria-pressed={selected}
                  key={refinement.id}
                  onClick={() => toggleRefinement(refinement.id)}
                >
                  {refinement.label}
                </button>
              );
            })}
          </div>

          <label htmlFor="design-direction-other" className="t-body-s">
            Add anything Foundry has not suggested
          </label>
          <textarea
            id="design-direction-other"
            className="plain-textarea"
            rows={4}
            placeholder="For example: use our navy and gold brand colors, avoid animation, and make the mobile experience feel like a curated gallery."
            value={customNote}
            onChange={(event) => {
              const nextNote = event.target.value;
              setCustomNote(nextNote);
              publishCustom(selectedRefinements, nextNote);
            }}
          />
          <p className="t-caption ink-tertiary">
            You can also leave this empty and return to Foundry’s recommendation.
          </p>
        </section>
      )}
    </section>
  );
}
