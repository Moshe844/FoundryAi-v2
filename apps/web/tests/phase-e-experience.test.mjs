import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { projectExecutionProjection } from "../local-api/execution-projection.mjs";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function transition(to, occurredAt = undefined) {
  return {
    type: "MISSION_TRANSITION",
    transition: { to },
    ...(occurredAt === undefined ? {} : { occurredAt }),
  };
}

function recorded(metadata, workspaceFact = undefined) {
  return { fact: { metadata }, workspaceFact };
}

test("the phase projection is a replayed high-water mark and cannot regress", () => {
  const events = [
    transition("PROVISIONING"),
    transition("EXECUTING"),
    recorded({
      executionRecord: { actionType: "apply-file-bundle", inputs: {} },
    }),
    recorded({
      executionRecord: {
        actionType: "run-procedure",
        inputs: { procedureName: "productionBuild" },
      },
    }),
    recorded({
      runtimeRecord: {
        status: "HEALTHY",
        eventType: "READINESS_OBSERVED",
        previewUrl: "http://127.0.0.1:4100",
        workspaceId: "workspace-1",
        checkpointId: "checkpoint-1",
            sessionId: "session-1",
            plainCause: null,
            evidenceReferences: [],
      },
    }),
    transition("VERIFYING"),
    transition("REPAIRING"),
    transition("EXECUTING"),
  ];
  const projection = projectExecutionProjection({
    contract: null,
    events,
    profile: { capabilities: [] },
  });

  assert.deepEqual(projection.phase, {
    currentIndex: 8,
    completedThrough: 7,
    interrupted: false,
    includesDataPhase: false,
  });
});

test("once persistence is recorded the data phase can never disappear", () => {
  const projection = projectExecutionProjection({
    contract: null,
    events: [
      recorded({
        projectProfile: {
          capabilities: ["sqlite-persistence"],
        },
      }),
      recorded({
        projectProfile: {
          capabilities: [],
        },
      }),
    ],
    profile: { capabilities: [] },
  });
  assert.equal(projection.phase.includesDataPhase, true);
});

test("build timing excludes understanding and customer decision time", () => {
  const projection = projectExecutionProjection({
    contract: null,
    events: [
      transition("INTAKE", "2026-07-30T20:08:34.460Z"),
      transition("CLARIFYING", "2026-07-30T20:09:04.313Z"),
      transition("INTAKE", "2026-07-30T20:27:15.571Z"),
      transition("CONTRACTED", "2026-07-30T21:23:58.805Z"),
      transition("PROVISIONING", "2026-07-30T21:23:59.504Z"),
      transition("EXECUTING", "2026-07-30T21:23:59.544Z"),
      transition("VERIFYING", "2026-07-30T21:30:19.745Z"),
      transition("SUCCEEDED", "2026-07-30T21:30:29.718Z"),
    ],
    profile: { capabilities: [] },
  });

  assert.deepEqual(projection.timing, {
    startedAt: "2026-07-30T21:23:58.805Z",
    completedAt: "2026-07-30T21:30:29.718Z",
  });
});

test("a recorded verdict cannot prove customer content without provenance", () => {
  const projection = projectExecutionProjection({
    contract: {
      obligations: [
        {
          obligationId: "content-proof",
          statement:
            "The supplied business wording, images, logo, and contact details appear.",
        },
      ],
    },
    events: [
      {
        completionVerdict: {
          obligationVerdicts: [
            {
              obligationId: "content-proof",
              result: "SATISFIED",
              evidenceReferences: [],
            },
          ],
        },
      },
    ],
    profile: {
      capabilities: [],
      customerContent: { supplied: [], missingBeforeLaunch: [] },
    },
  });

  assert.equal(projection.verification[0].result, "UNVERIFIABLE");
  assert.match(
    projection.verification[0].detail,
    /No customer-provided content provenance/u,
  );
});

test("repair narration advances only when recorded repair events exist", () => {
  const contract = {
    obligations: [
      { obligationId: "obligation-1", statement: "A person can save a task." },
    ],
  };
  const admitted = recorded({
    repairAdmission: {
      targetObligationIds: ["obligation-1"],
      failureClassification: "BROWSER_WORKFLOW_FAILURE",
    },
  });
  const events = [transition("VERIFYING"), transition("REPAIRING")];

  assert.deepEqual(
    projectExecutionProjection({
      contract,
      events,
      profile: { capabilities: [] },
    }).repair.lines,
    ["A workflow didn't behave as expected."],
  );

  events.push(admitted);
  assert.deepEqual(
    projectExecutionProjection({
      contract,
      events,
      profile: { capabilities: [] },
    }).repair.lines,
    [
      "A workflow didn't behave as expected.",
      "I found the likely cause.",
    ],
  );

  events.push(recorded({ executionStart: { fingerprint: {} } }));
  events.push(transition("VERIFYING"));
  assert.deepEqual(
    projectExecutionProjection({
      contract,
      events,
      profile: { capabilities: [] },
    }).repair.lines,
    [
      "A workflow didn't behave as expected.",
      "I found the likely cause.",
      "I'm correcting the affected part.",
      "I'm rerunning only the checks that matter.",
    ],
  );
});

test("repair terminal findings and runtime evidence project distinct states", () => {
  const cases = [
    ["BUDGET_EXHAUSTED", "budget-warning"],
    ["STRATEGIES_EXHAUSTED", "different-strategy"],
    ["EXTERNAL_BLOCKER", "external-service"],
  ];
  for (const [findingType, expected] of cases) {
    const projection = projectExecutionProjection({
      contract: null,
      events: [
        transition("REPAIRING"),
        recorded({
          repairFinding: { findingType, detail: "recorded detail" },
        }),
      ],
      profile: { capabilities: [] },
    });
    assert.equal(projection.repair.state, expected);
  }

  const projection = projectExecutionProjection({
    contract: {
      obligations: [
        { obligationId: "o-1", statement: "The runtime answers." },
      ],
    },
    events: [
      transition("EXECUTING"),
      recorded(
        {
          runtimeRecord: {
            status: "CRASHED",
            eventType: "PROCESS_EXITED",
            previewUrl: "http://127.0.0.1:4100",
            workspaceId: "workspace-1",
            checkpointId: "checkpoint-2",
            sessionId: "session-1",
            evidenceReferences: [
              {
                evidenceId: "evidence-runtime",
                workspaceCheckpointReference: "checkpoint-2",
              },
            ],
          },
        },
        { workspaceId: "workspace-1", checkpointId: "checkpoint-2" },
      ),
      {
        completionVerdict: {
          obligationVerdicts: [
            {
              obligationId: "o-1",
              result: "NOT_SATISFIED",
              deficiency: "The process exited.",
              evidenceReferences: [
                {
                  evidenceId: "evidence-runtime",
                  workspaceCheckpointReference: "checkpoint-2",
                },
              ],
            },
          ],
        },
      },
    ],
    profile: { capabilities: [], runtimeAdapterId: "web-runtime-v2" },
  });

  assert.equal(projection.runtime.status, "CRASHED");
  assert.equal(
    projection.runtime.plainCause,
    "The running application process stopped unexpectedly.",
  );
  assert.deepEqual(projection.workspace, {
    workspaceId: "workspace-1",
    checkpointIds: ["checkpoint-2"],
    runtimeAdapterId: "web-runtime-v2",
  });
  assert.equal(projection.verification[0].result, "NOT_SATISFIED");
  assert.equal(projection.verification[0].detail, "The process exited.");
});

test("Phase E is rendered through modular active-execution components", async () => {
  const [page, active, spine, preview, engineering, timing] = await Promise.all([
    source("../app/page.tsx"),
    source("../app/components/active-execution.tsx"),
    source("../app/components/phase-spine.tsx"),
    source("../app/components/preview-dock.tsx"),
    source("../app/components/engineering-details.tsx"),
    source("../experience/timing.ts"),
  ]);

  assert.match(page, /<ActiveExecutionSurface/);
  assert.match(page, /experience=\{experience\}/);
  assert.match(active, /<PhaseSpine/);
  assert.match(active, /<PreviewDock/);
  assert.match(active, /<EngineeringDetails/);
  assert.match(active, /aria-live=\{/);
  assert.match(active, /: "polite"/);
  assert.match(active, /aria-atomic="true"/);
  assert.match(active, /10_000/);
  assert.match(active, /Elapsed/);
  assert.doesNotMatch(active, /activities\[0\]/);
  assert.match(timing, /executionProjection\.timing/);
  assert.match(timing, /Math\.floor\(totalSeconds \/ 10\) \* 10/);
  assert.match(timing, /remainingSeconds/);
  assert.doesNotMatch(timing, /activities\[0\]/);
  assert.doesNotMatch(active, /executionMetrics|modelRouting|activities\.map/);

  assert.match(spine, /index !== 4 \|\| hasPersistence/);
  assert.match(spine, /phase\.includesDataPhase/);
  assert.match(spine, /phase\.status\.value/);
  assert.match(spine, /status === "interrupted"/);
  assert.match(spine, /repair\.lines\.value/);

  assert.match(preview, /if \(projectedState === "absent"\) return null/);
  for (const state of [
    "starting",
    "live",
    "rebuilding",
    "disconnected",
    "crashed",
    "stopped",
    "error",
  ]) {
    assert.match(preview, new RegExp(`\\b${state}\\b`));
  }
  assert.match(preview, /Math\.round/);
  assert.match(preview, /setFrameWidth\(preset\)/);
  assert.match(preview, /foundry:preview-width:/);
  assert.match(preview, /WIDTH_STEP = 40/);
  assert.match(preview, /event\.key === "Home"/);
  assert.match(preview, /event\.key === "End"/);
  assert.match(preview, /event\.key === "Escape"/);
  assert.match(preview, /role="separator"/);
  assert.match(preview, /aria-orientation="vertical"/);
  assert.match(preview, /Rebuilding — this preview is from a moment ago/);
  assert.match(preview, /Show preview/);
  assert.match(preview, /Expand preview/);
  assert.match(preview, /Lost the connection/);
  assert.match(preview, /Live preview/);
  assert.match(preview, /preview-notice/);

  assert.match(page, /delivery-layout/);
  assert.match(page, /Browser automation passed/);
  assert.match(page, /one promise still needs proof/);

  assert.match(engineering, /foundry:engineering-details:/);
  assert.match(engineering, /const ACTIVITY_WINDOW = 200/);
  for (const section of [
    "Activity",
    "Model routing",
    "Counters",
    "Verification",
    "Workspace",
  ]) {
    assert.match(engineering, new RegExp(`title="${section}"`));
  }
  for (const field of [
    "routingReason",
    "inputTokens",
    "outputTokens",
    "costUsd",
    "repairScopes",
    "evidenceReferences",
    "checkpointIds",
    "runtimeAdapterId",
  ]) {
    assert.match(engineering, new RegExp(field));
  }
});

test("customer repair copy covers every approved outcome without raw errors", async () => {
  const selectors = await source("../experience/selectors.ts");
  for (const state of [
    "different-strategy",
    "budget-warning",
    "customer-action-required",
    "external-service",
    "verification-incomplete",
    "honest-exhaustion",
  ]) {
    assert.match(selectors, new RegExp(`"${state}"`));
  }
  assert.match(selectors, /default:\s*return "A workflow didn't behave/);
  assert.match(
    selectors,
    /Something outside your project isn't responding\./,
  );
  assert.match(selectors, /I won't tell you it's done\./);
  assert.doesNotMatch(
    await source("../app/components/active-execution.tsx"),
    /mission\.error/,
  );
  assert.match(selectors, /replace\(\/\\bnpm\\b\/giu, "project tools"\)/);
});

test("Phase A through D remain mandatory web regression gates", async () => {
  const packageJson = JSON.parse(await source("../package.json"));
  for (const suite of [
    "rendered-html.test.mjs",
    "phase-a-foundation.test.mjs",
    "phase-b-experience.test.mjs",
    "phase-c-experience.test.mjs",
    "phase-d-experience.test.mjs",
    "phase-e-experience.test.mjs",
  ]) {
    assert.match(packageJson.scripts.test, new RegExp(suite));
  }
});
