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
  contractBoundModelPrompt,
  createModelTaskContract,
  deriveContractRoutingRequirements,
  validateContractBoundMissionPlan,
  validateContractRequirementTrace,
} from "../domain/contract-bound-execution.js";
import { validateApprovedProjectContractConsistency } from "../domain/approved-project-contract.js";

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

export function hasBalancedJavaScriptDelimiters(source) {
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
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (opening.has(character)) {
      stack.push(character);
    } else if (character in pairs && stack.pop() !== pairs[character]) {
      return false;
    }
  }
  return (
    stack.length === 0 &&
    quote === null &&
    !blockComment &&
    !regularExpression
  );
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
    /(?:FOUNDRY_BROWSER_RESULT|structured browser result|could not be parsed|exactly the required browser-check)/iu.test(
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

const browserRepairPatchSchema = Object.freeze({
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
});

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
  );
  validateCustomerContentIntegrity(files, customerContent);
  return Object.freeze(
    files.map((file) =>
      Object.freeze({ path: file.path, content: file.content }),
    ),
  );
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
    if (
      /\bmailto:[^"'`\s<]+|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(
        applicationText,
      )
    ) {
      violations.push("email address");
    }
    if (
      /\btel:\+?[\d(][\d\s().-]{6,}\d|\+?\d[\d\s().-]{7,}\d/u.test(
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

export function validateBrowserObservationTestSource(
  source,
  requiredBrowserCheckIds = [],
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
    if (!source.includes(checkId)) {
      throw new TypeError(
        `The browser observation test is missing required check "${checkId}".`,
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

function applyExactReplacements(content, replacements) {
  let result = content;
  let applied = 0;
  for (const replacement of replacements) {
    const first = result.indexOf(replacement.oldText);
    const last = result.lastIndexOf(replacement.oldText);
    if (first >= 0 && first === last) {
      result =
        result.slice(0, first) +
        replacement.newText +
        result.slice(first + replacement.oldText.length);
      applied += 1;
    }
  }
  if (applied !== replacements.length) {
    throw new Error(
      "Every model repair replacement must match exactly once; the patch was rejected atomically.",
    );
  }
  if (result === content) {
    throw new Error(
      "The model repair replacements do not change the current file.",
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
  priorStructuredOutputs = [],
  allowPriorReplay = false,
}) {
  const currentFile = currentFiles.find(
    (file) => file.path === structuredOutput?.path,
  );
  if (currentFile === undefined) {
    throw new Error(
      "The browser repair attempted to change a file outside the current generated project.",
    );
  }
  const duplicateHypothesis = priorStructuredOutputs.some(
    (output) =>
      output?.path === structuredOutput.path &&
      JSON.stringify(output?.replacements) ===
        JSON.stringify(structuredOutput.replacements),
  );
  if (duplicateHypothesis && !allowPriorReplay) {
    throw new Error(
      "The proposed repair repeats an existing hypothesis without new evidence.",
    );
  }
  const repairedContent = applyExactReplacements(
    currentFile.content,
    structuredOutput.replacements,
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
    validateBrowserObservationTestSource(
      repairedContent,
      requiredBrowserCheckIds,
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

function bundlePrompt(profile, contract, bindings) {
  const browserChecks = contract.obligations
    .filter(
      (obligation) =>
        bindings[obligation.obligationId] === "browser-check",
    )
    .map((obligation) => ({
      checkId: obligation.obligationId,
      observableOutcome: obligation.statement,
    }));
  return [
    "Generate the complete source bundle for this specific project. This must be an original implementation of the supplied ProjectProfile and Requirement Contract, not a template selected by project keywords.",
    `Use the selected certified stack package versions exactly: ${JSON.stringify(CERTIFIED_PROJECT_PACKAGE_VERSIONS)}.`,
    "The application must be production-buildable, use a real SQLite database below data/, expose GET /api/health returning HTTP 200, and bind the production server using npm run start.",
    "Every App Router page requires app/layout.tsx (or an equivalent root layout). package.json must provide build, start, typecheck, lint, and test scripts.",
    'If source uses the @/ import alias, tsconfig.json must define a valid compilerOptions.paths["@/*"] mapping; otherwise use resolvable relative imports.',
    'When the lint script scans the project root, its ESLint configuration must explicitly ignore ".next" build output.',
    "For certified Next.js 15.4.4, adapt next/core-web-vitals and next/typescript through FlatCompat from @eslint/eslintrc (with the .next ignore in the exported array); do not use Next.js 16-style direct eslint-config-next flat imports.",
    "Because eslint.config.mjs is ESM, derive __dirname from import.meta.url before passing it to FlatCompat; never reference an undefined CommonJS __dirname global.",
    "Include a valid app/icon or public/favicon resource so the real browser does not generate a missing decorative-resource error.",
    "SQLite connection, schema initialization, migrations, PRAGMAs, and seeding must run lazily in the application runtime, never as module-import side effects during Next.js build route collection. Importing route modules in parallel must not mutate or lock the database.",
    "Include package.json, TypeScript/Next/ESLint configuration, all application files, API routes as needed, durable SQLite behavior when required by the contract, Playwright configuration using channel chrome and FOUNDRY_PREVIEW_URL, and one real browser verification test.",
    "Do not configure Playwright webServer or start another application process from the test configuration. Foundry's Runtime & Preview Service exclusively owns the already-ready application process and supplies its URL through FOUNDRY_PREVIEW_URL.",
    "Do not use a custom Playwright reporter that can suppress test-process stdout. The FOUNDRY_BROWSER_RESULT line must reach the controlled command evidence stream.",
    "The Playwright test must exercise every supplied browser check through the running UI. It must collect console errors and page errors and finish by writing exactly one stdout line starting FOUNDRY_BROWSER_RESULT: followed by JSON with captureProbeErrors, checks, consoleErrors, and pageErrors. Every checks key must be the exact checkId supplied and its boolean must reflect the actual assertion result.",
    "Initialize captureProbeErrors, consoleErrors, and pageErrors as arrays. Wrap browser observation work in try/finally and emit FOUNDRY_BROWSER_RESULT from the finally block so failures remain inspectable.",
    "For any credential-gated local workflow, read the runtime-only credential from FOUNDRY_RUNTIME_ACCESS_VALUE in both application code and Playwright. Do not invent a default password, persist the value, or print it.",
    "When a credential-gated workflow passes with FOUNDRY_RUNTIME_ACCESS_VALUE but the customer's final credential is still listed in customerContent.missingBeforeLaunch, describe the runtime value as development-only. Keep the owner-facing launch checklist visible and never imply that final customer access was supplied or that the project is launch-ready.",
    "Do not use mocked APIs, mocked persistence, fake build results, screenshots as proof, or a prebuilt sample project.",
    "Treat customerContent.supplied as the complete allowlist of customer-provided real-world facts. A model-derived project name or summary is a design proposal, not proof of a real business identity.",
    "Never invent a phone number, email address, street or service-area location, opening date, credential, certification, award, customer identity, testimonial, price, business hours, social account, client logo, or quantitative trust claim. If a value is absent from customerContent.supplied, omit the public claim and put an honest launch-content checklist in an owner-facing area when relevant.",
    "Do not make missing customer content look complete with realistic placeholders. Browser checks must return false if their stated customer-provided outcome is not actually supported by customerContent.supplied.",
    "Keep the bundle concise and do not include node_modules, package-lock.json, build output, binary content, or markdown fences. The Execution Engine, not the model, owns lockfile creation.",
    `ProjectProfile:\n${JSON.stringify(profile)}`,
    `Requirement Contract:\n${JSON.stringify(contract)}`,
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
      const path = call.structuredOutput?.path;
      if (typeof path !== "string") continue;
      const scope = repairScopeForPath(path);
      scopes[scope] = (scopes[scope] ?? 0) + 1;
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
      const requiredBrowserCheckIds = Object.entries(bindings)
        .filter(([, binding]) => binding === "browser-check")
        .map(([obligationId]) => obligationId)
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
              purpose: bundlePrompt(profile, contract, bindings),
              taskClass: ModelTaskClass.FILE_GENERATION,
              contextReferences: [
                { kind: "contract", id: `${missionId}-contract` },
                {
                  kind: "workspace-checkpoint",
                  id: workspace.currentCheckpointId,
                },
              ],
              expectedStructuredOutputSchema: generationSchema,
              structuredOutputValidator:
                approvedContract === null
                  ? undefined
                  : (output) =>
                      validateContractBoundMissionPlan(
                        output,
                        approvedContract,
                      ),
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
            validateContractBoundMissionPlan(
              generation.structuredOutput,
              approvedContract,
            );
          }
          validatedFiles = validateProjectBundleForStack(
            generation.structuredOutput.files,
            requiredBrowserCheckIds,
            profile.customerContent,
          );
          break;
        } catch (error) {
          const correctionCount = models
            .listCalls(missionId)
            .filter((call) =>
              call.requestId.startsWith(generationCorrectionPrefix),
            ).length;
          if (correctionCount >= 3) {
            throw new Error(
              `The generated bundle remained structurally invalid after three distinct live corrections: ${error.message}`,
            );
          }
          const correctionSequence = correctionCount + 1;
          const requestId = `${generationCorrectionPrefix}${correctionSequence}`;
          generation = await requestModel({
            requestId,
            missionId,
            workUnitId: `${requestId}-plan`,
            purpose: [
              bundlePrompt(profile, contract, bindings),
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
            structuredOutputValidator:
              approvedContract === null
                ? undefined
                : (output) =>
                    validateContractBoundMissionPlan(
                      output,
                      approvedContract,
                    ),
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
          if (priorRepairs.length >= 6) {
            orchestrator.transition({
              missionId,
              eventId: `${missionId}-${safeName(procedureName)}-repairs-exhausted`,
              causationId: result.workUnitId,
              to: MissionState.EXHAUSTED,
              reason: `The bounded ${procedureName} repair budget was exhausted after six evidence-backed changes.`,
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
          const repairSequence =
            models
              .listCalls(missionId)
              .filter((call) => call.requestId.startsWith(repairPrefix))
              .length + 1;
          const repairRequestId = `${repairPrefix}${repairSequence}`;
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
          const repair = await requestModel({
            requestId: repairRequestId,
            missionId,
            workUnitId: `${repairRequestId}-plan`,
            purpose: [
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
      let browser;
      for (let attempt = 0; attempt < 7; attempt += 1) {
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
                `The following real browser checks were false: ${failedChecks.join(", ")}.`,
              );
            } else if (blockingErrors.length > 0) {
              observationFailures.push([
                "The browser observation recorded blocking errors.",
                JSON.stringify(blockingErrors),
              ].join("\n"));
            }
          } catch (error) {
            observationFailures.push(
              error instanceof Error
                ? error.message
                : "The browser result could not be parsed.",
            );
          }
          browserFailure =
            observationFailures.length === 0
              ? undefined
              : observationFailures.join("\n");
        }
        if (browserFailure === undefined && browserResult !== undefined) {
          break;
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
          attempt === 0
        ) {
          session = await startRuntime();
          continue;
        }
        const priorRepairCalls = models
          .listCalls(missionId)
          .filter(
            (call) =>
              call.requestId.startsWith(`${contractRequestNamespace}-browser-repair-`) &&
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
        const repairPrefix = `${contractRequestNamespace}-browser-repair-`;
        if (priorRepairCalls.length >= 6) {
          orchestrator.transition({
            missionId,
            eventId: `${missionId}-browser-repairs-exhausted`,
            causationId: browser.workUnitId,
            to: MissionState.EXHAUSTED,
            reason:
              "The bounded browser-verification repair budget was exhausted after six evidence-backed changes.",
          });
          throw new Error(
            "Browser-verification repair budget exhausted; the mission is EXHAUSTED.",
          );
        }
        const latestPriorRepair = priorRepairCalls[0];
        const replayableRepair = [latestPriorRepair].find((call) => {
          if (call === undefined) return false;
          const output = call.structuredOutput;
          const current = repairFiles.find(
            (file) => file.path === output?.path,
          );
          if (
            current === undefined ||
            !Array.isArray(output?.replacements)
          ) {
            return false;
          }
          return canReplayExactReplacements(
            current.content,
            output.replacements,
          );
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
          const browserRepairSchema = contractTraceSchema(
            browserRepairPatchSchema,
            approvedContract !== null,
          );
          return requestModel({
          requestId: repairRequestId,
          missionId,
          workUnitId: `${repairRequestId}-plan`,
          purpose: [
            "The real Playwright verification observation did not satisfy its evidence protocol or Requirement Contract.",
            `Deterministic initial repair classification: ${failureClassification.scope}. Hypothesis: ${failureClassification.hypothesis}`,
            "Return exact search/replace edits for exactly one existing project source, configuration, Playwright test, or Playwright configuration file. Each oldText must occur exactly once in the current file; keep edits narrowly scoped and use as few replacements as possible.",
            "Choose application source when the running behavior is wrong. Choose Playwright test/configuration only when the observation implementation is wrong. Correct invalid selectors, synchronization, or observation code while preserving every contract assertion.",
            "When several downstream checks are false, diagnose shared discovery or navigation variables first; do not patch each false check independently.",
            "When visible labels repeat across distinct rows, dates, cards, or entities, bind the observation to the exact interacted ancestor, stable identifier, or complete composite identity. Do not use a substring locator that matches unrelated entities.",
            "If the UI exposes no stable identifier or complete composite label, capture the exact scoped collection and indexed element used for the interaction, then compare that same scope's observable count or state before and after. Do not invent a missing test ID or assert that repeated visible text is globally unique.",
            "After navigation, reload, or client hydration, wait for the first expected element or an explicit ready condition before measuring collection counts. Never capture a zero baseline while the requested data is still loading.",
            "The checks object must contain exactly the supplied browser-check obligation IDs, each computed from the observed running application. Do not include build, structured-test, or browser-error obligations as checks because those are verified from their own evidence.",
            "The test must finish by writing exactly one stdout line starting with the literal prefix FOUNDRY_BROWSER_RESULT: followed immediately by JSON containing captureProbeErrors as a string array, checks as the exact boolean map, consoleErrors as a string array, and pageErrors as a string array. Replace any other marker name.",
            "Record blocking console/page/capture errors. A deliberately exercised validation response or an absent non-contract decorative resource may be classified as non-blocking only by inspecting its exact URL and status; never discard errors solely by generic message text or status class.",
            "When a contract check deliberately submits invalid data and awaits an exact validation endpoint/status, correlate the matching console event to that awaited response (or scope capture around that exact request) so the expected rejection is not misreported as a blocking runtime error. Do not suppress unrelated requests with the same status.",
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
                path: call.structuredOutput?.path,
                replacementCount:
                  call.structuredOutput?.replacements?.length ?? 0,
              })),
            )}`,
            "Do not repeat a prior replacement that left the same observation failing. Diagnose the remaining cause from the current test and exact evidence.",
            ...(semanticRejection === null
              ? []
              : [
                  `The prior proposed patch was rejected before execution: ${semanticRejection}`,
                  "Return a different, applicable hypothesis. Every oldText must match the supplied current file exactly once.",
                ]),
            `Existing repairable project files:\n${JSON.stringify(repairFiles)}`,
            `Existing Playwright test files:\n${JSON.stringify(testFiles)}`,
            `Original model-generated test files (recovery context only; correct their defects rather than blindly restoring them):\n${JSON.stringify(originalGeneratedTestFiles)}`,
          ].join("\n\n"),
          taskClass: ModelTaskClass.REPAIR_IMPLEMENTATION,
          depthLevel: 2,
          routingReason:
            "A bounded Playwright observation correction is standard engineering.",
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
              currentFiles: repairFiles,
              requiredBrowserCheckIds: requiredBrowserChecks,
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
            if (
              models
                .listCalls(missionId)
                .filter((call) => call.requestId.startsWith(repairPrefix))
                .length >= 6
            ) {
              throw new Error(
                "Browser repair proposal budget exhausted by semantically invalid or repeated hypotheses.",
              );
            }
            repair = await requestBrowserRepair(semanticRejection);
          }
          try {
            const isPriorReplay =
              replayableRepair !== undefined &&
              repair.structuredOutput ===
                replayableRepair.structuredOutput;
            acceptedRepair = validateBrowserRepairProposal({
              structuredOutput: repair.structuredOutput,
              currentFiles: repairFiles,
              requiredBrowserCheckIds: requiredBrowserChecks,
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
        const repairScope = repairScopeForPath(
          acceptedRepair.path,
        );
        const changed = await work(
          WorkUnitAction.REPLACE_FILE,
          {
            path: acceptedRepair.path,
            content: acceptedRepair.content,
          },
          browserTargets.length > 0
            ? browserTargets
            : generationTargetIds,
          `repair-${repairScope}-${acceptedRepair.path}`,
        );
        if (changed.status !== WorkUnitStatus.SUCCEEDED) {
          throw new Error(
            "The evidence-backed scoped repair could not be applied.",
          );
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
              throw new Error(
                `${procedureName} failed after ${repairScope}; its evidence is recorded and no broader pipeline was repeated.`,
              );
            }
          }
        }
        session = await startRuntime();
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
      orchestrator.transition({
        missionId,
        eventId: `${missionId}-verifying`,
        causationId: `${missionId}-browser-observation`,
        to: MissionState.VERIFYING,
        reason: "Real build, runtime, HTTP, and browser observations are recorded.",
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
