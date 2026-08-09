import assert from "node:assert/strict";
import test from "node:test";

import {
  AskDisposition,
  assertAsksUnchanged,
  citableProposalLines,
  readbackSummary,
  settleRequestReadback,
  unaccountedAsks,
} from "../src/domain/request-readback.js";

// The real mission. "Build a full login/signup page for a food industry
// inventory" — where excluding inventory management is CORRECT, and any
// word-overlap rule rejects it because "inventory" is in the request.
const LOGIN_PAGE_DESIGN = {
  productProposal: {
    essentialCapabilities: [
      "Users can switch between login and signup views without losing form context.",
      "Submitting valid signup details creates a user account and reaches a signed-in state.",
      "Login validates credentials and reaches the inventory workspace entry state.",
    ],
    intentionallyExcludedCapabilities: [
      "Inventory item management",
      "Stock counts and alerts",
    ],
  },
};

test("a correct exclusion that reuses the request's words is not a violation", () => {
  const settled = settleRequestReadback(
    {
      asks: [
        {
          ask: "people can sign up",
          quotedFromRequest: "signup page",
          disposition: AskDisposition.BUILDING,
          citation: "Submitting valid signup details creates a user account",
        },
        {
          ask: "people can log in",
          quotedFromRequest: "login",
          disposition: AskDisposition.BUILDING,
          citation: "Login validates credentials",
        },
        {
          ask: "it serves a food industry inventory product",
          quotedFromRequest: "for a food industry inventory",
          disposition: AskDisposition.CONTEXT,
          citation: null,
        },
      ],
    },
    LOGIN_PAGE_DESIGN,
  );
  assert.deepEqual(settled.demotions, []);
  assert.deepEqual(unaccountedAsks(settled), []);
  assert.match(readbackSummary(settled), /Everything you asked for is in this plan/u);
});

test("a citation the proposal never contains is not coverage", () => {
  // The failure mode of asking a model whether it covered the request: it says
  // yes. A citation makes the claim checkable, and this one does not check out.
  const settled = settleRequestReadback(
    {
      asks: [
        {
          ask: "people can reset a forgotten password",
          quotedFromRequest: "full login",
          disposition: AskDisposition.BUILDING,
          citation: "Users can recover access through a password reset email.",
        },
      ],
    },
    LOGIN_PAGE_DESIGN,
  );
  assert.equal(settled.asks[0].disposition, AskDisposition.UNACCOUNTED);
  assert.equal(settled.asks[0].citation, null);
  assert.match(settled.demotions[0], /appears nowhere in the proposal/u);
  assert.equal(unaccountedAsks(settled).length, 1);
});

test("claiming coverage without citing anything is treated as no claim", () => {
  const settled = settleRequestReadback(
    {
      asks: [
        {
          ask: "people can reset a forgotten password",
          quotedFromRequest: "full login",
          disposition: AskDisposition.BUILDING,
          citation: null,
        },
      ],
    },
    LOGIN_PAGE_DESIGN,
  );
  assert.equal(settled.asks[0].disposition, AskDisposition.UNACCOUNTED);
  assert.match(settled.demotions[0], /with no citation/u);
});

test("a deliberate exclusion is accounted for, and still surfaced for agreement", () => {
  const settled = settleRequestReadback(
    {
      asks: [
        {
          ask: "staff can manage inventory items",
          quotedFromRequest: "inventory",
          disposition: AskDisposition.EXCLUDED,
          citation: "Inventory item management",
        },
      ],
    },
    LOGIN_PAGE_DESIGN,
  );
  assert.deepEqual(settled.demotions, []);
  assert.deepEqual(unaccountedAsks(settled), []);
  assert.match(readbackSummary(settled), /deliberately left out — check that you agree/u);
});

test("the summary refuses to read as a faithful plan while something is missing", () => {
  const settled = settleRequestReadback(
    {
      asks: [
        {
          ask: "people can reset a forgotten password",
          quotedFromRequest: "full login",
          disposition: AskDisposition.BUILDING,
          citation: "a password reset email",
        },
      ],
    },
    LOGIN_PAGE_DESIGN,
  );
  assert.match(readbackSummary(settled), /1 thing you asked for is not in this plan/u);
});

test("exclusions are citable, so excluding something is never a silent drop", () => {
  const lines = citableProposalLines(LOGIN_PAGE_DESIGN);
  assert.ok(lines.includes("Inventory item management"));
  assert.ok(lines.some((line) => line.includes("creates a user account")));
});

test("a read-back with no asks is rejected rather than read as nothing missing", () => {
  assert.throws(
    () => settleRequestReadback({ asks: [] }, LOGIN_PAGE_DESIGN),
    /at least one ask/u,
  );
});

test("the mapping phase may not delete the ask it cannot cover", () => {
  // The attack this closes: phase two, unable to cite anything for password
  // reset, simply omits it and returns a clean read-back.
  const extracted = {
    asks: [
      { ask: "people can log in", quotedFromRequest: "login", kind: "DELIVERABLE" },
      { ask: "people can reset a forgotten password", quotedFromRequest: "full login", kind: "DELIVERABLE" },
    ],
  };
  const mapped = {
    asks: [
      {
        ask: "people can log in",
        quotedFromRequest: "login",
        disposition: AskDisposition.BUILDING,
        citation: "Login validates credentials",
      },
    ],
  };
  assert.throws(
    () => assertAsksUnchanged(extracted, mapped),
    /dropped 1[\s\S]*reset a forgotten password/u,
  );
});

test("the mapping phase may not invent an ask the request never made", () => {
  const extracted = {
    asks: [{ ask: "people can log in", quotedFromRequest: "login", kind: "DELIVERABLE" }],
  };
  const mapped = {
    asks: [
      {
        ask: "people can log in",
        quotedFromRequest: "login",
        disposition: AskDisposition.BUILDING,
        citation: "Login validates credentials",
      },
      {
        ask: "people can export a report",
        quotedFromRequest: "login",
        disposition: AskDisposition.BUILDING,
        citation: "Login validates credentials",
      },
    ],
  };
  assert.throws(() => assertAsksUnchanged(extracted, mapped), /invented 1/u);
});

test("an unchanged set of asks passes regardless of order or spacing", () => {
  const extracted = {
    asks: [
      { ask: "people can log in", quotedFromRequest: "login", kind: "DELIVERABLE" },
      { ask: "people can sign up", quotedFromRequest: "signup", kind: "DELIVERABLE" },
    ],
  };
  const mapped = {
    asks: [
      { ask: "People can sign up.", quotedFromRequest: "signup", disposition: AskDisposition.BUILDING, citation: "creates a user account" },
      { ask: "people  can log in", quotedFromRequest: "login", disposition: AskDisposition.BUILDING, citation: "Login validates credentials" },
    ],
  };
  assert.doesNotThrow(() => assertAsksUnchanged(extracted, mapped));
});
