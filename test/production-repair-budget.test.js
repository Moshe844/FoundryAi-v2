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

  // The shortfall must be recorded as evidence and named in the verdict, so a
  // delivered project is never silently passed off as fully matching.
  assert.match(source, /\$\{missionId\}-design-fidelity-shortfall/u);
  assert.match(
    source,
    /The approved design was matched except for: \$\{designFidelityShortfall\.failedAspects\.join\(", "\)/u,
  );
});
