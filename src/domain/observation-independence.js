// A dashboard shipped with "Open tickets" counting everything that was not
// closed, so a queue of three open, two pending and one closed reported five
// open. Fourteen of fourteen obligations passed. The check for that obligation
// read:
//
//   await page.locator('#status').selectOption('Pending');
//   correct = await page.getByTestId('open-count').textContent() === '2';
//
// Filter to Pending, then assert the open count reads 2. With the defect that
// passes. Written to the obligation's meaning -- counting rows whose status is
// Open -- it would read 0 and fail. The check did not miss the bug; it encoded
// it. Code and check are written from the same understanding, so a shared
// misreading of "open" agrees with itself and nothing downstream can tell.
//
// The tell is the literal. The application computed and displayed a number, and
// the check compared it against a number the author wrote down -- a number they
// could only have got by believing the implementation. An independent check
// derives its expectation from the page: count the rows that are actually Open
// and compare the widget to that. Then a wrong widget disagrees with the table
// it sits above, and the check fails for the right reason.
//
// So: a check that reads a value the application rendered may not settle it
// against a bare literal. It must also derive a value from the page.

const CHECK_ENTRY =
  /["']((?:obligation|check)-[A-Za-z0-9_-]+)["']\s*:\s*/gu;

// The application told us something.
const READS_RENDERED_VALUE =
  /\.(?:textContent|innerText|inputValue)\s*\(|toHaveText\s*\(|toHaveValue\s*\(/u;

// ...and it was settled against a number chosen by whoever wrote the check.
const COMPARES_TO_NUMERIC_LITERAL = [
  /[!=]==?\s*(["'`])\s*\d+(?:\.\d+)?\s*\1/u,
  /(["'`])\s*\d+(?:\.\d+)?\s*\1\s*[!=]==?/u,
  /toHaveText\s*\(\s*(["'`])\s*\d+(?:\.\d+)?\s*\1/u,
  /toHaveValue\s*\(\s*(["'`])\s*\d+(?:\.\d+)?\s*\1/u,
  /\bNumber\s*\([^)]*\)\s*[!=]==?\s*\d+/u,
  /\bparseInt\s*\([^)]*\)\s*[!=]==?\s*\d+/u,
];

// ...rather than against something else on the page. Counting elements, or
// reading them out with evaluate, both derive the expectation from what is
// actually rendered instead of from the implementation's behaviour.
const DERIVES_FROM_PAGE =
  /\.count\s*\(|\$\$eval|\$eval|\.evaluate(?:All|Handle)?\s*\(|\.allTextContents\s*\(|\.elementHandles\s*\(/u;

/**
 * Splits a checks module into one body per check. Bodies run from a check's key
 * to the next key, which is coarse but keeps every assertion with the check
 * that made it -- the only property this analysis needs.
 */
export function checkBodies(source) {
  const text = String(source ?? "");
  const starts = [...text.matchAll(CHECK_ENTRY)];
  return starts.map((match, index) => ({
    checkId: match[1],
    body: text.slice(
      match.index,
      index + 1 < starts.length ? starts[index + 1].index : text.length,
    ),
  }));
}

// Typing 7 into a field and reading 7 back is a round trip, not collusion: the
// expected value came from the test's own hand, not from believing the code.
// Weak as a check, but it is not the defect this rule is looking for, and
// rejecting it would send a correct check back for rewriting.
function balancedBlockAt(source, openingIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = openingIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openingIndex, index + 1);
    }
  }
  return "";
}

function helperPerformsInput(source, helperName) {
  const escapedName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const interaction = /\.(?:click|fill|type|selectOption|press)\s*\(|\.keyboard\.(?:type|press)\s*\(/u;
  const definitions = [
    new RegExp(`\\bfunction\\s+${escapedName}\\b[^\\n{]{0,400}\\{`, "u"),
    new RegExp(`\\b(?:const|let)\\s+${escapedName}\\b[^=\\n]{0,200}=\\s*(?:async\\s*)?[^\\n]{0,400}?=>\\s*\\{`, "u"),
  ];
  const definition = definitions
    .map((pattern) => pattern.exec(source))
    .find((match) => match !== null);
  if (definition !== undefined) {
    const openingIndex = definition.index + definition[0].lastIndexOf("{");
    const helperBody = balancedBlockAt(source, openingIndex);
    if (interaction.test(helperBody)) return true;
  }
  return false;
}

function roundTripsItsOwnInput(source, body, comparison) {
  const number = comparison.match(/\d+(?:\.\d+)?/u)?.[0];
  if (number === undefined) return false;
  const directInput = new RegExp(
    `\\.(?:fill|type|selectOption|press)\\s*\\(\\s*(["'\`])\\s*${number}\\s*\\1`,
    "u",
  ).test(body);
  if (directInput) return true;

  const comparisonIndex = body.indexOf(comparison);
  const beforeComparison = comparisonIndex < 0
    ? body
    : body.slice(0, comparisonIndex);
  const locatorInput = new RegExp(
    `(?:getByRole|getByLabel|locator)\\s*\\([\\s\\S]{0,240}?(["'\`])\\s*${number}\\s*\\1[\\s\\S]{0,240}?\\.(?:click|fill|type|press)\\s*\\(`,
    "u",
  ).test(beforeComparison);
  if (locatorInput) return true;

  // Generated checks usually centralize interaction in a small helper, for
  // example press(context, ['9', 'Backspace']). The literal still came from
  // the test, but the direct-action pattern above cannot see through that
  // helper boundary. Only interaction-named calls qualify: an unrelated
  // formatter or filter receiving a number must not turn a hard-coded display
  // assertion into independent evidence.
  const quotedNumbers = [
    ...beforeComparison.matchAll(
      new RegExp(`(["'\`])\\s*${number}\\s*\\1`, "gu"),
    ),
  ];
  return quotedNumbers.some((literal) => {
    const beforeLiteral = beforeComparison.slice(
      Math.max(0, literal.index - 500),
      literal.index,
    );
    // Take the innermost open call that owns this literal. A global call regex
    // let an outer async(...) expression consume the nested press(...) call,
    // losing the provenance we were trying to recover.
    const call = /\b([A-Za-z_$][\w$]*)\s*\([^()]{0,500}$/u.exec(
      beforeLiteral,
    );
    return call !== null && helperPerformsInput(source, call[1]);
  });
}

/**
 * Reports checks that settle a rendered value against a literal without
 * deriving anything from the page. Returns [] when every check either derives
 * its expectation or is not asserting on a computed display at all.
 */
export function collusiveCheckIssues(source) {
  const issues = [];
  for (const { checkId, body } of checkBodies(source)) {
    if (!READS_RENDERED_VALUE.test(body)) continue;
    const literal = COMPARES_TO_NUMERIC_LITERAL.find((pattern) =>
      pattern.test(body),
    );
    if (literal === undefined) continue;
    if (DERIVES_FROM_PAGE.test(body)) continue;
    if (roundTripsItsOwnInput(source, body, body.match(literal)?.[0] ?? "")) continue;
    const quoted = body.match(literal)?.[0]?.trim().slice(0, 40) ?? "a literal";
    issues.push(
      `Check "${checkId}" reads a value the application rendered and settles it against the literal ${quoted}. ` +
        "That number can only have come from believing the implementation, so the check passes whenever the code is consistently wrong -- which is exactly the case it exists to catch. " +
        "Derive the expected value from the page instead: count the elements that genuinely satisfy the condition and compare the displayed value to that count, so a wrong display disagrees with the content it describes.",
    );
  }
  return issues;
}

/**
 * Fails once with every independent-observation defect in the generated test
 * module. Reporting only the first issue made a bundle with three bad checks
 * consume one paid correction per check, even though all three defects were
 * already detectable in the original source.
 */
export function assertObservationIndependence(source) {
  const issues = collusiveCheckIssues(source);
  if (issues.length === 0) return;
  throw new TypeError(
    [
      `The browser observation test contains ${issues.length} non-independent ${issues.length === 1 ? "check" : "checks"}. Correct all of them in the same response:`,
      ...issues.map((issue, index) => `${index + 1}. ${issue}`),
    ].join("\n"),
  );
}
