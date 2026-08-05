import type { ConceptPrototypeContract } from "../domain/live-concept-studio.js";
import type { PrototypeWorkspaceService, PrototypeWorkspaceView } from "./prototype-workspace-service.js";

export const CONCEPT_GENERATION_OUTPUT_SCHEMA: Readonly<Record<string, unknown>>;

export interface PrototypeGenerationResult {
  conceptContract: ConceptPrototypeContract;
  workspace: PrototypeWorkspaceView;
  generationSummary: string;
  cached: boolean;
  usage: Readonly<{ inputTokens: number; outputTokens: number; costUsd: number }>;
  requestId: string | null;
}

export function createPrototypeGenerationService(input: {
  modelGateway: { request(input: Record<string, unknown>): Promise<Record<string, any>> };
  workspaceService: PrototypeWorkspaceService;
}): {
  generate(input: {
    conceptContract: ConceptPrototypeContract;
    admissionFeedback?: readonly string[];
  }): Promise<PrototypeGenerationResult>;
};
