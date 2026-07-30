import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Phase A uses a modular shell and one canonical experience selector", async () => {
  const [page, shell, rail, selector, validation] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/components/application-shell.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/components/navigation-rail.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../experience/selectors.ts", import.meta.url), "utf8"),
    readFile(new URL("../experience/validation.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<ApplicationShell/);
  assert.doesNotMatch(page, /<nav className="rail"/);
  assert.match(shell, /<NavigationRail/);
  assert.match(shell, /mobile-navigation-sheet/);
  assert.match(rail, /aria-current/);
  assert.match(page, /selectFoundryExperience\(mission, providers\)/);
  assert.match(selector, /export function selectFoundryExperience/);
  assert.match(validation, /export function validateMission/);
  assert.match(validation, /export function validateProviderList/);
  assert.doesNotMatch(selector, /currentActivity[\s\S]{0,120}\.(?:includes|match|test)\(/u);
});

test("every Phase A experience field carries explicit provenance", async () => {
  const contracts = await readFile(
    new URL("../experience/contracts.ts", import.meta.url),
    "utf8",
  );
  const selector = await readFile(
    new URL("../experience/selectors.ts", import.meta.url),
    "utf8",
  );

  for (const contractName of [
    "ProjectSummary",
    "ProjectUnderstanding",
    "FoundryProposal",
    "ProjectJourney",
    "FoundryObservation",
    "DesignAlternative",
    "FoundryRecommendation",
    "ClarificationDecision",
    "DecisionBrief",
    "MissionPhase",
    "MissionNarrative",
    "RepairNarrative",
    "PreviewState",
    "ApprovalRequest",
    "Blocker",
    "CompletionSummary",
    "VerifiedOutcome",
    "KnownLimitation",
    "SuggestedNextStep",
    "ProviderTransparency",
  ]) {
    assert.match(contracts, new RegExp(`type ${contractName}\\b`));
  }
  assert.match(contracts, /type Sourced<T>/);
  assert.match(contracts, /source: ExperienceSource/);
  assert.match(selector, /not exposed by customer API/);
  assert.match(selector, /approval capability is not implemented/);
});

test("design tokens are centralized and shell breakpoints match the approved contract", async () => {
  const [globals, tokens, shell] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/tokens.css", import.meta.url), "utf8"),
    readFile(new URL("../app/styles/shell.css", import.meta.url), "utf8"),
  ]);

  assert.match(globals, /@import "\.\/styles\/tokens\.css"/);
  assert.match(globals, /@import "\.\/styles\/shell\.css"/);
  for (const token of [
    "--surface-canvas",
    "--accent-fill",
    "--ink-primary",
    "--space-20",
    "--radius-xl",
    "--font-display",
    "--dur-panel",
  ]) {
    assert.match(tokens, new RegExp(token));
  }
  assert.match(shell, /min-width: 768px/);
  assert.match(shell, /max-width: 1279px/);
  assert.match(shell, /max-width: 767px/);
  assert.match(shell, /grid-template-columns: 64px/);
  assert.match(shell, /mobile-navigation-sheet/);
});
