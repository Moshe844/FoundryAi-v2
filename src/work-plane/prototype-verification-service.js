import { createHash } from "node:crypto";

import { normalizeConceptPrototypeContract } from "../domain/live-concept-studio.js";

function fail(message) {
  throw new TypeError(`Prototype verification: ${message}`);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function safeId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,127})$/u.test(value)) {
    fail(`${label} must be a safe identifier.`);
  }
  return value;
}

function admissionFindings(contract, browserResult) {
  const findings = [];
  const expectedCount = contract.expectedPreviewRoutes.length * 3;
  if (!Array.isArray(browserResult.results) || browserResult.results.length !== expectedCount) {
    findings.push(`Expected ${expectedCount} route/viewport observations.`);
    return findings;
  }
  for (const observation of browserResult.results) {
    const prefix = `${observation.route} ${observation.viewport?.name ?? "unknown"}`;
    const measurement = observation.measurement;
    if (measurement === null || typeof measurement !== "object") findings.push(`${prefix}: measurement missing.`);
    else {
      if (measurement.readyState !== "complete") findings.push(`${prefix}: runtime did not finish loading.`);
      if (measurement.hasMain !== true) findings.push(`${prefix}: semantic main surface is missing.`);
      if (!Number.isSafeInteger(measurement.headingCount) || measurement.headingCount < 1) findings.push(`${prefix}: visual hierarchy has no heading.`);
      if (!Number.isSafeInteger(measurement.semanticSurfaceCount) || measurement.semanticSurfaceCount < 2) findings.push(`${prefix}: representative semantic surfaces are missing.`);
      if (measurement.horizontalOverflow !== false) findings.push(`${prefix}: horizontal overflow detected.`);
      if (!Number.isSafeInteger(measurement.focusableCount) || measurement.focusableCount < 1) findings.push(`${prefix}: no keyboard interaction target exists.`);
      if (measurement.activeElement === null || measurement.activeElement === "BODY") findings.push(`${prefix}: keyboard focus could not be established.`);
      if (measurement.missingImageAltCount !== 0) findings.push(`${prefix}: image alternative text is missing.`);
    }
    if (observation.browserErrors?.length > 0) findings.push(`${prefix}: blocking browser errors were observed: ${observation.browserErrors.join(" | ").slice(0, 500)}`);
    if (observation.externalRequests?.length > 0) findings.push(`${prefix}: forbidden external network requests were attempted: ${observation.externalRequests.join(" | ").slice(0, 500)}`);
    if (typeof observation.screenshotName !== "string" || browserResult.screenshots?.[observation.screenshotName] === undefined) {
      findings.push(`${prefix}: screenshot evidence is missing.`);
    }
  }
  return findings;
}

function designSignature(record) {
  return hash(record.observations.map((observation) => ({
    route: observation.route,
    viewport: observation.viewport,
    manifest: (observation.measurement?.manifest ?? []).map((entry) => ({
      tag: entry.tag,
      role: entry.role,
      x: Math.round(entry.x),
      y: Math.round(entry.y),
      width: Math.round(entry.width),
      height: Math.round(entry.height),
      display: entry.display,
      position: entry.position,
      fontFamily: entry.fontFamily,
      fontSize: entry.fontSize,
      fontWeight: entry.fontWeight,
      backgroundColor: entry.backgroundColor,
      color: entry.color,
    })),
  })));
}

export function createPrototypeVerificationService({
  browserVerifier,
  workspaceService,
  runtimeService,
}) {
  if (typeof browserVerifier?.verify !== "function") fail("browserVerifier is required.");
  if (typeof workspaceService?.writeEvidenceFiles !== "function") fail("workspaceService evidence authority is required.");
  if (typeof runtimeService?.start !== "function" || typeof runtimeService?.stop !== "function") fail("runtimeService is required.");

  async function verify({ conceptContract: input, verificationId: idInput }) {
    const contract = normalizeConceptPrototypeContract(input);
    const verificationId = safeId(idInput, "verificationId");
    const workspace = workspaceService.get(contract);
    if (workspace.status !== "FINALIZED" || typeof workspace.contentHash !== "string") {
      fail("only finalized, hash-bound prototype files may be verified.");
    }
    const sessionId = `${verificationId}-runtime`;
    const runtime = await runtimeService.start({
      conceptContract: contract,
      sessionId,
      idempotencyKey: `${verificationId}-runtime-key`,
      timeoutMs: 20_000,
      expiresAt: new Date(Date.now() + 120_000).toISOString(),
    });
    const startedAt = new Date().toISOString();
    let browserResult;
    try {
      browserResult = await browserVerifier.verify({
        previewUrl: runtime.previewUrl,
        expectedRoutes: contract.expectedPreviewRoutes,
      });
    } finally {
      await runtimeService.stop({ sessionId, reason: "verification-complete" });
    }
    const findings = admissionFindings(contract, browserResult);
    const status = findings.length === 0 ? "PASSED" : "REJECTED";
    const completedAt = new Date().toISOString();
    const observations = browserResult.results.map((entry) => structuredClone(entry));
    const recordBase = {
      schemaVersion: 1,
      verificationId,
      missionId: contract.missionId,
      conceptId: contract.conceptId,
      conceptVersion: contract.conceptVersion,
      contractIntegrityHash: contract.integrityHash,
      contentHash: workspace.contentHash,
      status,
      findings,
      observations,
      screenshotEvidenceReferences: Object.keys(browserResult.screenshots).sort().map(
        (name) => `evidence/${verificationId}/${name}`,
      ),
      startedAt,
      completedAt,
    };
    const record = Object.freeze({
      ...recordBase,
      integrityHash: hash(recordBase),
    });
    const files = Object.fromEntries([
      ...Object.entries(browserResult.screenshots).map(([name, content]) => [
        `${verificationId}/${name}`,
        content,
      ]),
      [`${verificationId}/verification.json`, `${JSON.stringify(record, null, 2)}\n`],
    ]);
    const evidenceManifest = workspaceService.writeEvidenceFiles(contract, files);
    return Object.freeze({ ...record, evidenceManifest });
  }

  function verifyDifferentiation(records) {
    if (!Array.isArray(records) || records.length < 2) fail("at least two verified concepts are required for differentiation.");
    if (records.some((record) => record?.status !== "PASSED")) fail("only admitted concepts may enter differentiation.");
    const signatures = records.map((record) => ({
      conceptId: record.conceptId,
      signature: designSignature(record),
    }));
    const duplicate = signatures.find((candidate, index) =>
      signatures.some((other, otherIndex) => otherIndex < index && other.signature === candidate.signature),
    );
    if (duplicate !== undefined) {
      return Object.freeze({
        status: "REJECTED",
        signatures: Object.freeze(signatures),
        finding: `Concept ${duplicate.conceptId} is structurally and visually interchangeable with another concept.`,
      });
    }
    return Object.freeze({
      status: "PASSED",
      signatures: Object.freeze(signatures),
      finding: null,
    });
  }

  return Object.freeze({ verify, verifyDifferentiation });
}
