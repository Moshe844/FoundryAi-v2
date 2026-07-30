import {
  normalizeProjectProfile,
  projectProfileExperience,
} from "../domain/project-profile.js";

export function createProjectProfileService() {
  return Object.freeze({
    create(input) {
      return normalizeProjectProfile(input);
    },

    experience(profile) {
      return projectProfileExperience(profile);
    },

    contractDraft(profileInput) {
      const profile = normalizeProjectProfile(profileInput);
      return Object.freeze({
        contractVersion: profile.requirementContractVersion,
        obligations: Object.freeze(
          profile.verificationPlan.checks.map((check) =>
            Object.freeze({
              obligationId: check.checkId,
              statement: check.label,
              origin: check.origin,
              acceptanceCondition: structuredClone(
                check.acceptanceCondition,
              ),
              requiredEvidenceKinds: Object.freeze([
                ...check.evidenceKinds,
              ]),
              dependencyObligationIds: Object.freeze([
                ...check.dependencyCheckIds,
              ]),
              contractVersion: profile.requirementContractVersion,
            }),
          ),
        ),
      });
    },
  });
}
