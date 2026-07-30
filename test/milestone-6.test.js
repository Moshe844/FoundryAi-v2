import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CERTIFIED_STACK_ID,
  CERTIFIED_STACK_VERSION,
  CertificationEvidenceScope,
  DuplicateStackVersionError,
  EvidenceReferenceError,
  IncompatiblePlatformError,
  IncompatibleToolVersionError,
  MissingRequiredToolError,
  ObservationKind,
  RegistryOperation,
  RegistryCorruptionError,
  StackCertificationError,
  StackCertificationStatus,
  StackManifestValidationError,
  StaleCertificationError,
  TOOLCHAIN_STACK_REGISTRY_SOURCE,
  UncertifiedStackError,
  UnknownStackError,
  UnsupportedCapabilityError,
  WEB_STACK_MANIFEST,
  detectLocalEnvironment,
  openMissionControl,
  probeLocalTool,
} from "../src/index.js";

const TIME = "2026-06-01T12:00:00.000Z";
const VALID_UNTIL = "2026-07-01T12:00:00.000Z";

function temporaryStores(t) {
  const root = mkdtempSync(join(tmpdir(), "foundry-v2-registry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    ledgerDirectory: join(root, "ledger"),
    evidenceDirectory: join(root, "evidence"),
    workspaceDirectory: join(root, "workspace"),
    registryDirectory: join(root, "registry"),
  };
}

function goodToolProbe(toolId) {
  const versions = {
    browser: "Chromium 125.0.6422",
    git: "git version 2.46.0.windows.1",
    node: "v22.17.0",
    npm: "10.9.2",
  };
  return {
    available: true,
    version: versions[toolId],
    executable: `${toolId}-fixture`,
    detail: `${toolId} deterministic fixture is available.`,
  };
}

function openControl(stores, extra = {}) {
  return openMissionControl({
    ...stores,
    clock: () => TIME,
    toolProbe: goodToolProbe,
    allowDeterministicCertificationFixtures: true,
    ...extra,
  });
}

function createMission(control, missionId) {
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    occurredAt: TIME,
    reason: "Accept deterministic registry test mission.",
  });
}

function registrationInput(missionId, suffix = missionId) {
  return {
    missionId,
    manifest: WEB_STACK_MANIFEST,
    registryEventId: `${suffix}-registry-register`,
    eventId: `${suffix}-ledger-register`,
    causationId: `${suffix}-register-command`,
    evidenceId: `${suffix}-register-evidence`,
    occurredAt: TIME,
  };
}

function register(control, missionId, suffix = missionId) {
  return control.toolchains.registerStack(
    registrationInput(missionId, suffix),
  );
}

function captureCertificationEvidence(
  control,
  missionId,
  suffix = missionId,
) {
  return control.evidence.capture({
    evidenceId: `${suffix}-certification-evidence`,
    missionId,
    kind: ObservationKind.STRUCTURED_TEST_RESULT,
    captureMethod: "deterministic-certification-fixture",
    producingSubsystem: "MILESTONE_6_TEST",
    timestamp: TIME,
    payload: {
      suiteName: "five-capability-certification-fixture",
      passedCount: 5,
      failedCount: 0,
      skippedCount: 0,
    },
    workspaceCheckpointReference: null,
    obligationReference: null,
    verificationRequestReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: {
      stackId: CERTIFIED_STACK_ID,
      stackVersion: CERTIFIED_STACK_VERSION,
      certificationScope:
        CertificationEvidenceScope.DETERMINISTIC_TEST_FIXTURE,
      certificationCapabilities: {
        built: true,
        generated: true,
        observed: true,
        ran: true,
        tested: true,
      },
    },
  });
}

function certify(
  control,
  missionId,
  suffix = missionId,
  validUntil = VALID_UNTIL,
) {
  const certification = captureCertificationEvidence(
    control,
    missionId,
    suffix,
  );
  return control.toolchains.changeCertification({
    missionId,
    stackId: CERTIFIED_STACK_ID,
    stackVersion: CERTIFIED_STACK_VERSION,
    newStatus: StackCertificationStatus.CERTIFIED,
    validUntil,
    reason: "Exercise certification logic with a deterministic test fixture.",
    certificationEvidenceId: certification.evidenceId,
    registryEventId: `${suffix}-registry-certify`,
    eventId: `${suffix}-ledger-certify`,
    causationId: `${suffix}-certify-command`,
    occurredAt: TIME,
  });
}

function environment(
  control,
  missionId,
  suffix = missionId,
  occurredAt = TIME,
) {
  return control.toolchains.checkEnvironment({
    missionId,
    environmentCheckId: `${suffix}-environment`,
    registryEventId: `${suffix}-registry-environment`,
    eventId: `${suffix}-ledger-environment`,
    causationId: `${suffix}-environment-command`,
    evidenceId: `${suffix}-environment-evidence`,
    occurredAt,
  });
}

function selectionInput(
  missionId,
  suffix = missionId,
  occurredAt = TIME,
) {
  return {
    missionId,
    selectionId: `${suffix}-selection`,
    stackId: CERTIFIED_STACK_ID,
    stackVersion: CERTIFIED_STACK_VERSION,
    environmentCheckId: `${suffix}-environment`,
    requestedPlatform: "web",
    requiredCapabilities: [
      "create-records",
      "refresh-persistence",
      "sqlite-persistence",
      "update-records",
    ],
    registryEventId: `${suffix}-registry-selection`,
    eventId: `${suffix}-ledger-selection`,
    causationId: `${suffix}-selection-command`,
    occurredAt,
  };
}

function readyRegistry(control, missionId, suffix = missionId) {
  register(control, missionId, suffix);
  certify(control, missionId, suffix);
  environment(control, missionId, suffix);
}

test("registers the single versioned stack manifest as PROVISIONAL and records evidence-backed history", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "register-stack");

  const stack = register(control, "register-stack");

  assert.equal(stack.manifest.stackId, CERTIFIED_STACK_ID);
  assert.equal(stack.manifest.stackVersion, CERTIFIED_STACK_VERSION);
  assert.equal(
    stack.certificationStatus,
    StackCertificationStatus.PROVISIONAL,
  );
  assert.equal(stack.manifest.components.framework, "Next.js");
  assert.equal(stack.manifest.components.language, "TypeScript");
  assert.equal(stack.manifest.components.database, "SQLite");
  assert.equal(stack.manifest.components.packageManager, "npm");
  assert.equal(stack.manifest.components.browserTesting, "Playwright");
  assert.deepEqual(
    stack.manifest.requiredTools.map(
      ({ toolId, availabilityScope }) => [toolId, availabilityScope],
    ),
    [
      ["browser", "host"],
      ["git", "host"],
      ["nextjs", "project-dependency"],
      ["node", "host"],
      ["npm", "host"],
      ["playwright", "project-dependency"],
      ["sqlite", "project-dependency"],
      ["typescript", "project-dependency"],
    ],
  );
  assert(Object.isFrozen(stack));
  assert(Object.isFrozen(stack.manifest.procedures));

  const ledgerFact = control.ledger.listEvents("register-stack").at(-1);
  assert.equal(ledgerFact.source, TOOLCHAIN_STACK_REGISTRY_SOURCE);
  assert.equal(
    ledgerFact.fact.metadata.registryOperation,
    RegistryOperation.STACK_REGISTERED,
  );
  assert.equal(ledgerFact.fact.evidenceReferences.length, 1);
  assert.equal(control.toolchains.listRegistryEvents().length, 1);
  assert.match(
    readFileSync(
      join(stores.registryDirectory, "registry-events.jsonl"),
      "utf8",
    ),
    /"STACK_REGISTERED"/u,
  );
});

test("rejects malformed manifests before evidence, Ledger, or Registry mutation", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "malformed-manifest");
  const malformed = structuredClone(WEB_STACK_MANIFEST);
  delete malformed.procedures.productionBuild;

  assert.throws(
    () =>
      control.toolchains.registerStack({
        ...registrationInput("malformed-manifest"),
        manifest: malformed,
      }),
    StackManifestValidationError,
  );
  assert.equal(
    control.ledger.listEvents("malformed-manifest").length,
    1,
  );
  assert.equal(
    control.evidence.findByMission("malformed-manifest").length,
    0,
  );
  assert.equal(control.toolchains.listRegistryEvents().length, 0);
});

test("rejects duplicate stack/version registration, including after restart", (t) => {
  const stores = temporaryStores(t);
  let control = openControl(stores);
  createMission(control, "duplicate-stack");
  register(control, "duplicate-stack");

  control = openControl(stores);
  assert.throws(
    () => register(control, "duplicate-stack", "duplicate-second"),
    DuplicateStackVersionError,
  );
  assert.equal(control.toolchains.listRegistryEvents().length, 1);
});

test("manifest and certification replay is deterministic across identical stores", (t) => {
  const firstStores = temporaryStores(t);
  const secondStores = temporaryStores(t);
  const first = openControl(firstStores);
  const second = openControl(secondStores);
  for (const control of [first, second]) {
    createMission(control, "deterministic-registry");
    register(control, "deterministic-registry");
    certify(control, "deterministic-registry");
  }

  assert.deepEqual(
    first.toolchains.listRegistryEvents(),
    second.toolchains.listRegistryEvents(),
  );
  assert.deepEqual(
    first.toolchains.getStack(
      CERTIFIED_STACK_ID,
      CERTIFIED_STACK_VERSION,
    ),
    second.toolchains.getStack(
      CERTIFIED_STACK_ID,
      CERTIFIED_STACK_VERSION,
    ),
  );
  assert.equal(
    readFileSync(
      join(firstStores.registryDirectory, "registry-events.jsonl"),
      "utf8",
    ),
    readFileSync(
      join(secondStores.registryDirectory, "registry-events.jsonl"),
      "utf8",
    ),
  );
});

test("detects Node.js, npm, Git, and future browser support without running project dependencies", (t) => {
  const seen = [];
  const stores = temporaryStores(t);
  const control = openControl(stores, {
    toolProbe(toolId) {
      seen.push(toolId);
      return goodToolProbe(toolId);
    },
  });
  createMission(control, "environment-detection");

  const detected = environment(control, "environment-detection");

  assert.deepEqual(seen, ["browser", "git", "node", "npm"]);
  assert.deepEqual(Object.keys(detected.tools), [
    "browser",
    "git",
    "node",
    "npm",
  ]);
  assert.equal(detected.tools.node.version, "22.17.0");
  assert.equal(detected.tools.npm.version, "10.9.2");
  assert.equal(detected.tools.git.version, "2.46.0");
  assert.equal(detected.tools.browser.version, "125.0.6422");
  const nodeProbe = probeLocalTool("node");
  assert.equal(nodeProbe.available, true);
  assert.match(nodeProbe.version, /^v?\d+\.\d+\.\d+/u);
  const pure = detectLocalEnvironment({
    missionId: "environment-detection",
    environmentCheckId: "pure-environment",
    capturedAt: TIME,
    toolProbe: goodToolProbe,
    hostPlatform: "test-host",
  });
  assert.equal(pure.hostPlatform, "test-host");
});

test("rejects selection when a required local tool is missing", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores, {
    toolProbe(toolId) {
      if (toolId === "git") {
        return {
          available: false,
          version: null,
          executable: null,
          detail: "Git is intentionally absent.",
        };
      }
      return goodToolProbe(toolId);
    },
  });
  createMission(control, "missing-tool");
  register(control, "missing-tool");
  certify(control, "missing-tool");
  environment(control, "missing-tool");

  assert.throws(
    () => control.toolchains.selectStack(selectionInput("missing-tool")),
    MissingRequiredToolError,
  );
});

test("rejects an available host tool whose version is outside the manifest range", (t) => {
  const control = openControl(temporaryStores(t), {
    toolProbe(toolId) {
      if (toolId === "npm") {
        return {
          available: true,
          version: "9.9.9",
          executable: "npm-fixture",
          detail: "An intentionally incompatible npm fixture is present.",
        };
      }
      return goodToolProbe(toolId);
    },
  });
  createMission(control, "bad-tool-version");
  register(control, "bad-tool-version");
  certify(control, "bad-tool-version");
  environment(control, "bad-tool-version");

  assert.throws(
    () =>
      control.toolchains.selectStack(
        selectionInput("bad-tool-version"),
      ),
    IncompatibleToolVersionError,
  );
});

test("rejects incompatible platforms deterministically", (t) => {
  const control = openControl(temporaryStores(t));
  createMission(control, "bad-platform");
  readyRegistry(control, "bad-platform");

  assert.throws(
    () =>
      control.toolchains.selectStack({
        ...selectionInput("bad-platform"),
        requestedPlatform: "desktop",
      }),
    IncompatiblePlatformError,
  );
});

test("rejects unsupported capabilities deterministically", (t) => {
  const control = openControl(temporaryStores(t));
  createMission(control, "unsupported-capability");
  readyRegistry(control, "unsupported-capability");

  assert.throws(
    () =>
      control.toolchains.selectStack({
        ...selectionInput("unsupported-capability"),
        requiredCapabilities: ["native-mobile-binary"],
      }),
    UnsupportedCapabilityError,
  );
});

test("rejects unknown and PROVISIONAL stacks from selection", (t) => {
  const control = openControl(temporaryStores(t));
  createMission(control, "provisional-stack");
  register(control, "provisional-stack");
  environment(control, "provisional-stack");

  assert.throws(
    () =>
      control.toolchains.selectStack(
        selectionInput("provisional-stack"),
      ),
    UncertifiedStackError,
  );
  assert.throws(
    () =>
      control.toolchains.getStack(
        "unknown-stack",
        CERTIFIED_STACK_VERSION,
      ),
    UnknownStackError,
  );
});

test("rejects DECERTIFIED stacks while preserving certification history", (t) => {
  const control = openControl(temporaryStores(t));
  createMission(control, "decertified-stack");
  register(control, "decertified-stack");
  const certification = captureCertificationEvidence(
    control,
    "decertified-stack",
  );
  control.toolchains.changeCertification({
    missionId: "decertified-stack",
    stackId: CERTIFIED_STACK_ID,
    stackVersion: CERTIFIED_STACK_VERSION,
    newStatus: StackCertificationStatus.CERTIFIED,
    validUntil: VALID_UNTIL,
    reason: "Certify fixture.",
    certificationEvidenceId: certification.evidenceId,
    registryEventId: "decertified-registry-certify",
    eventId: "decertified-ledger-certify",
    causationId: "decertified-certify-command",
    occurredAt: TIME,
  });
  control.toolchains.changeCertification({
    missionId: "decertified-stack",
    stackId: CERTIFIED_STACK_ID,
    stackVersion: CERTIFIED_STACK_VERSION,
    newStatus: StackCertificationStatus.DECERTIFIED,
    reason: "Exercise explicit independent decertification.",
    certificationEvidenceId: certification.evidenceId,
    registryEventId: "decertified-registry-decertify",
    eventId: "decertified-ledger-decertify",
    causationId: "decertified-decertify-command",
    occurredAt: TIME,
  });
  environment(control, "decertified-stack");

  assert.throws(
    () =>
      control.toolchains.selectStack(
        selectionInput("decertified-stack"),
      ),
    UncertifiedStackError,
  );
  const history = control.toolchains.getCertificationHistory(
    CERTIFIED_STACK_ID,
    CERTIFIED_STACK_VERSION,
  );
  assert.deepEqual(
    history.map((entry) => entry.newStatus),
    [
      StackCertificationStatus.CERTIFIED,
      StackCertificationStatus.DECERTIFIED,
    ],
  );
});

test("rejects certification that is stale at selection time", (t) => {
  const control = openControl(temporaryStores(t));
  createMission(control, "stale-stack");
  register(control, "stale-stack");
  certify(
    control,
    "stale-stack",
    "stale-stack",
    "2026-06-02T12:00:00.000Z",
  );
  environment(
    control,
    "stale-stack",
    "stale-stack",
    "2026-06-03T12:00:00.000Z",
  );

  assert.throws(
    () =>
      control.toolchains.selectStack(
        selectionInput(
          "stale-stack",
          "stale-stack",
          "2026-06-03T12:00:00.000Z",
        ),
      ),
    StaleCertificationError,
  );
});

test("selects the one current CERTIFIED compatible stack and records deterministic rationale", (t) => {
  const control = openControl(temporaryStores(t));
  createMission(control, "valid-selection");
  readyRegistry(control, "valid-selection");

  const selection = control.toolchains.selectStack(
    selectionInput("valid-selection"),
  );

  assert.equal(selection.stackId, CERTIFIED_STACK_ID);
  assert.equal(selection.stackVersion, CERTIFIED_STACK_VERSION);
  assert.equal(selection.requestedPlatform, "web");
  assert.deepEqual(selection.rationale, [
    `Platform "web" matches stack "${CERTIFIED_STACK_ID}".`,
    "All 4 requested capabilities are declared.",
    "Certification is current and CERTIFIED.",
    "Node.js, npm, Git, and browser requirements are present and version-compatible.",
  ]);
  const ledgerFact = control.ledger.listEvents("valid-selection").at(-1);
  assert.equal(
    ledgerFact.fact.metadata.registryOperation,
    RegistryOperation.STACK_SELECTED,
  );
  assert.deepEqual(ledgerFact.fact.metadata.rationale, selection.rationale);
  assert.equal(
    ledgerFact.fact.evidenceReferences[0].evidenceId,
    "valid-selection-environment-evidence",
  );
});

test("requires certification evidence and keeps fixture certification unreachable by default production configuration", (t) => {
  const stores = temporaryStores(t);
  const control = openControl(stores);
  createMission(control, "missing-certification-evidence");
  register(control, "missing-certification-evidence");

  assert.throws(
    () =>
      control.toolchains.changeCertification({
        missionId: "missing-certification-evidence",
        stackId: CERTIFIED_STACK_ID,
        stackVersion: CERTIFIED_STACK_VERSION,
        newStatus: StackCertificationStatus.CERTIFIED,
        validUntil: VALID_UNTIL,
        reason: "Must fail without evidence.",
        certificationEvidenceId: "does-not-exist",
        registryEventId: "missing-cert-registry",
        eventId: "missing-cert-ledger",
        causationId: "missing-cert-command",
        occurredAt: TIME,
      }),
    StackCertificationError,
  );

  const productionStores = temporaryStores(t);
  const production = openControl(productionStores, {
    allowDeterministicCertificationFixtures: false,
  });
  createMission(production, "production-certification-guard");
  register(production, "production-certification-guard");
  captureCertificationEvidence(
    production,
    "production-certification-guard",
  );
  assert.throws(
    () =>
      production.toolchains.changeCertification({
        missionId: "production-certification-guard",
        stackId: CERTIFIED_STACK_ID,
        stackVersion: CERTIFIED_STACK_VERSION,
        newStatus: StackCertificationStatus.CERTIFIED,
        validUntil: VALID_UNTIL,
        reason: "Fixture must not certify production.",
        certificationEvidenceId:
          "production-certification-guard-certification-evidence",
        registryEventId: "production-guard-registry",
        eventId: "production-guard-ledger",
        causationId: "production-guard-command",
        occurredAt: TIME,
      }),
    StackCertificationError,
  );
  assert.equal(
    production.toolchains.getStack(
      CERTIFIED_STACK_ID,
      CERTIFIED_STACK_VERSION,
    ).certificationStatus,
    StackCertificationStatus.PROVISIONAL,
  );
});

test("rejects cross-mission environment selection evidence", (t) => {
  const control = openControl(temporaryStores(t));
  createMission(control, "selection-owner");
  createMission(control, "environment-owner");
  register(control, "selection-owner");
  certify(control, "selection-owner");
  environment(control, "environment-owner", "foreign");

  assert.throws(
    () =>
      control.toolchains.selectStack({
        ...selectionInput("selection-owner"),
        environmentCheckId: "foreign-environment",
      }),
    EvidenceReferenceError,
  );
  assert.equal(
    control.ledger.listEvents("selection-owner").some(
      (entry) =>
        entry.fact?.metadata?.registryOperation ===
        RegistryOperation.STACK_SELECTED,
    ),
    false,
  );
});

test("restart reconstructs exact registry, environment, selection, and history from persisted records", (t) => {
  const stores = temporaryStores(t);
  let control = openControl(stores);
  createMission(control, "registry-restart");
  readyRegistry(control, "registry-restart");
  const before = control.toolchains.selectStack(
    selectionInput("registry-restart"),
  );
  const eventsBefore = control.toolchains.listRegistryEvents();
  const stackBefore = control.toolchains.getStack(
    CERTIFIED_STACK_ID,
    CERTIFIED_STACK_VERSION,
  );

  control = openControl(stores);

  assert.deepEqual(
    control.toolchains.getSelection("registry-restart-selection"),
    before,
  );
  assert.deepEqual(control.toolchains.listRegistryEvents(), eventsBefore);
  assert.deepEqual(
    control.toolchains.getStack(
      CERTIFIED_STACK_ID,
      CERTIFIED_STACK_VERSION,
    ),
    stackBefore,
  );
  assert.deepEqual(
    control.toolchains.getEnvironmentCheck(
      "registry-restart-environment",
    ),
    environment(control, "registry-restart", "registry-restart"),
  );
});

test("an interrupted pre-Ledger registration observation is reused safely on restart", (t) => {
  const stores = temporaryStores(t);
  let control = openControl(stores);
  createMission(control, "registration-recovery");
  control.evidence.capture({
    evidenceId: "registration-recovery-register-evidence",
    missionId: "registration-recovery",
    kind: ObservationKind.STRUCTURED_TEST_RESULT,
    captureMethod: "deterministic-stack-manifest-validation",
    producingSubsystem: TOOLCHAIN_STACK_REGISTRY_SOURCE,
    timestamp: TIME,
    payload: {
      suiteName: "stack-manifest-validation",
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    },
    workspaceCheckpointReference: null,
    obligationReference: null,
    verificationRequestReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: {
      manifestHash: WEB_STACK_MANIFEST.manifestHash,
      stackId: CERTIFIED_STACK_ID,
      stackVersion: CERTIFIED_STACK_VERSION,
    },
  });

  control = openControl(stores);
  const recovered = register(control, "registration-recovery");

  assert.equal(
    recovered.certificationStatus,
    StackCertificationStatus.PROVISIONAL,
  );
  assert.equal(
    control.evidence.findByMission("registration-recovery").length,
    1,
  );
  assert.equal(control.toolchains.listRegistryEvents().length, 1);
});

test("registry event tampering is detected before authoritative state can be read", (t) => {
  const stores = temporaryStores(t);
  let control = openControl(stores);
  createMission(control, "registry-tamper");
  register(control, "registry-tamper");
  const registryPath = join(
    stores.registryDirectory,
    "registry-events.jsonl",
  );
  const original = readFileSync(registryPath, "utf8");
  writeFileSync(
    registryPath,
    original.replace(
      '"certificationStatus":"PROVISIONAL"',
      '"certificationStatus":"CERTIFIED"',
    ),
    "utf8",
  );

  control = openControl(stores);
  assert.throws(
    () =>
      control.toolchains.getStack(
        CERTIFIED_STACK_ID,
        CERTIFIED_STACK_VERSION,
      ),
    RegistryCorruptionError,
  );
});

test("the registry exposes procedures as data and no execution, generation, preview, repair, model, or UI authority", (t) => {
  const control = openControl(temporaryStores(t));
  assert.deepEqual(
    Object.keys(control.toolchains).sort(),
    [
      "changeCertification",
      "checkEnvironment",
      "getCertificationHistory",
      "getEnvironmentCheck",
      "getMissionSelection",
      "getSelection",
      "getStack",
      "listRegistryEvents",
      "listStacks",
      "manifestTemplate",
      "registerStack",
      "selectStack",
      "selectStackForCertification",
    ],
  );
  for (const forbidden of [
    "execute",
    "generateProject",
    "install",
    "preview",
    "repair",
    "run",
    "selectModel",
  ]) {
    assert.equal(control.toolchains[forbidden], undefined);
  }
  assert.equal(control.orchestrator.selectStack, undefined);
  assert.equal(control.ledger.appendRegistryEvent, undefined);
  assert.equal(control.toolchains.manifestTemplate.procedures.install.executable, "npm");
  assert.deepEqual(
    control.toolchains.manifestTemplate.procedures.install.arguments,
    ["ci"],
  );
});
