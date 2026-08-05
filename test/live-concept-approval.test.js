import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ConceptStrategy, createConceptPrototypeContract } from "../src/domain/live-concept-studio.js";
import { createPrototypeApprovalService } from "../src/work-plane/prototype-approval-service.js";
import { createPrototypeWorkspaceService } from "../src/work-plane/prototype-workspace-service.js";

function contract() {
  return createConceptPrototypeContract({
    conceptId: "approved-live-concept", missionId: "mission-approval", conceptVersion: 3,
    conceptName: "Approved live concept", creativeThesis: "Approve the working experience.",
    intendedAudienceResponse: "Trust the selected experience.", designRationale: "The prototype is exact approval evidence.",
    projectSurfaces: ["Opening", "Work", "Action"], pageOrScreenSequence: ["Opening", "Work", "Action"],
    navigationModel: "Persistent top navigation.", compositionRules: ["Use a deliberate split composition."],
    typographySystem: { display: "Georgia", body: "Arial" },
    colorSystem: { background: "#ffffff", surface: "#eeeeee", text: "#111111", primary: "#222222", accent: "#aa4400" },
    spacingSystem: { baseUnit: 8, scale: [8, 16, 24, 40] }, imageryStrategy: "Large local CSS image fields.",
    componentCharacter: "Editorial and exact.", interactionRules: ["Navigation reaches each surface."],
    motionRules: ["Restrained transitions."], responsiveRules: ["Stack below 640px."],
    accessibilityRules: ["Visible focus."], deliberateExclusions: ["No generic replacement layout."],
    sampleContentPolicy: "Use fictional content.", expectedFiles: ["index.html", "styles.css", "concept.js"],
    expectedPreviewRoutes: ["/"], verificationPlan: [{ checkId: "browser", kind: "browser", statement: "Verify three viewports." }],
    sourceProjectDesignVersion: 2, strategy: ConceptStrategy.STANDARD, parentConceptId: null, sourceConceptIds: [],
  });
}

test("approval freezes the exact finalized files, content hash, screenshots, and browser evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "foundry-approval-"));
  try {
    const workspace = createPrototypeWorkspaceService({ prototypeRoot: root });
    const selected = contract();
    workspace.provision(selected);
    workspace.writeFiles(selected, {
      "index.html": '<!doctype html><html lang="en"><main><h1>Approved</h1></main></html>',
      "styles.css": "@media(max-width:640px){main{display:block}}",
      "concept.js": "document.body.dataset.ready='true'",
    });
    const finalized = workspace.finalize(selected);
    workspace.writeEvidenceFiles(selected, {
      "approved-verification/verification.json": "{}",
      "approved-verification/root-desktop.png": Buffer.from("desktop"),
      "approved-verification/root-tablet.png": Buffer.from("tablet"),
      "approved-verification/root-mobile.png": Buffer.from("mobile"),
    });
    const approved = createPrototypeApprovalService({ workspaceService: workspace }).approve({
      conceptRecord: {
        contract: selected,
        verificationId: "approved-verification",
        verificationStatus: "PASSED",
        screenshotEvidenceReferences: [
          "evidence/approved-verification/root-desktop.png",
          "evidence/approved-verification/root-tablet.png",
          "evidence/approved-verification/root-mobile.png",
        ],
        contentHash: finalized.contentHash,
      },
      customerModifications: ["Reduced motion."],
      approvalTimestamp: "2026-08-05T02:00:00.000Z",
    });
    assert.equal(approved.selectedConceptVersion, 3);
    assert.equal(approved.prototypeContentHash, finalized.contentHash);
    assert.deepEqual(approved.prototypeFileManifest, finalized.fileManifest);
    assert.equal(approved.screenshotEvidenceReferences.length, 3);
    assert.deepEqual(approved.browserEvidenceReferences, ["evidence/approved-verification/verification.json"]);
    assert.equal(approved.customerModifications[0], "Reduced motion.");
    assert.equal(approved.approvalTimestamp, "2026-08-05T02:00:00.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
