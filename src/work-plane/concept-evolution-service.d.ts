import type { ConceptComposition, ConceptPrototypeContract } from "../domain/live-concept-studio.js";

export interface ConceptEvolutionService {
  revise(input: {
    sourceConcept: ConceptPrototypeContract;
    instruction: string;
    availableConcepts?: readonly ConceptPrototypeContract[];
    targetConceptVersion?: number;
  }): Readonly<{
    contract: ConceptPrototypeContract;
    classification: Readonly<{ scopes: readonly string[]; referencedConceptId: string | null }>;
    changedSummary: readonly string[];
  }>;
  compose(input: {
    missionId: string;
    compositionId: string;
    sourceConcepts: readonly ConceptPrototypeContract[];
    selectedTraits: readonly Readonly<{ trait: string; conceptId: string }>[];
    customerNotes?: readonly string[];
    conflictResolution?: readonly Readonly<{ trait: string; resolution: string }>[];
    targetConceptVersion?: number;
  }): Readonly<{
    status: "CONFLICT" | "READY";
    conflicts: readonly Readonly<{ trait: string; conceptIds: readonly string[]; reason: string; recommendation: string }>[];
    composition: ConceptComposition | null;
    contract: ConceptPrototypeContract | null;
  }>;
  shock(input: {
    sourceConcept: ConceptPrototypeContract;
    shockConceptId?: string;
    targetConceptVersion?: number;
  }): Readonly<{
    contract: ConceptPrototypeContract;
    classification: Readonly<{ scopes: readonly string[]; referencedConceptId: string }>;
  }>;
}

export function createConceptEvolutionService(): ConceptEvolutionService;
