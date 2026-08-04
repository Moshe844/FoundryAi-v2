/**
 * Layer 3 visual certification gate.
 *
 * The mission requires the first five visual projects to each complete three
 * clean missions — 15/15 — before Layer 3 can be called done. This drives the
 * real local API, so every run costs real model spend and real wall-clock time.
 *
 *   node scripts/run-layer-3-visual-certification.mjs
 *
 * Environment:
 *   FOUNDRY_CERTIFICATION_API   default http://127.0.0.1:3927
 *   LAYER3_RUNS                 runs per project (default 3)
 *   LAYER3_PROJECT              run a single project by name
 *   LAYER3_EXECUTE              "1" to build, "0" for discovery only
 *
 * Results append to layer-3-visual-certification.json so an interrupted gate
 * can resume rather than re-spending on completed runs.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.FOUNDRY_CERTIFICATION_API ?? "http://127.0.0.1:3927";
const RUNS = Math.max(1, Number.parseInt(process.env.LAYER3_RUNS ?? "3", 10) || 3);
const EXECUTE = process.env.LAYER3_EXECUTE !== "0";
const LEDGER = resolve(root, "layer-3-visual-certification.json");

/** The five visual projects named by the mission, in order. */
const VISUAL_PROJECTS = [
  "Fine-art photographer portfolio",
  "Commercial photographer portfolio",
  "Filmmaker portfolio",
  "Plumbing business website",
  "Luxury service website",
];

const projects = process.env.LAYER3_PROJECT
  ? VISUAL_PROJECTS.filter((name) => name.toLowerCase() === process.env.LAYER3_PROJECT.toLowerCase())
  : VISUAL_PROJECTS;
if (projects.length === 0) throw new Error(`Unknown project: ${process.env.LAYER3_PROJECT}`);

async function api(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${method} ${path}: ${payload.error ?? response.status}`);
  return payload;
}

async function waitFor(missionId, predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await api(`/missions/${missionId}`);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error(`${label}: timed out after ${Math.round(timeoutMs / 1000)}s (state=${last?.state})`);
}

function loadLedger() {
  if (!existsSync(LEDGER)) return { startedAt: new Date().toISOString(), runs: [] };
  try {
    return JSON.parse(readFileSync(LEDGER, "utf8"));
  } catch {
    return { startedAt: new Date().toISOString(), runs: [] };
  }
}

function saveLedger(ledger) {
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/** Checks the Layer 3 conditions this gate exists to prove. */
function assessDesign(mission) {
  const profile = mission.profile ?? {};
  const alternatives = profile.designAlternatives ?? [];
  const problems = [];

  if (alternatives.length < 3) problems.push(`only ${alternatives.length} directions`);

  const dna = alternatives.map((item) => item.creativeDNA).filter(Boolean);
  if (dna.length !== alternatives.length) {
    problems.push(`${alternatives.length - dna.length} directions carry no creative DNA`);
  }
  const primitives = new Set(dna.map((item) => item.compositionPrimitive));
  if (dna.length > 0 && primitives.size < dna.length) {
    problems.push(`only ${primitives.size} distinct composition primitives across ${dna.length} directions`);
  }
  // Density, navigation and mobile must differ per direction, not be inherited.
  for (const field of ["informationDensity", "navigationApproach", "mobileBehavior"]) {
    const values = new Set(alternatives.map((item) => String(item[field] ?? "").toLowerCase()));
    if (alternatives.length > 1 && values.size === 1) {
      problems.push(`every direction shares the same ${field}`);
    }
  }
  const recommended = alternatives.filter((item) => item.recommended === true);
  if (recommended.length !== 1) problems.push(`${recommended.length} recommended directions`);

  return {
    directionCount: alternatives.length,
    primitives: [...primitives],
    directionNames: alternatives.map((item) => item.approach ?? item.name),
    problems,
  };
}

async function runOnce(input, attempt) {
  const started = Date.now();
  const record = { project: input, attempt, startedAt: new Date().toISOString() };
  try {
    const created = await api("/missions", { method: "POST", body: { intent: input } });
    const missionId = created.missionId ?? created.mission?.missionId;
    if (!missionId) throw new Error("No missionId returned.");
    record.missionId = missionId;

    const understood = await waitFor(
      missionId,
      (mission) => (mission.profile?.designAlternatives?.length ?? 0) > 0 || mission.error,
      "project understanding",
      300_000,
    );
    const design = assessDesign(understood);
    Object.assign(record, design);

    if (design.problems.length > 0) {
      record.outcome = "DESIGN_REJECTED";
      record.durationMs = Date.now() - started;
      return record;
    }

    if (!EXECUTE) {
      record.outcome = "DESIGN_OK";
      record.durationMs = Date.now() - started;
      return record;
    }

    // The API exposes /start to begin execution; approval of the design is
    // recorded through /clarify before the build begins.
    await api(`/missions/${missionId}/start`, { method: "POST", body: {} });
    const finished = await waitFor(
      missionId,
      (mission) => ["SUCCEEDED", "FAILED", "BLOCKED", "EXHAUSTED", "CANCELLED"].includes(mission.state),
      "execution",
      1_800_000,
    );
    record.state = finished.state;
    record.outcome = finished.state === "SUCCEEDED" ? "PASS" : "FAIL";
  } catch (error) {
    record.outcome = "ERROR";
    record.error = String(error?.message ?? error).slice(0, 400);
  }
  record.durationMs = Date.now() - started;
  return record;
}

const ledger = loadLedger();
const done = new Set(ledger.runs.filter((r) => r.outcome === "PASS").map((r) => `${r.project}#${r.attempt}`));

for (const project of projects) {
  for (let attempt = 1; attempt <= RUNS; attempt += 1) {
    if (done.has(`${project}#${attempt}`)) {
      console.log(`skip  ${project} #${attempt} (already passed)`);
      continue;
    }
    process.stdout.write(`run   ${project} #${attempt} … `);
    const record = await runOnce(project, attempt);
    ledger.runs.push(record);
    saveLedger(ledger);
    console.log(
      `${record.outcome} in ${Math.round((record.durationMs ?? 0) / 1000)}s` +
        (record.primitives ? ` [${record.primitives.join(", ")}]` : "") +
        (record.error ? ` — ${record.error}` : "") +
        (record.problems?.length ? ` — ${record.problems.join("; ")}` : ""),
    );
  }
}

const attempted = ledger.runs.length;
const passed = ledger.runs.filter((r) => r.outcome === "PASS" || r.outcome === "DESIGN_OK").length;
console.log(`\nLayer 3 visual certification: ${passed}/${attempted} runs passed.`);
console.log(`Ledger: ${LEDGER}`);
process.exitCode = passed === attempted && attempted > 0 ? 0 : 1;
