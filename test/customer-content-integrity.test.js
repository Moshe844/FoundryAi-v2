import assert from "node:assert/strict";
import test from "node:test";

import { validateCustomerContentIntegrity } from "../src/work-plane/production-mission-service.js";

const context = Object.freeze({
  supplied: [],
  missingBeforeLaunch: ["Contact details"],
});

test("form email hints are not treated as invented customer identities", () => {
  assert.doesNotThrow(() =>
    validateCustomerContentIntegrity(
      [{
        path: "app/page.tsx",
        content:
          "export default function Form(){return <input aria-label='Work email' placeholder='you@company.com' />}",
      }],
      context,
    ),
  );
});

test("rendered and linked email addresses still require customer provenance", () => {
  for (const content of [
    "export default function Page(){return <p>you@company.com</p>}",
    "export default function Page(){return <a href='mailto:you@company.com'>Email us</a>}",
  ]) {
    assert.throws(
      () => validateCustomerContentIntegrity([{ path: "app/page.tsx", content }], context),
      /unsupported customer facts \(email address\)/u,
    );
  }
});
