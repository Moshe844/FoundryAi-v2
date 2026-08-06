import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  productionBrowserRepairPolicy,
  productionRepairBudgets,
} from "../src/work-plane/production-mission-service.js";

test("production repair budgets allow bounded evidence-backed recovery", () => {
  assert.deepEqual(productionRepairBudgets(), {
    generationCorrectionCalls: 0,
    procedureRepairCalls: 0,
    browserRepairCalls: 4,
    designFidelityRepairCalls: 4,
    runtimeRestarts: 2,
  });
  assert.deepEqual(productionRepairBudgets({ approvedPrototype: true }), {
    generationCorrectionCalls: 2,
    procedureRepairCalls: 2,
    browserRepairCalls: 4,
    designFidelityRepairCalls: 4,
    runtimeRestarts: 2,
  });
});

test("approved-design semantic admission stays inside the bounded correction loop", async () => {
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  const generationSection = source.slice(
    source.indexOf("const generationRequestId"),
    source.indexOf("const bundle ="),
  );

  assert.match(
    generationSection,
    /for \(;;\) \{[\s\S]*validateContractBoundMissionPlan\([\s\S]*catch \(error\)/u,
  );
  assert.doesNotMatch(
    generationSection,
    /structuredOutputValidator:\s*approvedContract/u,
  );
});

test("browser observation and design fidelity repairs have independent budgets", () => {
  const browser = productionBrowserRepairPolicy(
    "The structured browser result did not contain exactly the required browser-check obligation IDs.",
  );
  const fidelity = productionBrowserRepairPolicy(
    "Production design fidelity failed against the approved live prototype: typography.",
  );

  // Both repair loops converge once their failures carry measurements: browser
  // checks fell 8 then 5 then 3, fidelity aspects 6 then 5 then 2, and a budget
  // of two truncated each descent while it was still making progress.
  assert.deepEqual(browser, {
    designFidelity: false,
    requestSegment: "browser-repair",
    maxCalls: 4,
  });
  assert.deepEqual(fidelity, {
    designFidelity: true,
    requestSegment: "design-fidelity-repair",
    maxCalls: 4,
  });
  assert.equal(browser.maxCalls, fidelity.maxCalls);
  assert.notEqual(browser.requestSegment, fidelity.requestSegment);
});

test("a patch rejected before it touches a file does not spend the repair budget", async () => {
  // The real failure: of four paid fidelity attempts, two were rejected for a
  // mechanical patch mistake — one oldText that no longer matched, one set of
  // replacements that changed nothing — and the budget counted them as if the
  // repair had reasoned wrongly. The build ended at the limit having applied
  // only two corrections, with the approved design still unmatched.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );
  const budgetGuard = source.slice(
    source.indexOf("const repairCallsSoFar = models"),
    source.indexOf("repair = await requestBrowserRepair"),
  );

  assert.match(
    budgetGuard,
    /appliedRepairs = repairCallsSoFar\.filter\(\s*\(call\) => call\.status === "SUCCEEDED",\s*\)\.length/u,
    "the budget must count corrections that were actually applied",
  );
  assert.match(
    budgetGuard,
    /appliedRepairs >= repairPolicy\.maxCalls/u,
    "the budget must come from the failing loop's own policy, not one constant",
  );
  // Uncounted rejections still need a ceiling of their own.
  assert.match(
    budgetGuard,
    /repairCallsSoFar\.length >=\s*repairPolicy\.maxCalls \* MAX_REPAIR_PROPOSALS_PER_ROUND/u,
  );
});

test("a rejected patch names the text that failed and why", async () => {
  const { validateBrowserRepairProposal } = await import(
    "../src/work-plane/production-mission-service.js"
  );
  const currentFiles = [
    { path: "app/globals.css", content: "body{color:#333;font-family:serif}" },
  ];

  // Absent text: the retry needs to know which edit was unusable, not only
  // that one of them was.
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          files: [
            {
              path: "app/globals.css",
              replacements: [
                { oldText: "font-weight:700", newText: "font-weight:400" },
              ],
            },
          ],
        },
        currentFiles,
        requiredBrowserCheckIds: [],
      }),
    /never appears — oldText: "font-weight:700"[\s\S]*Copy oldText verbatim/u,
  );

  // A no-op patch says so plainly rather than reporting a count.
  assert.throws(
    () =>
      validateBrowserRepairProposal({
        structuredOutput: {
          files: [
            {
              path: "app/globals.css",
              replacements: [{ oldText: "color:#333", newText: "color:#333" }],
            },
          ],
        },
        currentFiles,
        requiredBrowserCheckIds: [],
      }),
    /do not change the current file in app\/globals\.css/u,
  );
});

test("a proven application is delivered even when its design falls short", async () => {
  // Of thirty recorded failures on the approved-prototype path, nine had every
  // required browser check observed true — add an item, update a quantity,
  // delete with confirmation, survive a refresh, all proven in a real browser —
  // and the mission was failed anyway because the produced layout was not close
  // enough to the approved prototype. That is working software destroyed over a
  // geometry distance, and it is the single largest cause of "Foundry built
  // nothing" on that path.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  // Behaviour is what must hold: every required check true, and no failure
  // outstanding other than fidelity.
  assert.match(
    source,
    /const behaviourProven =\s*\n\s*browserResult !== undefined &&\s*\n\s*!nonFidelityFailureOutstanding &&\s*\n\s*requiredBrowserChecks\.every\(\s*\n\s*\(checkId\) => browserResult\.checks\[checkId\] === true,\s*\n\s*\);/u,
    "acceptance must require every browser check and no non-fidelity failure",
  );

  // Only a design-fidelity observation may be waived. Anything else — a false
  // check, a console error, an unparseable result — still fails the mission.
  assert.match(
    source,
    /nonFidelityFailureOutstanding = observationFailures\.some\(\s*\n\s*\(failure\) =>\s*\n\s*!\/\^Production design fidelity failed/u,
  );

  // Both places that previously destroyed the build now deliver it first.
  const budgetGate = source.slice(
    source.indexOf("if (priorRepairCalls.length >= repairPolicy.maxCalls)"),
    source.indexOf("const repairsWereAttempted"),
  );
  assert.match(budgetGate, /if \(behaviourProven\) \{[\s\S]*acceptWithShortfall/u);

  const stallGate = source.slice(
    source.indexOf("if (stalledRounds >= 2 && behaviourProven)"),
    source.indexOf("browser-repair-stalled"),
  );
  assert.match(stallGate, /acceptWithShortfall\(/u);

  // Acceptance must not move the mission's state. It is already EXECUTING and
  // stays there until verification; asking the orchestrator for
  // EXECUTING -> EXECUTING is rejected outright, and that killed a build whose
  // application had been proven and was about to be delivered.
  const acceptance = source.slice(
    source.indexOf("const acceptWithShortfall ="),
    source.indexOf("previousOutstandingFailures = outstandingFailures"),
  );
  assert.doesNotMatch(
    acceptance,
    /orchestrator\.transition\(/u,
    "accepting a shortfall must not transition the mission's state",
  );
  assert.match(acceptance, /observationVerified = true/u);

  // The shortfall must be recorded as evidence and named in the verdict, so a
  // delivered project is never silently passed off as fully matching.
  assert.match(source, /\$\{missionId\}-design-fidelity-shortfall/u);
  assert.match(
    source,
    /The approved design was matched except for: \$\{designFidelityShortfall\.failedAspects\.join\(", "\)/u,
  );
});

test("browser observation stops at the round count that still succeeds", async () => {
  // Measured across every recorded build that reached a browser: of the eight
  // that took five rounds or more, none succeeded. Of those needing four or
  // fewer, five did. Each further round is about ninety seconds of Playwright
  // and a paid repair call, so a ceiling of seven spent four extra minutes on
  // builds that were already lost — with the customer watching "Testing
  // important actions" the whole time.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /const MAX_BROWSER_OBSERVATION_ATTEMPTS = 4;/u);
  assert.match(
    source,
    /for \(let attempt = 0; attempt < MAX_BROWSER_OBSERVATION_ATTEMPTS; attempt \+= 1\)/u,
    "the observation loop must take its ceiling from the measured constant",
  );

  // The repair budgets must not promise more corrections than there are rounds
  // to apply them in, or the budget stops meaning anything.
  const { browserRepairCalls, designFidelityRepairCalls } =
    productionRepairBudgets({ approvedPrototype: true });
  assert.ok(browserRepairCalls <= 4);
  assert.ok(designFidelityRepairCalls <= 4);
});

test("the accepted shortfall never stands in for an obligation's evidence", async () => {
  // The real failure, and the third time the delivery path broke a build that
  // had been proven. Verification resolves a browser-check obligation by taking
  // the LAST browser-interaction record for the mission and treating it as the
  // only evidence for every such obligation. The shortfall was recorded in that
  // kind, after the observation, so it replaced a result whose ten checks were
  // all true with one whose keys are design aspects. Every proven obligation
  // read as unsatisfied, the verdict came back INCOMPLETE, and the build was
  // sent back to repair having already passed.
  const { ObservationKind, normalizeEvidenceInput } = await import(
    "../src/domain/observation-evidence.js"
  );
  const { evaluateAcceptanceCondition } = await import(
    "../src/domain/verification.js"
  );

  const shortfall = normalizeEvidenceInput({
    evidenceId: "mission-x-design-fidelity-shortfall",
    missionId: "mission-x",
    kind: ObservationKind.REPAIR_FINDING,
    captureMethod: "same-browser-same-viewport-prototype-comparison",
    producingSubsystem: "production-mission-service",
    timestamp: "2026-08-06T16:32:45.000Z",
    payload: {
      recordType: "design-fidelity-shortfall",
      record: {
        accepted: true,
        reason: "Its 4 safe design corrections are spent.",
        failedAspects: ["surface-order"],
        comparedViewports: null,
        integrityHash: null,
        observation: "Production design fidelity failed: surface-order.",
      },
    },
    metadata: { accepted: true, failedAspects: ["surface-order"] },
    workspaceCheckpointReference: "mission-x-033-post",
    obligationReference: null,
    verificationRequestReference: "mission-x-verification",
    commandReference: "mission-x-033",
    workUnitReference: "mission-x-033",
    sensitiveValues: [],
  });

  // It must not be a browser-interaction record, because that kind is what
  // verification selects from — last one wins, for every obligation.
  assert.notEqual(shortfall.kind, ObservationKind.BROWSER_INTERACTION_RESULT);

  // The real observation, recorded before it, still satisfies the obligation
  // even when the shortfall is the newer record.
  const observation = normalizeEvidenceInput({
    evidenceId: "mission-x-browser-evidence-3.interactions",
    missionId: "mission-x",
    kind: ObservationKind.BROWSER_INTERACTION_RESULT,
    captureMethod: "playwright-browser-observation",
    producingSubsystem: "runtime-preview-service",
    timestamp: "2026-08-06T16:32:28.000Z",
    payload: { checks: { "obligation-001": true, "obligation-002": true } },
    metadata: {},
    workspaceCheckpointReference: "mission-x-033-post",
    obligationReference: null,
    verificationRequestReference: "mission-x-verification",
    commandReference: "mission-x-033",
    workUnitReference: "mission-x-033",
    sensitiveValues: [],
  });

  const verdict = evaluateAcceptanceCondition(
    {
      type: "browser-check-equals",
      check: "obligation-001",
      expected: true,
      checkpointIndependent: false,
    },
    [observation, shortfall],
  );
  assert.equal(verdict.result, "SATISFIED");
});

test("a repair re-verifies what it changed, and only once", async () => {
  // Measured on a twelve-minute build: browser verification was 93 seconds
  // across all four rounds, while re-verifying repairs took about 145. Every
  // correction ran tsc --noEmit, then eslint, then next build — and next build
  // type-checks and lints the project itself.
  const source = await readFile(
    new URL("../src/work-plane/production-mission-service.js", import.meta.url),
    "utf8",
  );

  // Ask what changed, not what did not. A multi-file repair may correct a
  // Playwright spec and a stylesheet together, and reading "some file was a
  // test" as "nothing shipped changed" skipped verification on a real edit.
  assert.match(
    source,
    /const changesApplicationArtifact = acceptedRepair\.files\.some\(\s*\n\s*\(file\) => !file\.repairsTestSource && !file\.repairsPlaywrightConfig,\s*\n\s*\);/u,
    "the build must be required when any shipped artifact changed",
  );

  // Type-check and lint run again only when an obligation reads their own
  // evidence, since skipping those would leave a verdict resolving from a run
  // that predates the repair.
  const block = source.slice(
    source.indexOf("const boundToOwnObligation ="),
    source.indexOf("let brokenByRepair"),
  );
  assert.match(block, /boundToOwnObligation\("typeCheck"\)/u);
  assert.match(block, /boundToOwnObligation\("lint"\)/u);
  assert.match(block, /\["productionBuild", 600_000\],\s*\n\s*\];/u);

  // A repair touching only Playwright files skips the pipeline entirely: since
  // tests are excluded from the build, they cannot affect it.
  const testOnly = {
    files: [
      { path: "tests/foundry-checks.ts", repairsTestSource: true, repairsPlaywrightConfig: false },
    ],
  };
  const mixed = {
    files: [
      { path: "tests/foundry-checks.ts", repairsTestSource: true, repairsPlaywrightConfig: false },
      { path: "app/globals.css", repairsTestSource: false, repairsPlaywrightConfig: false },
    ],
  };
  const changed = (repair) =>
    repair.files.some((file) => !file.repairsTestSource && !file.repairsPlaywrightConfig);
  assert.equal(changed(testOnly), false, "a test-only repair needs no build");
  assert.equal(changed(mixed), true, "a mixed repair still needs the build");
});
