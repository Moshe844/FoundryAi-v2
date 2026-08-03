import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

async function source(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const resolved = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(resolved)));
    } else if (/\.(?:js|mjs|ts|tsx|css)$/u.test(entry.name)) {
      files.push(resolved);
    }
  }
  return files;
}

function rgb(hex) {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("Phase G implements the approved responsive preview modes", async () => {
  const [active, preview, spine, css, shell] = await Promise.all([
    source("../app/components/active-execution.tsx"),
    source("../app/components/preview-dock.tsx"),
    source("../app/components/phase-spine.tsx"),
    source("../app/globals.css"),
    source("../app/styles/shell.css"),
  ]);

  assert.match(active, /window\.innerWidth < 768/);
  assert.match(active, /window\.innerWidth < 1280/);
  assert.match(active, /role="tablist"/);
  assert.match(active, /aria-selected=\{tabletTab === "build"\}/);
  assert.match(active, /aria-selected=\{tabletTab === "preview"\}/);
  assert.match(active, /tabletScroll\.current/);
  assert.match(active, /className="mobile-preview-sheet"/);
  assert.match(active, /aria-modal="true"/);
  assert.match(active, /className="mobile-preview-action"/);
  assert.match(active, /View preview/);
  assert.match(active, /hideWidthPresets/);
  assert.match(preview, /title=\{`Preview of \$\{mission\.profile\?\.name/);
  assert.match(preview, /const url = preview\.readinessUrl\.value/);
  assert.doesNotMatch(preview, /setFrameDisconnected/);
  assert.match(spine, /mobile-phase-spine/);
  assert.match(spine, /\{completedCount\} of \{visiblePhases\.length\} done/);
  assert.match(css, /@media \(max-width: 1279px\)/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.doesNotMatch(css, /body\s*\{[^}]*min-width:\s*320px/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /100dvh/);
  assert.match(shell, /grid-template-columns: 64px minmax\(0, 1fr\)/);
  assert.match(shell, /content: attr\(data-label\)/);
});

test("sheets and progressive controls preserve keyboard focus", async () => {
  const [page, shell, navigation, questions, projectCard] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/application-shell.tsx"),
    source("../app/components/navigation-rail.tsx"),
    source("../app/components/clarification-questions.tsx"),
    source("../app/components/project-card.tsx"),
  ]);

  for (const implementation of [page, shell]) {
    assert.match(implementation, /event\.key === "Escape"/);
    assert.match(implementation, /event\.key (?:===|!==) "Tab"/);
    assert.match(implementation, /event\.shiftKey/);
    assert.match(implementation, /\.focus\(\)/);
  }
  assert.match(shell, /id="mobile-navigation-heading"/);
  assert.match(shell, /aria-modal="true"/);
  assert.match(page, /returnFocus\?\.isConnected/);
  assert.match(projectCard, /onDelete\(menuButtonRef\.current\)/);
  assert.match(page, /onCancelRef\.current/);
  assert.match(questions, /otherRef\.current\?\.focus\(\)/);
  assert.match(questions, /otherRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(questions, /skipRef/u);
  assert.match(navigation, /aria-label="Home"/);
  assert.match(navigation, /aria-label="Projects"/);
  assert.match(navigation, /aria-label=\{providerLabel\}/);
  assert.doesNotMatch(
    `${page}\n${shell}\n${navigation}\n${questions}`,
    /window\.(?:confirm|alert|prompt)/,
  );
  assert.doesNotMatch(
    `${page}\n${shell}\n${navigation}\n${questions}`,
    /tabIndex=\{?[1-9]|tabindex=["'][1-9]/u,
  );
});

test("contrast tokens and small accent text satisfy the approved AA boundary", async () => {
  const [tokens, css] = await Promise.all([
    source("../app/styles/tokens.css"),
    source("../app/globals.css"),
  ]);
  const values = Object.fromEntries(
    [...tokens.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/giu)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const checks = [
    ["ink-primary", "surface-canvas", 4.5],
    ["ink-primary", "surface-raised", 4.5],
    ["ink-secondary", "surface-canvas", 4.5],
    ["ink-tertiary", "surface-canvas", 4.5],
    ["ink-inverse", "accent-fill", 4.5],
    ["accent-fill", "surface-canvas", 4.5],
    ["verified", "surface-canvas", 4.5],
    ["attention", "surface-canvas", 4.5],
    ["fault", "surface-canvas", 4.5],
    ["accent-line", "surface-canvas", 3],
  ];
  for (const [foreground, background, minimum] of checks) {
    assert.ok(
      contrast(values[foreground], values[background]) >= minimum,
      `${foreground} on ${background} must meet ${minimum}:1`,
    );
  }
  assert.doesNotMatch(css, /^\s*color:\s*var\(--accent-line\)/gmu);
});

test("reduced motion, forced colours, focus, and touch-size rules remain global", async () => {
  const css = await source("../app/globals.css");
  assert.match(css, /:focus-visible[\s\S]*var\(--ring-accent\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration: 0\.01ms !important/);
  assert.doesNotMatch(css, /\.reduced-phase/);
  assert.doesNotMatch(
    await source("../app/components/active-execution.tsx"),
    /Building · live/,
  );
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\[aria-checked="true"\][\s\S]*Highlight/);
  assert.match(
    css,
    /@media \(max-width: 1279px\)[\s\S]*min-width: 44px[\s\S]*min-height: 44px/,
  );
});

test("live regions announce one meaningful stream and keep activity silent", async () => {
  const [page, active, spine, engineering] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/active-execution.tsx"),
    source("../app/components/phase-spine.tsx"),
    source("../app/components/engineering-details.tsx"),
  ]);
  assert.match(page, /aria-live=\{mission\.error \? "off" : "polite"\}/);
  assert.match(active, /announceRepair=\{needsYou\.length === 0\}/);
  assert.match(
    active,
    /needsYou\.length > 0 \|\| experience\.repair !== null[\s\S]*\? "off"[\s\S]*: "polite"/,
  );
  assert.match(spine, /aria-live=\{announce \? "polite" : "off"\}/);
  assert.doesNotMatch(engineering, /aria-live|role="status"/);
});

test("production customer-experience code contains no prototype intelligence or fixture imports", async () => {
  const roots = [
    path.join(webRoot, "app"),
    path.join(webRoot, "experience"),
    path.join(repositoryRoot, "src"),
  ];
  const files = (
    await Promise.all(roots.map((root) => sourceFiles(root)))
  ).flat();
  const production = (
    await Promise.all(files.map((file) => readFile(file, "utf8")))
  ).join("\n");
  for (const forbidden of [
    "Ridgeway Plumbing",
    "Studio Booking",
    "Team Directory",
    "burst pipe",
    "emergency callout",
    "written estimate",
    "postcode checker",
    "0800 555 0134",
    "localhost:4310",
    "14 of 14",
  ]) {
    assert.doesNotMatch(production, new RegExp(forbidden, "iu"));
  }
  assert.doesNotMatch(
    production,
    /(?:from|import\()\s*["'][^"']*(?:fixtures?|demo)[^"']*["']/iu,
  );
});

test("Phase A through G remain mandatory web regression gates", async () => {
  const packageJson = JSON.parse(await source("../package.json"));
  for (const suite of [
    "rendered-html.test.mjs",
    "phase-a-foundation.test.mjs",
    "phase-b-experience.test.mjs",
    "phase-c-experience.test.mjs",
    "phase-d-experience.test.mjs",
    "phase-e-experience.test.mjs",
    "phase-f-experience.test.mjs",
    "proposal-conversation.test.mjs",
    "phase-g-certification.test.mjs",
  ]) {
    assert.match(packageJson.scripts.test, new RegExp(suite));
  }
});

test("terminal intake truth replaces the reading screen even without a profile", async () => {
  const selectors = await source("../experience/selectors.ts");
  const surface = /function surface\([\s\S]*?\n\}/u.exec(selectors)?.[0] ?? "";
  const cancelled = surface.indexOf('mission.state === "CANCELLED"');
  const profileMissing = surface.indexOf('mission.profile === null');
  assert.ok(cancelled >= 0 && profileMissing >= 0 && cancelled < profileMissing);
  assert.match(
    surface,
    /\["FAILED", "EXHAUSTED"\]\.includes\(mission\.state\)[\s\S]*mission\.profile === null/u,
  );
});

test("the Decision Brief never presents architecture choices as exclusions", async () => {
  const selectors = await source("../experience/selectors.ts");
  assert.match(
    selectors,
    /profile\.constraints\.filter\([\s\S]*?!profile\.architectureDecisions\.includes\(constraint\)/u,
  );
});

test("completion keeps defaults and internal governance out of customer launch gaps", async () => {
  const selectors = await source("../experience/selectors.ts");
  assert.match(selectors, /hasExplicitDeferredCustomerContent\(mission\)/u);
  assert.match(
    selectors,
    /!\(profile\?\.architectureDecisions \?\? \[\]\)\.includes\(description\)/u,
  );
  assert.match(selectors, /milestone\\s\+\\d\+/u);
});
