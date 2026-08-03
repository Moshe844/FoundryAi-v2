"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

import type {
  DesignAlternative,
  ProjectDesignDirection,
} from "../../experience/contracts";
import { assessCreativeDirectionSet } from "../../experience/creative-direction-quality";

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

function compositionFor(direction: DesignAlternative) {
  const source = [
    direction.visualSystem?.layoutType,
    direction.layoutApproach.value,
    direction.visualSystem?.contentEmphasis,
    direction.visualSystem?.imageStrategy,
  ].filter(Boolean).join(" ").toLowerCase();
  if (/cinematic|immersive|full[- ]?screen|hero|image[- ]led|gallery/.test(source)) return "immersive";
  if (/editorial|magazine|casebook|journal|narrative|story/.test(source)) return "editorial";
  if (/dashboard|workspace|sidebar|admin|operations|table|grid/.test(source)) return "workspace";
  if (/guided|booking|calendar|wizard|timeline|step/.test(source)) return "guided";
  if (/documentation|reference|developer|endpoint|api/.test(source)) return "documentation";
  return "split";
}

function ArtDirectionBoard({ direction }: Readonly<{ direction: DesignAlternative }>) {
  const system = direction.visualSystem;
  const labels = system?.sampleLabels?.length
    ? system.sampleLabels
    : [direction.name.value, direction.layoutApproach.value, direction.navigationApproach.value];
  const style = {
    "--board-bg": system?.colorRoles.background ?? "#f4f2ed",
    "--board-surface": system?.colorRoles.surface ?? "#ffffff",
    "--board-primary": system?.colorRoles.primary ?? "#203b36",
    "--board-accent": system?.colorRoles.accent ?? "#d27b45",
    "--board-text": system?.colorRoles.text ?? "#17201e",
  } as CSSProperties;
  const palette = [
    system?.colorRoles.background,
    system?.colorRoles.surface,
    system?.colorRoles.primary,
    system?.colorRoles.accent,
    system?.colorRoles.text,
  ].filter((value): value is string => Boolean(value));

  return (
    <div
      className="art-board"
      data-composition={compositionFor(direction)}
      data-density={system?.density ?? direction.informationDensity.value}
      data-navigation={system?.navigationType ?? direction.navigationApproach.value}
      data-typography={system?.typographyCategory ?? direction.preview.typographyCharacter.value}
      data-imagery={system?.imageStrategy ?? direction.preview.hierarchy.value}
      style={style}
      aria-hidden="true"
    >
      <div className="art-board-main">
        <div className="art-board-nav">
          <strong>{labels[0] ?? direction.name.value}</strong>
          <span>{labels[2] ?? direction.navigationApproach.value}</span>
        </div>
        <div className="art-board-hero">
          <span className="art-board-kicker">{direction.visualPersonality.value}</span>
          <span className="art-board-title">{labels[1] ?? direction.name.value}</span>
          <span className="art-board-copy">{direction.description.value}</span>
          <span className="art-board-action">Explore the experience</span>
        </div>
      </div>
      <div className="art-board-side">
        <div className="art-board-image" />
        <div className="art-board-palette">
          {(palette.length ? palette : ["#f4f2ed", "#ffffff", "#203b36", "#d27b45", "#17201e"]).map((color) => (
            <i key={color} style={{ background: color }} />
          ))}
        </div>
      </div>
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
    { id: `${alternative.id}-imagery`, label: alternative.visualSystem?.imageStrategy ?? alternative.preview.hierarchy.value, value: `Imagery and hierarchy: ${alternative.visualSystem?.imageStrategy ?? alternative.preview.hierarchy.value}` },
    { id: `${alternative.id}-interaction`, label: alternative.visualSystem?.interactionModel ?? alternative.tradeoff.value, value: `Interaction character: ${alternative.visualSystem?.interactionModel ?? alternative.tradeoff.value}` },
  ]);
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const normalized = candidate.label.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 14);
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
  const assessment = useMemo(() => assessCreativeDirectionSet(alternatives), [alternatives]);
  const recommended = alternatives.find((item) => item.recommended.value) ?? alternatives[0];
  const refinements = useMemo(() => buildRefinements(alternatives), [alternatives]);
  const [customOpen, setCustomOpen] = useState(choice.mode === "other");
  const [compareOpen, setCompareOpen] = useState(false);
  const [selectedRefinements, setSelectedRefinements] = useState<Set<string>>(() => new Set());
  const [customNote, setCustomNote] = useState("");

  const selectedAlternative = alternatives.find((item) => item.id === choice.optionId) ??
    (choice.mode === "recommended" ? recommended : undefined);
  const selectedLabel = choice.mode === "other"
    ? (choice.value?.trim() ? "Your combined art direction" : "Custom direction")
    : selectedAlternative?.name.value ?? direction.recommendedStyle.value;

  function selectDirection(alternative: DesignAlternative) {
    if (!assessment.publishable) return;
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
    if (!assessment.publishable) return;
    onChange({ mode: "other", value: customDirectionValue(refinements, nextIds, nextNote) });
  }

  function toggleRefinement(id: string) {
    const next = new Set(selectedRefinements);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedRefinements(next);
    publishCustom(next, customNote);
  }

  function openCustom() {
    if (!assessment.publishable) return;
    setCustomOpen(true);
    if (selectedRefinements.size === 0 && !customNote.trim()) {
      const seeds = refinements
        .filter((item) => item.id.startsWith(`${recommended?.id}-`))
        .slice(0, 2);
      const next = new Set(seeds.map((item) => item.id));
      setSelectedRefinements(next);
      publishCustom(next, customNote);
    }
  }

  return (
    <section className="act design-studio">
      <div className="design-studio-intro">
        <p className="t-label ink-tertiary">Creative direction</p>
        <h2 className="t-title-l">Choose the experience Foundry should bring to life</h2>
        <p className="t-body-m ink-secondary">
          These are project-specific art directions, not reusable templates. Each one defines composition, visual mood, typography, navigation, imagery, interaction, and mobile behavior. The approved direction becomes part of the binding build contract.
        </p>
      </div>

      {!assessment.publishable && (
        <section className="design-quality-blocker" role="alert">
          <p className="t-label">Foundry is revising these directions</p>
          <h3 className="t-title-m">These choices are not different or specific enough yet.</h3>
          <p className="t-body-s">
            Foundry will not ask you to choose between cosmetic variations. Selection is paused until the creative directions pass the quality gate.
          </p>
          <ul className="design-quality-issues">
            {assessment.issues.slice(0, 4).map((issue) => <li key={`${issue.code}-${issue.directionIds.join("-")}`}>{issue.message}</li>)}
          </ul>
        </section>
      )}

      <div className="design-current" aria-live="polite">
        <div>
          <p className="t-caption ink-tertiary">Current art direction</p>
          <strong className="t-title-s">{selectedLabel}</strong>
        </div>
        <div className="design-quality-score">
          <span className="t-caption ink-tertiary">Direction distinctness</span>
          <strong>{assessment.distinctnessScore}%</strong>
        </div>
        <button type="button" className="btn-quiet small" onClick={() => setCompareOpen((value) => !value)}>
          {compareOpen ? "Close comparison" : "Compare directions"}
        </button>
      </div>

      {compareOpen && (
        <section className="design-comparison" aria-label="Design direction comparison">
          <div>
            <p className="t-label ink-tertiary">At a glance</p>
            <h3 className="t-title-m">How the directions differ</h3>
          </div>
          <div className="design-comparison-grid">
            {alternatives.map((alternative) => (
              <div className="design-comparison-item" key={alternative.id}>
                <strong>{alternative.name.value}</strong>
                <span><b>Best for:</b> {alternative.whyItFits.value}</span>
                <span><b>Experience:</b> {alternative.visualPersonality.value}</span>
                <span><b>Tradeoff:</b> {alternative.tradeoff.value}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="art-direction-grid" role="radiogroup" aria-label="Project-specific art directions" aria-disabled={!assessment.publishable}>
        {alternatives.map((alternative) => {
          const selected = choice.mode !== "other" && selectedAlternative?.id === alternative.id;
          const system = alternative.visualSystem;
          return (
            <article className="art-direction-card" data-selected={selected} data-disabled={!assessment.publishable} key={alternative.id}>
              <button disabled={!assessment.publishable} type="button" role="radio" aria-checked={selected} className="art-direction-select" onClick={() => selectDirection(alternative)}>
                <ArtDirectionBoard direction={alternative} />
                <span className="art-direction-body">
                  <span className="art-direction-title-row">
                    <strong>{alternative.name.value}</strong>
                    {alternative.recommended.value && <span className="badge">Foundry recommends</span>}
                  </span>
                  <span className="t-body-s ink-secondary">{alternative.description.value}</span>
                  <span className="art-direction-reason t-body-s"><strong>Why this fits your project:</strong> {alternative.whyItFits.value}</span>
                  <dl className="art-direction-signals">
                    <div className="art-direction-signal"><dt>Composition</dt><dd>{alternative.layoutApproach.value}</dd></div>
                    <div className="art-direction-signal"><dt>Typography</dt><dd>{alternative.preview.typographyCharacter.value}</dd></div>
                    <div className="art-direction-signal"><dt>Imagery</dt><dd>{system?.imageStrategy ?? alternative.preview.hierarchy.value}</dd></div>
                    <div className="art-direction-signal"><dt>Mobile</dt><dd>{alternative.mobileBehavior.value}</dd></div>
                  </dl>
                </span>
              </button>
              <details className="art-direction-details">
                <summary className="t-body-s">Open the full creative brief</summary>
                <div className="art-direction-story">
                  <p className="t-body-s"><strong>Visual personality:</strong> {alternative.visualPersonality.value}</p>
                  <p className="t-body-s"><strong>Navigation:</strong> {alternative.navigationApproach.value}</p>
                  <p className="t-body-s"><strong>Information density:</strong> {alternative.informationDensity.value}</p>
                  <p className="t-body-s"><strong>Interaction character:</strong> {system?.interactionModel ?? "Defined by the selected direction and approved workflows."}</p>
                  <p className="t-body-s"><strong>Surface treatment:</strong> {system?.surfaceTreatment ?? alternative.preview.spacingDensity.value}</p>
                  <p className="t-body-s"><strong>Tradeoff:</strong> {alternative.tradeoff.value}</p>
                  <p className="t-caption ink-tertiary">Confidence: {Math.round(alternative.confidence.value * 100)}%</p>
                </div>
              </details>
            </article>
          );
        })}
      </div>

      <div className="stage-actions">
        <button disabled={!assessment.publishable} type="button" className={customOpen ? "btn btn-primary" : "btn btn-secondary"} onClick={openCustom}>
          Combine the strongest ideas
        </button>
        {choice.mode !== "recommended" && recommended && (
          <button disabled={!assessment.publishable} type="button" className="btn-quiet" onClick={() => selectDirection(recommended)}>
            Restore Foundry’s recommendation
          </button>
        )}
      </div>

      {customOpen && assessment.publishable && (
        <section className="design-other" aria-label="Custom art direction">
          <div>
            <p className="t-label ink-tertiary">Create your own direction</p>
            <h3 className="t-title-m">Choose the parts you want Foundry to combine</h3>
            <p className="t-body-s ink-secondary">
              These ideas come from the project-specific directions above. Choosing one or more is enough; writing is optional.
            </p>
          </div>
          <div className="continue-row" role="group" aria-label="Art direction refinements">
            {refinements.map((refinement) => {
              const selected = selectedRefinements.has(refinement.id);
              return (
                <button type="button" className={selected ? "btn btn-primary small" : "btn btn-secondary small"} aria-pressed={selected} key={refinement.id} onClick={() => toggleRefinement(refinement.id)}>
                  {refinement.label}
                </button>
              );
            })}
          </div>
          <label htmlFor="design-direction-other" className="t-body-s">Optional: add a detail only you know</label>
          <textarea id="design-direction-other" className="plain-textarea" rows={3} placeholder="Example: Use our navy and gold identity, prioritize full-screen photography, or keep motion very restrained." value={customNote} onChange={(event) => {
            const nextNote = event.target.value;
            setCustomNote(nextNote);
            publishCustom(selectedRefinements, nextNote);
          }} />
          <p className="t-caption ink-tertiary">
            {selectedRefinements.size > 0 ? `${selectedRefinements.size} art-direction idea${selectedRefinements.size === 1 ? "" : "s"} selected. This is ready to build.` : "Choose at least one idea, or add a note."}
          </p>
        </section>
      )}
    </section>
  );
}
