import assert from "node:assert/strict";
import test from "node:test";

import {
  bindApprovedPrototypeSourceGuardrails,
  ensureCertifiedStackScaffold,
  hasBalancedJavaScriptDelimiters,
} from "../src/work-plane/production-mission-service.js";

function approvedContract() {
  return {
    productBlueprint: {
      designSpecification: {
        approvedDesignContract: {
          colorTokens: {
            background: "#111111",
            surface: "#1d1d1b",
            accent: "#d8ff3e",
          },
          motion: [
            "restrained",
            "Honor prefers-reduced-motion without removing content or meaning.",
          ],
        },
      },
    },
  };
}

test("Foundry deterministically binds mechanical approved-design CSS guardrails", () => {
  const plan = {
    designFidelity: { sourceFiles: ["app/page.tsx", "app/globals.css"] },
    files: [
      { path: "app/page.tsx", content: "export default function Page(){return <main/>}" },
      { path: "app/globals.css", content: "body { color: #111111; }" },
    ],
  };

  const guarded = bindApprovedPrototypeSourceGuardrails(plan, approvedContract());
  const css = guarded.files.find((file) => file.path === "app/globals.css").content;
  assert.match(css, /--foundry-approved-surface:\s*#1d1d1b/u);
  assert.match(css, /--foundry-approved-accent:\s*#d8ff3e/u);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.equal(guarded.files[0].content, plan.files[0].content);
  assert.deepEqual(
    bindApprovedPrototypeSourceGuardrails(guarded, approvedContract()),
    guarded,
  );
});

test("source guardrails do not invent a stylesheet for a non-prototype plan", () => {
  const plan = { files: [{ path: "app/page.tsx", content: "export default function Page(){return <main/>}" }] };
  assert.equal(bindApprovedPrototypeSourceGuardrails(plan, {}), plan);
});

test("the certified stack owns the root import alias mapping", () => {
  const files = ensureCertifiedStackScaffold(
    [
      {
        path: "app/page.tsx",
        content: 'import { database } from "@/lib/database"; export default function Page(){return <main>{String(database)}</main>}',
        contractRequirementIds: ["obligation-1"],
      },
      {
        path: "lib/database.ts",
        content: "export const database = 'ready';",
        contractRequirementIds: ["obligation-1"],
      },
      {
        path: "tsconfig.json",
        content: JSON.stringify({ compilerOptions: { strict: true } }),
        contractRequirementIds: ["obligation-1"],
      },
    ],
    ["obligation-1"],
  );
  const configuration = JSON.parse(
    files.find((file) => file.path === "tsconfig.json").content,
  );
  assert.equal(configuration.compilerOptions.baseUrl, ".");
  assert.deepEqual(configuration.compilerOptions.paths["@/*"], ["./*"]);
});

test("responsive and accessibility probes preserve semicolon-free browser tests", () => {
  const files = ensureCertifiedStackScaffold(
    [
      {
        path: "tests/verification.spec.ts",
        content: `const checks: Record<string, boolean> = {}
async function verify(page: any) {
  await page.goto('/')
  checks['obligation-1'] = true
  console.log('FOUNDRY_BROWSER_RESULT:' + JSON.stringify({ checks }))
}`,
        contractRequirementIds: ["obligation-1"],
      },
    ],
    ["obligation-1"],
    {
      responsiveCheckIds: ["obligation-1"],
      accessibilityCheckIds: ["obligation-1"],
    },
  );
  const testSource = files.find(
    (file) => file.path === "tests/verification.spec.ts",
  ).content;
  assert.equal(hasBalancedJavaScriptDelimiters(testSource), true);
  assert.match(
    testSource,
    /checks\['obligation-1'\]\s*=\s*\(\(true\) && __foundryResponsiveEvidence\) && __foundryAccessibilityEvidence/u,
  );
  assert.doesNotMatch(testSource, /__foundryAccessibilityEvidence\) && __foundryAccessibilityEvidence/u);
});
