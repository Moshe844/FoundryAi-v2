import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("Phase B is split into customer-surface components", async () => {
  const page = await source("../app/page.tsx");
  for (const component of ["HomeView", "ProjectsView", "ProviderView"]) {
    assert.match(page, new RegExp(`<${component}`));
  }
  assert.doesNotMatch(page, /function (?:Home|Composer|ProjectCard|ProvidersSheet)\(/);
  assert.doesNotMatch(page, /showProviders/);
});

test("the composer follows the keyboard, sizing, and neutral-intake contract", async () => {
  const [composer, intake] = await Promise.all([
    source("../app/components/project-composer.tsx"),
    source("../experience/intake.ts"),
  ]);
  assert.match(composer, /rows=\{3\}/);
  assert.match(composer, /lineHeight \* 8/);
  assert.match(composer, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(composer, /intent\.trim\(\)/);
  assert.match(composer, /textareaRef\.current\?\.focus\(\)/);
  assert.match(composer, /unavailableReason/);

  assert.match(composer, /Tell Foundry what outcome you want/u);
  assert.match(composer, /A short request is enough/u);
  assert.doesNotMatch(intake, /STARTER_SUGGESTIONS/u);
  assert.doesNotMatch(composer, /suggestions\.map|starter/u);
  assert.match(intake, /effectiveMissionQuery/u);
});

test("project search is URL-backed, debounced, cancellable, and filterable", async () => {
  const [page, list] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/project-list.tsx"),
  ]);
  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /missionQuery === "" \? 0 : 200/);
  assert.match(page, /window\.history\.replaceState/);
  assert.match(page, /searchParams\.set\("q", search\)/);
  assert.match(page, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(page, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(list, /effectiveMissionQuery|query\.trim\(\)\.length >= 2/);
  for (const filter of ["All", "Building", "Needs you", "Delivered", "Stopped"]) {
    assert.match(list, new RegExp(`label: "${filter}"`));
  }
  assert.match(list, /aria-busy=\{searching\}/);
  assert.match(list, /<ProjectComposer/);
});

test("project cards expose truthful real-data actions", async () => {
  const card = await source("../app/components/project-card.tsx");
  assert.match(card, /selectProjectSummary\(mission\)/);
  assert.match(card, /summary\.customerPhase\.value/);
  assert.match(card, /summary\.lastActivityAt\.value/);
  assert.match(card, /summary\.actionLabel\.value/);
  assert.match(card, /aria-haspopup="menu"/);
  assert.match(card, /role="menuitem"/);
  assert.match(card, />\s*Delete\s*</);
  assert.doesNotMatch(card, />\s*(?:Rename|Duplicate)\s*</);
});

test("provider status and model names are rendered only from the live catalogue", async () => {
  const [page, view, adapter] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/provider-view.tsx"),
    source("../../../src/capability-plane/live-ai-adapters.js"),
  ]);
  assert.match(view, /provider\.displayName/);
  assert.match(view, /provider\.reason/);
  assert.match(view, /provider\.models\.map/);
  assert.match(view, /model\.displayName/);
  assert.match(view, /model\.status/);
  assert.match(view, /typeof value !== "string"/);
  assert.match(view, /return "awaiting refresh"/);
  assert.match(view, /billing is the authority on cost/);
  assert.match(page, /validateProviderList/);
  assert.match(adapter, /discover/);
  assert.doesNotMatch(
    `${page}\n${view}`,
    /\b(?:GPT-[45](?:\.\d+)?|Claude (?:Opus|Sonnet)|Gemini (?:Pro|Ultra))\b/iu,
  );
});

test("Phase B production surfaces contain no fixture or demo data path", async () => {
  const production = (
    await Promise.all([
      source("../app/page.tsx"),
      source("../app/components/home-view.tsx"),
      source("../app/components/project-composer.tsx"),
      source("../app/components/project-card.tsx"),
      source("../app/components/project-list.tsx"),
      source("../app/components/provider-view.tsx"),
    ])
  ).join("\n");
  assert.doesNotMatch(production, /\b(?:fixtureOnly|mockMission|demoProjects)\b/u);
});
