"use client";

import type {
  DesignAlternative,
  ProjectDesignDirection,
} from "../../experience/contracts";

export type DesignDirectionChoice = Readonly<{
  mode: "recommended" | "alternative" | "other";
  optionId?: string;
  value?: string;
}>;

function DirectionPreview({
  direction,
}: Readonly<{ direction: DesignAlternative }>) {
  return (
    <div className="direction-preview" aria-hidden="true">
      <div className="direction-preview-nav">
        <span />
        <span />
        <span />
      </div>
      <div className="direction-preview-body">
        <span className="direction-preview-kicker">
          {direction.preview.typographyCharacter.value}
        </span>
        <span className="direction-preview-title" />
        <span className="direction-preview-copy wide" />
        <span className="direction-preview-copy" />
        <div className="direction-preview-panels">
          <span />
          <span />
          <span />
        </div>
      </div>
      <span className="direction-preview-mood">
        {direction.preview.colorMood.value}
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
        {alternatives.map((alternative) => {
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
