import assert from "node:assert/strict";
import test from "node:test";

import { unsuppliedCustomerContentClaims } from "../src/understanding-plane/project-understanding-service.js";

const noCustomerContent = { supplied: [], missingBeforeLaunch: [] };

test("runtime-provided values are not mistaken for customer-owned content", () => {
  const plan = [
    {
      observableOutcome:
        "The calculator returns an accurate result for the provided input details.",
    },
    {
      observableOutcome:
        "The form preserves supplied contact details while the visitor corrects another field.",
    },
    {
      observableOutcome:
        "The calculator computes an answer from customer-provided numeric input.",
    },
  ];
  assert.deepEqual(
    unsuppliedCustomerContentClaims(plan, noCustomerContent),
    [],
  );
});

test("explicit customer-content provenance still fails closed", () => {
  const claims = unsuppliedCustomerContentClaims(
    [
      { observableOutcome: "The page displays the customer-provided logo." },
      { observableOutcome: "The supplied wording provided by the customer is visible." },
    ],
    noCustomerContent,
  );
  assert.equal(claims.length, 2);
});

test("recorded customer content satisfies the provenance gate", () => {
  const claims = unsuppliedCustomerContentClaims(
    [{ observableOutcome: "The customer-supplied logo is visible." }],
    {
      supplied: [
        { kind: "asset", value: "logo.svg", source: "customer-request" },
      ],
      missingBeforeLaunch: [],
    },
  );
  assert.deepEqual(claims, []);
});
