import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Phase 4 renders observations, meaningful directions, and recommendation consequences", async () => {
  const [discovery, design, recommendations, selectors] = await Promise.all([
    source("../app/components/project-discovery.tsx"),
    source("../app/components/design-direction.tsx"),
    source("../app/components/foundry-recommendations.tsx"),
    source("../experience/selectors.ts"),
  ]);

  assert.match(discovery, /<FoundryObservations observations=\{proposal\.observations\}/u);
  assert.match(design, /alternative\.whyItFits\.value/u);
  assert.match(design, /alternative\.tradeoff\.value/u);
  assert.match(design, /ArtDirectionBoard/u);
  assert.match(design, /Recommended/u);
  assert.match(design, /Combine ideas/u);
  // Boards must render from machine-readable creative DNA.
  assert.match(design, /creativeDNA/u);
  assert.match(design, /composeCustomDirection/u);
  assert.match(recommendations, /recommendation\.value\.value/u);
  assert.match(recommendations, /recommendation\.impact\.value/u);
  assert.match(recommendations, /aria-expanded=\{showingWhy\}/u);
  assert.match(selectors, /recommendation\.selectedByDefault \?\? null/u);
  assert.match(selectors, /alternative\.whyItFits/u);
  assert.match(selectors, /alternative\.preview/u);
});

test("Phase 4 persists both accepted and rejected customer recommendations", async () => {
  const discovery = await source("../app/components/project-discovery.tsx");
  const decisionHistory = await source("../local-api/decision-history.mjs");

  assert.match(discovery, /recommendation\.selectedByDefault\.value === true/u);
  assert.match(discovery, /proposal\.recommendations\.map/u);
  assert.match(discovery, /kind: "recommendation"/u);
  assert.match(discovery, /mode: include \? "include" : "exclude"/u);
  assert.match(decisionHistory, /response\?\.selection\?\.kind === "recommendation"/u);
  assert.match(decisionHistory, /selection\.mode === "include"/u);
});
