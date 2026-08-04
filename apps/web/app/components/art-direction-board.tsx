"use client";

import type { CSSProperties, ReactNode } from "react";

import type { CreativeDNA, DesignAlternative } from "../../experience/contracts";

/**
 * A composable art-direction board.
 *
 * The board is NOT a fake finished website and it is NOT one hardcoded
 * composition reskinned per direction. Every region below is drawn from the
 * direction's own machine-readable creative DNA: the composition primitive
 * chooses the grid and the ordered regions, the type scale and voice size the
 * specimen, the imagery treatment decides how plates are drawn, spacing rhythm
 * sets the beat, surface depth sets elevation, and the responsive transform
 * drives the phone inset. Two directions with different DNA cannot render the
 * same board.
 */

type RegionKind =
  | "full-bleed-stage" | "overlay-caption" | "quiet-index"
  | "masthead" | "lead-column" | "sidebar-notes" | "plate-grid"
  | "opening-statement" | "chapter-band" | "closing-call"
  | "compact-identity" | "tile-field" | "filter-strip"
  | "anchor-panel" | "offset-stage" | "footnote-rail"
  | "identity-block" | "work-canvas" | "contact-anchor"
  | "utility-rail" | "task-header" | "work-surface" | "detail-panel"
  | "filter-bar" | "record-table" | "bulk-action-bar"
  | "period-header" | "track-lane" | "event-detail"
  | "range-switcher" | "grid-field" | "slot-detail"
  | "progress-spine" | "single-question" | "assurance-note" | "advance-action"
  | "command-input" | "result-list" | "keyboard-legend"
  | "thread-rail" | "message-stream" | "composer-dock"
  | "reference-tree" | "prose-column" | "example-pane"
  | "search-header" | "facet-rail" | "product-grid"
  | "map-stage" | "result-rail" | "locate-action"
  | "profile-header" | "credential-strip" | "activity-column"
  | "thumb-header" | "stacked-card" | "sticky-action";

/** Grid templates per primitive. Areas are region slots, filled in DNA order. */
const PRIMITIVE_GRIDS: Readonly<Record<string, string>> = {
  "immersive-hero": '"a a" "a a" "b c"',
  "editorial-spread": '"a a a" "b b c" "d d d"',
  "narrative-scroll": '"a a" "b b" "c c" "d d"',
  "modular-gallery": '"a a a" "b b b" "c c c"',
  "asymmetric-split": '"a b b" "a b b" "c c c"',
  "identity-work-canvas": '"a b b" "a b b" "c b b"',
  "task-workspace": '"a b b" "a c d" "a c d"',
  "table-operations": '"a b b" "a c c" "a d d"',
  timeline: '"a a a" "b b b" "c c c" "d d d"',
  calendar: '"a a a" "b b b" "b b b" "c c c"',
  "guided-flow": '"a a a" "b b b" "b b b" "c c d"',
  "command-surface": '"a a" "b b" "b b" "c c"',
  "conversation-surface": '"a b b" "a b b" "a c c"',
  "documentation-explorer": '"a b b c" "a b b c" "a b b c"',
  catalog: '"a a a" "b c c" "b c c"',
  "map-led": '"a a b" "a a b" "a a c"',
  "profile-led": '"a a" "b b" "c c"',
  "mobile-stacked": '"a" "b" "c" "d"',
};

const AREA_KEYS = ["a", "b", "c", "d", "e", "f"] as const;

const TYPE_SCALE_RATIO: Readonly<Record<string, number>> = {
  monumental: 1.0,
  dramatic: 0.82,
  editorial: 0.66,
  measured: 0.54,
  utilitarian: 0.44,
};

const TYPE_VOICE_STACK: Readonly<Record<string, string>> = {
  "serif-authority": 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  "grotesque-neutral": '"Helvetica Neue", Inter, Arial, sans-serif',
  "humanist-warm": '"Segoe UI", Tahoma, Verdana, sans-serif',
  "mono-technical": '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  "display-expressive": '"Didot", "Bodoni MT", Georgia, serif',
};

const SPACING_BEAT: Readonly<Record<string, number>> = {
  "tight-grid": 3,
  "steady-beat": 6,
  "wide-breath": 11,
  "irregular-accent": 7,
};

function ratio(dna: CreativeDNA | undefined) {
  return TYPE_SCALE_RATIO[dna?.typeScale ?? "measured"] ?? 0.54;
}

/** Imagery plates rendered honestly per treatment, never one grey box. */
function Plate({ dna, tall = false }: Readonly<{ dna?: CreativeDNA; tall?: boolean }>) {
  const treatment = dna?.imageryTreatment ?? "framed-plate";
  if (treatment === "none") {
    return <span className="ab-plate ab-plate-none" aria-hidden="true" />;
  }
  if (treatment === "contact-sheet") {
    return (
      <span className="ab-plate ab-plate-sheet" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <i key={index} />)}
      </span>
    );
  }
  if (treatment === "diagrammatic") {
    return (
      <span className="ab-plate ab-plate-diagram" aria-hidden="true">
        <i /><i /><i />
      </span>
    );
  }
  return (
    <span
      className="ab-plate"
      data-treatment={treatment}
      data-tall={tall || undefined}
      aria-hidden="true"
    />
  );
}

function TypeSpecimen({
  dna,
  text,
  weight = 600,
  scale = 1,
}: Readonly<{ dna?: CreativeDNA; text: string; weight?: number; scale?: number }>) {
  const style: CSSProperties = {
    fontFamily: TYPE_VOICE_STACK[dna?.typeVoice ?? "grotesque-neutral"],
    fontSize: `${(0.5 + ratio(dna) * 1.35) * scale}rem`,
    lineHeight: ratio(dna) > 0.7 ? 1.02 : 1.18,
    letterSpacing: ratio(dna) > 0.7 ? "-0.03em" : "-0.005em",
    fontWeight: weight,
  };
  return <span className="ab-specimen" style={style}>{text}</span>;
}

/**
 * Real copy set at the approved rhythm.
 *
 * This used to draw grey placeholder bars, which made every board read as a
 * wireframe rather than as the page the customer will actually get. It now
 * renders the direction's own words in the approved typeface, so the board is
 * a miniature of the result instead of a schematic beside it.
 */
function Rhythm({
  dna,
  lines = 3,
  text,
}: Readonly<{ dna?: CreativeDNA; lines?: number; text?: string }>) {
  const beat = SPACING_BEAT[dna?.spacingRhythm ?? "steady-beat"] ?? 6;
  const copy = text ?? dna?.audienceResponse ?? dna?.thesis ?? "";
  if (copy.trim() === "") {
    return (
      <span className="ab-rhythm" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <i key={index} style={{ marginBlockEnd: `${beat}px`, inlineSize: `${100 - index * 13}%` }} />
        ))}
      </span>
    );
  }
  return (
    <span
      className="ab-prose"
      aria-hidden="true"
      style={{
        fontFamily: TYPE_VOICE_STACK[dna?.typeVoice ?? "grotesque-neutral"],
        fontSize: `${0.34 + ratio(dna) * 0.16}rem`,
        lineHeight: 1.45,
        marginBlockEnd: `${beat}px`,
        WebkitLineClamp: lines,
      }}
    >
      {copy}
    </span>
  );
}

function Nav({
  kind,
  label,
  dna,
}: Readonly<{ kind: "rail" | "bar" | "tree" | "none"; label: string; dna?: CreativeDNA }>) {
  if (kind === "none") return null;
  if (kind === "rail" || kind === "tree") {
    return (
      <span className="ab-nav" data-kind={kind} aria-hidden="true">
        <b style={{ fontFamily: TYPE_VOICE_STACK[dna?.typeVoice ?? "grotesque-neutral"] }}>{label}</b>
        {Array.from({ length: kind === "tree" ? 6 : 4 }, (_, index) => <i key={index} />)}
      </span>
    );
  }
  return (
    <span className="ab-nav" data-kind="bar" aria-hidden="true">
      <b style={{ fontFamily: TYPE_VOICE_STACK[dna?.typeVoice ?? "grotesque-neutral"] }}>{label}</b>
      <span className="ab-nav-links">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</span>
    </span>
  );
}

function Region({
  kind,
  direction,
  dna,
}: Readonly<{ kind: RegionKind; direction: DesignAlternative; dna?: CreativeDNA }>) {
  const name = direction.name.value;
  const words = dna?.emotionalGoal ?? direction.visualPersonality.value;

  const content: Partial<Record<RegionKind, ReactNode>> = {
    "full-bleed-stage": <><Plate dna={dna} tall /><span className="ab-overlay"><TypeSpecimen dna={dna} text={name} /></span></>,
    "overlay-caption": <><TypeSpecimen dna={dna} text={words} scale={0.42} weight={400} /><Rhythm dna={dna} lines={2} /></>,
    "quiet-index": <Nav kind="bar" label="Index" dna={dna} />,
    masthead: <><TypeSpecimen dna={dna} text={name} /><Nav kind="bar" label="" dna={dna} /></>,
    "lead-column": <><TypeSpecimen dna={dna} text={words} scale={0.5} weight={500} /><Rhythm dna={dna} lines={5} /></>,
    "sidebar-notes": <Rhythm dna={dna} lines={4} />,
    "plate-grid": <span className="ab-tiles" aria-hidden="true">{Array.from({ length: 3 }, (_, index) => <Plate dna={dna} key={index} />)}</span>,
    "opening-statement": <TypeSpecimen dna={dna} text={name} />,
    "chapter-band": <><Plate dna={dna} /><Rhythm dna={dna} lines={2} /></>,
    "closing-call": <span className="ab-action" aria-hidden="true" />,
    "compact-identity": <><TypeSpecimen dna={dna} text={name} scale={0.55} /><Nav kind="bar" label="" dna={dna} /></>,
    "tile-field": <span className="ab-tiles" data-wide aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <Plate dna={dna} key={index} />)}</span>,
    "filter-strip": <span className="ab-chips" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</span>,
    "anchor-panel": <><TypeSpecimen dna={dna} text={name} scale={0.7} /><Rhythm dna={dna} lines={3} /></>,
    "offset-stage": <Plate dna={dna} tall />,
    "footnote-rail": <Rhythm dna={dna} lines={2} />,
    "identity-block": <><TypeSpecimen dna={dna} text={name} scale={0.66} /><Rhythm dna={dna} lines={3} /></>,
    "work-canvas": <span className="ab-tiles" data-wide aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <Plate dna={dna} key={index} />)}</span>,
    "contact-anchor": <span className="ab-action" aria-hidden="true" />,
    "utility-rail": <Nav kind="rail" label={name.slice(0, 12)} dna={dna} />,
    "task-header": <><TypeSpecimen dna={dna} text={name} scale={0.42} /><span className="ab-chips" aria-hidden="true"><i /><i /></span></>,
    "work-surface": <span className="ab-rows" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</span>,
    "detail-panel": <Rhythm dna={dna} lines={4} />,
    "filter-bar": <span className="ab-chips" aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</span>,
    "record-table": <span className="ab-table" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span>,
    "bulk-action-bar": <span className="ab-action" data-compact aria-hidden="true" />,
    "period-header": <><TypeSpecimen dna={dna} text={name} scale={0.4} /><span className="ab-chips" aria-hidden="true"><i /><i /><i /></span></>,
    "track-lane": <span className="ab-track" aria-hidden="true"><i style={{ inlineSize: "42%", marginInlineStart: "8%" }} /><i style={{ inlineSize: "28%", marginInlineStart: "6%" }} /></span>,
    "event-detail": <Rhythm dna={dna} lines={3} />,
    "range-switcher": <span className="ab-chips" aria-hidden="true"><i /><i /><i /></span>,
    "grid-field": <span className="ab-calendar" aria-hidden="true">{Array.from({ length: 21 }, (_, index) => <i key={index} />)}</span>,
    "slot-detail": <Rhythm dna={dna} lines={2} />,
    "progress-spine": <span className="ab-steps" aria-hidden="true"><i data-on /><i /><i /></span>,
    "single-question": <><TypeSpecimen dna={dna} text={words} scale={0.6} weight={500} /><Rhythm dna={dna} lines={2} /></>,
    "assurance-note": <Rhythm dna={dna} lines={1} />,
    "advance-action": <span className="ab-action" aria-hidden="true" />,
    "command-input": <span className="ab-command" aria-hidden="true"><b>›</b><i /></span>,
    "result-list": <span className="ab-rows" data-mono aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</span>,
    "keyboard-legend": <span className="ab-chips" data-tiny aria-hidden="true"><i /><i /><i /><i /></span>,
    "thread-rail": <Nav kind="rail" label="Threads" dna={dna} />,
    "message-stream": <span className="ab-messages" aria-hidden="true"><i /><i data-self /><i /><i data-self /></span>,
    "composer-dock": <span className="ab-command" aria-hidden="true"><i /><b>↵</b></span>,
    "reference-tree": <Nav kind="tree" label="Reference" dna={dna} />,
    "prose-column": <><TypeSpecimen dna={dna} text={words} scale={0.44} weight={500} /><Rhythm dna={dna} lines={5} /></>,
    "example-pane": <span className="ab-rows" data-mono aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span>,
    "search-header": <><span className="ab-command" aria-hidden="true"><i /></span><span className="ab-chips" aria-hidden="true"><i /><i /></span></>,
    "facet-rail": <Nav kind="rail" label="Filter" dna={dna} />,
    "product-grid": <span className="ab-tiles" data-wide aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <Plate dna={dna} key={index} />)}</span>,
    "map-stage": <span className="ab-map" aria-hidden="true"><i /><i /><i /></span>,
    "result-rail": <span className="ab-rows" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</span>,
    "locate-action": <span className="ab-action" data-compact aria-hidden="true" />,
    "profile-header": <><Plate dna={dna} /><TypeSpecimen dna={dna} text={name} scale={0.5} /></>,
    "credential-strip": <span className="ab-chips" aria-hidden="true"><i /><i /><i /></span>,
    "activity-column": <span className="ab-rows" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</span>,
    "thumb-header": <><TypeSpecimen dna={dna} text={name} scale={0.45} /><Nav kind="bar" label="" dna={dna} /></>,
    "stacked-card": <><Plate dna={dna} /><Rhythm dna={dna} lines={2} /></>,
    "sticky-action": <span className="ab-action" aria-hidden="true" />,
  };

  return (
    <div className="ab-region" data-region={kind}>
      {content[kind] ?? <Rhythm dna={dna} lines={3} />}
    </div>
  );
}

/** The phone inset makes the responsive transform visible, not just claimed. */
function PhoneInset({ dna }: Readonly<{ dna?: CreativeDNA }>) {
  const transform = dna?.responsiveTransform ?? "collapse-to-stack";
  return (
    <div className="ab-phone" data-transform={transform} aria-hidden="true">
      <span className="ab-phone-bar" />
      {transform === "carousel-horizontal" ? (
        <span className="ab-phone-carousel"><i /><i /><i /></span>
      ) : (
        <span className="ab-phone-stack">
          <i />
          <i />
          {transform === "prioritise-primary-task" ? null : <i />}
        </span>
      )}
      {transform === "swap-navigation" || transform === "prioritise-primary-task" ? (
        <span className="ab-phone-dock" />
      ) : null}
    </div>
  );
}

export function ArtDirectionBoard({
  direction,
  compact = false,
}: Readonly<{ direction: DesignAlternative; compact?: boolean }>) {
  const dna = direction.creativeDNA;
  const system = direction.visualSystem;
  const primitive = dna?.compositionPrimitive ?? "editorial-spread";
  const grid = PRIMITIVE_GRIDS[primitive] ?? PRIMITIVE_GRIDS["editorial-spread"];
  const regions = (dna?.surfaceSequence ?? ["masthead", "lead-column", "sidebar-notes", "plate-grid"]) as readonly RegionKind[];

  const colors = system?.colorRoles;
  const style = {
    "--ab-bg": colors?.background ?? "#f5f3ee",
    "--ab-surface": colors?.surface ?? "#ffffff",
    "--ab-primary": colors?.primary ?? "#1f3b34",
    "--ab-accent": colors?.accent ?? "#c8703c",
    "--ab-text": colors?.text ?? "#171f1d",
    "--ab-grid": grid,
    "--ab-beat": `${SPACING_BEAT[dna?.spacingRhythm ?? "steady-beat"] ?? 6}px`,
  } as CSSProperties;

  return (
    <figure
      className="art-board-v2"
      data-primitive={primitive}
      data-depth={dna?.surfaceDepth ?? "hairline-ruled"}
      data-motion={dna?.motionStrategy ?? "restrained"}
      data-imagery={dna?.imageryTreatment ?? "framed-plate"}
      data-compact={compact || undefined}
      style={style}
    >
      <div className="ab-canvas" role="img" aria-label={boardDescription(direction)}>
        {regions.slice(0, AREA_KEYS.length).map((region, index) => (
          <div
            className="ab-slot"
            style={{ gridArea: AREA_KEYS[index] }}
            key={`${region}-${index}`}
          >
            <Region kind={region} direction={direction} dna={dna} />
          </div>
        ))}
        <PhoneInset dna={dna} />
      </div>
      <figcaption className="ab-caption">
        <span className="ab-palette" aria-hidden="true">
          {[colors?.background, colors?.surface, colors?.primary, colors?.accent, colors?.text]
            .filter((value): value is string => Boolean(value))
            .map((color, index) => <i key={`${color}-${index}`} style={{ background: color }} />)}
        </span>
        {dna ? (
          <span className="ab-caption-meta">
            {dna.typeVoice.replaceAll("-", " ")} · {dna.typeScale} scale · {dna.motionStrategy} motion
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Screen-reader description; the board itself is decorative geometry. */
export function boardDescription(direction: DesignAlternative) {
  const dna = direction.creativeDNA;
  if (!dna) return `Art direction concept for ${direction.name.value}.`;
  return [
    `${direction.name.value}:`,
    `${dna.compositionPrimitive.replaceAll("-", " ")} composition`,
    `with ${dna.typeVoice.replaceAll("-", " ")} typography at ${dna.typeScale} scale,`,
    `${dna.imageryTreatment.replaceAll("-", " ")} imagery,`,
    `${dna.spacingRhythm.replaceAll("-", " ")} spacing,`,
    `${dna.motionStrategy} motion,`,
    `and ${dna.responsiveTransform.replaceAll("-", " ")} on phones.`,
  ].join(" ");
}
