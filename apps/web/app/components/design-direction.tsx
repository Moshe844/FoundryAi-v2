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

function DirectionPreview({ direction }: Readonly<{ direction: DesignAlternative }>) {
  const system = direction.visualSystem;
  const rawLayout = (system?.layoutType ?? direction.layoutApproach.value).toLowerCase();
  const labels = system?.sampleLabels ?? [
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
  if (/gallery|portfolio|cinematic|immersive|image/.test(rawLayout)) {
    composition = (
      <div className="preview-shell preview-editorial-shell">
        <nav><b>{labels[0]}</b><span>{labels[1]}</span><span>{labels[2]}</span></nav>
        <figure />
        <div className="preview-columns"><p /><p /></div>
      </div>
    );
  } else if (/calendar|booking|schedule|timeline/.test(rawLayout)) {
    composition = (
      <div className="preview-shell preview-guided-shell">
        <div className="preview-steps"><b>1</b><i /><b>2</b><i /><b>3</b></div>
        <section><small>{labels[0]}</small><h4>{labels[1]}</h4><p /><p /><button tabIndex={-1}>{labels[2]}</button></section>
      </div>
    );
  } else if (/dashboard|workspace|sidebar|operations|table|admin/.test(rawLayout)) {
    composition = (
      <div className="preview-shell preview-sidebar-shell">
        <aside>{labels.slice(0, 3).map((label) => <span key={label}>{label}</span>)}</aside>
        <main><header><b>{labels[0]}</b><i /></header><div className="preview-stat-row"><span /><span /><span /></div><div className="preview-table"><i /><i /><i /><i /></div></main>
      </div>
    );
  } else if (/split|profile|index|detail/.test(rawLayout)) {
    composition = (
      <div className="preview-shell preview-split-shell">
        <section><small>{labels[0]}</small><b>{labels[1]}</b><i /><button tabIndex={-1}>{labels[2]}</button></section>
        <figure><span /><span /><span /></figure>
      </div>
    );
  } else {
    composition = (
      <div className="preview-shell preview-canvas-shell">
        <nav><b>{labels[0]}</b><span /><span /></nav>
        <main><section><h4>{labels[1]}</h4><p /><button tabIndex={-1}>{labels[2]}</button></section><aside><i /><i /></aside></main>
      </div>
    );
  }

  return (
    <div className="direction-preview" data-density={system?.density} data-layout={rawLayout} style={style} aria-hidden="true">
      {composition}
      <span className="direction-preview-mood">
        {system?.typographyCategory ?? direction.preview.typographyCharacter.value} · {system?.density ?? direction.preview.spacingDensity.value}
      </span>
    </div>
  );
}

function buildRefinements(alternatives: readonly DesignAlternative[]): readonly Refinement[] {
  const candidates = alternatives.flatMap((alternative) => [
    { id: `${alternative.id}-personality`, label: alternative.visualPersonality.value, value: `Visual personality: ${alternative.visualPersonality.value}` },
    { id: `${alternative.id}-composition`, label: alternative.layoutApproach.value, value: `Composition: ${alternative.layoutApproach.value}` },
    { id: `${alternative.id}-type`, label: alternative.preview.typographyCharacter.value, value: `Typography: ${alternative.preview.typographyCharacter.value}` },
    { id: `${alternative.id}-color`, label: alternative.preview.colorMood.value, value: `Color direction: ${alternative.preview.colorMood.value}` },
    { id: `${alternative.id}-navigation`, label: alternative.navigationApproach.value, value: `Navigation: ${alternative.navigationApproach.value}` },
    { id: `${alternative.id}-mobile`, label: alternative.mobileBehavior.value, value: `Mobile behavior: ${alternative.mobileBehavior.value}` },
  ]);
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = candidate.label.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 10);
}

function customDirectionValue(refinements: readonly Refinement[], selectedIds: ReadonlySet<string>, note: string) {
  const selected = refinements.filter((item) => selectedIds.has(item.id)).map((item) => item.value);
  if (note.trim()) selected.push(`Customer note: ${note.trim()}`);
  return selected.join(". ");
}

export function DesignDirection({ alternatives, choice, direction, onChange }: Readonly<{
  alternatives: readonly DesignAlternative[];
  choice: DesignDirectionChoice;
  direction: ProjectDesignDirection;
  onChange: (choice: DesignDirectionChoice) => void;
}>) {
  const recommended = alternatives.find((item) => item.recommended.value) ?? alternatives[0];
  const refinements = useMemo(() => buildRefinements(alternatives), [alternatives]);
  const [customOpen, setCustomOpen] = useState(choice.mode === "other");
  const [selectedRefinements, setSelectedRefinements] = useState<Set<string>>(() => new Set());
  const [customNote, setCustomNote] = useState("");

  const selectedAlternative = alternatives.find((item) => item.id === choice.optionId) ??
    (choice.mode === "recommended" ? recommended : undefined);
  const selectedLabel = choice.mode === "other"
    ? (choice.value?.trim() ? "Custom direction ready" : "Build a custom direction")
    : selectedAlternative?.name.value ?? direction.recommendedStyle.value;

  function selectDirection(alternative: DesignAlternative) {
    setCustomOpen(false);
    setSelectedRefinements(new Set());
    setCustomNote("");
    onChange({
      mode: alternative.recommended.value ? "recommended" : "alternative",
      optionId: alternative.id,
      value: alternative.name.value,
    });
  }

  function publishCustom(nextIds: Set<string>, nextNote: string) {
    onChange({ mode: "other", value: customDirectionValue(refinements, nextIds, nextNote) });
  }

  function toggleRefinement(id: string) {
    const next = new Set(selectedRefinements);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedRefinements(next);
    publishCustom(next, customNote);
  }

  function openCustom() {
    setCustomOpen(true);
    if (selectedRefinements.size === 0 && !customNote.trim()) {
      const seed = refinements.find((item) => item.label === recommended?.visualPersonality.value) ?? refinements[0];
      const next = seed ? new Set([seed.id]) : new Set<string>();
      setSelectedRefinements(next);
      publishCustom(next, customNote);
    }
  }

  return (
    <section className="act conversation-measure">
      <div className="conversation-heading">
        <p className="t-label ink-tertiary">Visual direction</p>
        <h2 className="t-title-l">Choose the direction Foundry should build</h2>
        <p className="t-body-m ink-secondary">
          Compare a few distinct directions created for this project. Select one as-is, or combine the parts you like. You never need to write a design specification.
        </p>
      </div>

      <div className="banner banner-neutral" aria-live="polite">
        <div className="banner-body"><strong>Current choice</strong><p>{selectedLabel}</p></div>
      </div>

      <div className="direction-card-grid" role="radiogroup" aria-label="Project-specific design directions">
        {alternatives.map((alternative) => {
          const selected = choice.mode !== "other" && selectedAlternative?.id === alternative.id;
          return (
            <article className="direction-card" data-selected={selected} key={alternative.id}>
              <button type="button" role="radio" aria-checked={selected} className="direction-card-select" onClick={() => selectDirection(alternative)}>
                <DirectionPreview direction={alternative} />
                <span className="direction-card-head"><strong>{alternative.name.value}</strong>{alternative.recommended.value && <span className="badge">Recommended</span>}</span>
                <span className="t-body-s ink-secondary">{alternative.description.value}</span>
                <span className="direction-fit t-body-s"><strong>Why it fits:</strong> {alternative.whyItFits.value}</span>
              </button>
              <details className="conversation-details">
                <summary className="t-body-s">See design details</summary>
                <dl className="direction-facts">
                  <div><dt>Composition</dt><dd>{alternative.layoutApproach.value}</dd></div>
                  <div><dt>Personality</dt><dd>{alternative.visualPersonality.value}</dd></div>
                  <div><dt>Navigation</dt><dd>{alternative.navigationApproach.value}</dd></div>
                  <div><dt>Mobile</dt><dd>{alternative.mobileBehavior.value}</dd></div>
                </dl>
                <p className="t-caption">Tradeoff: {alternative.tradeoff.value}</p>
              </details>
            </article>
          );
        })}
      </div>

      <div className="stage-actions">
        <button type="button" className={customOpen ? "btn btn-primary" : "btn btn-secondary"} onClick={openCustom}>
          Combine ideas into my own direction
        </button>
        {choice.mode !== "recommended" && recommended && (
          <button type="button" className="btn-quiet" onClick={() => selectDirection(recommended)}>
            Restore Foundry’s recommendation
          </button>
        )}
      </div>

      {customOpen && (
        <section className="design-other" aria-label="Custom design direction">
          <div>
            <p className="t-label ink-tertiary">Your direction</p>
            <h3 className="t-title-m">Pick the ideas that feel right</h3>
            <p className="t-body-s ink-secondary">
              Selecting one or more ideas is enough. The note below is optional.
            </p>
          </div>
          <div className="continue-row" role="group" aria-label="Design refinements">
            {refinements.map((refinement) => {
              const selected = selectedRefinements.has(refinement.id);
              return (
                <button type="button" className={selected ? "btn btn-primary small" : "btn btn-secondary small"} aria-pressed={selected} key={refinement.id} onClick={() => toggleRefinement(refinement.id)}>
                  {refinement.label}
                </button>
              );
            })}
          </div>
          <label htmlFor="design-direction-other" className="t-body-s">Optional: add one detail Foundry did not suggest</label>
          <textarea id="design-direction-other" className="plain-textarea" rows={3} placeholder="Example: Use our navy and gold brand colors, or avoid animation." value={customNote} onChange={(event) => {
            const nextNote = event.target.value;
            setCustomNote(nextNote);
            publishCustom(selectedRefinements, nextNote);
          }} />
          <p className="t-caption ink-tertiary">
            {selectedRefinements.size > 0 ? `${selectedRefinements.size} design idea${selectedRefinements.size === 1 ? "" : "s"} selected. You can continue now.` : "Choose at least one idea, or add a note."}
          </p>
        </section>
      )}
    </section>
  );
}
