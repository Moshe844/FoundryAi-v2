import type { ConceptPrototypeContract, PrototypeFileManifestEntry } from "../domain/live-concept-studio.js";

export interface PrototypeWorkspaceView {
  missionId: string;
  conceptId: string;
  conceptVersion: number;
  contractIntegrityHash: string;
  rootPath: string;
  sourcePath: string;
  evidencePath: string;
  status: "PROVISIONED" | "WRITTEN" | "FINALIZED";
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  contentHash: string | null;
  fileManifest: readonly PrototypeFileManifestEntry[];
}

export interface PrototypeWorkspaceService {
  provision(contract: ConceptPrototypeContract): PrototypeWorkspaceView;
  writeFiles(contract: ConceptPrototypeContract, files: Readonly<Record<string, string>>): PrototypeWorkspaceView;
  finalize(contract: ConceptPrototypeContract): PrototypeWorkspaceView;
  get(contract: ConceptPrototypeContract): PrototypeWorkspaceView;
  list(missionId: string): readonly PrototypeWorkspaceView[];
  loadContractAt(workspaceRoot: string): ConceptPrototypeContract;
  runtimeRecords(): unknown[];
  saveRuntimeRecord(record: Record<string, unknown>): Readonly<Record<string, unknown>>;
  writeEvidenceFiles(
    contract: ConceptPrototypeContract,
    files: Readonly<Record<string, string | Buffer>>,
  ): readonly PrototypeFileManifestEntry[];
}

export function createPrototypeWorkspaceService(input: {
  prototypeRoot: string;
}): PrototypeWorkspaceService;
