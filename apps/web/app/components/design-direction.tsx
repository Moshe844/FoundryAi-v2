"use client";

import type { CSSProperties } from "react";
import { useState } from "react";

import type {
  DesignAlternative,
  DesignVisualSystem,
  ProjectDesignDirection,
} from "../../experience/contracts";

export type DesignDirectionChoice = Readonly<{
  mode: "recommended" | "alternative" | "other";
  optionId?: string;
  value?: string;
}>;

function DirectionPreview({
  direction,
  index,
  visualOverride,
}: Readonly<{ direction: DesignAlternative; index: number; visualOverride?: DesignVisualSystem }>) {
  const fallbacks = ["sidebar", "split-screen", "editorial", "dashboard", "guided-flow"];
  const system = visualOverride ?? direction.visualSystem;
  const layout = system?.layoutType ?? fallbacks[index % fallbacks.length];
  const labels = system?.sampleLabels ?? [direction.name.value, "Overview", "Next step"];
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
        <aside>{labels.slice(0, 3).map((label) => <span key={label}>{label}</span>)}</aside>
        <main>
          <header><b>{labels[0]}</b><i /></header>
          <div className="preview-stat-row"><span /><span /><span /></div>
          <div className="preview-table"><i /><i /><i /><i /></div>
        </main>
      </div>
    );
  } else if (layout === "split-screen") {
    composition = (
      <div className="preview-shell preview-split-shell">
        <section><small>{labels[0]}</small><b>{labels[1]}</b><i /><button tabIndex={-1}>{labels[2]}</button></section>
        <figure><span /><span /><span /></figure>
      </div>
    );
  } else if (layout === "editorial") {
    composition = (
      <div className="preview-shell preview-editorial-shell">
        <nav>{labels.slice(0, 3).map((label) => <span key={label}>{label}</span>)}</nav>
        <h4>{labels[0]}</h4>
        <figure />
        <div className="preview-columns"><p /><p /></div>
      </div>
    );
  } else if (layout === "guided-flow") {
    composition = (
      <div className="preview-shell preview-guided-shell">
        <div className="preview-steps"><b>1</b><i /><b>2</b><i /><b>3</b></div>
        <section><small>{labels[0]}</small><h4>{labels[1]}</h4><p /><p /><button tabIndex={-1}>{labels[2]}</button></section>
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
    <div className="direction-preview" data-density={system?.density} data-layout={layout} style={style} aria-hidden="true">
      {composition}
      <span className="direction-preview-mood">
        {system?.typographyCategory ?? direction.preview.typographyCharacter.value} · {system?.density ?? direction.preview.spacingDensity.value}
      </span>
    </div>
  );
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
  const defaultId = recommended?.id ?? alternatives[0]?.id ?? "";
  const [mix, setMix] = useState({
    layout: defaultId,
    colors: defaultId,
    navigation: defaultId,
    density: defaultId,
  });
  const byId = (id: string) => alternatives.find((item) => item.id === id) ?? alternatives[0];
  const mixedBase = byId(mix.layout);
  const mixedVisual = mixedBase?.visualSystem === undefined
    ? undefined
    : {
        ...mixedBase.visualSystem,
        colorRoles: byId(mix.colors)?.visualSystem?.colorRoles ?? mixedBase.visualSystem.colorRoles,
        navigationType: byId(mix.navigation)?.visualSystem?.navigationType ?? mixedBase.visualSystem.navigationType,
        density: byId(mix.density)?.visualSystem?.density ?? mixedBase.visualSystem.density,
        spacingProfile: byId(mix.density)?.visualSystem?.spacingProfile ?? mixedBase.visualSystem.spacingProfile,
      };

  function updateMix(axis: keyof typeof mix, optionId: string) {
    const next = { ...mix, [axis]: optionId };
    setMix(next);
    const name = (id: string) => byId(id)?.name.value ?? "the recommended direction";
    onChange({
      mode: "other",
      value: `Compose the final design using the layout from ${name(next.layout)}, the color system from ${name(next.colors)}, the navigation from ${name(next.navigation)}, and the density from ${name(next.density)}. Preserve the project-specific accessibility and mobile requirements.`,
    });
  }

  return (
    <section className="act conversation-measure">
      <div className="conversation-heading">
        <p className="t-label ink-tertiary">Design direction</p>
        <h2 className="t-title-l">Choose how this project should feel</h2>
        <p className="t-body-m ink-secondary">
          These directions were created for this project. You can accept my
          recommendation, choose a different direction, or describe your own.
        </p>
      </div>

      {alternatives.length > 1 && mixedBase !== undefined && (
        <section className="direction-mixer" aria-labelledby="direction-mixer-title">
          <div>
            <p className="t-label ink-tertiary">Mix directions</p>
            <h3 className="t-title-m" id="direction-mixer-title">Compose the strongest parts</h3>
            <p className="t-body-s ink-secondary">The concept preview updates as you combine layout, color, navigation, and density.</p>
          </div>
          <DirectionPreview direction={mixedBase} index={alternatives.indexOf(mixedBase)} visualOverride={mixedVisual} />
          <div className="direction-mix-controls">
            {(["layout", "colors", "navigation", "density"] as const).map((axis) => (
              <label className="t-body-s" key={axis}>
                <span>{axis[0].toUpperCase() + axis.slice(1)}</span>
                <select value={mix[axis]} onChange={(event) => updateMix(axis, event.target.value)}>
                  {alternatives.map((alternative) => <option key={alternative.id} value={alternative.id}>{alternative.name.value}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      <button
        type="button"
        className="design-recommendation direction-accept"
        aria-pressed={choice.mode === "recommended"}
        onClick={() =>
          onChange({
            mode: "recommended",
            optionId: recommended?.id,
            value: direction.recommendedStyle.value,
          })
        }
      >
        <div>
          <span className="badge">Foundry recommends</span>
          <h3 className="t-title-m">{direction.recommendedStyle.value}</h3>
          <p className="t-body-m ink-secondary">{direction.reason.value}</p>
        </div>
        <span className="choice-check" aria-hidden="true">
          &#10003;
        </span>
      </button>

      <div className="direction-card-grid" role="radiogroup" aria-label="Generated design directions">
        {alternatives.map((alternative, index) => {
          const selected =
            (choice.mode === "recommended" && alternative.recommended.value) ||
            (choice.mode === "alternative" && choice.optionId === alternative.id);
          return (
            <button
              type="button"
              role="radio"
              aria-checked={selected}
              className="direction-card"
              data-selected={selected}
              key={alternative.id}
              onClick={() =>
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
                )
              }
            >
              <DirectionPreview direction={alternative} index={index} />
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
                <strong>Why it fits:</strong> {alternative.whyItFits.value}
              </span>
              <dl className="direction-facts">
                <div>
                  <dt>Layout</dt>
                  <dd>{alternative.layoutApproach.value}</dd>
                </div>
                <div>
                  <dt>Density</dt>
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

      <button
        type="button"
        className="btn-quiet direction-other-toggle"
        aria-expanded={other}
        onClick={() =>
          onChange(
            other
              ? {
                  mode: "recommended",
                  optionId: recommended?.id,
                  value: direction.recommendedStyle.value,
                }
              : { mode: "other", value: "" },
          )
        }
      >
        Describe your own style
      </button>

      {other && (
        <div className="design-other">
          <label htmlFor="design-direction-other" className="t-body-s">
            Describe the feeling you want
          </label>
          <textarea
            id="design-direction-other"
            className="plain-textarea"
            rows={2}
            placeholder="For example: warmer, more premium, or more playful"
            value={choice.value ?? ""}
            onChange={(event) =>
              onChange({ mode: "other", value: event.target.value })
            }
          />
        </div>
      )}
    </section>
  );
}
