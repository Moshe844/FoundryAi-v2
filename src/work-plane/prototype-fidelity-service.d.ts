import type { ApprovedDesignContract } from "../domain/live-concept-studio.js";
import type { PrototypeFidelityResult } from "../domain/prototype-fidelity.js";

export interface PrototypeFidelityServiceResult extends PrototypeFidelityResult {
  productionObservations: readonly Readonly<Record<string, unknown>>[];
  productionScreenshotManifest: readonly Readonly<{ name: string; contentHash: string; size: number }>[];
  prototypeScreenshotReferences: readonly string[];
}

export function createPrototypeFidelityService(input: {
  workspaceService: Readonly<Record<string, unknown>>;
  browserVerifier: Readonly<Record<string, unknown>>;
}): Readonly<{
  verify(input: {
    approvedDesignContract: ApprovedDesignContract;
    productionPreviewUrl: string;
  }): Promise<PrototypeFidelityServiceResult>;
}>;
