import assert from "node:assert/strict";
import test from "node:test";

import { certifiedAuthenticationFastLaneEligible } from "../src/work-plane/certified-auth-fast-lane.js";

function contract(overrides = {}) {
  return {
    workflows: {
      primaryJourneys: [
        "A new visitor creates an account and remains signed in after refresh.",
        "A returning user signs in, refreshes successfully, and signs out.",
        "A user switches modes and recovers from validation or authentication errors.",
      ],
      secondaryJourneys: [],
    },
    selectedDesignDirection: {
      layoutStrategy: "Centered access card with a guided account flow.",
    },
    acceptedRecommendations: [],
    productBlueprint: {
      designSpecification: { approvedDesignContract: null },
    },
    ...overrides,
  };
}

test("focused authentication uses the certified two-minute fast lane", () => {
  for (const complexity of ["SIMPLE", "STANDARD"]) {
    assert.equal(
      certifiedAuthenticationFastLaneEligible({
        approvedContract: contract(),
        complexity,
      }),
      true,
    );
  }
});

test("the authentication fast lane fails closed for broader products and approved prototypes", () => {
  for (const approvedContract of [
    contract({
      workflows: {
        primaryJourneys: ["Create an account.", "Manage inventory records."],
        secondaryJourneys: [],
      },
    }),
    contract({
      productBlueprint: {
        designSpecification: {
          approvedDesignContract: { approvedDesignId: "approved-design" },
        },
      },
    }),
  ]) {
    assert.equal(
      certifiedAuthenticationFastLaneEligible({
        approvedContract,
        complexity: "SIMPLE",
        hasCredentials: true,
        hasPersistence: true,
      }),
      false,
    );
  }
});
