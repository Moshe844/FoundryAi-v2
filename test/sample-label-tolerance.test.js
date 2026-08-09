import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDesignAlternativeList } from "../src/domain/project-design.js";

// A mission died in CLARIFYING with "designAlternatives[0].visualSystem
// .sampleLabels contains duplicates". No concepts were generated, so the
// continue button on the design page silently did nothing and the project was
// simply stuck with an error nobody saw. Sample labels are the words a mock
// puts on screen; two cards both reading "View" is ordinary, and it is not
// worth the whole project.
function alternative(name, sampleLabels) {
  return {
    name,
    description: `${name} keeps the queue readable.`,
    whyItFits: `${name} suits the described work.`,
    layoutApproach: `${name} layout`,
    visualPersonality: `${name} personality`,
    informationDensity: "focused",
    navigationApproach: "top",
    mobileBehavior: "stack",
    tradeoff: `${name} trades ornament for clarity.`,
    confidence: { score: 0.7, rationale: `${name} is well understood.` },
    preview: {
      typographyCharacter: "humanist",
      spacingDensity: "steady",
      colorMood: "calm",
      hierarchy: "clear",
    },
    recommended: name === "Calm",
    visualSystem: visualSystem(sampleLabels ?? [name, `${name} queue`, `${name} detail`]),
  };
}

function visualSystem(sampleLabels) {
  return {
    layoutType: "dashboard",
    navigationType: "top-bar",
    typographyCategory: "humanist",
    density: "balanced",
    spacingProfile: "rhythmic",
    surfaceTreatment: "flat",
    contentEmphasis: "data",
    imageStrategy: "none",
    interactionModel: "guided",
    buttonTreatment: "solid",
    colorRoles: {
      background: "#ffffff",
      surface: "#f5f5f5",
      primary: "#123456",
      accent: "#ab3412",
      text: "#111111",
    },
    sampleLabels,
  };
}

const OTHERS = [alternative("Steady"), alternative("Direct")];

test("a mock may show the same label twice", () => {
  assert.doesNotThrow(() =>
    normalizeDesignAlternativeList(
      [alternative("Calm", ["View", "View", "Archive"]), ...OTHERS],
      { family: "web-application" },
    ),
  );
});

test("the repeated label survives rather than being deduplicated away", () => {
  // Collapsing them silently would drop the mock below its minimum of three.
  const [first] = normalizeDesignAlternativeList(
    [alternative("Calm", ["View", "View", "Archive"]), ...OTHERS],
    { family: "web-application" },
  );
  assert.deepEqual(first.visualSystem.sampleLabels, ["View", "View", "Archive"]);
});

test("an empty label is still refused", () => {
  assert.throws(
    () =>
      normalizeDesignAlternativeList(
        [alternative("Calm", ["View", "", "Archive"]), ...OTHERS],
        { family: "web-application" },
      ),
    /must be a non-empty string/u,
  );
});
