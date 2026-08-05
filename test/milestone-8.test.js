import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  CERTIFIED_STACK_ID,
  CERTIFIED_STACK_VERSION,
  CertificationEvidenceScope,
  MissionState,
  ModelTaskClass,
  ObservationKind,
  RuntimePortConflictError,
  RuntimeStatus,
  StackCertificationStatus,
  WEB_STACK_MANIFEST,
  WorkUnitAction,
  WorkUnitStatus,
  createDeterministicLocalModelProvider,
  openMissionControl,
} from "../src/index.js";

const VERIFY_REQUEST = "inventory-production-verification";
const REQUIRED_CAPABILITIES = [
  "automated-tests",
  "browser-verification",
  "create-records",
  "development-runtime",
  "production-build",
  "refresh-persistence",
  "sqlite-persistence",
  "typescript",
  "update-records",
  "web-application",
];

function temporaryStores(t, prefix = "foundry-v2-runtime-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    ledgerDirectory: join(root, "ledger"),
    evidenceDirectory: join(root, "evidence"),
    workspaceDirectory: join(root, "workspaces"),
    registryDirectory: join(root, "registry"),
  };
}

export function inventorySources() {
  return Object.freeze({
    "package.json": JSON.stringify(
      {
        name: "foundry-inventory",
        version: "1.0.0",
        private: true,
        scripts: {
          build: "next build",
          lint: "eslint . --max-warnings=0",
          start: "next start",
          test: "playwright test",
          typecheck: "tsc --noEmit",
        },
        dependencies: {
          "better-sqlite3": "13.0.1",
          next: "15.4.4",
          react: "19.1.0",
          "react-dom": "19.1.0",
        },
        devDependencies: {
          "@eslint/eslintrc": "3.3.1",
          "@playwright/test": "1.54.2",
          "@types/better-sqlite3": "7.6.13",
          "@types/node": "22.17.0",
          "@types/react": "19.1.9",
          "@types/react-dom": "19.1.7",
          eslint: "9.32.0",
          "eslint-config-next": "15.4.4",
          typescript: "5.8.3",
        },
      },
      null,
      2,
    ) + "\n",
    "tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`,
    "next-env.d.ts": `/// <reference types="next" />
/// <reference types="next/image-types/global" />
`,
    "next.config.mjs": `/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
`,
    "eslint.config.mjs": `import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  { ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**"] },
];

export default eslintConfig;
`,
    "playwright.config.ts": `import { defineConfig } from "@playwright/test";

const baseURL = process.env.FOUNDRY_PREVIEW_URL;
if (!baseURL) throw new Error("FOUNDRY_PREVIEW_URL is required.");

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
  },
});
`,
    "src/app/globals.css": `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  background: #f4f6f8;
  color: #17212b;
}
* { box-sizing: border-box; }
body { margin: 0; }
main { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
h1 { margin: 0 0 8px; font-size: 2.4rem; }
.subtitle { color: #5d6975; margin: 0 0 32px; }
form, .product {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr 160px auto;
  align-items: end;
  background: white;
  padding: 18px;
  border: 1px solid #dbe1e7;
  border-radius: 12px;
  margin-bottom: 16px;
}
label { display: grid; gap: 6px; font-weight: 600; }
input { padding: 10px 12px; border: 1px solid #aeb8c2; border-radius: 7px; font: inherit; }
button { padding: 10px 16px; border: 0; border-radius: 7px; background: #1463ff; color: white; font-weight: 700; cursor: pointer; }
.product { grid-template-columns: 1fr 170px auto; }
.product strong { align-self: center; font-size: 1.1rem; }
.empty { padding: 24px; text-align: center; color: #687480; }
@media (max-width: 650px) { form, .product { grid-template-columns: 1fr; } }
`,
    "src/app/layout.tsx": `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inventory",
  description: "A small persistent inventory application",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    "src/app/icon.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#1463ff"/>
  <path d="M16 18h32v10H16zm0 14h32v14H16z" fill="#fff"/>
</svg>
`,
    "src/app/page.tsx": `"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Product = { id: number; name: string; stock: number };

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [stock, setStock] = useState("0");
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    const response = await fetch("/api/products", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load inventory.");
    setProducts(await response.json() as Product[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function addProduct(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, stock: Number(stock) }),
    });
    if (!response.ok) throw new Error("Unable to add product.");
    setName("");
    setStock("0");
    await load();
  }

  async function saveStock(product: Product) {
    const response = await fetch(\`/api/products/\${product.id}\`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stock: Number(drafts[product.id] ?? product.stock) }),
    });
    if (!response.ok) throw new Error("Unable to update stock.");
    setDrafts((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    await load();
  }

  return (
    <main>
      <h1>Inventory</h1>
      <p className="subtitle">Track products and stock quantities.</p>
      <form onSubmit={addProduct}>
        <label>
          Product name
          <input aria-label="Product name" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Starting stock
          <input aria-label="Starting stock" type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} required />
        </label>
        <button type="submit">Add product</button>
      </form>
      <section aria-label="Inventory list">
        {products.length === 0 ? <p className="empty">No products yet.</p> : products.map((product) => (
          <article className="product" data-testid="product-row" key={product.id}>
            <strong>{product.name}</strong>
            <label>
              Stock
              <input
                aria-label={\`Stock for \${product.name}\`}
                type="number"
                min="0"
                value={drafts[product.id] ?? String(product.stock)}
                onChange={(event) => setDrafts((current) => ({ ...current, [product.id]: event.target.value }))}
              />
            </label>
            <button type="button" onClick={() => void saveStock(product)}>Save {product.name}</button>
          </article>
        ))}
      </section>
    </main>
  );
}
`,
    "src/lib/db.ts": `import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";

const dataDirectory = path.join(process.cwd(), "data");
const globalDatabase = globalThis as typeof globalThis & {
  foundryInventoryDatabase?: Database.Database;
};

export function getDatabase() {
  if (!globalDatabase.foundryInventoryDatabase) {
    mkdirSync(dataDirectory, { recursive: true });
    const database = new Database(path.join(dataDirectory, "inventory.db"), {
      timeout: 5_000,
    });
    database.pragma("journal_mode = WAL");
    database.exec(\`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        stock INTEGER NOT NULL CHECK (stock >= 0)
      )
    \`);
    globalDatabase.foundryInventoryDatabase = database;
  }
  return globalDatabase.foundryInventoryDatabase;
}

export type Product = { id: number; name: string; stock: number };
`,
    "src/app/api/health/route.ts": `export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json({ ready: true }, { status: 200 });
}
`,
    "src/app/api/products/route.ts": `import { getDatabase, type Product } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const database = getDatabase();
  const products = database.prepare("SELECT id, name, stock FROM products ORDER BY id").all() as Product[];
  return Response.json(products);
}

export async function POST(request: Request) {
  const database = getDatabase();
  const body = await request.json() as { name?: unknown; stock?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const stock = Number(body.stock);
  if (!name || !Number.isInteger(stock) || stock < 0) {
    return Response.json({ error: "A name and non-negative integer stock are required." }, { status: 400 });
  }
  const result = database.prepare("INSERT INTO products (name, stock) VALUES (?, ?)").run(name, stock);
  return Response.json({ id: Number(result.lastInsertRowid), name, stock }, { status: 201 });
}
`,
    "src/app/api/products/[id]/route.ts": `import { getDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const database = getDatabase();
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  const body = await request.json() as { stock?: unknown };
  const stock = Number(body.stock);
  if (!Number.isInteger(id) || !Number.isInteger(stock) || stock < 0) {
    return Response.json({ error: "A valid product and stock are required." }, { status: 400 });
  }
  const result = database.prepare("UPDATE products SET stock = ? WHERE id = ?").run(stock, id);
  if (result.changes !== 1) {
    return Response.json({ error: "Product not found." }, { status: 404 });
  }
  return Response.json({ id, stock });
}
`,
    "tests/inventory.spec.ts": `import { expect, test } from "@playwright/test";

test("inventory workflow persists through refresh without browser errors", async ({ browser }) => {
  const context = await browser.newContext();
  const captureProbeErrors: string[] = [];
  const probe = await context.newPage();
  probe.on("console", (message) => {
    if (message.type() === "error") captureProbeErrors.push(message.text());
  });
  await probe.goto("data:text/html,<title>capture-probe</title>");
  await probe.evaluate(() => console.error("foundry-console-capture-probe"));
  await expect.poll(() => captureProbeErrors.length).toBe(1);
  await probe.close();

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const checks = {
    inventoryPageLoaded: false,
    productCreated: false,
    startingStockVisible: false,
    stockEdited: false,
    persistenceAfterRefresh: false,
  };
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  checks.inventoryPageLoaded = true;
  const existingProductCount = await page
    .locator('[data-testid="product-row"]')
    .count();
  const productName = "Widget-" + String(existingProductCount + 1);

  await page.getByLabel("Product name").fill(productName);
  await page.getByLabel("Starting stock").fill("5");
  console.log("FOUNDRY_BROWSER_PHASE:product-add");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  checks.productCreated = true;
  await expect(page.getByLabel("Stock for " + productName)).toHaveValue("5");
  checks.startingStockVisible = true;

  await page.getByLabel("Stock for " + productName).fill("9");
  const stockUpdateResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" && response.ok(),
  );
  const inventoryReloadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === "/api/products" &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Save " + productName }).click();
  await stockUpdateResponse;
  await inventoryReloadResponse;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      ),
  );
  await expect(page.getByLabel("Stock for " + productName)).toHaveValue("9");
  checks.stockEdited = true;

  console.log("FOUNDRY_BROWSER_PHASE:persistence-refresh");
  await page.reload();
  await expect(page.getByText(productName, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Stock for " + productName)).toHaveValue("9");
  checks.persistenceAfterRefresh = true;

  const result = { captureProbeErrors, checks, consoleErrors, pageErrors };
  console.log("FOUNDRY_BROWSER_RESULT:" + JSON.stringify(result));
  expect(captureProbeErrors).toContain("foundry-console-capture-probe");
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await context.close();
});
`,
  });
}

export function createInventoryProvider(overrides = {}) {
  const sources = Object.freeze({ ...inventorySources(), ...overrides });
  return createDeterministicLocalModelProvider({
    providerId: "milestone8-recorded-generation",
    handler(request) {
      const prefix = "Generate project file ";
      if (!request.purpose.startsWith(prefix)) {
        throw new Error("Unsupported deterministic generation request.");
      }
      const path = request.purpose.slice(prefix.length);
      const content = sources[path];
      if (content === undefined) {
        throw new Error(`No recorded generation response for ${path}.`);
      }
      return {
        output: { path, content },
        usage: {
          inputTokens: 100,
          outputTokens: Math.ceil(content.length / 4),
          costUsd: 0,
        },
      };
    },
  });
}

export function inventoryObligations() {
  const browser = (id, statement, check) => ({
    obligationId: id,
    statement,
    origin: "customer-stated",
    acceptanceCondition: {
      type: "browser-check-equals",
      check,
      expected: true,
    },
    requiredEvidenceKinds: [ObservationKind.BROWSER_INTERACTION_RESULT],
    dependencyObligationIds: [],
    contractVersion: 1,
  });
  const command = (id, statement) => ({
    obligationId: id,
    statement,
    origin: "foundry-derived",
    acceptanceCondition: {
      type: "command-exit-code-equals",
      expectedExitCode: 0,
      checkpointIndependent: true,
    },
    requiredEvidenceKinds: [ObservationKind.COMMAND_EXIT_RESULT],
    dependencyObligationIds: [],
    contractVersion: 1,
  });
  return [
    browser("page-loads", "The inventory page loads.", "inventoryPageLoaded"),
    browser("product-created", "A product can be added.", "productCreated"),
    browser(
      "starting-stock",
      "A product's starting stock appears.",
      "startingStockVisible",
    ),
    browser("stock-edited", "Stock can be edited.", "stockEdited"),
    browser(
      "refresh-persists",
      "Product and stock persist after refresh.",
      "persistenceAfterRefresh",
    ),
    command("dependencies-install", "Project dependencies install successfully."),
    command("type-checks", "The project type-checks successfully."),
    command("lint-passes", "The project lint procedure succeeds."),
    command("production-build", "The production build succeeds."),
    {
      obligationId: "runtime-ready",
      statement: "The production runtime becomes ready under HTTP observation.",
      origin: "foundry-derived",
      acceptanceCondition: {
        type: "runtime-readiness-equals",
        expectedReady: true,
      },
      requiredEvidenceKinds: [ObservationKind.RUNTIME_READINESS_RESULT],
      dependencyObligationIds: ["production-build"],
      contractVersion: 1,
    },
    {
      obligationId: "no-browser-errors",
      statement: "The primary workflow has no blocking console or page errors.",
      origin: "foundry-derived",
      acceptanceCondition: {
        type: "browser-error-counts",
        maxConsoleErrors: 0,
        maxPageErrors: 0,
      },
      requiredEvidenceKinds: [ObservationKind.BROWSER_ERROR_RESULT],
      dependencyObligationIds: ["runtime-ready"],
      contractVersion: 1,
    },
  ];
}

export function createMissionThroughExecuting(
  control,
  missionId,
  { registerStack = false, fullContract = true } = {},
) {
  control.orchestrator.createMission({
    missionId,
    eventId: `${missionId}-created`,
    causationId: `${missionId}-intent`,
    reason: "Build the supported persistent inventory web application.",
  });
  if (registerStack) {
    control.toolchains.registerStack({
      missionId,
      manifest: WEB_STACK_MANIFEST,
      registryEventId: `${missionId}-registry-register`,
      eventId: `${missionId}-ledger-register`,
      causationId: `${missionId}-register`,
      evidenceId: `${missionId}-register-evidence`,
    });
  }
  control.toolchains.checkEnvironment({
    missionId,
    environmentCheckId: `${missionId}-environment`,
    registryEventId: `${missionId}-registry-environment`,
    eventId: `${missionId}-ledger-environment`,
    causationId: `${missionId}-environment`,
    evidenceId: `${missionId}-environment-evidence`,
  });
  control.toolchains.selectStackForCertification({
    missionId,
    selectionId: `${missionId}-selection`,
    stackId: CERTIFIED_STACK_ID,
    stackVersion: CERTIFIED_STACK_VERSION,
    environmentCheckId: `${missionId}-environment`,
    requestedPlatform: "web",
    requiredCapabilities: fullContract ? REQUIRED_CAPABILITIES : [],
    registryEventId: `${missionId}-registry-selection`,
    eventId: `${missionId}-ledger-selection`,
    causationId: `${missionId}-selection`,
  });
  const obligations = fullContract
    ? inventoryObligations()
    : [
        {
          obligationId: "runtime-ready",
          statement: "The runtime starts successfully.",
          origin: "foundry-derived",
          acceptanceCondition: {
            type: "runtime-readiness-equals",
            expectedReady: true,
          },
          requiredEvidenceKinds: [ObservationKind.RUNTIME_READINESS_RESULT],
          dependencyObligationIds: [],
          contractVersion: 1,
        },
      ];
  control.contracts.createContract({
    missionId,
    eventId: `${missionId}-contract`,
    causationId: `${missionId}-contract-command`,
    contractVersion: 1,
    obligations,
  });
  for (const [to, suffix] of [
    [MissionState.CONTRACTED, "contracted"],
    [MissionState.PROVISIONING, "provisioning"],
  ]) {
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-${suffix}`,
      causationId: `${missionId}-${suffix}-command`,
      to,
      reason: `Enter ${to}.`,
    });
  }
  const workspace = control.workspaces.provisionWorkspace({
    missionId,
    workspaceId: `${missionId}-workspace`,
    baselineCheckpointId: `${missionId}-baseline`,
    evidenceId: `${missionId}-provision-evidence`,
    eventId: `${missionId}-provision-event`,
    causationId: `${missionId}-provision`,
    reason: "Provision a clean isolated inventory workspace.",
  });
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-executing`,
    causationId: `${missionId}-executing-command`,
    to: MissionState.EXECUTING,
    reason: "Begin real production execution.",
  });
  return workspace;
}

export function workFactory(control, missionId, workspaceId) {
  let sequence = 0;
  return async function work(actionType, inputs, obligationId, name) {
    sequence += 1;
    const prefix = `${missionId}-${String(sequence).padStart(2, "0")}-${name}`;
    return control.execution.executeWorkUnit({
      workUnitId: prefix,
      missionId,
      workspaceId,
      targetObligationIds: [obligationId],
      actionType,
      inputs,
      preWorkCheckpointId: `${prefix}-pre`,
      postWorkCheckpointId: `${prefix}-post`,
      idempotencyKey: `${prefix}-key`,
    });
  };
}

export async function generateInventory(control, missionId, workspaceId, work) {
  for (const directory of [
    "src",
    "src/app",
    "src/app/api",
    "src/app/api/health",
    "src/app/api/products",
    "src/app/api/products/[id]",
    "src/lib",
    "tests",
  ]) {
    const result = await work(
      WorkUnitAction.CREATE_DIRECTORY,
      { path: directory },
      "production-build",
      `mkdir-${directory.replaceAll("/", "-").replaceAll("[", "").replaceAll("]", "")}`,
    );
    assert.equal(result.status, WorkUnitStatus.SUCCEEDED);
  }
  for (const path of Object.keys(inventorySources())) {
    const workUnitId = `${missionId}-generate-${path
      .replaceAll("/", "-")
      .replaceAll("[", "")
      .replaceAll("]", "")
      .replaceAll(".", "-")}`.slice(0, 120);
    const generated = await control.models.request({
      requestId: `${workUnitId}-model`,
      missionId,
      workUnitId,
      purpose: `Generate project file ${path}`,
      taskClass: ModelTaskClass.FILE_GENERATION,
      contextReferences: [
        { kind: "contract", id: `${missionId}-contract` },
      ],
      expectedStructuredOutputSchema: {
        type: "object",
        properties: {
          content: { type: "string" },
          path: { type: "string" },
        },
        required: ["content", "path"],
        additionalProperties: false,
      },
      idempotencyKey: `${workUnitId}-model-key`,
      sensitiveValues: [],
    });
    assert.equal(generated.structuredOutput.path, path);
    const result = await work(
      WorkUnitAction.WRITE_FILE,
      generated.structuredOutput,
      "production-build",
      `write-${path
        .replaceAll("/", "-")
        .replaceAll("[", "")
        .replaceAll("]", "")
        .replaceAll(".", "-")}`,
    );
    assert.equal(result.status, WorkUnitStatus.SUCCEEDED);
  }
  assert.equal(
    readFileSync(join(control.workspaces.getWorkspace(missionId).rootPath, "package.json"), "utf8"),
    inventorySources()["package.json"],
  );
}

export function commandEvidence(control, workUnit) {
  return control.evidence
    .findByWorkUnit(workUnit.workUnitId)
    .find((record) => record.kind === ObservationKind.COMMAND_EXIT_RESULT);
}

async function executeCleanRun(control, missionId, registerStack) {
  const workspace = createMissionThroughExecuting(control, missionId, {
    registerStack,
  });
  const work = workFactory(control, missionId, workspace.workspaceId);
  await generateInventory(control, missionId, workspace.workspaceId, work);

  const lock = await work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "dependencyLock",
      environment: {},
      timeoutMs: 600_000,
      outputLimitBytes: 1_048_576,
    },
    "dependencies-install",
    "dependency-lock",
  );
  assert.equal(lock.status, WorkUnitStatus.SUCCEEDED);

  const install = await work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "install",
      environment: {},
      timeoutMs: 600_000,
      outputLimitBytes: 1_048_576,
    },
    "dependencies-install",
    "dependency-install",
  );
  assert.equal(install.status, WorkUnitStatus.SUCCEEDED);

  const typeCheck = await work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "typeCheck",
      environment: {},
      timeoutMs: 300_000,
      outputLimitBytes: 1_048_576,
    },
    "type-checks",
    "type-check",
  );
  assert.equal(
    typeCheck.status,
    WorkUnitStatus.SUCCEEDED,
    JSON.stringify(commandEvidence(control, typeCheck)?.payload),
  );

  const lint = await work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "lint",
      environment: {},
      timeoutMs: 300_000,
      outputLimitBytes: 1_048_576,
    },
    "lint-passes",
    "lint",
  );
  assert.equal(
    lint.status,
    WorkUnitStatus.SUCCEEDED,
    JSON.stringify(commandEvidence(control, lint)?.payload),
  );

  const build = await work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "productionBuild",
      environment: {},
      timeoutMs: 600_000,
      outputLimitBytes: 1_048_576,
    },
    "production-build",
    "production-build",
  );
  assert.equal(
    build.status,
    WorkUnitStatus.SUCCEEDED,
    JSON.stringify(commandEvidence(control, build)?.payload),
  );

  const checkpointId =
    control.workspaces.getWorkspace(missionId).currentCheckpointId;
  const runtime = await control.runtime.start({
    sessionId: `${missionId}-runtime`,
    missionId,
    workspaceId: workspace.workspaceId,
    checkpointId,
    procedureName: "productionRun",
    readinessPath: "/api/health",
    requestedPort: null,
    timeoutMs: 120_000,
    idempotencyKey: `${missionId}-runtime-key`,
    observationId: `${missionId}-runtime-start`,
    evidencePrefix: `${missionId}-runtime-start-evidence`,
    causationId: `${missionId}-runtime-start-command`,
    verificationRequestReference: VERIFY_REQUEST,
  });
  assert.equal(runtime.status, RuntimeStatus.READY);
  assert.match(control.runtime.getPreviewUrl(missionId, runtime.sessionId), /^http:\/\/127\.0\.0\.1:\d+$/u);

  let runtimeStopped = false;
  async function stopRuntime(suffix = "stop") {
    if (runtimeStopped) return;
    await control.runtime.stop({
      missionId,
      sessionId: runtime.sessionId,
      observationId: `${missionId}-runtime-${suffix}`,
      evidenceId: `${missionId}-runtime-${suffix}-evidence`,
      causationId: `${missionId}-runtime-${suffix}-command`,
      idempotencyKey: `${missionId}-runtime-${suffix}-key`,
    });
    runtimeStopped = true;
  }

  try {
    const browser = await work(
    WorkUnitAction.RUN_COMMAND,
    {
      procedureName: "browserVerification",
      environment: { FOUNDRY_PREVIEW_URL: runtime.previewUrl },
      timeoutMs: 300_000,
      outputLimitBytes: 1_048_576,
    },
    "page-loads",
    "browser-verification",
  );
    assert.equal(
      browser.status,
      WorkUnitStatus.SUCCEEDED,
      JSON.stringify(commandEvidence(control, browser)?.payload),
    );
  const browserObservation = control.runtime.captureBrowserVerification({
    missionId,
    sessionId: runtime.sessionId,
    commandWorkUnitId: browser.workUnitId,
    observationId: `${missionId}-browser-observation`,
    evidencePrefix: `${missionId}-browser-evidence`,
    causationId: `${missionId}-browser-capture`,
    idempotencyKey: `${missionId}-browser-key`,
    verificationRequestReference: VERIFY_REQUEST,
  });
  const browserErrors = browserObservation.evidence.find(
    (record) => record.kind === ObservationKind.BROWSER_ERROR_RESULT,
  );
  assert.deepEqual(browserErrors.payload.consoleErrors, []);
  assert.deepEqual(browserErrors.payload.pageErrors, []);
  assert.deepEqual(browserErrors.payload.captureProbeErrors, [
    "foundry-console-capture-probe",
  ]);

  const health = await control.runtime.observeHealth({
    missionId,
    sessionId: runtime.sessionId,
    observationId: `${missionId}-runtime-health`,
    evidenceId: `${missionId}-runtime-health-evidence`,
    causationId: `${missionId}-runtime-health-command`,
    idempotencyKey: `${missionId}-runtime-health-key`,
    verificationRequestReference: VERIFY_REQUEST,
  });
  assert.equal(health.status, RuntimeStatus.HEALTHY);

  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-verifying`,
    causationId: `${missionId}-verifying-command`,
    to: MissionState.VERIFYING,
    reason: "Independently verify the complete production path.",
  });
  const interactionEvidence = browserObservation.evidence.find(
    (record) => record.kind === ObservationKind.BROWSER_INTERACTION_RESULT,
  );
  const readinessEvidence = control.evidence
    .findByWorkUnit(runtime.sessionId)
    .findLast(
      (record) =>
        record.kind === ObservationKind.RUNTIME_READINESS_RESULT &&
        record.workspaceCheckpointReference === health.checkpointId,
    );
  const evidenceByObligation = {
    "page-loads": [interactionEvidence.evidenceId],
    "product-created": [interactionEvidence.evidenceId],
    "starting-stock": [interactionEvidence.evidenceId],
    "stock-edited": [interactionEvidence.evidenceId],
    "refresh-persists": [interactionEvidence.evidenceId],
    "dependencies-install": [commandEvidence(control, install).evidenceId],
    "type-checks": [commandEvidence(control, typeCheck).evidenceId],
    "lint-passes": [commandEvidence(control, lint).evidenceId],
    "production-build": [commandEvidence(control, build).evidenceId],
    "runtime-ready": [readinessEvidence.evidenceId],
    "no-browser-errors": [browserErrors.evidenceId],
  };
  const verdict = control.verification.verify({
    missionId,
    verdictId: `${missionId}-verdict`,
    eventId: `${missionId}-verdict-event`,
    causationId: `${missionId}-verification`,
    workspaceCheckpointReference: health.checkpointId,
    verificationRequestReference: VERIFY_REQUEST,
    evidenceByObligation,
  });
  assert.equal(verdict.overallResult, "COMPLETE");
  control.orchestrator.transition({
    missionId,
    eventId: `${missionId}-succeeded`,
    causationId: `${missionId}-succeeded-command`,
    to: MissionState.SUCCEEDED,
    reason: "The independent Completion Verdict is COMPLETE.",
  });
    await stopRuntime();
    assert.equal(
      control.runtime.getSession(missionId, runtime.sessionId).status,
      RuntimeStatus.STOPPED,
    );
    assert.throws(() =>
      control.runtime.getPreviewUrl(missionId, runtime.sessionId),
    );
    await assert.rejects(
      fetch(runtime.previewUrl, { signal: AbortSignal.timeout(2_000) }),
    );

  const runEvidence = control.evidence.capture({
    evidenceId: `${missionId}-clean-run-evidence`,
    missionId,
    kind: ObservationKind.STRUCTURED_TEST_RESULT,
    captureMethod: "real-clean-end-to-end-stack-run",
    producingSubsystem: "MILESTONE_8_CERTIFICATION",
    payload: {
      suiteName: "generate-build-run-test-observe",
      passedCount: 5,
      failedCount: 0,
      skippedCount: 0,
    },
    workspaceCheckpointReference: health.checkpointId,
    obligationReference: null,
    verificationRequestReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: {
      cleanWorkspace: true,
      workspaceId: workspace.workspaceId,
      stackId: CERTIFIED_STACK_ID,
      stackVersion: CERTIFIED_STACK_VERSION,
      certificationScope: CertificationEvidenceScope.END_TO_END_MISSION,
      certificationCapabilities: {
        built: true,
        generated: true,
        observed: true,
        ran: true,
        tested: true,
      },
    },
  });
    return {
      missionId,
      workspace,
      runEvidence,
      verdict,
      build,
      install,
      runtime,
      browserObservation,
    };
  } finally {
    await stopRuntime("cleanup");
  }
}

const isDirectTestModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectTestModule) {
test(
  "records real build/start/crash/port failure evidence without repair or false certification",
  { timeout: 120_000 },
  async (t) => {
    const stores = temporaryStores(t, "foundry-v2-runtime-failure-");
    const control = openMissionControl({
      ...stores,
      modelProviders: [createInventoryProvider()],
    });
    const missionId = "runtime-failure-controls";
    const workspace = createMissionThroughExecuting(control, missionId, {
      registerStack: true,
      fullContract: false,
    });
    const work = workFactory(control, missionId, workspace.workspaceId);

    const failedBuild = await work(
      WorkUnitAction.RUN_COMMAND,
      {
        procedureName: "productionBuild",
        environment: {},
        timeoutMs: 60_000,
        outputLimitBytes: 65_536,
      },
      "runtime-ready",
      "expected-build-failure",
    );
    assert.equal(failedBuild.status, WorkUnitStatus.FAILED);
    assert.notEqual(commandEvidence(control, failedBuild).payload.exitCode, 0);

    const occupied = createServer();
    await new Promise((resolve) =>
      occupied.listen(0, "127.0.0.1", resolve),
    );
    const occupiedPort = occupied.address().port;
    await assert.rejects(
      control.runtime.start({
        sessionId: `${missionId}-conflict`,
        missionId,
        workspaceId: workspace.workspaceId,
        checkpointId:
          control.workspaces.getWorkspace(missionId).currentCheckpointId,
        procedureName: "runtimeCrashProbe",
        readinessPath: "/",
        requestedPort: occupiedPort,
        timeoutMs: 5_000,
        idempotencyKey: `${missionId}-conflict-key`,
        observationId: `${missionId}-conflict-observation`,
        evidencePrefix: `${missionId}-conflict-evidence`,
        causationId: `${missionId}-conflict-command`,
        verificationRequestReference: VERIFY_REQUEST,
      }),
      RuntimePortConflictError,
    );
    await new Promise((resolve) => occupied.close(resolve));

    const startupFailure = await control.runtime.start({
      sessionId: `${missionId}-startup-failure`,
      missionId,
      workspaceId: workspace.workspaceId,
      checkpointId:
        control.workspaces.getWorkspace(missionId).currentCheckpointId,
      procedureName: "runtimeStartupFailureProbe",
      readinessPath: "/",
      requestedPort: null,
      timeoutMs: 5_000,
      idempotencyKey: `${missionId}-startup-failure-key`,
      observationId: `${missionId}-startup-failure-observation`,
      evidencePrefix: `${missionId}-startup-failure-evidence`,
      causationId: `${missionId}-startup-failure-command`,
      verificationRequestReference: VERIFY_REQUEST,
    });
    assert.equal(startupFailure.status, RuntimeStatus.STARTUP_FAILED);
    const startupProcessEvidence = control.evidence
      .findByWorkUnit(startupFailure.sessionId)
      .find((record) => record.kind === ObservationKind.RUNTIME_PROCESS_RESULT);
    assert.match(startupProcessEvidence.payload.stderr, /runtime-startup-failed/u);

    const crash = await control.runtime.start({
      sessionId: `${missionId}-crash`,
      missionId,
      workspaceId: workspace.workspaceId,
      checkpointId:
        control.workspaces.getWorkspace(missionId).currentCheckpointId,
      procedureName: "runtimeCrashProbe",
      readinessPath: "/",
      requestedPort: null,
      timeoutMs: 5_000,
      idempotencyKey: `${missionId}-crash-key`,
      observationId: `${missionId}-crash-start`,
      evidencePrefix: `${missionId}-crash-start-evidence`,
      causationId: `${missionId}-crash-command`,
      verificationRequestReference: VERIFY_REQUEST,
    });
    assert.equal(crash.status, RuntimeStatus.READY);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const crashed = await control.runtime.observeHealth({
      missionId,
      sessionId: crash.sessionId,
      observationId: `${missionId}-crash-health`,
      evidenceId: `${missionId}-crash-health-evidence`,
      causationId: `${missionId}-crash-health-command`,
      idempotencyKey: `${missionId}-crash-health-key`,
      verificationRequestReference: VERIFY_REQUEST,
    });
    assert.equal(crashed.status, RuntimeStatus.CRASHED);
    control.orchestrator.transition({
      missionId,
      eventId: `${missionId}-verifying`,
      causationId: `${missionId}-verifying-command`,
      to: MissionState.VERIFYING,
      reason: "Verify the recorded startup failure without repair.",
    });
    const incomplete = control.verification.verify({
      missionId,
      verdictId: `${missionId}-incomplete-verdict`,
      eventId: `${missionId}-incomplete-verdict-event`,
      causationId: `${missionId}-incomplete-verification`,
      verificationRequestReference: VERIFY_REQUEST,
      workspaceCheckpointReference:
        control.workspaces.getWorkspace(missionId).currentCheckpointId,
      evidenceByObligation: {
        "runtime-ready": [
          `${missionId}-startup-failure-evidence.readiness`,
        ],
      },
    });
    assert.equal(incomplete.overallResult, "INCOMPLETE");
    assert.equal(
      control.orchestrator.state(missionId).state,
      MissionState.VERIFYING,
    );
    assert.equal(
      control.workspaces.getWorkspace(missionId).currentCheckpointId,
      failedBuild.postWorkCheckpointId,
    );
    assert.equal(
      control.toolchains.getStack(
        CERTIFIED_STACK_ID,
        CERTIFIED_STACK_VERSION,
      ).certificationStatus,
      StackCertificationStatus.PROVISIONAL,
    );
  },
);

test(
  "three clean real inventory missions build, preview, verify, and certify the stack",
  {
    timeout: 1_200_000,
    skip: process.env.FOUNDRY_RUN_LIVE_CERTIFICATION !== "1",
  },
  async (t) => {
    const stores = temporaryStores(t, "foundry-v2-certification-");
    const control = openMissionControl({
      ...stores,
      modelProviders: [createInventoryProvider()],
    });
    const requestedRunCount =
      process.env.FOUNDRY_M8_DIAGNOSTIC_ONE === "1" ? 1 : 3;
    const runs = [];
    for (let index = 1; index <= requestedRunCount; index += 1) {
      runs.push(
        await executeCleanRun(
          control,
          `inventory-clean-${index}`,
          index === 1,
        ),
      );
    }
    if (requestedRunCount === 1) {
      assert.equal(
        control.toolchains.getStack(
          CERTIFIED_STACK_ID,
          CERTIFIED_STACK_VERSION,
        ).certificationStatus,
        StackCertificationStatus.PROVISIONAL,
      );
      return;
    }
    assert.equal(new Set(runs.map((run) => run.workspace.rootPath)).size, 3);
    assert(
      runs.every(
        (run) =>
          control.orchestrator.state(run.missionId).state ===
          MissionState.SUCCEEDED,
      ),
    );
    const third = runs[2];
    const aggregate = control.evidence.capture({
      evidenceId: "inventory-three-run-certification",
      missionId: third.missionId,
      kind: ObservationKind.STRUCTURED_TEST_RESULT,
      captureMethod: "three-clean-production-mission-aggregation",
      producingSubsystem: "MILESTONE_8_CERTIFICATION",
      payload: {
        suiteName: "three-clean-stack-certification",
        passedCount: 5,
        failedCount: 0,
        skippedCount: 0,
      },
      workspaceCheckpointReference:
        control.workspaces.getWorkspace(third.missionId).currentCheckpointId,
      obligationReference: null,
      verificationRequestReference: null,
      commandReference: null,
      workUnitReference: null,
      metadata: {
        stackId: CERTIFIED_STACK_ID,
        stackVersion: CERTIFIED_STACK_VERSION,
        certificationScope: CertificationEvidenceScope.END_TO_END_MISSION,
        cleanRunMissionIds: runs.map((run) => run.missionId),
        cleanRunEvidenceIds: runs.map(
          (run) => run.runEvidence.evidenceId,
        ),
        certificationCapabilities: {
          built: true,
          generated: true,
          observed: true,
          ran: true,
          tested: true,
        },
      },
    });
    const certified = control.toolchains.changeCertification({
      missionId: third.missionId,
      stackId: CERTIFIED_STACK_ID,
      stackVersion: CERTIFIED_STACK_VERSION,
      newStatus: StackCertificationStatus.CERTIFIED,
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      reason: "Three isolated clean production missions completed through the real gate.",
      certificationEvidenceId: aggregate.evidenceId,
      registryEventId: "inventory-real-certification-registry",
      eventId: "inventory-real-certification-ledger",
      causationId: "inventory-real-certification-command",
    });
    assert.equal(certified.certificationStatus, StackCertificationStatus.CERTIFIED);

    const restarted = openMissionControl({
      ...stores,
      modelProviders: [createInventoryProvider()],
    });
    assert.equal(
      restarted.toolchains.getStack(
        CERTIFIED_STACK_ID,
        CERTIFIED_STACK_VERSION,
      ).certificationStatus,
      StackCertificationStatus.CERTIFIED,
    );
    assert(
      runs.every(
        (run) =>
          restarted.orchestrator.state(run.missionId).state ===
          MissionState.SUCCEEDED,
      ),
    );
    for (const run of runs) {
      assert.equal(
        restarted.runtime.getSession(
          run.missionId,
          run.runtime.sessionId,
        ).status,
        RuntimeStatus.STOPPED,
      );
      assert.throws(() =>
        restarted.runtime.getPreviewUrl(
          run.missionId,
          run.runtime.sessionId,
        ),
      );
    }
  },
);
}
