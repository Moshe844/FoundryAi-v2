// Static audit: does a bundle whose checks Foundry compiled survive every gate
// a real build applies? Three builds died discovering these one at a time, at
// the cost of a paid regeneration each. This finds them for free.
import { readFileSync } from "node:fs";

import {
  DECLARED_CHECKS_PATH,
  bindFoundryObservationHarness,
  ensureCertifiedStackScaffold,
  validateProjectBundleForStack,
} from "../src/work-plane/production-mission-service.js";

const ids = [
  "obligation-001", "obligation-002", "obligation-003", "obligation-004",
  "obligation-005", "obligation-006", "obligation-007", "obligation-008",
  "obligation-009",
];
const task = { how: "css", value: "[data-task]" };
const done = { how: "css", value: "[data-task][data-done]" };

// Every primitive, so the audit covers the whole emitted vocabulary rather than
// the one shape the last build happened to use.
const declarations = {
  checks: [
    { checkId: "obligation-001", primitive: "element-visible", target: { how: "role", value: "heading", name: "Tasks" } },
    { checkId: "obligation-002", primitive: "text-present", expectText: "No tasks yet" },
    { checkId: "obligation-003", primitive: "element-count", target: task, expectCount: { of: task, equals: { countOf: done } } },
    { checkId: "obligation-004", primitive: "computed-style", target: task, property: "color", equals: "rgb(17, 17, 17)" },
    { checkId: "obligation-005", primitive: "attribute-equals", target: task, property: "data-done", equals: "true" },
    { checkId: "obligation-006", primitive: "submit-form",
      fields: [{ field: { how: "label", value: "New task" }, value: "Buy milk" }],
      submit: { how: "role", value: "button", name: "Add task" },
      expectVisible: { how: "text", value: "Buy milk" } },
    { checkId: "obligation-007", primitive: "click-then-expect", target: { how: "role", value: "checkbox", name: "Buy milk" }, expectCount: { of: done, equals: 1 } },
    { checkId: "obligation-008", primitive: "select-then-expect", target: { how: "label", value: "Status" }, equals: "Done", expectCount: { of: task, equals: { countOf: done } } },
    { checkId: "obligation-009", primitive: "survives-reload", expectText: "Buy milk" },
  ],
};

// A real delivered scaffold, so the audit meets the same validators a build does.
const scaffold = JSON.parse(readFileSync("C:/tmp/scaffold.json", "utf8")).map((file) => ({
  ...file,
  contractRequirementIds: ["customer-intent-1"],
  sourceRequirementIds: ["customer-intent-1"],
}));

const bound = bindFoundryObservationHarness(
  {
    files: [
      ...scaffold,
      {
        path: DECLARED_CHECKS_PATH,
        content: JSON.stringify(declarations),
        contractRequirementIds: ["customer-intent-1"],
        sourceRequirementIds: ["customer-intent-1"],
      },
    ],
  },
  ids,
);

const compiled = bound.files.find((file) => file.path === "tests/foundry-checks.ts");
console.log(`compiled: ${compiled ? `${compiled.content.split("\n").length} lines` : "NOTHING"}`);
console.log(`all ${ids.length} checks emitted: ${ids.every((id) => compiled?.content.includes(`"${id}"`))}`);

const scaffolded = ensureCertifiedStackScaffold(bound.files, ["customer-intent-1"], {});
console.log(`bundle files: ${scaffolded.length}`);
try {
  validateProjectBundleForStack(scaffolded, ids, null, {});
  console.log("\nBUNDLE VALIDATION: PASSED — the compiled checks clear every gate");
} catch (error) {
  console.log(`\nBUNDLE VALIDATION FAILED:\n  ${String(error.message).slice(0, 500)}`);
}

// The exemption must not be hiding real defects. Run the compiled module
// through the model-code rules explicitly and report anything it trips.
const { validateBrowserObservationTestSource, foundryObservationHarness } = await import(
  "../src/work-plane/production-mission-service.js"
);
const harness = foundryObservationHarness(ids);
try {
  validateBrowserObservationTestSource(`${harness}\n${compiled.content}`, ids, {});
  console.log("\nMODEL-CODE RULES: the compiled module would pass them too");
} catch (error) {
  console.log(`\nMODEL-CODE RULES would reject it:\n  ${String(error.message).slice(0, 400)}`);
}
