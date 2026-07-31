import { ModelGatewayValidationError } from "../domain/errors.js";
import {
  LatencyProfile,
  ModelCapability,
  ModelStatus,
  TaskDepth,
  canonicalizeAiValue,
  classifyTaskDepth,
  cloneAiValue,
  isPlainObject,
} from "../domain/ai-registry.js";
import { ModelLifecycleState } from "../domain/model-governance.js";

export const RoutingPriority = Object.freeze({
  BALANCED: "BALANCED",
  LOW_COST: "LOW_COST",
  FAST_RESPONSE: "FAST_RESPONSE",
  CAPABILITY: "CAPABILITY",
});

const latencyRank = Object.freeze({
  [LatencyProfile.FAST]: 0,
  [LatencyProfile.BALANCED]: 1,
  [LatencyProfile.THOROUGH]: 2,
});

function normalizeRequiredCapabilities(value) {
  if (!Array.isArray(value)) {
    throw new ModelGatewayValidationError(
      "requiredCapabilities must be an array.",
    );
  }
  const seen = new Set();
  return cloneAiValue(
    value
      .map((entry) => {
        if (
          !isPlainObject(entry) ||
          Object.keys(entry).sort().join(",") !==
            "capability,minimumScore" ||
          !Object.values(ModelCapability).includes(entry.capability) ||
          !Number.isSafeInteger(entry.minimumScore) ||
          entry.minimumScore < 0 ||
          entry.minimumScore > 100
        ) {
          throw new ModelGatewayValidationError(
            "Each required capability must name a registered capability and an integer score from 0 through 100.",
          );
        }
        if (seen.has(entry.capability)) {
          throw new ModelGatewayValidationError(
            `Required capability "${entry.capability}" is duplicated.`,
          );
        }
        seen.add(entry.capability);
        return entry;
      })
      .sort((left, right) =>
        left.capability.localeCompare(right.capability),
      ),
  );
}

function normalizeCostConstraints(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).sort().join(",") !==
      "maximumTotalPerMillionTokensUsd"
  ) {
    throw new ModelGatewayValidationError(
      "costConstraints must define maximumTotalPerMillionTokensUsd.",
    );
  }
  if (
    value.maximumTotalPerMillionTokensUsd !== null &&
    (typeof value.maximumTotalPerMillionTokensUsd !== "number" ||
      !Number.isFinite(value.maximumTotalPerMillionTokensUsd) ||
      value.maximumTotalPerMillionTokensUsd < 0)
  ) {
    throw new ModelGatewayValidationError(
      "maximumTotalPerMillionTokensUsd must be null or non-negative.",
    );
  }
  return cloneAiValue(value);
}

function normalizePreferences(value) {
  if (
    !isPlainObject(value) ||
    Object.keys(value).sort().join(",") !==
      "preferredLatencyProfile,priority" ||
    !Object.values(RoutingPriority).includes(value.priority) ||
    (value.preferredLatencyProfile !== null &&
      !Object.values(LatencyProfile).includes(
        value.preferredLatencyProfile,
      ))
  ) {
    throw new ModelGatewayValidationError(
      "userPreferences must define a routing priority and optional latency profile.",
    );
  }
  return cloneAiValue(value);
}

function capabilityQuality(model, requirements, reasoningMinimum) {
  const values = requirements.map(
    (requirement) => model.capabilities[requirement.capability],
  );
  values.push(model.capabilities[ModelCapability.REASONING]);
  values.push(
    Math.min(
      100,
      model.capabilities[ModelCapability.REASONING] -
        reasoningMinimum +
        50,
    ),
  );
  return values.reduce((total, score) => total + score, 0) / values.length;
}

function compareCandidates(priority, preferredLatencyProfile) {
  return (left, right) => {
    const preferredLatencyDifference =
      preferredLatencyProfile === null
        ? 0
        : Number(right.model.latencyProfile === preferredLatencyProfile) -
          Number(left.model.latencyProfile === preferredLatencyProfile);
    if (preferredLatencyDifference !== 0) {
      return preferredLatencyDifference;
    }
    switch (priority) {
      case RoutingPriority.LOW_COST:
        return (
          left.totalCost - right.totalCost ||
          right.quality - left.quality ||
          latencyRank[left.model.latencyProfile] -
            latencyRank[right.model.latencyProfile] ||
          left.model.modelId.localeCompare(right.model.modelId)
        );
      case RoutingPriority.FAST_RESPONSE:
        return (
          latencyRank[left.model.latencyProfile] -
            latencyRank[right.model.latencyProfile] ||
          right.quality - left.quality ||
          left.totalCost - right.totalCost ||
          left.model.modelId.localeCompare(right.model.modelId)
        );
      case RoutingPriority.CAPABILITY:
        return (
          right.quality - left.quality ||
          left.totalCost - right.totalCost ||
          latencyRank[left.model.latencyProfile] -
            latencyRank[right.model.latencyProfile] ||
          left.model.modelId.localeCompare(right.model.modelId)
        );
      default:
        return (
          left.totalCost - right.totalCost ||
          right.quality - left.quality ||
          latencyRank[left.model.latencyProfile] -
            latencyRank[right.model.latencyProfile] ||
          left.model.modelId.localeCompare(right.model.modelId)
        );
    }
  };
}

export function createModelRouter({ registry, clock = () => new Date().toISOString() }) {
  if (
    registry === null ||
    typeof registry !== "object" ||
    registry.providers === undefined ||
    registry.models === undefined
  ) {
    throw new ModelGatewayValidationError(
      "Model Router requires the Provider and Model registries.",
    );
  }

  return Object.freeze({
    classifyTaskDepth,
    select({
      taskClass = null,
      taskDepth,
      requiredCapabilities,
      costConstraints,
      userPreferences,
    }) {
      if (
        !Number.isSafeInteger(taskDepth) ||
        taskDepth < TaskDepth.MECHANICAL ||
        taskDepth > TaskDepth.EXCEPTIONAL_REASONING
      ) {
        throw new ModelGatewayValidationError(
          "taskDepth must be an integer from 1 through 5.",
        );
      }
      const requirements = normalizeRequiredCapabilities(
        requiredCapabilities,
      );
      const costs = normalizeCostConstraints(costConstraints);
      const preferences = normalizePreferences(userPreferences);
      const reasoningMinimum = (taskDepth - 1) * 20;
      const requestedAlias =
        preferences.priority === RoutingPriority.FAST_RESPONSE
          ? "MODEL_FAST"
          : preferences.priority === RoutingPriority.CAPABILITY
            ? "MODEL_CAPABLE"
            : "MODEL_BALANCED";
      const rejections = [];
      const candidates = [];
      const providersById = new Map(
        registry.providers
          .list()
          .map((provider) => [provider.providerId, provider]),
      );

      for (const model of registry.models.list()) {
        const provider = providersById.get(model.providerId);
        if (provider === undefined) {
          throw new ModelGatewayValidationError(
            `Model "${model.modelId}" references an unregistered provider.`,
          );
        }
        const totalCost =
          model.costProfile.inputPerMillionTokensUsd +
          model.costProfile.outputPerMillionTokensUsd;
        const reasons = [];
        if (!provider.availability.available) {
          reasons.push("provider unavailable");
        }
        if (!model.enabled) {
          reasons.push("model disabled");
        }
        if (model.status !== ModelStatus.AVAILABLE) {
          reasons.push(`model status ${model.status}`);
        }
        if (
          model.governance !== undefined &&
          taskClass !== null &&
          !model.governance.allowedTaskClasses.includes(taskClass)
        ) {
          reasons.push(`task class ${taskClass} is not approved`);
        }
        if (
          model.governance !== undefined &&
          !model.governance.capabilityAliases.includes(requestedAlias)
        ) {
          reasons.push(`does not satisfy capability alias ${requestedAlias}`);
        }
        if (model.governance?.validation !== null && model.governance?.validation !== undefined) {
          const validation = model.governance.validation;
          if (validation.validationStatus !== "VALIDATED") {
            reasons.push(`validation status ${validation.validationStatus}`);
          }
          if (validation.registryState !== ModelLifecycleState.ACTIVE_STABLE) {
            reasons.push(`lifecycle state ${validation.registryState ?? ModelLifecycleState.UNVERIFIED}`);
          }
          if (
            Date.parse(validation.validatedAt) + validation.maximumValidationAgeMs <
            Date.parse(clock())
          ) {
            reasons.push("lifecycle validation is stale");
          }
          if (
            !Number.isFinite(Date.parse(validation.catalogObservedAt)) ||
            Date.parse(validation.catalogObservedAt) + validation.maximumCatalogAgeMs <
              Date.parse(clock())
          ) {
            reasons.push("provider catalog metadata is stale");
          }
        }
        if (
          costs.maximumTotalPerMillionTokensUsd !== null &&
          model.governance?.pricing?.known === false
        ) {
          reasons.push("cost is unknown");
        }
        if (
          model.capabilities[ModelCapability.REASONING] <
          reasoningMinimum
        ) {
          reasons.push(
            `reasoning score below depth ${taskDepth} minimum`,
          );
        }
        for (const requirement of requirements) {
          if (
            model.capabilities[requirement.capability] <
            requirement.minimumScore
          ) {
            reasons.push(
              `${requirement.capability} score below ${requirement.minimumScore}`,
            );
          }
        }
        if (
          costs.maximumTotalPerMillionTokensUsd !== null &&
          totalCost > costs.maximumTotalPerMillionTokensUsd
        ) {
          reasons.push("cost exceeds configured maximum");
        }
        if (reasons.length > 0) {
          rejections.push({ modelId: model.modelId, reasons });
          continue;
        }
        candidates.push({
          model,
          totalCost,
          quality: capabilityQuality(
            model,
            requirements,
            reasoningMinimum,
          ),
        });
      }

      candidates.sort(
        compareCandidates(
          preferences.priority,
          preferences.preferredLatencyProfile,
        ),
      );
      if (candidates.length === 0) {
        throw new ModelGatewayValidationError(
          `No registered model satisfies the routing request: ${canonicalizeAiValue(rejections)}.`,
        );
      }
      const selected = candidates[0];
      const selectedAlias = requestedAlias;
      return cloneAiValue({
        selectedModel: selected.model,
        taskDepth,
        requiredCapabilities: requirements,
        totalCostPerMillionTokensUsd: selected.totalCost,
        rationale: [
          "provider credential, enablement, and health are eligible",
          "model passed discovery, lifecycle validation, and engineering eligibility",
          ...(selected.model.governance?.eligibilityReasons ?? []),
          `resolved dynamic capability alias ${selectedAlias}`,
          `reasoning score satisfies task depth ${taskDepth}`,
          "all required capability thresholds are satisfied",
          "cost constraint is satisfied",
          `deterministic ${preferences.priority} ordering selected the first model`,
        ],
        eligibleModelIds: candidates.map(
          (candidate) => candidate.model.modelId,
        ),
        rejectedModels: rejections,
        selectedAlias,
      });
    },
  });
}

function validateJsonCompatible(value, label) {
  if (value === undefined || typeof value === "function") {
    throw new ModelGatewayValidationError(
      `${label} must be JSON-compatible.`,
    );
  }
  try {
    return cloneAiValue(value);
  } catch (error) {
    throw new ModelGatewayValidationError(
      `${label} must be JSON-compatible.`,
      { cause: error },
    );
  }
}

export function createPromptBuilder() {
  const orderedNames = Object.freeze([
    "system",
    "projectContext",
    "workspaceContext",
    "requirementContract",
    "codingStandards",
    "currentFiles",
    "acceptanceCriteria",
  ]);
  return Object.freeze({
    build(input) {
      if (
        !isPlainObject(input) ||
        Object.keys(input).sort().join(",") !==
          [...orderedNames].sort().join(",") ||
        typeof input.system !== "string" ||
        input.system.trim() === "" ||
        !Array.isArray(input.currentFiles) ||
        !Array.isArray(input.acceptanceCriteria)
      ) {
        throw new ModelGatewayValidationError(
          `Prompt Builder requires exactly: ${orderedNames.join(", ")}.`,
        );
      }
      return cloneAiValue({
        sections: orderedNames.map((name, index) => ({
          order: index + 1,
          name,
          content: validateJsonCompatible(input[name], `Prompt ${name}`),
        })),
      });
    },
  });
}

export function createContextBuilder() {
  const names = Object.freeze([
    "mission",
    "workspace",
    "stack",
    "contract",
    "relevantFiles",
  ]);
  return Object.freeze({
    assemble(input) {
      if (
        !isPlainObject(input) ||
        Object.keys(input).sort().join(",") !==
          [...names].sort().join(",") ||
        !isPlainObject(input.mission) ||
        !isPlainObject(input.workspace) ||
        !isPlainObject(input.stack) ||
        !isPlainObject(input.contract) ||
        !Array.isArray(input.relevantFiles)
      ) {
        throw new ModelGatewayValidationError(
          `Context Builder requires exactly: ${names.join(", ")}.`,
        );
      }
      return cloneAiValue({
        mission: validateJsonCompatible(input.mission, "mission context"),
        workspace: validateJsonCompatible(
          input.workspace,
          "workspace context",
        ),
        stack: validateJsonCompatible(input.stack, "stack context"),
        contract: validateJsonCompatible(
          input.contract,
          "contract context",
        ),
        relevantFiles: validateJsonCompatible(
          input.relevantFiles,
          "relevant files",
        ),
      });
    },
  });
}
