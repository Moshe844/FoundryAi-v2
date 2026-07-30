import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { ModelGatewayValidationError } from "../domain/errors.js";
import {
  AI_REGISTRY_SCHEMA_VERSION,
  RegistryOperation,
  assertAiIdentifier,
  canonicalizeAiValue,
  cloneAiValue,
  hashAiValue,
  normalizeModelManifest,
  normalizeProviderHealth,
  normalizeProviderMetadata,
} from "../domain/ai-registry.js";

const operations = new Set(Object.values(RegistryOperation));
const recordKeys = Object.freeze([
  "schemaVersion",
  "sequence",
  "eventId",
  "operation",
  "occurredAt",
  "payload",
  "previousHash",
  "hash",
]);

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function assertTimestamp(value, label = "occurredAt") {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new ModelGatewayValidationError(
      `${label} must be a canonical ISO timestamp.`,
    );
  }
}

function project(records) {
  const providers = new Map();
  const models = new Map();
  const discoveries = new Set();

  for (const record of records) {
    switch (record.operation) {
      case RegistryOperation.PROVIDER_REGISTERED: {
        const metadata = normalizeProviderMetadata(record.payload);
        if (providers.has(metadata.providerId)) {
          throw new ModelGatewayValidationError(
            `Provider "${metadata.providerId}" is already registered.`,
          );
        }
        providers.set(metadata.providerId, {
          ...metadata,
          registeredAt: record.occurredAt,
          registrationEventId: record.eventId,
          health: "UNKNOWN",
          healthDetail: "No health observation has been recorded.",
          healthObservedAt: null,
          history: [
            {
              eventId: record.eventId,
              operation: record.operation,
              occurredAt: record.occurredAt,
            },
          ],
        });
        break;
      }
      case RegistryOperation.PROVIDER_ENABLED_CHANGED: {
        const payload = record.payload;
        if (
          !exactKeys(payload, ["providerId", "enabled", "reason"]) ||
          typeof payload.enabled !== "boolean" ||
          typeof payload.reason !== "string" ||
          payload.reason.trim() === ""
        ) {
          throw new ModelGatewayValidationError(
            "Provider enablement event is malformed.",
          );
        }
        assertAiIdentifier(payload.providerId, "providerId");
        const provider = providers.get(payload.providerId);
        if (provider === undefined) {
          throw new ModelGatewayValidationError(
            `Provider "${payload.providerId}" is not registered.`,
          );
        }
        if (provider.enabled === payload.enabled) {
          throw new ModelGatewayValidationError(
            "Provider enablement event must change the current state.",
          );
        }
        provider.enabled = payload.enabled;
        provider.history.push({
          eventId: record.eventId,
          operation: record.operation,
          occurredAt: record.occurredAt,
          reason: payload.reason.trim(),
          enabled: payload.enabled,
        });
        break;
      }
      case RegistryOperation.PROVIDER_HEALTH_RECORDED: {
        const payload = record.payload;
        if (!exactKeys(payload, ["providerId", "observation"])) {
          throw new ModelGatewayValidationError(
            "Provider health event is malformed.",
          );
        }
        assertAiIdentifier(payload.providerId, "providerId");
        const provider = providers.get(payload.providerId);
        if (provider === undefined) {
          throw new ModelGatewayValidationError(
            `Provider "${payload.providerId}" is not registered.`,
          );
        }
        const observation = normalizeProviderHealth(payload.observation);
        provider.health = observation.health;
        provider.healthDetail = observation.detail;
        provider.healthObservedAt = record.occurredAt;
        provider.history.push({
          eventId: record.eventId,
          operation: record.operation,
          occurredAt: record.occurredAt,
          ...observation,
        });
        break;
      }
      case RegistryOperation.MODELS_DISCOVERED: {
        const payload = record.payload;
        if (
          !exactKeys(payload, ["discoveryId", "providerId", "models"]) ||
          !Array.isArray(payload.models)
        ) {
          throw new ModelGatewayValidationError(
            "Model discovery event is malformed.",
          );
        }
        assertAiIdentifier(payload.discoveryId, "discoveryId");
        assertAiIdentifier(payload.providerId, "providerId");
        if (!providers.has(payload.providerId)) {
          throw new ModelGatewayValidationError(
            `Provider "${payload.providerId}" is not registered.`,
          );
        }
        if (discoveries.has(payload.discoveryId)) {
          throw new ModelGatewayValidationError(
            `Model discovery "${payload.discoveryId}" is duplicated.`,
          );
        }
        discoveries.add(payload.discoveryId);
        for (const candidate of payload.models) {
          const model = normalizeModelManifest(candidate);
          if (model.providerId !== payload.providerId) {
            throw new ModelGatewayValidationError(
              `Model "${model.modelId}" belongs to another provider.`,
            );
          }
          if (models.has(model.modelId)) {
            throw new ModelGatewayValidationError(
              `Model "${model.modelId}" is already registered.`,
            );
          }
          models.set(model.modelId, {
            ...model,
            discoveryId: payload.discoveryId,
            discoveredAt: record.occurredAt,
            discoveryEventId: record.eventId,
          });
        }
        break;
      }
      case RegistryOperation.MODEL_CATALOG_REFRESHED: {
        const payload = record.payload;
        if (
          !exactKeys(payload, ["discoveryId", "providerId", "models"]) ||
          !Array.isArray(payload.models)
        ) {
          throw new ModelGatewayValidationError(
            "Model catalog refresh event is malformed.",
          );
        }
        assertAiIdentifier(payload.discoveryId, "discoveryId");
        assertAiIdentifier(payload.providerId, "providerId");
        if (!providers.has(payload.providerId)) {
          throw new ModelGatewayValidationError(
            `Provider "${payload.providerId}" is not registered.`,
          );
        }
        if (discoveries.has(payload.discoveryId)) {
          throw new ModelGatewayValidationError(
            `Model discovery "${payload.discoveryId}" is duplicated.`,
          );
        }
        discoveries.add(payload.discoveryId);
        for (const [modelId, model] of models) {
          if (model.providerId === payload.providerId) models.delete(modelId);
        }
        for (const candidate of payload.models) {
          const model = normalizeModelManifest(candidate);
          if (model.providerId !== payload.providerId) {
            throw new ModelGatewayValidationError(
              `Model "${model.modelId}" belongs to another provider.`,
            );
          }
          if (models.has(model.modelId)) {
            throw new ModelGatewayValidationError(
              `Model "${model.modelId}" conflicts with another provider.`,
            );
          }
          models.set(model.modelId, {
            ...model,
            discoveryId: payload.discoveryId,
            discoveredAt: record.occurredAt,
            discoveryEventId: record.eventId,
          });
        }
        break;
      }
      default:
        throw new ModelGatewayValidationError(
          `AI registry operation "${record.operation}" is unsupported.`,
        );
    }
  }

  return {
    providers: new Map(
      [...providers].map(([key, value]) => [key, cloneAiValue(value)]),
    ),
    models: new Map(
      [...models].map(([key, value]) => [key, cloneAiValue(value)]),
    ),
  };
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function createAiRegistryStore({ registryDirectory, clock }) {
  if (
    typeof registryDirectory !== "string" ||
    registryDirectory.length === 0 ||
    typeof clock !== "function"
  ) {
    throw new ModelGatewayValidationError(
      "AI registry store requires a directory and clock.",
    );
  }
  const root = resolve(registryDirectory);
  const path = resolve(root, "ai-registry-events.jsonl");
  const lockPath = `${path}.lock`;

  function readRecords() {
    if (!existsSync(path)) {
      return [];
    }
    const text = readFileSync(path, "utf8");
    if (!text.endsWith("\n")) {
      throw new ModelGatewayValidationError(
        "AI registry log has an incomplete final record.",
      );
    }
    let records;
    try {
      records = text
        .slice(0, -1)
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line));
    } catch (error) {
      throw new ModelGatewayValidationError(
        "AI registry log is not valid JSON Lines.",
        { cause: error },
      );
    }
    let previousHash = null;
    let previousTimestamp = null;
    const eventIds = new Set();
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (
        !exactKeys(record, recordKeys) ||
        record.schemaVersion !== AI_REGISTRY_SCHEMA_VERSION ||
        record.sequence !== index + 1 ||
        !operations.has(record.operation)
      ) {
        throw new ModelGatewayValidationError(
          `AI registry record ${index + 1} has invalid attribution.`,
        );
      }
      assertAiIdentifier(record.eventId, "AI registry eventId");
      assertTimestamp(record.occurredAt);
      if (eventIds.has(record.eventId)) {
        throw new ModelGatewayValidationError(
          `AI registry event "${record.eventId}" is duplicated.`,
        );
      }
      if (
        previousTimestamp !== null &&
        Date.parse(record.occurredAt) < Date.parse(previousTimestamp)
      ) {
        throw new ModelGatewayValidationError(
          "AI registry timestamps are not monotonic.",
        );
      }
      if (record.previousHash !== previousHash) {
        throw new ModelGatewayValidationError(
          "AI registry hash chain is broken.",
        );
      }
      const { hash, ...withoutHash } = record;
      if (hash !== hashAiValue(withoutHash)) {
        throw new ModelGatewayValidationError(
          `AI registry record ${index + 1} failed integrity validation.`,
        );
      }
      eventIds.add(record.eventId);
      previousHash = hash;
      previousTimestamp = record.occurredAt;
    }
    project(records);
    return records;
  }

  function acquireLock() {
    mkdirSync(root, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = openSync(lockPath, "wx");
        try {
          writeFileSync(descriptor, String(process.pid), "utf8");
          fsyncSync(descriptor);
        } finally {
          closeSync(descriptor);
        }
        return;
      } catch (error) {
        if (error?.code !== "EEXIST" || attempt > 0) {
          throw error;
        }
        let pid = null;
        try {
          pid = Number(readFileSync(lockPath, "utf8"));
        } catch {
          pid = null;
        }
        if (processIsAlive(pid)) {
          throw new ModelGatewayValidationError(
            "AI registry is currently being appended.",
          );
        }
        unlinkSync(lockPath);
      }
    }
  }

  function append({ eventId, operation, occurredAt = clock(), payload }) {
    assertAiIdentifier(eventId, "AI registry eventId");
    assertTimestamp(occurredAt);
    if (!operations.has(operation)) {
      throw new ModelGatewayValidationError(
        "AI registry operation is invalid.",
      );
    }
    acquireLock();
    try {
      const records = readRecords();
      if (records.some((record) => record.eventId === eventId)) {
        throw new ModelGatewayValidationError(
          `AI registry event "${eventId}" is duplicated.`,
        );
      }
      if (
        records.length > 0 &&
        Date.parse(occurredAt) < Date.parse(records.at(-1).occurredAt)
      ) {
        throw new ModelGatewayValidationError(
          "AI registry append is chronologically stale.",
        );
      }
      const withoutHash = {
        schemaVersion: AI_REGISTRY_SCHEMA_VERSION,
        sequence: records.length + 1,
        eventId,
        operation,
        occurredAt,
        payload: cloneAiValue(payload),
        previousHash: records.at(-1)?.hash ?? null,
      };
      const record = {
        ...withoutHash,
        hash: hashAiValue(withoutHash),
      };
      project([...records, record]);
      const descriptor = openSync(path, "a");
      try {
        appendFileSync(descriptor, `${JSON.stringify(record)}\n`, "utf8");
        fsyncSync(descriptor);
      } finally {
        closeSync(descriptor);
      }
      return cloneAiValue(record);
    } finally {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    }
  }

  return Object.freeze({
    append,
    listEvents() {
      return cloneAiValue(readRecords());
    },
    projection() {
      return project(readRecords());
    },
    path,
  });
}
