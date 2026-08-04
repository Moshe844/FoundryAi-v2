import { COMPOSITION_PRIMITIVES } from "./creative-direction.js";

/**
 * Per-aspect design-fidelity verdicts.
 *
 * The existing gate answers one question — "is this plan admissible?" — and a
 * single boolean cannot tell a repair strategist WHAT to fix. This produces an
 * independent verdict per design aspect from real browser evidence, so a
 * failure names the aspect, the measurement that failed, and the scope a
 * repair must touch.
 *
 * These verdicts are deterministic. The model-assisted critic in
 * visual-critique.js contributes advisory evidence only and can never turn a
 * FAIL here into a PASS.
 */

export const DESIGN_ASPECTS = Object.freeze([
  "composition",
  "hierarchy",
  "typography",
  "colors",
  "spacing",
  "imagery",
  "navigation",
  "interactions",
  "responsive",
  "accessibility",
  "exclusions",
]);

export const AspectVerdict = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  UNPROVEN: "UNPROVEN",
});

/**
 * Viewport evidence captured by browser verification.
 * @typedef {{width:number,height:number,screenshotPath?:string,
 *            horizontalOverflow?:boolean,
 *            navigation?:{present:boolean,position?:string,role?:string},
 *            typography?:Array<{selector:string,fontFamily:string,fontSize:string,
 *                               fontWeight?:string,lineHeight?:string}>,
 *            colors?:Array<{selector:string,color?:string,backgroundColor?:string}>,
 *            geometry?:Array<{selector:string,x:number,y:number,
 *                             width:number,height:number}>,
 *            focusVisible?:boolean,
 *            imageCount?:number,
 *            motion?:{respectsReducedMotion?:boolean}}} ViewportEvidence
 */

function fail(aspect, summary, detail) {
  return Object.freeze({ aspect, verdict: AspectVerdict.FAIL, summary, detail: Object.freeze(detail ?? {}) });
}
function pass(aspect, summary, detail) {
  return Object.freeze({ aspect, verdict: AspectVerdict.PASS, summary, detail: Object.freeze(detail ?? {}) });
}
function unproven(aspect, summary) {
  return Object.freeze({
    aspect,
    verdict: AspectVerdict.UNPROVEN,
    summary,
    detail: Object.freeze({}),
  });
}

function classifyViewport(width) {
  if (width <= 480) return "phone";
  if (width <= 1024) return "tablet";
  return "desktop";
}

function byClass(viewports) {
  const grouped = new Map();
  for (const viewport of viewports) {
    const key = classifyViewport(viewport.width);
    if (!grouped.has(key)) grouped.set(key, viewport);
  }
  return grouped;
}

function distinctFontFamilies(viewport) {
  return new Set(
    (viewport.typography ?? [])
      .map((entry) => String(entry.fontFamily ?? "").split(",")[0].trim().toLowerCase())
      .filter(Boolean),
  );
}

function numericSizes(viewport) {
  return (viewport.typography ?? [])
    .map((entry) => Number.parseFloat(String(entry.fontSize ?? "")))
    .filter((value) => Number.isFinite(value) && value > 0);
}

/** Normalizes any CSS colour the browser reports into a comparable key. */
function colorKey(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const rgb = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u);
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((channel) => Number(channel).toString(16).padStart(2, "0"))
      .join("")}`;
  }
  if (/^#[0-9a-f]{6}$/u.test(text)) return text;
  if (/^#[0-9a-f]{3}$/u.test(text)) {
    return `#${text.slice(1).split("").map((c) => c + c).join("")}`;
  }
  return text;
}

function channels(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/u.exec(hex);
  if (!match) return null;
  return [1, 2, 3].map((index) => Number.parseInt(match[index], 16));
}

function relativeLuminance(hex) {
  const rgb = channels(hex);
  if (rgb === null) return null;
  const [r, g, b] = rgb.map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const left = relativeLuminance(colorKey(foreground));
  const right = relativeLuminance(colorKey(background));
  if (left === null || right === null) return null;
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Approximate colour distance, so "the palette was honoured" tolerates blending. */
function colorDistance(left, right) {
  const a = channels(colorKey(left));
  const b = channels(colorKey(right));
  if (a === null || b === null) return null;
  return Math.sqrt(a.reduce((sum, channel, index) => sum + (channel - b[index]) ** 2, 0));
}

/* ---------------------------------------------------------------- aspects */

function compositionVerdict(dna, viewports) {
  if (!dna) return unproven("composition", "No approved composition primitive to verify against.");
  const desktop = byClass(viewports).get("desktop");
  if (!desktop?.geometry?.length) {
    return unproven("composition", "No desktop layout geometry was captured.");
  }
  const spec = COMPOSITION_PRIMITIVES[dna.compositionPrimitive];
  const expected = (spec?.surfaceRoles ?? dna.surfaceSequence ?? []).length;
  const regions = desktop.geometry.filter((box) => box.width > 0 && box.height > 0);
  if (regions.length < Math.min(expected, 3)) {
    return fail(
      "composition",
      `The approved ${dna.compositionPrimitive} composition needs at least ${Math.min(expected, 3)} distinct regions; ${regions.length} were rendered.`,
      { expectedRegions: expected, renderedRegions: regions.length },
    );
  }
  // An immersive opening must actually dominate the fold.
  if (dna.compositionPrimitive === "immersive-hero") {
    const tallest = Math.max(...regions.map((box) => box.height));
    if (tallest < desktop.height * 0.5) {
      return fail(
        "composition",
        "An immersive hero must fill at least half the opening viewport; the largest region does not.",
        { tallestRegion: tallest, viewportHeight: desktop.height },
      );
    }
  }
  return pass("composition", `Rendered ${regions.length} regions consistent with a ${dna.compositionPrimitive}.`, {
    renderedRegions: regions.length,
  });
}

function hierarchyVerdict(viewports) {
  const desktop = byClass(viewports).get("desktop");
  const sizes = desktop ? numericSizes(desktop) : [];
  if (sizes.length < 2) {
    return unproven("hierarchy", "Not enough typographic measurements to judge hierarchy.");
  }
  const largest = Math.max(...sizes);
  const smallest = Math.min(...sizes);
  if (largest / smallest < 1.5) {
    return fail(
      "hierarchy",
      `Type sizes span only ${(largest / smallest).toFixed(2)}x, which reads as a flat page with no visual hierarchy.`,
      { largest, smallest },
    );
  }
  return pass("hierarchy", `Type scale spans ${(largest / smallest).toFixed(2)}x.`, { largest, smallest });
}

function typographyVerdict(dna, viewports) {
  const desktop = byClass(viewports).get("desktop");
  if (!desktop?.typography?.length) {
    return unproven("typography", "No computed typography was captured.");
  }
  const families = distinctFontFamilies(desktop);
  if (families.size === 0) {
    return unproven("typography", "No font families were reported.");
  }
  if (families.size > 3) {
    return fail("typography", `${families.size} font families are in use; the approved system defines at most three.`, {
      families: [...families],
    });
  }
  // A direction that asked for a specific voice must not fall back to defaults.
  const generic = new Set(["times", "times new roman", "serif", "sans-serif", "-apple-system", "system-ui"]);
  if (dna && [...families].every((family) => generic.has(family))) {
    return fail(
      "typography",
      `The approved ${dna.typeVoice} voice is not implemented; only default system fonts are rendered.`,
      { families: [...families], approvedVoice: dna.typeVoice },
    );
  }
  return pass("typography", `${families.size} font families, consistent with the approved system.`, {
    families: [...families],
  });
}

function colorsVerdict(contract, viewports) {
  const roles = contract.visualSystem?.colorRoles;
  const desktop = byClass(viewports).get("desktop");
  const measured = desktop?.colors ?? [];
  if (!roles || measured.length === 0) {
    return unproven("colors", "No approved palette or no measured colours to compare.");
  }
  const approved = Object.values(roles).map(colorKey);
  const rendered = measured.flatMap((entry) => [entry.color, entry.backgroundColor].filter(Boolean)).map(colorKey);
  const matched = approved.filter((role) =>
    rendered.some((value) => {
      const distance = colorDistance(role, value);
      return distance !== null && distance <= 48;
    }),
  );
  if (matched.length < 2) {
    return fail(
      "colors",
      `Only ${matched.length} of the ${approved.length} approved colour roles appear in the rendered page.`,
      { approved, rendered: [...new Set(rendered)].slice(0, 12) },
    );
  }
  return pass("colors", `${matched.length} approved colour roles are present in the rendered page.`, {
    matchedRoles: matched.length,
  });
}

function spacingVerdict(viewports) {
  const desktop = byClass(viewports).get("desktop");
  const boxes = desktop?.geometry ?? [];
  if (boxes.length < 3) return unproven("spacing", "Not enough geometry to judge spacing rhythm.");
  const sorted = [...boxes].sort((left, right) => left.y - right.y);
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const gap = sorted[index].y - (sorted[index - 1].y + sorted[index - 1].height);
    if (gap >= 0) gaps.push(Math.round(gap));
  }
  if (gaps.length === 0) return unproven("spacing", "No vertical gaps could be measured.");
  // A single spacing scale should not produce dozens of unrelated gap values.
  const distinct = new Set(gaps.map((gap) => Math.round(gap / 4) * 4));
  if (distinct.size > Math.max(4, Math.ceil(gaps.length * 0.7))) {
    return fail(
      "spacing",
      `${distinct.size} unrelated vertical gaps across ${gaps.length} boundaries; spacing is not derived from one scale.`,
      { distinctGaps: [...distinct].slice(0, 12) },
    );
  }
  return pass("spacing", `Vertical gaps resolve to ${distinct.size} steps of a shared scale.`, {
    distinctGaps: [...distinct].slice(0, 12),
  });
}

function imageryVerdict(dna, viewports) {
  if (!dna) return unproven("imagery", "No approved imagery treatment.");
  const desktop = byClass(viewports).get("desktop");
  if (desktop?.imageCount === undefined) {
    return unproven("imagery", "Image count was not captured.");
  }
  if (dna.imageryTreatment === "none" && desktop.imageCount > 0) {
    return fail("imagery", `The approved direction excludes imagery, but ${desktop.imageCount} images are rendered.`, {
      imageCount: desktop.imageCount,
    });
  }
  if (dna.imageryTreatment !== "none" && desktop.imageCount === 0) {
    return fail(
      "imagery",
      `The approved ${dna.imageryTreatment} treatment requires imagery, but the page renders none.`,
      { approvedTreatment: dna.imageryTreatment },
    );
  }
  return pass("imagery", `Imagery matches the approved ${dna.imageryTreatment} treatment.`, {
    imageCount: desktop.imageCount,
  });
}

function navigationVerdict(contract, viewports) {
  const desktop = byClass(viewports).get("desktop");
  if (desktop?.navigation === undefined) {
    return unproven("navigation", "Navigation presence was not captured.");
  }
  if (!desktop.navigation.present) {
    return fail("navigation", "The approved navigation is not present in the rendered page.", {
      approved: contract.composition?.navigationApproach,
    });
  }
  return pass("navigation", "Navigation is present at desktop width.", {
    position: desktop.navigation.position,
  });
}

function interactionsVerdict(dna, viewports) {
  if (!dna) return unproven("interactions", "No approved motion strategy.");
  const anyViewport = viewports[0];
  if (anyViewport?.motion?.respectsReducedMotion === undefined) {
    return unproven("interactions", "Reduced-motion behaviour was not captured.");
  }
  if (dna.motionStrategy !== "static" && anyViewport.motion.respectsReducedMotion !== true) {
    return fail(
      "interactions",
      `The approved ${dna.motionStrategy} motion has no prefers-reduced-motion fallback.`,
      { motionStrategy: dna.motionStrategy },
    );
  }
  return pass("interactions", `Motion is ${dna.motionStrategy} and respects reduced-motion preferences.`, {});
}

function responsiveVerdict(viewports) {
  const grouped = byClass(viewports);
  const missing = ["phone", "tablet", "desktop"].filter((key) => !grouped.has(key));
  if (missing.length > 0) {
    return unproven("responsive", `No evidence captured at: ${missing.join(", ")}.`);
  }
  const phone = grouped.get("phone");
  if (phone.horizontalOverflow === true) {
    return fail("responsive", "The phone viewport overflows horizontally.", { width: phone.width });
  }
  const phoneBoxes = phone.geometry ?? [];
  const desktopBoxes = grouped.get("desktop").geometry ?? [];
  if (phoneBoxes.length > 0 && desktopBoxes.length > 0) {
    const phoneWide = phoneBoxes.filter((box) => box.width > phone.width * 0.8).length;
    // A layout that never reflows is a desktop layout shrunk onto a phone.
    if (phoneWide === 0) {
      return fail(
        "responsive",
        "No region becomes full-width on a phone; the desktop layout was scaled rather than transformed.",
        { phoneWidth: phone.width },
      );
    }
  }
  return pass("responsive", "Phone, tablet and desktop all render without horizontal overflow.", {});
}

function accessibilityVerdict(viewports) {
  const grouped = byClass(viewports);
  const desktop = grouped.get("desktop");
  if (desktop?.focusVisible === undefined) {
    return unproven("accessibility", "Keyboard focus visibility was not captured.");
  }
  if (desktop.focusVisible !== true) {
    return fail("accessibility", "Keyboard focus is not visible on the rendered page.", {});
  }
  const failures = [];
  for (const entry of desktop.colors ?? []) {
    if (!entry.color || !entry.backgroundColor) continue;
    const ratio = contrastRatio(entry.color, entry.backgroundColor);
    if (ratio !== null && ratio < 4.5) {
      failures.push({ selector: entry.selector, ratio: Number(ratio.toFixed(2)) });
    }
  }
  if (failures.length > 0) {
    return fail(
      "accessibility",
      `${failures.length} text/background pairs fall below the 4.5:1 contrast minimum.`,
      { failures: failures.slice(0, 6) },
    );
  }
  return pass("accessibility", "Focus is visible and measured text contrast meets 4.5:1.", {});
}

function exclusionsVerdict(contract, viewports) {
  const exclusions = contract.exclusions ?? contract.creativeDNA?.exclusions ?? [];
  if (exclusions.length === 0) {
    return unproven("exclusions", "The approved design declares no explicit exclusions.");
  }
  const dna = contract.creativeDNA;
  const desktop = byClass(viewports).get("desktop");
  if (desktop === undefined) {
    return unproven("exclusions", "No rendered page was captured to check exclusions against.");
  }
  // Exclusions are prose, so only the machine-checkable ones are judged here;
  // the rest are handed to the advisory critic rather than silently passed.
  if (dna?.imageryTreatment === "none" && (desktop?.imageCount ?? 0) > 0) {
    return fail("exclusions", "An explicit exclusion of imagery is violated by rendered images.", {
      imageCount: desktop.imageCount,
    });
  }
  return pass("exclusions", `${exclusions.length} explicit exclusions carry no machine-detectable violation.`, {
    exclusions,
  });
}

/* ------------------------------------------------------------------ entry */

/**
 * @param {object} contract  designExecutionBrief output (carries creativeDNA)
 * @param {ViewportEvidence[]} viewports  real browser evidence
 */
export function evaluateDesignFidelity(contract, viewports = []) {
  const list = Array.isArray(viewports) ? viewports.filter(Boolean) : [];
  const dna = contract?.creativeDNA ?? null;

  const verdicts = [
    compositionVerdict(dna, list),
    hierarchyVerdict(list),
    typographyVerdict(dna, list),
    colorsVerdict(contract ?? {}, list),
    spacingVerdict(list),
    imageryVerdict(dna, list),
    navigationVerdict(contract ?? {}, list),
    interactionsVerdict(dna, list),
    responsiveVerdict(list),
    accessibilityVerdict(list),
    exclusionsVerdict(contract ?? {}, list),
  ];

  const failed = verdicts.filter((item) => item.verdict === AspectVerdict.FAIL);
  const unprovenAspects = verdicts.filter((item) => item.verdict === AspectVerdict.UNPROVEN);

  return Object.freeze({
    verdicts: Object.freeze(verdicts),
    failedAspects: Object.freeze(failed.map((item) => item.aspect)),
    unprovenAspects: Object.freeze(unprovenAspects.map((item) => item.aspect)),
    // A build cannot pass on borrowed colour alone: every aspect must be
    // proven, and missing evidence is never treated as success.
    passed: failed.length === 0 && unprovenAspects.length === 0,
    repairScope: Object.freeze(repairScope(failed)),
  });
}

/** Maps failed aspects onto the narrowest scope a repair should touch. */
export function repairScope(failedVerdicts) {
  const scopes = new Set();
  for (const verdict of failedVerdicts) {
    switch (verdict.aspect) {
      case "composition":
      case "hierarchy":
      case "spacing":
        scopes.add("layout");
        break;
      case "typography":
      case "colors":
        scopes.add("design-tokens");
        break;
      case "imagery":
      case "exclusions":
        scopes.add("content");
        break;
      case "navigation":
      case "interactions":
        scopes.add("components");
        break;
      case "responsive":
        scopes.add("responsive-rules");
        break;
      case "accessibility":
        scopes.add("accessibility");
        break;
      default:
        scopes.add("layout");
    }
  }
  return [...scopes];
}
