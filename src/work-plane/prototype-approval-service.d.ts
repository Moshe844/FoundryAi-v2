import type { ApprovedDesignContract, ConceptPrototypeContract } from "../domain/live-concept-studio.js";

export interface AdmittedConceptRecord {
  contract: ConceptPrototypeContract;
  verificationId: string;
  verificationStatus: "PASSED";
  screenshotEvidenceReferences: readonly string[];
  contentHash: string;
}

export function createPrototypeApprovalService(input: {
  workspaceService: {
    get(contract: ConceptPrototypeContract): Readonly<{
      status: string;
      contentHash: string | null;
      fileManifest: readonly Readonly<{ path: string; contentHash: string; size: number }>[];
    }>;
    readEvidenceFile(contract: ConceptPrototypeContract, relativePath: string): Buffer;
  };
}): Readonly<{
  approve(input: {
    conceptRecord: AdmittedConceptRecord;
    customerModifications?: readonly string[];
    approvalTimestamp?: string;
  }): ApprovedDesignContract;
}>;
