import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { approvedContractRequirementCatalogue } from "../src/index.js";

const API = "http://127.0.0.1:3927";
const evidencePath = resolve(
  "docs/phase-8-live-certification/evidence.json",
);
const terminalStates = new Set([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "EXHAUSTED",
  "CANCELLED",
]);

const cases = Object.freeze([
  {
    slug: "insurance-broker",
    marker: "Harbor Point Insurance",
    prompt: "Build a secure customer portal for Harbor Point Insurance, an independent insurance broker. Use fictional seeded policyholder and staff records. Policyholders sign in, see only their own active policies, coverage summaries, renewal dates and documents, then submit and track a service request. Staff can review requests and update status. Prioritize mobile access, privacy boundaries, keyboard navigation and clear renewal urgency. Do not include claims adjudication, payments or real carrier integrations in this first version.",
    note: "Harbor Point customers must never be able to view another policyholder's policies, documents, or service requests.",
  },
  {
    slug: "photographer-portfolio",
    marker: "Mira Vale Photography",
    prompt: "Build a public portfolio website for Mira Vale Photography in Portland. Feature three supplied fictional wedding stories—Forest House, Alder Hall and Coastline Elopement—with approved role, process and outcome copy; include an About section and a direct contact link to hello@miravale.example. Use a warm editorial visual direction, image placeholders with truthful labels, strong mobile reading and no stored inquiry form. Do not invent awards, testimonials or pricing.",
    note: "Keep Mira Vale's project stories editorial and quiet; the contact action should never overpower the photographic work.",
  },
  {
    slug: "multi-staff-booking",
    marker: "Juniper Wellness Studio",
    prompt: "Build a multi-staff appointment booking application for Juniper Wellness Studio. Seed three fictional practitioners, four services with different durations, working hours and existing appointments. Customers choose a service, see only available practitioners and times, book with name and email, and receive an on-screen confirmation. Staff can view the daily schedule and cancel a booking. Persist appointments locally, prevent double-booking, and make the customer flow excellent on phones. No external calendar or payment integration yet.",
    note: "Juniper Wellness needs a visible timezone on every booking and schedule view so staff and customers interpret times consistently.",
  },
  {
    slug: "restaurant-reservation-api",
    marker: "Ember Table API",
    prompt: "Build a documented restaurant reservation web API called Ember Table API. It manages fictional dining tables, opening windows and reservations. Provide health, availability, create-reservation, retrieve-reservation and cancel-reservation endpoints with JSON validation and clear error responses. Prevent overlapping reservations and over-capacity bookings, persist data locally, include seeded tables and an interactive documentation page for operators. No payments, SMS or third-party restaurant platform integration.",
    note: "Ember Table must return a stable conflict response when two requests compete for the same table and time window.",
  },
  {
    slug: "employee-onboarding",
    marker: "Northline Onboarding",
    prompt: "Build an internal employee onboarding tool called Northline Onboarding. Seed fictional HR coordinators, managers, new hires and reusable onboarding tasks. HR creates a new-hire plan from a checklist, assigns owners and due dates, managers update their tasks, and the new hire sees a clear personal progress view. Persist changes locally, show overdue ownership, support keyboard use and keep private HR notes away from the new-hire view. Do not add payroll, benefits enrollment or external identity integration.",
    note: "Northline's HR-only notes must be visibly separated from tasks and must never appear in the new-hire experience.",
  },
  {
    slug: "plumbing-website",
    marker: "Blue River Plumbing",
    prompt: "Build a mobile-first local business website for Blue River Plumbing in Austin, Texas. Use the fictional phone number 512-555-0184, hours Monday through Saturday 7am–7pm, and services for emergency leaks, water heaters, drain clearing and fixture repair. Include service-area details for Austin, Round Rock and Cedar Park, an emergency call action, and a quote-request form stored locally with customer name, phone, area and request details. Staff can review requests. Do not invent licenses, reviews, prices or response guarantees.",
    note: "Blue River's emergency phone action must remain visible and usable at narrow phone widths without hiding the normal quote path.",
  },
  {
    slug: "ai-document-review",
    marker: "Clause Lantern",
    prompt: "Build an AI-assisted document-review web application called Clause Lantern for fictional procurement teams. Users paste contract text, choose a review focus, and receive a clearly labeled AI-generated review containing cited source excerpts, potential issues and questions for human follow-up. Persist review sessions locally, never claim legal advice, keep the original text visible beside findings, and provide an explicit failed-analysis state. Use the configured OpenAI provider only through a server route and do not expose credentials. No file upload or external document storage in this version.",
    note: "Clause Lantern must show which exact source excerpt supports each generated issue and must label every result as requiring human review.",
  },
  {
    slug: "school-parent-portal",
    marker: "Cedar Grove Parent Portal",
    prompt: "Build a school parent portal called Cedar Grove Parent Portal with fictional families, students and staff announcements. A parent signs in, sees only their linked students, reads announcements, views upcoming events and acknowledges permission notices. School staff can publish announcements and review acknowledgement status. Persist local data, support multiple children per parent, prioritize phone use and keep one family's information isolated from another. Do not add grades, payments or real student records.",
    note: "Cedar Grove parents with multiple children need a clear student switcher that never mixes notices or acknowledgement state.",
  },
  {
    slug: "expense-approval",
    marker: "Tern Expense Flow",
    prompt: "Build an internal expense approval system called Tern Expense Flow using fictional employees, managers and finance reviewers. Employees submit an expense with amount, category, date and explanation; managers approve or return it with a reason; finance sees only manager-approved items and marks reimbursement status. Persist every state change locally, show a readable audit history, prevent self-approval and keep role-specific queues distinct. No receipt upload, payroll export or corporate card integration yet.",
    note: "Tern Expense Flow must make returned expenses editable without erasing the manager's return reason or prior audit history.",
  },
  {
    slug: "simple-admin-sign-in",
    marker: "Lumen Records Admin",
    prompt: "Build a simple administrative sign-in application for Lumen Records Admin. Seed one fictional administrator with ID lumen-admin and a development-only password ChangeMe-2026. Store only a one-way password hash. The administrator signs in, sees a small management home page and signs out; unauthenticated visitors cannot reach management content. Include clear invalid-credential, locked-session and launch-readiness states. Do not add public registration, password reset, company logo or additional admin features.",
    note: "Lumen Records must clearly identify the seeded credential as development-only and require replacement before a production launch.",
  },
]);

function now() {
  return new Date().toISOString();
}

function loadEvidence() {
  if (!existsSync(evidencePath)) {
    return {
      schemaVersion: 1,
      startedAt: now(),
      updatedAt: now(),
      productionApi: API,
      cases: {},
      audit: null,
    };
  }
  return JSON.parse(readFileSync(evidencePath, "utf8"));
}

function saveEvidence(evidence) {
  evidence.updatedAt = now();
  mkdirSync(dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  renameSync(temporaryPath, evidencePath);
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${payload.error ?? JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForMission(missionId, label, predicate, timeoutMs) {
  const startedAt = Date.now();
  let lastLine = "";
  while (Date.now() - startedAt < timeoutMs) {
    const mission = await api(`/missions/${missionId}`);
    const line = `${mission.state ?? "UNKNOWN"} · ${mission.currentActivity?.label ?? mission.currentActivity?.detail ?? "waiting"}`;
    if (line !== lastLine) {
      console.log(`[${label}] ${line}`);
      lastLine = line;
    }
    if (mission.error) throw new Error(`${label}: ${mission.error}`);
    if (predicate(mission)) return mission;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 3_000));
  }
  throw new Error(`${label} did not finish within ${Math.round(timeoutMs / 60_000)} minutes.`);
}

function approvalAnswers(definition, profile) {
  const answers = [
    {
      questionId: `customer-message-${definition.slug}`,
      answer: definition.note,
      selection: {
        kind: "customer-message",
        subjectId: `customer-message-${definition.slug}`,
        mode: "message",
        optionId: null,
        value: definition.note,
        reason: "The customer added a project-specific certification instruction.",
        classification: null,
        sourceProfileVersion: profile.profileVersion,
      },
    },
    ...profile.openQuestions.map((question) => ({
      questionId: question.questionId,
      answer: `Foundry decides. Recommended: ${question.recommendation}. Use your professional judgement.`,
      selection: {
        kind: "decision",
        subjectId: question.questionId,
        mode: "delegate",
        optionId: null,
        value: question.recommendation,
        reason: question.recommendationReason,
        classification: "project decision",
        sourceProfileVersion: profile.profileVersion,
      },
    })),
    ...profile.contextualSuggestions.map((recommendation) => ({
      questionId: recommendation.suggestionId,
      answer: recommendation.selectedByDefault
        ? `Include this project idea: ${recommendation.label}. ${recommendation.rationale}`
        : `Remove this project idea: ${recommendation.label}. Do not include it in the approved plan.`,
      selection: {
        kind: "recommendation",
        subjectId: recommendation.suggestionId,
        mode: recommendation.selectedByDefault ? "include" : "exclude",
        optionId: recommendation.suggestionId,
        value: recommendation.label,
        reason: recommendation.rationale,
        classification: "feature recommendation",
        sourceProfileVersion: profile.profileVersion,
      },
    })),
    {
      questionId: "customer-proposal-confirmation",
      answer: "The proposal sounds right. Use these recorded decisions and continue to the plan.",
      selection: {
        kind: "proposal-confirmation",
        subjectId: "customer-proposal-confirmation",
        mode: "confirm",
        optionId: null,
        value: "Continue to the approved plan",
        reason: "The customer confirmed the complete proposal.",
        classification: "proposal confirmation",
        sourceProfileVersion: profile.profileVersion,
      },
    },
  ];
  return answers;
}

function initialCapture(definition, mission) {
  return {
    originalPrompt: definition.prompt,
    foundryUnderstanding: {
      name: mission.profile.name,
      summary: mission.profile.summary,
      actors: mission.profile.primaryActors,
      outcomes: mission.profile.outcomes,
      observations: mission.profile.observations,
    },
    designProposal: {
      journeys: mission.profile.primaryJourneys,
      includedDefaults: mission.profile.includedDefaults,
      constraints: mission.profile.constraints,
      assumptions: mission.profile.assumptions,
    },
    styleDirection: mission.profile.designDirection,
    designAlternatives: mission.profile.designAlternatives,
    recommendations: mission.profile.contextualSuggestions,
    clarificationDecisions: mission.profile.openQuestions,
    customUserNote: definition.note,
  };
}

function finalCapture(definition, mission) {
  return {
    slug: definition.slug,
    marker: definition.marker,
    missionId: mission.missionId,
    capturedAt: now(),
    originalPrompt: definition.prompt,
    finalState: mission.state,
    proposalConfirmed: mission.proposalConfirmed,
    foundryUnderstanding: {
      name: mission.profile?.name ?? null,
      summary: mission.profile?.summary ?? null,
      actors: mission.profile?.primaryActors ?? [],
      outcomes: mission.profile?.outcomes ?? [],
      observations: mission.profile?.observations ?? [],
    },
    designProposal: {
      journeys: mission.profile?.primaryJourneys ?? [],
      includedDefaults: mission.profile?.includedDefaults ?? [],
      constraints: mission.profile?.constraints ?? [],
      assumptions: mission.profile?.assumptions ?? [],
    },
    styleDirection: mission.profile?.designDirection ?? null,
    designAlternatives: mission.profile?.designAlternatives ?? [],
    recommendations: mission.profile?.contextualSuggestions ?? [],
    clarificationDecisions: mission.decisionHistory,
    customUserNote: definition.note,
    finalApprovedContract: mission.approvedProjectContract,
    executableRequirementContract: mission.contract,
    selectedCapabilityRoutes: mission.modelRouting,
    generatedMissionPlan: mission.generatedMissionPlan,
    finishedApplication: {
      previewUrl: mission.previewUrl,
      runtime: mission.executionProjection?.runtime ?? null,
      workspace: mission.executionProjection?.workspace ?? null,
      phase: mission.executionProjection?.phase ?? null,
      timing: mission.executionProjection?.timing ?? null,
    },
    verificationVerdicts: mission.executionProjection?.verification ?? [],
    executionMetrics: mission.executionMetrics,
  };
}

async function runCase(
  definition,
  evidence,
  adoptedMissionId = null,
  forceNewAttempt = false,
) {
  if (forceNewAttempt && evidence.cases[definition.slug] !== undefined) {
    evidence.failedAttempts ??= [];
    evidence.failedAttempts.push({
      ...evidence.cases[definition.slug],
      archivedAt: now(),
    });
    delete evidence.cases[definition.slug];
    saveEvidence(evidence);
  }
  const record = evidence.cases[definition.slug] ?? {
    slug: definition.slug,
    marker: definition.marker,
    status: "NOT_STARTED",
    missionId: null,
    initial: null,
    final: null,
    error: null,
  };
  evidence.cases[definition.slug] = record;
  if (adoptedMissionId !== null) record.missionId = adoptedMissionId;

  try {
    let mission;
    if (record.missionId === null) {
      record.status = "CREATING";
      saveEvidence(evidence);
      mission = await api("/missions", {
        method: "POST",
        body: JSON.stringify({ intent: definition.prompt }),
      });
      record.missionId = mission.missionId;
      record.status = "UNDERSTANDING";
      saveEvidence(evidence);
      console.log(`[${definition.slug}] created ${record.missionId}`);
    } else {
      mission = await api(`/missions/${record.missionId}`);
      console.log(`[${definition.slug}] resuming ${record.missionId} from ${mission.state}`);
    }

    if (mission.profile === null) {
      mission = await waitForMission(
        record.missionId,
        `${definition.slug}: understanding`,
        (candidate) => candidate.profile !== null && !candidate.running,
        20 * 60_000,
      );
    }
    if (record.initial === null) {
      record.initial = initialCapture(definition, mission);
      saveEvidence(evidence);
    }

    if (!mission.proposalConfirmed) {
      if (!mission.running) {
        record.status = "APPROVING_DEFAULTS";
        saveEvidence(evidence);
        await api(`/missions/${record.missionId}/clarify`, {
          method: "POST",
          body: JSON.stringify({ answers: approvalAnswers(definition, mission.profile) }),
        });
      }
      const priorVersion = mission.profile.profileVersion;
      mission = await waitForMission(
        record.missionId,
        `${definition.slug}: revision`,
        (candidate) =>
          candidate.proposalConfirmed &&
          candidate.profile?.profileVersion > priorVersion &&
          !candidate.running,
        20 * 60_000,
      );
    }
    if (mission.profile.openQuestions.length > 0) {
      throw new Error(`Continue-with-defaults left ${mission.profile.openQuestions.length} architecture decision(s) unresolved.`);
    }

    if (!terminalStates.has(mission.state)) {
      if (!mission.running) {
        record.status = "EXECUTING";
        saveEvidence(evidence);
        await api(`/missions/${record.missionId}/start`, { method: "POST" });
      }
      mission = await waitForMission(
        record.missionId,
        `${definition.slug}: execution`,
        (candidate) => terminalStates.has(candidate.state) && !candidate.running,
        60 * 60_000,
      );
    }

    record.final = finalCapture(definition, mission);
    record.status = mission.state;
    record.error = mission.error;
    saveEvidence(evidence);
    if (mission.state !== "SUCCEEDED") {
      throw new Error(`Production mission ended ${mission.state}: ${mission.error ?? "no worker detail"}`);
    }
    console.log(`[${definition.slug}] SUCCEEDED · ${mission.previewUrl ?? "preview stopped"}`);
    return record;
  } catch (error) {
    record.status = "FAILED_CERTIFICATION";
    record.error = String(error?.message ?? error);
    saveEvidence(evidence);
    throw error;
  }
}

async function audit(evidence) {
  const providerView = await api("/providers");
  const approvedModels = new Set(
    providerView.providers.flatMap((provider) =>
      provider.models.map((model) => `${provider.providerId}/${model.modelId}`),
    ),
  );
  const records = cases.map((definition) => evidence.cases[definition.slug]);
  const findings = [];
  for (const [index, definition] of cases.entries()) {
    const record = records[index];
    if (record?.status !== "SUCCEEDED" || record.final === null) {
      findings.push(`${definition.slug}: no successful final capture`);
      continue;
    }
    const final = record.final;
    const contract = final.finalApprovedContract;
    const plan = final.generatedMissionPlan;
    if (contract === null) findings.push(`${definition.slug}: approved contract missing`);
    if (plan === null) findings.push(`${definition.slug}: generated mission plan missing`);
    if (contract !== null && !contract.customerFollowUpMessages.includes(definition.note)) {
      findings.push(`${definition.slug}: custom note missing from approved contract`);
    }
    if (contract !== null && plan !== null) {
      if (plan.contractHash !== contract.contentHash) {
        findings.push(`${definition.slug}: generated plan contract hash mismatch`);
      }
      const catalogue = approvedContractRequirementCatalogue(contract);
      const claimIds = new Set(plan.requirementClaims.map((claim) => claim.requirementId));
      for (const requirement of catalogue.implementationRequirements) {
        if (!claimIds.has(requirement.requirementId)) {
          findings.push(`${definition.slug}: requirement ${requirement.requirementId} missing from generation claims`);
        }
      }
      const customRequirement = catalogue.implementationRequirements.find(
        (requirement) => requirement.statement === definition.note,
      );
      if (customRequirement === undefined || !claimIds.has(customRequirement.requirementId)) {
        findings.push(`${definition.slug}: custom note lacks a generation claim`);
      }
    }
    if (final.verificationVerdicts.length === 0 || final.verificationVerdicts.some((verdict) => verdict.result !== "SATISFIED")) {
      findings.push(`${definition.slug}: not every verification verdict is SATISFIED`);
    }
    for (const route of final.selectedCapabilityRoutes) {
      if (route.status !== "SUCCEEDED") continue;
      if (!approvedModels.has(`${route.provider}/${route.modelId}`)) {
        findings.push(`${definition.slug}: route ${route.provider}/${route.modelId} is not currently approved`);
      }
    }
    const serialized = JSON.stringify(final).toLowerCase();
    for (const other of cases) {
      if (other.slug !== definition.slug && serialized.includes(other.marker.toLowerCase())) {
        findings.push(`${definition.slug}: leaked marker from ${other.slug}`);
      }
    }
  }
  const contractHashes = records.map((record) => record?.final?.finalApprovedContract?.contentHash).filter(Boolean);
  if (new Set(contractHashes).size !== cases.length) {
    findings.push("approved contracts are not unique across all ten projects");
  }
  const recommendationSignatures = records.map((record) =>
    JSON.stringify(record?.initial?.recommendations?.map((item) => item.label) ?? []),
  );
  if (new Set(recommendationSignatures).size !== cases.length) {
    findings.push("at least two projects repeated the exact recommendation set");
  }
  evidence.audit = {
    auditedAt: now(),
    passed: findings.length === 0,
    projectCount: records.filter((record) => record?.status === "SUCCEEDED").length,
    uniqueContractHashes: new Set(contractHashes).size,
    uniqueRecommendationSets: new Set(recommendationSignatures).size,
    findings,
  };
  saveEvidence(evidence);
  if (findings.length > 0) throw new Error(`Phase 8 audit failed:\n- ${findings.join("\n- ")}`);
  console.log(JSON.stringify(evidence.audit, null, 2));
}

const evidence = loadEvidence();
const caseArgument = process.argv.find((argument) => argument.startsWith("--case="));
const adoptArgument = process.argv.find((argument) => argument.startsWith("--adopt="));
const runAll = process.argv.includes("--all");
const auditOnly = process.argv.includes("--audit-only");
const forceNewAttempt = process.argv.includes("--new-attempt");

if (auditOnly) {
  await audit(evidence);
} else if (adoptArgument !== undefined) {
  const [slug, missionId] = adoptArgument.slice("--adopt=".length).split(":");
  const definition = cases.find((candidate) => candidate.slug === slug);
  if (definition === undefined || !missionId) throw new Error("--adopt requires a known slug and mission ID.");
  await runCase(definition, evidence, missionId, forceNewAttempt);
} else {
  const selected = runAll
    ? cases
    : cases.filter((definition) => definition.slug === caseArgument?.slice("--case=".length));
  if (selected.length === 0) {
    throw new Error("Use --case=<slug>, --all, --adopt=<slug>:<missionId>, or --audit-only.");
  }
  for (const definition of selected) {
    await runCase(definition, evidence, null, forceNewAttempt);
  }
  if (runAll) await audit(evidence);
}
