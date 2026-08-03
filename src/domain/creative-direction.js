import { ProjectDesignValidationError } from "./errors.js";

/**
 * Composition primitives are implementation mechanisms for the art-direction
 * board renderer and for generation. They are never shown to the customer as a
 * template name: the customer sees a project-specific direction name, while the
 * primitive tells the renderer and the builder how the surface is composed.
 *
 * `surfaceRoles` describes the ordered regions a board renderer must draw, so a
 * board is derived from machine-readable rules instead of one hardcoded layout.
 */
export const COMPOSITION_PRIMITIVES = Object.freeze({
  "immersive-hero": Object.freeze({
    label: "Immersive hero",
    surfaceRoles: Object.freeze(["full-bleed-stage", "overlay-caption", "quiet-index"]),
    suits: Object.freeze(["portfolio", "brand", "marketing"]),
    density: "spacious",
  }),
  "editorial-spread": Object.freeze({
    label: "Editorial spread",
    surfaceRoles: Object.freeze(["masthead", "lead-column", "sidebar-notes", "plate-grid"]),
    suits: Object.freeze(["portfolio", "brand", "marketing", "content"]),
    density: "balanced",
  }),
  "narrative-scroll": Object.freeze({
    label: "Narrative scroll",
    surfaceRoles: Object.freeze(["opening-statement", "chapter-band", "chapter-band", "closing-call"]),
    suits: Object.freeze(["portfolio", "brand", "marketing", "content", "developer"]),
    density: "spacious",
  }),
  "modular-gallery": Object.freeze({
    label: "Modular gallery",
    surfaceRoles: Object.freeze(["compact-identity", "tile-field", "filter-strip"]),
    suits: Object.freeze(["portfolio", "catalog", "content"]),
    density: "balanced",
  }),
  "asymmetric-split": Object.freeze({
    label: "Asymmetric split",
    surfaceRoles: Object.freeze(["anchor-panel", "offset-stage", "footnote-rail"]),
    suits: Object.freeze(["portfolio", "brand", "marketing"]),
    density: "balanced",
  }),
  "identity-work-canvas": Object.freeze({
    label: "Identity and work canvas",
    surfaceRoles: Object.freeze(["identity-block", "work-canvas", "contact-anchor"]),
    suits: Object.freeze(["portfolio", "brand"]),
    density: "spacious",
  }),
  "task-workspace": Object.freeze({
    label: "Task-first workspace",
    surfaceRoles: Object.freeze(["utility-rail", "task-header", "work-surface", "detail-panel"]),
    suits: Object.freeze(["application", "operations"]),
    density: "dense",
  }),
  "table-operations": Object.freeze({
    label: "Table-centric operations",
    surfaceRoles: Object.freeze(["utility-rail", "filter-bar", "record-table", "bulk-action-bar"]),
    suits: Object.freeze(["application", "operations"]),
    density: "dense",
  }),
  timeline: Object.freeze({
    label: "Timeline",
    surfaceRoles: Object.freeze(["period-header", "track-lane", "track-lane", "event-detail"]),
    suits: Object.freeze(["application", "operations"]),
    density: "balanced",
  }),
  calendar: Object.freeze({
    label: "Calendar",
    surfaceRoles: Object.freeze(["range-switcher", "grid-field", "slot-detail"]),
    suits: Object.freeze(["application", "operations"]),
    density: "balanced",
  }),
  "guided-flow": Object.freeze({
    label: "Guided conversion flow",
    surfaceRoles: Object.freeze(["progress-spine", "single-question", "assurance-note", "advance-action"]),
    suits: Object.freeze(["application", "marketing", "operations"]),
    density: "spacious",
  }),
  "command-surface": Object.freeze({
    label: "Command surface",
    surfaceRoles: Object.freeze(["command-input", "result-list", "keyboard-legend"]),
    suits: Object.freeze(["application", "developer"]),
    density: "dense",
  }),
  "conversation-surface": Object.freeze({
    label: "Conversation surface",
    surfaceRoles: Object.freeze(["thread-rail", "message-stream", "composer-dock"]),
    suits: Object.freeze(["application", "developer"]),
    density: "balanced",
  }),
  "documentation-explorer": Object.freeze({
    label: "Documentation explorer",
    surfaceRoles: Object.freeze(["reference-tree", "prose-column", "example-pane"]),
    suits: Object.freeze(["developer", "content"]),
    density: "dense",
  }),
  catalog: Object.freeze({
    label: "Catalog",
    surfaceRoles: Object.freeze(["search-header", "facet-rail", "product-grid"]),
    suits: Object.freeze(["catalog", "marketing", "operations"]),
    density: "balanced",
  }),
  "map-led": Object.freeze({
    label: "Map-led surface",
    surfaceRoles: Object.freeze(["map-stage", "result-rail", "locate-action"]),
    suits: Object.freeze(["application", "operations", "marketing"]),
    density: "balanced",
  }),
  "profile-led": Object.freeze({
    label: "Profile-led surface",
    surfaceRoles: Object.freeze(["profile-header", "credential-strip", "activity-column"]),
    suits: Object.freeze(["application", "portfolio", "operations"]),
    density: "balanced",
  }),
  "mobile-stacked": Object.freeze({
    label: "Mobile-first stacked experience",
    surfaceRoles: Object.freeze(["thumb-header", "stacked-card", "stacked-card", "sticky-action"]),
    suits: Object.freeze(["application", "marketing", "operations"]),
    density: "balanced",
  }),
});

export const COMPOSITION_PRIMITIVE_IDS = Object.freeze(
  Object.keys(COMPOSITION_PRIMITIVES),
);

/**
 * Maps ProjectFamily values (and loose synonyms) onto the `suits` vocabulary.
 * Without this the derivation silently falls back to "application" and a
 * photographer's portfolio is offered a calendar board.
 */
const FAMILY_ALIASES = Object.freeze({
  "web-application": "application",
  "marketing-website": "marketing",
  "api-service": "developer",
  "developer-tool": "developer",
  "content-site": "content",
  "portfolio-site": "portfolio",
  portfolio: "portfolio",
  marketing: "marketing",
  brand: "brand",
  application: "application",
  operations: "operations",
  developer: "developer",
  content: "content",
  catalog: "catalog",
});

export function normalizeDesignFamily(family) {
  const key = String(family ?? "").toLowerCase();
  return FAMILY_ALIASES[key] ?? "application";
}

export const CREATIVE_DNA_ENUMS = Object.freeze({
  compositionPrimitive: COMPOSITION_PRIMITIVE_IDS,
  typeScale: ["dramatic", "editorial", "measured", "utilitarian", "monumental"],
  typeVoice: ["serif-authority", "grotesque-neutral", "humanist-warm", "mono-technical", "display-expressive"],
  imageryTreatment: ["none", "full-bleed", "framed-plate", "contact-sheet", "duotone", "documentary", "diagrammatic"],
  motionStrategy: ["static", "restrained", "responsive", "cinematic", "physical"],
  spacingRhythm: ["tight-grid", "steady-beat", "wide-breath", "irregular-accent"],
  surfaceDepth: ["paper-flat", "hairline-ruled", "soft-elevation", "layered-glass", "immersive-void"],
  responsiveTransform: ["reflow-columns", "collapse-to-stack", "swap-navigation", "prioritise-primary-task", "carousel-horizontal"],
});

const CREATIVE_DNA_ENUM_KEYS = Object.freeze(Object.keys(CREATIVE_DNA_ENUMS));

const CREATIVE_DNA_TEXT_KEYS = Object.freeze([
  "thesis",
  "emotionalGoal",
  "audienceResponse",
]);

const CREATIVE_DNA_LIST_KEYS = Object.freeze(["surfaceSequence", "exclusions"]);

export const CREATIVE_DNA_KEYS = Object.freeze([
  ...CREATIVE_DNA_TEXT_KEYS,
  ...CREATIVE_DNA_ENUM_KEYS,
  ...CREATIVE_DNA_LIST_KEYS,
]);

export const CREATIVE_DNA_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [...CREATIVE_DNA_KEYS],
  properties: Object.freeze({
    thesis: { type: "string", minLength: 1, maxLength: 240 },
    emotionalGoal: { type: "string", minLength: 1, maxLength: 160 },
    audienceResponse: { type: "string", minLength: 1, maxLength: 160 },
    ...Object.fromEntries(
      CREATIVE_DNA_ENUM_KEYS.map((key) => [
        key,
        { type: "string", enum: CREATIVE_DNA_ENUMS[key] },
      ]),
    ),
    surfaceSequence: {
      type: "array",
      minItems: 2,
      maxItems: 6,
      items: { type: "string", minLength: 1, maxLength: 60 },
    },
    exclusions: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
  }),
});

function fail(message) {
  throw new ProjectDesignValidationError(message);
}

function text(value, label, { max = 400 } = {}) {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim().slice(0, max);
}

function stringList(value, label, { min = 1, max = 6, unique = true } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail(`${label} must contain at least ${min} entries.`);
  }
  const normalized = value
    .slice(0, max)
    .map((entry, index) => text(entry, `${label}[${index}]`, { max: 120 }));
  if (unique) {
    const seen = new Set(normalized.map((entry) => entry.toLowerCase()));
    if (seen.size !== normalized.length) fail(`${label} contains duplicates.`);
  }
  return normalized;
}

/**
 * Deterministic, project-grounded fallback. Unlike a hash-shuffled visual
 * system this reads the alternative's own stated intent, so two alternatives
 * that genuinely differ produce genuinely different DNA, and an alternative
 * that says nothing distinct produces DNA that the quality authority can
 * legitimately reject.
 */
export function deriveCreativeDNA(alternative, { family = "application", index = 0 } = {}) {
  const resolvedFamily = normalizeDesignFamily(family);
  const lower = (values) =>
    values
      .filter((value) => typeof value === "string")
      .join(" ")
      .toLowerCase();
  // Layout intent is authoritative; the rest is only a tie-breaker.
  const layoutSource = lower([alternative?.layoutApproach, alternative?.name]);
  const source = lower([
    alternative?.name,
    alternative?.layoutApproach,
    alternative?.visualPersonality,
    alternative?.navigationApproach,
    alternative?.whyItFits,
  ]);

  const primitive = inferCompositionPrimitive(
    layoutSource,
    resolvedFamily,
    index,
    source,
  );
  const spec = COMPOSITION_PRIMITIVES[primitive];
  return Object.freeze({
    thesis: text(
      alternative?.whyItFits ?? alternative?.visualPersonality ?? spec.label,
      "creativeDNA.thesis",
      { max: 240 },
    ),
    emotionalGoal: text(
      alternative?.visualPersonality ?? spec.label,
      "creativeDNA.emotionalGoal",
      { max: 160 },
    ),
    audienceResponse: text(
      alternative?.whyItFits ?? spec.label,
      "creativeDNA.audienceResponse",
      { max: 160 },
    ),
    compositionPrimitive: primitive,
    typeScale: inferEnum("typeScale", source, index),
    typeVoice: inferEnum("typeVoice", source, index),
    imageryTreatment: inferEnum("imageryTreatment", source, index),
    motionStrategy: inferEnum("motionStrategy", source, index),
    spacingRhythm: inferEnum("spacingRhythm", source, index),
    surfaceDepth: inferEnum("surfaceDepth", source, index),
    responsiveTransform: inferEnum("responsiveTransform", source, index),
    surfaceSequence: [...spec.surfaceRoles].slice(0, 5),
    exclusions: [
      `This direction deliberately omits treatments that fight its ${spec.label.toLowerCase()} composition.`,
    ],
  });
}

/**
 * Set-aware derivation. Deriving each alternative in isolation lets two
 * directions collapse onto the same primitive (and therefore the same board),
 * which is precisely the "three renamed versions of one layout" failure. This
 * derives the whole set and de-collides both the composition primitive and the
 * secondary axes, so a derived set is honestly differentiated.
 */
export function deriveCreativeDNASet(alternatives, options = {}) {
  const family = normalizeDesignFamily(options.family);
  const list = Array.isArray(alternatives) ? alternatives : [];
  const taken = new Set();
  const spread = new Map();

  return list.map((alternative, index) => {
    const base = deriveCreativeDNA(alternative, { family, index });
    let primitive = base.compositionPrimitive;
    if (taken.has(primitive)) {
      const pool = COMPOSITION_PRIMITIVE_IDS.filter(
        (id) =>
          !taken.has(id) && COMPOSITION_PRIMITIVES[id].suits.includes(family),
      );
      const fallback = pool.length > 0
        ? pool
        : COMPOSITION_PRIMITIVE_IDS.filter((id) => !taken.has(id));
      if (fallback.length > 0) {
        primitive = fallback[index % fallback.length];
      }
    }
    taken.add(primitive);

    const spec = COMPOSITION_PRIMITIVES[primitive];
    const axes = Object.fromEntries(
      ["typeScale", "typeVoice", "imageryTreatment", "motionStrategy", "spacingRhythm", "surfaceDepth", "responsiveTransform"].map(
        (key) => {
          const values = CREATIVE_DNA_ENUMS[key];
          const used = spread.get(key) ?? new Set();
          let value = base[key];
          if (used.has(value)) {
            const free = values.filter((candidate) => !used.has(candidate));
            if (free.length > 0) value = free[index % free.length];
          }
          used.add(value);
          spread.set(key, used);
          return [key, value];
        },
      ),
    );

    return Object.freeze({
      ...base,
      ...axes,
      compositionPrimitive: primitive,
      surfaceSequence: Object.freeze([...spec.surfaceRoles].slice(0, 5)),
      exclusions: Object.freeze([
        `This direction deliberately omits treatments that fight its ${spec.label.toLowerCase()} composition.`,
      ]),
    });
  });
}

const PRIMITIVE_HINTS = Object.freeze([
  [/full[- ]?screen|immersive|cinematic|photograph|film|reel/u, "immersive-hero"],
  [/editorial|magazine|spread|journal|essay|type[- ]led/u, "editorial-spread"],
  [/narrative|story|scroll|chapter|essay/u, "narrative-scroll"],
  [/gallery|grid|contact sheet|tile|portfolio wall/u, "modular-gallery"],
  [/asymmetric|offset|diagonal|split/u, "asymmetric-split"],
  [/identity|studio|about|bio|practice/u, "identity-work-canvas"],
  [/table|record|roster|ledger|list view|bulk/u, "table-operations"],
  [/calendar|availability|slot|schedule/u, "calendar"],
  [/timeline|history|track|stage|pipeline/u, "timeline"],
  [/wizard|step|guided|booking flow|checkout|apply|claim/u, "guided-flow"],
  [/command|palette|keyboard|terminal/u, "command-surface"],
  [/chat|conversation|thread|message|assistant/u, "conversation-surface"],
  [/documentation|reference|endpoint|api|developer|sdk/u, "documentation-explorer"],
  [/catalog|menu|browse|shop|listing/u, "catalog"],
  [/map|location|coverage|area|dispatch/u, "map-led"],
  [/profile|account|member|parent|student|staff/u, "profile-led"],
  [/mobile|thumb|on[- ]the[- ]go|phone[- ]first/u, "mobile-stacked"],
  [/dashboard|workspace|console|operations|queue|approval/u, "task-workspace"],
]);

function inferCompositionPrimitive(layoutSource, family, index, wideSource = layoutSource) {
  for (const [pattern, primitive] of PRIMITIVE_HINTS) {
    if (pattern.test(layoutSource)) return primitive;
  }
  for (const [pattern, primitive] of PRIMITIVE_HINTS) {
    if (pattern.test(wideSource)) return primitive;
  }
  const suitable = COMPOSITION_PRIMITIVE_IDS.filter((id) =>
    COMPOSITION_PRIMITIVES[id].suits.includes(family),
  );
  const pool = suitable.length > 0 ? suitable : COMPOSITION_PRIMITIVE_IDS;
  return pool[index % pool.length];
}

function inferEnum(key, source, index) {
  const values = CREATIVE_DNA_ENUMS[key];
  let hash = 2166136261 ^ index;
  for (const character of source) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return values[(hash >>> 0) % values.length];
}

export function normalizeCreativeDNA(value, label = "creativeDNA") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  const unexpected = Object.keys(value).filter(
    (key) => !CREATIVE_DNA_KEYS.includes(key),
  );
  if (unexpected.length > 0) {
    fail(`${label} contains unsupported fields: ${unexpected.join(", ")}.`);
  }
  const missing = CREATIVE_DNA_KEYS.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) {
    fail(`${label} is missing: ${missing.join(", ")}.`);
  }
  for (const key of CREATIVE_DNA_ENUM_KEYS) {
    if (!CREATIVE_DNA_ENUMS[key].includes(value[key])) {
      fail(`${label}.${key} is unsupported: ${String(value[key])}.`);
    }
  }
  return Object.freeze({
    thesis: text(value.thesis, `${label}.thesis`, { max: 240 }),
    emotionalGoal: text(value.emotionalGoal, `${label}.emotionalGoal`, { max: 160 }),
    audienceResponse: text(value.audienceResponse, `${label}.audienceResponse`, { max: 160 }),
    ...Object.fromEntries(CREATIVE_DNA_ENUM_KEYS.map((key) => [key, value[key]])),
    surfaceSequence: Object.freeze(
      // A surface sequence is an ordered walk, so a repeated region (two
      // chapter bands, two track lanes) is meaningful rather than a duplicate.
      stringList(value.surfaceSequence, `${label}.surfaceSequence`, {
        min: 2,
        max: 6,
        unique: false,
      }),
    ),
    exclusions: Object.freeze(
      stringList(value.exclusions, `${label}.exclusions`, { min: 1, max: 4 }),
    ),
  });
}

/** Machine-readable board recipe. The renderer draws from this, not from prose. */
export function boardRecipe(dna) {
  const spec = COMPOSITION_PRIMITIVES[dna.compositionPrimitive];
  return Object.freeze({
    primitive: dna.compositionPrimitive,
    primitiveLabel: spec.label,
    regions: Object.freeze([...spec.surfaceRoles]),
    typeScale: dna.typeScale,
    typeVoice: dna.typeVoice,
    imageryTreatment: dna.imageryTreatment,
    motionStrategy: dna.motionStrategy,
    spacingRhythm: dna.spacingRhythm,
    surfaceDepth: dna.surfaceDepth,
    responsiveTransform: dna.responsiveTransform,
  });
}
