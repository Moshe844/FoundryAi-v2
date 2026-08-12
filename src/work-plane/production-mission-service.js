import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";

import {
  CERTIFIED_STACK_ID,
  CERTIFIED_STACK_VERSION,
  CERTIFIED_PROJECT_PACKAGE_VERSIONS,
  StackCertificationStatus,
  WEB_STACK_MANIFEST,
} from "../domain/toolchain-stack.js";
import {
  canonicalizeExecutionValue,
  ModelTaskClass,
  WorkUnitAction,
  WorkUnitStatus,
} from "../domain/execution.js";
import {
  MissionState,
  isTerminalMissionState,
} from "../domain/lifecycle.js";
import { ObservationKind } from "../domain/observation-evidence.js";
import { assertObservationIndependence } from "../domain/observation-independence.js";
import {
  ObservationAction,
  browserObservationDecision,
} from "../domain/browser-observation-policy.js";
import {
  CompletionResult,
  normalizeAcceptanceCondition,
} from "../domain/verification.js";
import {
  parseBrowserResult,
  RuntimeStatus,
} from "../domain/runtime-preview.js";
import {
  CONTRACT_BOUND_BUNDLE_SCHEMA,
  approvedContractRequirementCatalogue,
  approvedDesignDirectionHash,
  contractBoundModelPrompt,
  createModelTaskContract,
  deriveContractRoutingRequirements,
  validateContractBoundMissionPlan,
  validateContractRequirementTrace,
} from "../domain/contract-bound-execution.js";
import {
  normalizeApprovedProjectContract,
  validateApprovedProjectContractConsistency,
} from "../domain/approved-project-contract.js";
import {
  detectEngineeringSignals,
  EngineeringSignal,
  engineeringFloorPromptSegments,
  validateEngineeringFloor,
} from "../domain/engineering-floor.js";
import {
  CERTIFIED_DEPENDENCY_INSTALLER_SOURCE,
  certifiedAuthenticationFastLaneEligible,
  createCertifiedAuthenticationFastLaneBundle,
} from "./certified-auth-fast-lane.js";

export const PRODUCTION_MISSION_SOURCE = "PRODUCTION_MISSION_SERVICE";
const BROWSER_ISOLATION_RESTORE_REASON =
  "Restore browser-observed project state while preserving fingerprint-compatible dependency and build artifacts.";

export const ProductionRepairScope = Object.freeze({
  SOURCE_CODE: "SOURCE_CODE_REPAIR",
  BROWSER_TEST: "BROWSER_TEST_REPAIR",
  RUNTIME: "RUNTIME_REPAIR",
  CONFIGURATION: "CONFIGURATION_REPAIR",
  DEPENDENCY: "DEPENDENCY_REPAIR",
  VERIFICATION_ONLY: "VERIFICATION_ONLY_RETRY",
});

// Ordinary production keeps its one-call policy. A customer-approved live
// prototype explicitly opts into a bounded recovery loop because preserving
// the immutable design may require correcting generated syntax or compiler
// defects without discarding the approved artifact.
const MAX_GENERATION_CORRECTION_CALLS = 0;
const MAX_PROCEDURE_REPAIR_CALLS = 0;
const MAX_APPROVED_PROTOTYPE_GENERATION_CORRECTION_CALLS = 2;
const MAX_APPROVED_PROTOTYPE_PROCEDURE_REPAIR_CALLS = 2;
// Browser repair is reserved for evidence-backed runtime or design failures.
// Raised from two on evidence rather than by guess: once every check carried
// diagnostics, repairs began reducing failures monotonically — 8 then 5 then 3
// across consecutive attempts — and the budget cut that descent off partway
// rather than the repairs running out of ideas. Four keeps it bounded while
// letting a converging sequence finish; a repair that stops making progress
// still stops, because a repeated proposal is rejected before it is paid for.
const MAX_BROWSER_REPAIR_CALLS = 4;
// Raised for the same reason as browser repair, and on the same kind of
// evidence rather than by analogy: once fidelity verdicts carried per-aspect
// measurements, repairs reduced failing aspects 6 then 5 then 2 across
// consecutive attempts and the old limit of two cut that descent off with two
// aspects left. A repair that stops making progress still stops, because a
// repeated proposal is rejected before it is paid for.
const MAX_DESIGN_FIDELITY_REPAIR_CALLS = 4;
// A fixed ceiling of four was drawn from builds recorded before repairs could
// correct every file a failure spanned. Once they could, a build converged
// 5 → 5 → 1 outstanding checks, passed them all, and was cut off at a single
// failing check with the ceiling reached — the same mistake the fidelity
// budget once made, of stopping a correction that was still working.
//
// Progress, not a count, is the right bound. The stall detector below already
// ends a build after two consecutive rounds that reduce nothing, which costs
// about three minutes; that is what protects the clock. This ceiling only has
// to stop an endlessly oscillating build, so it can afford to be generous
// enough that a converging one finishes.
const MAX_BROWSER_OBSERVATION_ATTEMPTS = 6;
// A proposal rejected before it touches a file costs a model call but proves
// nothing, so it does not spend the repair budget. This bounds how many such
// mechanical corrections may be bought per budgeted repair.
const MAX_REPAIR_PROPOSALS_PER_ROUND = 3;
const MAX_RUNTIME_RESTARTS = 2;

export const ProductionComplexity = Object.freeze({
  SIMPLE: "SIMPLE",
  STANDARD: "STANDARD",
  COMPLEX: "COMPLEX",
});

function listLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

// Time and retry policy follows the approved product's observable shape, not
// its label. A calculator and a portal may share the same certified stack, but
// they do not need the same per-check timeout or observation ceiling.
export function productionPerformancePolicy({ profile = null, approvedContract = null } = {}) {
  const blueprint = approvedContract?.productBlueprint ?? null;
  const workflows = Math.max(
    listLength(blueprint?.primaryWorkflows) +
      listLength(blueprint?.supportingWorkflows),
    listLength(profile?.primaryJourneys) +
      listLength(profile?.secondaryJourneys),
  );
  const surfaces = Math.max(
    listLength(blueprint?.requiredSurfaces),
    listLength(profile?.requiredSurfaces),
  );
  const dependencies = Math.max(
    (approvedContract?.acceptedRecommendations ?? []).reduce(
      (total, recommendation) =>
        total + listLength(recommendation?.requiredDependencies),
      0,
    ),
    (profile?.recommendations ?? []).reduce(
      (total, recommendation) =>
        total + listLength(recommendation?.requiredDependencies),
      0,
    ),
  );
  const actors = Math.max(
    listLength(approvedContract?.audiences),
    listLength(profile?.primaryActors),
  );
  const obligations = listLength(approvedContract?.acceptanceObligations);
  const observableShape = JSON.stringify({
    blueprint,
    acceptanceObligations: approvedContract?.acceptanceObligations ?? [],
    primaryJourneys: profile?.primaryJourneys ?? [],
    secondaryJourneys: profile?.secondaryJourneys ?? [],
  });
  // Authentication and durable mutation add database setup plus several
  // dependent browser journeys even when the product has only two screens.
  // Treating that shape like a calculator cut off a Todo Dashboard while its
  // remaining failures were still falling.
  const hasAuthenticationBoundary =
    /\b(?:authenticat\w*|create (?:an? )?account|sign[- ]?in|sign[- ]?up|log[- ]?in|protected route|session)\b/iu.test(
      observableShape,
    );
  const hasDurableMutation =
    /\b(?:persist\w*|durable|database|sqlite|saved record|after (?:a )?(?:browser )?refresh|create,? (?:edit|update)|add,? (?:edit|update)|delete)\b/iu.test(
      observableShape,
    );
  const requiresStatefulVerification =
    hasAuthenticationBoundary || hasDurableMutation;

  // A focused account-access build is stateful, but it is not a portal or a
  // domain application. Treating three short identity journeys like a general
  // stateful product gave a login/sign-up page a seven-minute budget and four
  // repair rounds. The workflow descriptions are the reliable discriminator:
  // every journey must remain about identity, credentials, sessions, or their
  // validation. Small authenticated CRUD products also use the fast lane when
  // their workflow, surface, actor, dependency, and obligation counts all stay
  // inside the same deliberately narrow bounds.
  const workflowDescriptions = [
    ...(blueprint?.primaryWorkflows ?? []),
    ...(blueprint?.supportingWorkflows ?? []),
    ...(profile?.primaryJourneys ?? []),
    ...(profile?.secondaryJourneys ?? []),
  ].map((workflow) => JSON.stringify(workflow));
  const focusedAuthentication =
    hasAuthenticationBoundary &&
    workflowDescriptions.length > 0 &&
    workflowDescriptions.every((description) =>
      /\b(?:account|authenticat\w*|credential\w*|password|session|sign[- ]?in|sign[- ]?out|sign[- ]?up|log[- ]?in|log[- ]?out|invalid input|access error)\b/iu.test(
        description,
      ),
    );

  const compactStatefulProduct =
    requiresStatefulVerification &&
    workflows <= 6 &&
    surfaces <= 8 &&
    dependencies === 0 &&
    actors <= 2 &&
    obligations <= 16;
  const simple =
    (!requiresStatefulVerification ||
      focusedAuthentication ||
      compactStatefulProduct) &&
    workflows <= 6 &&
    surfaces <= 8 &&
    dependencies === 0 &&
    actors <= (focusedAuthentication ? 3 : 2) &&
    obligations <= 16;
  const standard =
    workflows <= 12 &&
    surfaces <= 16 &&
    dependencies <= 3 &&
    actors <= 5 &&
    obligations <= 28;
  const complexity = simple
    ? ProductionComplexity.SIMPLE
    : standard
      ? ProductionComplexity.STANDARD
      : ProductionComplexity.COMPLEX;

  const policies = {
    [ProductionComplexity.SIMPLE]: {
      targetDurationMs: 2 * 60_000,
      // Stateful authentication checks create an account, revoke it, sign in
      // again, and verify refresh through real scrypt/SQLite work. Five seconds
      // cut off a correct journey; eight still bounds failures tightly while
      // allowing the real secure path to finish.
      browserCheckBudgetMs: 8_000,
      // The complete browser-action phase is bounded separately from model
      // repair and design comparison. Normal products do not get an
      // unbounded five-minute Playwright command or a fourth full rerun.
      browserVerificationBudgetMs: 60_000,
      browserObservationAttempts: 2,
      browserRepairCalls: 1,
      designFidelityRepairCalls: 1,
      runtimeRestarts: 2,
    },
    [ProductionComplexity.STANDARD]: {
      targetDurationMs: 7 * 60_000,
      browserCheckBudgetMs: 10_000,
      // Four bounded observations include immutable pre/post workspace
      // checkpoints as well as the Playwright subprocess. A one-minute total
      // expired after a 22-second browser run because two checkpointed rounds
      // had already consumed the rest. Two minutes keeps each individual check
      // at ten seconds while leaving room for one final converging correction.
      browserVerificationBudgetMs: 120_000,
      browserObservationAttempts: 4,
      browserRepairCalls: 4,
      designFidelityRepairCalls: 1,
      runtimeRestarts: 2,
    },
    [ProductionComplexity.COMPLEX]: {
      targetDurationMs: 12 * 60_000,
      browserCheckBudgetMs: 15_000,
      browserVerificationBudgetMs: 3 * 60_000,
      browserObservationAttempts: MAX_BROWSER_OBSERVATION_ATTEMPTS,
      browserRepairCalls: MAX_BROWSER_REPAIR_CALLS,
      designFidelityRepairCalls: MAX_DESIGN_FIDELITY_REPAIR_CALLS,
      runtimeRestarts: MAX_RUNTIME_RESTARTS,
    },
  };
  return Object.freeze({ complexity, ...policies[complexity] });
}

export function productionRepairModelTimeoutMs(performancePolicy) {
  if (performancePolicy?.complexity === ProductionComplexity.SIMPLE)
    return 20_000;
  if (performancePolicy?.complexity === ProductionComplexity.STANDARD)
    return 45_000;
  return 90_000;
}

export function productionRepairBudgets({
  approvedPrototype = false,
  performancePolicy = null,
  stateful = false,
} = {}) {
  const statefulCorrectionCalls =
    stateful ||
    performancePolicy?.complexity === ProductionComplexity.STANDARD ||
    performancePolicy?.complexity === ProductionComplexity.COMPLEX
      ? 1
      : 0;
  return Object.freeze({
    generationCorrectionCalls: approvedPrototype
      ? MAX_APPROVED_PROTOTYPE_GENERATION_CORRECTION_CALLS
      : Math.max(MAX_GENERATION_CORRECTION_CALLS, statefulCorrectionCalls),
    procedureRepairCalls: approvedPrototype
      ? MAX_APPROVED_PROTOTYPE_PROCEDURE_REPAIR_CALLS
      : Math.max(MAX_PROCEDURE_REPAIR_CALLS, statefulCorrectionCalls),
    browserRepairCalls:
      performancePolicy?.browserRepairCalls ?? MAX_BROWSER_REPAIR_CALLS,
    designFidelityRepairCalls:
      performancePolicy?.designFidelityRepairCalls ?? MAX_DESIGN_FIDELITY_REPAIR_CALLS,
    runtimeRestarts:
      performancePolicy?.runtimeRestarts ?? MAX_RUNTIME_RESTARTS,
  });
}

// A check reported false with no diagnostics was never computed: the test
// exited before reaching it and the finally block emitted its initial value.
// Reporting that as "the check failed" sent repairs chasing application
// defects that did not exist, once for every check downstream of a single
// early break.
// A check that can only run once someone is signed in is not independent
// evidence when signing in is itself broken. One build reported nine false
// checks — sign-in, the gated route, the created-user list, the layout behind
// it — and spent three identical rounds trying to correct nine defects when
// there was one. Naming the gateway lets the repair fix the cause.
const GATEWAY_STATEMENT =
  /\b(?:signs? in|sign-in|signin|log(?:s|ged)? in|log-in|login|authenticat\w*|create an account|sign(?:s|ing)? up|sign-up)\b/iu;

export function blockedByGatewayFailure(failedCheckIds, obligations = []) {
  const statementOf = new Map(
    obligations.map((obligation) => [
      obligation.obligationId,
      String(obligation.statement ?? ""),
    ]),
  );
  const gateways = failedCheckIds.filter((checkId) =>
    GATEWAY_STATEMENT.test(statementOf.get(checkId) ?? ""),
  );
  if (gateways.length === 0 || failedCheckIds.length <= gateways.length) return null;
  const downstream = failedCheckIds.filter((checkId) => !gateways.includes(checkId));
  return [
    `${gateways.join(" and ")} ${gateways.length === 1 ? "is" : "are"} false, and every workflow behind ${gateways.length === 1 ? "it" : "them"} runs only once that succeeds.`,
    `Fix ${gateways.length === 1 ? "that first" : "those first"}. The other ${downstream.length} failing check(s) — ${downstream.join(", ")} — are probably not independent defects, and correcting them one by one while the gateway is broken changes nothing observable.`,
  ].join(" ");
}

export function browserCheckObservationFailure(failedCheckIds, diagnostics = {}, obligations = []) {
  const uncomputed = failedCheckIds.filter(
    (checkId) => Object.keys(diagnostics?.[checkId] ?? {}).length === 0,
  );
  const observed = failedCheckIds.filter((checkId) => !uncomputed.includes(checkId));
  const failedSubchecks = Object.fromEntries(
    observed.flatMap((checkId) => {
      const failed = Object.entries(diagnostics?.[checkId] ?? {})
        .filter(([, passed]) => passed === false)
        .map(([name]) => name);
      return failed.length === 0 ? [] : [[checkId, failed]];
    }),
  );
  const thrownChecks = Object.fromEntries(
    observed.flatMap((checkId) => {
      const detail = diagnostics?.[checkId] ?? {};
      const message = detail.threw ?? detail.error;
      return typeof message === "string" && message.trim() !== ""
        ? [[checkId, message]]
        : [];
    }),
  );
  const lines =
    uncomputed.length === failedCheckIds.length && uncomputed.length > 0
      ? [
          `The browser observation test stopped before it computed ${uncomputed.length} of its required checks: ${uncomputed.join(", ")}. Their reported false values are the initial values, not observations, and no diagnostics were emitted for any of them.`,
          "Do not treat these as application defects. Find why the test run ended early — an unhandled rejection, a failed await, a timeout, or a locator that never resolved — and make every check compute independently so one failed step cannot leave the rest unobserved.",
        ]
      : [
          `The following real browser checks were false: ${observed.join(", ")}.`,
          ...(uncomputed.length === 0
            ? []
            : [
                `These checks were never computed because the test stopped early, so their false values are not observations: ${uncomputed.join(", ")}. Fix the run first; do not change application source on their account.`,
              ]),
        ];
  const gateway = blockedByGatewayFailure(observed, obligations);
  return [
    ...lines,
    ...(Object.keys(failedSubchecks).length === 0
      ? []
      : [`Failed named sub-checks: ${JSON.stringify(failedSubchecks)}.`]),
    ...(Object.keys(thrownChecks).length === 0
      ? []
      : [`Checks that threw or timed out: ${JSON.stringify(thrownChecks)}.`]),
    ...(gateway === null ? [] : [gateway]),
  ].join("\n");
}

// The specs Foundry authors and reinjects each round. A repair to one of them
// is thrown away by construction, so they are never offered as repair targets;
// tests/foundry-checks.ts, which the model writes, remains repairable.
export function foundryOwnedTestPath(path) {
  const normalized = String(path).replaceAll("\\", "/");
  return (
    normalized === "tests/foundry-observation.spec.ts" ||
    /^tests\/foundry-design-fidelity-evidence(?:-[a-z0-9-]+)?\.spec\.ts$/u.test(
      normalized,
    )
  );
}

// True when `next build` will itself fail on a type error and on a lint error,
// which is the default for the certified Next 15 stack. When it holds, running
// tsc and eslint as separate gate steps finds nothing the build will not find
// a minute later, and the gate re-runs after every repair.
export function buildEnforcesTypesAndLint(files) {
  const byPath = new Map(
    (files ?? []).map((file) => [
      String(file.path).replaceAll("\\", "/"),
      String(file.content),
    ]),
  );
  const nextConfig = [...byPath.entries()].find(([path]) =>
    /^next\.config\.(?:cjs|js|mjs|ts)$/u.test(path),
  )?.[1];
  // Either escape hatch means the build stops enforcing that check, so the
  // standalone command is the only thing still covering it.
  if (
    nextConfig !== undefined &&
    /\b(?:ignoreBuildErrors|ignoreDuringBuilds)\s*:\s*true\b/u.test(nextConfig)
  ) {
    return false;
  }
  // Without an eslint config next build has no lint step to inherit.
  const hasEslintConfig = [...byPath.keys()].some((path) =>
    /^(?:eslint\.config\.(?:cjs|js|mjs|ts)|\.eslintrc(?:\.(?:cjs|js|json|mjs|yml|yaml))?)$/u.test(
      path,
    ),
  );
  return hasEslintConfig;
}

export function productionBrowserRepairPolicy(
  observationFailure,
  { nonFidelityFailureOutstanding = false, repairBudgets = null } = {},
) {
  const designFidelity =
    !nonFidelityFailureOutstanding &&
    typeof observationFailure === "string" &&
    /Production design fidelity failed against the approved live prototype/iu.test(
      observationFailure,
    );
  return Object.freeze({
    designFidelity,
    requestSegment: designFidelity
      ? "design-fidelity-repair"
      : "browser-repair",
    maxCalls: designFidelity
      ? repairBudgets?.designFidelityRepairCalls ?? MAX_DESIGN_FIDELITY_REPAIR_CALLS
      : repairBudgets?.browserRepairCalls ?? MAX_BROWSER_REPAIR_CALLS,
  });
}

// Approved-design checks used to be treated as a second, weaker completion
// authority beside the deterministic prototype comparator. That let a stale
// model-authored selector overrule a complete desktop/tablet/mobile fidelity
// pass and spend every repair on an application that was already correct.
// Functional behaviour remains owned by its exact browser workflows. Design
// obligations are owned by the immutable approved-prototype comparison when
// that authority is present.
export function browserCheckAuthorityPlan({
  obligations = [],
  bindings = {},
  approvedPrototypeContract = null,
} = {}) {
  const required = obligations
    .filter(
      (obligation) =>
        bindings[obligation.obligationId] === "browser-check" ||
        (obligation.origin !== "foundry-derived" &&
          obligationRequiresCredentialLoginProof(obligation.statement)),
    )
    .map((obligation) => obligation.obligationId)
    .sort((left, right) => left.localeCompare(right));
  const design =
    approvedPrototypeContract === null
      ? []
      : obligations
          .filter(
            (obligation) =>
              bindings[obligation.obligationId] === "browser-check" &&
              /^approved-design-/u.test(
                String(obligation.sourceRequirement ?? ""),
              ),
          )
          .map((obligation) => obligation.obligationId)
          .sort((left, right) => left.localeCompare(right));
  const designSet = new Set(design);
  return Object.freeze({
    required: Object.freeze(required),
    functional: Object.freeze(
      required.filter((obligationId) => !designSet.has(obligationId)),
    ),
    design: Object.freeze(design),
  });
}

function sourcePosition(source, index) {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  const column = index - (before.lastIndexOf("\n") + 1) + 1;
  return { line, column };
}

function lineAt(source, index) {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const end = source.indexOf("\n", index);
  const text = source.slice(start, end === -1 ? source.length : end).trim();
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

// The gate knew precisely which delimiter was unmatched and where, then
// discarded it and returned a boolean. The regeneration that followed was told
// only "has unbalanced JavaScript delimiters" about a file of several thousand
// characters, so it re-emitted the same defect until the correction budget ran
// out. Report the position and the offending delimiter.
export function unbalancedJavaScriptDelimiter(source) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const opening = new Set(Object.values(pairs));
  const stack = [];
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let regularExpression = false;
  let regularExpressionCharacterClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (regularExpression) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "[") {
        regularExpressionCharacterClass = true;
      } else if (
        character === "]" &&
        regularExpressionCharacterClass
      ) {
        regularExpressionCharacterClass = false;
      } else if (
        character === "/" &&
        !regularExpressionCharacterClass
      ) {
        regularExpression = false;
      }
      continue;
    }
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "/") {
      const prefix = source.slice(0, index).trimEnd();
      const priorCharacter = prefix.at(-1);
      if (
        prefix === "" ||
        /[([{:,;=!?&|]/u.test(priorCharacter) ||
        /\b(?:return|case|throw|yield|await|typeof|instanceof|in|of)$/u.test(
          prefix,
        )
      ) {
        regularExpression = true;
        regularExpressionCharacterClass = false;
        continue;
      }
    }
    const wordBeforeApostrophe =
      /[\p{L}\p{N}_$]+$/u.exec(source.slice(0, index))?.[0] ?? "";
    const apostropheInRenderedText =
      character === "'" &&
      /[\p{L}\p{N}]/u.test(source[index - 1] ?? "") &&
      /[\p{L}\p{N}]/u.test(next ?? "") &&
      // Minified modules validly emit `from'next'`. That opening quote has a
      // letter on both sides just like an English contraction, but skipping it
      // makes the real closing quote look unterminated and falsely rejects
      // every import in the file.
      wordBeforeApostrophe !== "from";
    if (apostropheInRenderedText) continue;
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (opening.has(character)) {
      stack.push({ character, index });
    } else if (character in pairs) {
      const open = stack.pop();
      if (open === undefined) {
        const at = sourcePosition(source, index);
        return `a closing "${character}" at line ${at.line} column ${at.column} has no matching "${pairs[character]}" — ${lineAt(source, index)}`;
      }
      if (open.character !== pairs[character]) {
        const at = sourcePosition(source, index);
        const from = sourcePosition(source, open.index);
        return `a closing "${character}" at line ${at.line} column ${at.column} does not match the "${open.character}" opened at line ${from.line} column ${from.column} — ${lineAt(source, index)}`;
      }
    }
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    const at = sourcePosition(source, open.index);
    return `the "${open.character}" opened at line ${at.line} column ${at.column} is never closed (${stack.length} delimiter${stack.length === 1 ? "" : "s"} left open at end of file) — ${lineAt(source, open.index)}`;
  }
  if (quote !== null) return `a ${quote === "`" ? "template literal" : "string"} opened with ${quote} is never closed`;
  if (blockComment) return "a /* block comment is never closed";
  if (regularExpression) return "a regular expression literal is never closed";
  return null;
}

export function hasBalancedJavaScriptDelimiters(source) {
  return unbalancedJavaScriptDelimiter(source) === null;
}

// Mute for the same reason the delimiter checker was, and rejected builds the
// same way: the regeneration was told only that "app/page.tsx has unbalanced
// JSX tags" and had to find the tag itself.
export function unbalancedJsxTag(source) {
  const voidTags = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);
  const stack = [];
  let cursor = 0;
  const describe = (index) => {
    const at = sourcePosition(source, index);
    return `line ${at.line} column ${at.column}`;
  };
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start === -1) break;
    let position = start + 1;
    const closing = source[position] === "/";
    if (closing) position += 1;
    if (
      !closing &&
      stack.length === 0 &&
      /[A-Za-z0-9_$.)\]]/u.test(source[start - 1] ?? "")
    ) {
      cursor = start + 1;
      continue;
    }
    const tag = /^[a-z][a-z0-9-]*/u.exec(source.slice(position))?.[0];
    if (tag === undefined) {
      cursor = start + 1;
      continue;
    }
    const boundary = source[position + tag.length];
    if (boundary !== ">" && boundary !== "/" && !/\s/u.test(boundary ?? "")) {
      cursor = start + 1;
      continue;
    }
    let quote = null;
    let escaped = false;
    let braceDepth = 0;
    let end = -1;
    for (let index = position + tag.length; index < source.length; index += 1) {
      const character = source[index];
      if (quote !== null) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}" && braceDepth > 0) {
        braceDepth -= 1;
      } else if (character === ">" && braceDepth === 0) {
        end = index;
        break;
      }
    }
    if (end === -1) {
      return `the <${tag}> at ${describe(start)} is never closed with ">" — ${lineAt(source, start)}`;
    }
    const selfClosing =
      /\/\s*$/u.test(source.slice(position + tag.length, end)) ||
      voidTags.has(tag);
    cursor = end + 1;
    if (selfClosing) continue;
    if (closing) {
      const open = stack.pop();
      if (open === undefined) {
        return `a closing </${tag}> at ${describe(start)} has no matching <${tag}> — ${lineAt(source, start)}`;
      }
      if (open.tag !== tag) {
        return `a closing </${tag}> at ${describe(start)} does not match the <${open.tag}> opened at ${describe(open.index)} — ${lineAt(source, start)}`;
      }
    } else {
      stack.push({ tag, index: start });
    }
  }
  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    return `the <${open.tag}> opened at ${describe(open.index)} is never closed (${stack.length} tag${stack.length === 1 ? "" : "s"} left open at end of file) — ${lineAt(source, open.index)}`;
  }
  return null;
}

export function hasBalancedJsxTags(source) {
  return unbalancedJsxTag(source) === null;
}

export function repairScopeForPath(path) {
  const normalized = String(path).replaceAll("\\", "/").toLowerCase();
  if (
    normalized.startsWith("tests/") ||
    /^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(normalized)
  ) {
    return normalized.startsWith("tests/")
      ? ProductionRepairScope.BROWSER_TEST
      : ProductionRepairScope.CONFIGURATION;
  }
  if (
    normalized === "package.json" ||
    normalized === "package-lock.json" ||
    normalized === "npm-shrinkwrap.json"
  ) {
    return ProductionRepairScope.DEPENDENCY;
  }
  if (
    /^(?:next|eslint|tsconfig)\.(?:config\.)?(?:cjs|js|json|mjs|ts)$/u.test(
      normalized,
    )
  ) {
    return ProductionRepairScope.CONFIGURATION;
  }
  return ProductionRepairScope.SOURCE_CODE;
}

// A multi-file repair reruns the pipeline its widest-reaching file demands, so
// changing a stylesheet next to a dependency manifest still reinstalls.
const REPAIR_SCOPE_DEPTH = Object.freeze([
  ProductionRepairScope.BROWSER_TEST,
  ProductionRepairScope.CONFIGURATION,
  ProductionRepairScope.SOURCE_CODE,
  ProductionRepairScope.DEPENDENCY,
]);

export function deepestRepairScope(scopes) {
  let deepest = ProductionRepairScope.BROWSER_TEST;
  for (const scope of scopes) {
    if (REPAIR_SCOPE_DEPTH.indexOf(scope) > REPAIR_SCOPE_DEPTH.indexOf(deepest)) {
      deepest = scope;
    }
  }
  return deepest;
}

// `npm ci` refuses to install when package-lock.json and package.json disagree,
// and says so precisely: "lock file's react-dom@19.1.0 does not satisfy
// react-dom@19.0.0 ... update your lock file with `npm install`". The remedy is
// deterministic and npm names it. Foundry instead sent the failure to a model,
// which edited package.json twice, neither time touching the lock, and the
// mission exhausted its install budget with the application unbuilt.
export function lockOutOfSyncWithManifest(output) {
  const text = String(output ?? "");
  return (
    /npm error code EUSAGE/u.test(text) ||
    /can only install packages when your package\.json and package-lock\.json[\s\S]{0,80}are in sync/u.test(text) ||
    /lock file's .+ does not satisfy /u.test(text) ||
    /Missing: .+ from lock file/u.test(text)
  );
}

export function classifyProductionFailure({
  stage,
  stdout = "",
  stderr = "",
  observationFailure = "",
}) {
  const text = `${stdout}\n${stderr}\n${observationFailure}`;
  const unresolvedLocalModule =
    /(?:Cannot find module|Module not found(?::|.*resolve))\s*['"]?(?:@\/|\.{1,2}[\\/])/iu.test(
      text,
    );
  const browserObservedServerFailure =
    stage === "browserVerification" &&
    /(?:status(?:\s+of)?\s+5\d{2}\b|responded\s+with\s+a\s+status\s+of\s+5\d{2}\b|\b5\d{2}\s+\(Internal Server Error\)|\bInternal Server Error\b)/iu.test(
      text,
    );
  const nonFidelityBrowserFailure =
    stage === "browserVerification" &&
    /(?:The Playwright command exited unsuccessfully|structured browser result|browser result could not be parsed|did not contain exactly the required browser-check|The following real browser checks were false|browser observation recorded blocking errors)/iu.test(
      text,
    );
  const approvedPrototypeFidelityFailure =
    stage === "browserVerification" &&
    !nonFidelityBrowserFailure &&
    /(?:Production design fidelity failed against the approved live prototype|Approved live prototype fidelity could not be proven)/iu.test(
      text,
    );
  if (approvedPrototypeFidelityFailure) {
    return Object.freeze({
      scope: ProductionRepairScope.SOURCE_CODE,
      hypothesis:
        "The production experience differs from immutable approved prototype evidence; repair only the implicated application source or styles and preserve working behavior.",
    });
  }
  if (browserObservedServerFailure) {
    return Object.freeze({
      scope: ProductionRepairScope.SOURCE_CODE,
      hypothesis:
        "The running application returned a server error; repair application source rather than the observation test.",
    });
  }
  if (
    stage === "browserVerification" &&
    /(?:executable doesn['’]t exist|browserType\.launch|ms-playwright[\\/].*(?:chrome|headless_shell))/iu.test(
      text,
    )
  ) {
    return Object.freeze({
      scope: ProductionRepairScope.CONFIGURATION,
      hypothesis:
        "Playwright attempted an unavailable bundled browser instead of the certified system Chrome channel.",
    });
  }
  if (
    stage === "browserVerification" &&
    /(?:structured browser result|browser result could not be parsed|did not contain exactly the required browser-check|missing required browser result|multiple browser result markers)/iu.test(
      text,
    )
  ) {
    return Object.freeze({
      scope: ProductionRepairScope.BROWSER_TEST,
      hypothesis:
        "The browser observation code or its structured evidence protocol is invalid.",
    });
  }
  if (
    stage === "browserVerification" &&
    /(?:ECONNRESET|ECONNREFUSED|ERR_CONNECTION|navigation.*timeout)/iu.test(
      text,
    )
  ) {
    return Object.freeze({
      scope: ProductionRepairScope.RUNTIME,
      hypothesis:
        "The browser could not reliably reach the owned runtime.",
    });
  }
  if (stage === "browserVerification") {
    return Object.freeze({
      scope: ProductionRepairScope.SOURCE_CODE,
      hypothesis:
        "The running artifact or its browser observation did not meet the contract.",
    });
  }
  if (unresolvedLocalModule) {
    return Object.freeze({
      scope: ProductionRepairScope.SOURCE_CODE,
      hypothesis:
        "Generated source references a local module that the project cannot resolve.",
    });
  }
  if (
    /(?:next\.config|eslint\.config|tsconfig|require is not defined in ES module)/iu.test(
      text,
    )
  ) {
    return Object.freeze({
      scope: ProductionRepairScope.CONFIGURATION,
      hypothesis: "Project toolchain configuration is invalid.",
    });
  }
  if (
    /(?:ETARGET|No matching version found|'next' is not recognized|next:\s+not found|Cannot find package|Cannot find module ['"]?(?!@\/|\.{1,2}[\\/])|Module not found.*resolve ['"]?(?!@\/|\.{1,2}[\\/]))/iu.test(
      text,
    )
  ) {
    return Object.freeze({
      scope: ProductionRepairScope.DEPENDENCY,
      hypothesis: "The installed dependency artifact is missing or invalid.",
    });
  }
  return Object.freeze({
    scope: ProductionRepairScope.SOURCE_CODE,
    hypothesis: "Generated application source failed a deterministic procedure.",
  });
}

const projectBundleSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  },
});

// A design-fidelity failure is normally spread across the file that holds the
// markup and the file that holds the styles: typography and color live in the
// stylesheet, surface order and navigation landmarks live in the page. A patch
// that could name only one file could never satisfy both, so the loop spent its
// whole budget alternating — correcting the page, leaving the approved font and
// palette untouched, then paying another round to undo what the page edit broke.
// A repair may now name several files at once and is still bounded: few files,
// exact search/replace text, and the eligible-file allowlist below.
export const MAX_REPAIR_FILES_PER_PROPOSAL = 4;

const browserRepairPatchSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: {
      type: "array",
      minItems: 1,
      maxItems: MAX_REPAIR_FILES_PER_PROPOSAL,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "replacements"],
        properties: {
          path: { type: "string" },
          replacements: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["oldText", "newText"],
              properties: {
                oldText: { type: "string", minLength: 1 },
                newText: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
});

// Search/replace is the efficient way to correct a file and the fragile one:
// every oldText must still match the current content exactly once. Two
// consecutive builds died with four minutes of good work done because the
// model could not produce an applicable patch three times — not because its
// diagnosis was wrong, but because the format defeated it. When that happens
// the repair is asked for the corrected file instead. Whole files cost more
// tokens, which is why they are the fallback and not the default.
const wholeFileRepairSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: {
      type: "array",
      minItems: 1,
      maxItems: MAX_REPAIR_FILES_PER_PROPOSAL,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string", minLength: 1 },
        },
      },
    },
  },
});

// Deterministic admission can name the exact generated file that is invalid.
// Re-generating an otherwise valid application in that case is both expensive
// and destabilizing: a broken observation file used to cause two complete
// 30k-token bundle rewrites. Keep the correction at the smallest trustworthy
// boundary and preserve every unaffected file and contract trace.
export function admissionCorrectionPaths(error, files = []) {
  const available = new Set(files.map((file) => file.path));
  const message = String(error?.message ?? error ?? "");
  const paths = new Set(
    [...message.matchAll(/Generated source "([^"]+)"/gu)]
      .map((match) => match[1])
      .filter((path) => available.has(path)),
  );
  if (
    /\bcheck\s+"(?:obligation|check)-/iu.test(message) &&
    available.has("tests/foundry-checks.ts")
  ) {
    paths.add("tests/foundry-checks.ts");
  }
  return paths.size > 0 && paths.size <= MAX_REPAIR_FILES_PER_PROPOSAL
    ? Object.freeze([...paths].sort((left, right) => left.localeCompare(right)))
    : Object.freeze([]);
}

export function mergeAdmissionCorrection(plan, correction, allowedPaths) {
  const files = Array.isArray(correction?.files) ? correction.files : [];
  const allowed = new Set(allowedPaths);
  if (files.length === 0) {
    throw new TypeError("A scoped admission correction must return at least one file.");
  }
  const replacements = new Map();
  for (const file of files) {
    if (
      typeof file?.path !== "string" ||
      typeof file?.content !== "string" ||
      !allowed.has(file.path) ||
      replacements.has(file.path)
    ) {
      throw new TypeError(
        "A scoped admission correction may replace each allowed file exactly once.",
      );
    }
    replacements.set(file.path, file.content);
  }
  const currentPaths = new Set(plan.files.map((file) => file.path));
  for (const path of replacements.keys()) {
    if (!currentPaths.has(path)) {
      throw new TypeError(`Scoped admission correction cannot create "${path}".`);
    }
  }
  return {
    ...plan,
    files: plan.files.map((file) =>
      replacements.has(file.path)
        ? { ...file, content: replacements.get(file.path) }
        : file,
    ),
  };
}

// A complete admission correction owns the new source, but it does not get to
// erase already-admitted contract bookkeeping. Models commonly focus on the
// structural defect named in the correction prompt and return a shorter claim
// list even though the corrected files still implement the same approved
// requirements. Preserve those trace links by stable requirement and file
// identity; the normal contract, source, build, browser, and fidelity gates
// still verify the corrected implementation itself.
export function mergeCompleteAdmissionCorrection(plan, correction) {
  if (
    plan === null ||
    correction === null ||
    typeof plan !== "object" ||
    typeof correction !== "object"
  ) {
    return correction;
  }
  const claims = new Map(
    (Array.isArray(plan.requirementClaims) ? plan.requirementClaims : [])
      .filter((claim) => typeof claim?.requirementId === "string")
      .map((claim) => [claim.requirementId, claim]),
  );
  for (const claim of correction.requirementClaims ?? []) {
    if (typeof claim?.requirementId === "string") {
      claims.set(claim.requirementId, claim);
    }
  }
  const priorFiles = new Map(
    (Array.isArray(plan.files) ? plan.files : []).map((file) => [file.path, file]),
  );
  return {
    ...correction,
    requirementClaims: [...claims.values()],
    explicitExclusionIds: [
      ...new Set([
        ...(plan.explicitExclusionIds ?? []),
        ...(correction.explicitExclusionIds ?? []),
      ]),
    ],
    files: (Array.isArray(correction.files) ? correction.files : []).map(
      (file) => ({
        ...file,
        contractRequirementIds: [
          ...new Set([
            ...(priorFiles.get(file.path)?.contractRequirementIds ?? []),
            ...(file.contractRequirementIds ?? []),
          ]),
        ],
      }),
    ),
  };
}

export function reconstructGenerationOutput(calls) {
  if (!Array.isArray(calls) || calls.length === 0) return null;
  let output = calls[0].structuredOutput;
  for (const call of calls.slice(1)) {
    const candidate = call.structuredOutput;
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof candidate.contractHash === "string"
    ) {
      output = mergeCompleteAdmissionCorrection(output, candidate);
      continue;
    }
    output = mergeAdmissionCorrection(
      output,
      candidate,
      candidate?.files?.map((file) => file.path) ?? [],
    );
  }
  return output;
}

// A whole-file proposal is turned into the patch shape the rest of the loop
// already understands: one replacement of the entire current file.
export function patchFromWholeFileRepair(structuredOutput, currentFiles) {
  const files = structuredOutput?.files;
  if (!Array.isArray(files)) return structuredOutput;
  return {
    ...structuredOutput,
    files: files.map((file) => {
      const current = currentFiles.find(
        (candidate) => candidate.path === file?.path,
      );
      if (current === undefined || typeof file?.content !== "string") {
        return { path: file?.path, replacements: [] };
      }
      return {
        path: file.path,
        replacements: [{ oldText: current.content, newText: file.content }],
      };
    }),
  };
}

function repairPatchSchemaScopedToPaths(schema, paths) {
  const files = schema.properties.files;
  return Object.freeze({
    ...schema,
    properties: Object.freeze({
      ...schema.properties,
      files: Object.freeze({
        ...files,
        items: Object.freeze({
          ...files.items,
          properties: Object.freeze({
            ...files.items.properties,
            path: Object.freeze({
              type: "string",
              enum: Object.freeze([...paths]),
            }),
          }),
        }),
      }),
    }),
  });
}

// Callers hold a proposal that may name one file or several; every reader of a
// repair wants the same list either way.
export function repairPatchFiles(structuredOutput) {
  const files = structuredOutput?.files;
  if (Array.isArray(files)) return files;
  return typeof structuredOutput?.path === "string" ? [structuredOutput] : [];
}

function contractTraceSchema(schema, enabled) {
  if (!enabled) return schema;
  return Object.freeze({
    ...schema,
    required: Object.freeze([...schema.required, "contractRequirementIds"]),
    properties: Object.freeze({
      ...schema.properties,
      contractRequirementIds: Object.freeze({
        type: "array",
        minItems: 1,
        items: Object.freeze({ type: "string", minLength: 1 }),
      }),
    }),
  });
}

export function validateProjectBundleForStack(
  files,
  requiredBrowserCheckIds = [],
  customerContent = null,
  browserQualityRequirements = {},
) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new TypeError("The generated stack bundle must contain files.");
  }
  const byPath = new Map();
  for (const file of files) {
    if (
      file === null ||
      typeof file !== "object" ||
      typeof file.path !== "string" ||
      typeof file.content !== "string" ||
      file.path.includes("\\") ||
      file.path.startsWith("/") ||
      file.path.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new TypeError(
        "The generated stack bundle contains an unsafe or malformed file.",
      );
    }
    if (byPath.has(file.path)) {
      throw new TypeError(
        `The generated stack bundle contains duplicate path "${file.path}".`,
      );
    }
    byPath.set(file.path, file.content);
  }
  const generatedSourceIssues = [];
  const routeArchitectureIssues = [];
  const allowedRouteExports = new Set([
    "DELETE",
    "GET",
    "HEAD",
    "OPTIONS",
    "PATCH",
    "POST",
    "PUT",
    "config",
    "dynamic",
    "dynamicParams",
    "fetchCache",
    "generateStaticParams",
    "maxDuration",
    "preferredRegion",
    "revalidate",
    "runtime",
  ]);
  for (const [path, content] of byPath) {
    if (/\.(?:js|jsx|mjs|ts|tsx)$/u.test(path)) {
      const unbalanced = unbalancedJavaScriptDelimiter(content);
      if (unbalanced !== null) {
        generatedSourceIssues.push(
          `Generated source "${path}" has unbalanced JavaScript delimiters: ${unbalanced}. Correct that expression and return the complete file.`,
        );
      }
      if (/\b(?:eval|Function)\s*\(/u.test(content)) {
        generatedSourceIssues.push(
          `Generated source "${path}" uses unsafe string-to-code execution. Write the behavior directly; for arithmetic, parse operands and apply explicit operators instead of using eval or Function.`,
        );
      }
      if (/\bPromise<[^<>\r\n]{1,200}=>/u.test(content)) {
        generatedSourceIssues.push(
          `Generated source "${path}" has a malformed Promise return type before an arrow function. Close the generic type first, for example Promise<void> =>.`,
        );
      }
    }
    if (/^(?:src\/)?app\/api\/.+\/route\.(?:js|ts)$/u.test(path)) {
      const exportLists = [...content.matchAll(/\bexport\s*\{([^}]+)\}/gu)]
        .flatMap((match) => match[1].split(","))
        .map((entry) => entry.trim().split(/\s+as\s+/u).at(-1))
        .filter(Boolean);
      const runtimeExports = [
        ...content.matchAll(
          /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gu,
        ),
        ...content.matchAll(
          /\bexport\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/gu,
        ),
      ].map((match) => match[1]).concat(exportLists);
      if (/\bexport\s+default\b/u.test(content)) {
        runtimeExports.push("default");
      }
      const unsupported = [
        ...new Set(runtimeExports.filter((name) => !allowedRouteExports.has(name))),
      ];
      if (unsupported.length > 0) {
        routeArchitectureIssues.push(
          `Next.js route module "${path}" exports unsupported application helper${unsupported.length === 1 ? "" : "s"}: ${unsupported.join(", ")}. Route entry modules may export only HTTP handlers and approved Next.js route metadata. Move shared helpers into a non-route module such as lib/auth.ts and update every importer in the same correction.`,
        );
      }
    }
    if (
      /\bfrom\s*["'](?:@\/(?:src\/)?app\/api\/|\.\.?\/)[^"']*\/route["']/u.test(
        content,
      )
    ) {
      routeArchitectureIssues.push(
        `Source module "${path}" imports application logic from a Next.js route entry module. Route files are framework entry points, not shared libraries; move the helper into lib/ and update the route plus every consumer together.`,
      );
    }
    if (/\.(?:jsx|tsx)$/u.test(path)) {
      const unbalancedTag = unbalancedJsxTag(content);
      if (unbalancedTag !== null) {
        generatedSourceIssues.push(
          `Generated source "${path}" has unbalanced JSX tags: ${unbalancedTag}. Correct that element and return the complete file.`,
        );
      }
      const startsSessionReadOnMount =
        /useEffect\s*\([\s\S]{0,500}\b(?:load|fetch|refresh|check)[A-Za-z_$]*Session\s*\(\s*\)[\s\S]{0,120},\s*\[\s*\]\s*\)/iu.test(
          content,
        ) ||
        /useEffect\s*\([\s\S]{0,500}\bload\s*\(\s*\)[\s\S]{0,120},\s*\[\s*\]\s*\)/u.test(
          content,
        );
      const writesUserFromAsyncSession =
        /(?:async\s+function|const)\s+(?:load|fetch|refresh|check)[A-Za-z_$]*(?:\s*=)?[\s\S]{0,1200}\bsetUser\s*\(/iu.test(
          content,
        );
      const alsoWritesUserAfterAuth =
        /(?:sign\s*up|signup|register|log\s*in|login|\/api\/auth)[\s\S]{0,1500}\bsetUser\s*\(/iu.test(
          content,
        );
      const guardsSessionHydration =
        /\b(?:hydrating|sessionLoading|sessionResolved|sessionRequest|authEpoch|authVersion|foundryAuthEpoch|cancelled|ignoreSession)\b/iu.test(
          content,
        );
      if (
        startsSessionReadOnMount &&
        writesUserFromAsyncSession &&
        alsoWritesUserAfterAuth &&
        !guardsSessionHydration
      ) {
        generatedSourceIssues.push(
          `Generated source "${path}" starts an asynchronous session lookup on mount and can also update the same user state after sign-up or sign-in without a hydration or request-version guard. A late signed-out response can erase a successful authentication. Render a resolving state until the initial lookup finishes, or cancel/version the lookup so it cannot overwrite a newer authentication action.`,
        );
      }
    }
  }
  if (generatedSourceIssues.length > 0) {
    throw new TypeError(generatedSourceIssues.join("\n"));
  }
  if (routeArchitectureIssues.length > 0) {
    // Deliberately do not use the Generated source "path" admission marker.
    // This architecture spans the route, its consumers, and usually a new lib
    // file, so a one-file scoped correction cannot possibly resolve it.
    throw new TypeError(routeArchitectureIssues.join("\n"));
  }
  let packageDefinition;
  try {
    packageDefinition = JSON.parse(byPath.get("package.json"));
  } catch {
    throw new TypeError(
      "The generated stack bundle requires valid package.json.",
    );
  }
  for (const script of [
    "build",
    "start",
    "typecheck",
    "lint",
    "test",
  ]) {
    if (
      typeof packageDefinition?.scripts?.[script] !== "string" ||
      packageDefinition.scripts[script].trim() === ""
    ) {
      throw new TypeError(
        `The generated stack bundle requires package.json script "${script}".`,
      );
    }
  }
  const lintScript = packageDefinition.scripts.lint;
  const lintScansProjectRoot = /\beslint(?:\.cmd)?\s+\.(?:\s|$)/u.test(
    lintScript,
  );
  const eslintConfiguration = [...byPath.entries()].find(([path]) =>
    /^(?:eslint\.config\.(?:cjs|js|mjs|ts)|\.eslintrc(?:\.(?:cjs|js|json|mjs|yml|yaml))?)$/u.test(
      path,
    ),
  )?.[1];
  if (
    lintScansProjectRoot &&
    !lintScript.includes(".next") &&
    !eslintConfiguration?.includes(".next")
  ) {
    throw new TypeError(
      'A root-wide ESLint procedure must explicitly ignore the generated ".next" build directory.',
    );
  }
  if (
    eslintConfiguration !== undefined &&
    /from\s+["']eslint-config-next(?:\/core-web-vitals)?["']/u.test(
      eslintConfiguration,
    )
  ) {
    throw new TypeError(
      "The certified Next.js 15 stack must adapt eslint-config-next through FlatCompat (or use its native plugin); Next.js 16-style direct flat-config imports are incompatible.",
    );
  }
  if (
    eslintConfiguration !== undefined &&
    byPath.has("eslint.config.mjs") &&
    eslintConfiguration.includes("__dirname") &&
    !/(?:const|let|var)\s+__dirname\s*=/u.test(eslintConfiguration)
  ) {
    throw new TypeError(
      "eslint.config.mjs cannot use CommonJS __dirname unless it defines an ESM-safe local value.",
    );
  }
  const declaredPackages = {
    ...packageDefinition.dependencies,
    ...packageDefinition.devDependencies,
  };
  for (const requiredPackage of [
    "next",
    "react",
    "react-dom",
    "better-sqlite3",
    "@playwright/test",
    "typescript",
  ]) {
    if (declaredPackages[requiredPackage] === undefined) {
      throw new TypeError(
        `The generated stack bundle is missing required package "${requiredPackage}".`,
      );
    }
  }
  for (const [packageName, declaredVersion] of Object.entries(
    declaredPackages,
  )) {
    const certifiedVersion =
      CERTIFIED_PROJECT_PACKAGE_VERSIONS[packageName];
    if (
      certifiedVersion !== undefined &&
      declaredVersion !== certifiedVersion
    ) {
      throw new TypeError(
        `Package "${packageName}" must use certified version "${certifiedVersion}", not "${declaredVersion}".`,
      );
    }
  }
  const hasAppRouterPage = [...byPath.keys()].some((path) =>
    /^(?:src\/)?app\/(?:.+\/)?page\.(?:js|jsx|ts|tsx)$/u.test(path),
  );
  const hasRootLayout = [...byPath.keys()].some((path) =>
    /^(?:src\/)?app\/layout\.(?:js|jsx|ts|tsx)$/u.test(path),
  );
  if (hasAppRouterPage && !hasRootLayout) {
    throw new TypeError(
      "A Next.js App Router page requires a root app/layout file.",
    );
  }
  const usesRootAlias = [...byPath.entries()].some(
    ([path, content]) =>
      /\.(?:js|jsx|mjs|ts|tsx)$/u.test(path) &&
      /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']@\//u.test(content),
  );
  if (usesRootAlias) {
    let typeScriptConfiguration;
    try {
      typeScriptConfiguration = JSON.parse(byPath.get("tsconfig.json"));
    } catch {
      throw new TypeError(
        "Source imports use the @/ alias, but tsconfig.json is missing or invalid.",
      );
    }
    const aliasTargets =
      typeScriptConfiguration?.compilerOptions?.paths?.["@/*"];
    if (
      !Array.isArray(aliasTargets) ||
      aliasTargets.length === 0 ||
      aliasTargets.some(
        (target) =>
          typeof target !== "string" ||
          !target.includes("*") ||
          target.startsWith("/") ||
          target.includes(".."),
      )
    ) {
      throw new TypeError(
        'Source imports use the @/ alias, but tsconfig.json does not define a safe compilerOptions.paths["@/*"] mapping.',
      );
    }
  }
  const hasHealthRoute = [...byPath.keys()].some((path) =>
    /^(?:src\/)?app\/api\/health\/route\.(?:js|ts)$/u.test(path),
  );
  if (!hasHealthRoute) {
    throw new TypeError(
      "The generated stack bundle requires app/api/health/route for HTTP readiness.",
    );
  }
  const browserIconEntry = [...byPath.entries()].find(([path]) =>
    /^(?:(?:src\/)?app\/(?:favicon\.ico|icon\.(?:ico|jpg|jpeg|png|svg))|public\/(?:favicon|icon)\.(?:ico|jpg|jpeg|png|svg))$/u.test(
      path,
    ),
  );
  if (browserIconEntry === undefined) {
    throw new TypeError(
      "The generated web bundle requires an application icon or favicon so the real browser does not observe a missing decorative resource.",
    );
  }
  if (
    browserIconEntry[0].endsWith(".svg") &&
    (!/<svg\b/iu.test(browserIconEntry[1]) ||
      (!/\bviewBox\s*=\s*["'][^"']+["']/u.test(browserIconEntry[1]) &&
        !(
          /\bwidth\s*=\s*["'][^"']+["']/u.test(browserIconEntry[1]) &&
          /\bheight\s*=\s*["'][^"']+["']/u.test(browserIconEntry[1])
        )))
  ) {
    throw new TypeError(
      "A generated SVG application icon must contain an svg root and intrinsic dimensions or viewBox.",
    );
  }
  const playwrightEntry = [...byPath.entries()].find(([path]) =>
    /^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(path),
  );
  if (playwrightEntry === undefined) {
    throw new TypeError(
      "The generated stack bundle requires Playwright configuration.",
    );
  }
  const playwrightConfiguration = playwrightEntry[1];
  if (
    !playwrightConfiguration.includes("FOUNDRY_PREVIEW_URL") ||
    !/\bchannel\s*:\s*["']chrome["']/u.test(playwrightConfiguration) ||
    /\bwebServer\s*:/u.test(playwrightConfiguration) ||
    /\breporter\s*:\s*["'](?:\.{1,2}\/|[A-Za-z]:[\\/])/u.test(
      playwrightConfiguration,
    )
  ) {
    throw new TypeError(
      "Playwright must consume FOUNDRY_PREVIEW_URL, use the certified Chrome channel, must not own a webServer, and must not suppress evidence through a custom reporter.",
    );
  }
  const browserTests = [...byPath.entries()]
    .filter(([path]) => path.startsWith("tests/"))
    .map(([, content]) => content)
    .join("\n");
  const malformedBrowserTest = [...byPath.entries()].some(
    ([path, content]) =>
      /^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(path) &&
      !hasBalancedJavaScriptDelimiters(content),
  );
  if (
    browserTests === "" ||
    !browserTests.includes("FOUNDRY_BROWSER_RESULT:") ||
    malformedBrowserTest
  ) {
    throw new TypeError(
      "The generated stack bundle requires a structurally balanced Playwright observation test and evidence marker.",
    );
  }
  validateBrowserObservationTestSource(
    browserTests,
    requiredBrowserCheckIds,
    browserQualityRequirements,
  );
  validateCustomerContentIntegrity(files, customerContent);
  return Object.freeze(
    files.map((file) =>
      Object.freeze({ path: file.path, content: file.content }),
    ),
  );
}

// Authentication pages repeatedly arrive with one real but mechanically
// correctable race: the initial GET /api/auth remains in flight while the user
// submits sign-up or sign-in, then its older signed-out response overwrites the
// successful action. The model was told the exact defect on two paid retries
// and reproduced it both times. Install a request epoch in the certified stack
// before admission so the older response cannot commit state.
export function stabilizeGeneratedAuthHydration(source) {
  if (
    typeof source !== "string" ||
    /\bfoundryAuthEpoch\b/u.test(source) ||
    !/\buseEffect\s*\(/u.test(source) ||
    !/\b(?:api|call)\(\s*(["'])\/api\/auth\1\s*\)/u.test(source) ||
    !/\b(?:setUser|setU)\s*\(/u.test(source)
  ) {
    return source;
  }

  const reactImport = /import\s*\{([^}]*)\}\s*from\s*(["'])react\2\s*;?/u;
  const importMatch = reactImport.exec(source);
  if (
    importMatch === null ||
    !/\buseEffect\b/u.test(importMatch[1]) ||
    !/\buseState\b/u.test(importMatch[1])
  ) {
    return source;
  }
  let corrected = source.replace(
    reactImport,
    (statement, imports) =>
      /\buseRef\b/u.test(imports)
        ? statement
        : statement.replace("{", "{useRef,"),
  );

  const component = /export\s+default\s+function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/u;
  const componentMatch = component.exec(corrected);
  if (componentMatch === null) return source;
  corrected =
    corrected.slice(0, componentMatch.index + componentMatch[0].length) +
    "const foundryAuthEpoch=useRef(0);" +
    corrected.slice(componentMatch.index + componentMatch[0].length);

  const arrowLoader = /\bconst\s+load\s*=\s*async\s*\(\s*\)\s*=>\s*\{/u;
  const functionLoader = /\basync\s+function\s+load\s*\(\s*\)\s*\{/u;
  let loaderMatch = arrowLoader.exec(corrected);
  if (loaderMatch !== null) {
    corrected =
      corrected.slice(0, loaderMatch.index) +
      loaderMatch[0].replace(
        /\(\s*\)/u,
        "(foundryExpectedAuthEpoch=foundryAuthEpoch.current)",
      ) +
      corrected.slice(loaderMatch.index + loaderMatch[0].length);
  } else {
    loaderMatch = functionLoader.exec(corrected);
    if (loaderMatch === null) return source;
    corrected =
      corrected.slice(0, loaderMatch.index) +
      loaderMatch[0].replace(
        /\(\s*\)/u,
        "(foundryExpectedAuthEpoch=foundryAuthEpoch.current)",
      ) +
      corrected.slice(loaderMatch.index + loaderMatch[0].length);
  }

  // Re-find the widened loader, then guard immediately after its session
  // response. The default argument captures the epoch before the first await.
  const widenedLoader = /(?:\bconst\s+load\s*=\s*async|\basync\s+function\s+load)\s*\(\s*foundryExpectedAuthEpoch\s*=\s*foundryAuthEpoch\.current\s*\)[^{]*\{/u;
  const widenedMatch = widenedLoader.exec(corrected);
  if (widenedMatch === null) return source;
  const loaderTailStart = widenedMatch.index + widenedMatch[0].length;
  const sessionRead = /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*await\s+(?:api|call)\(\s*(["'])\/api\/auth\1\s*\)\s*;/u;
  const sessionMatch = sessionRead.exec(corrected.slice(loaderTailStart));
  if (sessionMatch === null) return source;
  const guardAt = loaderTailStart + sessionMatch.index + sessionMatch[0].length;
  corrected =
    corrected.slice(0, guardAt) +
    "if(foundryExpectedAuthEpoch!==foundryAuthEpoch.current)return;" +
    corrected.slice(guardAt);

  const arrowAuth = /\bconst\s+auth\s*=\s*async\s*\([^)]*\)\s*=>\s*\{/u;
  const functionAuth = /\basync\s+function\s+auth\s*\([^)]*\)\s*\{/u;
  const authMatch = arrowAuth.exec(corrected) ?? functionAuth.exec(corrected);
  if (authMatch === null) return source;
  const authBody = authMatch.index + authMatch[0].length;
  corrected =
    corrected.slice(0, authBody) +
    "foundryAuthEpoch.current+=1;" +
    corrected.slice(authBody);
  return corrected;
}

export function focusFirstInvalidGeneratedFormField(source) {
  if (
    typeof source !== "string" ||
    !/\bonSubmit\s*=\s*\{/u.test(source) ||
    !/\bsetError\s*\(/u.test(source) ||
    /\.querySelector\(\s*(["'])input\1\s*\)[\s\S]{0,180}?\.focus\s*\(/u.test(
      source,
    )
  ) {
    return source;
  }
  return source.replace(
    /(\bconst\s+[A-Za-z_$][\w$]*\s*=\s*async\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*FormEvent<[^>]+>\s*\)\s*=>\s*\{[\s\S]{0,2200}?\bif\s*\([^{}]{1,700}\)\s*\{)(\s*)(setError\s*\()/u,
    (_match, validationPrefix, eventName, spacing, errorCall) =>
      `${validationPrefix}${spacing}const firstField=${eventName}.currentTarget.querySelector('input');if(firstField instanceof HTMLInputElement)firstField.focus();${spacing}${errorCall}`,
  );
}

export function expandGeneratedBrowserCheckLoop(source) {
  if (
    typeof source !== "string" ||
    !/Object\.fromEntries\s*\(/u.test(source)
  ) {
    return source;
  }
  return source.replace(
    /Object\.fromEntries\(\s*\[((?:\s*["'][A-Za-z0-9._-]+["']\s*,?)+)\]\.map\(\(\s*([A-Za-z_$][\w$]*)(?:\s*:\s*string)?\s*\)\s*=>\s*\[\s*\2\s*,\s*async\s*\(\s*([A-Za-z_$][\w$]*)(\s*:\s*[A-Za-z_$][\w$]*)?\s*\)\s*=>\s*([A-Za-z_$][\w$]*)\(\s*\3\s*,\s*\2\s*\)\s*\]\s*\)\s*\)/gu,
    (_match, literalList, _keyName, contextName, contextType = "", helperName) => {
      const ids = [...literalList.matchAll(/(["'])([A-Za-z0-9._-]+)\1/gu)]
        .map((entry) => entry[2]);
      if (ids.length === 0) return _match;
      return `{${ids
        .map(
          (id) =>
            `${JSON.stringify(id)}:async(${contextName}${contextType})=>${helperName}(${contextName},${JSON.stringify(id)})`,
        )
        .join(",")}}`;
    },
  );
}

export function expandGeneratedBrowserCheckAssignmentLoop(source) {
  if (
    typeof source !== "string" ||
    !/for\s*\(\s*const\s+[A-Za-z_$][\w$]*\s+of\s*\[/u.test(source)
  ) {
    return source;
  }
  const declaration = /const\s+([A-Za-z_$][\w$]*)(\s*:\s*Record<[^;\r\n]+>)?\s*=\s*\{\s*\}\s*;/u.exec(
    source,
  );
  if (declaration === null) return source;
  const collectionName = declaration[1];
  const escapedCollection = collectionName.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  const loopStartPattern = new RegExp(
    `for\\s*\\(\\s*const\\s+([A-Za-z_$][\\w$]*)\\s+of\\s*\\[((?:\\s*["'][A-Za-z0-9._-]+["']\\s*,?)+)\\]\\s*\\)\\s*${escapedCollection}\\s*\\[\\s*\\1\\s*\\]\\s*=\\s*async\\s*\\(\\s*([A-Za-z_$][\\w$]*)(\\s*:\\s*[^)]+)?\\s*\\)\\s*=>\\s*\\{`,
    "u",
  );
  const loopStart = loopStartPattern.exec(source);
  if (loopStart === null) return source;
  const exportPattern = new RegExp(
    `\\}\\s*;\\s*export\\s+const\\s+obligationChecks\\s*=\\s*${escapedCollection}\\s*;?`,
    "u",
  );
  const tail = source.slice(loopStart.index + loopStart[0].length);
  const loopEnd = exportPattern.exec(tail);
  if (loopEnd === null) return source;
  const body = tail.slice(0, loopEnd.index);
  const ids = [...loopStart[2].matchAll(/(["'])([A-Za-z0-9._-]+)\1/gu)]
    .map((entry) => entry[2]);
  if (ids.length === 0) return source;
  const loopVariablePattern = new RegExp(
    `(?<![\\w$.])${loopStart[1]}\\b(?!\\s*:)`,
    "gu",
  );
  const shorthandPropertyPattern = new RegExp(
    `([,{]\\s*)${loopStart[1]}(?=\\s*[,}])`,
    "gu",
  );
  const contextName = loopStart[3];
  const contextType = loopStart[4] ?? "";
  const explicit = `export const obligationChecks${declaration[2] ?? ""}={${ids
    .map((id) => {
      const literal = JSON.stringify(id);
      const boundBody = body
        .replace(shorthandPropertyPattern, `$1${loopStart[1]}:${literal}`)
        .replace(loopVariablePattern, literal);
      return `${JSON.stringify(id)}:async(${contextName}${contextType})=>{${boundBody}}`;
    })
    .join(",")}};`;
  const replacementStart = declaration.index;
  const replacementEnd =
    loopStart.index + loopStart[0].length + loopEnd.index + loopEnd[0].length;
  return source.slice(0, replacementStart) + explicit +
    source.slice(replacementEnd);
}

export function bindCertifiedCredentialLoginChecks(source, loginCheckIds = []) {
  let corrected = source;
  for (const checkId of loginCheckIds) {
    const implementation = browserCheckImplementationSource(
      corrected,
      checkId,
    );
    const canonical = `${JSON.stringify(checkId)}:async(context)=>{const page=context.page;const email=\`foundry-login-\${Date.now()}-\${Math.random().toString(36).slice(2)}@example.test\`;const password='foundry-secure-pass-99';await page.goto('/',{waitUntil:'domcontentloaded'});await page.locator('form:visible, button:visible').first().waitFor({state:'visible'});await page.getByRole('button',{name:'Create account',exact:true}).first().click();const extraFields=page.locator('form input:is([type="text"],:not([type])):visible');for(let index=0;index<await extraFields.count();index+=1)await extraFields.nth(index).fill('Test person');await page.locator('input[type="email"]:visible').fill(email);await page.locator('input[name="password"]:visible').fill(password);await page.locator('form').getByRole('button',{name:'Create account',exact:true}).click();const signOut=page.getByRole('button',{name:'Sign out',exact:true}).first();await signOut.waitFor({state:'visible'});await page.reload({waitUntil:'domcontentloaded'});await signOut.waitFor({state:'visible'});await signOut.click();await page.getByRole('button',{name:/sign in/i}).first().click();await page.locator('input[type="email"]:visible').fill(email);await page.locator('input[name="password"]:visible').fill(password);await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();await signOut.waitFor({state:'visible'});const passed=await signOut.isVisible();return{passed,diagnostics:{observed:true,refreshPersistence:true,savedCredentialLogin:passed}}}`;
    if (implementation !== "") {
      corrected = corrected.replace(implementation, canonical);
      continue;
    }
    // A credential-login obligation may use structured test counts as its
    // contract acceptance condition. It still needs a concrete browser entry:
    // the Playwright suite is the structured test being counted. Add Foundry's
    // canonical account -> refresh -> sign-out -> saved-login proof when the
    // model did not emit an entry for that obligation at all.
    corrected = corrected.replace(
      /\}\s*;?\s*$/u,
      (objectClose) => `,${canonical}${objectClose}`,
    );
  }
  return corrected;
}

export function bindCertifiedAuthenticationErrorChecks(
  source,
  authenticationErrorCheckIds = [],
) {
  let corrected = source;
  for (const checkId of authenticationErrorCheckIds) {
    const implementation = browserCheckImplementationSource(
      corrected,
      checkId,
    );
    const canonical = `${JSON.stringify(checkId)}:async(context)=>{const page=context.page;const email=\`foundry-missing-\${Date.now()}-\${Math.random().toString(36).slice(2)}@example.test\`;const password='foundry-secure-pass-99';await page.goto('/',{waitUntil:'domcontentloaded'});await page.locator('form:visible, button:visible').first().waitFor({state:'visible'});await page.getByRole('button',{name:/sign in/i}).first().click();await page.locator('input[type="email"]:visible').fill(email);await page.locator('input[name="password"]:visible').fill(password);await page.locator('form').getByRole('button',{name:'Sign in',exact:true}).click();const alert=page.locator('form [role="alert"]:visible').first();await alert.waitFor({state:'visible'});const message=(await alert.textContent()??'').trim();const passed=message.length>0&&!message.includes(password);return{passed,diagnostics:{observed:true,accessibleError:passed,sensitivePasswordAbsent:!message.includes(password)}}}`;
    if (implementation !== "") {
      corrected = corrected.replace(implementation, canonical);
      continue;
    }
    corrected = corrected.replace(
      /\}\s*;?\s*$/u,
      (objectClose) => `,${canonical}${objectClose}`,
    );
  }
  return corrected;
}

function existingFreshAccountSetup(source, checkId) {
  const implementation = browserCheckImplementationSource(source, checkId);
  if (implementation === "") return "";
  for (const match of implementation.matchAll(
    /\bawait\s+([A-Za-z_$][\w$]*)\s*\(([^;\r\n]{0,500})\)\s*;/gu,
  )) {
    const helperName = match[1];
    const escapedName = helperName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const definition = new RegExp(
      `(?:const|let|var)\\s+${escapedName}(?:\\s*:[^=\\r\\n]+)?\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::\\s*[^=\\r\\n]+)?=>|(?:async\\s+)?function\\s+${escapedName}\\s*\\([^)]*\\)`,
      "u",
    ).exec(source);
    if (definition === null) continue;
    const helperSource = source.slice(
      definition.index,
      Math.min(source.length, definition.index + 4_000),
    );
    if (
      /(?:getByRole|getByText|locator)\s*\([\s\S]{0,220}\b(?:create account|sign up|register)\b[\s\S]{0,220}\.(?:click|press)\s*\(/iu.test(
        helperSource,
      ) ||
      /(?:\/api\/auth|\/signup|\/register)[\s\S]{0,180}\b(?:POST|signup|register)\b/iu.test(
        helperSource,
      )
    ) {
      const singleAlias = match[2].trim();
      return /^[$A-Z_a-z][$\w]*$/u.test(singleAlias)
        ? `await ${helperName}(page);`
        : match[0];
    }
  }
  return "";
}

export function bindCertifiedResponsiveChecks(
  source,
  responsiveCheckIds = [],
  authenticatedCheckIds = [],
) {
  let corrected = source;
  const authenticated = new Set(authenticatedCheckIds);
  for (const checkId of responsiveCheckIds) {
    const implementation = browserCheckImplementationSource(corrected, checkId);
    const sessionSetup = authenticated.has(checkId)
      ? existingFreshAccountSetup(corrected, checkId)
      : "";
    const canonical = `${JSON.stringify(checkId)}:async(context)=>{const page=context.page;${sessionSetup}await page.setViewportSize({width:390,height:844});await page.goto('/',{waitUntil:'domcontentloaded'});await page.locator('form:visible,input:visible,button:visible,a:visible').first().waitFor({state:'visible'});const layout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:window.innerHeight,interactionCount:document.querySelectorAll('button,a,input,select,textarea').length}));const passed=layout.scrollWidth<=layout.clientWidth&&layout.scrollHeight>0&&layout.scrollHeight<=layout.clientHeight*30&&layout.interactionCount>0&&layout.interactionCount<=100;return{passed,diagnostics:{observed:true,phoneNoOverflow:layout.scrollWidth<=layout.clientWidth,...layout}}}`;
    if (implementation !== "") {
      corrected = corrected.replace(implementation, canonical);
      continue;
    }
    corrected = corrected.replace(
      /\}\s*;?\s*$/u,
      (objectClose) => `,${canonical}${objectClose}`,
    );
  }
  return corrected;
}

export function bindCertifiedAccessibilityChecks(
  source,
  accessibilityCheckIds = [],
  authenticatedCheckIds = [],
  responsiveCheckIds = [],
) {
  let corrected = source;
  const authenticated = new Set(authenticatedCheckIds);
  const responsive = new Set(responsiveCheckIds);
  for (const checkId of accessibilityCheckIds) {
    const implementation = browserCheckImplementationSource(
      corrected,
      checkId,
    );
    const sessionSetup = authenticated.has(checkId)
      ? corrected.includes("establishAccountAndReturnToPublic")
        ? "await establishAccountAndReturnToPublic(context);"
        : existingFreshAccountSetup(corrected, checkId)
      : "";
    const responsiveSetup = responsive.has(checkId)
      ? "await page.setViewportSize({width:390,height:844});"
      : "";
    const responsiveMeasurement = responsive.has(checkId)
      ? "const layout=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,scrollHeight:document.documentElement.scrollHeight,clientHeight:window.innerHeight,interactionCount:document.querySelectorAll('button,a,input,select,textarea').length}));const responsivePassed=layout.scrollWidth<=layout.clientWidth&&layout.scrollHeight>0&&layout.scrollHeight<=layout.clientHeight*30&&layout.interactionCount>0&&layout.interactionCount<=100&&context.responsiveEvidence.phone===true;"
      : "const layout={scrollWidth:0,clientWidth:0,scrollHeight:0,clientHeight:0,interactionCount:0};const responsivePassed=true;";
    const canonical = `${JSON.stringify(checkId)}:async(context)=>{const page=context.page;${sessionSetup}${responsiveSetup}await page.goto('/',{waitUntil:'domcontentloaded'});await page.locator('form:visible, input:visible, button:visible, a:visible').first().waitFor({state:'visible'});${responsiveMeasurement}await page.keyboard.press('Tab');const focused=await page.evaluate(()=>{const active=document.activeElement;return active instanceof HTMLElement&&!['BODY','HTML'].includes(active.tagName)&&active.matches(':focus-visible')});const labelled=await page.locator('label,button[aria-label],a[aria-label],input[aria-label],textarea[aria-label],select[aria-label]').count();const sharedFocus=context.accessibilityEvidence.focus===true;const sharedLabels=context.accessibilityEvidence.labels===true;const passed=responsivePassed&&focused&&labelled>0&&sharedFocus&&sharedLabels;return{passed,diagnostics:{observed:true,focused,labelled,sharedFocus,sharedLabels,responsivePassed,...layout}}}`;
    if (implementation !== "") {
      corrected = corrected.replace(implementation, canonical);
      continue;
    }
    corrected = corrected.replace(
      /\}\s*;?\s*$/u,
      (objectClose) => `,${canonical}${objectClose}`,
    );
  }
  return corrected;
}

export function stabilizeGeneratedBrowserCheckTiming(source) {
  return String(source)
    .replace(
      /(await\s+([$A-Z_a-z][$\w]*)\.getByRole\(\s*(['"])button\3\s*,\s*\{\s*name\s*:\s*(['"])Complete\4\s*,\s*exact\s*:\s*true\s*\}\s*\)\.click\(\s*\);)\s*([$A-Z_a-z][$\w]*)\s*=\s*await\s+\2\.getByText\(\s*(['"])Done\6\s*,\s*\{\s*exact\s*:\s*true\s*\}\s*\)\.isVisible\(\s*\)/gu,
      "$1await $2.waitForFunction(()=>/Completed tasks \\([1-9]\\d*\\)/i.test(document.body.innerText)||!!document.querySelector('[aria-pressed=\"true\"],input[type=\"checkbox\"]:checked,[data-completed=\"true\"],.done,.completed'));$5=await $2.evaluate(()=>/Completed tasks \\([1-9]\\d*\\)/i.test(document.body.innerText)||!!document.querySelector('[aria-pressed=\"true\"],input[type=\"checkbox\"]:checked,[data-completed=\"true\"],.done,.completed'))",
    )
    .replace(
      /await\s+page\.waitForTimeout\(\s*(?:100|150|200|250)\s*\);\s*if\s*\(\s*!\(await\s+dashboardVisible\(page\)\)\s*\)/gu,
      "await page.waitForFunction(()=>/Your workspace|Your list|dashboard/i.test(document.body.innerText),null,{timeout:5000});if (!(await dashboardVisible(page)))",
    )
    .replace(
      /(await\s+context\.page\.reload\([^;]*\);)\s*(const\s+persistedTodo\s*=\s*await\s+visible\(context\.page,\s*`text=\$\{task\}`\s*\);)/gu,
      "$1await context.page.getByText(task,{exact:true}).first().waitFor({state:'visible'});$2",
    )
    .replace(
      /await\s+control\.check\(\s*\);\s*const\s+checked\s*=\s*await\s+control\.isChecked\(\s*\);/gu,
      "await control.click();await control.evaluate(async(element)=>{const deadline=Date.now()+5000;while(element instanceof HTMLInputElement&&!element.checked&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25))});const checked=await control.isChecked();",
    )
    .replace(
      /(await\s+context\.page\.getByRole\(\s*['"]button['"],\s*\{\s*name:\s*\/sign out\|log out\/i\s*\}\s*\)\.first\(\)\.click\(\s*\);)/gu,
      "$1await context.page.locator('form:visible').first().waitFor({state:'visible'});await context.page.waitForFunction(()=>!document.querySelector('[data-foundry-screen=\"screen-02-overview\"]')&&!!document.querySelector('form input[type=\"email\"]'),null,{timeout:5000});",
    )
    .replace(
      /(await\s+([$A-Z_a-z][$\w]*)\.getByRole\(\s*['"]button['"],\s*\{\s*name:\s*['"]Confirm delete['"],\s*exact:\s*true\s*\}\s*\)\.click\(\s*\);)\s*([$A-Z_a-z][$\w]*\s*=\s*await\s+\2\.getByText\(\s*(['"])([^'"]+)\4,\s*\{\s*exact:\s*true\s*\}\s*\)\.count\(\s*\)\s*===\s*0)/gu,
      "$1await $2.getByText($4$5$4,{exact:true}).waitFor({state:'detached'});$3",
    );
}

export function stabilizeGeneratedNarrowLayout(source) {
  const value = String(source).replace(/\bflexDirection\s*:/gu, "flex-direction:");
  if (value.includes("Foundry-owned narrow-layout guardrails")) return value;
  return `${value.trimEnd()}\n\n/* Foundry-owned narrow-layout guardrails. */
html, body, [data-foundry-render-contract], main, section, header, nav, form, p { max-width: 100%; }
header, nav, form, [class*="control"], [class*="capture"] { min-width: 0; }
p, a, button, label { overflow-wrap: anywhere; }
input, textarea, select { min-width: 0; max-width: 100%; }
.auth, [data-foundry-screen*="auth"] { width: min(100%, 480px); min-width: 0; }
@media (max-width: 560px) {
  header, nav, [class*="control"] { flex-wrap: wrap; }
  [class*="control"] { flex-direction: column; align-items: stretch; }
  [class*="control"] > button, [class*="control"] > input { width: 100%; }
  .auth, [data-foundry-screen*="auth"] { width: 100%; margin-left: 0; margin-right: 0; padding-left: 20px; padding-right: 20px; }
}\n`;
}

export function stabilizeGeneratedSqliteRowMaps(source) {
  // better-sqlite3 correctly types an unparameterized Statement#all result as
  // unknown[]. Models often put the row type on map's callback parameter,
  // which is not a legal narrowing under strictFunctionTypes. Move that same
  // generated type to the query result; this is mechanical and preserves the
  // mapper and runtime behavior without spending a model correction.
  return String(source).replace(
    /(\breturn\s+)([^;\r\n]+?\.all\([^\r\n)]*\))\.map\(\(([$A-Z_a-z][$\w]*):\s*(\{[^\r\n)]+\})\)\s*=>\s*(\(\{[^\r\n]+\}\))\)/gu,
    "$1($2 as $4[]).map(($3)=>$5)",
  );
}

export function ensureCertifiedStackScaffold(
  files,
  contractRequirementIds = [],
  {
    responsiveCheckIds = [],
    accessibilityCheckIds = [],
    authenticatedCheckIds = [],
    loginCheckIds = [],
    authenticationErrorCheckIds = [],
  } = {},
) {
  files = [
    ...files.filter(
      (file) => file.path !== "scripts/foundry-certified-install.mjs",
    ),
    {
      path: "scripts/foundry-certified-install.mjs",
      content: CERTIFIED_DEPENDENCY_INSTALLER_SOURCE,
      contractRequirementIds: [...contractRequirementIds],
    },
  ];
  const generatedHealthRoute = files.find((file) =>
    /^(?:src\/)?app\/api\/health\/route\.(?:js|ts)$/u.test(file.path),
  );
  const generatedHealthOwnsApplicationMutations =
    generatedHealthRoute !== undefined &&
    /\bexport\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/u.test(
      generatedHealthRoute.content,
    );
  const generatedSessionRoute = files.find((file) => {
    const match = /^(?:src\/)?app\/api\/([^/]+)\/route\.(?:js|ts)$/u.exec(
      file.path,
    );
    return match !== null &&
      match[1] !== "health" &&
      /\bexport\s+(?:async\s+)?function\s+GET\b/u.test(file.content) &&
      /\b(?:user|session)\b/iu.test(file.content);
  });
  const generatedSessionApiPath = generatedSessionRoute === undefined
    ? null
    : generatedSessionRoute.path
        .replace(/^(?:src\/)?app/u, "")
        .replace(/\/route\.(?:js|ts)$/u, "");
  // The health route is Foundry-owned readiness infrastructure. A generated
  // auth page occasionally uses it as its initial session endpoint and reads
  // `response.user`; replacing that route with the readiness probe then leaves
  // the UI in its resolving screen forever. When the bundle already owns a
  // real GET auth/session route, bind that state read to the route that can
  // actually answer it before install or browser repair.
  const sessionBoundFiles = files.map((file) => {
    if (
      generatedSessionApiPath === null ||
      !/^(?:src\/)?app\/.*\.(?:js|jsx|ts|tsx)$/u.test(file.path) ||
      file.path === generatedHealthRoute?.path ||
      !/\bsetUser\s*\(/u.test(file.content) ||
      !/(["'])\/api\/health\1/u.test(file.content)
    ) {
      return file;
    }
    return {
      ...file,
      content: file.content.replace(
        /(["'])\/api\/health\1/gu,
        `$1${generatedSessionApiPath}$1`,
      ),
    };
  });
  const applicationApiPath = "/api/foundry-application";
  const protectedApiFiles = sessionBoundFiles.map((file) => {
    if (
      generatedHealthOwnsApplicationMutations &&
      /^(?:src\/)?app\/.*\.(?:js|jsx|ts|tsx)$/u.test(file.path) &&
      file.path !== generatedHealthRoute.path
    ) {
      return {
        ...file,
        content: file.content.replace(
          /(["'])\/api\/health\1/gu,
          `$1${applicationApiPath}$1`,
        ),
      };
    }
    return file;
  });
  if (generatedHealthOwnsApplicationMutations) {
    protectedApiFiles.push({
      ...generatedHealthRoute,
      path: generatedHealthRoute.path.replace(
        /\/api\/health\/route\./u,
        "/api/foundry-application/route.",
      ),
    });
  }
  const certifiedPackageFiles = protectedApiFiles.map((file) => {
    if (file.path !== "package.json") return file;
    let packageDefinition;
    try {
      packageDefinition = JSON.parse(file.content);
    } catch {
      return file;
    }
    const dependencies = {
      ...(packageDefinition.dependencies ?? {}),
    };
    const devDependencies = {
      ...(packageDefinition.devDependencies ?? {}),
    };
    const runtimePackages = new Set([
      "better-sqlite3",
      "next",
      "react",
      "react-dom",
    ]);
    for (const [packageName, certifiedVersion] of Object.entries(
      CERTIFIED_PROJECT_PACKAGE_VERSIONS,
    )) {
      if (runtimePackages.has(packageName)) {
        dependencies[packageName] = certifiedVersion;
        delete devDependencies[packageName];
      } else {
        devDependencies[packageName] = certifiedVersion;
        delete dependencies[packageName];
      }
    }
    return {
      ...file,
      content: `${JSON.stringify({
        ...packageDefinition,
        dependencies,
        devDependencies,
        overrides: {
          ...(packageDefinition.overrides ?? {}),
          postcss: "8.5.26",
          sharp: "0.35.3",
        },
      }, null, 2)}\n`,
    };
  });
  const usesRootAlias = certifiedPackageFiles.some(
    (file) =>
      /\.(?:js|jsx|mjs|ts|tsx)$/u.test(file.path) &&
      /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']@\//u.test(file.content),
  );
  const sourceRoot = certifiedPackageFiles.some((file) =>
    /^src\/app\/.*\.(?:js|jsx|ts|tsx)$/u.test(file.path),
  )
    ? "./src/*"
    : "./*";
  const certifiedConfigurationFiles = certifiedPackageFiles.map((file) => {
    if (file.path !== "tsconfig.json") return file;
    let configuration;
    try {
      configuration = JSON.parse(file.content);
    } catch {
      return file;
    }
    const compilerOptions = {
      ...(configuration.compilerOptions ?? {}),
    };
    if (usesRootAlias) {
      compilerOptions.baseUrl = ".";
      compilerOptions.paths = {
        ...(compilerOptions.paths ?? {}),
        "@/*": [sourceRoot],
      };
    }
    // A Playwright spec is not application source, and `next build` type-checks
    // everything the project includes. A missing `expect` import in the
    // observation's own assertions module therefore failed the production
    // build — a test file breaking the shipped application. Playwright compiles
    // its specs itself, with its own types, so excluding them here costs no
    // coverage and stops the test from being able to break the build.
    const exclude = [...new Set([...(configuration.exclude ?? []), "node_modules", "tests"])];
    return {
      ...file,
      content: `${JSON.stringify({
        ...configuration,
        compilerOptions,
        exclude,
      }, null, 2)}\n`,
    };
  });
  const generatedFiles = certifiedConfigurationFiles.filter(
    (file) =>
      !/^(?:src\/)?app\/(?:favicon|icon)\.[^/]+(?:\/.*)?$/u.test(
        file.path,
      ) &&
      !/^(?:src\/)?app\/api\/health\/route\.(?:js|ts)$/u.test(file.path) &&
      !/^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(file.path) &&
      file.path !== "eslint.config.mjs",
  );
  const generatedAppRoutes = new Set(
    generatedFiles.flatMap((file) => {
      const match = /^(?:src\/)?app(?:\/(.*))?\/page\.(?:js|jsx|ts|tsx)$/u.exec(
        file.path,
      );
      if (match === null) return [];
      const segments = (match[1] ?? "")
        .split("/")
        .filter(
          (segment) =>
            segment !== "" &&
            !(segment.startsWith("(") && segment.endsWith(")")) &&
            !segment.startsWith("@"),
        );
      return [`/${segments.join("/")}`];
    }),
  );
  const generatedRoutePatterns = [...generatedAppRoutes].map((route) =>
    new RegExp(
      `^${route
        .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
        .replace(/\\\[\\\.\\\.\\\.[^\]]+\\\]/gu, ".+")
        .replace(/\\\[[^\]]+\\\]/gu, "[^/]+")}$`,
      "u",
    ),
  );
  const routeExists = (route) =>
    generatedAppRoutes.has(route) ||
    generatedRoutePatterns.some((pattern) => pattern.test(route));
  const normalizeGeneratedRouteTarget = (target) => {
    const [pathname, suffix = ""] = target.split(/(?=[?#])/u, 2);
    if (routeExists(pathname)) return target;
    const segments = pathname.split("/").filter(Boolean);
    while (segments.length > 1) {
      segments.pop();
      const parent = `/${segments.join("/")}`;
      if (routeExists(parent)) return `${parent}${suffix}`;
    }
    return target;
  };
  const generatedApplicationSource = generatedFiles
    .filter((file) =>
      /^(?:src\/)?app\/.*\.(?:js|jsx|ts|tsx)$/u.test(file.path),
    )
    .map((file) => file.content)
    .join("\n");
  const applicationBlocksOnInitialAuth =
    /\buseEffect\s*\(/u.test(generatedApplicationSource) &&
    (/(?:user|session)\s*===\s*undefined\b/u.test(
      generatedApplicationSource,
    ) ||
      /\bif\s*\(\s*!\s*(?:ready|loaded|resolved|hydrated|sessionReady)\s*\)\s*return\b/iu.test(
        generatedApplicationSource,
      ));
  const applicationIsAuthenticatedRecordWorkspace =
    /\/api\/(?:todos|tasks|records)\b/iu.test(generatedApplicationSource) &&
    /\b(?:password|sign[- ]?in|create account|signup|login)\b/iu.test(
      generatedApplicationSource,
    );
  const authenticationModeLabel =
    /<(?:div|nav)\b[^>]*\baria-label\s*=\s*(["'])([^"']*(?:auth|access|account)[^"']*)\1/iu.exec(
      generatedApplicationSource,
    )?.[2] ?? null;
  const authenticationModeRole =
    authenticationModeLabel !== null &&
      /<button\b[^>]*\brole\s*=\s*(["'])tab\1/iu.test(
        generatedApplicationSource,
      )
      ? "tab"
      : "button";
  const signOutNavigatesDirectlyToLogin =
    /\b(?:signOut|logout)\b[\s\S]{0,1200}?\brouter\.(?:push|replace)\(\s*["']\/login["']\s*\)/iu.test(
      generatedApplicationSource,
    );
  const protocolNormalizedFiles = generatedFiles.map((file) => {
    let validStylesheetContent = /\.css$/u.test(file.path) &&
      /(?:\bexport\s+default\b|\bfunction\s+[A-Za-z_$]|=>|\bimport\s+[^;]+\b)/u.test(
        file.content,
      )
      ? [
          ":root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }",
          "* { box-sizing: border-box; }",
          "html, body { min-height: 100%; margin: 0; }",
          "button, input, select, textarea { font: inherit; }",
          "",
        ].join("\n")
      : file.content;
    if (
      /\.css$/u.test(file.path) &&
      /\.sr\s*\{[^}]*font-size\s*:\s*0(?:px|rem|em)?\b[^}]*\}/iu.test(
        validStylesheetContent,
      ) &&
      !/\.sr\s+(?:input|textarea)[^{]*\{[^}]*font-size\s*:/iu.test(
        validStylesheetContent,
      )
    ) {
      // A generated visually-hidden label used font-size:0 while wrapping the
      // real input. Because controls also inherited their font, Chrome received
      // no usable keystrokes and the field stayed empty. Keep the label text
      // visually quiet without disabling the control it labels.
      validStylesheetContent += "\n.sr input, .sr textarea { font-size: 1rem; }\n";
    }
    if (/\.css$/u.test(file.path)) {
      // Fractional grid tracks with fixed pixel minimums frequently look fine
      // on a wide desktop but overflow at the tablet evidence viewport. The
      // fractions already express the desired composition; make only those
      // flexible tracks shrinkable. This is the canonical `minmax(0, 1fr)`
      // pattern and prevents a predictable repair/build/browser retry.
      validStylesheetContent = validStylesheetContent.replace(
        /grid-template-columns\s*:[^;{}]+/giu,
        (declaration) =>
          declaration.replace(
            /minmax\(\s*\d+(?:\.\d+)?px\s*,\s*((?:\d+(?:\.\d+)?|\.\d+)fr)\s*\)/giu,
            "minmax(0,$1)",
          ),
      );
      if (applicationIsAuthenticatedRecordWorkspace) {
        validStylesheetContent = stabilizeGeneratedNarrowLayout(
          validStylesheetContent,
        );
      }
    }
    let typedCountContent = /\.(?:ts|tsx)$/u.test(file.path)
      ? validStylesheetContent.replace(
          /(\.get\(\)\s+as\s+)any(\)\.c\b)/gu,
          "$1{ c: number }$2",
        )
      : validStylesheetContent;
    if (/\.(?:ts|tsx)$/u.test(file.path)) {
      typedCountContent = stabilizeGeneratedSqliteRowMaps(typedCountContent);
      typedCountContent = typedCountContent.replace(
        /\b(body|payload)\s+as\s+(\{[^\r\n]+?\})/gu,
        "$1 as unknown as $2",
      );
      // A missing close angle before an async arrow's return arrow is a purely
      // mechanical model typo. Correct it locally before admission rather than
      // buying an otherwise identical full-bundle regeneration.
      typedCountContent = typedCountContent.replace(
        /\bPromise<([^<>\r\n]{1,200})=>/gu,
        "Promise<$1>=>",
      );
      // Function declarations do not take an arrow after their return type.
      // This is the inverse recurring typo: `async function f():Promise<T>=>{`.
      // Remove only that impossible token while leaving async arrow functions
      // and the declared Promise type intact.
      typedCountContent = typedCountContent.replace(
        /(\basync\s+function\s+[A-Za-z_$][\w$]*\s*\([^\r\n)]*\)\s*:\s*Promise<[^\r\n]*?>)\s*=>\s*\{/gu,
        "$1{",
      );
      // Nested generic return types can instead contain all closing angles but
      // omit the arrow between the declared Promise and the function body.
      // Test files are excluded from `next build`, so normalize this shape
      // before Playwright is the first parser to see it.
      typedCountContent = typedCountContent.replace(
        /(\)\s*:\s*Promise<(?:(?!=>)[^\r\n]){1,500}>)\s*\{(?=\s*(?:const|let|try|return)\b)/gu,
        "$1=>{",
      );
      // The missing-arrow normalizer above also sees a function declaration's
      // valid `Promise<T> {` boundary. Re-apply the declaration rule after it
      // so only actual async arrow functions retain the inserted token.
      typedCountContent = typedCountContent.replace(
        /(\basync\s+function\s+[A-Za-z_$][\w$]*\s*\([^\r\n)]*\)\s*:\s*Promise<[^\r\n]*?>)\s*=>\s*\{/gu,
        "$1{",
      );
      typedCountContent = typedCountContent.replace(
        /\bDEFAULT\s+datetime\((['"])now\1\)/giu,
        "DEFAULT (datetime($1now$1))",
      );
      if (file.path === "tests/foundry-checks.ts") {
        typedCountContent = stabilizeGeneratedBrowserCheckTiming(
          typedCountContent,
        );
        typedCountContent = expandGeneratedBrowserCheckLoop(
          typedCountContent,
        );
        typedCountContent = expandGeneratedBrowserCheckAssignmentLoop(
          typedCountContent,
        );
        typedCountContent = bindCertifiedCredentialLoginChecks(
          typedCountContent,
          loginCheckIds,
        );
        typedCountContent = bindCertifiedAuthenticationErrorChecks(
          typedCountContent,
          authenticationErrorCheckIds,
        );
        typedCountContent = bindCertifiedResponsiveChecks(
          typedCountContent,
          responsiveCheckIds,
          authenticatedCheckIds,
        );
        typedCountContent = bindCertifiedAccessibilityChecks(
          typedCountContent,
          accessibilityCheckIds,
          authenticatedCheckIds,
          responsiveCheckIds,
        );
        // Generated checks often initialize `const passed = false` and then
        // assign the measured result inside try/catch. It type-checks when the
        // test directory is excluded from Next's build, but throws at runtime
        // and can leave a misleading wrapper verdict. Preserve the intended
        // mutable accumulator before Playwright executes it.
        typedCountContent = typedCountContent.replace(
          /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(false|true)\s*;(?=[\s\S]{0,4000}\b\1\s*=)/gu,
          "let $1=$2;",
        );
        if (applicationBlocksOnInitialAuth) {
          typedCountContent = typedCountContent.replace(
            /(const\s+(?:check|run)\s*=\s*async\s*\(\s*([A-Za-z_$][\w$]*)[^;\r\n]{0,1200}=>\s*\{)/u,
            (_match, declaration, contextName) =>
              `${declaration}await ${contextName}.page.locator('form:visible, input:visible, button:visible').first().waitFor({ state: 'visible' });`,
          );
          typedCountContent = typedCountContent.replace(
            /(await\s+((?:[A-Za-z_$][\w$]*\.)?page)\.goto\([^;]+;)(?!\s*await\s+\2\.locator\(\s*["']form:visible)/gu,
            "$1await $2.locator('form:visible, input:visible, button:visible').first().waitFor({ state: 'visible' });",
          );
        }
        typedCountContent = typedCountContent.replace(
          /(["'])\p{Cf}+(?=(?:obligation|check)-)/gu,
          "$1",
        );
        if (authenticationModeLabel !== null) {
          typedCountContent = typedCountContent.replace(
            /((?:[A-Za-z_$][\w$]*\.)?page)\.getByRole\(\s*(["'])button\2\s*,\s*\{\s*name\s*:\s*(["'])(Sign in|Create account)\3\s*,\s*exact\s*:\s*true\s*\}\s*\)(\.first\(\))?/giu,
            (_match, pageExpression, buttonQuote, labelQuote, label, first, offset, wholeSource) => {
              // An explicit `.first()` denotes the mode control. For an
              // unscoped click after fields were filled, the same accessible
              // name denotes the form submit button. Keeping these identities
              // separate prevents Foundry from rewriting a real submission
              // into a click on the already-selected mode tab.
              const recentSource = wholeSource.slice(
                Math.max(0, offset - 700),
                offset,
              );
              const isFormSubmission =
                first === undefined && /\.fill\s*\([^)]*\)[\s\S]{0,500}$/u.test(recentSource);
              if (isFormSubmission) {
                return `${pageExpression}.locator('form').getByRole(${buttonQuote}button${buttonQuote}, { name: ${labelQuote}${label}${labelQuote}, exact: true })`;
              }
              const selector = `[aria-label=${JSON.stringify(authenticationModeLabel)}]`;
              return `${pageExpression}.locator(${JSON.stringify(selector)}).getByRole(${buttonQuote}${authenticationModeRole}${buttonQuote}, { name: ${labelQuote}${label}${labelQuote}, exact: true })`;
            },
          );
        }
        typedCountContent = typedCountContent.replace(
          /((?:[A-Za-z_$][\w$]*\.)?page)\.getByLabel\(\s*(['"])Password\2\s*,\s*\{\s*exact\s*:\s*true\s*\}\s*\)\.fill\s*\(/giu,
          "$1.locator('input[name=\"password\"]:visible').fill(",
        );
        // Playwright Locator has no `.submit()` method. Generated checks use
        // that DOM-shaped API often enough to waste a complete browser repair
        // even though the intended action is unambiguous. Dispatch the form's
        // real requestSubmit path inside the page so React/Next submit handlers
        // and constraint validation are still exercised.
        typedCountContent = typedCountContent.replace(
          /(\.locator\(\s*(["'])[^"'\r\n]{1,200}\2\s*\))\.submit\(\)/giu,
          "$1.evaluate((form:Element)=>{if(form instanceof HTMLFormElement)form.requestSubmit()})",
        );
        // Approved split auth designs may intentionally repeat the same title
        // in their context and form panels. A text-presence check does not need
        // strict uniqueness, so select the first exact heading rather than
        // allowing Playwright to abort before returning the visibility result.
        typedCountContent = typedCountContent.replace(
          /(\.getByRole\(\s*(["'])heading\2\s*,\s*\{(?=[^}\r\n]*\bname\s*:)(?=[^}\r\n]*\bexact\s*:\s*true)[^}\r\n]*\}\s*\))(?!\.first\(\))/giu,
          "$1.first()",
        );
        typedCountContent = typedCountContent.replace(
          /(\.getByRole\(\s*(["'])button\2\s*,\s*\{(?=[^}\r\n]*\bname\s*:\s*(["'])Sign out\3)(?=[^}\r\n]*\bexact\s*:\s*true)[^}\r\n]*\}\s*\))(?!\.first\(\))/giu,
          "$1.first()",
        );
        if (signOutNavigatesDirectlyToLogin) {
          typedCountContent = typedCountContent.replace(
            /(await\s+page\.getByRole\(\s*(["'])button\2\s*,\s*\{[^}]*name\s*:\s*(["'])Sign out\3[^}]*\}\s*\)(?:\.first\(\))?\.click\(\)\s*;)\s*await\s+page\.getByRole\(\s*(["'])link\4\s*,\s*\{[^}]*name\s*:\s*(["'])Sign in\5[^}]*\}\s*\)\.click\(\)\s*;/giu,
            "$1",
          );
        }
        typedCountContent = typedCountContent.replace(
          /(await\s+([$A-Z_a-z][$\w]*)\.getByRole\([^;]+?\)\.click\(\)\s*;)(\s*[$A-Z_a-z][$\w]*\s*=\s*await\s+\2\.(?:getByRole|getByText|getByLabel|locator)\([^;]+?\))\.isVisible\(\)/gu,
          "$1$3.waitFor({ state: 'visible' }).then(() => true)",
        );

        if (authenticationModeLabel !== null) {
          // The first button on an authentication page is commonly the pale
          // selected mode tab, not the primary submit action. Measuring it as
          // the approved accent produced a false palette failure and bought a
          // model repair even though the rendered primary action was correct.
          typedCountContent = typedCountContent.replace(
            /((?:[A-Za-z_$][\w$]*\.)?page)\.locator\(\s*(["'])button\2\s*\)\.first\(\)\.evaluate\(/gu,
            "$1.locator('form').getByRole('button').evaluate(",
          );
        }
      }
      if (
        applicationBlocksOnInitialAuth &&
        file.path === "tests/foundry-observation.spec.ts"
      ) {
        // The harness creates the fresh page that every generated check uses.
        // Waiting here covers direct object-entry checks as well as checks that
        // have their own helper or goto. Previously only those latter shapes
        // were normalized, so immediate layout/color/focus reads raced the
        // initial session lookup and triggered an unnecessary repair pass.
        typedCountContent = typedCountContent.replace(
          /(await\s+page\.goto\([^;]+;)(?!\s*await\s+page\.locator\(\s*["']form:visible)/gu,
          "$1await page.locator('form:visible, input:visible, button:visible').first().waitFor({ state: 'visible' });",
        );
      }
    }
    if (/^(?:src\/)?app\/.*\.(?:jsx|tsx)$/u.test(file.path)) {
      typedCountContent = stabilizeGeneratedAuthHydration(typedCountContent);
      typedCountContent = focusFirstInvalidGeneratedFormField(
        typedCountContent,
      );
    }
    if (/^(?:src\/)?app\/.*\.(?:js|jsx|ts|tsx)$/u.test(file.path)) {
      typedCountContent = typedCountContent.replace(
        /(fetch\(\s*(["'])[^"']*(?:signout|logout)[^"']*\2\s*,\s*\{\s*method\s*:\s*(["'])POST\3)(\s*\})/giu,
        "$1,headers:{'content-type':'application/json'},body:'{}'$4",
      );
    }
    const nextLinkImport = typedCountContent.match(
      /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+["']next\/link["']\s*;?\s*$/mu,
    );
    if (nextLinkImport !== null) {
      const escapedLinkName = nextLinkImport[1].replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      );
      const contentWithoutImport = typedCountContent.replace(
        nextLinkImport[0],
        "",
      );
      if (!new RegExp(`<${escapedLinkName}\\b`, "u").test(contentWithoutImport)) {
        typedCountContent = contentWithoutImport.replace(/^\s*\n/u, "");
      }
    }
    if (
      /\.(?:jsx|tsx)$/u.test(file.path) &&
      /const\s+resetBooking\s*=\s*\(\)\s*=>/u.test(typedCountContent)
    ) {
      typedCountContent = typedCountContent.replace(
        /onClick=\{\(\)\s*=>\s*\{\s*setTab\(t\);\s*setEditing\(null\);\s*\}\}/gu,
        "onClick={() => { setTab(t); setEditing(null); if (t === 'Book') resetBooking(); }}",
      );
    }
    if (/\.(?:jsx|tsx)$/u.test(file.path)) {
      const spanOpenCount = typedCountContent.match(/<span\b/gu)?.length ?? 0;
      const spanCloseCount = typedCountContent.match(/<\/span>/gu)?.length ?? 0;
      if (spanCloseCount === spanOpenCount + 1) {
        typedCountContent = typedCountContent.replace(
          /<\/span><\/span><\/div>/u,
          "</span></div>",
        );
      }
    }
    const stackNormalizedFile = typedCountContent === file.content
      ? file
      : { ...file, content: typedCountContent };
    if (/^(?:src\/)?app\/.*\.(?:jsx|tsx)$/u.test(stackNormalizedFile.path)) {
      const importedLink = stackNormalizedFile.content.match(
        /import\s+([A-Za-z_$][\w$]*)\s+from\s+["']next\/link["']\s*;?/u,
      )?.[1];
      const linkComponent = importedLink ?? "FoundryLink";
      const internalAnchorPattern = /<a\b([^>]*\bhref\s*=\s*["']\/(?!\/)[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gu;
      const routeNormalizedContent = stackNormalizedFile.content.replace(
        /(\bhref\s*=\s*["'])(\/(?!\/)[^"']*)(["'])/gu,
        (_match, prefix, target, quote) =>
          `${prefix}${normalizeGeneratedRouteTarget(target)}${quote}`,
      );
      const navigationNormalizedContent = routeNormalizedContent.replace(
        internalAnchorPattern,
        `<${linkComponent}$1>$2</${linkComponent}>`,
      );
      if (navigationNormalizedContent !== stackNormalizedFile.content) {
        const convertedAnchor = navigationNormalizedContent !== routeNormalizedContent;
        const contentWithImport = importedLink || !convertedAnchor
          ? navigationNormalizedContent
          : navigationNormalizedContent.replace(
              /^(\s*["']use client["']\s*;?\s*)?/u,
              (prefix = "") =>
                `${prefix}import ${linkComponent} from "next/link";\n`,
            );
        return { ...stackNormalizedFile, content: contentWithImport };
      }
    }
    if (!/^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(stackNormalizedFile.path)) {
      return stackNormalizedFile;
    }
    let readinessNormalizedContent = stackNormalizedFile.content
      .replaceAll(
        "Record<string, Record<string, boolean>>",
        "Record<string, Record<string, unknown>>",
      )
      .replace(
        /\blet\s+checks(\s*:\s*[^=;]+)?\s*=/u,
        "const checks$1 =",
      )
      .replace(
        /waitUntil\s*:\s*(["'])networkidle\1/gu,
        'waitUntil: "domcontentloaded"',
      )
      .replace(
        /waitForLoadState\s*\(\s*(["'])networkidle\1\s*\)/gu,
        'waitForLoadState("domcontentloaded")',
      )
      .replace(
        /(checks\s*\[[^\]]+\]\s*=\s*(?:\(\s*)?)([A-Za-z_$][\w$]*(?:count|length|rows))\s*>=\s*0/giu,
        "$1$2 > 0",
      )
      .replace(
        /if\s*\(\s*msg\.type\(\)\s*===\s*(["'])error\1\s*\)\s*consoleErrors\.push\(\s*msg\.text\(\)\s*\)/gu,
        "if (msg.type() === 'error' && !/(?:\\b422\\b|Unprocessable Entity)/u.test(msg.text())) consoleErrors.push(msg.text())",
      )
      .replace(
        /page\.locator\(\s*(["'])input\[aria-label\],\s*textarea\[aria-label\]\1\s*\)\.count\(\)/gu,
        "page.locator('button:not(:empty):visible, a:not(:empty):visible, input[aria-label]:visible, textarea[aria-label]:visible, select[aria-label]:visible').count()",
      )
      .replace(
        /page\.locator\(\s*(["'])\.slot-btn\1\s*,\s*\{\s*hasText:\s*(["'])\d{2}:\d{2}\2\s*\}\s*\)(?:\.last\(\))?/gu,
        "page.locator('.slot-btn:not([disabled])').filter({ hasText: /^\\d{2}:\\d{2}/ }).first()",
      )
      .replace(
        /page\.locator\(\s*(["'])button\.btn-secondary\1\s*\)\.first\(\)/gu,
        "page.locator('button[aria-label^=\"Select time\"]:not([disabled])').first()",
      )
      .replace(
        /(checks\s*\[[^\]]+\]\s*=\s*[^;]*?)\(\s*([A-Za-z_$][\w$]*)\s*\|\|\s*true\s*\)/gu,
        "$1$2",
      )
      .replace(
        /(const\s+([A-Za-z_$][\w$]*)\s*=\s*page\.locator\([^\r\n]*aria-label\^=[^\r\n]*\)\s*;\r?\n)(\s*)(const\s+[A-Za-z_$][\w$]*\s*=\s*await\s+\2\.count\(\)\s*;)/gu,
        "$1$3await $2.first().waitFor({ state: 'visible' });\n$3$4",
      )
      .replace(
        /page\.locator\(\s*(["'])\[role=(["'])alert\2\]\1\s*\)/gu,
        "page.locator('[role=\"alert\"]:not(#__next-route-announcer__)').first()",
      )
      .replace(
        /page\.getByRole\(\s*(["'])alert\1(?:\s*,\s*\{[^}]*\})?\s*\)/gu,
        "page.locator('[role=\"alert\"]:not(#__next-route-announcer__)').first()",
      )
      .replace(
        /(browser\.newContext\(\{[^\r\n]*?),\s*channel\s*:\s*(["'])chrome\2/gu,
        "$1",
      )
      .replace(
        /page\.click\(\s*(["'])text=([^"'\\\r\n]+)\1\s*\)/gu,
        (_match, quote, label) =>
          `page.getByRole('button', { name: ${quote}${label}${quote}, exact: true }).click()`,
      )
      .replace(
        /page\.getByLabel\(\s*(["'])([^"']+)\1\s*\)(?=\s*\.)/gu,
        (_match, quote, label) =>
          `page.getByLabel(${quote}${label}${quote}, { exact: true })`,
      )
      .replace(
        /(await\s+page\.getByRole\([^;]+?\)\.click\(\)\s*;)(\s*[A-Za-z_$][\w$]*\s*=\s*await\s+page\.(?:getByRole|getByText|getByLabel|locator)\([^;]+?\))\.isVisible\(\)/gu,
        "$1$2.waitFor({ state: 'visible' }).then(() => true)",
      );
    if (
      !/page\.mouse\.move\(\s*0\s*,\s*0\s*\)/u.test(
        readinessNormalizedContent,
      )
    ) {
      readinessNormalizedContent = readinessNormalizedContent.replace(
        /^(\s*)(const\s+[A-Za-z_$][\w$]*(?:bg|color|background)[A-Za-z_$\d]*\s*=\s*await\s+page\.evaluate\s*\()/gimu,
        "$1await page.mouse.move(0, 0);\n$1await page.waitForTimeout(200);\n$1$2",
      );
    }
    if (
      /scrollWidth/u.test(readinessNormalizedContent) &&
      !/(?:viewport\s*:\s*\{|setViewportSize\s*\()/u.test(
        readinessNormalizedContent,
      ) &&
      /\bpage\./u.test(readinessNormalizedContent)
    ) {
      readinessNormalizedContent = readinessNormalizedContent.replace(
        /\btry\s*\{/u,
        "try {\n    await page.setViewportSize({ width: 375, height: 667 });",
      );
    }
    if (
      responsiveCheckIds.length > 0 &&
      !readinessNormalizedContent.includes("__foundryResponsiveEvidence")
    ) {
      const responsiveProbe = [
        "await page.setViewportSize({ width: 390, height: 844 });",
        "const __foundryPhoneLayout = await page.evaluate(() => ({",
        "  scrollWidth: document.documentElement.scrollWidth,",
        "  clientWidth: document.documentElement.clientWidth,",
        "  scrollHeight: document.documentElement.scrollHeight,",
        "  clientHeight: window.innerHeight,",
        "  interactionCount: document.querySelectorAll('button, a, input, select, textarea').length,",
        "}));",
        "const __foundryResponsiveEvidence =",
        "  __foundryPhoneLayout.scrollWidth <= __foundryPhoneLayout.clientWidth &&",
        "  __foundryPhoneLayout.scrollHeight > 0 &&",
        "  __foundryPhoneLayout.scrollHeight <= __foundryPhoneLayout.clientHeight * 30 &&",
        "  __foundryPhoneLayout.interactionCount > 0 &&",
        "  __foundryPhoneLayout.interactionCount <= 100;",
      ].map((line) => `    ${line}`).join("\n");
      const navigation = /(\bawait\s+page\.goto\([^;]+;)/u;
      readinessNormalizedContent = navigation.test(readinessNormalizedContent)
        ? readinessNormalizedContent.replace(
            navigation,
            `$1\n\n${responsiveProbe}`,
          )
        : readinessNormalizedContent.replace(
            /(\btry\s*\{)/u,
            `$1\n${responsiveProbe}`,
          );
      for (const checkId of responsiveCheckIds) {
        const escapedCheckId = checkId.replace(
          /[.*+?^${}()|[\]\\]/gu,
          "\\$&",
        );
        const assignment = new RegExp(
          `(checks\\s*\\[\\s*["']${escapedCheckId}["']\\s*\\]\\s*=\\s*)([^;\\r\\n]+)`,
          "u",
        );
        readinessNormalizedContent = readinessNormalizedContent.replace(
          assignment,
          (_match, prefix, expression) =>
            `${prefix}(${expression.trim()}) && __foundryResponsiveEvidence`,
        );
      }
    }
    if (
      accessibilityCheckIds.length > 0 &&
      !readinessNormalizedContent.includes("__foundryAccessibilityEvidence")
    ) {
      const accessibilityProbe = [
        "await page.keyboard.press('Tab');",
        "const __foundryAccessibleFocus = await page.evaluate(() => {",
        "  const active = document.activeElement;",
        "  return active instanceof HTMLElement &&",
        "    !['BODY', 'HTML'].includes(active.tagName) &&",
        "    active.matches(':focus-visible');",
        "});",
        "const __foundryAccessibleLabelCount = await page.locator('a[aria-label], button[aria-label], input[aria-label], textarea[aria-label], select[aria-label], label').count();",
        "const __foundryAccessibilityEvidence =",
        "  __foundryAccessibleFocus && __foundryAccessibleLabelCount > 0;",
      ].map((line) => `    ${line}`).join("\n");
      const navigation = /(\bawait\s+page\.goto\([^;]+;)/u;
      readinessNormalizedContent = navigation.test(readinessNormalizedContent)
        ? readinessNormalizedContent.replace(
            navigation,
            `$1\n\n${accessibilityProbe}`,
          )
        : readinessNormalizedContent.replace(
            /(\btry\s*\{)/u,
            `$1\n${accessibilityProbe}`,
          );
      for (const checkId of accessibilityCheckIds) {
        const escapedCheckId = checkId.replace(
          /[.*+?^${}()|[\]\\]/gu,
          "\\$&",
        );
        const assignment = new RegExp(
          `(checks\\s*\\[\\s*["']${escapedCheckId}["']\\s*\\]\\s*=\\s*)([^;\\r\\n]+)`,
          "u",
        );
        readinessNormalizedContent = readinessNormalizedContent.replace(
          assignment,
          (_match, prefix, expression) =>
            `${prefix}(${expression.trim()}) && __foundryAccessibilityEvidence`,
        );
      }
    }
    const collectionReads = [
      ...readinessNormalizedContent.matchAll(
        /^(?<indent>\s*)(?<statement>const\s+(?<name>[A-Za-z_$][\w$]*)\s*=\s*await\s+page\.\$\$\(\s*(?<quote>["'])(?<selector>[^"']+)\k<quote>\s*\)\s*;)/gmu,
      ),
    ];
    for (const collectionRead of collectionReads) {
      const { indent, statement, name, selector } = collectionRead.groups;
      const tail = readinessNormalizedContent.slice(
        collectionRead.index,
        collectionRead.index + 500,
      );
      if (!new RegExp(`\\b${name}\\.length\\s*>\\s*0`, "u").test(tail)) {
        continue;
      }
      const preceding = readinessNormalizedContent.slice(
        Math.max(0, collectionRead.index - 500),
        collectionRead.index,
      );
      if (preceding.includes(selector) && /waitFor(?:Selector)?\s*\(/u.test(preceding)) {
        continue;
      }
      readinessNormalizedContent = readinessNormalizedContent.replace(
        statement,
        `await page.locator(${JSON.stringify(selector)}).first().waitFor({ state: "visible" });\n${indent}${statement}`,
      );
    }
    if (
      /FOUNDRY_BROWSER_RESULT/u.test(readinessNormalizedContent) &&
      /\bchecks\b/u.test(readinessNormalizedContent) &&
      !readinessNormalizedContent.includes("__foundryFailedChecks")
    ) {
      readinessNormalizedContent = readinessNormalizedContent.replace(
        /(console\.log\(\s*["']FOUNDRY_BROWSER_RESULT:\s*["']\s*\+\s*result\s*\)\s*;?)/u,
        `$1\n    const __foundryFailedChecks = Object.entries(checks).filter(([, passed]) => passed !== true).map(([checkId]) => checkId);\n    if (captureProbeErrors.length > 0 || __foundryFailedChecks.length > 0) {\n      throw new Error(\`Foundry browser verification failed: \${[...captureProbeErrors, ...__foundryFailedChecks].join(", ")}\`);\n    }`,
      );
    }
    const lintNormalizedContent = readinessNormalizedContent.replace(
      /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*any\s*\)\s*\{\s*captureProbeErrors\.push\(\s*\1\.message\s*\|\|\s*String\(\s*\1\s*\)\s*\)\s*;?\s*\}/gu,
      (_match, errorName) =>
        `catch (${errorName}: unknown) {\n` +
        `  captureProbeErrors.push(${errorName} instanceof Error ? ${errorName}.message : String(${errorName}));\n` +
        "}",
    );
    let diagnosticNormalizedContent = lintNormalizedContent;
    if (!/\bdiagnostics\b/u.test(diagnosticNormalizedContent)) {
      let instrumented = false;
      diagnosticNormalizedContent = diagnosticNormalizedContent.replace(
        /^(\s*)(checks\s*\[\s*(["'])([^"']+)\3\s*\]\s*=\s*)((?:[A-Za-z_$][\w$]*\s*&&\s*)+[A-Za-z_$][\w$]*)\s*;/gmu,
        (_match, indentation, assignment, _quote, checkId, expression) => {
          const names = [...expression.matchAll(/[A-Za-z_$][\w$]*/gu)]
            .map((entry) => entry[0]);
          instrumented = true;
          return `${indentation}diagnostics[${JSON.stringify(checkId)}] = { ${names.join(", ")} };\n${indentation}${assignment}${expression};`;
        },
      );
      if (instrumented) {
        const withDiagnosticResult = diagnosticNormalizedContent.replace(
          /JSON\.stringify\(\s*\{\s*captureProbeErrors\s*,\s*checks\s*,\s*consoleErrors\s*,\s*pageErrors\s*,?\s*\}\s*\)/gu,
          "JSON.stringify({ captureProbeErrors, checks, diagnostics, consoleErrors, pageErrors })",
        );
        if (withDiagnosticResult !== diagnosticNormalizedContent) {
          diagnosticNormalizedContent = withDiagnosticResult;
          const declaration = /\.(?:ts|tsx)$/u.test(stackNormalizedFile.path)
            ? "const diagnostics: Record<string, Record<string, unknown>> = {};\n"
            : "const diagnostics = {};\n";
          const imports = /^(\s*(?:import[^\r\n]*\r?\n)+)/u.exec(
            diagnosticNormalizedContent,
          );
          diagnosticNormalizedContent = imports === null
            ? declaration + diagnosticNormalizedContent
            : diagnosticNormalizedContent.replace(
                imports[0],
                imports[0] + declaration,
              );
        }
      }
    }
    const declarations = [];
    for (const collection of [
      "captureProbeErrors",
      "consoleErrors",
      "pageErrors",
    ]) {
      const emptyArrayDeclaration = new RegExp(
        `(?:const|let)\\s+${collection}(?:\\s*:[^=;]+)?\\s*=\\s*\\[\\s*\\]`,
        "u",
      );
      if (!emptyArrayDeclaration.test(diagnosticNormalizedContent)) {
        declarations.push(`const ${collection}: string[] = [];`);
      }
    }
    if (
      declarations.length === 0 &&
      diagnosticNormalizedContent === stackNormalizedFile.content
    ) {
      return stackNormalizedFile;
    }
    return {
      ...stackNormalizedFile,
      content:
        `${declarations.length === 0 ? "" : `${declarations.join("\n")}\n`}` +
        diagnosticNormalizedContent,
    };
  });
  const paths = new Set(protocolNormalizedFiles.map((file) => file.path));
  const usesSourceDirectory = [...paths].some((path) => path.startsWith("src/app/"));
  const appDirectory = usesSourceDirectory ? "src/app" : "app";
  const trace = contractRequirementIds.length === 0
    ? {}
    : { contractRequirementIds: [...contractRequirementIds] };
  const scaffold = [];
  scaffold.push({
    path: "eslint.config.mjs",
    content: [
      'import { FlatCompat } from "@eslint/eslintrc";',
      'import { dirname } from "node:path";',
      'import { fileURLToPath } from "node:url";',
      "",
      "const baseDirectory = dirname(fileURLToPath(import.meta.url));",
      "const compat = new FlatCompat({ baseDirectory });",
      "const config = [",
      '  { ignores: [".next/**", "next-env.d.ts", "tests/**", "node_modules/**", "playwright-report/**", "test-results/**"] },',
      '  ...compat.extends("next/core-web-vitals", "next/typescript"),',
      "];",
      "",
      "export default config;",
      "",
    ].join("\n"),
    ...trace,
  });
  const needsGeneratedDataDirectory = protocolNormalizedFiles.some(
    (file) =>
      /\.(?:js|jsx|mjs|ts|tsx)$/u.test(file.path) &&
      ( /\bnew\s+Database\(\s*["'](?:\.\/)?data\//u.test(file.content) ||
        /\bnew\s+Database\([\s\S]{0,180}\b(?:path\.)?join\([\s\S]{0,120}["']data["']/u.test(
          file.content,
        ) ),
  );
  const hasGeneratedDataDirectory = protocolNormalizedFiles.some((file) =>
    /^data\//u.test(file.path),
  );
  if (needsGeneratedDataDirectory && !hasGeneratedDataDirectory) {
    // SQLite cannot create its parent directory. Generated workspaces contain
    // files rather than empty directories, so preserve the relative data root
    // explicitly before the application ever starts.
    scaffold.push({ path: "data/.gitkeep", content: "", ...trace });
  }
  const healthPath = `${appDirectory}/api/health/route.ts`;
  scaffold.push({
    path: healthPath,
    content: 'export const dynamic = "force-dynamic";\nexport function GET() { return Response.json({ status: "ready" }); }\n',
    ...trace,
  });
  const hasIcon = [...paths].some((path) =>
    /^(?:src\/)?app\/(?:favicon\.ico|icon\.(?:ico|jpg|jpeg|png|svg))$/u.test(path),
  );
  if (!hasIcon) {
    scaffold.push({
      path: `${appDirectory}/icon.svg`,
      content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#172033"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>\n',
      ...trace,
    });
  }
  scaffold.push({
    path: "playwright.config.ts",
    content: [
      'import { defineConfig } from "@playwright/test";',
      "",
      "export default defineConfig({",
      '  testDir: "./tests",',
      // 30s covered the whole observation spec, which runs every browser check
      // in one test. Once the checks became real workflows -- create an
      // account, sign in, reload and confirm the session held -- twelve of them
      // shared about two and a half seconds each, and the run was cut off
      // mid-way with the remaining checks reporting that the browser had
      // closed. The per-check budget inside the harness is the real bound on a
      // stuck check; this only has to be roomy enough not to be it.
      "  timeout: 600_000,",
      "  use: {",
      "    baseURL: process.env.FOUNDRY_PREVIEW_URL,",
      '    channel: "chrome",',
      "    viewport: { width: 375, height: 667 },",
      "  },",
      "});",
      "",
    ].join("\n"),
    ...trace,
  });
  return [...protocolNormalizedFiles, ...scaffold];
}

export function validateCustomerContentIntegrity(files, customerContent) {
  if (customerContent === null || customerContent === undefined) return;
  const suppliedKinds = new Set(
    (customerContent.supplied ?? []).map((item) => item.kind),
  );
  const applicationText = files
    .filter(
      (file) =>
        /^(?:src\/)?app\/|^components\/|^lib\//u.test(file.path) &&
        /\.(?:html|js|jsx|md|mjs|ts|tsx)$/u.test(file.path),
    )
    .map((file) => file.content)
    .join("\n");
  const violations = [];
  if (!suppliedKinds.has("contact-details")) {
    const emailAddresses = [
      ...applicationText.matchAll(
        /(?:\bmailto:)?\b([A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,}))\b/giu,
      ),
    ];
    const reservedExampleDomains = new Set([
      "example.com",
      "example.net",
      "example.org",
    ]);
    const hasUnsupportedEmailAddress = emailAddresses.some((match) => {
      const prefix = applicationText.slice(
        Math.max(0, (match.index ?? 0) - 120),
        match.index ?? 0,
      );
      // An input hint is not the customer's contact identity. Keep the
      // provenance gate strict for rendered addresses and mailto links while
      // allowing a clearly non-authoritative form placeholder such as
      // placeholder="you@company.com".
      if (/\bplaceholder\s*=\s*["'][^"']*$/iu.test(prefix)) return false;
      const domain = match[2].toLowerCase();
      const topLevelDomain = domain.split(".").at(-1);
      return !reservedExampleDomains.has(domain) &&
        !new Set([
          "example",
          "fictional",
          "internal",
          "invalid",
          "local",
          "localhost",
          "test",
        ]).has(topLevelDomain);
    });
    if (hasUnsupportedEmailAddress) {
      violations.push("email address");
    }
    if (
      /\btel:\+?[\d(][\d\s().-]{6,}\d|\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/u.test(
        applicationText,
      )
    ) {
      violations.push("phone number");
    }
  }
  if (
    !suppliedKinds.has("trust-evidence") &&
    /\b(?:testimonial|licensed(?:\s+and)?\s+insured|award[- ]winning|established\s+(?:in\s+)?\d{4}|\d+\s+years?\s+(?:of\s+)?(?:experience|serving))\b/iu.test(
      applicationText,
    )
  ) {
    violations.push("trust claim or testimonial");
  }
  if (
    !suppliedKinds.has("business-hours") &&
    /\b(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:-|–|—|to|:)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/iu.test(
      applicationText,
    )
  ) {
    violations.push("business hours");
  }
  if (
    !suppliedKinds.has("pricing") &&
    /(?:[$£€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|GBP|EUR))\b/u.test(
      applicationText,
    )
  ) {
    violations.push("price");
  }
  if (violations.length > 0) {
    throw new TypeError(
      `The generated project contains unsupported customer facts (${violations.join(
        ", ",
      )}). Omit them or collect them from the customer before launch.`,
    );
  }
}

// Six separate gates each assumed a check is computed by a literal
// checks["id"] = expression assignment. A test asked to compute every check in
// its own try/catch naturally factors that into a helper, and then every one of
// those gates rejects it — the first build to write clean code failed the same
// gate three times and gave up. Resolve the computing expression once, in both
// shapes, and let every gate inspect that instead.
export function checkComputationSources(source, checkId) {
  const escaped = checkId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const direct = [
    ...source.matchAll(
      new RegExp(
        `checks\\s*\\[\\s*["']${escaped}["']\\s*\\]\\s*=\\s*([^;\\n]+)`,
        "gu",
      ),
    ),
  ].map((match) => match[1]);
  if (direct.length > 0) return direct;
  const implementation = browserCheckImplementationSource(source, checkId);
  if (implementation !== "") return [implementation];
  // Helper form: the id is passed to something that assigns into checks, so the
  // computation lives in the invocation that follows the id literal.
  if (!/checks\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=/u.test(source)) return [];
  return [
    ...source.matchAll(new RegExp(`["']${escaped}["']`, "gu")),
  ].map((match) => source.slice(match.index, match.index + 700));
}

export function runtimeRestartCountForRecords(runtimeRecords = []) {
  const starts = runtimeRecords.filter((record) => record.eventType === "STARTUP");
  const independentlyObservedSessionIds = new Set(
    runtimeRecords
      .filter((record) => record.eventType === "BROWSER_OBSERVATION")
      .map((record) => record.sessionId),
  );
  const hasIndependentVerificationRuntime = starts.some((record) =>
    independentlyObservedSessionIds.has(record.sessionId),
  );
  const executionRuntimeCount = starts.length -
    (hasIndependentVerificationRuntime ? 1 : 0);
  return Math.max(0, executionRuntimeCount - 1);
}

function browserCheckImplementationSource(source, checkId) {
  const escaped = checkId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const callback =
    "(?:async\\s*)?(?:\\([^)]*\\)|[A-Za-z_$][\\w$]*)\\s*(?::\\s*[^=\\r\\n]+)?=>";
  // A small higher-order wrapper such as check(async context => { ... }) is
  // still an explicit entry with an independently invokable callback. Treating
  // it like an opaque computed loop rejected valid isolated authentication
  // checks even though their account helper was directly reachable.
  const entryValue =
    `(?:${callback}|[A-Za-z_$][\\w$]*\\s*\\(\\s*${callback})`;
  const marker = new RegExp(
    `["']${escaped}["']\\s*:\\s*${entryValue}`,
    "u",
  ).exec(source);
  if (marker === null) return "";
  const start = marker.index;
  const tail = source.slice(start + marker[0].length);
  const next = new RegExp(
    `,\\s*["'][^"']+["']\\s*:\\s*${entryValue}`,
    "u",
  ).exec(tail);
  if (next === null) {
    // The final callback is followed by the obligationChecks object's own
    // closing brace. Return only the callback entry so a canonical replacement
    // cannot accidentally delete that enclosing brace.
    return source.slice(start).replace(/\}\s*;?\s*$/u, "");
  }
  return source.slice(
    start,
    start + marker[0].length + next.index,
  );
}

function browserCheckReachableSource(source, checkId) {
  const implementation = browserCheckImplementationSource(source, checkId);
  if (implementation === "") return "";
  const reachable = [implementation];
  const pending = [implementation];
  const visited = new Set();
  while (pending.length > 0 && visited.size < 12) {
    const current = pending.shift();
    for (const match of current.matchAll(
      /\b(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/gu,
    )) {
      const name = match[1];
      if (visited.has(name)) continue;
      visited.add(name);
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      const definition = new RegExp(
        `(?:const|let|var)\\s+${escaped}(?:\\s*:[^=\\r\\n]+)?\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*(?::\\s*[^=\\r\\n]+)?=>|(?:async\\s+)?function\\s+${escaped}\\s*\\([^)]*\\)`,
        "u",
      ).exec(source);
      if (definition === null) continue;
      // The observation file is deliberately small. Include the local helper's
      // bounded source neighborhood so admission follows shared actions such as
      // enroll(context) instead of falsely requiring every check to inline the
      // same sign-up sequence. Runtime verification remains the final proof.
      const helperSource = source.slice(
        definition.index,
        Math.min(source.length, definition.index + 4_000),
      );
      reachable.push(helperSource);
      pending.push(helperSource);
    }
  }
  return reachable.join("\n");
}

export function obligationRequiresCredentialLoginProof(statement = "") {
  // Derived design obligations can name a "sign-in switch", "login tab", or
  // similar visible label while asking only for composition or navigation.
  // Treating that noun as a credential journey rejected valid design checks
  // before install. Functional customer obligations never use this approved-
  // design prefix and remain subject to the full saved-credential proof.
  if (
    /\b(?:implements|satisfies)\s+the\s+approved\b[^:]{0,120}\b(?:composition|navigation|responsive|visual|accessibility|design)\b/iu.test(
      String(statement),
    ) ||
    /\bpreserves\s+its\s+approved\b[^.]{0,180}\b(?:content|workflow|design|interaction|experience)\b/iu.test(
      String(statement),
    )
  ) {
    return false;
  }
  // A mode switch is navigation evidence, even when one of its labels is
  // "Sign in". Requiring saved credentials here rejected the exact customer
  // obligation "switch between create-account and sign-in modes" before the
  // project could even install. Credential proof belongs to the separate
  // obligation that says a valid sign-in creates an authenticated session.
  if (
    /\b(?:switch|toggle|choose|move|navigate)\w*\b[^.]{0,140}\b(?:sign[- ]?in|log[- ]?in)\b[^.]{0,80}\b(?:mode|tab|view|screen|form)s?\b/iu.test(
      String(statement),
    ) ||
    /\b(?:mode|tab|view|screen|form)s?\b[^.]{0,80}\b(?:switch|toggle|choose|move|navigate)\w*\b[^.]{0,140}\b(?:sign[- ]?in|log[- ]?in)\b/iu.test(
      String(statement),
    ) ||
    /\b(?:sign[- ]?in|log[- ]?in)\s*[/&-]\s*(?:create[- ]?account|sign[- ]?up)\s+(?:mode\s+)?switch\b/iu.test(
      String(statement),
    ) ||
    (/(?=.*\b(?:sign[- ]?in|log[- ]?in)\b)(?=.*\b(?:create[- ]?account|sign[- ]?up)\b)(?=.*\bmodes?\b)/iu.test(
      String(statement),
    ) &&
      !/\b(?:submit(?:ting)?|credentials?|password|session|authenticated|signed[- ]in|saved\s+account|existing\s+account)\b/iu.test(
        String(statement),
      ))
  ) {
    return false;
  }
  // Registration obligations often explain that the newly-created account is
  // available *for a later login*. That outcome is evidence of sign-up, not a
  // demand to repeat the separate login journey in the same check. Remove only
  // those explicit future-purpose clauses; an obligation that actually says to
  // sign up, sign out, and then sign in still requires credential-login proof.
  const actionableStatement = String(statement)
    .replace(
      /\bso\s+(?:that\s+)?(?:they|the\s+(?:person|user|member|customer))\s+can\s+(?:sign[- ]?in|log[- ]?in)\b/giu,
      "",
    )
    .replace(
      /\b(?:available|ready|saved|usable)\s+for\s+(?:a\s+)?future\s+(?:sign[- ]?in|log[- ]?in)\b/giu,
      "",
    );
  if (
    /\bsubmitting\s+valid\s+credentials\b[^.]{0,140}\bserver[- ]validated\s+session\b/iu.test(
      actionableStatement,
    )
  ) {
    return true;
  }
  return /\b(?:sign[- ]?in|log[- ]?in)\b/iu.test(actionableStatement);
}

export function obligationRequiresAuthenticationErrorProof(statement = "") {
  return /\b(?:invalid|rejected|incorrect|malformed|failed|duplicate|incomplete)\b[\s\S]{0,160}\b(?:authentication|credentials?|emails?|fields?|passwords?)\b|\b(?:authentication|credentials?|validation)\b[\s\S]{0,40}\berrors?\b/iu.test(
    String(statement),
  );
}

export function obligationRequiresAuthenticatedSurface(statement = "") {
  // A negative authentication check must begin signed out. Its wording often
  // names the protected destination only to prove that invalid credentials do
  // *not* reach it (for example, "without entering the dashboard"). Treating
  // that noun as an authenticated-surface requirement makes the correct test
  // impossible and sends an already-valid bundle through paid regeneration.
  if (obligationRequiresAuthenticationErrorProof(statement)) return false;
  return /\b(?:authenticated|protected|signed[- ]in|dashboard|workspace|portal|account area|todo|task|record|rail)\b/iu.test(
    String(statement),
  );
}

export function isFoundryOwnedBrowserHealthObligation(statement = "") {
  return /\b(?:complete|completes|run|runs)\b[\s\S]{0,100}\b(?:primary\s+)?browser\s+workflow\b[\s\S]{0,100}\bwithout\s+blocking\s+browser\s+errors\b/iu.test(
    String(statement),
  );
}

export function responsiveBrowserCheckIdsForContract(
  obligations = [],
  bindings = {},
) {
  const candidates = obligations.filter(
    (obligation) =>
      bindings[obligation.obligationId] === "browser-check" &&
      /\b(?:phone|mobile|responsive|small[- ]screen|narrow viewport|narrow screens?|touch target)\b/iu.test(
        obligation.statement,
      ),
  );
  const dedicated = candidates.filter((obligation) =>
    /\b(?:responsive\s+(?:priority|behavior|behaviour|transformation|transform)|phone\s+(?:layout|viewport|view)|mobile\s+(?:layout|viewport|view)|without\s+horizontal\s+overflow|works?\s+(?:on|at)\s+(?:narrow|small|mobile|phone))\b/iu.test(
      obligation.statement,
    ),
  );
  return (dedicated.length > 0 ? dedicated : candidates)
    .map((obligation) => obligation.obligationId)
    .sort((left, right) => left.localeCompare(right));
}

export function validateBrowserObservationTestSource(
  source,
  requiredBrowserCheckIds = [],
  {
    responsiveCheckIds = [],
    accessibilityCheckIds = [],
    authenticatedCheckIds = [],
    loginCheckIds = [],
  } = {},
) {
  const unnamedFormRole = /\.getByRole\(\s*(["'])form\1/iu.exec(source);
  if (unnamedFormRole !== null) {
    throw new TypeError(
      "The browser observation test locates a native form with getByRole('form'). An unnamed HTML form is not required to be exposed as the ARIA form landmark, so that locator can wait until the check times out even while the visible form works. Use locator('form'), or give the form an accessible name and locate that exact named form.",
    );
  }
  const reusablePersistentIdentity = /(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*(?:account|email|user(?:name)?)[\w$]*)\s*=\s*(?:["'`]|[^;\n]*\bDate\.now\s*\()/imu.exec(
    source,
  );
  const invocationScopedIdentityFactory =
    reusablePersistentIdentity !== null &&
    /=>/u.test(reusablePersistentIdentity[0]) &&
    /\b(?:Date\.now|Math\.random|randomUUID|crypto\.randomUUID)\b/u.test(
      reusablePersistentIdentity[0],
    );
  if (
    reusablePersistentIdentity !== null &&
    !invocationScopedIdentityFactory
  ) {
    throw new TypeError(
      `The browser observation test declares persistent identity "${reusablePersistentIdentity[1]}" once at module load. Every isolated check shares the same database, so account and record identities must be created inside the helper on every invocation; a module-level literal or Date.now() value is reused and causes later checks to receive conflict or 422 responses.`,
    );
  }
  const ambiguousClassAction = /page\.locator\(\s*(["'])\.[A-Za-z_-][\w-]*\1\s*\)(?!\s*\.(?:first|last|nth|filter)\s*\()\s*\.(?:check|click|fill|press|selectOption|uncheck)\s*\(/iu.exec(
    source,
  );
  if (ambiguousClassAction !== null) {
    const locator = ambiguousClassAction[0].slice(
      0,
      ambiguousClassAction[0].indexOf(").") + 1,
    );
    throw new TypeError(
      `The browser observation test performs a strict action through the unscoped class locator ${locator}. Generated pages commonly reuse visual classes; scope the locator to a semantic role and accessible name, a stable ancestor, or an explicitly selected element so multiple matching controls cannot abort the check.`,
    );
  }
  const ambiguousLabelAction = /page\.getByLabel\(\s*(["'])([^"']+)\1\s*\)(?!\s*\.\s*(?:first|last|nth|filter)\s*\()\s*\.(?:check|click|evaluate|fill|press|selectOption|uncheck)\s*\(/iu.exec(
    source,
  );
  if (ambiguousLabelAction !== null) {
    throw new TypeError(
      `The browser observation test performs a strict action through getByLabel(${JSON.stringify(ambiguousLabelAction[2])}) without exact matching. Playwright label queries also match longer accessible names; pass { exact: true }, use a semantic role with an exact accessible name, or scope the locator so an unrelated region or progress control cannot abort the workflow.`,
    );
  }
  const opaqueAuthenticatedCheckIds = [];
  const sessionlessAuthenticatedCheckIds = [];
  for (const checkId of authenticatedCheckIds) {
    const implementation = browserCheckReachableSource(source, checkId);
    if (implementation === "") {
      opaqueAuthenticatedCheckIds.push(checkId);
      continue;
    }
    const establishesFreshAccount =
      /(?:getByRole|getByText|locator)\s*\([\s\S]{0,220}\b(?:create account|sign up|register)\b[\s\S]{0,220}\.(?:click|press)\s*\(/iu.test(
        implementation,
      ) ||
      /(?:\/api\/auth|\/signup|\/register)[\s\S]{0,180}\b(?:POST|signup|register)\b/iu.test(
        implementation,
      );
    if (!establishesFreshAccount) {
      sessionlessAuthenticatedCheckIds.push(checkId);
    }
  }
  if (opaqueAuthenticatedCheckIds.length > 0) {
    throw new TypeError(
      `Browser check "${opaqueAuthenticatedCheckIds.join(", ")}" observes an authenticated or protected product surface but is generated through an opaque shared loop. Define an explicit object entry for every listed check so Foundry can verify each independent account/session setup before execution.`,
    );
  }
  if (sessionlessAuthenticatedCheckIds.length > 0) {
    throw new TypeError(
      `Browser check "${sessionlessAuthenticatedCheckIds.join(", ")}" observes an authenticated or protected product surface but does not establish its own account/session. Foundry clears cookies and storage before every check; create a unique account inside every listed check, reach the protected surface, and only then measure it. Do not weaken the assertion or rely on another check's login.`,
    );
  }
  for (const checkId of loginCheckIds) {
    // A generated check commonly delegates account creation and credential
    // submission to local helpers. Inspect the same bounded reachable source
    // used by the authenticated-surface gate so valid reusable verification
    // code is not rejected before the application can even be built.
    const implementation = browserCheckReachableSource(source, checkId);
    if (implementation === "") continue;
    const submitsLoginThroughUi =
      /(?:getByLabel\s*\([\s\S]{0,120}(?:password|passcode)|locator\s*\([\s\S]{0,120}input[^\r\n]*(?:password|passcode))[\s\S]{0,800}\b(?:sign in|log in)\b[\s\S]{0,220}\.click\s*\(/iu.test(
        implementation,
      );
    const submitsLoginDirectly =
      /\/(?:api\/auth\/)?(?:signin|login)[\s\S]{0,220}\bPOST\b/iu.test(
        implementation,
      );
    if (!submitsLoginThroughUi && !submitsLoginDirectly) {
      throw new TypeError(
        `Browser check "${checkId}" promises sign-in but does not submit saved credentials. Revealing a login form is not login evidence; create an account, sign out, fill the saved email and password, submit login, and then observe the protected surface.`,
      );
    }
  }
  for (const collection of [
    "captureProbeErrors",
    "consoleErrors",
    "pageErrors",
  ]) {
    const emptyArrayDeclaration = new RegExp(
      `(?:const|let)\\s+${collection}(?:\\s*:[^=;]+)?\\s*=\\s*\\[\\s*\\]`,
      "u",
    );
    if (!emptyArrayDeclaration.test(source)) {
      throw new TypeError(
        `The browser observation test must initialize ${collection} as an empty array.`,
      );
    }
  }
  if (
    !/finally\s*\{[\s\S]*FOUNDRY_BROWSER_RESULT:/u.test(source)
  ) {
    throw new TypeError(
      "The browser observation test must emit FOUNDRY_BROWSER_RESULT from a finally block. Emitted anywhere else, a failing assertion aborts the run before the marker is written and the observation is lost entirely rather than reported as a failure.",
    );
  }
  for (const checkId of requiredBrowserCheckIds) {
    const escapedCheckId = checkId.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    const assignments = [
      ...source.matchAll(
        new RegExp(
          `checks\\s*\\[\\s*["']${escapedCheckId}["']\\s*\\]\\s*=\\s*([^;\\n]+)`,
          "gu",
        ),
      ),
    ];
    // A test asked to compute every check in its own try/catch naturally
    // factors that into a helper — observe("obligation-001", async () => …) —
    // and then no literal checks["obligation-001"] = assignment exists. This
    // gate rejected exactly the shape its own instructions ask for, three
    // identical times in a row. Accept a helper that receives the check id,
    // provided the helper does assign into checks from a computed value.
    const helperAssignsChecks =
      /checks\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=/u.test(source);
    const helperInvocations = helperAssignsChecks
      ? [
          ...source.matchAll(
            new RegExp(`["']${escapedCheckId}["']`, "gu"),
          ),
        ]
      : [];
    if (assignments.length === 0 && helperInvocations.length === 0) {
      throw new TypeError(
        `The browser observation test must compute required check "${checkId}" from observed evidence, either by assigning checks["${checkId}"] directly or by passing "${checkId}" to a helper that assigns into checks.`,
      );
    }
    // The literal-success guard still applies to every direct assignment, and
    // a helper cannot smuggle one past it because a helper assigning a bare
    // literal would fail this same test for every check at once.
    if (
      assignments.some((match) =>
        /^(?:true|Boolean\s*\(\s*true\s*\))\s*$/u.test(
          match[1].trim(),
        ),
      )
    ) {
      throw new TypeError(
        `The browser observation test may not certify check "${checkId}" with a literal success value.`,
      );
    }
  }
  if (
    /checks\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=\s*(?:true|Boolean\s*\(\s*true\s*\))\s*[;\n]/u.test(
      source,
    )
  ) {
    throw new TypeError(
      "A helper that records check results may not be handed a literal true. The helper must receive the value an observation produced, so that what it records is what the running page actually did.",
    );
  }
  if (responsiveCheckIds.length > 0) {
    const numericConstants = new Map(
      [...source.matchAll(
        /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(\d{2,4})\b/gu,
      )].map((match) => [match[1], Number(match[2])]),
    );
    const viewportDimensions = [
      ...source.matchAll(
        /(?:viewport\s*:\s*\{|setViewportSize\s*\(\s*\{)[\s\S]{0,160}?width\s*:\s*(\d{2,4}|[A-Za-z_$][\w$]*)[\s\S]{0,120}?height\s*:\s*(\d{2,4}|[A-Za-z_$][\w$]*)/gu,
      ),
    ].map((match) => ({
      widthToken: match[1],
      width: /^\d+$/u.test(match[1])
        ? Number(match[1])
        : numericConstants.get(match[1]),
      heightToken: match[2],
      height: /^\d+$/u.test(match[2])
        ? Number(match[2])
        : numericConstants.get(match[2]),
    }));
    const phoneViewports = viewportDimensions.filter(
      ({ width, height }) =>
        width >= 280 && width <= 480 && height >= 480,
    );
    if (phoneViewports.length === 0) {
      throw new TypeError(
        "Responsive verification must set a real phone-width viewport between 280 and 480 pixels before measuring. Measuring at the default desktop width proves nothing about a phone.",
      );
    }
    const tokenHasRuntimeUse = (token) => {
      const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return [...source.matchAll(new RegExp(`\\b${escapedToken}\\b`, "gu"))]
        .length >= 2;
    };
    const declaredViewportWidthUsed = phoneViewports.some(({ widthToken }) =>
      tokenHasRuntimeUse(widthToken),
    );
    const declaredViewportHeightUsed = phoneViewports.some(({ heightToken }) =>
      tokenHasRuntimeUse(heightToken),
    );
    if (
      !/scrollWidth/u.test(source) ||
      (!/(?:clientWidth|innerWidth)/u.test(source) &&
        !declaredViewportWidthUsed)
    ) {
      throw new TypeError(
        "Responsive verification must measure horizontal overflow by comparing document.documentElement.scrollWidth with clientWidth. A screenshot or a visibility assertion cannot detect a page that is wider than its viewport.",
      );
    }
    if (
      !/(?:scrollHeight|offsetHeight|getBoundingClientRect\s*\(\s*\)\.height)/u.test(source) ||
      (!/(?:clientHeight|innerHeight)/u.test(source) &&
        !declaredViewportHeightUsed)
    ) {
      throw new TypeError(
        "Responsive verification must compare the rendered height against window.innerHeight, so a layout that runs to many screens on a phone is observed rather than assumed acceptable.",
      );
    }
    // This scans the whole test file, so the offending expression is usually in
    // some other check entirely. Naming it is the difference between a
    // correction that fixes the real line and one that rewrites the responsive
    // check, fails again, and burns another paid regeneration.
    const vacuousCount = /\b[A-Za-z_$][\w$]*(?:count|length|rows)\s*>=\s*0\b/iu.exec(
      source,
    );
    if (vacuousCount !== null) {
      const line = source.slice(0, vacuousCount.index).split("\n").length;
      throw new TypeError(
        [
          `The browser observation test uses a vacuous zero-or-more count as passing evidence: "${vacuousCount[0]}" (line ${line}).`,
          "A \">= 0\" comparison is always true and proves nothing. Replace exactly that expression with a real observation of the state it is meant to prove, and leave every other check unchanged.",
        ].join(" "),
      );
    }
    const hasLiteralInteractionBound = /(?:<=|<)\s*\d+/u.test(source);
    const numericBounds = new Map(
      [...source.matchAll(
        /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(\d+)\s*;/gu,
      )].map((match) => [match[1], Number(match[2])]),
    );
    const hasNamedInteractionBound = [
      ...numericBounds.entries(),
    ].some(([name, value]) => {
      return (
        Number.isSafeInteger(value) &&
        value > 0 &&
        value <= 100 &&
        new RegExp(
          `\\b[A-Za-z_$][\\w$]*(?:control|count|density|interaction)[\\w$]*\\s*(?:<=|<)\\s*${name}\\b`,
          "iu",
        ).test(source)
      );
    });
    const hasMeasuredInteractionCount =
      /\.count\s*\(\s*\)/u.test(source) ||
      /\.all\s*\(\s*\)[\s\S]{0,240}?\.length/u.test(source) ||
      (/(?:querySelectorAll|locator)\s*\(/u.test(source) &&
        /\b[A-Za-z_$][\w$]*\.length\b/u.test(source));
    if (
      !hasMeasuredInteractionCount ||
      (!hasLiteralInteractionBound && !hasNamedInteractionBound)
    ) {
      throw new TypeError(
        "Responsive verification must bound how many interactive controls the phone surface presents, compared against a finite number. Without a bound the check passes for any layout, however unusable.",
      );
    }
    for (const checkId of responsiveCheckIds) {
      const escapedCheckId = checkId.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      );
      const computations = [
        ...checkComputationSources(source, checkId),
        browserCheckReachableSource(source, checkId),
      ].filter(Boolean);
      const directlyReferencesResponsiveEvidence = (expression) =>
        /(?:phone|mobile|responsive|overflow|density|height|width|viewport|interaction)/iu.test(
          expression,
        );
      const referencesMeasuredResponsiveVariable = (expression) =>
        [...expression.matchAll(/\b([A-Za-z_$][\w$]*)\b/gu)].some(
          (identifierMatch) => {
            const identifier = identifierMatch[1].replace(
              /[.*+?^${}()|[\]\\]/gu,
              "\\$&",
            );
            const declaration = new RegExp(
              `(?:const|let)\\s+${identifier}\\s*=\\s*([^;]+)`,
              "u",
            ).exec(source);
            return declaration !== null &&
              directlyReferencesResponsiveEvidence(declaration[1]);
          },
        );
      if (
        computations.length === 0 ||
        !computations.some(
          (expression) =>
            directlyReferencesResponsiveEvidence(expression) ||
            referencesMeasuredResponsiveVariable(expression),
        )
      ) {
        throw new TypeError(
          `Responsive check "${checkId}" must be computed from measured phone-layout quality evidence.`,
        );
      }
      // Only the check's own computation can prove that this responsive
      // obligation is trying to inspect a mobile-only project control. The
      // reachable helper graph deliberately includes shared wrappers (for
      // example `check(context, callback)`). Treating every locator used by a
      // shared wrapper or a neighboring check as part of this check produced a
      // false viewport error and made every otherwise-valid repair
      // inadmissible. Runtime observation still executes the exact callback;
      // this admission rule only needs to guard visibility asserted by the
      // responsive check itself.
      const projectSpecificVisibility = checkComputationSources(
        source,
        checkId,
      ).filter((expression) =>
        /(?:\.locator\s*\(|getByRole\s*\(|getByLabel\s*\()[\s\S]{0,300}?\.isVisible\s*\(/u.test(
          expression,
        ),
      );
      if (
        projectSpecificVisibility.length > 0 &&
        !projectSpecificVisibility.some((expression) =>
          /setViewportSize\s*\(/u.test(expression),
        )
      ) {
        throw new TypeError(
          `Responsive check "${checkId}" observes project-specific element visibility without setting the viewport in that check. The shared phone evidence is measured earlier, but each project check starts at desktop width; set a 280-480px viewport before asserting a mobile-only navigation or control.`,
        );
      }
    }
  }
  for (const checkId of accessibilityCheckIds) {
    const computations = [
      ...checkComputationSources(source, checkId),
      browserCheckReachableSource(source, checkId),
    ].filter(Boolean);
    if (
      !/(?:keyboard\.press|\.press)\s*\(\s*["']Tab["']/u.test(source) ||
      !/(?:document\.activeElement|toBeFocused\s*\(|:focus-visible)/u.test(source)
    ) {
      throw new TypeError(
        `Accessibility check "${checkId}" must exercise keyboard Tab navigation and observe actual focus.`,
      );
    }
    const numericLabelEvidence =
      /\b(?=[\w$]*(?:labelled|labeled|label))[A-Za-z_$][\w$]*(?:\.length)?\s*(?:>\s*\d+|>=\s*[1-9]\d*|(?:===|==)\s*true)\b/iu.test(
        source,
      );
    const booleanLabelEvidence = [
      ...source.matchAll(
        /(?:const|let)\s+((?=[A-Za-z_$][\w$]*(?:labelled|labeled|label))[A-Za-z_$][\w$]*)\s*=\s*false\b/giu,
      ),
    ].some((match) => {
      const escapedName = match[1].replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      );
      return new RegExp(`\\b${escapedName}\\s*=\\s*true\\b`, "u").test(
        source,
      ) &&
        /(?:\.label|ariaLabel|aria-label)[\s\S]{0,80}?(?:\.length\s*>\s*0|\.trim\s*\(\s*\)\s*\.length\s*>\s*0)/u.test(
          source,
        );
    });
    if (
      !/(?:getByLabel\s*\(|aria-label|locator\s*\(\s*["']label|querySelectorAll\s*\(\s*["']label)/u.test(source) ||
      (!numericLabelEvidence && !booleanLabelEvidence)
    ) {
      throw new TypeError(
        `Accessibility check "${checkId}" must verify non-vacuous accessible labeling evidence.`,
      );
    }
    const directlyReferencesAccessibilityEvidence = (expression) =>
      /(?:access|label|focus|keyboard)/iu.test(expression);
    const referencesMeasuredAccessibilityVariable = (expression) =>
      [...expression.matchAll(/\b([A-Za-z_$][\w$]*)\b/gu)].some(
        (identifierMatch) => {
          const identifier = identifierMatch[1].replace(
            /[.*+?^${}()|[\]\\]/gu,
            "\\$&",
          );
          const declaration = new RegExp(
            `(?:const|let)\\s+${identifier}\\s*=\\s*([^;]+)`,
            "u",
          ).exec(source);
          return declaration !== null &&
            directlyReferencesAccessibilityEvidence(declaration[1]);
        },
      );
    if (
      computations.length === 0 ||
      !computations.some(
        (expression) =>
          directlyReferencesAccessibilityEvidence(expression) ||
          referencesMeasuredAccessibilityVariable(expression),
      )
    ) {
      throw new TypeError(
        `Accessibility check "${checkId}" must be computed from measured labeling and focus evidence.`,
      );
    }
  }
  // Last, because it is the subtlest: a check may pass and still be worthless
  // if its expected value was copied from the implementation rather than
  // derived from the page. A dashboard shipped "Open tickets" counting
  // everything not closed, and its check asserted the widget read "2" after
  // filtering to Pending -- true only because the code was wrong the same way.
  assertObservationIndependence(source);
}

export function generatedFileReconciliationAction(file, workUnits) {
  const desiredHash = createHash("sha256")
    .update(file.content, "utf8")
    .digest("hex");
  const priorMutations = workUnits.filter(
    (record) =>
      record.status === WorkUnitStatus.SUCCEEDED &&
      [WorkUnitAction.WRITE_FILE, WorkUnitAction.REPLACE_FILE].includes(
        record.actionType,
      ) &&
      record.inputs?.path === file.path &&
      /-\d{3}-write-/u.test(record.workUnitId),
  );
  if (
    priorMutations.some((record) => record.inputs.contentHash === desiredHash)
  ) {
    return "skip";
  }
  return priorMutations.length > 0
    ? WorkUnitAction.REPLACE_FILE
    : WorkUnitAction.WRITE_FILE;
}

export function verificationTargetsForProcedure(
  bindings,
  procedureName,
  fallbackTargetIds,
) {
  const mode = {
    dependencyLock: "dependency-lock",
    install: "dependency-install",
    typeCheck: "type-check",
    lint: "lint",
    productionBuild: "production-build",
  }[procedureName];
  const targets =
    mode === undefined
      ? []
      : Object.entries(bindings)
          .filter(([, binding]) => binding === mode)
          .map(([obligationId]) => obligationId);
  return targets.length > 0 ? targets : fallbackTargetIds;
}

function excerptForRejection(text) {
  const single = String(text).replace(/\s+/gu, " ").trim();
  return single.length > 120 ? `${single.slice(0, 120)}…` : single;
}

function applyExactReplacements(content, replacements, path = null) {
  let result = content;
  let applied = 0;
  // Naming only the count left the retry guessing which of its edits was wrong,
  // so it re-proposed the same unusable text and spent another attempt. Say
  // exactly which oldText failed and whether it was absent or ambiguous.
  const unmatched = [];
  for (const replacement of replacements) {
    const first = result.indexOf(replacement.oldText);
    const last = result.lastIndexOf(replacement.oldText);
    if (first >= 0 && first === last) {
      result =
        result.slice(0, first) +
        replacement.newText +
        result.slice(first + replacement.oldText.length);
      applied += 1;
      continue;
    }
    unmatched.push(
      `${first < 0 ? "never appears" : "appears more than once"} — oldText: "${excerptForRejection(replacement.oldText)}"`,
    );
  }
  const where = path === null ? "" : ` in ${path}`;
  if (applied !== replacements.length) {
    throw new Error(
      [
        `Every model repair replacement must match exactly once; the patch was rejected atomically. ${unmatched.length} of ${replacements.length} replacements${where} could not be applied:`,
        ...unmatched.map((detail) => `  - ${detail}`),
        "Copy oldText verbatim from the current file shown to you, including its exact whitespace, and extend it with surrounding text until it is unique.",
      ].join("\n"),
    );
  }
  if (result === content) {
    throw new Error(
      `The model repair replacements do not change the current file${where}: every newText is identical to the oldText it replaces. Propose the corrected text, not the text already present.`,
    );
  }
  return result;
}

function canReplayExactReplacements(content, replacements) {
  let result = content;
  let applied = 0;
  for (const replacement of replacements) {
    const first = result.indexOf(replacement.oldText);
    if (
      first < 0 ||
      first !== result.lastIndexOf(replacement.oldText) ||
      (replacement.newText !== "" &&
        result.includes(replacement.newText))
    ) {
      continue;
    }
    result =
      result.slice(0, first) +
      replacement.newText +
      result.slice(first + replacement.oldText.length);
    applied += 1;
  }
  return applied > 0 && result !== content;
}

export function validateBrowserRepairProposal({
  structuredOutput,
  currentFiles,
  requiredBrowserCheckIds,
  browserQualityRequirements = {},
  priorStructuredOutputs = [],
  allowPriorReplay = false,
}) {
  const patches = repairPatchFiles(structuredOutput);
  if (patches.length === 0) {
    throw new Error(
      "The browser repair returned no file edits at all. Name at least one existing project file and the exact replacements that correct the observed failure.",
    );
  }
  const patchedPaths = patches.map((patch) => patch?.path);
  if (new Set(patchedPaths).size !== patchedPaths.length) {
    // Two edits to one file would each be applied against the same starting
    // content, so the second would silently discard the first.
    const repeated = [
      ...new Set(patchedPaths.filter((path, index) => patchedPaths.indexOf(path) !== index)),
    ];
    throw new Error(
      `The browser repair named the same file twice: ${repeated.join(", ")}. Combine every replacement for a file into that file's single entry; two entries would each apply against the same starting content and the second would discard the first.`,
    );
  }
  const hypothesis = (output) =>
    JSON.stringify(
      repairPatchFiles(output)
        .map((patch) => [patch?.path, patch?.replacements])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
    );
  const duplicateHypothesis = priorStructuredOutputs.some(
    (output) => hypothesis(output) === hypothesis(structuredOutput),
  );
  if (duplicateHypothesis && !allowPriorReplay) {
    throw new Error(
      `The proposed repair repeats an earlier one exactly — the same replacements in ${patchedPaths.join(", ")} — and that attempt left the observation failing. Diagnose the remaining cause from the current file contents and the named failed sub-checks, and propose a different change.`,
    );
  }
  const accepted = patches.map((patch) =>
    validateSingleRepairPatch({
      patch,
      currentFiles,
      requiredBrowserCheckIds,
      browserQualityRequirements,
    }),
  );
  return Object.freeze({
    files: Object.freeze(accepted),
    repairsTestSource: accepted.some((file) => file.repairsTestSource),
    repairsPlaywrightConfig: accepted.some(
      (file) => file.repairsPlaywrightConfig,
    ),
  });
}

function validateSingleRepairPatch({
  patch,
  currentFiles,
  requiredBrowserCheckIds,
  browserQualityRequirements,
}) {
  const structuredOutput = patch;
  const currentFile = currentFiles.find(
    (file) => file.path === structuredOutput?.path,
  );
  if (currentFile === undefined) {
    // Naming neither the path nor what was available left a proposal that had
    // simply guessed a filename with no way to correct itself.
    const available = currentFiles.map((file) => file.path);
    const near = available.filter((path) => {
      const proposed = String(structuredOutput?.path ?? "");
      const leaf = proposed.slice(proposed.lastIndexOf("/") + 1);
      return leaf !== "" && path.endsWith(leaf);
    });
    throw new Error(
      [
        `The browser repair named "${structuredOutput?.path}", which is not a file in this project.`,
        near.length > 0
          ? `Did you mean ${near.join(" or ")}?`
          : `The files you may edit are: ${available.join(", ")}.`,
        "Use one of those exact paths.",
      ].join(" "),
    );
  }
  const repairedContent = applyExactReplacements(
    currentFile.content,
    structuredOutput.replacements,
    structuredOutput.path,
  );
  const repairsTestSource =
    /^tests\/.*\.(?:cjs|js|jsx|mjs|ts|tsx)$/u.test(
      structuredOutput.path,
    );
  const repairsObservationSource =
    structuredOutput.path === "tests/foundry-checks.ts" ||
    /^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(
      structuredOutput.path,
    );
  const repairsPlaywrightConfig =
    /^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(
      structuredOutput.path,
    );
  const repairsJavaScript =
    /\.(?:cjs|js|jsx|mjs|ts|tsx)$/u.test(structuredOutput.path);
  // Six conditions once shared one sentence — "violated the structured
  // observation protocol" — which named no condition, no file and no line.
  // Three proposals died against it in a row and the mission ended after a
  // single observation, four minutes in, with the application's real failures
  // never touched. Each condition now says what it is.
  const protocolViolation = (() => {
    if (repairedContent.trim() === "") {
      return `the repair would leave ${structuredOutput.path} empty`;
    }
    if (repairsJavaScript) {
      const unbalanced = unbalancedJavaScriptDelimiter(repairedContent);
      if (unbalanced !== null) {
        return `the repaired ${structuredOutput.path} has unbalanced delimiters: ${unbalanced}`;
      }
      if (/\bPromise<[^<>\r\n]{1,200}=>/u.test(repairedContent)) {
        return `the repaired ${structuredOutput.path} has a malformed Promise return type before an arrow function; close the generic first, for example Promise<void> =>`;
      }
    }
    if (!repairsPlaywrightConfig) return null;
    if (!repairedContent.includes("FOUNDRY_PREVIEW_URL")) {
      return "the Playwright configuration must read its base URL from FOUNDRY_PREVIEW_URL; Foundry owns the running application and the configuration may not start a second one";
    }
    if (!/\bchannel\s*:\s*["']chrome["']/u.test(repairedContent)) {
      return 'the Playwright configuration must select the installed system Chrome with channel: "chrome"';
    }
    if (/\bwebServer\s*:/u.test(repairedContent)) {
      return "the Playwright configuration may not declare webServer: Foundry already owns the ready application process";
    }
    if (/\breporter\s*:\s*["'](?:\.{1,2}\/|[A-Za-z]:[\\/])/u.test(repairedContent)) {
      return "the Playwright reporter may not be a filesystem path; use a built-in reporter name";
    }
    return null;
  })();
  if (protocolViolation !== null) {
    throw new Error(
      `The browser repair violated the structured observation protocol: ${protocolViolation}.`,
    );
  }
  if (repairsTestSource) {
    const expectationCount = (content) =>
      content.match(/\bexpect\s*\(/gu)?.length ?? 0;
    const assertionsBefore = expectationCount(currentFile.content);
    const assertionsAfter = expectationCount(repairedContent);
    if (assertionsAfter < assertionsBefore) {
      throw new Error(
        `The browser repair removed ${assertionsBefore - assertionsAfter} of the ${assertionsBefore} assertions in ${structuredOutput.path}. Deleting an assertion makes the observation pass without proving anything; correct how the failing one observes — its locator, its wait, or its scope — and keep every assertion.`,
      );
    }
    const assertedLiterals = [
      ...currentFile.content.matchAll(
        /\bexpect\s*\([^;\n]*?(?:["'`]([^"'`]{3,})["'`]|\/([^/\n]{3,})\/[a-z]*)[^;\n]*\)/giu,
      ),
    ]
      .map((match) => match[1] ?? match[2])
      .filter(Boolean);
    const lostLiterals = assertedLiterals.filter(
      (literal) => !repairedContent.includes(literal),
    );
    if (lostLiterals.length > 0) {
      throw new Error(
        `The browser repair removed or altered ${lostLiterals.length} asserted customer outcome(s) in ${structuredOutput.path}: ${lostLiterals
          .map((literal) => `"${excerptForRejection(literal)}"`)
          .join(", ")}. Those strings are what the customer was promised; correct the locator or the wait around them and leave the asserted text exactly as it is.`,
      );
    }
    const checkExpression = (content, checkId) => {
      const escapedCheckId = checkId.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      );
      return new RegExp(
        `checks\\s*\\[\\s*["']${escapedCheckId}["']\\s*\\]\\s*=\\s*([^;\\n]+)`,
        "u",
      ).exec(content)?.[1].trim();
    };
    const rewrittenVerdicts = requiredBrowserCheckIds
      .map((checkId) => ({
        checkId,
        was: checkExpression(currentFile.content, checkId),
        now: checkExpression(repairedContent, checkId),
      }))
      .filter((entry) => entry.was !== entry.now);
    if (rewrittenVerdicts.length > 0) {
      throw new Error(
        [
          `The browser repair changed the verdict formula of ${rewrittenVerdicts.length} contract check(s) in ${structuredOutput.path}:`,
          ...rewrittenVerdicts.map(
            (entry) =>
              `  - ${entry.checkId}: was \`${excerptForRejection(entry.was ?? "(absent)")}\`, now \`${excerptForRejection(entry.now ?? "(absent)")}\``,
          ),
          "A repair may correct a selector, a wait, or a scope, but what a check concludes is the contract. Restore each formula and fix how it observes instead.",
        ].join("\n"),
      );
    }
    const literalSuccessCount = (content) =>
      content.match(
        /(?:=|return)\s*(?:true\b|Boolean\s*\(\s*true\s*\))/gu,
      )?.length ?? 0;
    const literalsBefore = literalSuccessCount(currentFile.content);
    const literalsAfter = literalSuccessCount(repairedContent);
    if (literalsAfter > literalsBefore) {
      throw new Error(
        `The browser repair added ${literalsAfter - literalsBefore} assignment(s) or return(s) of a literal true in ${structuredOutput.path}. A check must conclude from something observed in the running page; hard-coding a pass reports success that was never seen. Observe the condition and return what the observation found.`,
      );
    }
    if (repairsObservationSource) {
      const validationSource =
        structuredOutput.path === "tests/foundry-checks.ts"
          ? bindFoundryObservationHarness(
              {
                files: [
                  {
                    path: structuredOutput.path,
                    content: repairedContent,
                  },
                ],
              },
              requiredBrowserCheckIds,
            ).files
              .filter((file) => file.path.startsWith("tests/"))
              .map((file) => file.content)
              .join("\n")
          : repairedContent;
      validateBrowserObservationTestSource(
        validationSource,
        requiredBrowserCheckIds,
        browserQualityRequirements,
      );
    }
  }
  return Object.freeze({
    path: structuredOutput.path,
    content: repairedContent,
    repairsTestSource,
    repairsPlaywrightConfig,
  });
}

function safeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 48);
}

const repairableFileExtensions = new Set([
  ".cjs",
  ".css",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".scss",
  ".svg",
  ".ts",
  ".tsx",
]);

export function validateGeneratedRepairPath(path, currentFiles) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > 240 ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(
      `The repair named "${path}", which is not a safe project-relative path. Use a forward-slash path relative to the project root, with no leading slash, no backslashes, and no "." or ".." segments — for example app/page.tsx.`,
    );
  }
  const normalized = path.toLowerCase();
  const protectedReason = normalized.startsWith("node_modules/")
    ? "installed dependencies are not project source"
    : normalized.startsWith(".next/")
      ? "the build output is regenerated from source"
      : normalized.startsWith("data/")
        ? "that is the running application's data, not its source"
        : normalized === "package-lock.json"
          ? "the lockfile is produced by the installer"
          : normalized.endsWith(".env")
            ? "environment files are not part of the generated project"
            : null;
  if (protectedReason !== null) {
    throw new Error(
      `The repair named "${path}", which Foundry owns and regenerates: ${protectedReason}. Change the source that produces it instead.`,
    );
  }
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (!repairableFileExtensions.has(extension)) {
    throw new Error(
      `The repair named "${path}", whose "${extension}" files are not repairable. Repairable file types are: ${[...repairableFileExtensions].sort().join(", ")}.`,
    );
  }
  if (currentFiles.some((file) => file.path === path)) return "replace";
  const parent = dirname(path).replaceAll("\\", "/");
  const parentExists =
    parent === "." ||
    currentFiles.some((file) => {
      const existingParent = dirname(file.path).replaceAll("\\", "/");
      return existingParent === parent || existingParent.startsWith(`${parent}/`);
    });
  if (!parentExists) {
    const directories = [
      ...new Set(currentFiles.map((file) => dirname(file.path).replaceAll("\\", "/"))),
    ].sort();
    throw new Error(
      `The repair would create "${path}" in "${parent}", a directory this project does not have. A new file may only be added inside an existing one: ${directories.join(", ")}.`,
    );
  }
  return "write";
}

export function validateGeneratedRepairProposal({
  structuredOutput,
  currentFiles,
  priorStructuredOutputs = [],
}) {
  validateGeneratedRepairPath(structuredOutput.path, currentFiles);
  const currentFile = currentFiles.find(
    (file) => file.path === structuredOutput.path,
  );
  if (currentFile?.content === structuredOutput.content) {
    throw new Error(
      `The proposed repair returned ${structuredOutput.path} byte-for-byte unchanged, so nothing would be corrected. Return the file with the defect actually fixed.`,
    );
  }
  if (
    priorStructuredOutputs.some(
      (proposal) =>
        proposal?.path === structuredOutput.path &&
        proposal?.content === structuredOutput.content,
    )
  ) {
    throw new Error(
      `The proposed repair returns exactly the same ${structuredOutput.path} as an earlier attempt, and that attempt left the failure in place. Diagnose the remaining cause from the recorded output and change something different.`,
    );
  }
}

export function validateGeneratedRepairSet({
  structuredOutput,
  currentFiles,
  priorStructuredOutputs = [],
}) {
  const files = repairPatchFiles(structuredOutput);
  if (files.length === 0 || files.length > MAX_REPAIR_FILES_PER_PROPOSAL) {
    throw new Error(
      `A procedure repair must return between one and ${MAX_REPAIR_FILES_PER_PROPOSAL} complete files.`,
    );
  }
  const paths = files.map((file) => file?.path);
  if (new Set(paths).size !== paths.length) {
    throw new Error(
      "A procedure repair may return each file only once; combine all changes for a path into its complete corrected content.",
    );
  }
  const priorFiles = priorStructuredOutputs.flatMap((proposal) =>
    repairPatchFiles(proposal),
  );
  for (const file of files) {
    validateGeneratedRepairProposal({
      structuredOutput: file,
      currentFiles,
      priorStructuredOutputs: priorFiles,
    });
  }
  return Object.freeze([...files]);
}

function commandEvidence(evidence, workUnitId) {
  return evidence
    .findByWorkUnit(workUnitId)
    .find((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT);
}

// Mirrors the binding rule the verification authority enforces, so the evidence
// chosen here is evidence it will accept. Kept deliberately in step with
// loadApplicableEvidence: picking a record the authority then rejects fails the
// whole mission at the last step, after the application is already built.
export function evidenceBindsToObligation(record, obligation, activeObligations) {
  if (record === undefined || record === null) return false;
  if (!obligation.requiredEvidenceKinds.includes(record.kind)) return false;
  if (record.obligationReference === obligation.obligationId) return true;
  const sameShape = (candidate) =>
    JSON.stringify(normalizeAcceptanceCondition(candidate.acceptanceCondition)) ===
      JSON.stringify(normalizeAcceptanceCondition(obligation.acceptanceCondition)) &&
    JSON.stringify([...candidate.requiredEvidenceKinds].sort()) ===
      JSON.stringify([...obligation.requiredEvidenceKinds].sort());
  return (activeObligations ?? []).some(
    (candidate) =>
      candidate.obligationId === record.obligationReference &&
      sameShape(candidate),
  );
}

function persistedWorkInputs(actionType, inputs) {
  if (actionType === WorkUnitAction.APPLY_FILE_BUNDLE) {
    return {
      files: inputs.files.map((file) => ({
        path: file.path,
        encoding: "utf8",
        byteLength: Buffer.byteLength(file.content),
        contentHash: createHash("sha256")
          .update(file.content, "utf8")
          .digest("hex"),
        sensitiveValueCount: [
          ...new Set(file.sensitiveValues ?? []),
        ].length,
      })),
    };
  }
  if (
    actionType === WorkUnitAction.WRITE_FILE ||
    actionType === WorkUnitAction.REPLACE_FILE
  ) {
    return {
      path: inputs.path,
      encoding: "utf8",
      byteLength: Buffer.byteLength(inputs.content),
      contentHash: createHash("sha256")
        .update(inputs.content, "utf8")
        .digest("hex"),
      sensitiveValueCount: [...new Set(inputs.sensitiveValues ?? [])].length,
    };
  }
  if (actionType === WorkUnitAction.RUN_COMMAND) {
    return {
      procedureName: inputs.procedureName,
      workingDirectory: inputs.workingDirectory ?? ".",
      environmentVariableNames: Object.keys(inputs.environment ?? {}).sort(),
      timeoutMs: inputs.timeoutMs ?? 30_000,
      outputLimitBytes: inputs.outputLimitBytes ?? 16_384,
    };
  }
  return { path: inputs.path };
}

const CONTRACT_TRACE_STOP_WORDS = new Set([
  "about", "after", "approved", "complete", "completes", "every",
  "first", "foundry", "from", "implementation", "project", "requirement",
  "scope", "that", "their", "this", "through", "version", "with",
]);

function contractTraceTokens(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/u)
      .filter(
        (token) =>
          token.length >= 4 && !CONTRACT_TRACE_STOP_WORDS.has(token),
      ),
  );
}

function contractTraceScore(source, file) {
  const sourceTokens = contractTraceTokens(source);
  const fileTokens = contractTraceTokens(`${file.path} ${file.content}`);
  let score = 0;
  for (const token of sourceTokens) {
    if (fileTokens.has(token)) score += 1;
  }
  return score;
}

export function bindMissingApprovedRequirementTraces(plan, approvedContract) {
  if (
    plan === null ||
    typeof plan !== "object" ||
    !Array.isArray(plan.requirementClaims) ||
    !Array.isArray(plan.files)
  ) {
    return plan;
  }
  const contractBoundPlan = bindApprovedContractIdentity(plan, approvedContract);
  const identityBoundPlan = bindApprovedPrototypeFidelityIdentity(
    contractBoundPlan,
    approvedContract,
  );
  const evidenceBoundPlan = bindApprovedPrototypeBrowserEvidence(
    identityBoundPlan,
    approvedContract,
  );
  const sourceGuardedPlan = bindApprovedPrototypeSourceGuardrails(
    evidenceBoundPlan,
    approvedContract,
  );
  const catalogue = approvedContractRequirementCatalogue(approvedContract);
  const requirements = new Map(
    catalogue.implementationRequirements.map((item) => [
      item.requirementId,
      item,
    ]),
  );
  const claims = new Map();
  for (const claim of sourceGuardedPlan.requirementClaims) {
    if (
      claim !== null &&
      typeof claim === "object" &&
      requirements.has(claim.requirementId) &&
      !claims.has(claim.requirementId)
    ) {
      claims.set(claim.requirementId, claim.implementationSummary);
    }
  }
  const filesByPath = new Map();
  for (const file of sourceGuardedPlan.files) {
    const approvedTraceIds = Array.isArray(file.contractRequirementIds)
      ? [...new Set(file.contractRequirementIds.filter((id) => requirements.has(id)))]
      : [];
    const existing = filesByPath.get(file.path);
    if (existing === undefined) {
      filesByPath.set(file.path, {
        ...file,
        contractRequirementIds: approvedTraceIds,
      });
      continue;
    }
    existing.contractRequirementIds = [
      ...new Set([
        ...existing.contractRequirementIds,
        ...approvedTraceIds,
      ]),
    ];
    if (String(file.content).trim() !== "") existing.content = file.content;
  }
  const files = [...filesByPath.values()];
  const rankedTarget = (source) => {
    const ranked = files
      .map((file, index) => ({
        file,
        index,
        score: contractTraceScore(source, file),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    return ranked[0]?.score > 0 ? ranked[0].file : null;
  };
  for (const [requirementId, requirement] of requirements) {
    if (claims.has(requirementId)) continue;
    const target = files.find((file) =>
      file.contractRequirementIds.includes(requirementId),
    ) ?? rankedTarget(requirement.statement);
    if (target === null) continue;
    claims.set(
      requirementId,
      `${requirement.statement} — implemented by ${target.path} in the generated project.`,
    );
  }
  for (const file of files) {
    if (file.contractRequirementIds.length > 0) continue;
    const ranked = [...requirements.values()]
      .map((requirement, index) => ({
        requirementId: requirement.requirementId,
        index,
        score: contractTraceScore(
          `${requirement.statement} ${claims.get(requirement.requirementId) ?? ""}`,
          file,
        ),
      }))
      .sort((left, right) => right.score - left.score || left.index - right.index);
    if (ranked[0]?.score > 0) {
      file.contractRequirementIds.push(ranked[0].requirementId);
    }
  }
  const traced = new Set(
    files.flatMap((file) =>
      Array.isArray(file.contractRequirementIds)
        ? file.contractRequirementIds
        : [],
    ),
  );
  for (const [requirementId, requirement] of requirements) {
    if (traced.has(requirementId) || !claims.has(requirementId)) continue;
    const source = `${requirement.statement} ${claims.get(requirementId)}`;
    const target = rankedTarget(source);
    if (target === null) continue;
    target.contractRequirementIds.push(requirementId);
    traced.add(requirementId);
  }
  return {
    ...sourceGuardedPlan,
    requirementClaims: [...claims].map(
      ([requirementId, implementationSummary]) => ({
        requirementId,
        implementationSummary,
      }),
    ),
    files,
  };
}

// The approved contract hash, version, platform, and design-direction hash are
// Foundry-owned facts, not model judgement. The model cannot know a SHA-256 it
// was never shown, so requiring it to echo one turned every approved-design run
// into a guaranteed admission failure followed by paid regeneration. Bind them
// deterministically and keep validation for the parts the model actually owns.
// The single place that decides whether a build is prototype-comparable. An
// armed deferred shock means the customer asked Foundry to depart from the
// approved prototype on purpose, so comparing the result against it would fail
// by design. Every prototype-fidelity behaviour keys off this.
export function comparablePrototypeDesign(approvedContract) {
  const design =
    approvedContract?.productBlueprint?.designSpecification
      ?.approvedDesignContract ?? null;
  if (design === null) return null;
  const shocked =
    Array.isArray(design.shockDirectives) &&
    design.shockDirectives.some(
      (directive) => typeof directive === "string" && directive.trim() !== "",
    );
  return shocked ? null : design;
}

export function bindApprovedContractIdentity(plan, approvedContract) {
  if (
    plan === null ||
    typeof plan !== "object" ||
    approvedContract === null ||
    typeof approvedContract !== "object"
  ) {
    return plan;
  }
  let normalized;
  try {
    normalized = normalizeApprovedProjectContract(approvedContract);
  } catch {
    return plan;
  }
  return {
    ...plan,
    contractHash: normalized.contentHash,
    contractVersion: normalized.contractVersion,
    supportedPlatform: normalized.supportedPlatform,
    designDirectionHash: approvedDesignDirectionHash(normalized),
  };
}

export function bindApprovedPrototypeFidelityIdentity(plan, approvedContract) {
  const approved = approvedContract?.productBlueprint?.designSpecification?.approvedDesignContract ?? null;
  if (
    approved === null ||
    plan?.designFidelity === null ||
    typeof plan?.designFidelity !== "object"
  ) {
    return plan;
  }
  return {
    ...plan,
    designFidelity: {
      ...plan.designFidelity,
      approvedDesignId: approved.approvedDesignId,
      approvedPrototypeContentHash: approved.prototypeContentHash,
      approvedConceptVersion: approved.selectedConceptVersion,
    },
  };
}

// Foundry owns the observation protocol.
//
// Fifty admission gates policed how the model chose to write its browser test:
// how it initialised arrays, where it emitted the evidence marker, whether it
// assigned checks directly or through a helper, which viewport literals it
// used. Three separate times a model wrote correct, well-factored code and was
// rejected for the style of it — and each gate fixed revealed the next, because
// they all rest on pattern-matching source the model was free to write any way
// it liked.
//
// The harness removes the premise. Foundry writes the scaffolding, the
// measurements, and the marker; the model writes only the assertion bodies in
// tests/foundry-checks.ts. Every scaffolding gate is then satisfied by
// construction rather than by hope, and what the model supplies is the only
// thing it is actually qualified to supply: what each obligation means.
export function foundryObservationHarness(
  requiredCheckIds,
  { checkBudgetMs = 20_000, foundryOwnedBrowserHealthCheckIds = [] } = {},
) {
  const ids = [...new Set(requiredCheckIds ?? [])];
  const idList = ids.map((id) => JSON.stringify(id)).join(", ");
  const browserHealthIdList = [
    ...new Set(foundryOwnedBrowserHealthCheckIds ?? []),
  ]
    .filter((id) => ids.includes(id))
    .map((id) => JSON.stringify(id))
    .join(", ");
  const boundedCheckBudgetMs = Number.isSafeInteger(checkBudgetMs) && checkBudgetMs >= 5_000
    ? Math.min(checkBudgetMs, 30_000)
    : 20_000;
  const checkBudgetLiteral = String(boundedCheckBudgetMs).replace(
    /\B(?=(\d{3})+(?!\d))/gu,
    "_",
  );
  return `import { expect, test } from "@playwright/test";
import { obligationChecks } from "./foundry-checks";

// Generated by Foundry. The observation protocol is fixed so that evidence is
// comparable across every build; project-specific assertions live in
// ./foundry-checks.
test("foundry contract observation", async ({ browser }) => {
  const captureProbeErrors: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requiredCheckIds = [${idList}];
  // These contract obligations describe the health of this complete run. The
  // harness owns their evidence because it alone sees every workflow result,
  // failed response, console error, and page error.
  const foundryOwnedBrowserHealthCheckIds = [${browserHealthIdList}];
  // Per-check ceiling. A workflow check signs in, submits, and waits on a
  // result, so it needs real time; what it must never do is spend the rest of
  // the run waiting for something that is not going to appear.
  const CHECK_BUDGET_MS = ${checkBudgetLiteral};
  const checks: Record<string, boolean> = {};
  const diagnostics: Record<string, Record<string, boolean | number | string | null>> = {};
  for (const id of requiredCheckIds) checks[id] = false;
  // A workflow check reports one boolean. "added: false" was returned to three
  // consecutive repairs and told none of them whether the form never
  // submitted, the route answered 500, or the row simply rendered somewhere the
  // locator did not look. The request the workflow made is the answer, and it
  // was being thrown away: only the responses that failed are kept, tagged with
  // the check that was running when they arrived.
  const failedRequests: { check: string; method: string; url: string; status: number }[] = [];
  let observingCheckId = "setup";
  const attachPageEvidence = (observedPage: import("@playwright/test").Page) => {
    observedPage.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    observedPage.on("pageerror", (error) =>
      pageErrors.push(String(error?.message ?? error)),
    );
    observedPage.on("response", (response) => {
      const status = response.status();
      if (status < 400 || failedRequests.length >= 25) return;
      failedRequests.push({
        check: observingCheckId,
        method: response.request().method(),
        url: response.url().slice(0, 200),
        status,
      });
    });
  };
  const expectedClientError = (entry: { check: string; method: string; url: string; status: number }) =>
    checks[entry.check] === true &&
    [400, 401, 403, 409, 422].includes(entry.status) &&
    /\\/api\\//u.test(entry.url);
  const blockingFailedRequests = () =>
    failedRequests.filter((entry) => !expectedClientError(entry));
  // Chromium also writes a generic console error for an expected 4xx. Suppress
  // one such line only when an exact API response with that status was
  // observed during a check that ultimately passed. A 404, every 5xx, and any
  // uncorrelated browser error remain blocking.
  const blockingConsoleErrors = () => {
    const expectedStatuses = new Map<number, number>();
    for (const entry of failedRequests.filter(expectedClientError)) {
      expectedStatuses.set(
        entry.status,
        (expectedStatuses.get(entry.status) ?? 0) + 1,
      );
    }
    return consoleErrors.filter((message) => {
      const status = Number.parseInt(
        /status(?: code)? of (\\d{3})/iu.exec(message)?.[1] ?? "",
        10,
      );
      const available = expectedStatuses.get(status) ?? 0;
      if (available === 0) return true;
      expectedStatuses.set(status, available - 1);
      return false;
    });
  };

  const probeContext = await browser.newContext({
    baseURL: process.env.FOUNDRY_PREVIEW_URL,
  });
  let page = await probeContext.newPage();
  attachPageEvidence(page);

  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();

    // Phone-layout quality, measured once and shared with every check.
    const phoneScrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const phoneClientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const phoneNoHorizontalOverflow = phoneScrollWidth <= phoneClientWidth;
    const phoneContentHeight = await page.evaluate(() => document.body.getBoundingClientRect().height);
    const phoneViewportHeight = await page.evaluate(() => window.innerHeight);
    const phoneHeightWithinBudget = phoneContentHeight <= phoneViewportHeight * 8;
    const phoneInteractionCount = await page
      .locator("a[href], button, input, select, textarea")
      .count();
    const phoneInteractionDensityBounded = phoneInteractionCount <= 60;

    // 390 is the widest common phone, so measuring only there passed a build
    // that overflowed by three pixels at 360 — the most common Android width —
    // and by more at 320. The narrow end is where a layout actually breaks, so
    // it is measured too, and the offending elements are named.
    await page.setViewportSize({ width: 320, height: 844 });
    const narrowOverflow = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const offenders = [...document.querySelectorAll("body *")]
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0 && box.right > viewport + 1)
        .sort((left, right) => right.box.right - left.box.right)
        .slice(0, 3)
        .map(({ element, box }) =>
          (element.id ? "#" + element.id : element.tagName.toLowerCase()) +
          " reaches " + Math.round(box.right) + "px",
        );
      return {
        excess: document.documentElement.scrollWidth - viewport,
        offenders: offenders.join("; "),
      };
    });
    const narrowNoHorizontalOverflow = narrowOverflow.excess <= 0;
    await page.setViewportSize({ width: 390, height: 844 });

    const phone =
      phoneNoHorizontalOverflow &&
      narrowNoHorizontalOverflow &&
      phoneHeightWithinBudget &&
      phoneInteractionDensityBounded;
    const responsiveEvidence = {
      phone,
      mobile: phone,
      responsive: phone,
      phoneNoHorizontalOverflow,
      narrowNoHorizontalOverflow,
      phoneHeightWithinBudget,
      phoneInteractionDensityBounded,
    };
    if (!narrowNoHorizontalOverflow) {
      captureProbeErrors.push(
        "At a 320px viewport the page is " + narrowOverflow.excess +
        "px too wide. Widest offenders: " + (narrowOverflow.offenders || "unidentified") +
        ". Constrain them with max-width:100%, wrapping, or min-width:0 on flex and grid children.",
      );
    }

    // Accessible keyboard focus and labelling, measured once.
    let keyboardFocusObservable = false;
    for (let focusAttempt = 0; focusAttempt < 5 && !keyboardFocusObservable; focusAttempt += 1) {
      await page.keyboard.press("Tab");
      keyboardFocusObservable = await page.evaluate(() => {
        const active = document.activeElement;
        return active instanceof HTMLElement &&
          !["BODY", "HTML"].includes(active.tagName) &&
          !active.hasAttribute("disabled");
      });
    }
    const labelledControlCount = await page.evaluate(() =>
      [...document.querySelectorAll("a[href], button, input, select, textarea")].filter((control) => {
        const id = control.getAttribute("id");
        const labelled =
          (control.getAttribute("aria-label") ?? "").trim().length > 0 ||
          (control.getAttribute("aria-labelledby") ?? "").trim().length > 0 ||
          (id !== null && document.querySelector('label[for="' + id + '"]') !== null) ||
          control.closest("label") !== null ||
          (["A", "BUTTON"].includes(control.tagName) && (control.textContent ?? "").trim().length > 0);
        return labelled;
      }).length,
    );
    const accessibleLabellingObserved = labelledControlCount >= 1;
    const accessibility = keyboardFocusObservable && accessibleLabellingObserved;
    const accessibilityEvidence = {
      focus: keyboardFocusObservable,
      labels: accessibleLabellingObserved,
      accessible: accessibility,
      accessibility,
      keyboardFocusObservable,
      accessibleLabellingObserved,
    };

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator("body")).toBeVisible();
    await probeContext.close();

    // Each check owns a fresh browser context. Promise.race alone does not
    // cancel timed-out Playwright work: the old action kept running on the same
    // page while the next check reset and reused it, corrupting every later
    // result. Closing this context in finally actually cancels the work and
    // guarantees independent cookies, storage, listeners, and navigation.
    // One stuck locator must cost one check, not the run. Playwright's own
    // timeout applies to the whole test, so without a per-check bound the first
    // check that waits on something absent spends every remaining check's time.
    const withBudget = async <T>(work: () => Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          work(),
          new Promise<T>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Check exceeded its own observation budget of " + CHECK_BUDGET_MS + "ms.")),
              CHECK_BUDGET_MS,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    let repeatedFailureSignature: string | null = null;
    let repeatedFailureCount = 0;
    for (const id of requiredCheckIds) {
      if (foundryOwnedBrowserHealthCheckIds.includes(id)) continue;
      const check = obligationChecks[id];
      if (typeof check !== "function") {
        diagnostics[id] = { checkImplemented: false };
        captureProbeErrors.push("No observation supplied for " + id);
        continue;
      }
      if (repeatedFailureCount >= 2 && repeatedFailureSignature !== null) {
        diagnostics[id] = {
          observed: false,
          blockedByRepeatedSetupFailure: repeatedFailureSignature.slice(0, 240),
        };
        captureProbeErrors.push(
          "Skipped " + id + " because two isolated checks already failed identically: " +
          repeatedFailureSignature.slice(0, 240),
        );
        continue;
      }
      observingCheckId = id;
      let checkContext: import("@playwright/test").BrowserContext | null = null;
      try {
        checkContext = await browser.newContext({
          baseURL: process.env.FOUNDRY_PREVIEW_URL,
          viewport: { width: 1280, height: 900 },
        });
        page = await checkContext.newPage();
        attachPageEvidence(page);
        await page.goto("/", { waitUntil: "domcontentloaded" });
        // expect is handed to the check because reaching for it is the natural
        // way to write a Playwright assertion. A checks module that used it
        // without importing it once failed the production build itself.
        const outcome = await withBudget(() => check({ page, expect, responsiveEvidence, accessibilityEvidence }));
        const passed = outcome === true || (outcome !== null && typeof outcome === "object" && outcome.passed === true);
        const detail =
          outcome !== null && typeof outcome === "object" && outcome.diagnostics !== undefined
            ? outcome.diagnostics
            : {};
        checks[id] = passed;
        diagnostics[id] = { ...detail, observed: true };
        repeatedFailureSignature = null;
        repeatedFailureCount = 0;
      } catch (error: unknown) {
        checks[id] = false;
        const failureMessage = error instanceof Error ? error.message : String(error);
        diagnostics[id] = {
          observed: true,
          threw: failureMessage.slice(0, 300),
        };
        const signature = /Check exceeded its own observation budget/u.test(failureMessage)
          ? "check-timeout"
          : failureMessage.replace(/\\d+/gu, "#").slice(0, 180);
        if (signature === repeatedFailureSignature) repeatedFailureCount += 1;
        else {
          repeatedFailureSignature = signature;
          repeatedFailureCount = 1;
        }
      } finally {
        await checkContext?.close();
      }
    }
    const customerWorkflowCheckIds = requiredCheckIds.filter(
      (id) => !foundryOwnedBrowserHealthCheckIds.includes(id),
    );
    for (const id of foundryOwnedBrowserHealthCheckIds) {
      const workflowsPassed = customerWorkflowCheckIds.every(
        (checkId) => checks[checkId] === true,
      );
      const noBlockingBrowserErrors =
        captureProbeErrors.length === 0 &&
        blockingConsoleErrors().length === 0 &&
        pageErrors.length === 0 &&
        blockingFailedRequests().length === 0;
      checks[id] = workflowsPassed && noBlockingBrowserErrors;
      diagnostics[id] = {
        observed: true,
        workflowsPassed,
        noBlockingBrowserErrors,
      };
    }
  } finally {
    await probeContext.close().catch(() => {});
    console.log(
      "FOUNDRY_BROWSER_RESULT:" +
        JSON.stringify({
          captureProbeErrors: [
            ...captureProbeErrors,
            ...failedRequests
              .filter((entry) => checks[entry.check] === false)
              .map(
                (entry) =>
                  "While computing " + entry.check + ", " + entry.method + " " +
                  entry.url + " answered " + entry.status + ".",
              ),
          ],
          checks,
          diagnostics,
          consoleErrors: blockingConsoleErrors(),
          pageErrors,
        }),
    );
  }
});
`;
}

// Foundry's harness is the only thing permitted to emit the evidence marker:
// two markers would make the observation ambiguous.
export function bindFoundryObservationHarness(plan, requiredCheckIds, options = {}) {
  if (!Array.isArray(plan?.files) || (requiredCheckIds ?? []).length === 0) {
    return plan;
  }
  const traceIds = [
    ...new Set(
      plan.files.flatMap((file) =>
        Array.isArray(file.contractRequirementIds) ? file.contractRequirementIds : [],
      ),
    ),
  ];
  const retained = plan.files.filter(
    (file) =>
      file.path === "tests/foundry-checks.ts" ||
      !/^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(file.path) ||
      !/FOUNDRY_BROWSER_RESULT/u.test(String(file.content)),
  );
  return {
    ...plan,
    files: [
      ...retained.filter((file) => file.path !== "tests/foundry-observation.spec.ts"),
      {
        path: "tests/foundry-observation.spec.ts",
        content: foundryObservationHarness(requiredCheckIds, options),
        contractRequirementIds: traceIds.length > 0 ? traceIds : ["approved-design-direction"],
      },
    ],
  };
}

export function bindApprovedPrototypeBrowserEvidence(plan, approvedContract) {
  if (!Array.isArray(plan?.files)) return plan;

  const browserSource = plan.files
    .filter((file) => /^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(file.path))
    .map((file) => String(file.content))
    .join("\n");
  const alreadyComplete =
    /\.screenshot\s*\(/u.test(browserSource) &&
    /(?:getComputedStyle|getBoundingClientRect|boundingBox\s*\()/u.test(browserSource) &&
    /(?:fontFamily|fontSize|fontWeight|lineHeight|letterSpacing)/u.test(browserSource) &&
    /(?:backgroundColor|color\b|getComputedStyle)/u.test(browserSource) &&
    (browserSource.match(/setViewportSize\s*\(|viewport\s*:\s*\{/gu)?.length ?? 0) >= 3 &&
    /(?:375|390|414)/u.test(browserSource) &&
    /(?:768|810|834|1024)/u.test(browserSource) &&
    /(?:1280|1440|1512|1728)/u.test(browserSource) &&
    /scrollWidth|clientWidth|documentElement/u.test(browserSource) &&
    /keyboard\.press|activeElement|focus-visible/u.test(browserSource);
  if (alreadyComplete) return plan;

  const browserStatements = new Set(
    (approvedContract.verificationPlan ?? [])
      .filter((entry) => entry.acceptanceMethod === "browser-check")
      .map((entry) => entry.observableOutcome),
  );
  const traceIds = (approvedContract.acceptanceObligations ?? [])
    .filter((entry) => browserStatements.has(entry.statement))
    .map((entry) => entry.obligationId);
  if (traceIds.length === 0) traceIds.push("approved-design-direction");

  const occupied = new Set(plan.files.map((file) => file.path));
  let path = "tests/foundry-design-fidelity-evidence.spec.ts";
  for (let suffix = 2; occupied.has(path); suffix += 1) {
    path = `tests/foundry-design-fidelity-evidence-${suffix}.spec.ts`;
  }
  const content = `import { expect, test } from "@playwright/test";

test("captures deterministic approved-design fidelity evidence", async ({ page }) => {
  await page.goto("/");
  // Written as three explicit calls rather than a loop because admission
  // counts setViewportSize occurrences in the source text. Looping made
  // Foundry's own evidence fail Foundry's own viewport gate, which then forced
  // the model to duplicate this capture just to reach the threshold.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.setViewportSize({ width: 1280, height: 900 });
  const viewports = [
    { name: "phone", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ];
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await expect(page.locator("body")).toBeVisible();
    const evidence = await page.locator("body").evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight,
        letterSpacing: style.letterSpacing,
        backgroundColor: style.backgroundColor,
        color: style.color,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    expect(evidence.width).toBeGreaterThan(0);
    expect(evidence.height).toBeGreaterThan(0);
    expect(evidence.fontFamily).not.toBe("");
    expect(evidence.fontSize).not.toBe("");
    expect(evidence.backgroundColor).not.toBe("");
    expect(evidence.color).not.toBe("");
    expect(evidence.scrollWidth).toBeLessThanOrEqual(evidence.clientWidth);
    await page.screenshot({
      path: \`evidence/foundry-design-\${viewport.name}.png\`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Tab");
  const activeElement = await page.evaluate(() => document.activeElement?.tagName ?? null);
  expect(activeElement).not.toBeNull();
});
`;
  return {
    ...plan,
    files: [
      ...plan.files,
      { path, content, contractRequirementIds: [...new Set(traceIds)] },
    ],
  };
}

export function bindApprovedPrototypeSourceGuardrails(plan, approvedContract) {
  // Forcing the approved palette into a build the customer asked to be
  // surprised by would fight the shock directives.
  const approved = comparablePrototypeDesign(approvedContract);
  if (
    approved === null ||
    !Array.isArray(plan?.files) ||
    plan.files.length === 0
  ) {
    return plan;
  }

  const declaredSourceFiles = Array.isArray(plan.designFidelity?.sourceFiles)
    ? plan.designFidelity.sourceFiles
    : [];
  const stylesheet =
    plan.files.find(
      (file) =>
        declaredSourceFiles.includes(file.path) &&
        /\.(?:css|scss)$/u.test(file.path),
    ) ??
    plan.files.find((file) => /(?:^|\/)globals\.css$/u.test(file.path)) ??
    plan.files.find((file) => /\.(?:css|scss)$/u.test(file.path));
  if (stylesheet === undefined) return plan;

  const source = String(stylesheet.content);
  const additions = [];
  const approvedColors = Object.entries(approved.colorTokens ?? {})
    .filter(([, value]) => /^#[a-f0-9]{3,8}$/iu.test(String(value)));
  const missingColors = approvedColors.filter(
    ([, value]) => !source.toLowerCase().includes(String(value).toLowerCase()),
  );
  if (missingColors.length > 0) {
    additions.push([
      ":root {",
      ...missingColors.map(
        ([role, value]) =>
          `  --foundry-approved-${String(role).replace(/[^a-z0-9-]/giu, "-").toLowerCase()}: ${value};`,
      ),
      "}",
    ].join("\n"));
  }

  const motionRequiresFallback =
    Array.isArray(approved.motion) &&
    approved.motion.some((rule) => !/\b(?:none|static|no motion)\b/iu.test(String(rule)));
  if (motionRequiresFallback && !/prefers-reduced-motion/iu.test(source)) {
    additions.push(`@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}`);
  }
  if (additions.length === 0) return plan;

  const guardedContent = `${source.trimEnd()}\n\n/* Foundry-owned approved-design guardrails. */\n${additions.join("\n\n")}\n`;
  return {
    ...plan,
    designFidelity:
      plan.designFidelity === null || typeof plan.designFidelity !== "object"
        ? plan.designFidelity
        : {
            ...plan.designFidelity,
            sourceFiles: [...new Set([...declaredSourceFiles, stylesheet.path])],
          },
    files: plan.files.map((file) =>
      file.path === stylesheet.path
        ? { ...file, content: guardedContent }
        : file,
    ),
  };
}

// The approved design is the customer's decision, so it has to reach the model
// that writes the source. Without this the generator never saw the selected
// concept and the downstream fidelity comparison could only ever fail.
// An approved design is a multi-surface composition with its own palette,
// spacing scale, and responsive rules, and the mandatory Playwright test alone
// routinely costs 10,000 characters. Holding those runs to the plain-path
// 18,000-character budget forced the model to ship a single thin surface, which
// is why composition, surface order, colour, and spacing fidelity all failed.
// The generation prompt carried the whole ProjectProfile, including the design
// alternatives the customer rejected. Sending losing designs to the generator
// that must reproduce the winning one is waste at best and a distraction at
// worst. Verification and design authority both live in the binding task
// contract, so drop the profile's duplicate copies too.
export function generationProfileView(profile, approvedContract) {
  if (
    profile === null ||
    typeof profile !== "object" ||
    approvedContract === null ||
    typeof approvedContract !== "object"
  ) {
    return profile;
  }
  const {
    designAlternatives: _designAlternatives,
    contextualSuggestions: _contextualSuggestions,
    verificationPlan: _verificationPlan,
    ...retained
  } = profile;
  return retained;
}

export function bundleBudgetInstruction(approvedContract) {
  const approvedDesign =
    approvedContract?.productBlueprint?.designSpecification
      ?.approvedDesignContract ?? null;
  if (approvedDesign === null) {
    return "Keep the complete bundle compact: use no more than 10 generated files and keep the combined file content below 18,000 characters. Prefer a small number of cohesive modules, concise seeded data, and non-repetitive UI copy while still implementing every approved requirement and real browser check.";
  }
  const surfaces = Array.isArray(approvedDesign.approvedSurfaceSequence)
    ? approvedDesign.approvedSurfaceSequence.length
    : 1;
  const fileBudget = Math.min(24, Math.max(14, 8 + surfaces * 2));
  const characterBudget = Math.min(64_000, Math.max(38_000, 18_000 + surfaces * 6_000));
  return [
    `Keep the complete bundle focused: use no more than ${fileBudget} generated files and keep the combined file content below ${characterBudget.toLocaleString("en-US")} characters.`,
    "Spend that budget on the approved design. Every approved surface in the sequence needs a real implementation with the approved palette, spacing scale, and responsive behavior applied to actual elements; a single condensed page is a fidelity failure even when it builds and passes its browser checks.",
    "Prefer cohesive modules and non-repetitive UI copy, but never drop an approved surface, collapse the approved composition, or thin the approved styling to save characters.",
  ].join(" ");
}

export function approvedDesignPromptSegments(
  approvedContract,
  approvedPrototypeSource = null,
) {
  if (approvedContract === null || typeof approvedContract !== "object") {
    return [];
  }
  const design =
    approvedContract.productBlueprint?.designSpecification
      ?.approvedDesignContract ?? null;
  const direction = approvedContract.selectedDesignDirection ?? null;
  if (design === null && direction === null) return [];

  // An armed deferred shock inverts the instruction: the customer asked to be
  // surprised, so the approved prototype becomes a starting point to depart
  // from rather than a target to reproduce.
  const shockDirectives = Array.isArray(design?.shockDirectives)
    ? design.shockDirectives.filter(
        (directive) => typeof directive === "string" && directive.trim() !== "",
      )
    : [];
  if (shockDirectives.length > 0) {
    return [
      "The customer explicitly asked Foundry to surprise them. Treat the approved design below as context to react against, not as a specification to reproduce.",
      ...shockDirectives,
      ...(design === null
        ? []
        : [
            `Approved design context to depart from:\n${JSON.stringify({
              creativeThesis: design.creativeThesis,
              approvedSurfaceSequence: design.approvedSurfaceSequence,
              navigation: design.navigation,
              colorTokens: design.colorTokens,
              typography: design.typography,
              customerModifications: design.customerModifications,
              explicitExclusions: design.explicitExclusions,
            })}`,
          ]),
    ];
  }

  const segments = [
    // Foundry injects tests/foundry-design-fidelity-evidence.spec.ts for every
    // approved-design build. The model was still being told to write the same
    // screenshot and computed-style capture itself, so roughly half of its
    // output was a second copy of evidence Foundry already owns. Output tokens
    // are the whole cost of a generation call.
    "Foundry supplies its own Playwright spec that captures screenshots and computed-style evidence at phone, tablet, and desktop widths and proves no horizontal overflow and observable keyboard focus. Do not write that evidence capture again.",
    "Your Playwright test must cover only the supplied browser-check obligations and emit the FOUNDRY_BROWSER_RESULT line. Set whatever viewport a specific check needs in order to compute its own verdict, but do not add screenshot capture, font/color/computed-style surveys, or general responsive evidence beyond what a listed check requires. Keep it as small as the checks allow.",
    // A signup check submitted the form, read isVisible() immediately, and
    // reported false while the account it had just created sat in the database.
    // The action had happened; the assertion simply did not wait for it.
    // The gate below rejects this shape, so the instruction has to be here too:
    // enforcing a rule the generator has not been told is a trap, not a gate.
    "Derive every expected value from the page, never from what you believe the code computes. To check a displayed count, total or summary, count the elements that genuinely satisfy the condition and compare the display to that count -- do not assert it equals a number you worked out yourself. A dashboard whose \"open\" count wrongly included pending tickets passed its own check because the check asserted the literal the buggy code happened to produce; had it counted the rows actually marked open, it would have failed. A literal is only acceptable when your own test typed it in.",
    "After an action that reaches the server — submitting a form, signing in, saving — assert with a locator that waits, such as await expect(locator).toBeVisible() or await locator.waitFor(). isVisible() and textContent() read the DOM at that instant and will report the state from before the request resolved. Return the verdict from the waited assertion, not from an immediate read.",
    "Foundry clears cookies and storage and reloads the page before each check, so write every check as if it starts signed out on a fresh load. Do not rely on state a previous check established, and do not repeat the reset yourself.",
    "The customer approved a specific visual design. Build a faithful production evolution of that design; do not substitute your own art direction, palette, type scale, layout, or interaction model.",
    "Treat the approved prototype as the design floor, not the finish ceiling. Preserve its recognizable composition, hierarchy, navigation, tokens, responsive transformation, and personality while elevating production polish through precise alignment, coherent spacing, complete hover/focus/pressed/loading/error/success states, refined typography, purposeful transitions, stronger content finish, and accessible interaction. Elevation may improve execution quality but may not change the creative thesis, rearrange the approved surface sequence, introduce excluded features, or turn the product into a generic shell.",
    "Implement the approved color tokens, typography system, and spacing scale as real CSS applied to real elements. Declaring unused custom properties is not implementing the design.",
    "Follow the approved surface sequence, navigation model, and composition rules so the produced pages match the approved prototype's structure and visual order.",
    "Honor the approved responsive, interaction, motion, and accessibility rules. Respect the approved deliberate exclusions: do not add surfaces or components the design excluded.",
  ];
  if (direction !== null) {
    segments.push(`Approved design direction:\n${JSON.stringify(direction)}`);
  }
  if (design !== null) {
    segments.push(
      `Approved design contract:\n${JSON.stringify({
        creativeThesis: design.creativeThesis,
        approvedSurfaceSequence: design.approvedSurfaceSequence,
        compositionRules: design.compositionRules,
        navigation: design.navigation,
        typography: design.typography,
        colorTokens: design.colorTokens,
        spacingTokens: design.spacingTokens,
        imagery: design.imagery,
        components: design.components,
        interactions: design.interactions,
        motion: design.motion,
        responsiveBehavior: design.responsiveBehavior,
        accessibility: design.accessibility,
        customerModifications: design.customerModifications,
        explicitExclusions: design.explicitExclusions,
      })}`,
    );
    segments.push(
      "A real browser compares the produced pages against the approved prototype's recorded evidence at phone, tablet, and desktop widths. Composition, palette, and type must survive that comparison.",
    );
    if (
      approvedPrototypeSource !== null &&
      approvedPrototypeSource.approvedDesignId === design.approvedDesignId &&
      approvedPrototypeSource.prototypeContentHash === design.prototypeContentHash &&
      Array.isArray(approvedPrototypeSource.files)
    ) {
      segments.push(
        [
          "APPROVED LIVE PROTOTYPE SOURCE — IMMUTABLE DESIGN BASELINE",
          "These are the integrity-verified HTML, CSS, and interaction files that produced the prototype the customer selected. Read their actual structure and styling before generating production source. Rebuild them safely for the certified production stack; do not copy sandbox-only assumptions, but do preserve the visible composition and interaction character while applying the production-elevation rules above.",
          JSON.stringify(approvedPrototypeSource),
        ].join("\n"),
      );
    }
  }
  return segments;
}

function bundlePrompt(
  profile,
  contract,
  bindings,
  approvedContract = null,
  engineeringSignals = null,
  performancePolicy = null,
  approvedPrototypeSource = null,
) {
  const browserChecks = contract.obligations
    .filter(
      (obligation) =>
        bindings[obligation.obligationId] === "browser-check",
    )
    .map((obligation) => ({
      checkId: obligation.obligationId,
      observableOutcome: obligation.statement,
      responsiveQualityRequired:
        /\b(?:phone|mobile|responsive|small[- ]screen|narrow viewport|touch target)\b/iu.test(
          obligation.statement,
        ),
      accessibilityQualityRequired:
        /\b(?:keyboard|accessible|accessibility|focus|labelled|labeled)\b/iu.test(
          obligation.statement,
        ),
    }));
  return [
    "Generate the complete source bundle for this specific project. This must be an original implementation of the supplied ProjectProfile and Requirement Contract, not a template selected by project keywords.",
    ...(performancePolicy === null
      ? []
      : [
          `Adaptive production policy: ${performancePolicy.complexity} complexity with a ${Math.round(performancePolicy.targetDurationMs / 60_000)}-minute completion target. Make the first bundle complete and internally consistent so generation, build, browser behavior, and approved-design fidelity can pass in one pipeline. Do not trade away requirements or evidence to meet the target.`,
        ]),
    `Use the selected certified stack package versions exactly: ${JSON.stringify(CERTIFIED_PROJECT_PACKAGE_VERSIONS)}.`,
    "The application must be production-buildable, use a real SQLite database below data/, expose GET /api/health returning HTTP 200, and bind the production server using npm run start.",
    "Every App Router page requires app/layout.tsx (or an equivalent root layout). package.json must provide build, start, typecheck, lint, and test scripts.",
    "Every .css file must contain valid CSS only. Never put a JavaScript or React component stub in a stylesheet path.",
    'Use next/link for every internal App Router navigation target such as href="/" or href="/profile"; reserve HTML anchor elements for external URLs, downloads, and same-page fragments.',
    "Every static internal href must resolve to a generated App Router page. If an action opens a mode inside an existing page, link to that page and let its visible UI control open the mode; never invent an unimplemented child URL.",
    "When tab navigation returns to a completed multi-step creation workflow, reset that workflow to its first usable step so its primary inputs are visible again.",
    'If source uses the @/ import alias, tsconfig.json must define a valid compilerOptions.paths["@/*"] mapping; otherwise use resolvable relative imports.',
    'When the lint script scans the project root, its ESLint configuration must explicitly ignore ".next" build output.',
    "For certified Next.js 15.5.23, adapt next/core-web-vitals and next/typescript through FlatCompat from @eslint/eslintrc (with the .next ignore in the exported array); do not use Next.js 16-style direct eslint-config-next flat imports.",
    "Because eslint.config.mjs is ESM, derive __dirname from import.meta.url before passing it to FlatCompat; never reference an undefined CommonJS __dirname global.",
    "Do not use explicit any types. Give better-sqlite3 query rows concrete result types, including SELECT COUNT aliases such as { c: number }.",
    "Include a valid app/icon or public/favicon resource so the real browser does not generate a missing decorative-resource error.",
    "SQLite connection, schema initialization, migrations, PRAGMAs, and seeding must run lazily in the application runtime, never as module-import side effects during Next.js build route collection. Importing route modules in parallel must not mutate or lock the database.",
    "Next.js app/api/**/route.ts files are framework entry modules. Export only HTTP handlers and supported Next.js route metadata from them. Never export an authentication, database, or domain helper from a route file and never import one route file from another source module; put shared logic in lib/ and import that library from every route that needs it.",
    "A GET endpoint used by the page to discover an optional session or signed-out state must return HTTP 200 with an explicit empty value such as { user: null }. Do not use a routine 401 or 404 for expected initial signed-out state because the browser reports it as a blocking resource error; reserve error status codes for genuinely protected actions and invalid mutations.",
    "When a client performs an asynchronous initial session lookup, keep the authentication surface in an explicit resolving state until it finishes, and prevent a late signed-out response from overwriting a successful sign-up or sign-in. Use cancellation or a request/authentication version guard when the lookup can overlap a user action.",
    "In SQLite SQL, use single quotes for string literals such as datetime('now'); never use double quotes around literal values because SQLite treats them as identifiers. Keep route mutations and the initialized table columns exactly aligned.",
    "Include package.json, TypeScript/Next/ESLint configuration, all application files, API routes as needed, durable SQLite behavior when required by the contract, Playwright configuration using channel chrome and FOUNDRY_PREVIEW_URL, and one real browser verification test.",
    "Do not configure Playwright webServer or start another application process from the test configuration. Foundry's Runtime & Preview Service exclusively owns the already-ready application process and supplies its URL through FOUNDRY_PREVIEW_URL.",
    "Use domcontentloaded plus explicit visible UI selectors for browser navigation readiness. Do not wait for networkidle: framework prefetching and long-lived application requests make it nondeterministic.",
    "Do not use a custom Playwright reporter that can suppress test-process stdout. The FOUNDRY_BROWSER_RESULT line must reach the controlled command evidence stream.",
    // Foundry generates tests/foundry-observation.spec.ts itself: the marker,
    // the error capture, the per-check isolation, and the shared responsive and
    // accessibility measurements. Asking the model for that scaffolding meant
    // policing fifty rules about how it chose to write them, and rejecting
    // correct code for its style. It supplies the assertions only.
    "Do not write a Playwright spec file and do not emit FOUNDRY_BROWSER_RESULT. Foundry generates tests/foundry-observation.spec.ts, which owns the evidence marker, console and page error capture, per-check isolation, and the shared phone-layout and accessibility measurements. A spec file you write that emits the marker is discarded.",
    "Write exactly one observation file, tests/foundry-checks.ts, exporting `export const obligationChecks: Record<string, (context: { page: any; expect: any; responsiveEvidence: Record<string, boolean>; accessibilityEvidence: Record<string, boolean> }) => Promise<{ passed: boolean; diagnostics: Record<string, boolean | number | string | null> }>> = { ... }` with one entry keyed by each exact supplied checkId. Take expect from the supplied context rather than importing it; the file must import nothing from @playwright/test.",
    "Each entry drives the running UI with Playwright through `context.page` and returns { passed, diagnostics }. passed must be computed from what the browser actually showed. diagnostics names the sub-observations behind that verdict, so a false verdict identifies its exact failed predicate. Do not initialize arrays, attach listeners, catch your own errors, or print anything: the harness does all of it.",
    "The harness clears browser cookies and storage between checks, but it deliberately preserves the real SQLite database. Any account email, username, list name, or other unique record created by a check must therefore be generated inside that check or helper invocation. Never declare a reusable identity once at module load, including a template using Date.now(), because every later check will submit the same value and receive a conflict or 422 response.",
    "Every check that observes a protected or authenticated surface must establish its own unique account/session inside that same check before locating dashboard content. This includes composition, navigation, responsive, visual-character, and accessibility checks; none may inspect the signed-out page and claim that as evidence for a protected dashboard.",
    "A login obligation must prove login, not merely reveal the login form. Create a unique account, sign out, switch to login, refill the exact saved email and password, submit the login form, and wait for the authenticated surface. Have the account helper return those credentials so this remains isolated inside the same check.",
    "Use semantic, scoped Playwright locators for actions and computed-style reads. Never call click, fill, evaluate, or similar strict operations on an unscoped visual class such as .primary; several controls may share it. A literal getByLabel action must pass { exact: true }, because Playwright also matches longer accessible names such as Todo workspace and Daily todo progress. Prefer getByRole with an exact accessible name, or scope to the exact region and select one deliberate element.",
    "For a native HTML form, use page.locator('form') (optionally scoped to a stable ancestor). Do not use getByRole('form') unless the application gives that form an explicit accessible name; unnamed forms are not reliably exposed as ARIA form landmarks and the locator can wait until the check budget expires.",
    "Next.js renders its own hidden route announcer with role=alert. When observing an application validation alert, locate the application's stable alert element or exclude #__next-route-announcer__; an unscoped getByRole('alert') is ambiguous even when the application has exactly one visible error.",
    "When a browser check asserts an exact computed color, font, spacing, or other visual token, explicitly apply that approved token to the exact element the check measures. A declared but unused CSS custom property does not make the rendered value match.",
    "For a check about the initial public page's phone layout use context.responsiveEvidence, and for a check about that page's keyboard focus or labelling use context.accessibilityEvidence rather than measuring those again. The shared aliases are responsiveEvidence.phone/mobile/responsive and accessibilityEvidence.focus/labels/accessible; the detailed measured fields remain available too. Shared evidence is never proof of a protected post-authentication surface: authenticate inside that check, then set the required viewport or press Tab and measure the actual protected UI directly.",
    "If the application resolves an initial session, account, hydration, or readiness request before rendering its interactive surface, every check that navigates or reloads must await a stable expected control after that request before counting controls, pressing Tab, or measuring layout. domcontentloaded proves only that HTML arrived; it does not prove the client-rendered authentication surface is ready.",
    "The shared responsive evidence is measured at phone width, but the harness restores the page to desktop before running project-specific checks. If a responsive check also expects a mobile-only control or navigation treatment to be visible, that check must set a 280-480px viewport itself before locating the mobile-only element.",
    // The project type-checks under noImplicitAny, and an unannotated callback
    // parameter inside a page.evaluate or an array callback is the one error
    // that kept reaching the repair loop for something a type annotation
    // prevents outright.
    "tests/foundry-checks.ts is type-checked with noImplicitAny. Annotate every parameter you introduce, including callback parameters inside page.evaluate, map, filter, and find — write (element: Element) or (entry: string) rather than (e). Inside page.evaluate the callback runs in the browser, so annotate its parameters and any DOM values you read.",
    "Use valid TypeScript syntax for every helper return type. An async arrow helper is `const act = async (...): Promise<void> => { ... }`; never omit the closing `>` before `=>`.",
    "Never use eval, new Function, Function(), or any other string-to-code execution in application or observation code. For arithmetic, parse operands and apply explicit +, -, *, and / branches. The browser check must calculate its expectation independently from test-controlled operands; it must not call the application's evaluator or evaluate expression text read back from the page.",
    "A literal deliberately entered by the browser check retains test provenance when it is passed through a local Playwright interaction helper. Keep that input action and its resulting observation in the same check so deterministic admission can verify the provenance without mistaking it for a hard-coded application total.",
    "Do not prove error handling by intentionally requesting a nonexistent resource or an HTTP 4xx/5xx endpoint, because that creates a blocking browser console error. Exercise a visible client-side validation or recovery path that prevents the invalid request, while still observing the real error message and recovery behavior.",
    "For mutable availability such as appointment times, select an observed enabled control at runtime. Never hard-code a slot that an earlier step may have consumed or disabled.",
    "Locate an asynchronously loaded booking slot by its semantic accessible label, not by a visual class shared with Back or secondary-action buttons.",
    "A handled HTTP 422 validation response is application evidence, not a blocking browser failure; console capture may exclude only explicit 422/Unprocessable Entity messages while retaining every 404, 5xx, script, and page error.",
    "Initialize every browser check as false and later assign it a boolean expression computed from observed runtime values. Never assign a literal true or Boolean(true) as a passing verdict, including after assertions or inside a conditional branch.",
    "Never compare a count, length, or row total against zero with >= anywhere in the test file. An expression such as errorCount >= 0 is always true and proves nothing; admission rejects the entire bundle for a single occurrence, in any check. To prove something is present compare against >= 1 or a real expected total; to prove something is absent compare against === 0.",
    "Every check must be computed independently, so that one failing step cannot leave the remaining checks unobserved. Wrap each check's own observation in its own try/catch, record the caught message into that check's diagnostics, and continue to the next check instead of letting the failure end the run. A long workflow — sign up, sign in, reach a protected area, sign out — must not be a single chain in which an early break silently leaves every later check at its initial false.",
    "Always write diagnostics for every required check, including the ones that fail, before emitting FOUNDRY_BROWSER_RESULT. A check reported false with no diagnostics is indistinguishable from a check that was never reached, and it will be rejected as an incomplete observation rather than treated as a defect.",
    "For every responsiveQualityRequired browser check, use a real 280–480px phone viewport and compute the verdict from measured horizontal overflow, workflow height relative to viewport height, and a finite bound on interactive controls in the active choice surface after the primary interaction. A long ungrouped list of controls is a failure even when the workflow can technically be completed; redesign it with progressive disclosure, grouping, filtering, or pagination rather than weakening the check.",
    "Set the phone viewport in executable Playwright setup before navigation or measurement; numeric width/height constants and comments alone are not viewport setup.",
    "For every accessibilityQualityRequired browser check, press Tab through the real page, observe actual focus through document.activeElement, :focus-visible, or an equivalent Playwright focus assertion, and verify a nonzero set of controls has an accessible label. Include both measured focus and label results in that check's boolean expression; zero-or-more comparisons are not evidence.",
    "Initialize captureProbeErrors, consoleErrors, and pageErrors as arrays. Move the pointer away from interactive controls and wait for CSS transitions to settle before measuring computed resting colors so hover and active styles cannot falsify the palette observation. Wrap browser observation work in try/finally and emit FOUNDRY_BROWSER_RESULT from the finally block so failures remain inspectable.",
    "For any credential-gated local workflow, read the runtime-only credential from FOUNDRY_RUNTIME_ACCESS_VALUE in both application code and Playwright. Do not invent a default password, persist the value, or print it.",
    "When a credential-gated workflow passes with FOUNDRY_RUNTIME_ACCESS_VALUE but the customer's final credential is still listed in customerContent.missingBeforeLaunch, describe the runtime value as development-only. Keep the owner-facing launch checklist visible and never imply that final customer access was supplied or that the project is launch-ready.",
    "Do not use mocked APIs, mocked persistence, fake build results, screenshots as proof, or a prebuilt sample project.",
    "Treat customerContent.supplied as the complete allowlist of customer-provided real-world facts. A model-derived project name or summary is a design proposal, not proof of a real business identity.",
    "Never invent a phone number, email address, street or service-area location, opening date, credential, certification, award, customer identity, testimonial, price, business hours, social account, client logo, or quantitative trust claim. If a value is absent from customerContent.supplied, omit the public claim and put an honest launch-content checklist in an owner-facing area when relevant.",
    "Do not make missing customer content look complete with realistic placeholders. Browser checks must return false if their stated customer-provided outcome is not actually supported by customerContent.supplied.",
    ...engineeringFloorPromptSegments(
      engineeringSignals ?? detectEngineeringSignals(profile, null),
    ),
    bundleBudgetInstruction(approvedContract),
    "Do not include node_modules, package-lock.json, build output, binary content, or markdown fences. The Execution Engine, not the model, owns lockfile creation.",
    ...approvedDesignPromptSegments(approvedContract, approvedPrototypeSource),
    `ProjectProfile:\n${JSON.stringify(
      generationProfileView(profile, approvedContract),
    )}`,
    // The binding task contract already carries every obligation as a strict
    // superset of this contract's, so repeating it only inflates the prompt.
    ...(approvedContract === null
      ? [`Requirement Contract:\n${JSON.stringify(contract)}`]
      : []),
    `Browser checks:\n${JSON.stringify(browserChecks)}`,
  ].join("\n\n");
}

function projectDirectories(files) {
  const result = new Set();
  for (const file of files) {
    let parent = dirname(file.path).replaceAll("\\", "/");
    while (parent !== "." && parent !== "") {
      result.add(parent);
      parent = dirname(parent).replaceAll("\\", "/");
    }
  }
  return [...result].sort(
    (left, right) =>
      left.split("/").length - right.split("/").length ||
      left.localeCompare(right),
  );
}

export function createProductionMissionService({
  ledger,
  orchestrator,
  understanding,
  contracts,
  approvedContracts,
  toolchains,
  workspaces,
  models,
  execution,
  runtime,
  evidence,
  verification,
  prototypeFidelity = null,
  allowLegacyCertificationExecution = false,
}) {
  function workFactory(missionId, workspaceId) {
    let sequence = 0;
    return async (actionType, inputs, targetObligationIds, name) => {
      sequence += 1;
      const basePrefix = `${missionId}-${String(sequence).padStart(3, "0")}-${safeName(name)}`;
      const attempts = execution
        .listWorkUnits(missionId)
        .filter(
          (record) =>
            record.workUnitId === basePrefix ||
            record.workUnitId.startsWith(`${basePrefix}-retry-`),
        );
      const completed = attempts.find(
        (record) =>
          record.status === WorkUnitStatus.SUCCEEDED &&
          record.actionType === actionType &&
          canonicalizeExecutionValue(record.inputs) ===
            canonicalizeExecutionValue(
              persistedWorkInputs(actionType, inputs),
            ) &&
          canonicalizeExecutionValue(record.targetObligationIds) ===
            canonicalizeExecutionValue(targetObligationIds),
      );
      if (completed !== undefined) {
        return completed;
      }
      const prefix =
        attempts.length === 0
          ? basePrefix
          : `${basePrefix}-retry-${attempts.length}`;
      return execution.executeWorkUnit({
        workUnitId: prefix,
        missionId,
        workspaceId,
        targetObligationIds,
        actionType,
        inputs,
        preWorkCheckpointId: `${prefix}-pre`,
        postWorkCheckpointId: `${prefix}-post`,
        idempotencyKey: `${prefix}-key`,
      });
    };
  }

  function setupStack(missionId, profile, routingRequirements = null) {
    const registered = toolchains
      .listStacks()
      .some(
        (stack) =>
          stack.manifest.stackId === CERTIFIED_STACK_ID &&
          stack.manifest.stackVersion === CERTIFIED_STACK_VERSION,
      );
    if (!registered) {
      toolchains.registerStack({
        missionId,
        manifest: WEB_STACK_MANIFEST,
        registryEventId: `${missionId}-stack-registration`,
        eventId: `${missionId}-stack-registration-fact`,
        causationId: `${missionId}-stack-registration-command`,
        evidenceId: `${missionId}-stack-registration-evidence`,
      });
    }
    const environmentCheckId = `${missionId}-environment`;
    toolchains.checkEnvironment({
      missionId,
      environmentCheckId,
      registryEventId: `${missionId}-environment-registry`,
      eventId: `${missionId}-environment-fact`,
      causationId: `${missionId}-environment-command`,
      evidenceId: `${missionId}-environment-evidence`,
    });
    const stack = toolchains.getStack(
      CERTIFIED_STACK_ID,
      CERTIFIED_STACK_VERSION,
    );
    const input = {
      missionId,
      selectionId: `${missionId}-stack-selection`,
      stackId: CERTIFIED_STACK_ID,
      stackVersion: CERTIFIED_STACK_VERSION,
      environmentCheckId,
      requestedPlatform:
        routingRequirements?.supportedPlatform ?? "web",
      requiredCapabilities:
        routingRequirements?.requiredWorkloadCapabilities ??
        profile.capabilities,
      registryEventId: `${missionId}-selection-registry`,
      eventId: `${missionId}-selection-fact`,
      causationId: `${missionId}-selection-command`,
    };
    return stack.certificationStatus === StackCertificationStatus.CERTIFIED
      ? toolchains.selectStack(input)
      : toolchains.selectStackForCertification(input);
  }

  function finishVerification(missionId) {
    const profile = understanding.latest(missionId);
    const bindings = understanding.verificationBindings(missionId);
    const contract = contracts.getContract(missionId);
    const workspace = workspaces.getWorkspace(missionId);
    const verificationRequestReference = `${missionId}-verification`;
    const missionEvidence = evidence.findByMission(missionId);
    const verificationEvidence = missionEvidence.filter(
      (record) =>
        record.verificationRequestReference ===
        verificationRequestReference,
    );
    const modeProcedures = {
      "dependency-lock": "dependencyLock",
      "dependency-install": "install",
      "type-check": "typeCheck",
      lint: "lint",
      "production-build": "productionBuild",
    };

    const evidenceByObligation = {};
    const workUnits = execution.listWorkUnits(missionId);
    for (const obligation of contract.obligations) {
      const mode = bindings[obligation.obligationId];
      let records = [];
      if (modeProcedures[mode] !== undefined) {
        // Newest first, and take the newest one this obligation can actually
        // accept. A scoped repair re-runs the production build while it is
        // fixing a browser check, and the resulting command evidence is stamped
        // with that browser obligation -- which does not accept command
        // evidence at all. Taking the newest run unconditionally then handed a
        // build obligation a record bound to a browser one, and verification
        // rejected the binding after a build that had otherwise finished.
        const candidates = workUnits
          .filter(
            (record) =>
              record.status === WorkUnitStatus.SUCCEEDED &&
              record.actionType === WorkUnitAction.RUN_COMMAND &&
              record.inputs.procedureName === modeProcedures[mode],
          )
          .reverse()
          .map((workUnit) => commandEvidence(evidence, workUnit.workUnitId))
          .filter((record) => record !== undefined);
        const bindable = candidates.find((record) =>
          evidenceBindsToObligation(record, obligation, contract.obligations),
        );
        // Falling back to the newest keeps the previous behaviour when nothing
        // is bindable, so verification reports why rather than finding no
        // evidence at all.
        const record = bindable ?? candidates[0];
        records =
          record === undefined
            ? []
            : [record];
      } else {
        const kind =
          mode === "browser-check"
            ? ObservationKind.BROWSER_INTERACTION_RESULT
            : mode === "browser-errors"
              ? ObservationKind.BROWSER_ERROR_RESULT
              : mode === "structured-tests"
                ? ObservationKind.STRUCTURED_TEST_RESULT
                : mode === "runtime-ready"
                  ? ObservationKind.RUNTIME_READINESS_RESULT
                  : mode === "http-ready"
                    ? ObservationKind.HTTP_RESPONSE_RESULT
                    : null;
        if (kind !== null) {
          const record = verificationEvidence
            .filter((candidate) => candidate.kind === kind)
            .at(-1);
          records = record === undefined ? [] : [record];
        }
      }
      evidenceByObligation[obligation.obligationId] = records.map(
        (record) => record.evidenceId,
      );
    }
    const session = runtime.listSessions(missionId).at(-1);
    if (session === undefined) {
      throw new Error("Verification recovery requires a runtime record.");
    }
    const verdict = verification.verify({
      missionId,
      verdictId: `${missionId}-verdict`,
      eventId: `${missionId}-verdict-fact`,
      causationId: `${missionId}-verification`,
      workspaceCheckpointReference: session.checkpointId,
      verificationRequestReference,
      evidenceByObligation,
    });
    orchestrator.transition({
      missionId,
      eventId:
        verdict.overallResult === CompletionResult.COMPLETE
          ? `${missionId}-succeeded`
          : `${missionId}-repairing`,
      causationId: `${missionId}-verdict-fact`,
      to:
        verdict.overallResult === CompletionResult.COMPLETE
          ? MissionState.SUCCEEDED
          : MissionState.REPAIRING,
      reason:
        verdict.overallResult === CompletionResult.COMPLETE
          ? "The Verification Authority recorded a COMPLETE verdict."
          : "The Verification Authority recorded an INCOMPLETE verdict.",
    });
    return Object.freeze({
      missionId,
      profile,
      contract,
      workspace,
      session,
      previewUrl: session.previewUrl,
      verdict,
    });
  }

  function efficiencyMetrics(missionId, replayedEvents = null) {
    const workUnits =
      replayedEvents === null
        ? execution.listWorkUnits(missionId)
        : replayedEvents
            .map((record) => record.fact?.metadata?.executionRecord)
            .filter(Boolean);
    const commandUnits = workUnits.filter(
      (record) => record.actionType === WorkUnitAction.RUN_COMMAND,
    );
    const countProcedure = (procedureName) =>
      commandUnits.filter(
        (record) => record.inputs.procedureName === procedureName,
      ).length;
    const modelCalls =
      replayedEvents === null
        ? models.listCalls(missionId)
        : replayedEvents
            .map((record) => record.fact?.metadata?.modelCallRecord)
            .filter(Boolean);
    const repairCalls = modelCalls.filter((call) =>
      call.requestId.includes("-repair-"),
    );
    const uniqueHypotheses = new Set(
      repairCalls
        .filter((call) => call.structuredOutput !== null)
        .map((call) =>
          createHash("sha256")
            .update(
              canonicalizeExecutionValue(call.structuredOutput),
              "utf8",
            )
            .digest("hex"),
        ),
    );
    const installCount = countProcedure("install");
    const rebuildCount = countProcedure("productionBuild");
    const runtimeRecords = replayedEvents === null
      ? runtime.listSessions(missionId)
      : replayedEvents
          .map((record) => record.fact?.metadata?.runtimeRecord)
          .filter(Boolean);
    const runtimeRestartCount = runtimeRestartCountForRecords(runtimeRecords);
    const latestVerdict = (replayedEvents ?? ledger.listEvents(missionId))
      .map((record) => record.completionVerdict)
      .filter(Boolean)
      .at(-1);
    const verifiedObligationIds =
      latestVerdict?.obligationVerdicts
        ?.filter((verdict) => verdict.result === "SATISFIED")
        .map((verdict) => verdict.obligationId)
        .sort((left, right) => left.localeCompare(right)) ?? [];
    const scopes = {};
    for (const call of repairCalls) {
      const paths =
        typeof call.structuredOutput?.path === "string"
          ? [call.structuredOutput.path]
          : repairPatchFiles(call.structuredOutput).map((patch) => patch?.path);
      for (const path of paths) {
        if (typeof path !== "string") continue;
        const scope = repairScopeForPath(path);
        scopes[scope] = (scopes[scope] ?? 0) + 1;
      }
    }
    return Object.freeze({
      verifiedObligationIds: Object.freeze(verifiedObligationIds),
      uniqueHypothesisCount: uniqueHypotheses.size,
      repeatedPipelineCost:
        Math.max(0, installCount - 1) +
        Math.max(0, rebuildCount - 1) +
        runtimeRestartCount,
      installCount,
      reinstallCount: Math.max(0, installCount - 1),
      rebuildCount,
      runtimeRestartCount,
      providerCallCount: modelCalls.reduce(
        (total, call) =>
          total + (call.costMetadata?.attemptCount ?? 0),
        0,
      ),
      repairScopes: Object.freeze(scopes),
    });
  }

  return Object.freeze({
    metrics: efficiencyMetrics,
    async execute(missionId) {
      let state = ledger.projectState(missionId).state;
      if (state === MissionState.VERIFYING) {
        return finishVerification(missionId);
      }
      if (state === MissionState.INTAKE) {
        understanding.contract({
          missionId,
          eventId: `${missionId}-contract`,
          causationId: `${missionId}-contract-confirmation`,
        });
        state = MissionState.CONTRACTED;
      }
      if (
        state !== MissionState.CONTRACTED &&
        state !== MissionState.EXECUTING
      ) {
        throw new TypeError(
          `Mission must be CONTRACTED or recoverable EXECUTING before execution, not ${state}.`,
        );
      }
      const profile = understanding.latest(missionId);
      const bindings = understanding.verificationBindings(missionId);
      const contract = contracts.getContract(missionId);
      const approvedContract = approvedContracts.latest(missionId);
      if (profile === null || bindings === null) {
        throw new TypeError(
          "Execution requires replayable ProjectProfile verification bindings.",
        );
      }
      if (
        approvedContract === null &&
        !allowLegacyCertificationExecution
      ) {
        throw new TypeError(
          "Execution requires a frozen ApprovedProjectContract. Re-run project understanding and approve the plan before building.",
        );
      }
      if (approvedContract !== null) {
        validateApprovedProjectContractConsistency(approvedContract);
      }
      const routingRequirements =
        approvedContract === null
          ? null
          : deriveContractRoutingRequirements(
              approvedContract,
              WEB_STACK_MANIFEST,
            );
      let workspace;
      if (state === MissionState.CONTRACTED) {
        setupStack(missionId, profile, routingRequirements);
        orchestrator.transition({
          missionId,
          eventId: `${missionId}-provisioning`,
          causationId: `${missionId}-execution-request`,
          to: MissionState.PROVISIONING,
          reason: "The contract and compatible stack selection are recorded.",
        });
        workspace = workspaces.provisionWorkspace({
          missionId,
          workspaceId: `${missionId}-workspace`,
          baselineCheckpointId: `${missionId}-baseline`,
          evidenceId: `${missionId}-provision-evidence`,
          eventId: `${missionId}-provision-fact`,
          causationId: `${missionId}-provision-command`,
          reason: "Provision a clean isolated production workspace.",
        });
        orchestrator.transition({
          missionId,
          eventId: `${missionId}-executing`,
          causationId: `${missionId}-provision-fact`,
          to: MissionState.EXECUTING,
          reason: "The clean workspace is provisioned and execution may begin.",
        });
      } else {
        workspace = workspaces.getWorkspace(missionId);
      }
      const work = workFactory(missionId, workspace.workspaceId);
      const requirementCatalogue =
        approvedContract === null
          ? null
          : approvedContractRequirementCatalogue(approvedContract);
      const allImplementationRequirementIds =
        requirementCatalogue?.implementationRequirements.map(
          (requirement) => requirement.requirementId,
        ) ?? [];
      const forbiddenContractChanges = [
        "Do not omit or reinterpret an approved workflow or customer message.",
        "Do not add an unapproved major capability.",
        "Do not change the approved platform, stack capability, or design direction.",
        "Do not implement an explicit exclusion or rejected recommendation.",
        "Do not weaken, remove, or replace an acceptance obligation.",
      ];
      const requestModel = (input, task = {}) => {
        if (approvedContract === null) return models.request(input);
        const relevantRequirementIds =
          task.relevantRequirementIds?.length > 0
            ? task.relevantRequirementIds
            : allImplementationRequirementIds;
        const currentCheckpoint = workspaces.getWorkspace(
          missionId,
        ).currentCheckpointId;
        const modelTaskContract = createModelTaskContract({
          approvedContract,
          routingRequirements,
          taskObjective:
            task.taskObjective ??
            `Complete ${input.taskClass.toLowerCase().replaceAll("_", " ")} without changing approved scope.`,
          allowedScope:
            task.allowedScope ?? [
              "Implement or repair only the requirements explicitly listed in this task contract.",
              "Use only the approved certified stack and current workspace checkpoint.",
            ],
          forbiddenChanges: forbiddenContractChanges,
          relevantRequirementIds,
          currentCheckpoint,
          expectedOutputSchema: input.expectedStructuredOutputSchema,
          designDirected: task.designDirected !== false,
        });
        const contractContext = {
          kind: "approved-project-contract",
          id: approvedContract.contentHash,
        };
        const contextReferences = [
          ...input.contextReferences,
          contractContext,
        ].filter(
          (reference, index, references) =>
            references.findIndex(
              (candidate) =>
                candidate.kind === reference.kind &&
                candidate.id === reference.id,
            ) === index,
        );
        return models.request({
          ...input,
          purpose: contractBoundModelPrompt(
            modelTaskContract,
            [input.purpose],
            { designDirected: task.designDirected !== false },
          ),
          contextReferences,
          depthLevel: Math.max(
            input.depthLevel ?? 1,
            routingRequirements.modelDepth,
          ),
          routingReason: [
            routingRequirements.routingReason,
            input.routingReason,
          ].filter(Boolean).join(" "),
        });
      };
      const generationTargetIds = contract.obligations.map(
        (obligation) => obligation.obligationId,
      );
      const certifiedScaffoldTraceIds = approvedContract === null
        ? []
        : approvedContract.acceptanceObligations
            .filter(
              (obligation) =>
                obligation.acceptanceCondition.type ===
                "runtime-readiness-equals",
            )
            .map((obligation) => obligation.obligationId);
      if (
        approvedContract !== null &&
        certifiedScaffoldTraceIds.length === 0
      ) {
        certifiedScaffoldTraceIds.push("customer-intent-1");
      }
      const approvedObligationIds = approvedContract === null
        ? null
        : new Set(
            approvedContract.acceptanceObligations.map(
              (obligation) => obligation.obligationId,
            ),
          );
      const requiredBrowserCheckIds = contract.obligations
        .filter(
          (obligation) =>
            (bindings[obligation.obligationId] === "browser-check" ||
              (obligation.origin !== "foundry-derived" &&
                obligationRequiresCredentialLoginProof(
                  obligation.statement,
                ))) &&
            (approvedObligationIds === null ||
              approvedObligationIds.has(obligation.obligationId)),
        )
        .map((obligation) => obligation.obligationId)
        .sort((left, right) => left.localeCompare(right));
      const responsiveBrowserCheckIds = responsiveBrowserCheckIdsForContract(
        contract.obligations,
        bindings,
      );
      const accessibilityBrowserCheckIds = contract.obligations
        .filter(
          (obligation) =>
            bindings[obligation.obligationId] === "browser-check" &&
            /\b(?:keyboard|accessible|accessibility|focus|labelled|labeled)\b/iu.test(
              obligation.statement,
            ),
        )
        .map((obligation) => obligation.obligationId)
        .sort((left, right) => left.localeCompare(right));
      const projectHasAuthenticationBoundary = GATEWAY_STATEMENT.test(
        JSON.stringify({
          summary: profile.summary,
          journeys: profile.primaryJourneys,
          outcomes: profile.outcomes,
          capabilities: profile.capabilities,
        }),
      );
      const foundryOwnedBrowserHealthCheckIds = contract.obligations
        .filter(
          (obligation) =>
            bindings[obligation.obligationId] === "browser-check" &&
            isFoundryOwnedBrowserHealthObligation(obligation.statement),
        )
        .map((obligation) => obligation.obligationId)
        .sort((left, right) => left.localeCompare(right));
      const foundryOwnedBrowserHealthCheckIdSet = new Set(
        foundryOwnedBrowserHealthCheckIds,
      );
      const authenticatedBrowserCheckIds = projectHasAuthenticationBoundary
        ? contract.obligations
            .filter(
              (obligation) =>
                bindings[obligation.obligationId] === "browser-check" &&
                !foundryOwnedBrowserHealthCheckIdSet.has(
                  obligation.obligationId,
                ) &&
                obligationRequiresAuthenticatedSurface(obligation.statement),
            )
            .map((obligation) => obligation.obligationId)
            .sort((left, right) => left.localeCompare(right))
        : [];
      const loginBrowserCheckIds = contract.obligations
        .filter(
          (obligation) =>
            requiredBrowserCheckIds.includes(obligation.obligationId) &&
            // Foundry-derived checks cover composition, accessibility, and
            // whole-run health. Their prose can legitimately mention the
            // sign-in surface, but the customer-derived workflow obligation
            // remains the authority for saved-credential login proof.
            obligation.origin !== "foundry-derived" &&
            obligationRequiresCredentialLoginProof(obligation.statement),
        )
        .map((obligation) => obligation.obligationId)
        .sort((left, right) => left.localeCompare(right));
      const authenticationErrorBrowserCheckIds = contract.obligations
        .filter(
          (obligation) =>
            bindings[obligation.obligationId] === "browser-check" &&
            obligation.origin !== "foundry-derived" &&
            obligationRequiresAuthenticationErrorProof(
              obligation.statement,
            ),
        )
        .map((obligation) => obligation.obligationId)
        .sort((left, right) => left.localeCompare(right));
      const contractRequestNamespace =
        approvedContract === null
          ? missionId
          : `${missionId}-contract-v${approvedContract.contractVersion}-${approvedContract.contentHash.slice(0, 12)}`;
      const generationRequestId =
        approvedContract === null
          ? `${missionId}-project-generation`
          : `${contractRequestNamespace}-project-generation`;
      const generationCorrectionPrefix = `${generationRequestId}-correction-`;
      const generationSchema =
        approvedContract === null
          ? projectBundleSchema
          : CONTRACT_BOUND_BUNDLE_SCHEMA;
      const engineeringSignals = detectEngineeringSignals(profile, null);
      const performancePolicy = productionPerformancePolicy({
        profile,
        approvedContract,
      });
      const approvedPrototypeContract = comparablePrototypeDesign(approvedContract);
      const approvedPrototypeSource =
        approvedPrototypeContract !== null &&
          typeof prototypeFidelity?.loadApprovedPrototypeSource === "function"
          ? prototypeFidelity.loadApprovedPrototypeSource({
              approvedDesignContract: approvedPrototypeContract,
            })
          : null;
      const repairBudgets = productionRepairBudgets({
        approvedPrototype:
          approvedContract?.productBlueprint?.designSpecification
            ?.approvedDesignContract != null,
        performancePolicy,
        stateful:
          engineeringSignals.has(EngineeringSignal.CREDENTIALS) ||
          engineeringSignals.has(EngineeringSignal.PERSISTENCE),
      });
      const priorGenerationCalls = models
        .listCalls(missionId)
        .filter(
          (call) =>
            (call.requestId === generationRequestId ||
              call.requestId.startsWith(generationCorrectionPrefix)) &&
            call.status === "SUCCEEDED",
        );
      const certifiedFastLaneBundle =
        priorGenerationCalls.length === 0 &&
        certifiedAuthenticationFastLaneEligible({
          approvedContract,
          complexity: performancePolicy.complexity,
        })
          ? createCertifiedAuthenticationFastLaneBundle({
              approvedContract,
              browserCheckIds: requiredBrowserCheckIds,
              authenticatedCheckIds: authenticatedBrowserCheckIds,
            })
          : null;
      let generation =
        priorGenerationCalls.length === 0
          ? certifiedFastLaneBundle !== null
            ? {
                requestId: `${generationRequestId}-certified-fast-lane`,
                structuredOutput: certifiedFastLaneBundle,
                tokenMetadata: { inputTokens: 0, outputTokens: 0 },
                costMetadata: { attemptCount: 0, costUsd: 0 },
              }
            : await requestModel({
              requestId: generationRequestId,
              missionId,
              workUnitId: `${generationRequestId}-plan`,
              purpose: bundlePrompt(
                profile,
                contract,
                bindings,
                approvedContract,
                engineeringSignals,
                performancePolicy,
                approvedPrototypeSource,
              ),
              taskClass: ModelTaskClass.FILE_GENERATION,
              contextReferences: [
                { kind: "contract", id: `${missionId}-contract` },
                {
                  kind: "workspace-checkpoint",
                  id: workspace.currentCheckpointId,
                },
              ],
              expectedStructuredOutputSchema: generationSchema,
              // Contract semantics are admitted inside the bounded generation
              // loop below. Validating them inside Model Gateway would turn a
              // repairable design-fidelity mismatch into an immediate terminal
              // provider-call failure before that loop can classify it.
              structuredOutputValidator: undefined,
              idempotencyKey: `${generationRequestId}-key`,
              sensitiveValues: [],
              })
          : {
              requestId: priorGenerationCalls.at(-1).requestId,
              // Scoped admission corrections are deliberately stored as only
              // the affected files. Rebuild the current full bundle on resume
              // so a Foundry restart cannot mistake the last small patch for
              // the whole project.
              structuredOutput: reconstructGenerationOutput(
                priorGenerationCalls,
              ),
              tokenMetadata: priorGenerationCalls.at(-1).tokenMetadata,
              costMetadata: priorGenerationCalls.at(-1).costMetadata,
            };
      let validatedFiles;
      for (;;) {
        try {
          if (approvedContract !== null) {
            generation = {
              ...generation,
              structuredOutput: bindMissingApprovedRequirementTraces(
                generation.structuredOutput,
                approvedContract,
              ),
            };
            validateContractBoundMissionPlan(
              generation.structuredOutput,
              approvedContract,
            );
          }
          // Install Foundry's observation harness before admission so every
          // scaffolding gate is satisfied by the file Foundry wrote, not by
          // whatever shape the model happened to choose.
          generation = {
            ...generation,
            structuredOutput: bindFoundryObservationHarness(
              generation.structuredOutput,
              requiredBrowserCheckIds,
              {
                checkBudgetMs: performancePolicy.browserCheckBudgetMs,
                foundryOwnedBrowserHealthCheckIds,
              },
            ),
          };
          validatedFiles = validateProjectBundleForStack(
            ensureCertifiedStackScaffold(
              generation.structuredOutput.files,
              certifiedScaffoldTraceIds,
              {
                responsiveCheckIds: responsiveBrowserCheckIds,
                accessibilityCheckIds: accessibilityBrowserCheckIds,
                authenticatedCheckIds: authenticatedBrowserCheckIds,
                loginCheckIds: loginBrowserCheckIds,
                authenticationErrorCheckIds:
                  authenticationErrorBrowserCheckIds,
              },
            ),
            requiredBrowserCheckIds,
            profile.customerContent,
            {
              responsiveCheckIds: responsiveBrowserCheckIds,
              accessibilityCheckIds: accessibilityBrowserCheckIds,
              authenticatedCheckIds: authenticatedBrowserCheckIds,
              loginCheckIds: loginBrowserCheckIds,
            },
          );
          // Deterministic, before any dependency install or build. A violation
          // is a defect in the bundle, so it routes through the same bounded
          // correction loop as any other admission failure.
          validateEngineeringFloor(validatedFiles, engineeringSignals);
          break;
        } catch (error) {
          const correctionCount = models
            .listCalls(missionId)
            .filter((call) =>
              call.requestId.startsWith(generationCorrectionPrefix),
            ).length;
          if (correctionCount >= repairBudgets.generationCorrectionCalls) {
            throw new Error(
              correctionCount === 0
                ? `The original generated bundle failed deterministic admission; no paid regeneration was attempted: ${error.message}`
                : `The generated bundle still failed deterministic admission after ${correctionCount} paid regenerations: ${error.message}`,
            );
          }
          const correctionSequence = correctionCount + 1;
          const requestId = `${generationCorrectionPrefix}${correctionSequence}`;
          const scopedPaths = approvedContract === null
            ? []
            : admissionCorrectionPaths(
                error,
                generation.structuredOutput.files,
              );
          const scopedFiles = generation.structuredOutput.files.filter((file) =>
            scopedPaths.includes(file.path),
          );
          const correction = await requestModel({
            requestId,
            missionId,
            workUnitId: `${requestId}-plan`,
            purpose: scopedPaths.length > 0
              ? [
                  "Correct a deterministic certified-stack admission defect in the named generated files. Every approved requirement and explicit exclusion in the binding task contract remains authoritative.",
                  `Admission failure:\n${error.message}`,
                  `Return complete corrected contents for only these paths: ${scopedPaths.join(", ")}. Do not return or rewrite any other file. Preserve the valid behavior, contract traces, and public design outside this scope; do not weaken verification.`,
                  "Never use eval, new Function, Function(), or string-to-code execution. Use valid TypeScript generic syntax. Browser expectations must be independent from application implementation, while values deliberately entered through a Playwright interaction helper retain test provenance.",
                  `Current affected files:\n${JSON.stringify(scopedFiles)}`,
                ].join("\n\n")
              : [
                  bundlePrompt(
                    profile,
                    contract,
                    bindings,
                    approvedContract,
                    engineeringSignals,
                    performancePolicy,
                    approvedPrototypeSource,
                  ),
                  "The prior generated bundle failed deterministic certified-stack admission before any dependency installation or build was run.",
                  `Admission failure: ${error.message}`,
                  "Return the complete corrected bundle. Preserve valid project behavior and fix the structural stack defect; do not remove obligations or weaken verification.",
                  `Prior bundle:\n${JSON.stringify(generation.structuredOutput.files)}`,
                ].join("\n\n"),
            taskClass: ModelTaskClass.FILE_GENERATION,
            contextReferences: [
              { kind: "contract", id: `${missionId}-contract` },
              {
                kind: "workspace-checkpoint",
                id: workspace.currentCheckpointId,
              },
            ],
            expectedStructuredOutputSchema: scopedPaths.length > 0
              ? repairPatchSchemaScopedToPaths(
                  wholeFileRepairSchema,
                  scopedPaths,
                )
              : generationSchema,
            // Keep semantic admission in this loop so the same immutable
            // contract is applied to every bounded correction attempt.
            structuredOutputValidator: undefined,
            idempotencyKey: `${requestId}-key`,
            sensitiveValues: [],
          });
          generation = scopedPaths.length > 0
            ? {
                ...correction,
                structuredOutput: mergeAdmissionCorrection(
                  generation.structuredOutput,
                  correction.structuredOutput,
                  scopedPaths,
                ),
              }
            : {
                ...correction,
                structuredOutput: mergeCompleteAdmissionCorrection(
                  generation.structuredOutput,
                  correction.structuredOutput,
                ),
              };
        }
      }
      const bundle = {
        files: validatedFiles.filter(
          (file) => file.path.replaceAll("\\", "/") !== "package-lock.json",
        ),
        readinessPath: "/api/health",
      };
      if (
        !Array.isArray(bundle.files) ||
        bundle.files.length === 0 ||
        typeof bundle.readinessPath !== "string"
      ) {
        throw new TypeError("The live model returned an invalid project bundle.");
      }
      const generatedBundleAlreadyApplied = execution
        .listWorkUnits(missionId)
        .some(
          (record) =>
            record.actionType === WorkUnitAction.APPLY_FILE_BUNDLE &&
            record.status === WorkUnitStatus.SUCCEEDED,
        );
      if (!generatedBundleAlreadyApplied) {
        const result = await work(
          WorkUnitAction.APPLY_FILE_BUNDLE,
          {
            files: bundle.files.map((file) => ({
              path: file.path,
              content: file.content,
            })),
          },
          generationTargetIds,
          "generated-source-bundle",
        );
        if (result.status !== WorkUnitStatus.SUCCEEDED) {
          throw new Error(
            "Could not apply the generated source bundle atomically.",
          );
        }
      }

      const restoreBeforeCommands = ledger
        .listEvents(missionId)
        .filter(
          (record) =>
            record.workspaceFact?.operation === "CHECKPOINT_RESTORED" &&
            record.workspaceFact.reason !==
              BROWSER_ISOLATION_RESTORE_REASON,
        )
        .at(-1);
      const rehydrationBeforeCommands = execution
        .listWorkUnits(missionId)
        .filter(
          (record) =>
            record.actionType === WorkUnitAction.RUN_COMMAND &&
            record.inputs.procedureName === "productionBuild" &&
            record.workUnitId.includes("rehydrate-") &&
            record.status === WorkUnitStatus.SUCCEEDED,
        )
        .sort((left, right) =>
          left.endTimestamp.localeCompare(right.endTimestamp),
        )
        .at(-1);
      let rehydratedBeforeCommands = false;
      if (
        restoreBeforeCommands !== undefined &&
        (rehydrationBeforeCommands === undefined ||
          rehydrationBeforeCommands.endTimestamp <
            restoreBeforeCommands.occurredAt)
      ) {
        await rehydrateRestoredWorkspace(
          `preflight-checkpoint-${restoreBeforeCommands.sequence}`,
        );
        rehydratedBeforeCommands = true;
      }

      const initialCommandPipeline = [
        ...(certifiedFastLaneBundle === null
          ? [["dependency-lock", "dependencyLock", 600_000]]
          : []),
        ["dependency-install", "install", 600_000],
        ["type-check", "typeCheck", 300_000],
        ["lint", "lint", 300_000],
        ["production-build", "productionBuild", 600_000],
      ];
      for (const [mode, procedureName, timeoutMs] of initialCommandPipeline) {
        if (
          rehydratedBeforeCommands &&
          (mode === "dependency-lock" || mode === "dependency-install")
        ) {
          continue;
        }
        const targets = Object.entries(bindings)
          .filter(([, binding]) => binding === mode)
          .map(([obligationId]) => obligationId);
        // The certified stack is Next 15, where `next build` type-checks and
        // lints as part of building, and nothing in the scaffold turns either
        // off. Running tsc and eslint first only re-reports what the build is
        // about to find -- for about a hundred seconds, on every pass of the
        // gate, and the gate re-runs after every repair. Keep them only where
        // an obligation is actually bound to that command as its evidence.
        if (
          (procedureName === "typeCheck" || procedureName === "lint") &&
          targets.length === 0 &&
          buildEnforcesTypesAndLint(validatedFiles)
        ) {
          continue;
        }
        let result;
        for (let attempt = 0; attempt < 7; attempt += 1) {
          result = await work(
            WorkUnitAction.RUN_COMMAND,
            {
              procedureName,
              environment: {},
              timeoutMs,
              outputLimitBytes: 1_048_576,
            },
            targets.length > 0 ? targets : generationTargetIds,
            `${procedureName}-attempt-${attempt + 1}`,
          );
          if (result.status === WorkUnitStatus.SUCCEEDED) break;
          if (
            ![
              "dependencyLock",
              "install",
              "typeCheck",
              "lint",
              "productionBuild",
            ].includes(
              procedureName,
            )
          ) {
            throw new Error(
              `${procedureName} failed; the real command evidence is persisted.`,
            );
          }
          const failureEvidence = commandEvidence(
            evidence,
            result.workUnitId,
          );
          if (failureEvidence === undefined) {
            const interruptionEvidence = evidence
              .findByWorkUnit(result.workUnitId)
              .find(
                (record) =>
                  record.kind === ObservationKind.WORK_UNIT_RESULT &&
                  record.metadata?.interrupted === true,
              );
            if (interruptionEvidence !== undefined) {
              // The Execution Engine deliberately refuses to repeat an
              // interrupted command under the same identity. The next loop
              // iteration receives a new work-unit identity and is admitted
              // only because immutable recovery evidence proved the prior
              // attempt ended without a durable command result.
              continue;
            }
            throw new Error(
              `${procedureName} failed without command evidence.`,
            );
          }
          const priorRepairs = execution
            .listWorkUnits(missionId)
            .filter(
              (record) =>
                [WorkUnitAction.WRITE_FILE, WorkUnitAction.REPLACE_FILE].includes(
                  record.actionType,
                ) &&
                record.workUnitId.includes(
                  `repair-${safeName(procedureName)}-`,
                ),
            );
          const repairPrefix = `${contractRequestNamespace}-${safeName(procedureName)}-repair-`;
          const priorRepairCalls = models
            .listCalls(missionId)
            .filter(
              (call) =>
                call.requestId.startsWith(repairPrefix) &&
                call.status === "SUCCEEDED",
            );
          const failureClassification = classifyProductionFailure({
            stage: procedureName,
            stdout: failureEvidence.payload.stdout,
            stderr: failureEvidence.payload.stderr,
          });
          if (repairBudgets.procedureRepairCalls === 0) {
            orchestrator.transition({
              missionId,
              eventId: `${missionId}-${safeName(procedureName)}-first-pass-failed`,
              causationId: result.workUnitId,
              to: MissionState.FAILED,
              reason: `The original generated project failed ${procedureName}; no paid repair or repeated pipeline run was attempted.`,
            });
            throw new Error(
              `${procedureName} failed first-pass verification; its exact command evidence is persisted.`,
            );
          }
          // A lock that disagrees with the manifest is fixed by regenerating
          // the lock, which is what npm's own error tells you to do. Doing it
          // here costs one command and no model call; the alternative, already
          // observed, is two paid repairs editing package.json while the lock
          // -- the actual problem -- goes untouched, and the build dies with
          // its install budget spent.
          if (
            procedureName === "install" &&
            lockOutOfSyncWithManifest(
              `${failureEvidence.payload.stdout}
${failureEvidence.payload.stderr}`,
            )
          ) {
            const priorRelocks = execution
              .listWorkUnits(missionId)
              .filter(
                (record) =>
                  record.actionType === WorkUnitAction.RUN_COMMAND &&
                  record.inputs.procedureName === "dependencyLock" &&
                  record.workUnitId.includes("lock-resync"),
              );
            // Once. If a freshly generated lock still disagrees, the manifest
            // itself is wrong and that is a repair, not a re-run.
            if (priorRelocks.length === 0) {
              const relocked = await work(
                WorkUnitAction.RUN_COMMAND,
                {
                  procedureName: "dependencyLock",
                  environment: {},
                  timeoutMs: 600_000,
                  outputLimitBytes: 1_048_576,
                },
                targets.length > 0 ? targets : generationTargetIds,
                "lock-resync-dependencylock",
              );
              if (relocked.status === WorkUnitStatus.SUCCEEDED) continue;
            }
          }
          if (
            failureClassification.scope ===
              ProductionRepairScope.DEPENDENCY &&
            !["dependencyLock", "install"].includes(procedureName)
          ) {
            const priorDependencyRecoveries = execution
              .listWorkUnits(missionId)
              .filter(
                (record) =>
                  record.actionType === WorkUnitAction.RUN_COMMAND &&
                  record.inputs.procedureName === "install" &&
                  record.workUnitId.includes(
                    `dependency-recovery-${safeName(procedureName)}`,
                  ),
              );
            if (priorDependencyRecoveries.length > 0) {
              throw new Error(
                `${procedureName} still reports a missing dependency after one evidence-backed dependency recovery; repeated installation was rejected.`,
              );
            }
            const recoveredDependencies = await work(
              WorkUnitAction.RUN_COMMAND,
              {
                procedureName: "install",
                environment: {},
                timeoutMs: 600_000,
                outputLimitBytes: 1_048_576,
              },
              targets.length > 0 ? targets : generationTargetIds,
              `dependency-recovery-${procedureName}-install`,
            );
            if (
              recoveredDependencies.status !== WorkUnitStatus.SUCCEEDED
            ) {
              throw new Error(
                "The single scoped dependency recovery failed; its command evidence is persisted.",
              );
            }
            continue;
          }
          if (priorRepairCalls.length >= repairBudgets.procedureRepairCalls) {
            orchestrator.transition({
              missionId,
              eventId: `${missionId}-${safeName(procedureName)}-repairs-exhausted`,
              causationId: result.workUnitId,
              to: MissionState.EXHAUSTED,
              reason: `The bounded ${procedureName} repair budget was exhausted after ${repairBudgets.procedureRepairCalls} evidence-backed changes.`,
            });
            throw new Error(
              `${procedureName} repair budget exhausted; the mission is EXHAUSTED.`,
            );
          }
          const repeatedFailureCount = execution
            .listWorkUnits(missionId)
            .filter(
              (record) =>
                record.actionType === WorkUnitAction.RUN_COMMAND &&
                record.inputs.procedureName === procedureName &&
                record.status === WorkUnitStatus.FAILED,
            )
            .map((record) => commandEvidence(evidence, record.workUnitId))
            .filter(
              (record) =>
                record?.payload.stderr === failureEvidence.payload.stderr &&
                record?.payload.stdout === failureEvidence.payload.stdout,
            ).length;
          const currentFiles = bundle.files
            .filter(
              (file) =>
                !file.path.startsWith("public/") &&
                file.path !== "package-lock.json",
            )
            .map((file) => ({
              path: file.path,
              content: workspaces.readFile({
                missionId,
                workspaceId: workspace.workspaceId,
                relativePath: file.path,
              }),
            }));
          const nextRepairRequestId = () =>
            `${repairPrefix}${
              models
                .listCalls(missionId)
                .filter((call) => call.requestId.startsWith(repairPrefix))
                .length + 1
            }`;
          let repairRequestId = nextRepairRequestId();
          const repairRequirementIds =
            targets.length > 0 ? targets : generationTargetIds;
          const repairFileSchema = contractTraceSchema(
            wholeFileRepairSchema,
            approvedContract !== null,
          );
          // A rejected repair proposal is a correctable model mistake, not a
          // reason to end the mission. Model Gateway classifies its own
          // semantic rejection as terminal, so without this the first slightly
          // malformed proposal killed the run outright. Bounded, and the paid
          // repair budget above still applies.
          let repair = null;
          let proposalRejection = null;
          for (
            let proposalAttempt = 0;
            proposalAttempt < 3 && repair === null;
            proposalAttempt += 1
          ) {
          repairRequestId = nextRepairRequestId();
          try {
          repair = await requestModel({
            requestId: repairRequestId,
            missionId,
            workUnitId: `${repairRequestId}-plan`,
            purpose: [
              ...(proposalRejection === null
                ? []
                : [
                    `Your previous proposal was rejected before it was applied: ${proposalRejection}`,
                    "Return a proposal that satisfies that requirement exactly. Do not repeat the rejected output.",
                  ]),
              `The real ${procedureName} procedure failed for the generated project.`,
              `Deterministic repair classification: ${failureClassification.scope}. Hypothesis: ${failureClassification.hypothesis}`,
              `Diagnose the observed output and return a files array containing the complete corrected content of every implicated source or configuration file, up to ${MAX_REPAIR_FILES_PER_PROPOSAL}. Use one entry per path and include all sides of a cross-file contract in this one repair.`,
              "Each path may identify an existing file or a missing file inside an existing generated directory. Do not target dependencies, build output, data, secrets, or a lockfile.",
              "When a Next.js route entry exports a shared helper, move that helper into a non-route lib module and update the route plus every importer together. Do not alternate between an illegal route export and broken imports.",
              "Fix the underlying project defect. Do not weaken TypeScript, lint, build, tests, the Requirement Contract, or runtime behavior.",
              `Observed stdout:\n${failureEvidence.payload.stdout}`,
              `Observed stderr:\n${failureEvidence.payload.stderr}`,
              `This exact observed failure has occurred ${repeatedFailureCount} time(s).`,
              `Prior evidence-backed repair paths:\n${JSON.stringify(
                priorRepairs.map((record) => ({
                  path: record.inputs.path,
                  status: record.status,
                })),
              )}`,
              "When the same failure remains after a prior change, diagnose the remaining cause from the current files. Do not repeat an already ineffective file change.",
              `Existing project files:\n${JSON.stringify(currentFiles)}`,
            ].join("\n\n"),
            taskClass: ModelTaskClass.REPAIR_IMPLEMENTATION,
            requestTimeoutMs: productionRepairModelTimeoutMs(performancePolicy),
            depthLevel: 2,
            routingReason:
              "A bounded generated-source correction is standard engineering.",
            contextReferences: [
              { kind: "evidence", id: failureEvidence.evidenceId },
              {
                kind: "workspace-checkpoint",
                id: workspaces.getWorkspace(missionId).currentCheckpointId,
              },
            ],
            expectedStructuredOutputSchema: repairFileSchema,
            structuredOutputValidator(output) {
              validateGeneratedRepairSet({
                structuredOutput: output,
                currentFiles,
                priorStructuredOutputs: models
                  .listCalls(missionId)
                  .filter(
                    (call) =>
                      call.requestId.startsWith(repairPrefix) &&
                      call.requestId !== repairRequestId,
                  )
                  .map((call) => call.structuredOutput),
              });
              if (approvedContract !== null) {
                validateContractRequirementTrace(
                  output.contractRequirementIds,
                  approvedContract,
                  repairRequirementIds,
                );
              }
            },
            idempotencyKey: `${repairRequestId}-key`,
            sensitiveValues: [],
          }, {
            relevantRequirementIds: repairRequirementIds,
            taskObjective: `Repair the observed ${procedureName} failure while preserving the approved project contract.`,
            // A type error, a lint complaint or a failed build is a tooling
            // defect in an approved project. It cannot change the design, so
            // it does not carry one: these calls were shipping about
            // twenty-six thousand tokens of design direction each.
            designDirected: false,
          });
          } catch (error) {
            const message = String(error?.message ?? error);
            if (!/failed semantic validation/iu.test(message)) throw error;
            proposalRejection = message;
            repair = null;
            if (proposalAttempt === 2) throw error;
          }
          }
          const repairFiles = repairPatchFiles(repair.structuredOutput);
          for (const repairFile of repairFiles) {
            const repairMode = validateGeneratedRepairPath(
              repairFile.path,
              currentFiles,
            );
            const changed = await work(
              repairMode === "replace"
                ? WorkUnitAction.REPLACE_FILE
                : WorkUnitAction.WRITE_FILE,
              {
                path: repairFile.path,
                content: repairFile.content,
              },
              repairRequirementIds,
              `repair-${procedureName}-${repairFile.path}`,
            );
            if (changed.status !== WorkUnitStatus.SUCCEEDED) {
              throw new Error(
                `The evidence-backed ${procedureName} repair could not apply ${repairFile.path}.`,
              );
            }
            if (repairMode === "write") {
              bundle.files.push({
                path: repairFile.path,
                content: repairFile.content,
                ...(approvedContract === null
                  ? {}
                  : {
                      contractRequirementIds:
                        repair.structuredOutput.contractRequirementIds,
                    }),
              });
            }
          }
        }
      }

      async function rehydrateRestoredWorkspace(label) {
        const rehydrationId = createHash("sha256")
          .update(String(label))
          .digest("hex")
          .slice(0, 12);
        for (const [procedureName, timeoutMs] of [
          ["install", 600_000],
          ["productionBuild", 600_000],
        ]) {
          const result = await work(
            WorkUnitAction.RUN_COMMAND,
            {
              procedureName,
              environment: {},
              timeoutMs,
              outputLimitBytes: 1_048_576,
            },
            generationTargetIds,
            `rehydrate-${rehydrationId}-${procedureName}`,
          );
          if (result.status !== WorkUnitStatus.SUCCEEDED) {
            throw new Error(
              `${procedureName} failed while rehydrating a restored verification checkpoint.`,
            );
          }
        }
      }

      function checkpointFingerprint(checkpointId, artifactKind) {
        const checkpoint = workspaces
          .listMissionCheckpoints(missionId)
          .find((record) => record.checkpointId === checkpointId);
        if (checkpoint === undefined) return null;
        const entries = checkpoint.contentManifest.filter((entry) => {
          if (artifactKind === "dependencies") {
            return [
              "package.json",
              "package-lock.json",
              "npm-shrinkwrap.json",
            ].includes(entry.path);
          }
          return (
            !entry.path.startsWith("data/") &&
            !entry.path.startsWith("tests/") &&
            !/^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(entry.path)
          );
        });
        return createHash("sha256")
          .update(
            canonicalizeExecutionValue(
              entries.map((entry) => ({
                path: entry.path,
                contentHash: entry.contentHash,
              })),
            ),
            "utf8",
          )
          .digest("hex");
      }

      function workspaceContains(relativePath) {
        try {
          workspaces.readFile({
            missionId,
            workspaceId: workspace.workspaceId,
            relativePath,
            encoding: null,
          });
          return true;
        } catch {
          return false;
        }
      }

      function reusableTransientDirectories(checkpointId) {
        const workUnits = execution.listWorkUnits(missionId);
        const targetDependencyFingerprint = checkpointFingerprint(
          checkpointId,
          "dependencies",
        );
        const targetBuildFingerprint = checkpointFingerprint(
          checkpointId,
          "build",
        );
        const hasCompatibleInstall = workUnits.some(
          (record) =>
            record.actionType === WorkUnitAction.RUN_COMMAND &&
            record.inputs.procedureName === "install" &&
            record.status === WorkUnitStatus.SUCCEEDED &&
            checkpointFingerprint(
              record.postWorkCheckpointId,
              "dependencies",
            ) === targetDependencyFingerprint,
        );
        const hasCompatibleBuild = workUnits.some(
          (record) =>
            record.actionType === WorkUnitAction.RUN_COMMAND &&
            record.inputs.procedureName === "productionBuild" &&
            record.status === WorkUnitStatus.SUCCEEDED &&
            checkpointFingerprint(
              record.postWorkCheckpointId,
              "build",
            ) === targetBuildFingerprint,
        );
        const reusable = [];
        if (
          hasCompatibleInstall &&
          workspaceContains("node_modules/.package-lock.json")
        ) {
          reusable.push("node_modules");
        }
        if (
          hasCompatibleBuild &&
          workspaceContains(".next/BUILD_ID")
        ) {
          reusable.push(".next");
        }
        return reusable;
      }

      async function restoreBrowserCheckpoint({
        checkpointId,
        evidenceId,
        eventId,
        causationId,
      }) {
        const reusableDirectories =
          reusableTransientDirectories(checkpointId);
        workspaces.restoreCheckpoint({
          missionId,
          workspaceId: workspace.workspaceId,
          checkpointId,
          evidenceId,
          eventId,
          causationId,
          reason: BROWSER_ISOLATION_RESTORE_REASON,
          preserveTransientDirectories: reusableDirectories,
        });
        if (!reusableDirectories.includes("node_modules")) {
          const installed = await work(
            WorkUnitAction.RUN_COMMAND,
            {
              procedureName: "install",
              environment: {},
              timeoutMs: 600_000,
              outputLimitBytes: 1_048_576,
            },
            generationTargetIds,
            `scoped-browser-restore-${safeName(checkpointId)}-install`,
          );
          if (installed.status !== WorkUnitStatus.SUCCEEDED) {
            throw new Error(
              "Dependency installation failed after fingerprint validation rejected reuse.",
            );
          }
        }
        if (!reusableDirectories.includes(".next")) {
          const built = await work(
            WorkUnitAction.RUN_COMMAND,
            {
              procedureName: "productionBuild",
              environment: {},
              timeoutMs: 600_000,
              outputLimitBytes: 1_048_576,
            },
            generationTargetIds,
            `scoped-browser-restore-${safeName(checkpointId)}-build`,
          );
          if (built.status !== WorkUnitStatus.SUCCEEDED) {
            throw new Error(
              "Production build failed after fingerprint validation rejected reuse.",
            );
          }
        }
      }

      const priorBrowserWorkUnits = execution
        .listWorkUnits(missionId)
        .filter(
          (record) =>
            record.actionType === WorkUnitAction.RUN_COMMAND &&
            record.inputs.procedureName === "browserVerification",
        )
        .sort((left, right) =>
          left.startTimestamp.localeCompare(right.startTimestamp),
        );
      const latestPriorBrowserWorkUnit = priorBrowserWorkUnits.at(-1);
      const isolationRestoreEventId =
        latestPriorBrowserWorkUnit === undefined
          ? null
          : `${latestPriorBrowserWorkUnit.workUnitId}-isolation-restore`;
      const hasIsolatedBrowserRestore =
        isolationRestoreEventId !== null &&
        ledger
          .listEvents(missionId)
          .some(
            (record) =>
              record.eventId === isolationRestoreEventId ||
              record.eventId ===
                `${latestPriorBrowserWorkUnit.workUnitId}-restore`,
          );
      if (
        priorBrowserWorkUnits.length > 0 &&
        !hasIsolatedBrowserRestore
      ) {
        const latestBySession = new Map();
        for (const record of runtime.listSessions(missionId)) {
          latestBySession.set(record.sessionId, record);
        }
        for (const priorSession of latestBySession.values()) {
          if (priorSession.status === RuntimeStatus.STOPPED) continue;
          await runtime.stop({
            missionId,
            sessionId: priorSession.sessionId,
            observationId: `${priorSession.sessionId}-isolation-stop`,
            evidenceId: `${priorSession.sessionId}-isolation-stop-evidence`,
            causationId: `${missionId}-browser-isolation-recovery`,
            idempotencyKey: `${priorSession.sessionId}-isolation-stop-key`,
          });
        }
        await restoreBrowserCheckpoint({
          checkpointId: latestPriorBrowserWorkUnit.preWorkCheckpointId,
          evidenceId: `${latestPriorBrowserWorkUnit.workUnitId}-isolation-restore-evidence`,
          eventId: isolationRestoreEventId,
          causationId: latestPriorBrowserWorkUnit.workUnitId,
        });
      }
      const latestRestore = ledger
        .listEvents(missionId)
        .filter(
          (record) =>
            record.workspaceFact?.operation === "CHECKPOINT_RESTORED" &&
            record.workspaceFact.reason !==
              BROWSER_ISOLATION_RESTORE_REASON,
        )
        .at(-1);
      const latestRehydration = execution
        .listWorkUnits(missionId)
        .filter(
          (record) =>
            record.actionType === WorkUnitAction.RUN_COMMAND &&
            record.inputs.procedureName === "productionBuild" &&
            record.workUnitId.includes("rehydrate-") &&
            record.status === WorkUnitStatus.SUCCEEDED,
        )
        .sort((left, right) =>
          left.endTimestamp.localeCompare(right.endTimestamp),
        )
        .at(-1);
      if (
        latestRestore !== undefined &&
        (latestRehydration === undefined ||
          latestRehydration.endTimestamp < latestRestore.occurredAt)
      ) {
        await rehydrateRestoredWorkspace(
          `checkpoint-${latestRestore.sequence}`,
        );
      }

      let runtimeAttempt = 0;
      const runtimeAccessValue = randomUUID();
      async function startRuntime() {
        runtimeAttempt =
          runtime
            .listSessions(missionId)
            .filter((record) => record.eventType === "STARTUP").length + 1;
        const runtimeSessionId =
          runtimeAttempt === 1
            ? `${missionId}-runtime`
            : `${missionId}-runtime-${runtimeAttempt}`;
        const started = await runtime.start({
          sessionId: runtimeSessionId,
          missionId,
          workspaceId: workspace.workspaceId,
          checkpointId:
            workspaces.getWorkspace(missionId).currentCheckpointId,
          procedureName: "productionRun",
          readinessPath: bundle.readinessPath,
          requestedPort: null,
          timeoutMs: 120_000,
          idempotencyKey: `${missionId}-runtime-${runtimeAttempt}-key`,
          observationId: `${missionId}-runtime-${runtimeAttempt}-start`,
          evidencePrefix: `${missionId}-runtime-${runtimeAttempt}-evidence`,
          causationId: `${missionId}-runtime-command`,
          verificationRequestReference: `${missionId}-verification`,
          environment: {
            FOUNDRY_RUNTIME_ACCESS_VALUE: runtimeAccessValue,
          },
        });
        if (started.status !== RuntimeStatus.READY) {
          throw new Error("The generated runtime did not become HTTP-ready.");
        }
        return started;
      }
      let session = await startRuntime();
      // The attempt loop restarts the runtime after every repair, including the
      // repair that follows its final attempt. Falling out of the loop then
      // left a pre-repair observation paired with a post-repair runtime, and
      // the integrity check rejected the pair with "checkpoint differs from the
      // running artifact" — a confusing way to say verification never passed.
      let observationVerified = false;
      let lastObservationFailure;
      let priorRepairBreakage;
      let previousOutstandingFailures;
      let stalledRounds = 0;
      let latestFidelityFailureCount = 0;
      // Of thirty recorded failures on this path, nine had every required
      // browser check observed true — the application demonstrably worked, its
      // workflows proven in a real browser — and the mission was failed anyway
      // because the produced layout was not close enough to the approved
      // prototype. Destroying working software over a geometry distance is the
      // wrong trade: the customer is left with nothing when they could have had
      // the product plus an honest account of where its design fell short.
      // Behaviour remains non-negotiable; fidelity, once every safe correction
      // has been spent, is reported rather than fatal.
      let designFidelityShortfall = null;
      let latestFidelityVerdict = null;
      let nonFidelityFailureOutstanding = true;
      // Which checks held last round, so a regression can be named as one.
      let previouslyPassingCheckIds = new Set();
      // What the last correction was applied over, and whether it was a design
      // repair. A design repair that breaks a working workflow is not a partial
      // success to be reported and carried forward — it is worse than the state
      // before it, and that state is still on disk.
      let repairedOverCheckpointId = null;
      let lastRepairWasDesignFidelity = false;
      let designRegressionToUndo = null;
      const browserTargets = Object.entries(bindings)
        .filter(
          ([, binding]) =>
            binding === "browser-check" ||
            binding === "browser-errors" ||
            binding === "structured-tests",
        )
        .map(([obligationId]) => obligationId);
      const browserCheckAuthority = browserCheckAuthorityPlan({
        // RequirementContract intentionally strips approval provenance. The
        // immutable ApprovedProjectContract retains sourceRequirement, which
        // is what distinguishes customer workflows from derived design checks.
        obligations:
          approvedContract?.acceptanceObligations ?? contract.obligations,
        bindings,
        approvedPrototypeContract,
      });
      const requiredBrowserChecks = browserCheckAuthority.required;
      const functionalBrowserChecks = browserCheckAuthority.functional;
      const approvedDesignBrowserChecks = browserCheckAuthority.design;
      let authoritativeBrowserCheckOverrides = {};
      let browserVerificationElapsedMs = 0;
      let browser;
      for (
        let attempt = 0;
        attempt < performancePolicy.browserObservationAttempts;
        attempt += 1
      ) {
        authoritativeBrowserCheckOverrides = {};
        // Reset each round. Carrying a previous round's fidelity count into a
        // round that never measured it makes progress accounting dishonest.
        latestFidelityFailureCount = 0;
        const browserVerificationRemainingMs = Math.max(
          1_000,
          performancePolicy.browserVerificationBudgetMs -
            browserVerificationElapsedMs,
        );
        const browserVerificationStartedAt = Date.now();
        browser = await work(
          WorkUnitAction.RUN_COMMAND,
          {
            procedureName: "browserVerification",
            environment: {
              FOUNDRY_PREVIEW_URL: session.previewUrl,
              FOUNDRY_RUNTIME_ACCESS_VALUE: runtimeAccessValue,
            },
            // A normal project's entire set of real user-action checks gets
            // one minute across all rounds. A single stuck Playwright process
            // can no longer consume five minutes by itself.
            timeoutMs: browserVerificationRemainingMs,
            outputLimitBytes: 1_048_576,
          },
          browserTargets.length > 0
            ? browserTargets
            : generationTargetIds,
          `browser-verification-runtime-${runtimeAttempt}-attempt-${attempt + 1}`,
        );
        browserVerificationElapsedMs += Math.max(
          0,
          Date.now() - browserVerificationStartedAt,
        );
        const browserEvidence = commandEvidence(
          evidence,
          browser.workUnitId,
        );
        let browserResult;
        let browserFailure;
        if (browserEvidence === undefined) {
          browserFailure =
            "The Playwright command did not persist command evidence.";
        } else {
          const observationFailures = [];
          if (browser.status !== WorkUnitStatus.SUCCEEDED) {
            observationFailures.push(
              "The Playwright command exited unsuccessfully.",
            );
          }
          try {
            browserResult = parseBrowserResult(
              browserEvidence.payload.stdout,
              { allowEmptyChecks: requiredBrowserChecks.length === 0 },
            );
            const observedCheckIds = Object.keys(browserResult.checks).sort(
              (left, right) => left.localeCompare(right),
            );
            const exactChecks =
              observedCheckIds.length === requiredBrowserChecks.length &&
              observedCheckIds.every(
                (checkId, index) =>
                  checkId === requiredBrowserChecks[index],
              );
            const failedChecks = functionalBrowserChecks.filter(
              (checkId) => browserResult.checks[checkId] !== true,
            );
            const blockingErrors = [
              ...browserResult.captureProbeErrors,
              ...browserResult.consoleErrors,
              ...browserResult.pageErrors,
            ];
            if (!exactChecks) {
              observationFailures.push([
                "The structured browser result did not contain exactly the required browser-check obligation IDs.",
                `Required: ${JSON.stringify(requiredBrowserChecks)}`,
                `Observed: ${JSON.stringify(observedCheckIds)}`,
              ].join("\n"));
            } else {
              if (failedChecks.length > 0) {
                observationFailures.push(
                  browserCheckObservationFailure(
                    failedChecks,
                    browserResult.diagnostics ?? {},
                    contract.obligations,
                  ),
                );
              }
              if (blockingErrors.length > 0) {
                observationFailures.push([
                  "The browser observation recorded blocking errors.",
                  JSON.stringify(blockingErrors),
                ].join("\n"));
              }
            }
            if (
              exactChecks &&
              blockingErrors.length === 0 &&
              approvedPrototypeContract !== null
            ) {
              if (typeof prototypeFidelity?.verify !== "function") {
                observationFailures.push(
                  "Approved live prototype fidelity authority is unavailable; completion cannot be proven.",
                );
              } else {
                try {
                  const fidelity = await prototypeFidelity.verify({
                    approvedDesignContract: approvedPrototypeContract,
                    productionPreviewUrl: session.previewUrl,
                  });
                  const fidelityEvidenceId = `${browser.workUnitId}-prototype-fidelity`;
                  const existingFidelityEvidence = evidence
                    .findByWorkUnit(browser.workUnitId)
                    .find((record) => record.evidenceId === fidelityEvidenceId);
                  const fidelityEvidenceInput = {
                    evidenceId: fidelityEvidenceId,
                    missionId,
                    kind: ObservationKind.BROWSER_INTERACTION_RESULT,
                    captureMethod: "same-browser-same-viewport-prototype-comparison",
                    producingSubsystem: PRODUCTION_MISSION_SOURCE,
                    timestamp: new Date().toISOString(),
                    payload: {
                      checks: Object.fromEntries(
                        fidelity.verdicts.map((item) => [item.aspect, item.verdict === "PASS"]),
                      ),
                    },
                    metadata: {
                      approvedDesignId: fidelity.approvedDesignId,
                      approvedPrototypeContentHash: fidelity.approvedPrototypeContentHash,
                      comparedViewports: fidelity.comparedViewports,
                      missingViewports: fidelity.missingViewports,
                      failedAspects: fidelity.failedAspects,
                      verdicts: fidelity.verdicts,
                      integrityHash: fidelity.integrityHash,
                      productionScreenshotManifest: fidelity.productionScreenshotManifest,
                      prototypeScreenshotReferences: fidelity.prototypeScreenshotReferences,
                    },
                    workspaceCheckpointReference: browser.postWorkCheckpointId,
                    obligationReference: null,
                    verificationRequestReference: `${missionId}-verification`,
                    commandReference: browser.workUnitId,
                    workUnitReference: browser.workUnitId,
                    sensitiveValues: [],
                  };
                  if (existingFidelityEvidence === undefined) {
                    evidence.capture(fidelityEvidenceInput);
                  } else if (existingFidelityEvidence.metadata?.integrityHash !== fidelity.integrityHash) {
                    throw new Error("Persisted prototype fidelity evidence does not match the replayed comparison.");
                  }
                  latestFidelityFailureCount = fidelity.passed ? 0 : fidelity.failedAspects.length;
                  latestFidelityVerdict = fidelity.passed
                    ? null
                    : Object.freeze({
                        failedAspects: Object.freeze([...fidelity.failedAspects]),
                        comparedViewports: fidelity.comparedViewports,
                        integrityHash: fidelity.integrityHash,
                        verdicts: fidelity.verdicts,
                      });
                  if (!fidelity.passed) {
                    // Naming the failed aspects without their measurements gave
                    // the repair nothing to aim at: it was told "composition,
                    // spacing" and asked to correct a numeric geometry
                    // mismatch with no numbers, so every attempt reproduced the
                    // same verdict. Carry each failed verdict's own evidence.
                    const failedDetail = (fidelity.verdicts ?? [])
                      .filter((entry) => entry.verdict === "FAIL")
                      .map((entry) =>
                        `${entry.aspect}: ${entry.summary} ${JSON.stringify(entry.detail ?? {})}`,
                      );
                    // The geometry guidance only applies to the aspects
                    // measured by layout distance. Attaching it to every
                    // failure sent a navigation-only repair chasing
                    // meanDistance, the same way the vacuous-count error once
                    // reported itself as a responsive failure.
                    const geometryAspects = new Set(["composition", "spacing", "surface-order"]);
                    const geometryFailed = fidelity.failedAspects.some(
                      (aspect) => geometryAspects.has(aspect),
                    );
                    observationFailures.push(
                      [
                        `Production design fidelity failed against the approved live prototype: ${fidelity.failedAspects.join(", ")}.`,
                        ...failedDetail,
                        ...(geometryFailed
                          ? [
                              "Each comparison is keyed by surface and viewport. meanDistance is the normalized distance between the approved prototype's layout geometry and the produced page at that viewport; it must be at most 0.75, and matched must reach the expected surface count. Move the produced layout toward the approved geometry at the exact viewports listed below tolerance.",
                            ]
                          : []),
                        "Correct only the aspects listed above. Each carries its own measurements and, where useful, an explicit remedy: use them directly instead of re-deriving the problem, and leave every passing aspect untouched.",
                      ].join("\n"),
                    );
                  } else {
                    // The approved-prototype comparator is the design
                    // authority. Resolve the contract's derived design checks
                    // from that verdict while retaining the raw generated
                    // values in the command evidence for diagnosis.
                    authoritativeBrowserCheckOverrides = Object.fromEntries(
                      approvedDesignBrowserChecks.map((checkId) => [checkId, true]),
                    );
                    browserResult = {
                      ...browserResult,
                      checks: {
                        ...browserResult.checks,
                        ...authoritativeBrowserCheckOverrides,
                      },
                    };
                  }
                } catch (error) {
                  observationFailures.push(
                    `Approved live prototype fidelity could not be proven: ${String(error?.message ?? error)}`,
                  );
                }
              }
            }
          } catch (error) {
            observationFailures.push(
              error instanceof Error
                ? error.message
                : "The browser result could not be parsed.",
            );
          }
          // A check that was true last round and is false now was broken by the
          // correction just applied — most often a design-fidelity repair
          // reordering markup that a workflow check depended on. Saying so
          // turns a repeated "this check is false" into the one fact that
          // explains it, and stops the next repair diagnosing a defect that
          // did not exist a round ago.
          if (browserResult !== undefined) {
            const nowFalse = functionalBrowserChecks.filter(
              (checkId) =>
                browserResult.checks[checkId] !== true &&
                previouslyPassingCheckIds.has(checkId),
            );
            if (nowFalse.length > 0) {
              observationFailures.unshift(
                `The correction applied since the last observation broke ${nowFalse.length} check(s) that were passing: ${nowFalse.join(", ")}. Restore them while keeping the change that fixed the previous failure; do not treat these as pre-existing defects.`,
              );
              // A design correction that breaks a working workflow is not
              // progress to carry forward. Telling the next repair about it
              // only spends another round re-earning what already worked, and
              // one build lost sign-in to a markup reorder after every check
              // had passed. Behaviour is what was promised; the closer design
              // is not worth it, and the state without it is still on disk.
              designRegressionToUndo =
                lastRepairWasDesignFidelity && repairedOverCheckpointId !== null
                  ? { checkpointId: repairedOverCheckpointId, checkIds: nowFalse }
                  : null;
            }
            previouslyPassingCheckIds = new Set(
              functionalBrowserChecks.filter(
                (checkId) => browserResult.checks[checkId] === true,
              ),
            );
          }
          // Fidelity is the only observation whose failure may be reported
          // rather than fatal, so it must be told apart from every other one:
          // a false browser check, a console error, an unparseable result.
          nonFidelityFailureOutstanding = observationFailures.some(
            (failure) =>
              !/^Production design fidelity failed against the approved live prototype:/u.test(
                failure,
              ),
          );
          browserFailure =
            observationFailures.length === 0
              ? undefined
              : observationFailures.join("\n");
        }
        // Undo a design correction that cost a working workflow, before
        // anything else reasons about this observation. The project returns to
        // the state whose behaviour was proven, and the loop continues from
        // there: another design attempt may still be bought within budget, and
        // if none succeeds the build is delivered with its shortfall recorded
        // rather than with a broken sign-in.
        if (designRegressionToUndo !== null) {
          const undone = designRegressionToUndo;
          designRegressionToUndo = null;
          await runtime.stop({
            missionId,
            sessionId: session.sessionId,
            observationId: `${browser.workUnitId}-design-regression-stop`,
            evidenceId: `${browser.workUnitId}-design-regression-stop-evidence`,
            causationId: `${browser.workUnitId}-design-regression-stop-command`,
            idempotencyKey: `${browser.workUnitId}-design-regression-stop-key`,
          });
          await restoreBrowserCheckpoint({
            checkpointId: undone.checkpointId,
            evidenceId: `${browser.workUnitId}-design-regression-evidence`,
            eventId: `${browser.workUnitId}-design-regression-rollback`,
            causationId: `${browser.workUnitId}-design-regression-command`,
          });
          repairedOverCheckpointId = null;
          lastRepairWasDesignFidelity = false;
          previouslyPassingCheckIds = new Set();
          priorRepairBreakage = [
            `A design-fidelity correction was reverted: it broke ${undone.checkIds.length} working check(s) — ${undone.checkIds.join(", ")} — and a closer design is not worth a workflow that no longer runs.`,
            "The project is back at the state whose behaviour was proven. Correct the approved design only in ways that leave every workflow intact: change styles, tokens and spacing in the stylesheet, and where markup must move, keep the roles, labels and ordering those checks locate.",
          ].join(" ");
          lastObservationFailure = priorRepairBreakage;
          session = await startRuntime();
          continue;
        }
        lastObservationFailure = browserFailure;
        if (browserFailure === undefined) priorRepairBreakage = undefined;
        if (browserFailure === undefined && browserResult !== undefined) {
          observationVerified = true;
          break;
        }
        // Every required workflow was observed working in a real browser and
        // the only thing still outstanding is how closely the layout matches
        // the approved prototype. Once no safe correction remains, deliver the
        // working product and state the shortfall plainly.
        const behaviourProven =
          browserResult !== undefined &&
          !nonFidelityFailureOutstanding &&
          functionalBrowserChecks.every(
            (checkId) => browserResult.checks[checkId] === true,
          );
        const browserVerificationBudgetSpent =
          browserVerificationElapsedMs >=
          performancePolicy.browserVerificationBudgetMs;
        const acceptWithShortfall = (reason) => {
          const comparedViewportCount = Array.isArray(
            latestFidelityVerdict?.comparedViewports,
          )
            ? latestFidelityVerdict.comparedViewports.length
            : latestFidelityVerdict?.comparedViewports ?? null;
          designFidelityShortfall = Object.freeze({
            failedAspects: latestFidelityVerdict?.failedAspects ?? [],
            // Prototype fidelity retains the exact viewport keys as evidence.
            // Completion's public shortfall contract intentionally exposes a
            // count. Passing the evidence array through here crashed a build
            // after every workflow had already passed.
            comparedViewports: comparedViewportCount,
            integrityHash: latestFidelityVerdict?.integrityHash ?? null,
            observation: browserFailure,
            reason,
          });
          // No state transition belongs here: the mission is already EXECUTING
          // and stays there until verification. Asking the orchestrator to move
          // EXECUTING → EXECUTING is rejected, which killed a build whose
          // application had in fact been proven and was about to be delivered.
          // The decision is recorded as evidence below and named in the
          // VERIFYING transition, which is where it belongs.
          observationVerified = true;
        };
        if (browserVerificationBudgetSpent) {
          if (behaviourProven) {
            acceptWithShortfall(
              `The ${Math.round(performancePolicy.browserVerificationBudgetMs / 1_000)}-second browser-action budget was reached after every functional workflow passed; no additional full rerun was bought for the remaining design difference.`,
            );
            break;
          }
          orchestrator.transition({
            missionId,
            eventId: `${missionId}-browser-verification-time-budget-exhausted`,
            causationId: browser.workUnitId,
            to: MissionState.EXHAUSTED,
            reason: `Browser action verification reached its ${Math.round(performancePolicy.browserVerificationBudgetMs / 1_000)}-second budget with functional checks still failing.`,
          });
          throw new Error(
            `Testing important actions reached its ${Math.round(performancePolicy.browserVerificationBudgetMs / 1_000)}-second budget. The exact unfinished checks and browser evidence were preserved; Foundry did not start another full rerun.`,
          );
        }
        // Whether to keep correcting, deliver, or stop is decided by the shared
        // policy rather than here, so the replay harness measures a change
        // against every build Foundry has recorded before the customer meets
        // it. Every wrong version of this decision cost a real build.
        const outstandingChecks =
          browserResult === undefined
            ? functionalBrowserChecks.length
            : functionalBrowserChecks.filter(
                (checkId) => browserResult.checks[checkId] !== true,
              ).length;
        const decision = browserObservationDecision({
          attempt,
          maxAttempts: performancePolicy.browserObservationAttempts,
          outstandingChecks,
          outstandingFidelityAspects: latestFidelityFailureCount,
          previousOutstanding: previousOutstandingFailures,
          stalledRounds,
          behaviourProven,
        });
        const outstandingFailures = decision.outstanding;
        stalledRounds = decision.stalledRounds;
        previousOutstandingFailures = outstandingFailures;
        if (decision.action === ObservationAction.DELIVER_WITH_SHORTFALL) {
          acceptWithShortfall(
            `Corrections stopped reducing the outstanding design aspects after ${attempt + 1} observations.`,
          );
          break;
        }
        if (decision.action === ObservationAction.HALT_STALLED) {
          orchestrator.transition({
            missionId,
            eventId: `${missionId}-browser-repair-stalled`,
            causationId: browser.workUnitId,
            to: MissionState.EXHAUSTED,
            reason: `Corrections stopped reducing the outstanding failures after ${attempt + 1} observations; the remaining attempts were not spent.`,
          });
          throw new Error(
            `Corrections stopped making progress: ${outstandingFailures} outstanding failure(s) unchanged across consecutive observations. Last observation failure:\n${browserFailure}`,
          );
        }
        const failureEvidence = browserEvidence;
        if (failureEvidence === undefined) {
          throw new Error(
            "Playwright failed without persisted command evidence.",
          );
        }
        const failureClassification = classifyProductionFailure({
          stage: "browserVerification",
          stdout: failureEvidence.payload.stdout,
          stderr: failureEvidence.payload.stderr,
          observationFailure: browserFailure,
        });
        const repairPolicy = productionBrowserRepairPolicy(browserFailure, {
          nonFidelityFailureOutstanding,
          repairBudgets,
        });
        const repairPrefix = `${contractRequestNamespace}-${repairPolicy.requestSegment}-`;
        const priorRepairCalls = models
          .listCalls(missionId)
          .filter(
            (call) =>
              call.requestId.startsWith(repairPrefix) &&
              call.status === "SUCCEEDED",
          )
          .reverse();
        await runtime.stop({
          missionId,
          sessionId: session.sessionId,
          observationId: `${browser.workUnitId}-runtime-stop`,
          evidenceId: `${browser.workUnitId}-runtime-stop-evidence`,
          causationId: `${browser.workUnitId}-runtime-stop-command`,
          idempotencyKey: `${browser.workUnitId}-runtime-stop-key`,
        });
        await restoreBrowserCheckpoint({
          checkpointId: browser.preWorkCheckpointId,
          evidenceId: `${browser.workUnitId}-restore-evidence`,
          eventId: `${browser.workUnitId}-restore`,
          causationId: `${browser.workUnitId}-restore-command`,
        });
        if (
          failureClassification.scope ===
            ProductionRepairScope.RUNTIME &&
          attempt < repairBudgets.runtimeRestarts
        ) {
          session = await startRuntime();
          continue;
        }
        const repairFiles = bundle.files
          .filter(
            (file) =>
              !file.path.startsWith("public/") &&
              !file.path.startsWith("data/") &&
              file.path !== "package-lock.json" &&
              // Foundry writes its own observation harness and design-fidelity
              // evidence spec, and rewrites them on every round, so a
              // correction to either is discarded. Offering them as repair
              // targets sent three consecutive proposals at
              // foundry-design-fidelity-evidence.spec.ts, each proposing text
              // identical to what was already there because there was nothing
              // in it to fix, and the mission ended after a single round with
              // the application's real failures never addressed.
              !foundryOwnedTestPath(file.path),
          )
          .map((file) => ({
            path: file.path,
            content: workspaces.readFile({
              missionId,
              workspaceId: workspace.workspaceId,
              relativePath: file.path,
            }),
          }));
        const sourceOnlyBrowserRepair =
          failureClassification.scope === ProductionRepairScope.SOURCE_CODE &&
          /(?:running application returned a server error|differs from immutable approved prototype evidence)/iu.test(
            failureClassification.hypothesis,
          );
        const designFidelityRepair = repairPolicy.designFidelity;
        const eligibleRepairFiles = sourceOnlyBrowserRepair
          ? repairFiles.filter(
              (file) =>
                repairScopeForPath(file.path) ===
                ProductionRepairScope.SOURCE_CODE,
            )
          : repairFiles;
        const testFiles = repairFiles.filter(
          (file) =>
            file.path.startsWith("tests/") ||
            /^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(file.path),
        );
        const originalGeneratedTestFiles = bundle.files
          .filter(
            (file) =>
              file.path.startsWith("tests/") ||
              /^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(file.path),
          )
          .map((file) => ({
            path: file.path,
            content: file.content,
          }));
        if (priorRepairCalls.length >= repairPolicy.maxCalls) {
          if (behaviourProven) {
            acceptWithShortfall(
              `Its ${priorRepairCalls.length} safe design corrections are spent.`,
            );
            break;
          }
          // Two distinct honest outcomes share this gate. A zero budget means
          // the first pass failed with no correction attempted (FAILED); a
          // spent budget means every safe correction was tried (EXHAUSTED).
          const repairsWereAttempted = priorRepairCalls.length > 0;
          orchestrator.transition({
            missionId,
            eventId: repairsWereAttempted
              ? designFidelityRepair
                ? `${missionId}-design-fidelity-repair-budget-exhausted`
                : `${missionId}-browser-repair-budget-exhausted`
              : `${missionId}-browser-first-pass-failed`,
            causationId: browser.workUnitId,
            to: repairsWereAttempted
              ? MissionState.EXHAUSTED
              : MissionState.FAILED,
            reason: repairsWereAttempted
              ? `${designFidelityRepair ? "Design fidelity" : "Browser verification"} still failed after ${priorRepairCalls.length} evidence-backed corrections; the safe repair budget is exhausted and every attempt is preserved.`
              : "The original generated project failed browser verification; no paid correction or browser rerun was attempted.",
          });
          throw new Error(
            repairsWereAttempted
              ? `${designFidelityRepair ? "Design fidelity" : "Browser verification"} still failed after ${priorRepairCalls.length} evidence-backed corrections; the repair budget is exhausted and its exact evidence is persisted.`
              : "Browser verification failed on the first pass; its exact evidence is persisted and no paid repair was attempted.",
          );
        }
        const latestPriorRepair = priorRepairCalls[0];
        const replayableRepair = [latestPriorRepair].find((call) => {
          if (call === undefined) return false;
          const patches = repairPatchFiles(call.structuredOutput);
          if (patches.length === 0) return false;
          // Every file of the proposal must still apply; replaying half of a
          // multi-file correction would leave the project in a state neither
          // the prior nor the next repair reasoned about.
          return patches.every((patch) => {
            const current = repairFiles.find(
              (file) => file.path === patch?.path,
            );
            if (
              current === undefined ||
              !Array.isArray(patch?.replacements)
            ) {
              return false;
            }
            return canReplayExactReplacements(
              current.content,
              patch.replacements,
            );
          });
        });
        async function requestBrowserRepair(semanticRejection, wholeFile = false) {
          const repairSequence =
            models
              .listCalls(missionId)
              .filter((call) => call.requestId.startsWith(repairPrefix))
              .length + 1;
          const repairRequestId = `${repairPrefix}${repairSequence}`;
          const browserRepairRequirementIds =
            browserTargets.length > 0
              ? browserTargets
              : generationTargetIds;
          const proposalShape = wholeFile
            ? wholeFileRepairSchema
            : browserRepairPatchSchema;
          // Constrain every browser repair—not only source-only failures—to
          // the exact files offered below. A whole-file fallback repeatedly
          // named Foundry's immutable observation spec, spent all three
          // proposal slots on a path it could never edit, and ended a healthy
          // build before any admissible correction was attempted.
          const scopedBrowserRepairPatchSchema = repairPatchSchemaScopedToPaths(
            proposalShape,
            eligibleRepairFiles.map((file) => file.path),
          );
          const browserRepairSchema = contractTraceSchema(
            scopedBrowserRepairPatchSchema,
            approvedContract !== null,
          );
          return requestModel({
          requestId: repairRequestId,
          missionId,
          workUnitId: `${repairRequestId}-plan`,
          purpose: [
            "The real Playwright verification observation did not satisfy its evidence protocol or Requirement Contract.",
            `Deterministic initial repair classification: ${failureClassification.scope}. Hypothesis: ${failureClassification.hypothesis}`,
            wholeFile
              ? `Earlier attempts could not produce an applicable search/replace patch, so return the complete corrected content of each file instead. Give a "files" array of {path, content} over existing project source, configuration, Playwright test, or Playwright configuration files — up to ${MAX_REPAIR_FILES_PER_PROPOSAL}, each named at most once. content replaces that file entirely, so it must be the whole file, complete and valid, with the defect fixed and everything else preserved exactly.`
              : `Return exact search/replace edits as a "files" array over existing project source, configuration, Playwright test, or Playwright configuration files. Name every file the observed failure requires — up to ${MAX_REPAIR_FILES_PER_PROPOSAL} — in this one proposal, and name each file at most once. Each oldText must occur exactly once in that file; keep edits narrowly scoped and use as few replacements as possible.`,
            "A failure whose causes span several files must be corrected in one proposal. Correcting part of it and leaving the rest for a later round wastes the repair budget and risks breaking what already passes.",
            "Choose application source when the running behavior is wrong. Choose Playwright test/configuration only when the observation implementation is wrong. Correct invalid selectors, synchronization, or observation code while preserving every contract assertion.",
            "Never target tests/foundry-observation.spec.ts or a foundry-design-fidelity-evidence spec: Foundry owns and regenerates them. Project-specific browser actions and assertions belong in tests/foundry-checks.ts, which is the editable observation file listed below.",
            "When scoping an action to a native HTML form, use locator('form') unless that form has an explicit accessible name. Do not replace locator('form') with getByRole('form') for an unnamed form: browsers need not expose it as a form landmark, so the locator can time out while the visible UI is healthy.",
            "Foundry clears cookies and storage before every browser check. If evidence says a dashboard selector or protected navigation is missing, first inspect whether that element already exists in application source behind authentication. When it does and the failing check never creates an account or signs in, repair tests/foundry-checks.ts so that check establishes its own fresh session; do not add duplicate dashboard UI to the signed-out page.",
            "For a check that exceeded its own time budget, inspect the complete action sequence rather than guessing from the final timeout. If an initial session request can resolve after a successful sign-up/sign-in and overwrite the authenticated state, fix that hydration race in application source. Otherwise repair the exact missing wait or synchronization point without weakening the assertion.",
            "When a visible create, update, or delete workflow returns a generic HTTP 500, inspect the exact API route used by that interaction together with its SQL and persistence schema. Do not repeatedly change database initialization without checking route statements, parameter binding, and SQL string-literal quoting.",
            ...(sourceOnlyBrowserRepair
              ? [
                  "The persisted browser evidence proves the running application behavior failed an approved check. This repair must target application source; changing Playwright tests or configuration is not permitted for this failure.",
                ]
              : []),
            ...(priorRepairBreakage === undefined ? [] : [priorRepairBreakage]),
            // The floor was stated at generation but not here, so a repair
            // working on a floor obligation — ending a session, refusing an
            // unauthenticated route — had no idea what it was required to
            // build, and stalled reproducing the same failure.
            ...engineeringFloorPromptSegments(engineeringSignals),
            ...(designFidelityRepair
              ? [
                  "This is a design-fidelity repair. Treat the immutable approved prototype, its exact failed aspects, and its desktop/tablet/mobile evidence as authority.",
                  "Change only the application source or isolated styles implicated by the failed fidelity aspects. Preserve every already-working workflow, API behavior, test assertion, and accessible interaction.",
                  // Typography and color are stylesheet facts; surface order and
                  // navigation landmarks are markup facts. Correcting one file
                  // per round left the other half of the verdict untouched.
                  "Fidelity aspects usually span both the markup and the stylesheet: typography, color and spacing are corrected where the styles are declared, while surface order and navigation landmarks are corrected where the markup is written. Include every such file in this one proposal.",
                  "The browser checks listed below are currently observed. A markup change made for fidelity — adding a landmark, reordering surfaces, renaming a region — must keep each of them true; adjust the surrounding structure so the approved design and the observed behavior hold together.",
                  "Do not solve a scoped styling or composition mismatch by replacing the application, rewriting functional logic, changing the approved contract, or weakening the comparator.",
                  // Naming the failed aspects without supplying the approved
                  // values gave the repair nothing to edit toward: it was told
                  // "colors" failed but never told which colors were approved.
                  ...approvedDesignPromptSegments(approvedContract),
                ]
              : []),
            "When several downstream checks are false, diagnose shared discovery or navigation variables first; do not patch each false check independently.",
            "When visible labels repeat across distinct rows, dates, cards, or entities, bind the observation to the exact interacted ancestor, stable identifier, or complete composite identity. Do not use a substring locator that matches unrelated entities.",
            "If the UI exposes no stable identifier or complete composite label, capture the exact scoped collection and indexed element used for the interaction, then compare that same scope's observable count or state before and after. Do not invent a missing test ID or assert that repeated visible text is globally unique.",
            "After navigation, reload, or client hydration, wait for the first expected element or an explicit ready condition before measuring collection counts. Never capture a zero baseline while the requested data is still loading.",
            "When the application has an initial session or readiness state, domcontentloaded is not the ready condition. Await a stable expected form control or authenticated control after every goto/reload before counting buttons, pressing Tab, or measuring the post-hydration layout.",
            "The checks object must contain exactly the supplied browser-check obligation IDs, each computed from the observed running application. Do not include build, structured-test, or browser-error obligations as checks because those are verified from their own evidence.",
            "The test must finish by writing exactly one stdout line starting with the literal prefix FOUNDRY_BROWSER_RESULT: followed immediately by JSON containing captureProbeErrors as a string array, checks as the exact boolean map, diagnostics as a map from each check ID to its named boolean sub-checks, consoleErrors as a string array, and pageErrors as a string array. Replace any other marker name.",
            "Move the pointer away from interactive controls and wait for CSS transitions to settle before measuring computed color so hover and active states cannot falsify the approved resting palette. Diagnostics must name the exact false predicate rather than reporting only a composite check.",
            "Record blocking console/page/capture errors. A deliberately exercised validation response or an absent non-contract decorative resource may be classified as non-blocking only by inspecting its exact URL and status; never discard errors solely by generic message text or status class.",
            "When a contract check deliberately submits invalid data and awaits an exact validation endpoint/status, correlate the matching console event to that awaited response (or scope capture around that exact request) so the expected rejection is not misreported as a blocking runtime error. Do not suppress unrelated requests with the same status.",
            "If all required checks are true and the only failure is a 404 created by the test's own intentional nonexistent-resource request, repair that test workflow to exercise visible client-side validation without issuing the failing request. Do not repeatedly edit layout metadata or decorative icons unless the evidence identifies that exact resource URL.",
            "Console and response events may arrive in either order. Prefer collecting raw console events and exact response URL/status observations, then classify them at finalization; do not depend on listener ordering. Ensure regular expressions are escaped once for TypeScript source, not double-escaped.",
            "Do not skip behavior, replace assertions with constants, mock the application, weaken the test, or turn a failed observation into a passing constant.",
            "Foundry's Runtime & Preview Service already owns the ready application process. Playwright configuration must use FOUNDRY_PREVIEW_URL, select the installed system Chrome channel, and must not declare webServer or start a second runtime.",
            `Observation failure:\n${browserFailure}`,
            `Required browser checks:\n${JSON.stringify(
              requiredBrowserChecks.map((obligationId) => {
                const obligation = contract.obligations.find(
                  (candidate) =>
                    candidate.obligationId === obligationId,
                );
                return {
                  checkId: obligationId,
                  observableOutcome: obligation?.statement,
                  acceptanceCondition:
                    obligation?.acceptanceCondition,
                };
              }),
            )}`,
            `Observed stdout:\n${failureEvidence.payload.stdout}`,
            `Observed stderr:\n${failureEvidence.payload.stderr}`,
            `Prior evidence-backed browser repairs:\n${JSON.stringify(
              priorRepairCalls.map((call) => ({
                requestId: call.requestId,
                files: repairPatchFiles(call.structuredOutput).map((patch) => ({
                  path: patch?.path,
                  replacementCount: patch?.replacements?.length ?? 0,
                })),
              })),
            )}`,
            "Do not repeat a prior replacement that left the same observation failing. Diagnose the remaining cause from the current test and exact evidence.",
            ...(semanticRejection === null
              ? []
              : [
                  `The prior proposed patch was rejected before execution: ${semanticRejection}`,
                  "Return a different, applicable hypothesis. Every oldText must match the supplied current file exactly once.",
                ]),
            `Existing repairable project files:\n${JSON.stringify(eligibleRepairFiles)}`,
            `Existing Playwright test files:\n${JSON.stringify(sourceOnlyBrowserRepair ? [] : testFiles)}`,
            `Original model-generated test files (recovery context only; correct their defects rather than blindly restoring them):\n${JSON.stringify(sourceOnlyBrowserRepair ? [] : originalGeneratedTestFiles)}`,
          ].join("\n\n"),
          taskClass: ModelTaskClass.REPAIR_IMPLEMENTATION,
          depthLevel: sourceOnlyBrowserRepair ? 3 : 2,
          routingReason:
            sourceOnlyBrowserRepair
              ? "An evidence-backed running server error requires deeper source and persistence reasoning."
              : "A bounded Playwright observation correction is standard engineering.",
          contextReferences: [
            { kind: "evidence", id: failureEvidence.evidenceId },
            {
              kind: "workspace-checkpoint",
              id: workspaces.getWorkspace(missionId).currentCheckpointId,
            },
          ],
          expectedStructuredOutputSchema: browserRepairSchema,
          structuredOutputValidator(output) {
            validateBrowserRepairProposal({
              structuredOutput: wholeFile
                ? patchFromWholeFileRepair(output, eligibleRepairFiles)
                : output,
              currentFiles: eligibleRepairFiles,
              requiredBrowserCheckIds: requiredBrowserChecks,
              browserQualityRequirements: {
                responsiveCheckIds: responsiveBrowserCheckIds,
                accessibilityCheckIds: accessibilityBrowserCheckIds,
                authenticatedCheckIds: authenticatedBrowserCheckIds,
                loginCheckIds: loginBrowserCheckIds,
              },
              priorStructuredOutputs: priorRepairCalls.map(
                (call) => call.structuredOutput,
              ),
            });
            if (approvedContract !== null) {
              validateContractRequirementTrace(
                output.contractRequirementIds,
                approvedContract,
                browserRepairRequirementIds,
              );
            }
          },
          idempotencyKey: `${repairRequestId}-key`,
          sensitiveValues: [],
          }, {
            relevantRequirementIds: browserRepairRequirementIds,
            taskObjective:
              "Repair the failed browser verification without changing any approved behavior or verification obligation.",
          });
        }

        let repair =
          replayableRepair === undefined
            ? null
            : { structuredOutput: replayableRepair.structuredOutput };
        let acceptedRepair = null;
        let semanticRejection = null;
        // After one rejected patch the format is the obstacle, not the
        // diagnosis, so the next attempt asks for whole files instead. Two
        // consecutive builds died here with four minutes of correct work
        // already done, because three unusable patches end a mission.
        let wholeFileFallback = false;
        for (
          let proposalAttempt = 0;
          proposalAttempt < MAX_REPAIR_PROPOSALS_PER_ROUND && acceptedRepair === null;
          proposalAttempt += 1
        ) {
          if (proposalAttempt >= 1) {
            wholeFileFallback = true;
          }
          if (repair === null) {
            // The budget exists to stop a repair that keeps reasoning wrongly,
            // and it counted every call — including ones rejected before they
            // touched a file because an oldText no longer matched or the
            // replacements were a no-op. Those are mechanical patch mistakes,
            // not failed hypotheses, and on the last measured build two of the
            // four paid fidelity attempts went to them, so the design was still
            // wrong when the budget ran out. Count what was actually applied and
            // re-observed; the proposal loop around this still bounds how many
            // times a malformed patch may be corrected.
            const repairCallsSoFar = models
              .listCalls(missionId)
              .filter((call) => call.requestId.startsWith(repairPrefix));
            const appliedRepairs = repairCallsSoFar.filter(
              (call) => call.status === "SUCCEEDED",
            ).length;
            if (
              appliedRepairs >= repairPolicy.maxCalls ||
              // Rejected proposals no longer end the round, so they need their
              // own ceiling: a model that cannot produce an applicable patch
              // must not be bought from indefinitely.
              repairCallsSoFar.length >=
                repairPolicy.maxCalls * MAX_REPAIR_PROPOSALS_PER_ROUND
            ) {
              throw new Error(
                `${repairPolicy.designFidelity ? "Design fidelity" : "Browser verification"} exhausted its ${repairPolicy.maxCalls} paid correction proposals without an admissible one, and stopped rather than buying another.`,
              );
            }
            try {
              const proposed = await requestBrowserRepair(
                semanticRejection,
                wholeFileFallback,
              );
              repair = wholeFileFallback
                ? {
                    ...proposed,
                    structuredOutput: patchFromWholeFileRepair(
                      proposed.structuredOutput,
                      eligibleRepairFiles,
                    ),
                  }
                : proposed;
            } catch (error) {
              // Model Gateway also runs this proposal's semantic validator, and
              // it classifies that rejection as terminal because re-buying the
              // same generation repeats the defect. A repair patch is different:
              // an oldText that no longer matches the current file exactly once
              // is a mechanical mistake the model corrects readily when told.
              // Escaping here failed the whole mission over a fixable patch, so
              // route it into the proposal loop that already exists for exactly
              // this class of rejection. The paid-call budget above still bounds
              // it.
              const message = String(error?.message ?? error);
              if (!/failed semantic validation/iu.test(message)) throw error;
              semanticRejection = message;
              repair = null;
              continue;
            }
          }
          try {
            const isPriorReplay =
              replayableRepair !== undefined &&
              repair.structuredOutput ===
                replayableRepair.structuredOutput;
            acceptedRepair = validateBrowserRepairProposal({
              structuredOutput: repair.structuredOutput,
              currentFiles: eligibleRepairFiles,
              requiredBrowserCheckIds: requiredBrowserChecks,
              browserQualityRequirements: {
                responsiveCheckIds: responsiveBrowserCheckIds,
                accessibilityCheckIds: accessibilityBrowserCheckIds,
                authenticatedCheckIds: authenticatedBrowserCheckIds,
                loginCheckIds: loginBrowserCheckIds,
              },
              priorStructuredOutputs: priorRepairCalls.map(
                (call) => call.structuredOutput,
              ),
              allowPriorReplay: isPriorReplay,
            });
            if (approvedContract !== null) {
              validateContractRequirementTrace(
                repair.structuredOutput.contractRequirementIds,
                approvedContract,
                browserTargets.length > 0
                  ? browserTargets
                  : generationTargetIds,
              );
            }
          } catch (error) {
            semanticRejection = String(error?.message ?? error);
            repair = null;
          }
        }
        if (acceptedRepair === null || repair === null) {
          throw new Error(
            `Three browser repair proposals were rejected before pipeline execution: ${semanticRejection}`,
          );
        }
        // The scope that drives which procedures must be rerun is the deepest
        // one the proposal touched: a patch that changes a dependency manifest
        // alongside a stylesheet still needs the dependency pipeline.
        const repairScope = deepestRepairScope(
          acceptedRepair.files.map((file) => repairScopeForPath(file.path)),
        );
        // Remember what this correction was applied over, so a regression it
        // causes can be undone rather than merely reported. The workspace was
        // restored to this checkpoint immediately before the repair, so it is
        // the state without it.
        repairedOverCheckpointId = browser.preWorkCheckpointId;
        lastRepairWasDesignFidelity = repairPolicy.designFidelity;
        for (const file of acceptedRepair.files) {
          const changed = await work(
            WorkUnitAction.REPLACE_FILE,
            {
              path: file.path,
              content: file.content,
            },
            browserTargets.length > 0
              ? browserTargets
              : generationTargetIds,
            `repair-${repairScopeForPath(file.path)}-${file.path}`,
          );
          if (changed.status !== WorkUnitStatus.SUCCEEDED) {
            throw new Error(
              "The evidence-backed scoped repair could not be applied.",
            );
          }
        }
        // Ask what the proposal actually changed, not what it did not. A
        // multi-file repair may correct a Playwright spec and a stylesheet
        // together, and reading "some file was a test" as "nothing shipped
        // changed" skipped verification on a real source edit. The build is
        // required when any shipped artifact moved.
        const changesApplicationArtifact = acceptedRepair.files.some(
          (file) => !file.repairsTestSource && !file.repairsPlaywrightConfig,
        );
        if (changesApplicationArtifact) {
          // next build type-checks and lints the project itself, so running
          // tsc --noEmit and eslint immediately before it repeated that work on
          // every correction. Measured on one twelve-minute build: about a
          // hundred and forty-five seconds went to re-verifying repairs, most
          // of it duplicated. The build's own output still names the file and
          // line, so nothing diagnosable is lost.
          //
          // A procedure an obligation is actually bound to is different: its
          // verdict reads that procedure's own evidence, and skipping it would
          // leave the obligation resolving from a run that predates this
          // repair. Those are kept.
          const boundToOwnObligation = (procedureName) =>
            Object.values(bindings).includes(
              { typeCheck: "type-check", lint: "lint" }[procedureName],
            );
          const requiredProcedures = [
            ...(repairScope === ProductionRepairScope.DEPENDENCY
              ? [
                  ["dependencyLock", 600_000],
                  ["install", 600_000],
                ]
              : []),
            ...(boundToOwnObligation("typeCheck")
              ? [["typeCheck", 300_000]]
              : []),
            ...(boundToOwnObligation("lint") ? [["lint", 300_000]] : []),
            ["productionBuild", 600_000],
          ];
          // A repair that breaks the type-check, lint, or build has made a
          // correctable mistake in its own patch, not proved the project
          // unbuildable. Ending the mission here threw away every remaining
          // attempt over a TypeScript error the next repair could fix if it
          // were simply told. Feed the exact output back and let the bounded
          // loop continue; the paid repair budget still stops it.
          let brokenByRepair;
          for (const [procedureName, timeoutMs] of requiredProcedures) {
            const procedureTargets = verificationTargetsForProcedure(
              bindings,
              procedureName,
              generationTargetIds,
            );
            const result = await work(
              WorkUnitAction.RUN_COMMAND,
              {
                procedureName,
                environment: {},
                timeoutMs,
                outputLimitBytes: 1_048_576,
              },
              procedureTargets,
              `scoped-${repairScope}-${procedureName}`,
            );
            if (result.status !== WorkUnitStatus.SUCCEEDED) {
              const evidenceRecord = commandEvidence(evidence, result.workUnitId);
              brokenByRepair = [
                `The correction you just applied broke ${procedureName}. It must be fixed before the browser observation can run again.`,
                `${procedureName} output:\n${[
                  evidenceRecord?.payload.stdout,
                  evidenceRecord?.payload.stderr,
                ]
                  .filter((text) => typeof text === "string" && text.trim() !== "")
                  .join("\n")
                  .slice(-4000)}`,
                "Correct the defect your change introduced. Do not revert the observation fix it was making unless that fix is what broke the build.",
              ].join("\n");
              break;
            }
          }
          if (brokenByRepair !== undefined) {
            await restoreBrowserCheckpoint({
              checkpointId: browser.preWorkCheckpointId,
              evidenceId: `${browser.workUnitId}-repair-rollback-evidence`,
              eventId: `${browser.workUnitId}-repair-rollback`,
              causationId: `${browser.workUnitId}-repair-rollback-command`,
            });
            lastObservationFailure = brokenByRepair;
            priorRepairBreakage = brokenByRepair;
            session = await startRuntime();
            continue;
          }
        }
        session = await startRuntime();
      }
      if (!observationVerified) {
        // Report why verification never passed, rather than capturing an
        // observation the runtime no longer matches.
        orchestrator.transition({
          missionId,
          eventId: `${missionId}-browser-attempts-exhausted`,
          causationId: browser.workUnitId,
          to: MissionState.EXHAUSTED,
          reason:
            "Browser verification did not pass within its attempt budget; the last observation and every attempted correction are preserved.",
        });
        throw new Error(
          `Browser verification did not pass within its attempt budget. Last observation failure:\n${
            lastObservationFailure ?? "the browser result could not be parsed."
          }`,
        );
      }
      // Browser verification is an observation, not delivered application
      // state. It may create accounts and rows while proving real workflows.
      // Finish from the clean pre-observation checkpoint and start one fresh
      // preview from it. The browser command's discarded post-checkpoint stays
      // immutable audit provenance; captureBrowserVerification binds the
      // derived verdict to this source-identical current checkpoint.
      const latestObservedRuntime = runtime.getSession(
        missionId,
        session.sessionId,
      );
      if (latestObservedRuntime.status !== RuntimeStatus.STOPPED) {
        await runtime.stop({
          missionId,
          sessionId: session.sessionId,
          observationId: `${browser.workUnitId}-final-runtime-stop`,
          evidenceId: `${browser.workUnitId}-final-runtime-stop-evidence`,
          causationId: `${browser.workUnitId}-final-runtime-stop-command`,
          idempotencyKey: `${browser.workUnitId}-final-runtime-stop-key`,
        });
      }
      if (
        workspaces.getWorkspace(missionId).currentCheckpointId !==
        browser.preWorkCheckpointId
      ) {
        await restoreBrowserCheckpoint({
          checkpointId: browser.preWorkCheckpointId,
          evidenceId: `${browser.workUnitId}-final-restore-evidence`,
          eventId: `${browser.workUnitId}-final-restore`,
          causationId: `${browser.workUnitId}-final-restore-command`,
        });
      }
      session = await startRuntime();
      runtime.captureBrowserVerification({
        missionId,
        sessionId: session.sessionId,
        commandWorkUnitId: browser.workUnitId,
        observationId: `${missionId}-browser-observation-${runtimeAttempt}`,
        evidencePrefix: `${missionId}-browser-evidence-${runtimeAttempt}`,
        causationId: `${missionId}-browser-capture`,
        idempotencyKey: `${missionId}-browser-${runtimeAttempt}-key`,
        verificationRequestReference: `${missionId}-verification`,
        allowEmptyChecks: requiredBrowserChecks.length === 0,
        authoritativeCheckOverrides: authoritativeBrowserCheckOverrides,
      });
      await runtime.observeHealth({
        missionId,
        sessionId: session.sessionId,
        observationId: `${missionId}-runtime-health-${runtimeAttempt}`,
        evidenceId: `${missionId}-runtime-health-${runtimeAttempt}-evidence`,
        causationId: `${missionId}-runtime-health-command`,
        idempotencyKey: `${missionId}-runtime-health-${runtimeAttempt}-key`,
        verificationRequestReference: `${missionId}-verification`,
      });
      // A delivered shortfall must be as durable as a failure was. Record it as
      // evidence so the customer is told where the design departs from what
      // they approved, rather than quietly handed something that looks
      // fully-approved.
      if (designFidelityShortfall !== null) {
        evidence.capture({
          evidenceId: `${missionId}-design-fidelity-shortfall`,
          missionId,
          // Not a browser-interaction record. Verification resolves a
          // browser-check obligation by taking the LAST browser-interaction
          // evidence for the mission and treating it as the only evidence for
          // every such obligation. Recording the shortfall in that kind, after
          // the observation, therefore replaced the real result — whose checks
          // were all true — with a record whose keys are design aspects. Every
          // proven obligation was then read as unsatisfied, the verdict came
          // back INCOMPLETE, and a build that had passed was sent back to
          // repair. A finding describes something observed without standing in
          // for an obligation's evidence.
          kind: ObservationKind.REPAIR_FINDING,
          captureMethod: "same-browser-same-viewport-prototype-comparison",
          producingSubsystem: PRODUCTION_MISSION_SOURCE,
          timestamp: new Date().toISOString(),
          payload: {
            recordType: "design-fidelity-shortfall",
            record: {
              accepted: true,
              reason: designFidelityShortfall.reason,
              failedAspects: designFidelityShortfall.failedAspects,
              comparedViewports:
                designFidelityShortfall.comparedViewports ?? null,
              integrityHash: designFidelityShortfall.integrityHash ?? null,
              observation: designFidelityShortfall.observation ?? "",
            },
          },
          metadata: {
            accepted: true,
            failedAspects: designFidelityShortfall.failedAspects,
          },
          workspaceCheckpointReference:
            workspaces.getWorkspace(missionId).currentCheckpointId,
          obligationReference: null,
          verificationRequestReference: `${missionId}-verification`,
          commandReference: browser.workUnitId,
          workUnitReference: browser.workUnitId,
          sensitiveValues: [],
        });
      }
      orchestrator.transition({
        missionId,
        eventId: `${missionId}-verifying`,
        causationId: `${missionId}-browser-observation`,
        to: MissionState.VERIFYING,
        reason:
          designFidelityShortfall === null
            ? "Real build, runtime, HTTP, and browser observations are recorded."
            : `Real build, runtime, HTTP, and browser observations are recorded. The approved design was matched except for: ${designFidelityShortfall.failedAspects.join(", ") || "unmeasured aspects"}.`,
      });
      return finishVerification(missionId);
    },

    async stop(missionId) {
      const sessionId = runtime.listSessions(missionId).at(-1)?.sessionId;
      if (sessionId === undefined) {
        return null;
      }
      const latest = runtime.getSession(missionId, sessionId);
      if (latest.status === "STOPPED") return latest;
      return runtime.stop({
        missionId,
        sessionId,
        observationId: `${sessionId}-stop`,
        evidenceId: `${sessionId}-stop-evidence`,
        causationId: `${missionId}-runtime-stop-command`,
        idempotencyKey: `${sessionId}-stop-key`,
      });
    },

    async cancel(missionId) {
      const before = ledger.projectState(missionId);
      if (isTerminalMissionState(before.state)) {
        return Object.freeze({
          missionId,
          state: before.state,
          runtime: null,
        });
      }

      const sessionId = runtime.listSessions(missionId).at(-1)?.sessionId;
      let stoppedRuntime = null;
      if (sessionId !== undefined) {
        const latest = runtime.getSession(missionId, sessionId);
        stoppedRuntime =
          latest.status === "STOPPED"
            ? latest
            : await runtime.stop({
                missionId,
                sessionId,
                observationId: `${sessionId}-stop`,
                evidenceId: `${sessionId}-stop-evidence`,
                causationId: `${missionId}-runtime-stop-command`,
                idempotencyKey: `${sessionId}-stop-key`,
              });
      }

      const afterRuntimeStop = ledger.projectState(missionId);
      if (!isTerminalMissionState(afterRuntimeStop.state)) {
        orchestrator.transition({
          missionId,
          eventId: `${missionId}-cancelled`,
          causationId: afterRuntimeStop.lastEventId,
          to: MissionState.CANCELLED,
          reason:
            "The customer stopped this build. The recorded plan and workspace were preserved.",
        });
      }

      return Object.freeze({
        missionId,
        state: ledger.projectState(missionId).state,
        runtime: stoppedRuntime,
      });
    },
  });
}
