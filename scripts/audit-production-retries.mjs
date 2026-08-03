import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";

const ledgerDirectory = resolve(process.cwd(), ".foundry/customer/ledger");
const requestedMissions = new Set(process.argv.slice(2));
const ledgerFiles = readdirSync(ledgerDirectory)
  .filter((name) => name.endsWith(".jsonl"))
  .filter(
    (name) =>
      requestedMissions.size === 0 ||
      requestedMissions.has(name.slice(0, -".jsonl".length)),
  );

const rows = [];
for (const ledgerFile of ledgerFiles) {
  const events = readFileSync(resolve(ledgerDirectory, ledgerFile), "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const transitions = events.filter(
    (event) => event.type === "MISSION_TRANSITION",
  );
  const modelCalls = events
    .map((event) => event.fact?.metadata?.modelCallRecord)
    .filter(Boolean);
  const repairCalls = modelCalls.filter((call) =>
    /(?:^|-)repair-/u.test(call.requestId),
  );
  const failedWorkUnits = events
    .map((event) => event.fact?.metadata?.workUnitRecord)
    .filter((record) => record?.status === "FAILED");
  const firstTransition = transitions[0]?.transition;
  const lastTransition = transitions.at(-1)?.transition;
  rows.push({
    missionId: basename(ledgerFile, ".jsonl"),
    intent: firstTransition?.reason?.replace(/^Customer requested: /u, "") ?? null,
    state: lastTransition?.to ?? firstTransition?.to ?? null,
    modelCalls: modelCalls.length,
    repairModelCalls: repairCalls.length,
    repairRequestIds: repairCalls.map((call) => call.requestId),
    failedWorkUnits: failedWorkUnits.map((record) => ({
      workUnitId: record.workUnitId,
      actionType: record.actionType,
      procedureName: record.inputs?.procedureName ?? null,
    })),
    lastReason: lastTransition?.reason ?? firstTransition?.reason ?? null,
  });
}

rows.sort((left, right) => left.missionId.localeCompare(right.missionId));
process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
