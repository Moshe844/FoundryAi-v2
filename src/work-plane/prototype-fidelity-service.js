import { createHash } from "node:crypto";

import { normalizeApprovedDesignContract } from "../domain/live-concept-studio.js";
import { evaluatePrototypeFidelity } from "../domain/prototype-fidelity.js";

function fail(message) {
  throw new TypeError(`Prototype fidelity service: ${message}`);
}

export function createPrototypeFidelityService({ workspaceService, browserVerifier }) {
  if (typeof workspaceService?.list !== "function" || typeof workspaceService?.readEvidenceFile !== "function") {
    fail("workspaceService is required.");
  }
  if (typeof browserVerifier?.verify !== "function") fail("browserVerifier is required.");

  function approvedWorkspace(approvedDesignContract) {
    const workspace = workspaceService.list(approvedDesignContract.missionId).find((entry) =>
      entry.conceptId === approvedDesignContract.selectedConceptId &&
      entry.conceptVersion === approvedDesignContract.selectedConceptVersion,
    );
    if (workspace === undefined || workspace.status !== "FINALIZED") {
      fail("approved prototype workspace is missing or not finalized.");
    }
    if (workspace.contentHash !== approvedDesignContract.prototypeContentHash) {
      fail("approved prototype workspace content hash changed.");
    }
    return workspace;
  }

  function loadApprovedPrototypeSource({ approvedDesignContract: input }) {
    if (typeof workspaceService.readSourceFile !== "function") {
      fail("approved prototype source reader is unavailable.");
    }
    const approvedDesignContract = normalizeApprovedDesignContract(input);
    const workspace = approvedWorkspace(approvedDesignContract);
    const conceptContract = workspaceService.loadContractAt(workspace.rootPath);
    const files = approvedDesignContract.prototypeFileManifest.map((entry) => {
      const content = workspaceService.readSourceFile(conceptContract, entry.path);
      const contentHash = createHash("sha256").update(content).digest("hex");
      if (contentHash !== entry.contentHash || content.length !== entry.size) {
        fail(`approved prototype source "${entry.path}" does not match its immutable manifest.`);
      }
      return Object.freeze({
        path: entry.path,
        content: content.toString("utf8"),
        contentHash,
      });
    });
    return Object.freeze({
      approvedDesignId: approvedDesignContract.approvedDesignId,
      prototypeContentHash: approvedDesignContract.prototypeContentHash,
      files: Object.freeze(files),
    });
  }

  async function verify({ approvedDesignContract: input, productionPreviewUrl }) {
    const approvedDesignContract = normalizeApprovedDesignContract(input);
    const workspace = approvedWorkspace(approvedDesignContract);
    const conceptContract = workspaceService.loadContractAt(workspace.rootPath);
    const reference = approvedDesignContract.browserEvidenceReferences[0];
    if (typeof reference !== "string" || !reference.startsWith("evidence/")) {
      fail("approved browser evidence reference is invalid.");
    }
    const prototypeVerification = JSON.parse(
      workspaceService.readEvidenceFile(conceptContract, reference.slice("evidence/".length)).toString("utf8"),
    );
    const production = await browserVerifier.verify({
      previewUrl: productionPreviewUrl,
      expectedRoutes: conceptContract.expectedPreviewRoutes,
    });
    const fidelity = evaluatePrototypeFidelity({
      approvedDesignContract,
      prototypeVerification,
      productionBrowserResult: production,
    });
    const screenshotManifest = Object.freeze(Object.entries(production.screenshots).map(([name, content]) => ({
      name,
      contentHash: createHash("sha256").update(content).digest("hex"),
      size: content.length,
    })).sort((left, right) => left.name.localeCompare(right.name)));
    return Object.freeze({
      ...fidelity,
      productionObservations: production.results.map((entry) => structuredClone(entry)),
      productionScreenshotManifest: screenshotManifest,
      prototypeScreenshotReferences: approvedDesignContract.screenshotEvidenceReferences,
    });
  }

  return Object.freeze({ loadApprovedPrototypeSource, verify });
}
