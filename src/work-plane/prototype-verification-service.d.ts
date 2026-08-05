import type { ConceptPrototypeContract, PrototypeFileManifestEntry } from "../domain/live-concept-studio.js";
import type { PrototypeBrowserObservation } from "./prototype-browser-verifier.js";

export interface PrototypeVerificationRecord {
  readonly schemaVersion: 1;
  readonly verificationId: string;
  readonly missionId: string;
  readonly conceptId: string;
  readonly conceptVersion: number;
  readonly contractIntegrityHash: string;
  readonly contentHash: string;
  readonly status: "PASSED" | "REJECTED";
  readonly findings: readonly string[];
  readonly observations: readonly PrototypeBrowserObservation[];
  readonly screenshotEvidenceReferences: readonly string[];
  readonly startedAt: string;
  readonly completedAt: string;
  readonly integrityHash: string;
  readonly evidenceManifest: readonly PrototypeFileManifestEntry[];
}

export function createPrototypeVerificationService(input: {
  browserVerifier: { verify(input: { previewUrl: string; expectedRoutes: readonly string[] }): Promise<any> };
  workspaceService: any;
  runtimeService: any;
}): {
  verify(input: { conceptContract: ConceptPrototypeContract; verificationId: string }): Promise<PrototypeVerificationRecord>;
  verifyDifferentiation(records: readonly PrototypeVerificationRecord[]): Readonly<Record<string, unknown>>;
};
