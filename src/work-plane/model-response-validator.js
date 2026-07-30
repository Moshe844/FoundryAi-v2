import {
  ModelOutputValidationError,
  ModelProviderError,
} from "../domain/errors.js";
import {
  assertStructuredSchema,
  cloneAiValue,
  isPlainObject,
} from "../domain/ai-registry.js";

function matchesType(value, type) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isSafeInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    case "null":
      return value === null;
    default:
      return false;
  }
}

function validateValue(value, schema, path) {
  if (!isPlainObject(schema) || typeof schema.type !== "string") {
    throw new ModelOutputValidationError(
      `Response schema at ${path} is malformed.`,
    );
  }
  if (!matchesType(value, schema.type)) {
    throw new ModelOutputValidationError(
      `Model response ${path} must be ${schema.type}.`,
    );
  }
  if (
    schema.type === "string" &&
    Number.isSafeInteger(schema.minLength) &&
    value.length < schema.minLength
  ) {
    throw new ModelOutputValidationError(
      `Model response ${path} must contain at least ${schema.minLength} characters.`,
    );
  }
  if (
    schema.type === "string" &&
    typeof schema.pattern === "string" &&
    !new RegExp(schema.pattern, "u").test(value)
  ) {
    throw new ModelOutputValidationError(
      `Model response ${path} does not match its required pattern.`,
    );
  }
  if (schema.type === "object") {
    const properties = schema.properties ?? {};
    const required = schema.required ?? [];
    for (const name of required) {
      if (!(name in value)) {
        throw new ModelOutputValidationError(
          `Model response is missing required property "${path}.${name}".`,
        );
      }
    }
    if (schema.additionalProperties === false) {
      const unexpected = Object.keys(value).find(
        (key) => !(key in properties),
      );
      if (unexpected !== undefined) {
        throw new ModelOutputValidationError(
          `Model response contains unexpected property "${path}.${unexpected}".`,
        );
      }
    }
    for (const [name, child] of Object.entries(value)) {
      if (properties[name] !== undefined) {
        validateValue(child, properties[name], `${path}.${name}`);
      }
    }
  }
  if (schema.type === "array" && schema.items !== undefined) {
    if (
      Number.isSafeInteger(schema.minItems) &&
      value.length < schema.minItems
    ) {
      throw new ModelOutputValidationError(
        `Model response ${path} must contain at least ${schema.minItems} items.`,
      );
    }
    value.forEach((item, index) =>
      validateValue(item, schema.items, `${path}[${index}]`),
    );
  }
}

export function validateModelResponse(response, schema) {
  let parsed = response;
  if (typeof response === "string") {
    if (response.trim() === "") {
      throw new ModelOutputValidationError(
        "Model response must not be empty.",
      );
    }
    try {
      parsed = JSON.parse(response);
    } catch (error) {
      throw new ModelOutputValidationError(
        "Model response is malformed JSON.",
        { cause: error },
      );
    }
  }
  if (
    parsed === null ||
    parsed === undefined ||
    (Array.isArray(parsed) && parsed.length === 0) ||
    (isPlainObject(parsed) && Object.keys(parsed).length === 0)
  ) {
    throw new ModelOutputValidationError(
      "Model response must not be empty.",
    );
  }
  const normalizedSchema = assertStructuredSchema(schema);
  validateValue(parsed, normalizedSchema, "$");
  return cloneAiValue(parsed);
}

export function normalizeProviderError(error, providerId) {
  const status = Number(error?.status ?? error?.statusCode);
  let category = "PROVIDER_FAILURE";
  let retryable = false;
  if (status === 401 || status === 403) {
    category = "AUTHENTICATION";
  } else if (status === 429) {
    category = "RATE_LIMIT";
    retryable = true;
  } else if (status >= 500 && status <= 599) {
    category = "PROVIDER_UNAVAILABLE";
    retryable = true;
  } else if (
    error?.code === "ETIMEDOUT" ||
    error?.code === "ECONNRESET"
  ) {
    category = "NETWORK";
    retryable = true;
  }
  const normalized = {
    providerId,
    category,
    code:
      typeof error?.code === "string"
        ? error.code
        : Number.isFinite(status)
          ? String(status)
          : "UNKNOWN",
    retryable,
    message: `Provider "${providerId}" request failed (${category}).`,
  };
  return cloneAiValue(normalized);
}

export function asModelProviderError(error, providerId) {
  const normalized = normalizeProviderError(error, providerId);
  return new ModelProviderError(normalized.message, {
    cause: error,
  });
}

export function createModelResponseValidator() {
  return Object.freeze({
    validate: validateModelResponse,
    normalizeProviderError,
  });
}
