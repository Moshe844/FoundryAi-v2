import assert from "node:assert/strict";
import test from "node:test";

import { buildDesignSpecification } from "../src/domain/product-blueprint.js";

test("the Product Blueprint carries the exact approved live prototype contract", () => {
  const approvedPrototypeContract = Object.freeze({
    schemaVersion: 1,
    approvedDesignId: "approved-concept-3-v4",
    selectedConceptId: "concept-3",
    selectedConceptVersion: 4,
    contentHash: "a".repeat(64),
    integrityHash: "b".repeat(64),
  });
  const approvedDirection = {
    selectedDirectionName: "Editorial Archive",
    approvedPrototypeContract,
  };
  const specification = buildDesignSpecification({
    designAlternatives: [{
      name: "Editorial Archive",
      recommended: true,
      visualPersonality: "Editorial",
      description: "An image-led archive.",
      whyItFits: "It foregrounds the work.",
      layoutApproach: "Asymmetric editorial grid",
      informationDensity: "Measured",
      navigationApproach: "Persistent index",
      mobileBehavior: "Single-column sequence",
      preview: {},
    }],
    designDirection: {
      visualPersonality: "Editorial",
      rationale: "It foregrounds the work.",
      layoutStrategy: "Asymmetric editorial grid",
      informationDensity: "Measured",
      navigationApproach: "Persistent index",
      contentStrategy: "Projects before biography",
      interactionStyle: "Quiet transitions",
      tone: "Restrained",
      responsivePriority: "Mobile reading order",
      accessibilityNeeds: ["Keyboard navigation"],
    },
    projectIntent: { confidence: { score: 0.9 } },
  }, [{
    selection: {
      kind: "design-direction",
      mode: "select-option",
      optionId: "concept-3",
      value: "Editorial Archive",
      designContract: approvedDirection,
    },
  }]);

  assert.deepEqual(specification.approvedDesignContract, approvedPrototypeContract);
  assert.notEqual(specification.approvedDesignContract, approvedPrototypeContract);
  assert.equal(specification.selection.optionId, "concept-3");
});
