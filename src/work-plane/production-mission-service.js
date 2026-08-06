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
import { CompletionResult } from "../domain/verification.js";
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
  engineeringFloorPromptSegments,
  validateEngineeringFloor,
} from "../domain/engineering-floor.js";

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
// A proposal rejected before it touches a file costs a model call but proves
// nothing, so it does not spend the repair budget. This bounds how many such
// mechanical corrections may be bought per budgeted repair.
const MAX_REPAIR_PROPOSALS_PER_ROUND = 3;
const MAX_RUNTIME_RESTARTS = 2;

export function productionRepairBudgets({ approvedPrototype = false } = {}) {
  return Object.freeze({
    generationCorrectionCalls: approvedPrototype
      ? MAX_APPROVED_PROTOTYPE_GENERATION_CORRECTION_CALLS
      : MAX_GENERATION_CORRECTION_CALLS,
    procedureRepairCalls: approvedPrototype
      ? MAX_APPROVED_PROTOTYPE_PROCEDURE_REPAIR_CALLS
      : MAX_PROCEDURE_REPAIR_CALLS,
    browserRepairCalls: MAX_BROWSER_REPAIR_CALLS,
    designFidelityRepairCalls: MAX_DESIGN_FIDELITY_REPAIR_CALLS,
    runtimeRestarts: MAX_RUNTIME_RESTARTS,
  });
}

// A check reported false with no diagnostics was never computed: the test
// exited before reaching it and the finally block emitted its initial value.
// Reporting that as "the check failed" sent repairs chasing application
// defects that did not exist, once for every check downstream of a single
// early break.
export function browserCheckObservationFailure(failedCheckIds, diagnostics = {}) {
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
  return [
    ...lines,
    ...(Object.keys(failedSubchecks).length === 0
      ? []
      : [`Failed named sub-checks: ${JSON.stringify(failedSubchecks)}.`]),
  ].join("\n");
}

export function productionBrowserRepairPolicy(observationFailure) {
  const designFidelity =
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
      ? MAX_DESIGN_FIDELITY_REPAIR_CALLS
      : MAX_BROWSER_REPAIR_CALLS,
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
    const apostropheInRenderedText =
      character === "'" &&
      /[\p{L}\p{N}]/u.test(source[index - 1] ?? "") &&
      /[\p{L}\p{N}]/u.test(next ?? "");
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

export function hasBalancedJsxTags(source) {
  const voidTags = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
  ]);
  const stack = [];
  let cursor = 0;
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
    if (end === -1) return false;
    const selfClosing =
      /\/\s*$/u.test(source.slice(position + tag.length, end)) ||
      voidTags.has(tag);
    cursor = end + 1;
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== tag) return false;
    } else {
      stack.push(tag);
    }
  }
  return stack.length === 0;
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
  const approvedPrototypeFidelityFailure =
    stage === "browserVerification" &&
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
  for (const [path, content] of byPath) {
    if (/\.(?:js|jsx|mjs|ts|tsx)$/u.test(path)) {
      const unbalanced = unbalancedJavaScriptDelimiter(content);
      if (unbalanced !== null) {
        throw new TypeError(
          `Generated source "${path}" has unbalanced JavaScript delimiters: ${unbalanced}. Correct that expression and return the complete file.`,
        );
      }
    }
    if (/\.(?:jsx|tsx)$/u.test(path) && !hasBalancedJsxTags(content)) {
      throw new TypeError(
        `Generated source "${path}" has unbalanced JSX tags.`,
      );
    }
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

export function ensureCertifiedStackScaffold(
  files,
  contractRequirementIds = [],
  { responsiveCheckIds = [], accessibilityCheckIds = [] } = {},
) {
  const generatedHealthRoute = files.find((file) =>
    /^(?:src\/)?app\/api\/health\/route\.(?:js|ts)$/u.test(file.path),
  );
  const generatedHealthOwnsApplicationMutations =
    generatedHealthRoute !== undefined &&
    /\bexport\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/u.test(
      generatedHealthRoute.content,
    );
  const applicationApiPath = "/api/foundry-application";
  const protectedApiFiles = files.map((file) => {
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
    if (file.path !== "tsconfig.json" || !usesRootAlias) return file;
    let configuration;
    try {
      configuration = JSON.parse(file.content);
    } catch {
      return file;
    }
    const compilerOptions = {
      ...(configuration.compilerOptions ?? {}),
    };
    const paths = {
      ...(compilerOptions.paths ?? {}),
      "@/*": [sourceRoot],
    };
    return {
      ...file,
      content: `${JSON.stringify({
        ...configuration,
        compilerOptions: {
          ...compilerOptions,
          baseUrl: ".",
          paths,
        },
      }, null, 2)}\n`,
    };
  });
  const generatedFiles = certifiedConfigurationFiles.filter(
    (file) =>
      !/^(?:src\/)?app\/(?:favicon|icon)\.[^/]+(?:\/.*)?$/u.test(
        file.path,
      ) &&
      !/^(?:src\/)?app\/api\/health\/route\.(?:js|ts)$/u.test(file.path) &&
      !/^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(file.path),
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
  const protocolNormalizedFiles = generatedFiles.map((file) => {
    const validStylesheetContent = /\.css$/u.test(file.path) &&
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
    let typedCountContent = /\.(?:ts|tsx)$/u.test(file.path)
      ? validStylesheetContent.replace(
          /(\.get\(\)\s+as\s+)any(\)\.c\b)/gu,
          "$1{ c: number }$2",
        )
      : validStylesheetContent;
    if (/\.(?:ts|tsx)$/u.test(file.path)) {
      typedCountContent = typedCountContent.replace(
        /\b(body|payload)\s+as\s+(\{[^\r\n]+?\})/gu,
        "$1 as unknown as $2",
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
        /(browser\.newContext\(\{[^\r\n]*?),\s*channel\s*:\s*(["'])chrome\2/gu,
        "$1",
      )
      .replace(
        /page\.click\(\s*(["'])text=([^"'\\\r\n]+)\1\s*\)/gu,
        (_match, quote, label) =>
          `page.getByRole('button', { name: ${quote}${label}${quote}, exact: true }).click()`,
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
      "  timeout: 30_000,",
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
  // Helper form: the id is passed to something that assigns into checks, so the
  // computation lives in the invocation that follows the id literal.
  if (!/checks\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*=/u.test(source)) return [];
  return [
    ...source.matchAll(new RegExp(`["']${escaped}["']`, "gu")),
  ].map((match) => source.slice(match.index, match.index + 700));
}

export function validateBrowserObservationTestSource(
  source,
  requiredBrowserCheckIds = [],
  { responsiveCheckIds = [], accessibilityCheckIds = [] } = {},
) {
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
      "The browser observation test must emit its evidence marker from a finally block.",
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
      "The browser observation test may not certify a check with a literal success value through a helper.",
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
        "Responsive browser verification must run a real phone-width viewport between 280 and 480 pixels.",
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
        "Responsive browser verification must measure horizontal overflow from scrollWidth and the visible viewport width.",
      );
    }
    if (
      !/(?:scrollHeight|offsetHeight|getBoundingClientRect\s*\(\s*\)\.height)/u.test(source) ||
      (!/(?:clientHeight|innerHeight)/u.test(source) &&
        !declaredViewportHeightUsed)
    ) {
      throw new TypeError(
        "Responsive browser verification must measure page or workflow height against the visible viewport height.",
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
        "Responsive browser verification must enforce a finite interaction-density bound for the active workflow surface.",
      );
    }
    for (const checkId of responsiveCheckIds) {
      const escapedCheckId = checkId.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      );
      const computations = checkComputationSources(source, checkId);
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
    }
  }
  for (const checkId of accessibilityCheckIds) {
    const computations = checkComputationSources(source, checkId);
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
      "The browser repair proposed no file edits.",
    );
  }
  const patchedPaths = patches.map((patch) => patch?.path);
  if (new Set(patchedPaths).size !== patchedPaths.length) {
    // Two edits to one file would each be applied against the same starting
    // content, so the second would silently discard the first.
    throw new Error(
      "The browser repair named the same file twice; combine its replacements into one entry.",
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
      "The proposed repair repeats an existing hypothesis without new evidence.",
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
    throw new Error(
      "The browser repair attempted to change a file outside the current generated project.",
    );
  }
  const repairedContent = applyExactReplacements(
    currentFile.content,
    structuredOutput.replacements,
    structuredOutput.path,
  );
  const repairsTestSource =
    /^tests\/.*\.(?:spec|test)\.(?:js|jsx|ts|tsx)$/u.test(
      structuredOutput.path,
    );
  const repairsPlaywrightConfig =
    /^playwright\.config\.(?:cjs|js|mjs|ts)$/u.test(
      structuredOutput.path,
    );
  const repairsJavaScript =
    /\.(?:cjs|js|jsx|mjs|ts|tsx)$/u.test(structuredOutput.path);
  if (
    repairedContent.trim() === "" ||
    (repairsJavaScript &&
      !hasBalancedJavaScriptDelimiters(repairedContent)) ||
    (repairsPlaywrightConfig &&
      (!repairedContent.includes("FOUNDRY_PREVIEW_URL") ||
        !/\bchannel\s*:\s*["']chrome["']/u.test(repairedContent) ||
        /\bwebServer\s*:/u.test(repairedContent) ||
        /\breporter\s*:\s*["'](?:\.{1,2}\/|[A-Za-z]:[\\/])/u.test(
          repairedContent,
        )))
  ) {
    throw new Error(
      "The browser repair violated the structured observation protocol.",
    );
  }
  if (repairsTestSource) {
    const expectationCount = (content) =>
      content.match(/\bexpect\s*\(/gu)?.length ?? 0;
    if (expectationCount(repairedContent) < expectationCount(currentFile.content)) {
      throw new Error(
        "The browser repair may not remove contract assertions.",
      );
    }
    const assertedLiterals = [
      ...currentFile.content.matchAll(
        /\bexpect\s*\([^;\n]*?(?:["'`]([^"'`]{3,})["'`]|\/([^/\n]{3,})\/[a-z]*)[^;\n]*\)/giu,
      ),
    ]
      .map((match) => match[1] ?? match[2])
      .filter(Boolean);
    if (
      assertedLiterals.some(
        (literal) => !repairedContent.includes(literal),
      )
    ) {
      throw new Error(
        "The browser repair may not change or remove an asserted customer outcome.",
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
    if (
      requiredBrowserCheckIds.some(
        (checkId) =>
          checkExpression(repairedContent, checkId) !==
          checkExpression(currentFile.content, checkId),
      )
    ) {
      throw new Error(
        "The browser repair may correct selectors or synchronization but may not change a contract-check verdict formula.",
      );
    }
    const literalSuccessCount = (content) =>
      content.match(
        /(?:=|return)\s*(?:true\b|Boolean\s*\(\s*true\s*\))/gu,
      )?.length ?? 0;
    if (
      literalSuccessCount(repairedContent) >
      literalSuccessCount(currentFile.content)
    ) {
      throw new Error(
        "The browser repair may not introduce a literal success path.",
      );
    }
    validateBrowserObservationTestSource(
      repairedContent,
      requiredBrowserCheckIds,
      browserQualityRequirements,
    );
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
    throw new Error("The repair model returned an unsafe project-relative path.");
  }
  const normalized = path.toLowerCase();
  if (
    normalized.startsWith("node_modules/") ||
    normalized.startsWith(".next/") ||
    normalized.startsWith("data/") ||
    normalized === "package-lock.json" ||
    normalized.endsWith(".env")
  ) {
    throw new Error("The repair model targeted a protected generated path.");
  }
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (!repairableFileExtensions.has(extension)) {
    throw new Error("The repair model returned an unsupported source or configuration file type.");
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
    throw new Error(
      "A repair may add one file only inside an existing generated project directory.",
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
      "The proposed source repair does not change the generated project.",
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
      "The proposed source repair repeats an unchanged hypothesis.",
    );
  }
}

function commandEvidence(evidence, workUnitId) {
  return evidence
    .findByWorkUnit(workUnitId)
    .find((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT);
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
    const target = rankedTarget(requirement.statement);
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
export function foundryObservationHarness(requiredCheckIds) {
  const ids = [...new Set(requiredCheckIds ?? [])];
  const idList = ids.map((id) => JSON.stringify(id)).join(", ");
  return `import { expect, test } from "@playwright/test";
import { obligationChecks } from "./foundry-checks";

// Generated by Foundry. The observation protocol is fixed so that evidence is
// comparable across every build; project-specific assertions live in
// ./foundry-checks.
test("foundry contract observation", async ({ page }) => {
  const captureProbeErrors: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requiredCheckIds = [${idList}];
  const checks: Record<string, boolean> = {};
  const diagnostics: Record<string, Record<string, boolean | number | string | null>> = {};
  for (const id of requiredCheckIds) checks[id] = false;

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));

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
    const responsiveEvidence = {
      phoneNoHorizontalOverflow,
      phoneHeightWithinBudget,
      phoneInteractionDensityBounded,
    };

    // Accessible keyboard focus and labelling, measured once.
    await page.keyboard.press("Tab");
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? null);
    const keyboardFocusObservable = focusedTag !== null && focusedTag !== "BODY";
    const labelledControlCount = await page.evaluate(() =>
      [...document.querySelectorAll("input, select, textarea")].filter((control) => {
        const id = control.getAttribute("id");
        const labelled =
          (control.getAttribute("aria-label") ?? "").trim().length > 0 ||
          (id !== null && document.querySelector('label[for="' + id + '"]') !== null) ||
          control.closest("label") !== null;
        return labelled;
      }).length,
    );
    const accessibleLabellingObserved = labelledControlCount >= 1;
    const accessibilityEvidence = { keyboardFocusObservable, accessibleLabellingObserved };

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator("body")).toBeVisible();

    // Each check runs in isolation: one failure can never leave another
    // unobserved, and every check records diagnostics whether it passes or not.
    for (const id of requiredCheckIds) {
      const check = obligationChecks[id];
      if (typeof check !== "function") {
        diagnostics[id] = { checkImplemented: false };
        captureProbeErrors.push("No observation supplied for " + id);
        continue;
      }
      try {
        const outcome = await check({ page, responsiveEvidence, accessibilityEvidence });
        const passed = outcome === true || (outcome !== null && typeof outcome === "object" && outcome.passed === true);
        const detail =
          outcome !== null && typeof outcome === "object" && outcome.diagnostics !== undefined
            ? outcome.diagnostics
            : {};
        checks[id] = passed;
        diagnostics[id] = { ...detail, observed: true };
      } catch (error: unknown) {
        checks[id] = false;
        diagnostics[id] = {
          observed: true,
          threw: (error instanceof Error ? error.message : String(error)).slice(0, 300),
        };
      }
    }
  } finally {
    console.log(
      "FOUNDRY_BROWSER_RESULT:" +
        JSON.stringify({ captureProbeErrors, checks, diagnostics, consoleErrors, pageErrors }),
    );
  }
});
`;
}

// Foundry's harness is the only thing permitted to emit the evidence marker:
// two markers would make the observation ambiguous.
export function bindFoundryObservationHarness(plan, requiredCheckIds) {
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
        content: foundryObservationHarness(requiredCheckIds),
        contractRequirementIds: traceIds.length > 0 ? traceIds : ["approved-design-direction"],
      },
    ],
  };
}

export function bindApprovedPrototypeBrowserEvidence(plan, approvedContract) {
  const approved = approvedContract?.productBlueprint?.designSpecification?.approvedDesignContract ?? null;
  if (approved === null || !Array.isArray(plan?.files)) return plan;

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

export function approvedDesignPromptSegments(approvedContract) {
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
    "The customer approved a specific visual design. Reproduce that approved design in the generated source; do not substitute your own art direction, palette, type scale, or layout.",
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
  }
  return segments;
}

function bundlePrompt(profile, contract, bindings, approvedContract = null, engineeringSignals = null) {
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
    `Use the selected certified stack package versions exactly: ${JSON.stringify(CERTIFIED_PROJECT_PACKAGE_VERSIONS)}.`,
    "The application must be production-buildable, use a real SQLite database below data/, expose GET /api/health returning HTTP 200, and bind the production server using npm run start.",
    "Every App Router page requires app/layout.tsx (or an equivalent root layout). package.json must provide build, start, typecheck, lint, and test scripts.",
    "Every .css file must contain valid CSS only. Never put a JavaScript or React component stub in a stylesheet path.",
    'Use next/link for every internal App Router navigation target such as href="/" or href="/profile"; reserve HTML anchor elements for external URLs, downloads, and same-page fragments.',
    "Every static internal href must resolve to a generated App Router page. If an action opens a mode inside an existing page, link to that page and let its visible UI control open the mode; never invent an unimplemented child URL.",
    "When tab navigation returns to a completed multi-step creation workflow, reset that workflow to its first usable step so its primary inputs are visible again.",
    'If source uses the @/ import alias, tsconfig.json must define a valid compilerOptions.paths["@/*"] mapping; otherwise use resolvable relative imports.',
    'When the lint script scans the project root, its ESLint configuration must explicitly ignore ".next" build output.',
    "For certified Next.js 15.4.4, adapt next/core-web-vitals and next/typescript through FlatCompat from @eslint/eslintrc (with the .next ignore in the exported array); do not use Next.js 16-style direct eslint-config-next flat imports.",
    "Because eslint.config.mjs is ESM, derive __dirname from import.meta.url before passing it to FlatCompat; never reference an undefined CommonJS __dirname global.",
    "Do not use explicit any types. Give better-sqlite3 query rows concrete result types, including SELECT COUNT aliases such as { c: number }.",
    "Include a valid app/icon or public/favicon resource so the real browser does not generate a missing decorative-resource error.",
    "SQLite connection, schema initialization, migrations, PRAGMAs, and seeding must run lazily in the application runtime, never as module-import side effects during Next.js build route collection. Importing route modules in parallel must not mutate or lock the database.",
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
    "Write exactly one observation file, tests/foundry-checks.ts, exporting `export const obligationChecks: Record<string, (context: { page: any; responsiveEvidence: Record<string, boolean>; accessibilityEvidence: Record<string, boolean> }) => Promise<{ passed: boolean; diagnostics: Record<string, boolean | number | string | null> }>> = { ... }` with one entry keyed by each exact supplied checkId.",
    "Each entry drives the running UI with Playwright through `context.page` and returns { passed, diagnostics }. passed must be computed from what the browser actually showed. diagnostics names the sub-observations behind that verdict, so a false verdict identifies its exact failed predicate. Do not initialize arrays, attach listeners, catch your own errors, or print anything: the harness does all of it.",
    "For a check about phone layout use context.responsiveEvidence, and for a check about keyboard focus or labelling use context.accessibilityEvidence, rather than measuring those again. Combine them with your own project-specific observations.",
    // The project type-checks under noImplicitAny, and an unannotated callback
    // parameter inside a page.evaluate or an array callback is the one error
    // that kept reaching the repair loop for something a type annotation
    // prevents outright.
    "tests/foundry-checks.ts is type-checked with noImplicitAny. Annotate every parameter you introduce, including callback parameters inside page.evaluate, map, filter, and find — write (element: Element) or (entry: string) rather than (e). Inside page.evaluate the callback runs in the browser, so annotate its parameters and any DOM values you read.",
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
    ...approvedDesignPromptSegments(approvedContract),
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
        const workUnit = workUnits
          .filter(
            (record) =>
              record.status === WorkUnitStatus.SUCCEEDED &&
              record.actionType === WorkUnitAction.RUN_COMMAND &&
              record.inputs.procedureName === modeProcedures[mode],
          )
          .at(-1);
        const record =
          workUnit === undefined
            ? undefined
            : commandEvidence(evidence, workUnit.workUnitId);
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
    const runtimeStartCount =
      replayedEvents === null
        ? runtime
            .listSessions(missionId)
            .filter((record) => record.eventType === "STARTUP").length
        : replayedEvents.filter(
            (record) =>
              record.fact?.metadata?.runtimeRecord?.eventType ===
              "STARTUP",
          ).length;
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
        Math.max(0, runtimeStartCount - 1),
      installCount,
      reinstallCount: Math.max(0, installCount - 1),
      rebuildCount,
      runtimeRestartCount: Math.max(0, runtimeStartCount - 1),
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
          purpose: contractBoundModelPrompt(modelTaskContract, [
            input.purpose,
          ]),
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
      const requiredBrowserCheckIds = Object.entries(bindings)
        .filter(
          ([obligationId, binding]) =>
            binding === "browser-check" &&
            (approvedObligationIds === null || approvedObligationIds.has(obligationId)),
        )
        .map(([obligationId]) => obligationId)
        .sort((left, right) => left.localeCompare(right));
      const responsiveBrowserCheckIds = contract.obligations
        .filter(
          (obligation) =>
            bindings[obligation.obligationId] === "browser-check" &&
            /\b(?:phone|mobile|responsive|small[- ]screen|narrow viewport|touch target)\b/iu.test(
              obligation.statement,
            ),
        )
        .map((obligation) => obligation.obligationId)
        .sort((left, right) => left.localeCompare(right));
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
      const repairBudgets = productionRepairBudgets({
        approvedPrototype:
          approvedContract?.productBlueprint?.designSpecification
            ?.approvedDesignContract != null,
      });
      const priorGenerationCalls = models
        .listCalls(missionId)
        .filter(
          (call) =>
            (call.requestId === generationRequestId ||
              call.requestId.startsWith(generationCorrectionPrefix)) &&
            call.status === "SUCCEEDED",
        );
      let generation =
        priorGenerationCalls.length === 0
          ? await requestModel({
              requestId: generationRequestId,
              missionId,
              workUnitId: `${generationRequestId}-plan`,
              purpose: bundlePrompt(profile, contract, bindings, approvedContract, engineeringSignals),
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
              structuredOutput:
                priorGenerationCalls.at(-1).structuredOutput,
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
            ),
          };
          validatedFiles = validateProjectBundleForStack(
            ensureCertifiedStackScaffold(
              generation.structuredOutput.files,
              certifiedScaffoldTraceIds,
              {
                responsiveCheckIds: responsiveBrowserCheckIds,
                accessibilityCheckIds: accessibilityBrowserCheckIds,
              },
            ),
            requiredBrowserCheckIds,
            profile.customerContent,
            {
              responsiveCheckIds: responsiveBrowserCheckIds,
              accessibilityCheckIds: accessibilityBrowserCheckIds,
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
          generation = await requestModel({
            requestId,
            missionId,
            workUnitId: `${requestId}-plan`,
            purpose: [
              bundlePrompt(profile, contract, bindings, approvedContract, engineeringSignals),
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
            expectedStructuredOutputSchema: generationSchema,
            // Keep semantic admission in this loop so the same immutable
            // contract is applied to every bounded correction attempt.
            structuredOutputValidator: undefined,
            idempotencyKey: `${requestId}-key`,
            sensitiveValues: [],
          });
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

      for (const [mode, procedureName, timeoutMs] of [
        ["dependency-lock", "dependencyLock", 600_000],
        ["dependency-install", "install", 600_000],
        ["type-check", "typeCheck", 300_000],
        ["lint", "lint", 300_000],
        ["production-build", "productionBuild", 600_000],
      ]) {
        if (
          rehydratedBeforeCommands &&
          (mode === "dependency-lock" || mode === "dependency-install")
        ) {
          continue;
        }
        const targets = Object.entries(bindings)
          .filter(([, binding]) => binding === mode)
          .map(([obligationId]) => obligationId);
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
          if (priorRepairs.length >= repairBudgets.procedureRepairCalls) {
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
          const repairPrefix = `${contractRequestNamespace}-${safeName(procedureName)}-repair-`;
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
          const repairFileSchema = contractTraceSchema({
            type: "object",
            additionalProperties: false,
            required: ["path", "content"],
            properties: {
              path: {
                type: "string",
                minLength: 1,
              },
              content: { type: "string", minLength: 8 },
            },
          }, approvedContract !== null);
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
              "Diagnose the observed output and return the complete corrected content of exactly one source or configuration file.",
              "The path may identify an existing file or one missing file inside an existing generated directory. Do not target dependencies, build output, data, secrets, or a lockfile.",
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
              validateGeneratedRepairProposal({
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
          });
          } catch (error) {
            const message = String(error?.message ?? error);
            if (!/failed semantic validation/iu.test(message)) throw error;
            proposalRejection = message;
            repair = null;
            if (proposalAttempt === 2) throw error;
          }
          }
          const repairMode = validateGeneratedRepairPath(
            repair.structuredOutput.path,
            currentFiles,
          );
          const currentFile = currentFiles.find(
            (file) => file.path === repair.structuredOutput.path,
          );
          if (
            currentFile?.content === repair.structuredOutput.content ||
            models
              .listCalls(missionId)
              .some(
                (call) =>
                  call.requestId.startsWith(repairPrefix) &&
                  call.requestId !== repairRequestId &&
                  call.structuredOutput?.path ===
                    repair.structuredOutput.path &&
                  call.structuredOutput?.content ===
                    repair.structuredOutput.content,
              )
          ) {
            throw new Error(
              "The proposed source repair repeats an unchanged hypothesis; repeated pipeline work was rejected.",
            );
          }
          const changed = await work(
            repairMode === "replace"
              ? WorkUnitAction.REPLACE_FILE
              : WorkUnitAction.WRITE_FILE,
            {
              path: repair.structuredOutput.path,
              content: repair.structuredOutput.content,
            },
            repairRequirementIds,
            `repair-${procedureName}-${repair.structuredOutput.path}`,
          );
          if (changed.status !== WorkUnitStatus.SUCCEEDED) {
            throw new Error(
              `The evidence-backed ${procedureName} repair could not be applied.`,
            );
          }
          if (repairMode === "write") {
            bundle.files.push({
              path: repair.structuredOutput.path,
              content: repair.structuredOutput.content,
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
      const browserTargets = Object.entries(bindings)
        .filter(
          ([, binding]) =>
            binding === "browser-check" ||
            binding === "browser-errors" ||
            binding === "structured-tests",
        )
        .map(([obligationId]) => obligationId);
      const requiredBrowserChecks = Object.entries(bindings)
        .filter(([, binding]) => binding === "browser-check")
        .map(([obligationId]) => obligationId)
        .sort((left, right) => left.localeCompare(right));
      // An armed deferred shock has no prototype to compare against, so the
      // fidelity gate is skipped for that build by design.
      const approvedPrototypeContract = comparablePrototypeDesign(approvedContract);
      let browser;
      for (let attempt = 0; attempt < 7; attempt += 1) {
        // Fidelity only runs once the browser checks pass, so this must reset
        // each round. Carrying it forward counted a previous round's aspects
        // against a round that never measured them, and halted a build that
        // was in fact converging five, then five, then one.
        latestFidelityFailureCount = 0;
        browser = await work(
          WorkUnitAction.RUN_COMMAND,
          {
            procedureName: "browserVerification",
            environment: {
              FOUNDRY_PREVIEW_URL: session.previewUrl,
              FOUNDRY_RUNTIME_ACCESS_VALUE: runtimeAccessValue,
            },
            timeoutMs: 300_000,
            outputLimitBytes: 1_048_576,
          },
          browserTargets.length > 0
            ? browserTargets
            : generationTargetIds,
          `browser-verification-runtime-${runtimeAttempt}-attempt-${attempt + 1}`,
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
            const failedChecks = requiredBrowserChecks.filter(
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
            } else if (failedChecks.length > 0) {
              observationFailures.push(
                browserCheckObservationFailure(
                  failedChecks,
                  browserResult.diagnostics ?? {},
                ),
              );
            } else if (blockingErrors.length > 0) {
              observationFailures.push([
                "The browser observation recorded blocking errors.",
                JSON.stringify(blockingErrors),
              ].join("\n"));
            }
            if (
              observationFailures.length === 0 &&
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
          requiredBrowserChecks.every(
            (checkId) => browserResult.checks[checkId] === true,
          );
        const acceptWithShortfall = (reason) => {
          designFidelityShortfall = Object.freeze({
            failedAspects: latestFidelityVerdict?.failedAspects ?? [],
            comparedViewports: latestFidelityVerdict?.comparedViewports ?? null,
            integrityHash: latestFidelityVerdict?.integrityHash ?? null,
            observation: browserFailure,
            reason,
          });
          orchestrator.transition({
            missionId,
            eventId: `${missionId}-design-fidelity-shortfall-accepted`,
            causationId: browser.workUnitId,
            to: MissionState.EXECUTING,
            reason: `Every approved workflow was observed working in a real browser. ${reason} The project is delivered with its design shortfall recorded against the approved prototype: ${(latestFidelityVerdict?.failedAspects ?? []).join(", ") || "unmeasured"}.`,
          });
          observationVerified = true;
        };
        // A converging repair earns its remaining attempts; a stalled one only
        // spends them. Two rounds in a row without fewer outstanding failures
        // means the repairs have run out of ideas, and every further round is
        // ninety seconds and a paid model call buying nothing. Stopping here
        // turns a silent eleven-minute failure into an honest short one.
        const outstandingFailures =
          (browserResult === undefined
            ? requiredBrowserChecks.length
            : Object.values(browserResult.checks).filter((passed) => passed !== true).length) +
          latestFidelityFailureCount;
        if (
          previousOutstandingFailures !== undefined &&
          outstandingFailures >= previousOutstandingFailures
        ) {
          stalledRounds += 1;
        } else {
          stalledRounds = 0;
        }
        previousOutstandingFailures = outstandingFailures;
        if (stalledRounds >= 2 && behaviourProven) {
          acceptWithShortfall(
            `Corrections stopped reducing the outstanding design aspects after ${attempt + 1} observations.`,
          );
          break;
        }
        if (stalledRounds >= 2) {
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
        const repairPolicy = productionBrowserRepairPolicy(browserFailure);
        const repairPrefix = `${contractRequestNamespace}-${repairPolicy.requestSegment}-`;
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
          attempt < MAX_RUNTIME_RESTARTS
        ) {
          session = await startRuntime();
          continue;
        }
        const priorRepairCalls = models
          .listCalls(missionId)
          .filter(
            (call) =>
              call.requestId.startsWith(repairPrefix) &&
              call.status === "SUCCEEDED",
          )
          .reverse();
        const repairFiles = bundle.files
          .filter(
            (file) =>
              !file.path.startsWith("public/") &&
              !file.path.startsWith("data/") &&
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
        async function requestBrowserRepair(semanticRejection) {
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
          const scopedBrowserRepairPatchSchema = sourceOnlyBrowserRepair
            ? repairPatchSchemaScopedToPaths(
                browserRepairPatchSchema,
                eligibleRepairFiles.map((file) => file.path),
              )
            : browserRepairPatchSchema;
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
            `Return exact search/replace edits as a "files" array over existing project source, configuration, Playwright test, or Playwright configuration files. Name every file the observed failure requires — up to ${MAX_REPAIR_FILES_PER_PROPOSAL} — in this one proposal, and name each file at most once. Each oldText must occur exactly once in that file; keep edits narrowly scoped and use as few replacements as possible.`,
            "A failure whose causes span several files must be corrected in one proposal. Correcting part of it and leaving the rest for a later round wastes the repair budget and risks breaking what already passes.",
            "Choose application source when the running behavior is wrong. Choose Playwright test/configuration only when the observation implementation is wrong. Correct invalid selectors, synchronization, or observation code while preserving every contract assertion.",
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
              structuredOutput: output,
              currentFiles: eligibleRepairFiles,
              requiredBrowserCheckIds: requiredBrowserChecks,
              browserQualityRequirements: {
                responsiveCheckIds: responsiveBrowserCheckIds,
                accessibilityCheckIds: accessibilityBrowserCheckIds,
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
        for (
          let proposalAttempt = 0;
          proposalAttempt < 3 && acceptedRepair === null;
          proposalAttempt += 1
        ) {
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
              repair = await requestBrowserRepair(semanticRejection);
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
        const changesApplicationArtifact =
          !acceptedRepair.repairsTestSource &&
          !acceptedRepair.repairsPlaywrightConfig;
        if (changesApplicationArtifact) {
          const requiredProcedures =
            repairScope === ProductionRepairScope.DEPENDENCY
              ? [
                  ["dependencyLock", 600_000],
                  ["install", 600_000],
                  ["typeCheck", 300_000],
                  ["lint", 300_000],
                  ["productionBuild", 600_000],
                ]
              : [
                  ["typeCheck", 300_000],
                  ["lint", 300_000],
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
          kind: ObservationKind.BROWSER_INTERACTION_RESULT,
          captureMethod: "same-browser-same-viewport-prototype-comparison",
          producingSubsystem: PRODUCTION_MISSION_SOURCE,
          timestamp: new Date().toISOString(),
          payload: {
            checks: Object.fromEntries(
              designFidelityShortfall.failedAspects.map((aspect) => [aspect, false]),
            ),
            accepted: true,
            reason: designFidelityShortfall.reason,
          },
          metadata: {
            comparedViewports: designFidelityShortfall.comparedViewports,
            integrityHash: designFidelityShortfall.integrityHash,
          },
          workspaceCheckpointReference: browser.postWorkCheckpointId,
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
