import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const API = process.env.FOUNDRY_CERTIFICATION_API ?? "http://127.0.0.1:3927";
const EXECUTE = process.env.FOUNDRY_CERTIFY_EXECUTE === "1";
const RESUME = process.env.FOUNDRY_CERTIFICATION_RESUME !== "0";
const maximumAttempts = Math.max(
  1,
  Number.parseInt(process.env.FOUNDRY_CERTIFICATION_ATTEMPTS ?? "1", 10) || 1,
);
const FAIL_FAST = process.env.FOUNDRY_CERTIFICATION_FAIL_FAST !== "0";
const ALL_INPUTS = [
  "Inventory",
  "Website",
  "Customer portal",
  "Booking system",
  "Photographer portfolio",
  "REST API",
  "Internal tool",
  "School portal",
  "Expense system",
  "AI assistant",
];
const requestedInput = process.env.FOUNDRY_CERTIFICATION_INPUT?.trim();
const existingMissionId = process.env.FOUNDRY_CERTIFICATION_MISSION_ID?.trim();
const requestedLimit = Number.parseInt(
  process.env.FOUNDRY_CERTIFICATION_LIMIT ?? String(ALL_INPUTS.length),
  10,
);
const INPUTS = (requestedInput === undefined
  ? ALL_INPUTS
  : ALL_INPUTS.filter(
      (input) => input.toLowerCase() === requestedInput.toLowerCase(),
    )
).slice(0, Number.isSafeInteger(requestedLimit) && requestedLimit > 0
  ? requestedLimit
  : ALL_INPUTS.length);
if (INPUTS.length === 0) {
  throw new Error(`No certification input matches ${JSON.stringify(requestedInput)}.`);
}

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${payload.error ?? response.status}`);
  return payload;
}

async function waitForMission(missionId, predicate, label, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mission = await request(`/missions/${missionId}`);
    if (mission.error) throw new Error(`${label}: ${mission.error}`);
    if (predicate(mission)) return mission;
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error(`${label} timed out after ${timeoutMs}ms.`);
}

function selection(kind, subjectId, mode, optionId, value, reason, version, classification) {
  return {
    kind,
    subjectId,
    mode,
    optionId,
    value,
    reason,
    classification,
    sourceProfileVersion: version,
  };
}

function pairwiseVisualDifferences(alternatives) {
  const dimensions = [
    "layoutType", "navigationType", "typographyCategory", "density",
    "spacingProfile", "surfaceTreatment", "contentEmphasis", "imageStrategy",
    "interactionModel", "buttonTreatment",
  ];
  const results = [];
  for (let left = 0; left < alternatives.length; left += 1) {
    for (let right = left + 1; right < alternatives.length; right += 1) {
      const a = alternatives[left].visualSystem;
      const b = alternatives[right].visualSystem;
      const differences = a === undefined || b === undefined
        ? 0
        : dimensions.filter((field) => a[field] !== b[field]).length +
          Number(JSON.stringify(a.colorRoles) !== JSON.stringify(b.colorRoles));
      results.push({ left: left + 1, right: right + 1, differences });
    }
  }
  return results;
}

function assertFirstPassExecution(mission) {
  const repairRoutes = (mission.modelRouting ?? []).filter((route) =>
    /(?:^|-)(?:repair|correction)-/u.test(route.requestId),
  );
  const metrics = mission.executionMetrics;
  if (
    repairRoutes.length > 0 ||
    (metrics?.repairScopes?.length ?? 0) > 0 ||
    (metrics?.reinstallCount ?? 0) > 0 ||
    (metrics?.runtimeRestartCount ?? 0) > 0 ||
    (metrics?.rebuildCount ?? 1) > 1
  ) {
    throw new Error(
      `${mission.intent} did not complete on the original generation path; repaired or repeated execution is not certification.`,
    );
  }
  return {
    repairModelCalls: repairRoutes.length,
    reinstallCount: metrics?.reinstallCount ?? 0,
    rebuildCount: metrics?.rebuildCount ?? 1,
    runtimeRestartCount: metrics?.runtimeRestartCount ?? 0,
  };
}

function resultFromSucceededMission(input, mission) {
  const blueprint = mission.productBlueprint;
  const profile = mission.profile;
  const visualDifferences = pairwiseVisualDifferences(profile.designAlternatives);
  const contractBlueprintHash =
    mission.approvedProjectContract?.productBlueprint?.integrityHash ?? null;
  if (contractBlueprintHash !== blueprint.integrityHash) return null;
  let firstPassMetrics;
  try {
    firstPassMetrics = assertFirstPassExecution(mission);
  } catch {
    return null;
  }
  const selectedSubtype = blueprint.selectedSubtypes[0];
  return {
    input,
    missionId: mission.missionId,
    subtypeCount: mission.productTypeDiscovery.subtypes.length,
    selectedSubtype,
    blueprintVersion: blueprint.blueprintVersion,
    blueprintHash: blueprint.integrityHash,
    primaryWorkflows: blueprint.primaryWorkflows,
    requiredSurfaces: blueprint.requiredSurfaces,
    designDirections: profile.designAlternatives.map((item) => item.approach),
    minimumVisualDifferences: Math.min(
      ...visualDifferences.map((item) => item.differences),
    ),
    recommendations: profile.contextualSuggestions.map((item) => item.label),
    customMessagePresent: blueprint.customCustomerMessages.length > 0,
    selectedSubtypePresent: blueprint.selectedSubtypes.includes(selectedSubtype),
    executionState: mission.state,
    contractBlueprintHash,
    finishedMatchesApprovedBlueprint: true,
    firstPass: true,
    firstPassMetrics,
    recoveredFromLedger: true,
  };
}

async function findSucceededCertification(input) {
  const summaries = await request("/missions");
  for (const summary of summaries.missions) {
    if (
      summary.state !== "SUCCEEDED" ||
      summary.intent.toLowerCase() !== input.toLowerCase()
    ) {
      continue;
    }
    const mission = await request(`/missions/${summary.missionId}`);
    if (
      mission.profile === null ||
      mission.productTypeDiscovery === null ||
      mission.productBlueprint === null
    ) {
      continue;
    }
    const result = resultFromSucceededMission(input, mission);
    if (result !== null) return result;
  }
  return null;
}

async function certify(input, index) {
  let missionId;
  let discovered;
  if (existingMissionId !== undefined) {
    missionId = existingMissionId;
    console.log(`[${index + 1}/${INPUTS.length}] ${input}: resuming ${missionId}`);
    discovered = await request(`/missions/${missionId}`);
    if (discovered.productTypeDiscovery === null) {
      throw new Error(`${input} preserved mission has no product-type discovery.`);
    }
  } else {
    console.log(`[${index + 1}/${INPUTS.length}] ${input}: creating mission`);
    const created = await request("/missions", { method: "POST", body: { intent: input } });
    missionId = created.missionId;
    discovered = await waitForMission(
      missionId,
      (mission) => mission.productTypeDiscovery !== null,
      `${input} subtype discovery`,
    );
  }
  const subtype = discovered.productTypeDiscovery.subtypes.find((item) => item.recommended) ??
    discovered.productTypeDiscovery.subtypes[0];
  const customMessage = `For live certification, keep the primary ${input.toLowerCase()} workflow understandable on a phone and explain every consequential error.`;
  if (discovered.profile === null) {
    console.log(`[${index + 1}/${INPUTS.length}] ${input}: selecting ${subtype.title}`);
    await request(`/missions/${missionId}/clarify`, {
      method: "POST",
      body: {
        answers: [
        {
          questionId: `product-subtype-${subtype.optionId}`,
          answer: subtype.title,
          selection: selection(
            "product-subtype", "product-type", "accept-recommendation",
            subtype.optionId, subtype.title, subtype.whyItMayFit, 1, "product subtype",
          ),
        },
        {
          questionId: `customer-message-certification-${index + 1}`,
          answer: customMessage,
          selection: selection(
            "customer-message", `customer-message-certification-${index + 1}`,
            "message", null, customMessage,
            "The customer added a project-specific live-certification instruction.",
            1, null,
          ),
        },
        ],
      },
    });
  }
  const designed = await waitForMission(
    missionId,
    (mission) => mission.profile !== null && mission.productBlueprint !== null && !mission.running,
    `${input} project design`,
  );
  const profile = designed.profile;
  const designIndex = Math.max(0, profile.designAlternatives.findIndex((item) => item.recommended));
  const direction = profile.designAlternatives[designIndex];
  const answers = [
    {
      questionId: "customer-design-direction",
      answer: `Use this design direction: ${direction.approach}.`,
      selection: selection(
        "design-direction", "design-direction", "accept-recommendation",
        `alternative-${designIndex + 1}`, direction.approach,
        direction.whyItFits ?? direction.rationale,
        profile.profileVersion, "design preference",
      ),
    },
    ...profile.contextualSuggestions.map((item) => ({
      questionId: item.suggestionId,
      answer: `${item.selectedByDefault === false ? "Remove" : "Include"} this project idea: ${item.label}.`,
      selection: selection(
        "recommendation", item.suggestionId,
        item.selectedByDefault === false ? "exclude" : "include",
        item.suggestionId, item.label, item.rationale,
        profile.profileVersion, "feature recommendation",
      ),
    })),
    ...profile.openQuestions.map((item) => ({
      questionId: item.questionId,
      answer: `Left to Foundry: ${item.recommendation ?? item.answerOptions[0]}`,
      selection: selection(
        "decision", item.questionId, "delegate", null,
        item.recommendation ?? item.answerOptions[0],
        item.recommendationReason ?? item.reason,
        profile.profileVersion, "project decision",
      ),
    })),
    {
      questionId: "customer-proposal-confirmation",
      answer: "Use every recorded recommendation and continue to the Product Blueprint.",
      selection: selection(
        "proposal-confirmation", "customer-proposal-confirmation", "confirm", null,
        "Continue to the approved plan", "The customer continued with all unresolved choices delegated to Foundry.",
        profile.profileVersion, "proposal confirmation",
      ),
    },
  ];
  await request(`/missions/${missionId}/clarify`, { method: "POST", body: { answers } });
  const review = await waitForMission(
    missionId,
    (mission) => mission.productBlueprint?.blueprintVersion > profile.profileVersion && !mission.running,
    `${input} blueprint review`,
  );
  const blueprint = review.productBlueprint;
  await request(`/missions/${missionId}/clarify`, {
    method: "POST",
    body: {
      answers: [{
        questionId: `product-blueprint-approval-v${blueprint.blueprintVersion}`,
        answer: `Approve Product Blueprint v${blueprint.blueprintVersion}.`,
        selection: selection(
          "blueprint-approval", "product-blueprint", "confirm",
          `blueprint-v${blueprint.blueprintVersion}`, blueprint.integrityHash,
          "The customer approved the complete versioned Product Blueprint.",
          blueprint.blueprintVersion, "blueprint approval",
        ),
      }],
    },
  });
  let finalMission = await request(`/missions/${missionId}`);
  if (EXECUTE) {
    console.log(`[${index + 1}/${INPUTS.length}] ${input}: executing approved blueprint`);
    await request(`/missions/${missionId}/start`, { method: "POST", body: {} });
    finalMission = await waitForMission(
      missionId,
      (mission) => ["SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED", "EXHAUSTED"].includes(mission.state),
      `${input} execution`,
      900_000,
    );
    if (finalMission.state !== "SUCCEEDED") {
      throw new Error(`${input} execution ended in ${finalMission.state}.`);
    }
  }
  const visualDifferences = pairwiseVisualDifferences(profile.designAlternatives);
  const contractBlueprintHash =
    finalMission.approvedProjectContract?.productBlueprint?.integrityHash ?? null;
  if (EXECUTE && contractBlueprintHash !== blueprint.integrityHash) {
    throw new Error(
      `${input} execution contract does not match approved blueprint ${blueprint.integrityHash}.`,
    );
  }
  const firstPassMetrics = EXECUTE
    ? assertFirstPassExecution(finalMission)
    : null;
  return {
    input,
    missionId,
    subtypeCount: discovered.productTypeDiscovery.subtypes.length,
    selectedSubtype: subtype.title,
    blueprintVersion: blueprint.blueprintVersion,
    blueprintHash: blueprint.integrityHash,
    primaryWorkflows: blueprint.primaryWorkflows,
    requiredSurfaces: blueprint.requiredSurfaces,
    designDirections: profile.designAlternatives.map((item) => item.approach),
    minimumVisualDifferences: Math.min(...visualDifferences.map((item) => item.differences)),
    recommendations: profile.contextualSuggestions.map((item) => item.label),
    customMessagePresent: blueprint.customCustomerMessages.includes(customMessage),
    selectedSubtypePresent: blueprint.selectedSubtypes.includes(subtype.title),
    executionState: EXECUTE ? finalMission.state : "APPROVED_NOT_EXECUTED",
    contractBlueprintHash,
    finishedMatchesApprovedBlueprint: EXECUTE
      ? contractBlueprintHash === blueprint.integrityHash
      : null,
    firstPass: EXECUTE ? true : null,
    firstPassMetrics,
  };
}

async function executeApprovedCertification(previous, index) {
  console.log(
    `[${index + 1}/${INPUTS.length}] ${previous.input}: executing preserved approved blueprint`,
  );
  await request(`/missions/${previous.missionId}/start`, {
    method: "POST",
    body: {},
  });
  const mission = await waitForMission(
    previous.missionId,
    (candidate) =>
      ["SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED", "EXHAUSTED"].includes(
        candidate.state,
      ),
    `${previous.input} execution`,
    900_000,
  );
  if (mission.state !== "SUCCEEDED") {
    throw new Error(`${previous.input} execution ended in ${mission.state}.`);
  }
  const contractBlueprintHash =
    mission.approvedProjectContract?.productBlueprint?.integrityHash ?? null;
  if (contractBlueprintHash !== previous.blueprintHash) {
    throw new Error(
      `${previous.input} execution contract does not match approved blueprint ${previous.blueprintHash}.`,
    );
  }
  const firstPassMetrics = assertFirstPassExecution(mission);
  return {
    ...previous,
    executionState: mission.state,
    contractBlueprintHash,
    finishedMatchesApprovedBlueprint: true,
    firstPass: true,
    firstPassMetrics,
  };
}

const outputPath = resolve(
  process.cwd(),
  process.env.FOUNDRY_CERTIFICATION_OUTPUT ??
    "product-studio-live-certification.json",
);
function isReusableFirstPassCertificate(item) {
  const metrics = item?.firstPassMetrics;
  return item?.error === undefined &&
    item?.firstPass === true &&
    item?.executionState === "SUCCEEDED" &&
    item?.finishedMatchesApprovedBlueprint === true &&
    typeof item?.blueprintHash === "string" &&
    item.blueprintHash === item.contractBlueprintHash &&
    (metrics?.repairModelCalls ?? 0) === 0 &&
    (metrics?.reinstallCount ?? 0) === 0 &&
    (metrics?.runtimeRestartCount ?? 0) === 0 &&
    (metrics?.rebuildCount ?? 1) <= 1;
}

const artifactDirectory = resolve(process.cwd(), "artifacts");
const reportPaths = RESUME
  ? [
      outputPath,
      ...(existsSync(artifactDirectory)
        ? readdirSync(artifactDirectory)
            .filter((name) => /(?:certification|canary).*\.json$/u.test(name))
            .map((name) => resolve(artifactDirectory, name))
        : []),
    ]
  : [];
const previousReports = [];
for (const reportPath of new Set(reportPaths)) {
  if (!existsSync(reportPath)) continue;
  try {
    previousReports.push(JSON.parse(readFileSync(reportPath, "utf8")));
  } catch {}
}
const previousByInput = new Map();
for (const previousReport of previousReports) {
  for (const item of previousReport?.inputs ?? []) {
    if (
      typeof item?.input === "string" &&
      (isReusableFirstPassCertificate(item) ||
        (!EXECUTE && item.error === undefined)) &&
      !previousByInput.has(item.input)
    ) {
      previousByInput.set(item.input, item);
    }
  }
}
const report = {
  startedAt: new Date().toISOString(),
  execute: EXECUTE,
  resumed: RESUME,
  inputs: [],
};
for (const [index, input] of INPUTS.entries()) {
  if (EXECUTE) {
    const succeeded = await findSucceededCertification(input);
    if (succeeded !== null) {
      console.log(
        `[${index + 1}/${INPUTS.length}] ${input}: preserving ledger-verified successful execution`,
      );
      report.inputs.push(succeeded);
      continue;
    }
  }
  const previous = previousByInput.get(input);
  if (previous !== undefined && previous.error === undefined) {
    if (EXECUTE && previous.executionState === "APPROVED_NOT_EXECUTED") {
      try {
        report.inputs.push(await executeApprovedCertification(previous, index));
        continue;
      } catch (error) {
        console.error(
          `[${index + 1}/${INPUTS.length}] ${input}: preserved mission execution failed: ${String(error?.message ?? error)}`,
        );
      }
    } else {
    console.log(`[${index + 1}/${INPUTS.length}] ${input}: preserving prior passing certification`);
    report.inputs.push(previous);
    continue;
    }
  }
  let completed = false;
  let lastError = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const result = await certify(input, index);
      report.inputs.push({ ...result, attempts: attempt });
      completed = true;
      break;
    } catch (error) {
      lastError = String(error?.message ?? error);
      console.error(
        `[${index + 1}/${INPUTS.length}] ${input}: attempt ${attempt}/${maximumAttempts}: ${lastError}`,
      );
    }
  }
  if (!completed) {
    report.inputs.push({ input, attempts: maximumAttempts, error: lastError });
    if (FAIL_FAST) break;
  }
}
report.completedAt = new Date().toISOString();
report.passed = report.inputs.filter((item) => item.error === undefined).length;
report.failed = report.inputs.length - report.passed;
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Certification complete: ${report.passed}/${report.inputs.length} passed. ${outputPath}`);
if (report.failed > 0) process.exitCode = 1;
