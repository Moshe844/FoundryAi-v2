// Foundry writes a fresh Playwright suite for every build, and then pays to
// repair it. Across 251 recorded builds, 905 repair rewrites landed somewhere,
// and 57% of them landed on test files rather than on the application: 32% on
// tests/*, another 25% on tests/foundry-checks.ts specifically. Nearly two
// thirds of all repair calls are browser-repair. The loop is mostly Foundry
// fixing its own tests.
//
// The defects are not exotic, and they repeat:
//   - a check read isVisible() before the request it triggered had resolved,
//     and reported false while the row it created sat in the database;
//   - a check asserted a displayed count equalled "2", the literal the buggy
//     implementation happened to produce, so it passed because the code was
//     wrong in the same way;
//   - one check signed in and left the browser signed in, so the next check
//     waited out the entire test budget for a control that could no longer
//     exist, and every check after it reported that the browser had closed.
//
// None of those are project-specific reasoning. They are the same handful of
// mistakes, available to anyone writing this code from scratch under time
// pressure -- which is exactly what the model is asked to do, once per build.
//
// Measured over 796 recorded checks, the vocabulary they actually use is tiny:
// assert visible (34%), click (30%), count elements (28%), read a computed
// style (26%), navigate (23%), fill (16%), reload (11%). Sixty per cent do not
// interact at all.
//
// So the model stops writing the code. It declares what to observe -- selectors
// and expected values, the part that genuinely varies per project -- and
// Foundry owns the execution. Waiting, isolation and independent derivation
// become properties of the runner rather than things each generated suite has
// to remember. A wrong selector is then a one-field data edit instead of a
// rewritten function.

export const ObservationPrimitive = Object.freeze({
  // 60% of recorded checks never interact. These are the read-only shapes.
  ELEMENT_VISIBLE: "element-visible",
  TEXT_PRESENT: "text-present",
  ELEMENT_COUNT: "element-count",
  COMPUTED_STYLE: "computed-style",
  ATTRIBUTE_EQUALS: "attribute-equals",
  // The interaction shapes.
  SUBMIT_FORM: "submit-form",
  CLICK_THEN_EXPECT: "click-then-expect",
  SELECT_THEN_EXPECT: "select-then-expect",
  SURVIVES_RELOAD: "survives-reload",
});

const PRIMITIVES = Object.freeze(Object.values(ObservationPrimitive));

// A locator is named the way a person reads a page, not by CSS descendant
// chains, so a repair changes a word rather than a selector expression.
const LOCATOR_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["how", "value"],
  properties: Object.freeze({
    how: {
      type: "string",
      enum: ["role", "label", "text", "placeholder", "testId", "css"],
    },
    value: { type: "string", minLength: 1, maxLength: 200 },
    // Only meaningful for `role`.
    name: { type: "string", maxLength: 200 },
  }),
});

// An expectation is either a fixed value or -- for anything the application
// computed -- a value derived from the page itself. The derived form exists so
// a displayed count is compared against the rows actually matching, never
// against a number copied from the implementation.
const EXPECTED_COUNT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["of", "equals"],
  properties: Object.freeze({
    // What is counted. Named separately from `target`, which is the control a
    // check acts on: counting the select you just changed instead of the rows
    // it filtered is a mistake the shape should not permit.
    of: LOCATOR_SCHEMA,
    equals: Object.freeze({
      anyOf: [
        Object.freeze({
          type: "object",
          additionalProperties: false,
          required: ["countOf"],
          properties: Object.freeze({ countOf: LOCATOR_SCHEMA }),
        }),
        Object.freeze({ type: "integer", minimum: 0 }),
      ],
    }),
  }),
});

export const DECLARED_CHECK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["checkId", "primitive"],
  properties: Object.freeze({
    checkId: { type: "string", minLength: 1, maxLength: 80 },
    primitive: { type: "string", enum: [...PRIMITIVES] },
    // What to look at. Present for every primitive except SUBMIT_FORM, which
    // names its own fields and submit control.
    target: LOCATOR_SCHEMA,
    // SUBMIT_FORM
    fields: Object.freeze({
      type: "array",
      maxItems: 12,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["field", "value"],
        properties: Object.freeze({ field: LOCATOR_SCHEMA, value: { type: "string", maxLength: 200 } }),
      }),
    }),
    submit: LOCATOR_SCHEMA,
    // What must then be true. A locator, or text, or a derived count.
    expectVisible: LOCATOR_SCHEMA,
    expectText: { type: "string", maxLength: 300 },
    expectCount: EXPECTED_COUNT_SCHEMA,
    // COMPUTED_STYLE / ATTRIBUTE_EQUALS
    property: { type: "string", maxLength: 60 },
    equals: { type: "string", maxLength: 200 },
    // Where to start. Foundry resets and navigates before every check, so this
    // is only for a check that needs a non-root route.
    route: { type: "string", maxLength: 200 },
  }),
});

export const DECLARED_CHECKS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["checks"],
  properties: Object.freeze({
    checks: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 40,
      items: DECLARED_CHECK_SCHEMA,
    }),
  }),
});

function fail(message) {
  throw new TypeError(`Declared observation: ${message}`);
}

function assertLocator(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(
      `${label} must be a locator object, as { "how": "role", "value": "button", "name": "Save" }. how is one of role, label, text, placeholder, testId, css.`,
    );
  }
  if (!["role", "label", "text", "placeholder", "testId", "css"].includes(value.how)) {
    fail(`${label}.how must be one of role, label, text, placeholder, testId, css.`);
  }
  if (typeof value.value !== "string" || value.value.trim() === "") {
    fail(`${label}.value must be a non-empty string.`);
  }
}

// What each primitive needs in order to mean anything. Stated once, here, so a
// declaration that cannot be executed is refused before it reaches a browser
// rather than reported as a failing check the repair loop then chases.
const REQUIREMENTS = Object.freeze({
  [ObservationPrimitive.ELEMENT_VISIBLE]: ["target"],
  [ObservationPrimitive.TEXT_PRESENT]: ["expectText"],
  [ObservationPrimitive.ELEMENT_COUNT]: ["target", "expectCount"],
  [ObservationPrimitive.COMPUTED_STYLE]: ["target", "property", "equals"],
  [ObservationPrimitive.ATTRIBUTE_EQUALS]: ["target", "property", "equals"],
  [ObservationPrimitive.SUBMIT_FORM]: ["fields", "submit"],
  [ObservationPrimitive.CLICK_THEN_EXPECT]: ["target"],
  [ObservationPrimitive.SELECT_THEN_EXPECT]: ["target", "equals"],
  [ObservationPrimitive.SURVIVES_RELOAD]: [],
});

const OUTCOME_KEYS = Object.freeze(["expectVisible", "expectText", "expectCount"]);

export function normalizeDeclaredCheck(value, label = "check") {
  let normalizedFields;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  if (typeof value.checkId !== "string" || value.checkId.trim() === "") {
    fail(`${label}.checkId must be a non-empty string.`);
  }
  if (!PRIMITIVES.includes(value.primitive)) {
    fail(
      `${label}.primitive must be one of: ${PRIMITIVES.join(", ")}. Declare what to observe; Foundry supplies the Playwright code.`,
    );
  }
  for (const key of REQUIREMENTS[value.primitive]) {
    if (value[key] === undefined) {
      fail(`${label} of kind "${value.primitive}" requires ${key}.`);
    }
  }
  if (value.target !== undefined) assertLocator(value.target, `${label}.target`);
  if (value.submit !== undefined) assertLocator(value.submit, `${label}.submit`);
  if (value.expectVisible !== undefined) {
    assertLocator(value.expectVisible, `${label}.expectVisible`);
  }
  if (value.expectCount !== undefined) {
    // Liberal on purpose. Generation alternated between the full { of, equals }
    // shape and a bare number across paid regenerations, and each spelling it
    // guessed wrong cost an entire build -- which is the repair loop this whole
    // change exists to remove, moved one stage earlier. Every form below says
    // the same unambiguous thing, so all of them are accepted and normalised.
    //   expectCount: 3                    -> count the target, expect 3
    //   expectCount: { countOf: locator } -> count the target, expect that many
    //   expectCount: { of, equals }       -> as written
    const raw = value.expectCount;
    if (typeof raw === "number" || (raw !== null && typeof raw === "object" && raw.countOf !== undefined && raw.of === undefined)) {
      if (value.target === undefined) {
        fail(
          `${label}.expectCount names no locator to count, and the check has no target either. Write { "of": { … }, "equals": 3 }.`,
        );
      }
      value = { ...value, expectCount: { of: value.target, equals: raw } };
    }
    const count = value.expectCount;
    if (count === null || typeof count !== "object" || Array.isArray(count)) {
      fail(
        `${label}.expectCount must name what is counted and what it equals, as { "of": { "how": "css", "value": "[data-task]" }, "equals": 3 } — or a bare number to count this check's target.`,
      );
    }
    assertLocator(count.of, `${label}.expectCount.of`);
    if (typeof count.equals === "number") {
      if (!Number.isSafeInteger(count.equals) || count.equals < 0) {
        fail(`${label}.expectCount.equals must be a whole number or a derived count.`);
      }
    } else if (count.equals !== null && typeof count.equals === "object") {
      assertLocator(count.equals.countOf, `${label}.expectCount.equals.countOf`);
    } else {
      fail(`${label}.expectCount.equals must be a whole number or { countOf }.`);
    }
  }
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length === 0) {
      fail(`${label}.fields must list at least one field to fill.`);
    }
    // `target` is accepted as an alias for `field`. Generation reached for it
    // three attempts out of four and oscillated between the two spellings
    // across paid regenerations -- a naming disagreement, not a defect, and
    // refusing it cost an entire build.
    normalizedFields = value.fields.map((entry, index) => {
      const field = entry?.field ?? entry?.target;
      if (field === undefined) {
        fail(
          `${label}.fields[${index}] must name the control to fill, as { "field": { "how": "label", "value": "Email address" }, "value": "typed text" }.`,
        );
      }
      assertLocator(field, `${label}.fields[${index}].field`);
      if (typeof entry.value !== "string") {
        fail(`${label}.fields[${index}].value must be a string.`);
      }
      return Object.freeze({ field, value: entry.value });
    });
  }
  // An action with no stated outcome proves nothing: it confirms the click did
  // not throw. Several recorded checks did exactly that and passed regardless
  // of what the application did.
  const acting = [
    ObservationPrimitive.SUBMIT_FORM,
    ObservationPrimitive.CLICK_THEN_EXPECT,
    ObservationPrimitive.SELECT_THEN_EXPECT,
    ObservationPrimitive.SURVIVES_RELOAD,
  ].includes(value.primitive);
  if (acting && !OUTCOME_KEYS.some((key) => value[key] !== undefined)) {
    fail(
      `${label} performs an action but states no outcome. Add expectVisible, expectText or expectCount: an action whose result is never checked proves only that it did not throw.`,
    );
  }
  return Object.freeze(
    normalizedFields === undefined
      ? { ...value }
      : { ...value, fields: Object.freeze(normalizedFields) },
  );
}

export function normalizeDeclaredChecks(value, requiredCheckIds = []) {
  if (value === null || typeof value !== "object" || !Array.isArray(value.checks)) {
    fail("output must be an object with a checks array.");
  }
  const checks = value.checks.map((entry, index) =>
    normalizeDeclaredCheck(entry, `checks[${index}]`),
  );
  const declared = new Set(checks.map((entry) => entry.checkId));
  const missing = [...requiredCheckIds].filter((id) => !declared.has(id));
  if (missing.length > 0) {
    fail(`no observation was declared for: ${missing.join(", ")}.`);
  }
  return Object.freeze({ checks: Object.freeze(checks) });
}

/**
 * True when a declaration compares something the application computed against a
 * number the author chose. The collusion rule, but structural: with primitives
 * it is a property of the data, so it cannot be written around in code.
 */
export function comparesComputedValueToLiteral(check) {
  return typeof check.expectCount?.equals === "number";
}

// ---------------------------------------------------------------------------
// The runner. Foundry emits this from the declarations, so every property the
// generated suites kept getting wrong is true by construction rather than by
// the model remembering: assertions wait, counts are derived from the page, and
// a check that acts must state what it expects.

function locatorExpression(locator) {
  const value = JSON.stringify(locator.value);
  switch (locator.how) {
    case "role":
      return locator.name === undefined
        ? `page.getByRole(${value})`
        : `page.getByRole(${value}, { name: ${JSON.stringify(locator.name)} })`;
    case "label":
      return `page.getByLabel(${value})`;
    case "text":
      return `page.getByText(${value})`;
    case "placeholder":
      return `page.getByPlaceholder(${value})`;
    case "testId":
      return `page.getByTestId(${value})`;
    default:
      return `page.locator(${value})`;
  }
}

// Every outcome is asserted with a waiting locator. isVisible() and
// textContent() read the DOM at that instant, and a signup check using them
// reported false while the account it had just created sat in the database.
function outcomeStatements(check) {
  const lines = [];
  if (check.expectVisible !== undefined) {
    lines.push(
      `    await expect(${locatorExpression(check.expectVisible)}).toBeVisible({ timeout: 10000 });`,
    );
  }
  if (check.expectText !== undefined) {
    lines.push(
      `    await expect(page.getByText(${JSON.stringify(check.expectText)})).toBeVisible({ timeout: 10000 });`,
    );
  }
  if (check.expectCount !== undefined) {
    if (typeof check.expectCount.equals === "number") {
      lines.push(`    const expected = ${check.expectCount.equals};`);
    } else {
      // Derived from the page, so a wrong display disagrees with the content it
      // describes rather than with a number someone wrote down.
      lines.push(
        `    const expected = await ${locatorExpression(check.expectCount.equals.countOf)}.count();`,
      );
    }
    lines.push(
      `    await expect(${locatorExpression(check.expectCount.of)}).toHaveCount(expected, { timeout: 10000 });`,
    );
  }
  return lines;
}

function bodyFor(check) {
  const lines = [];
  if (check.route !== undefined) {
    lines.push(`    await page.goto(${JSON.stringify(check.route)}, { waitUntil: "domcontentloaded" });`);
  }
  switch (check.primitive) {
    case ObservationPrimitive.ELEMENT_VISIBLE:
      lines.push(`    await expect(${locatorExpression(check.target)}).toBeVisible({ timeout: 10000 });`);
      break;
    case ObservationPrimitive.TEXT_PRESENT:
      lines.push(
        `    await expect(page.getByText(${JSON.stringify(check.expectText)})).toBeVisible({ timeout: 10000 });`,
      );
      break;
    case ObservationPrimitive.COMPUTED_STYLE:
      lines.push(`    const measured = await ${locatorExpression(check.target)}.first().evaluate(`);
      lines.push(`      (element: Element, property: string) => getComputedStyle(element).getPropertyValue(property).trim(),`);
      lines.push(`      ${JSON.stringify(check.property)},`);
      lines.push(`    );`);
      lines.push(`    if (measured !== ${JSON.stringify(check.equals)}) {`);
      lines.push(`      throw new Error("expected " + ${JSON.stringify(check.property)} + " to be " + ${JSON.stringify(check.equals)} + ", saw " + measured);`);
      lines.push(`    }`);
      break;
    case ObservationPrimitive.ATTRIBUTE_EQUALS:
      lines.push(
        `    await expect(${locatorExpression(check.target)}).toHaveAttribute(${JSON.stringify(check.property)}, ${JSON.stringify(check.equals)}, { timeout: 10000 });`,
      );
      break;
    case ObservationPrimitive.SUBMIT_FORM:
      for (const entry of check.fields) {
        lines.push(`    await ${locatorExpression(entry.field)}.fill(${JSON.stringify(entry.value)});`);
      }
      lines.push(`    await ${locatorExpression(check.submit)}.click();`);
      break;
    case ObservationPrimitive.CLICK_THEN_EXPECT:
      lines.push(`    await ${locatorExpression(check.target)}.click();`);
      break;
    case ObservationPrimitive.SELECT_THEN_EXPECT:
      lines.push(`    await ${locatorExpression(check.target)}.selectOption(${JSON.stringify(check.equals)});`);
      break;
    case ObservationPrimitive.SURVIVES_RELOAD:
      lines.push(`    await page.reload({ waitUntil: "domcontentloaded" });`);
      break;
    default:
      break;
  }
  lines.push(...outcomeStatements(check));
  return lines;
}

/**
 * Emits tests/foundry-checks.ts from the declarations. Written by Foundry, so
 * it cannot arrive with an unbalanced brace, an implicit any, a missing await
 * or a literal standing in for a computed value.
 */
export function compileDeclaredChecks(declared) {
  const { checks } = declared;
  const entries = checks.map((check) => {
    const body = bodyFor(check).join("\n");
    return [
      `  ${JSON.stringify(check.checkId)}: async ({ page, expect }: Context): Promise<Result> => {`,
      `    const diagnostics: Record<string, boolean | number | string | null> = {`,
      `      primitive: ${JSON.stringify(check.primitive)},`,
      `    };`,
      `    try {`,
      body,
      `      diagnostics.observed = true;`,
      `      return { passed: true, diagnostics };`,
      `    } catch (error: unknown) {`,
      `      diagnostics.problem = error instanceof Error ? error.message.slice(0, 300) : "observation failed";`,
      `      return { passed: false, diagnostics };`,
      `    }`,
      `  },`,
    ].join("\n");
  });
  return [
    "// Generated by Foundry from declared observations. Do not hand-edit: the",
    "// declarations are the source, and this file is rewritten from them.",
    "type Context = {",
    "  page: any;",
    "  expect: any;",
    "  responsiveEvidence: Record<string, boolean>;",
    "  accessibilityEvidence: Record<string, boolean>;",
    "};",
    "type Result = {",
    "  passed: boolean;",
    "  diagnostics: Record<string, boolean | number | string | null>;",
    "};",
    "",
    "export const obligationChecks: Record<string, (context: Context) => Promise<Result>> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}
