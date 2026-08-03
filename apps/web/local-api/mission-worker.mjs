import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MissionState,
  createLiveAiAdapters,
  isTerminalMissionState,
  openMissionControl,
} from "../../../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../../..");
const stateRoot = resolve(repositoryRoot, ".foundry/customer");
const missionId = process.argv[2];

function parseEnvironment(path) {
  if (!existsSync(path)) return {};
  const result = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[name] = value;
  }
  return result;
}

const configuredEnvironment = {
  ...parseEnvironment(resolve(repositoryRoot, ".env")),
  ...process.env,
};
if (
  !configuredEnvironment.GOOGLE_API_KEY &&
  configuredEnvironment.GEMINI_API_KEY
) {
  configuredEnvironment.GOOGLE_API_KEY =
    configuredEnvironment.GEMINI_API_KEY;
}
const liveAdapters = createLiveAiAdapters({
  environment: configuredEnvironment,
});
const control = openMissionControl({
  ledgerDirectory: resolve(stateRoot, "ledger"),
  evidenceDirectory: resolve(stateRoot, "evidence"),
  workspaceDirectory: resolve(stateRoot, "workspaces"),
  registryDirectory: resolve(stateRoot, "registry"),
  environmentVariables: configuredEnvironment,
  aiDiscoveryAdapters: liveAdapters.discoveryAdapters,
  modelProviders: liveAdapters.executionAdapters,
  // One attempt disables the gateway's retry-with-feedback loop entirely: a
  // single structured-output validation miss becomes an unrecoverable mission
  // failure. Four bounded attempts (the gateway maximum) let the model see the
  // exact rejection and return a corrected object, with headroom for one
  // provider capacity blip, before anything is declared terminal.
  maxModelProviderAttempts: 4,
});

let stopping = false;
async function cancel() {
  if (stopping) return;
  stopping = true;
  try {
    await control.production.cancel(missionId);
  } catch {}
  process.exit(0);
}

async function cleanup() {
  if (stopping) return;
  stopping = true;
  try {
    await control.production.stop(missionId);
  } catch {}
  process.exit(0);
}

process.on("message", (message) => {
  if (message?.type === "stop") void cancel();
  if (message?.type === "shutdown") void cleanup();
});
process.once("SIGINT", () => void cleanup());
process.once("SIGTERM", () => void cleanup());

try {
  await control.production.execute(missionId);
  process.send?.({ type: "completed", missionId });
} catch (error) {
  const failureMessage = String(error?.message ?? error).slice(0, 500);
  try {
    await control.production.stop(missionId);
  } catch {}
  try {
    const projected = control.ledger.projectState(missionId);
    if (
      !isTerminalMissionState(projected.state) &&
      ![
        MissionState.INTAKE,
        MissionState.CLARIFYING,
        MissionState.CONTRACTED,
      ].includes(projected.state)
    ) {
      control.orchestrator.transition({
        missionId,
        eventId: `${missionId}-worker-failure-${projected.lastSequence + 1}`,
        causationId: projected.lastEventId,
        to: MissionState.FAILED,
        reason: `The production worker stopped after a recorded unrecoverable error: ${failureMessage}`,
      });
    }
  } catch (transitionError) {
    process.stderr.write(
      `Could not record the worker failure as a terminal mission transition: ${String(
        transitionError?.message ?? transitionError,
      )}\n`,
    );
  }
  process.send?.({
    type: "failed",
    missionId,
    error: failureMessage,
  });
  process.exit(1);
}
