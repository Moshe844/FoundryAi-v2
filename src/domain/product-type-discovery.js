import { WEB_STACK_MANIFEST } from "./toolchain-stack.js";

// Provider-facing schemas allow a little drafting room. The canonical
// normalizer below applies Foundry's tighter customer-facing bounds.
const TEXT = Object.freeze({ type: "string", minLength: 8, maxLength: 800 });
const SHORT_TEXT = Object.freeze({ type: "string", minLength: 3, maxLength: 180 });

export const PRODUCT_TYPE_DISCOVERY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["interpretation", "subtypes"],
  properties: {
    interpretation: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "reasoning", "confidence"],
      properties: {
        summary: TEXT,
        reasoning: TEXT,
        confidence: { type: "number" },
      },
    },
    subtypes: {
      type: "array",
      minItems: 5,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "explanation",
          "likelyUsers",
          "likelyPrimaryOutcome",
          "whyItMayFit",
          "confidence",
          "recommended",
          "canCombine",
          "combinationNote",
          "compatibilityTags",
          "deliveryPlatform",
          "requiredCapabilities",
        ],
        properties: {
          title: SHORT_TEXT,
          explanation: TEXT,
          likelyUsers: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: SHORT_TEXT,
          },
          likelyPrimaryOutcome: TEXT,
          whyItMayFit: TEXT,
          confidence: { type: "number" },
          recommended: { type: "boolean" },
          canCombine: { type: "boolean" },
          combinationNote: TEXT,
          compatibilityTags: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: { type: "string", minLength: 3, maxLength: 90 },
          },
          deliveryPlatform: { type: "string", enum: ["web"] },
          requiredCapabilities: {
            type: "array",
            minItems: 1,
            maxItems: WEB_STACK_MANIFEST.supportedCapabilities.length,
            items: {
              type: "string",
              enum: WEB_STACK_MANIFEST.supportedCapabilities,
            },
          },
        },
      },
    },
  },
});

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "be", "by", "for", "from", "in",
  "is", "it", "of", "on", "or", "that", "the", "their", "this", "to",
  "with", "your", "you", "users", "user", "people", "system", "tool",
]);

function words(value) {
  return new Set(
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, " ")
      .split(/\s+/u)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      .map((word) => word.replace(/(?:ing|ed|es|s)$/u, "")),
  );
}

function overlap(left, right) {
  let count = 0;
  for (const word of left) if (right.has(word)) count += 1;
  return count;
}

function jaccard(left, right) {
  const intersection = overlap(left, right);
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function assertText(value, label, minimum = 8, maximum = 240) {
  if (typeof value !== "string" || value.trim().length < minimum) {
    throw new TypeError(`${label} must contain ${minimum}-${maximum} characters.`);
  }
  const normalized = value.trim();
  if (normalized.length <= maximum) return normalized;
  const wordBounded = normalized
    .slice(0, maximum)
    .replace(/\s+\S*$/u, "")
    .trim();
  return wordBounded.length >= minimum
    ? wordBounded
    : normalized.slice(0, maximum);
}

function freeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function subtypeText(subtype) {
  return [
    subtype.title,
    subtype.explanation,
    ...subtype.likelyUsers,
    subtype.likelyPrimaryOutcome,
    subtype.whyItMayFit,
    subtype.confidence.reason,
  ].join(" ");
}

export function shouldDiscoverProductType(intent, answers = []) {
  if (typeof intent !== "string" || intent.trim() === "") return false;
  if (
    answers.some(
      (answer) => answer?.selection?.kind === "product-subtype",
    )
  ) return false;
  const meaningful = intent
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(
      (word) =>
        word !== "" &&
        !new Set([
          "a", "an", "the", "build", "create", "make", "need", "want",
          "please",
        ]).has(word),
    );
  const beginsWithCreationVerb = /^\s*(?:build|create|make|need|want)\b/iu.test(intent);
  return meaningful.length <= (beginsWithCreationVerb ? 1 : 2);
}

export function productTypeDiscoveryPrompt({ intent, context = [] }) {
  return [
    "Interpret one broad customer request before Foundry designs the product. Return strict JSON only.",
    "Generate exactly 6 likely, genuinely different product subtypes from the customer's exact wording and supplied context. Do not use or imitate a stored category list. Reason from this request now.",
    "Every subtype needs a customer-friendly title, concise explanation, concrete likely users, one primary outcome, project-specific fit reasoning, calibrated confidence, combination guidance, and required certified capabilities. compatibilityTags are short model-generated workflow or operating-context labels; two choices may combine only when they share at least one tag.",
    "Make the choices distinct in users, operating context, workflow, or outcome. Renaming the same product with different nouns is invalid. Do not repeat alternatives that could be swapped without changing the product.",
    "Mark exactly one option recommended. Recommend the most defensible interpretation, not merely the first option. Lower confidence when the request supplies little evidence.",
    "All options must be deliverable as web products within the certified Foundry boundary. Do not promise native mobile, desktop, game, hardware, real-time multi-instance infrastructure, paid services, or integrations that the customer did not request.",
    `Use only these capability identifiers: ${WEB_STACK_MANIFEST.supportedCapabilities.join(", ")}.`,
    `Certified limitations: ${WEB_STACK_MANIFEST.knownLimitations.join(" ")}`,
    "Use plain customer language. A subtype title is a product idea, not a technology or implementation choice.",
    `Customer request: ${intent.trim()}`,
    context.length === 0
      ? "No additional project context is available."
      : `Additional customer and project context: ${JSON.stringify(context)}`,
  ].join("\n\n");
}

export function normalizeProductTypeDiscovery(candidate, { intent, context = [] }) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new TypeError("Product-type discovery must be an object.");
  }
  const interpretation = candidate.interpretation;
  if (interpretation === null || typeof interpretation !== "object") {
    throw new TypeError("Product-type discovery needs an interpretation.");
  }
  if (
    typeof interpretation.confidence !== "number" ||
    interpretation.confidence < 0 ||
    interpretation.confidence > 1
  ) {
    throw new TypeError("Product-type interpretation confidence must be between 0 and 1.");
  }
  if (!Array.isArray(candidate.subtypes) || candidate.subtypes.length < 5 || candidate.subtypes.length > 10) {
    throw new TypeError("Product-type discovery must contain 5-10 subtype choices.");
  }
  const supported = new Set(WEB_STACK_MANIFEST.supportedCapabilities);
  const subtypes = candidate.subtypes.map((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`Subtype ${index + 1} must be an object.`);
    }
    if (!Array.isArray(item.likelyUsers) || item.likelyUsers.length < 1 || item.likelyUsers.length > 4) {
      throw new TypeError(`Subtype ${index + 1} needs 1-4 likely users.`);
    }
    if (!Array.isArray(item.requiredCapabilities) || item.requiredCapabilities.length < 1) {
      throw new TypeError(`Subtype ${index + 1} needs certified capabilities.`);
    }
    if (
      !Array.isArray(item.compatibilityTags) ||
      item.compatibilityTags.length < 1 ||
      item.compatibilityTags.length > 4
    ) {
      throw new TypeError(`Subtype ${index + 1} needs 1-4 compatibility tags.`);
    }
    const requiredCapabilities = [...new Set(item.requiredCapabilities)];
    if (requiredCapabilities.some((capability) => !supported.has(capability))) {
      throw new TypeError(`Subtype ${index + 1} promises an unsupported Foundry capability.`);
    }
    if (item.deliveryPlatform !== "web") {
      throw new TypeError(`Subtype ${index + 1} is outside Foundry's certified web platform.`);
    }
    const confidenceScore =
      typeof item.confidence === "number"
        ? item.confidence
        : item.confidence?.score;
    if (
      typeof confidenceScore !== "number" ||
      confidenceScore < 0 ||
      confidenceScore > 1
    ) {
      throw new TypeError(`Subtype ${index + 1} has invalid confidence.`);
    }
    if (typeof item.recommended !== "boolean" || typeof item.canCombine !== "boolean") {
      throw new TypeError(`Subtype ${index + 1} needs recommendation and combination status.`);
    }
    return {
      optionId: `subtype-${index + 1}`,
      title: assertText(item.title, `Subtype ${index + 1} title`, 3, 90),
      explanation: assertText(item.explanation, `Subtype ${index + 1} explanation`),
      likelyUsers: item.likelyUsers.map((user, userIndex) =>
        assertText(user, `Subtype ${index + 1} user ${userIndex + 1}`, 3, 90),
      ),
      likelyPrimaryOutcome: assertText(item.likelyPrimaryOutcome, `Subtype ${index + 1} outcome`),
      whyItMayFit: assertText(item.whyItMayFit, `Subtype ${index + 1} fit`),
      confidence: {
        score: confidenceScore,
        reason:
          typeof item.confidence?.reason === "string"
            ? assertText(item.confidence.reason, `Subtype ${index + 1} confidence reason`)
            : assertText(item.whyItMayFit, `Subtype ${index + 1} confidence reason`),
      },
      recommended: item.recommended,
      canCombine: item.canCombine,
      combinationNote: assertText(item.combinationNote, `Subtype ${index + 1} combination note`),
      compatibilityTags: [...new Set(
        item.compatibilityTags.map((tag) =>
          assertText(tag, `Subtype ${index + 1} compatibility tag`, 3, 40).toLowerCase(),
        ),
      )],
      deliveryPlatform: "web",
      requiredCapabilities,
    };
  });
  const discovery = {
    schemaVersion: 1,
    originalRequest: intent.trim(),
    context: context.map((entry) => String(entry).trim()).filter(Boolean),
    interpretation: {
      summary: assertText(interpretation.summary, "Interpretation summary"),
      reasoning: assertText(interpretation.reasoning, "Interpretation reasoning"),
      confidence: interpretation.confidence,
    },
    subtypes,
  };
  validateProductTypeDiscoveryQuality(discovery);
  return freeze(discovery);
}

export function validateProductTypeDiscoveryQuality(discovery) {
  const requestWords = words([discovery.originalRequest, ...discovery.context].join(" "));
  const recommended = discovery.subtypes.filter((subtype) => subtype.recommended);
  if (recommended.length !== 1) {
    throw new TypeError("Product-type discovery must recommend exactly one subtype.");
  }
  const signatures = new Set();
  const outcomeSignatures = new Set();
  for (const subtype of discovery.subtypes) {
    const text = subtypeText(subtype);
    const signature = [...words(text)].sort().join(" ");
    if (signatures.has(signature)) {
      throw new TypeError("Product subtype choices contain a repeated interpretation.");
    }
    signatures.add(signature);
    outcomeSignatures.add([...words(subtype.likelyPrimaryOutcome)].sort().join(" "));
    // A one-word broad request frequently has legitimate model-generated
    // synonyms. Multi-word requests still require direct lexical grounding
    // in every proposed subtype.
    if (requestWords.size > 1 && overlap(requestWords, words(text)) === 0) {
      throw new TypeError(`Product subtype "${subtype.title}" is not grounded in the broad request.`);
    }
    const unsupportedPromise = text.match(
      /\b(?:native mobile|native desktop|sms delivery|payment processing|bluetooth hardware|real-time multi-instance)\b/iu,
    );
    const promiseContext = unsupportedPromise === null
      ? ""
      : text.slice(
          Math.max(0, unsupportedPromise.index - 36),
          unsupportedPromise.index,
        );
    const explicitlyNegated =
      /\b(?:without|avoid(?:s|ing)?|instead of|does not|do not|no)\b[^.]{0,30}$/iu.test(
        promiseContext,
      );
    if (unsupportedPromise !== null && !explicitlyNegated) {
      throw new TypeError(
        `Product subtype "${subtype.title}" promises unsupported capability "${unsupportedPromise[0]}".`,
      );
    }
  }
  if (outcomeSignatures.size < Math.ceil(discovery.subtypes.length * 0.6)) {
    throw new TypeError("Product subtype outcomes are mostly noun substitutions.");
  }
  for (let left = 0; left < discovery.subtypes.length; left += 1) {
    for (let right = left + 1; right < discovery.subtypes.length; right += 1) {
      const leftWords = words(subtypeText(discovery.subtypes[left]));
      const rightWords = words(subtypeText(discovery.subtypes[right]));
      if (jaccard(leftWords, rightWords) > 0.72) {
        throw new TypeError(
          `Product subtypes "${discovery.subtypes[left].title}" and "${discovery.subtypes[right].title}" are not meaningfully distinct.`,
        );
      }
    }
  }
  return freeze({
    specificity: 1,
    completeness: 1,
    usefulness: 1,
    differentiation: 1,
    feasibility: 1,
    clarity: 1,
  });
}

export function validateDiscoveryPortfolioDifferentiation(discoveries) {
  if (!Array.isArray(discoveries) || discoveries.length < 2) {
    throw new TypeError("Portfolio differentiation needs at least two discoveries.");
  }
  for (let left = 0; left < discoveries.length; left += 1) {
    validateProductTypeDiscoveryQuality(discoveries[left]);
    for (let right = left + 1; right < discoveries.length; right += 1) {
      const leftRequest = words(discoveries[left].originalRequest);
      const rightRequest = words(discoveries[right].originalRequest);
      if (jaccard(leftRequest, rightRequest) > 0.5) continue;
      const leftTitles = new Set(
        discoveries[left].subtypes.map((subtype) => subtype.title.toLowerCase()),
      );
      const repeatedTitles = discoveries[right].subtypes.filter((subtype) =>
        leftTitles.has(subtype.title.toLowerCase()),
      ).length;
      const leftContent = words(
        discoveries[left].subtypes.map(subtypeText).join(" "),
      );
      const rightContent = words(
        discoveries[right].subtypes.map(subtypeText).join(" "),
      );
      if (
        repeatedTitles >= Math.ceil(discoveries[right].subtypes.length / 2) ||
        jaccard(leftContent, rightContent) > 0.78
      ) {
        throw new TypeError(
          `Product subtype choices for "${discoveries[left].originalRequest}" and "${discoveries[right].originalRequest}" appear copied or noun-substituted.`,
        );
      }
    }
  }
  return true;
}
