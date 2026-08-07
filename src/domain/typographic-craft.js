// A concept can satisfy every structural rule Foundry has -- semantic markup,
// no overflow, a real responsive transformation, a distinct composition -- and
// still look homemade. Reviewing the delivered work, the single most reliable
// cause was one typeface doing every job: a build that chose a serif voice set
// `font: 600 13px Georgia, serif` on its buttons, `font: 16px Georgia, serif`
// on its inputs and 11px letter-spaced Georgia on its labels. The composition
// was fine. The chrome read as amateur.
//
// Editorial practice is to give the display face the headline and hand the
// interface -- controls, labels, inputs, helper text -- to a face built for
// small sizes at screen resolution. That separation is what these rules check.

const DISPLAY_ONLY_FAMILIES = [
  "georgia",
  "times",
  "times new roman",
  "garamond",
  "baskerville",
  "palatino",
  "didot",
  "bodoni",
  "playfair",
  "cormorant",
  "big caslon",
  "hoefler text",
  "book antiqua",
  "cambria",
  "constantia",
  "papyrus",
  "brush script mt",
  "comic sans ms",
  "impact",
  "copperplate",
];

// Selectors that put text inside a control the user reads at small sizes.
const CONTROL_SELECTOR =
  /(?:^|[\s,>+~])(?:input|button|select|textarea|label|legend|option|::placeholder|small)\b|\[type=|\b(?:btn|button|field|input|label|control|submit|cta)\b/iu;

// Selectors that set the document-wide default every control inherits from.
const ROOT_SELECTOR = /(?:^|,)\s*(?:\*|:root|html|body)\s*(?:,|$)/u;

function declarationBlocks(css) {
  const blocks = [];
  // Strip comments and at-rule preludes so selectors read cleanly; nested
  // at-rule bodies keep their own inner rules, which is what we want.
  const cleaned = String(css).replace(/\/\*[\s\S]*?\*\//gu, "");
  const rule = /([^{}]+)\{([^{}]*)\}/gu;
  for (const match of cleaned.matchAll(rule)) {
    const selector = match[1].split("\n").pop().trim();
    if (selector === "" || selector.startsWith("@")) continue;
    blocks.push({ selector, body: match[2] });
  }
  return blocks;
}

// Returns the first declared family, lowercased, from either `font-family` or
// the `font` shorthand -- where the family list is everything after the size.
function declaredFamily(body) {
  const longhand = /(?:^|;)\s*font-family\s*:\s*([^;}]+)/iu.exec(body);
  if (longhand) return firstFamily(longhand[1]);
  const shorthand = /(?:^|;)\s*font\s*:\s*([^;}]+)/iu.exec(body);
  if (!shorthand) return null;
  const value = shorthand[1].trim();
  if (/^(?:inherit|initial|unset)$/iu.test(value)) return "inherit";
  // The family list is whatever follows the size, and the size is the token
  // carrying a unit -- not merely the first number, which in
  // `font: 600 13px Georgia, serif` is the weight.
  const afterSize =
    /(?:\d[\d.]*(?:px|rem|em|ex|ch|pt|pc|cm|mm|in|vw|vh|vmin|vmax|%)|\b(?:xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)\b)(?:\s*\/\s*[^\s]+)?\s+(.+)$/iu.exec(
      value,
    );
  return afterSize ? firstFamily(afterSize[1]) : null;
}

function firstFamily(list) {
  const first = String(list).split(",")[0].trim().replace(/^["']|["']$/gu, "");
  return first.toLowerCase();
}

function isDisplayOnly(family) {
  if (family === null) return false;
  if (family === "serif" || family === "cursive" || family === "fantasy") {
    return true;
  }
  return DISPLAY_ONLY_FAMILIES.includes(family);
}

/**
 * Reports controls that were handed a display face. Returns [] when the
 * interface layer is set in something built for small text -- including when
 * the concept never restyles its controls at all.
 */
export function displayFaceOnInterfaceIssues(css) {
  const blocks = declarationBlocks(css);
  const rootFamily = blocks
    .filter((block) => ROOT_SELECTOR.test(block.selector))
    .map((block) => declaredFamily(block.body))
    .filter((family) => family !== null)
    .pop();
  const issues = [];
  const seen = new Set();
  for (const block of blocks) {
    if (!CONTROL_SELECTOR.test(block.selector)) continue;
    const family = declaredFamily(block.body);
    if (family === null) continue;
    // `font: inherit` on a control adopts whatever the document set, which is
    // the same defect when the document face is a display serif.
    const effective = family === "inherit" ? (rootFamily ?? null) : family;
    if (!isDisplayOnly(effective)) continue;
    const key = `${block.selector}::${effective}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(
      `"${block.selector.slice(0, 60)}" sets its text in ${effective}`,
    );
  }
  if (issues.length === 0) return [];
  return [
    `styles.css gives the interface a display face: ${issues.slice(0, 4).join("; ")}. ` +
      "Keep the display face for headings and pull quotes, and set every control, label, input, placeholder and helper text in a face built for small screen text — " +
      'font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif. ' +
      "One typeface doing both jobs is the most common reason a finished concept still reads as homemade.",
  ];
}

export function typographicCraftIssues(css) {
  if (typeof css !== "string" || css.trim() === "") return [];
  return [...displayFaceOnInterfaceIssues(css)];
}
