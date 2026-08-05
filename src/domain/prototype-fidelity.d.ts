import type { ApprovedDesignContract } from "./live-concept-studio.js";

export interface PrototypeFidelityVerdict {
  aspect: string;
  verdict: "PASS" | "FAIL";
  summary: string;
  detail: Readonly<Record<string, unknown>>;
}

export interface PrototypeFidelityResult {
  schemaVersion: 1;
  approvedDesignId: string;
  approvedPrototypeContentHash: string;
  comparedViewports: readonly string[];
  missingViewports: readonly string[];
  verdicts: readonly PrototypeFidelityVerdict[];
  failedAspects: readonly string[];
  passed: boolean;
  integrityHash: string;
}

export function evaluatePrototypeFidelity(input: {
  approvedDesignContract: ApprovedDesignContract;
  prototypeVerification: Readonly<Record<string, unknown>>;
  productionBrowserResult: Readonly<Record<string, unknown>>;
}): PrototypeFidelityResult;
