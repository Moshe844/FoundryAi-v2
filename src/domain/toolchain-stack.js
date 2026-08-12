import { createHash } from "node:crypto";

import {
  EnvironmentCapabilityError,
  IncompatiblePlatformError,
  IncompatibleToolVersionError,
  MissingRequiredToolError,
  StackManifestValidationError,
  UnsupportedCapabilityError,
} from "./errors.js";
import {
  OBSERVATION_KINDS,
} from "./observation-evidence.js";

export const STACK_MANIFEST_SCHEMA_VERSION = 1;
export const STACK_REGISTRY_SCHEMA_VERSION = 1;
export const TOOLCHAIN_STACK_REGISTRY_SOURCE =
  "TOOLCHAIN_STACK_REGISTRY";

export const StackCertificationStatus = Object.freeze({
  UNREGISTERED: "UNREGISTERED",
  PROVISIONAL: "PROVISIONAL",
  CERTIFIED: "CERTIFIED",
  DECERTIFIED: "DECERTIFIED",
});

export const StackSelectionMode = Object.freeze({
  PRODUCTION: "PRODUCTION",
  CERTIFICATION: "CERTIFICATION",
});

export const RegistryOperation = Object.freeze({
  STACK_REGISTERED: "STACK_REGISTERED",
  CERTIFICATION_CHANGED: "CERTIFICATION_CHANGED",
  ENVIRONMENT_CHECKED: "ENVIRONMENT_CHECKED",
  STACK_SELECTED: "STACK_SELECTED",
});

export const CertificationEvidenceScope = Object.freeze({
  DETERMINISTIC_TEST_FIXTURE: "DETERMINISTIC_TEST_FIXTURE",
  END_TO_END_MISSION: "END_TO_END_MISSION",
});

export const CERTIFIED_STACK_ID =
  "web-nextjs-typescript-sqlite-npm-playwright";
export const CERTIFIED_STACK_VERSION = "1.5.0";
const READABLE_CERTIFIED_STACK_VERSIONS = new Set([
  "1.0.0",
  "1.1.0",
  "1.2.0",
  "1.3.0",
  "1.4.0",
  "1.5.0",
]);
export const CERTIFIED_PROJECT_PACKAGE_VERSIONS = Object.freeze({
  "@eslint/eslintrc": "3.3.1",
  "@playwright/test": "1.62.1",
  "@types/better-sqlite3": "7.6.13",
  "@types/node": "22.15.21",
  "@types/react": "19.1.2",
  "@types/react-dom": "19.1.2",
  "better-sqlite3": "13.0.1",
  eslint: "9.29.0",
  "eslint-config-next": "15.5.23",
  next: "15.5.23",
  react: "19.1.0",
  "react-dom": "19.1.0",
  typescript: "5.8.3",
});

const PROCEDURE_FIELDS = Object.freeze([
  "scaffold",
  "install",
  "typeCheck",
  "lint",
  "productionBuild",
  "developmentRun",
  "test",
  "browserVerification",
  "packageExport",
  "dependencyLock",
  "productionRun",
  "runtimeStartupFailureProbe",
  "runtimeCrashProbe",
  "commandSuccessProbe",
  "commandFailureProbe",
  "longRunningProbe",
  "outputLimitProbe",
  "environmentFilterProbe",
  "processTreeProbe",
]);
const MANIFEST_KEYS = Object.freeze([
  "certificationStatus",
  "components",
  "knownLimitations",
  "manifestHash",
  "platform",
  "procedures",
  "requiredEvidenceKinds",
  "requiredTools",
  "schemaVersion",
  "stackId",
  "stackVersion",
  "supportedCapabilities",
  "supportedProjectCategories",
]);
const COMPONENT_KEYS = Object.freeze([
  "browserTesting",
  "database",
  "framework",
  "language",
  "packageManager",
]);
const TOOL_KEYS = Object.freeze([
  "availabilityScope",
  "toolId",
  "versionRange",
]);
const PROCEDURE_KEYS = Object.freeze([
  "arguments",
  "description",
  "executable",
]);
const IDENTIFIER_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/;
const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const RANGE_PART_PATTERN = /^(>=|<=|>|<|=)?(\d+\.\d+\.\d+)$/;
const certificationStatusSet = new Set(
  Object.values(StackCertificationStatus),
);
const observationKindSet = new Set(OBSERVATION_KINDS);

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function freezeStackValue(value) {
  return deepFreeze(structuredClone(value));
}

export function canonicalizeStackValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeStackValue).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeStackValue(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPlainObject(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new StackManifestValidationError(`${label} must be a plain object.`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new StackManifestValidationError(
      `${label} must contain exactly: ${expected.join(", ")}.`,
    );
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new StackManifestValidationError(
      `${label} must be a non-empty string.`,
    );
  }
}

export function assertRegistryIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new StackManifestValidationError(`${label} is malformed.`);
  }
}

function normalizeStringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw new StackManifestValidationError(
      `${label} must be ${allowEmpty ? "an" : "a non-empty"} array.`,
    );
  }
  const normalized = value.map((entry, index) => {
    assertNonEmptyString(entry, `${label}[${index}]`);
    return entry.trim();
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new StackManifestValidationError(
      `${label} must not contain duplicates.`,
    );
  }
  const sorted = [...normalized].sort();
  if (normalized.some((entry, index) => entry !== sorted[index])) {
    throw new StackManifestValidationError(
      `${label} must be sorted for deterministic replay.`,
    );
  }
  return normalized;
}

export function normalizeVersion(value, label = "version") {
  assertNonEmptyString(value, label);
  const match = value.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (match === null) {
    throw new StackManifestValidationError(
      `${label} must contain a semantic x.y.z version.`,
    );
  }
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function parseVersion(version) {
  const match = SEMVER_PATTERN.exec(version);
  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] < rightParts[index] ? -1 : 1;
    }
  }
  return 0;
}

export function validateVersionRange(versionRange) {
  assertNonEmptyString(versionRange, "required tool versionRange");
  const parts = versionRange.trim().split(/\s+/u);
  for (const part of parts) {
    if (RANGE_PART_PATTERN.exec(part) === null) {
      throw new StackManifestValidationError(
        `Unsupported version range "${versionRange}".`,
      );
    }
  }
  return parts.join(" ");
}

export function versionSatisfiesRange(version, versionRange) {
  let normalized;
  try {
    normalized = normalizeVersion(version, "detected tool version");
  } catch {
    return false;
  }
  return validateVersionRange(versionRange)
    .split(/\s+/u)
    .every((part) => {
      const [, operator = "=", target] = RANGE_PART_PATTERN.exec(part);
      const comparison = compareVersions(normalized, target);
      return {
        ">": comparison > 0,
        ">=": comparison >= 0,
        "<": comparison < 0,
        "<=": comparison <= 0,
        "=": comparison === 0,
      }[operator];
    });
}

function procedure(executable, args, description) {
  return {
    executable,
    arguments: args,
    description,
  };
}

function withManifestHash(manifestWithoutHash) {
  return deepFreeze({
    ...manifestWithoutHash,
    manifestHash: sha256(canonicalizeStackValue(manifestWithoutHash)),
  });
}

export const WEB_STACK_MANIFEST = withManifestHash({
  schemaVersion: STACK_MANIFEST_SCHEMA_VERSION,
  stackId: CERTIFIED_STACK_ID,
  stackVersion: CERTIFIED_STACK_VERSION,
  certificationStatus: StackCertificationStatus.PROVISIONAL,
  platform: "web",
  components: {
    framework: "Next.js",
    language: "TypeScript",
    database: "SQLite",
    packageManager: "npm",
    browserTesting: "Playwright",
  },
  supportedProjectCategories: ["web-application"],
  requiredTools: [
    {
      toolId: "browser",
      versionRange: ">=120.0.0",
      availabilityScope: "host",
    },
    {
      toolId: "git",
      versionRange: ">=2.40.0",
      availabilityScope: "host",
    },
    {
      toolId: "nextjs",
      versionRange: "=15.5.23",
      availabilityScope: "project-dependency",
    },
    {
      toolId: "node",
      versionRange: ">=22.0.0 <25.0.0",
      availabilityScope: "host",
    },
    {
      toolId: "npm",
      versionRange: ">=10.0.0 <12.0.0",
      availabilityScope: "host",
    },
    {
      toolId: "playwright",
      versionRange: ">=1.62.1 <2.0.0",
      availabilityScope: "project-dependency",
    },
    {
      toolId: "sqlite",
      versionRange: ">=3.45.0 <4.0.0",
      availabilityScope: "project-dependency",
    },
    {
      toolId: "typescript",
      versionRange: ">=5.8.0 <6.0.0",
      availabilityScope: "project-dependency",
    },
  ],
  procedures: {
    scaffold: procedure(
      "npm",
      [
        "exec",
        "--yes",
        "create-next-app@15.5.23",
        "--",
        "--typescript",
        "--eslint",
        "--app",
        "--use-npm",
      ],
      "Scaffold the pinned Next.js TypeScript application shape.",
    ),
    install: procedure(
      "node",
      ["scripts/foundry-certified-install.mjs"],
      "Materialize the exact certified dependency image, falling back to an ordinary pinned npm install when the image is unavailable.",
    ),
    typeCheck: procedure(
      "npm",
      ["exec", "--", "tsc", "--noEmit"],
      "Run the TypeScript compiler without emitting files.",
    ),
    lint: procedure(
      "npm",
      ["run", "lint"],
      "Run the declared project lint script.",
    ),
    productionBuild: procedure(
      "npm",
      ["run", "build"],
      "Create a production Next.js build.",
    ),
    developmentRun: procedure(
      "npm",
      ["run", "dev"],
      "Start the declared Next.js development process.",
    ),
    test: procedure(
      "npm",
      ["test"],
      "Run the declared deterministic test suite.",
    ),
    browserVerification: procedure(
      "npm",
      ["exec", "--", "playwright", "test"],
      "Run the declared Playwright verification suite.",
    ),
    packageExport: procedure(
      "npm",
      ["pack", "--json"],
      "Produce an npm package/export manifest.",
    ),
    dependencyLock: procedure(
      "npm",
      [
        "install",
        "--package-lock-only",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      "Resolve the pinned dependency manifest into a lockfile.",
    ),
    productionRun: procedure(
      "npm",
      ["run", "start"],
      "Run the built production application under Runtime supervision.",
    ),
    runtimeStartupFailureProbe: procedure(
      "node",
      [
        "-e",
        "process.stderr.write('runtime-startup-failed\\n'); process.exit(9);",
      ],
      "Exercise real startup-failure observation.",
    ),
    runtimeCrashProbe: procedure(
      "node",
      [
        "-e",
        "const http=require('node:http'); const server=http.createServer((_,res)=>{res.end('ready')}); server.listen(Number(process.env.PORT),'127.0.0.1',()=>setTimeout(()=>process.exit(17),800));",
      ],
      "Exercise real post-readiness crash observation.",
    ),
    commandSuccessProbe: procedure(
      "node",
      [
        "-e",
        "process.stdout.write('command-ok\\n'); process.stderr.write('command-note\\n');",
      ],
      "Exercise controlled stdout, stderr, and exit-code capture.",
    ),
    commandFailureProbe: procedure(
      "node",
      [
        "-e",
        "process.stderr.write('command-failed\\n'); process.exit(7);",
      ],
      "Exercise controlled non-zero command capture.",
    ),
    longRunningProbe: procedure(
      "node",
      ["-e", "setInterval(() => {}, 1000);"],
      "Exercise timeout and cancellation cleanup.",
    ),
    outputLimitProbe: procedure(
      "node",
      ["-e", "process.stdout.write('x'.repeat(65536));"],
      "Exercise bounded command-output capture.",
    ),
    environmentFilterProbe: procedure(
      "node",
      [
        "-e",
        "process.stdout.write(process.env.FOUNDRY_TEST_VALUE ? 'present' : 'missing');",
      ],
      "Exercise safe environment-name filtering without printing values.",
    ),
    processTreeProbe: procedure(
      "node",
      [
        "-e",
        "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(() => {}, 1000);'],{stdio:'ignore'}); console.log(child.pid); setInterval(() => {}, 1000);",
      ],
      "Exercise process-tree cleanup using a controlled child process.",
    ),
  },
  requiredEvidenceKinds: [
    "command-exit-result",
    "http-response-result",
    "runtime-readiness-result",
    "structured-test-result",
  ],
  supportedCapabilities: [
    "automated-tests",
    "browser-verification",
    "create-records",
    "development-runtime",
    "package-export",
    "production-build",
    "refresh-persistence",
    "sqlite-persistence",
    "typescript",
    "update-records",
    "web-application",
  ],
  knownLimitations: [
    "Production certification requires three clean Milestone 8 end-to-end missions.",
    "The SQLite profile is intended for a single application instance.",
    "The certified browser-verification target is Chromium-family browsers only.",
  ],
});

export function normalizeStackManifest(input) {
  assertExactKeys(input, MANIFEST_KEYS, "stack manifest");
  if (input.schemaVersion !== STACK_MANIFEST_SCHEMA_VERSION) {
    throw new StackManifestValidationError(
      "Unsupported stack manifest schema version.",
    );
  }
  assertRegistryIdentifier(input.stackId, "stack manifest stackId");
  const stackVersion = normalizeVersion(
    input.stackVersion,
    "stack manifest stackVersion",
  );
  if (
    input.stackId !== CERTIFIED_STACK_ID ||
    !READABLE_CERTIFIED_STACK_VERSIONS.has(stackVersion)
  ) {
    throw new StackManifestValidationError(
      "Foundry permits only a supported version of the declared web stack.",
    );
  }
  if (
    !certificationStatusSet.has(input.certificationStatus) ||
    input.certificationStatus !== StackCertificationStatus.PROVISIONAL
  ) {
    throw new StackManifestValidationError(
      "A new Milestone 6 stack manifest must begin PROVISIONAL.",
    );
  }
  if (input.platform !== "web") {
    throw new StackManifestValidationError(
      "The Milestone 6 stack platform must be web.",
    );
  }
  assertExactKeys(input.components, COMPONENT_KEYS, "stack components");
  const components = {};
  for (const key of COMPONENT_KEYS) {
    assertNonEmptyString(input.components[key], `stack components.${key}`);
    components[key] = input.components[key].trim();
  }
  if (
    components.framework !== "Next.js" ||
    components.language !== "TypeScript" ||
    components.database !== "SQLite" ||
    components.packageManager !== "npm" ||
    components.browserTesting !== "Playwright"
  ) {
    throw new StackManifestValidationError(
      "Stack components must be Next.js, TypeScript, SQLite, npm, and Playwright.",
    );
  }

  if (!Array.isArray(input.requiredTools) || input.requiredTools.length === 0) {
    throw new StackManifestValidationError(
      "stack requiredTools must be a non-empty array.",
    );
  }
  const toolIds = new Set();
  const requiredTools = input.requiredTools.map((tool, index) => {
    assertExactKeys(tool, TOOL_KEYS, `requiredTools[${index}]`);
    assertRegistryIdentifier(tool.toolId, `requiredTools[${index}].toolId`);
    if (toolIds.has(tool.toolId)) {
      throw new StackManifestValidationError(
        `Required tool "${tool.toolId}" is duplicated.`,
      );
    }
    toolIds.add(tool.toolId);
    return {
      toolId: tool.toolId,
      versionRange: validateVersionRange(tool.versionRange),
      availabilityScope: tool.availabilityScope,
    };
  });
  for (const tool of requiredTools) {
    if (
      tool.availabilityScope !== "host" &&
      tool.availabilityScope !== "project-dependency"
    ) {
      throw new StackManifestValidationError(
        `Required tool "${tool.toolId}" has an invalid availabilityScope.`,
      );
    }
  }
  const requiredToolNames = [
    "browser",
    "git",
    "nextjs",
    "node",
    "npm",
    "playwright",
    "sqlite",
    "typescript",
  ];
  if (
    requiredTools.length !== requiredToolNames.length ||
    requiredTools.some(
      (tool, index) => tool.toolId !== requiredToolNames[index],
    )
  ) {
    throw new StackManifestValidationError(
      "requiredTools must contain the complete certified stack tool set in sorted order.",
    );
  }

  assertExactKeys(input.procedures, PROCEDURE_FIELDS, "stack procedures");
  const procedures = {};
  for (const field of PROCEDURE_FIELDS) {
    const value = input.procedures[field];
    assertExactKeys(value, PROCEDURE_KEYS, `procedures.${field}`);
    assertRegistryIdentifier(
      value.executable,
      `procedures.${field}.executable`,
    );
    assertNonEmptyString(value.description, `procedures.${field}.description`);
    if (
      !Array.isArray(value.arguments) ||
      value.arguments.some((argument) => typeof argument !== "string")
    ) {
      throw new StackManifestValidationError(
        `procedures.${field}.arguments must be an array of strings.`,
      );
    }
    procedures[field] = {
      executable: value.executable,
      arguments: [...value.arguments],
      description: value.description.trim(),
    };
  }

  const requiredEvidenceKinds = normalizeStringArray(
    input.requiredEvidenceKinds,
    "stack requiredEvidenceKinds",
  );
  if (
    requiredEvidenceKinds.some((kind) => !observationKindSet.has(kind))
  ) {
    throw new StackManifestValidationError(
      "stack requiredEvidenceKinds contains an unsupported evidence kind.",
    );
  }

  const manifestWithoutHash = {
    schemaVersion: STACK_MANIFEST_SCHEMA_VERSION,
    stackId: input.stackId,
    stackVersion,
    certificationStatus: input.certificationStatus,
    platform: input.platform,
    components,
    supportedProjectCategories: normalizeStringArray(
      input.supportedProjectCategories,
      "stack supportedProjectCategories",
    ),
    requiredTools,
    procedures,
    requiredEvidenceKinds,
    supportedCapabilities: normalizeStringArray(
      input.supportedCapabilities,
      "stack supportedCapabilities",
    ),
    knownLimitations: normalizeStringArray(
      input.knownLimitations,
      "stack knownLimitations",
      { allowEmpty: true },
    ),
  };
  const expectedHash = sha256(canonicalizeStackValue(manifestWithoutHash));
  if (
    typeof input.manifestHash !== "string" ||
    input.manifestHash !== expectedHash
  ) {
    throw new StackManifestValidationError(
      "stack manifestHash does not match its content.",
    );
  }
  return freezeStackValue({ ...manifestWithoutHash, manifestHash: expectedHash });
}

export function normalizeEnvironmentDetection(input) {
  assertPlainObject(input, "environment detection");
  const expectedKeys = [
    "capturedAt",
    "environmentCheckId",
    "hostPlatform",
    "missionId",
    "tools",
  ];
  assertExactKeys(input, expectedKeys, "environment detection");
  assertRegistryIdentifier(
    input.environmentCheckId,
    "environmentCheckId",
  );
  assertRegistryIdentifier(input.missionId, "environment missionId");
  assertNonEmptyString(input.hostPlatform, "environment hostPlatform");
  if (
    typeof input.capturedAt !== "string" ||
    Number.isNaN(Date.parse(input.capturedAt))
  ) {
    throw new EnvironmentCapabilityError(
      "environment capturedAt must be an ISO-compatible timestamp.",
    );
  }
  assertPlainObject(input.tools, "environment tools");
  const toolNames = Object.keys(input.tools).sort();
  if (
    toolNames.length !== 4 ||
    toolNames.some(
      (toolName, index) =>
        toolName !== ["browser", "git", "node", "npm"][index],
    )
  ) {
    throw new EnvironmentCapabilityError(
      "environment tools must contain exactly browser, git, node, and npm.",
    );
  }
  const tools = {};
  for (const toolId of toolNames) {
    const tool = input.tools[toolId];
    if (
      tool === null ||
      typeof tool !== "object" ||
      Array.isArray(tool) ||
      Object.getPrototypeOf(tool) !== Object.prototype
    ) {
      throw new EnvironmentCapabilityError(
        `environment tool "${toolId}" must be a plain object.`,
      );
    }
    const actualKeys = Object.keys(tool).sort();
    const toolKeys = [
      "available",
      "detail",
      "executable",
      "version",
    ];
    if (
      actualKeys.length !== toolKeys.length ||
      actualKeys.some((key, index) => key !== toolKeys[index])
    ) {
      throw new EnvironmentCapabilityError(
        `environment tool "${toolId}" has an invalid shape.`,
      );
    }
    if (typeof tool.available !== "boolean") {
      throw new EnvironmentCapabilityError(
        `environment tool "${toolId}".available must be boolean.`,
      );
    }
    if (typeof tool.detail !== "string" || tool.detail.length === 0) {
      throw new EnvironmentCapabilityError(
        `environment tool "${toolId}".detail must be non-empty.`,
      );
    }
    if (
      tool.available
        ? typeof tool.executable !== "string" ||
          tool.executable.length === 0 ||
          typeof tool.version !== "string"
        : tool.executable !== null || tool.version !== null
    ) {
      throw new EnvironmentCapabilityError(
        `environment tool "${toolId}" availability fields are inconsistent.`,
      );
    }
    tools[toolId] = {
      available: tool.available,
      version: tool.available
        ? normalizeVersion(tool.version, `${toolId} version`)
        : null,
      executable: tool.executable,
      detail: tool.detail,
    };
  }
  return freezeStackValue({
    environmentCheckId: input.environmentCheckId,
    missionId: input.missionId,
    capturedAt: input.capturedAt,
    hostPlatform: input.hostPlatform,
    tools,
  });
}

export function evaluateStackEligibility({
  stack,
  requestedPlatform,
  requiredCapabilities,
  environment,
  asOf,
  selectionMode = StackSelectionMode.PRODUCTION,
}) {
  assertNonEmptyString(requestedPlatform, "requestedPlatform");
  const capabilities = normalizeStringArray(
    requiredCapabilities,
    "requiredCapabilities",
    { allowEmpty: true },
  );
  if (requestedPlatform.trim().toLowerCase() !== stack.manifest.platform) {
    throw new IncompatiblePlatformError(requestedPlatform, [
      stack.manifest.platform,
    ]);
  }
  const supported = new Set(stack.manifest.supportedCapabilities);
  const unsupported = capabilities.filter(
    (capability) => !supported.has(capability),
  );
  if (unsupported.length > 0) {
    throw new UnsupportedCapabilityError(unsupported);
  }
  for (const requirement of stack.manifest.requiredTools) {
    if (requirement.availabilityScope !== "host") {
      continue;
    }
    const detected = environment.tools[requirement.toolId];
    if (!detected?.available) {
      throw new MissingRequiredToolError(
        requirement.toolId,
        detected?.detail ?? "not detected",
      );
    }
    if (
      !versionSatisfiesRange(
        detected.version,
        requirement.versionRange,
      )
    ) {
      throw new IncompatibleToolVersionError(
        requirement.toolId,
        detected.version,
        requirement.versionRange,
      );
    }
  }
  if (typeof asOf !== "string" || Number.isNaN(Date.parse(asOf))) {
    throw new EnvironmentCapabilityError(
      "Eligibility asOf must be an ISO-compatible timestamp.",
    );
  }
  return freezeStackValue({
    eligible: true,
    requestedPlatform: requestedPlatform.trim().toLowerCase(),
    requiredCapabilities: capabilities,
    rationale: [
      `Platform "web" matches stack "${stack.manifest.stackId}".`,
      `All ${capabilities.length} requested capabilities are declared.`,
      selectionMode === StackSelectionMode.PRODUCTION
        ? "Certification is current and CERTIFIED."
        : "Selection is isolated for certification work against the PROVISIONAL stack.",
      "Node.js, npm, Git, and browser requirements are present and version-compatible.",
    ],
  });
}
