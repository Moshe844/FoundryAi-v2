import assert from "node:assert/strict";
import test from "node:test";

import {
  ObservationPrimitive as P,
  comparesComputedValueToLiteral,
  compileDeclaredChecks,
  normalizeDeclaredCheck,
  normalizeDeclaredChecks,
} from "../src/domain/observation-primitives.js";

const rows = { how: "css", value: "tbody tr" };
const openRows = { how: "css", value: "tbody tr[data-open]" };
const openCount = { how: "testId", value: "open-count" };

function declare(checks) {
  return normalizeDeclaredChecks({ checks });
}

test("a declaration compiles to code that waits instead of reading instantly", () => {
  // A signup check read isVisible() straight after clicking and reported false
  // while the account it created sat in the database. The runner cannot make
  // that mistake, because the model no longer writes this line.
  const source = compileDeclaredChecks(
    declare([
      {
        checkId: "obligation-002",
        primitive: P.SUBMIT_FORM,
        fields: [{ field: { how: "label", value: "Email address" }, value: "a@b.com" }],
        submit: { how: "role", value: "button", name: "Create account" },
        expectText: "You’re signed in.",
      },
    ]),
  );
  assert.match(source, /toBeVisible\(\{ timeout: 10000 \}\)/u);
  assert.doesNotMatch(source, /isVisible\(\)/u);
  assert.doesNotMatch(source, /textContent\(\)/u);
});

test("a derived count compares the display against the rows, not against a literal", () => {
  // The dashboard asserted its open-count equalled "2" -- the number the buggy
  // code produced -- so it passed because the code was wrong the same way.
  const source = compileDeclaredChecks(
    declare([
      {
        checkId: "obligation-005",
        primitive: P.SELECT_THEN_EXPECT,
        target: { how: "label", value: "Status" },
        equals: "Pending",
        expectCount: { of: openCount, equals: { countOf: openRows } },
      },
    ]),
  );
  assert.match(source, /const expected = await page\.locator\("tbody tr\[data-open\]"\)\.count\(\);/u);
  assert.match(source, /getByTestId\("open-count"\)\)\.toHaveCount\(expected/u);
});

test("what is counted is named separately from what is acted on", () => {
  // Counting the select you just changed, rather than the rows it filtered, is
  // a mistake the shape must not permit.
  const check = normalizeDeclaredCheck({
    checkId: "c",
    primitive: P.SELECT_THEN_EXPECT,
    target: { how: "label", value: "Status" },
    equals: "Pending",
    expectCount: { of: rows, equals: { countOf: openRows } },
  });
  assert.equal(check.expectCount.of.value, "tbody tr");
  assert.notEqual(check.expectCount.of.value, check.target.value);
});

test("an action that states no outcome is refused", () => {
  // Several recorded checks clicked something and asserted nothing, so they
  // proved only that the click did not throw.
  assert.throws(
    () =>
      normalizeDeclaredCheck({
        checkId: "c",
        primitive: P.CLICK_THEN_EXPECT,
        target: { how: "role", value: "button", name: "Save" },
      }),
    /states no outcome/u,
  );
});

test("a missing observation for a required check is refused", () => {
  assert.throws(
    () =>
      normalizeDeclaredChecks(
        { checks: [{ checkId: "obligation-001", primitive: P.ELEMENT_VISIBLE, target: rows }] },
        ["obligation-001", "obligation-002"],
      ),
    /no observation was declared for: obligation-002/u,
  );
});

test("an unknown primitive is refused, and the message says what to do", () => {
  assert.throws(
    () => normalizeDeclaredCheck({ checkId: "c", primitive: "write-your-own-playwright" }),
    /Declare what to observe; Foundry supplies the Playwright code/u,
  );
});

test("a literal count is still recognisable as collusion", () => {
  const literal = normalizeDeclaredCheck({
    checkId: "c",
    primitive: P.ELEMENT_COUNT,
    target: rows,
    expectCount: { of: openCount, equals: 2 },
  });
  const derived = normalizeDeclaredCheck({
    checkId: "d",
    primitive: P.ELEMENT_COUNT,
    target: rows,
    expectCount: { of: openCount, equals: { countOf: openRows } },
  });
  assert.equal(comparesComputedValueToLiteral(literal), true);
  assert.equal(comparesComputedValueToLiteral(derived), false);
});

test("the emitted module is syntactically whole and typed", () => {
  // Unbalanced delimiters and implicit any were both recurring repair causes in
  // model-written suites. Neither is reachable from a generator.
  const source = compileDeclaredChecks(
    declare([
      { checkId: "a", primitive: P.ELEMENT_VISIBLE, target: rows },
      { checkId: "b", primitive: P.SURVIVES_RELOAD, expectText: "Signed in" },
      { checkId: "c", primitive: P.COMPUTED_STYLE, target: rows, property: "color", equals: "rgb(0, 0, 0)" },
    ]),
  );
  const open = (source.match(/\{/gu) ?? []).length;
  const close = (source.match(/\}/gu) ?? []).length;
  assert.equal(open, close, "braces must balance");
  assert.doesNotMatch(source, /\((\w+)\)\s*=>/u, "callback parameters must be annotated");
  assert.match(source, /export const obligationChecks: Record<string, \(context: Context\) => Promise<Result>>/u);
});
