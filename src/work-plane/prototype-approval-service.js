import {
  createApprovedDesignContract,
  normalizeConceptPrototypeContract,
} from "../domain/live-concept-studio.js";

function fail(message) {
  throw new TypeError(`Prototype approval: ${message}`);
}

export function createPrototypeApprovalService({ workspaceService }) {
  if (typeof workspaceService?.get !== "function") fail("workspaceService is required.");

  function approve({ conceptRecord, customerModifications = [], approvalTimestamp = new Date().toISOString() }) {
    if (conceptRecord === null || typeof conceptRecord !== "object") fail("conceptRecord is required.");
    const selectedConcept = normalizeConceptPrototypeContract(conceptRecord.contract);
    if (conceptRecord.verificationStatus !== "PASSED") fail("only a browser-admitted concept can be approved.");
    const workspace = workspaceService.get(selectedConcept);
    if (workspace.status !== "FINALIZED" || typeof workspace.contentHash !== "string") {
      fail("the selected prototype must be finalized and content-hash bound.");
    }
    if (conceptRecord.contentHash !== workspace.contentHash) fail("the concept record does not match the immutable workspace content hash.");
    if (!Array.isArray(conceptRecord.screenshotEvidenceReferences) || conceptRecord.screenshotEvidenceReferences.length < 3) {
      fail("desktop, tablet, and mobile screenshot evidence is required.");
    }
    const browserEvidenceReference = `evidence/${conceptRecord.verificationId}/verification.json`;
    workspaceService.readEvidenceFile(selectedConcept, `${conceptRecord.verificationId}/verification.json`);
    for (const reference of conceptRecord.screenshotEvidenceReferences) {
      const prefix = "evidence/";
      if (!reference.startsWith(prefix)) fail("screenshot evidence reference is not workspace-relative.");
      workspaceService.readEvidenceFile(selectedConcept, reference.slice(prefix.length));
    }
    return createApprovedDesignContract({
      missionId: selectedConcept.missionId,
      selectedConcept,
      customerModifications,
      prototypeFileManifest: workspace.fileManifest,
      screenshotEvidenceReferences: conceptRecord.screenshotEvidenceReferences,
      browserEvidenceReferences: [browserEvidenceReference],
      prototypeContentHash: workspace.contentHash,
      approvalTimestamp,
    });
  }

  return Object.freeze({ approve });
}
