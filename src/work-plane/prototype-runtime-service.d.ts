import type { ConceptPrototypeContract } from "../domain/live-concept-studio.js";
import type { PrototypeWorkspaceService } from "./prototype-workspace-service.js";

export interface PrototypeRuntimeRecord {
  sessionId: string;
  idempotencyKey: string;
  missionId: string;
  conceptId: string;
  conceptVersion: number;
  contractIntegrityHash: string;
  contentHash: string;
  status: "RUNNING" | "STOPPED" | "EXPIRED" | "STALE";
  previewUrl: string;
  port: number;
  startedAt: string;
  expiresAt: string;
  stoppedAt: string | null;
  stopReason: string | null;
}

export interface PrototypeRuntimeService {
  start(input: {
    conceptContract: ConceptPrototypeContract;
    sessionId: string;
    idempotencyKey: string;
    timeoutMs: number;
    expiresAt: string;
  }): Promise<PrototypeRuntimeRecord>;
  stop(input: { sessionId: string; reason: string }): Promise<PrototypeRuntimeRecord>;
  stopAll(input: { reason: string }): Promise<PrototypeRuntimeRecord[]>;
  get(sessionId: string): PrototypeRuntimeRecord;
}

export function createPrototypeRuntimeService(input: {
  workspaceService: PrototypeWorkspaceService;
}): PrototypeRuntimeService;
