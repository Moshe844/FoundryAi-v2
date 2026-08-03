"use client";

import { useMemo, useState } from "react";

import type {
  DesignAlternative,
  ProjectDesignDirection,
} from "../../experience/contracts";
import { assessCreativeDirectionSet } from "../../experience/creative-direction-quality";
import {
  buildDirectionTraits,
  composeCustomDirection,
  suggestedCombinations,
  type CustomDesignComposition,
  type DirectionTrait,
  type TraitAxis,
} from "../../experience/custom-direction";
import { ArtDirectionBoard } from "./art-direction-board";

export type DesignDirectionChoice = Readonly<{
  mode: "recommended" | "alternative" | "other";
  optionId?: string;
  value?: string;
  composition?: CustomDesignComposition;
}>;

const AXIS_LABEL: Readonly<Record<TraitAxis, string>> = {
  composition: "Composition",
  typography: "Typography",
  color: "Color",
  imagery: "Imagery",
  navigation: "Navigation",
  density: "Density",
  motion: "Motion",
  responsive: "On phones",
  surface: "Surfaces",
};

function humanize(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized) return fallback;
  return normalized.replaceAll("-", " ");
}

/** The single line that tells the customer what a direction really is. */
function distinction(direction: DesignAlternative) {
  const dna = direction.creativeDNA;
  if (!dna) return direction.layoutApproach.value;
  return `${humanize(dna.compositionPrimitive, "composition")}, ${humanize(dna.typeVoice, "type")} at ${dna.typeScale} scale, ${humanize(dna.imageryTreatment, "imagery")} imagery`;
}

export function DesignDirection({ alternatives, choice, direction, onChange }: Readonly<{
  alternatives: readonly DesignAlternative[];
  choice: DesignDirectionChoice;
  direction: ProjectDesignDirection;
  onChange: (choice: DesignDirectionChoice) => void;
}>) {
  const assessment = useMemo(() => assessCreativeDirectionSet(alternatives), [alternatives]);
  const recommended = alternatives.find((item) => item.recommended.value) ?? alternatives[0];
  const traits = useMemo(() => buildDirectionTraits(alternatives), [alternatives]);
  const combinations = useMemo(
    () => suggestedCombinations(alternatives, traits),
    [alternatives, traits],
  );

  const [customOpen, setCustomOpen] = useState(choice.mode === "other");
  const [compareOpen, setCompareOpen] = useState(false);
  const [openBrief, setOpenBrief] = useState<string | null>(null);
  const [selectedTraitIds, setSelectedTraitIds] = useState<Set<string>>(() => new Set());
  const [customNote, setCustomNote] = useState("");

  const composition = useMemo(
    () => composeCustomDirection({ alternatives, traits, selectedTraitIds, customerNote: customNote }),
    [alternatives, traits, selectedTraitIds, customNote],
  );

  const selectedAlternative = alternatives.find((item) => item.id === choice.optionId) ??
    (choice.mode === "recommended" ? recommended : undefined);
  const selectedLabel = choice.mode === "other"
    ? "Your combined direction"
    : selectedAlternative?.name.value ?? direction.recommendedStyle.value;

  function selectDirection(alternative: DesignAlternative) {
    if (!assessment.publishable) return;
    setCustomOpen(false);
    setSelectedTraitIds(new Set());
    setCustomNote("");
    onChange({
      mode: alternative.recommended.value ? "recommended" : "alternative",
      optionId: alternative.id,
      value: alternative.name.value,
    });
  }

  function publishCustom(nextIds: Set<string>, nextNote: string) {
    if (!assessment.publishable) return;
    const next = composeCustomDirection({
      alternatives,
      traits,
      selectedTraitIds: nextIds,
      customerNote: nextNote,
    });
    onChange({ mode: "other", value: next.rationale, composition: next });
  }

  function toggleTrait(id: string) {
    const next = new Set(selectedTraitIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedTraitIds(next);
    publishCustom(next, customNote);
  }

  function applyCombination(traitIds: readonly string[]) {
    const next = new Set(traitIds);
    setSelectedTraitIds(next);
    publishCustom(next, customNote);
  }

  function openCustom() {
    if (!assessment.publishable) return;
    setCustomOpen(true);
    // Never open onto an empty form: seed the first useful combination so a
    // combined direction is valid without the customer typing anything.
    if (selectedTraitIds.size === 0 && combinations.length > 0) {
      applyCombination(combinations[0].traitIds);
    }
  }

  const traitsByAxis = useMemo(() => {
    const grouped = new Map<TraitAxis, DirectionTrait[]>();
    for (const trait of traits) {
      grouped.set(trait.axis, [...(grouped.get(trait.axis) ?? []), trait]);
    }
    return [...grouped];
  }, [traits]);

  return (
    <section className="act studio">
      <header className="studio-masthead">
        <div className="studio-thesis">
          <p className="t-label ink-tertiary">Creative direction</p>
          <h2 className="t-title-l">{direction.recommendedStyle.value}</h2>
          <p className="t-body-m ink-secondary">{direction.reason.value}</p>
          <p className="t-caption ink-tertiary">
            Project-specific art directions, not reusable templates. Pick one, or combine them.
          </p>
        </div>
        <div className="studio-status" aria-live="polite">
          <p className="t-caption ink-tertiary">Selected</p>
          <strong className="t-title-s">{selectedLabel}</strong>
          <span className="studio-distinct" title="How differently these directions are built">
            {assessment.distinctnessScore}% distinct
          </span>
        </div>
      </header>

      {!assessment.publishable && (
        <section className="design-quality-blocker" role="alert">
          <p className="t-label">Foundry is revising these directions</p>
          <h3 className="t-title-m">These are not different enough to be an honest choice.</h3>
          <p className="t-body-s">
            Foundry will not ask you to choose between cosmetic variations. Selection stays paused
            until the set passes the creative-direction quality gate.
          </p>
          <ul className="design-quality-issues">
            {assessment.issues.slice(0, 3).map((issue) => (
              <li key={`${issue.code}-${issue.directionIds.join("-")}`}>{issue.message}</li>
            ))}
          </ul>
        </section>
      )}

      <div
        className="studio-boards"
        role="radiogroup"
        aria-label="Creative directions"
        aria-disabled={!assessment.publishable}
      >
        {alternatives.map((alternative) => {
          const selected = choice.mode !== "other" && selectedAlternative?.id === alternative.id;
          const briefOpen = openBrief === alternative.id;
          const dna = alternative.creativeDNA;
          return (
            <article className="studio-board" data-selected={selected} key={alternative.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!assessment.publishable}
                className="studio-board-select"
                onClick={() => selectDirection(alternative)}
              >
                <ArtDirectionBoard direction={alternative} />
                <span className="studio-board-head">
                  <strong className="t-title-s">{alternative.name.value}</strong>
                  {alternative.recommended.value && <span className="badge">Recommended</span>}
                </span>
                <span className="studio-board-thesis t-body-s">
                  {dna?.thesis ?? alternative.description.value}
                </span>
                <span className="studio-board-distinction t-caption">{distinction(alternative)}</span>
                <span className="studio-board-tradeoff t-caption">
                  <b>Tradeoff</b> {alternative.tradeoff.value}
                </span>
              </button>
              <button
                type="button"
                className="studio-board-more"
                aria-expanded={briefOpen}
                onClick={() => setOpenBrief(briefOpen ? null : alternative.id)}
              >
                {briefOpen ? "Hide the brief" : "Full brief"}
              </button>
              {briefOpen && dna && (
                <dl className="studio-brief">
                  <div><dt>Why this fits</dt><dd>{alternative.whyItFits.value}</dd></div>
                  <div><dt>Emotional goal</dt><dd>{dna.emotionalGoal}</dd></div>
                  <div><dt>Audience response</dt><dd>{dna.audienceResponse}</dd></div>
                  <div><dt>Sequence</dt><dd>{dna.surfaceSequence.map((step) => humanize(step, step)).join(" → ")}</dd></div>
                  <div><dt>Spacing</dt><dd>{humanize(dna.spacingRhythm, "steady")}</dd></div>
                  <div><dt>Motion</dt><dd>{dna.motionStrategy}</dd></div>
                  <div><dt>On phones</dt><dd>{humanize(dna.responsiveTransform, "stacks")}</dd></div>
                  <div><dt>Deliberately not doing</dt><dd>{dna.exclusions.join(" ")}</dd></div>
                </dl>
              )}
            </article>
          );
        })}
      </div>

      <div className="studio-actions">
        <button
          type="button"
          className={customOpen ? "btn btn-primary" : "btn btn-secondary"}
          disabled={!assessment.publishable}
          onClick={openCustom}
        >
          Combine ideas
        </button>
        <button
          type="button"
          className="btn-quiet small"
          aria-expanded={compareOpen}
          onClick={() => setCompareOpen((value) => !value)}
        >
          {compareOpen ? "Hide comparison" : "Compare"}
        </button>
        {choice.mode !== "recommended" && recommended && (
          <button
            type="button"
            className="btn-quiet small"
            disabled={!assessment.publishable}
            onClick={() => selectDirection(recommended)}
          >
            Back to recommended
          </button>
        )}
      </div>

      {compareOpen && (
        <div className="studio-compare-scroll">
          <table className="studio-compare">
            <caption className="sr-only">How the creative directions differ</caption>
            <thead>
              <tr>
                <th scope="col">Axis</th>
                {alternatives.map((item) => <th scope="col" key={item.id}>{item.name.value}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                ["Composition", (item: DesignAlternative) => humanize(item.creativeDNA?.compositionPrimitive, item.layoutApproach.value)],
                ["Typography", (item: DesignAlternative) => humanize(item.creativeDNA?.typeVoice, item.preview.typographyCharacter.value)],
                ["Imagery", (item: DesignAlternative) => humanize(item.creativeDNA?.imageryTreatment, "—")],
                ["Navigation", (item: DesignAlternative) => humanize(item.visualSystem?.navigationType, item.navigationApproach.value)],
                ["On phones", (item: DesignAlternative) => humanize(item.creativeDNA?.responsiveTransform, item.mobileBehavior.value)],
                ["Motion", (item: DesignAlternative) => humanize(item.creativeDNA?.motionStrategy, "—")],
                ["Tradeoff", (item: DesignAlternative) => item.tradeoff.value],
              ] as const).map(([label, read]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {alternatives.map((item) => <td key={item.id}>{read(item)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {customOpen && assessment.publishable && (
        <section className="studio-custom" aria-label="Combined direction">
          <div className="studio-custom-head">
            <h3 className="t-title-m">Combine ideas</h3>
            <p className="t-body-s ink-secondary">
              Pick traits from any direction. Foundry merges them into a complete design system —
              typing is optional.
            </p>
          </div>

          {combinations.length > 0 && (
            <div className="studio-combos" role="group" aria-label="Suggested combinations">
              {combinations.map((combo) => (
                <button
                  type="button"
                  className="studio-combo"
                  key={combo.id}
                  onClick={() => applyCombination(combo.traitIds)}
                >
                  {combo.label}
                </button>
              ))}
            </div>
          )}

          <div className="studio-trait-axes">
            {traitsByAxis.map(([axis, group]) => (
              <div className="studio-trait-axis" key={axis}>
                <p className="t-caption ink-tertiary">{AXIS_LABEL[axis]}</p>
                <div className="studio-trait-row">
                  {group.map((trait) => {
                    const active = selectedTraitIds.has(trait.id);
                    return (
                      <button
                        type="button"
                        key={trait.id}
                        className="studio-trait"
                        aria-pressed={active}
                        title={trait.detail}
                        onClick={() => toggleTrait(trait.id)}
                      >
                        {humanize(trait.label, trait.label)}
                        <small>{trait.sourceDirectionName}</small>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {composition.complete && (
            <div className="studio-custom-preview">
              <p className="t-caption ink-tertiary">Your combined direction</p>
              <p className="t-body-s">{composition.rationale}</p>
              <ul className="studio-custom-rules">
                {composition.layoutRules.map((rule) => <li key={rule}>{rule}</li>)}
                <li>{composition.typography}</li>
                <li>{composition.responsiveBehavior}</li>
              </ul>
              {composition.resolvedConflicts.map((conflict) => (
                <p className="studio-conflict t-caption" key={conflict.keptTraitId}>
                  {conflict.explanation}
                </p>
              ))}
              {composition.incompatibilities.map((message) => (
                <p className="studio-incompatible t-caption" key={message}>{message}</p>
              ))}
            </div>
          )}

          <label className="t-caption ink-tertiary" htmlFor="design-direction-other">
            Add a detail only you know (optional)
          </label>
          <textarea
            id="design-direction-other"
            className="plain-textarea"
            rows={2}
            placeholder="Example: use our navy and gold identity"
            value={customNote}
            onChange={(event) => {
              setCustomNote(event.target.value);
              publishCustom(selectedTraitIds, event.target.value);
            }}
          />
        </section>
      )}
    </section>
  );
}
