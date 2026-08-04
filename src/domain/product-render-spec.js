/**
 * A deterministic, domain-independent description of the customer-facing
 * product.  Visual Direction and production generation consume this same
 * screen graph; visual styling is deliberately a second concern.
 */

const SPEC_VERSION = "1.0.0";

const AUTH_PATTERN = /\b(?:sign[\s-]?in|log[\s-]?in|auth(?:enticate|entication)?|password|credentials?|account access)\b/iu;
const REGISTER_PATTERN = /\b(?:sign[\s-]?up|register|registration|create (?:an )?account|join)\b/iu;

const SCREEN_RULES = Object.freeze([
  { kind: "technical", pattern: /\b(?:api|endpoint|request|response|webhook|developer|sdk|token|integration)\b/iu, label: "API workspace", action: "Try a request" },
  { kind: "conversation", pattern: /\b(?:message|conversation|chat|inbox|support|comment)\b/iu, label: "Conversations", action: "Start a conversation" },
  { kind: "calendar", pattern: /\b(?:calendar|schedule|appointment|class|session|event|booking|reservation)\b/iu, label: "Schedule", action: "View availability" },
  { kind: "map", pattern: /\b(?:map|location|place|venue|route|nearby)\b/iu, label: "Explore", action: "Explore locations" },
  { kind: "catalog", pattern: /\b(?:browse|discover|search|catalog|collection|products?|classes|listings?|library|menu)\b/iu, label: "Browse", action: "Explore" },
  { kind: "records", pattern: /\b(?:history|bookings?|orders?|purchases?|applications?|records?|save(?:d)?|shortlists?|recent|activity)\b/iu, label: "My activity", action: "View details" },
  { kind: "content", pattern: /\b(?:portfolio|projects?|case stud|gallery|articles?|stories|content|work)\b/iu, label: "Selected work", action: "Open story" },
  { kind: "form", pattern: /\b(?:form|intake|submit|apply|upload|create|add|edit|configure|onboard|inquir(?:y|ies)|contact|send)\b/iu, label: "Details", action: "Continue" },
  { kind: "detail", pattern: /\b(?:detail|profile|item|product|class|listing|article|project)\b/iu, label: "Details", action: "Continue" },
  { kind: "overview", pattern: /\b(?:dashboard|overview|admin|manage|monitor|operations?|workspace|summary)\b/iu, label: "Overview", action: "Open workspace" },
]);

function text(value, fallback = "") {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hash(value) {
  const source = JSON.stringify(value);
  let result = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `prs-${(result >>> 0).toString(16).padStart(8, "0")}`;
}

function slug(value) {
  return text(value, "screen")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 42) || "screen";
}

function sentence(value) {
  const normalized = text(value);
  if (!normalized) return "";
  return /[.!?]$/u.test(normalized) ? normalized : `${normalized}.`;
}

function titleFromStatement(statement, fallback) {
  const normalized = text(statement)
    .replace(/^(?:users?|customers?|members?|admins?|visitors?|people)\s+(?:can|should|must|will|need to)\s+/iu, "")
    .replace(/^(?:allow|enable|help|let)\s+(?:users?|customers?|members?|admins?|visitors?|people)\s+(?:to\s+)?/iu, "")
    .replace(/^(?:the\s+)?(?:product|application|app|website|site|system)\s+(?:should|must|will|can)\s+/iu, "")
    .replace(/^(?:to\s+)/iu, "")
    .split(/[.;:]/u)[0]
    .trim();
  if (!normalized) return fallback;
  const concise = normalized.length <= 54
    ? normalized
    : normalized
      .split(/,|\s+(?:and|then)\s+/iu)
      .map((value) => value.trim())
      .find((value) => value.length >= 3 && value.length <= 54);
  const title = concise || fallback;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function actionFromStatement(statement, fallback) {
  // Actions must come from the approved workflow, even when the full workflow
  // is too long to use as a screen title. Going through titleFromStatement()
  // used to replace long workflows with a rule fallback such as "Explore" or
  // "Continue", which then became an invented, exact-match build requirement.
  const normalized = text(statement)
    .replace(/^(?:users?|customers?|members?|admins?|visitors?|people)\s+(?:can|should|must|will|need to)\s+/iu, "")
    .replace(/^(?:allow|enable|help|let)\s+(?:users?|customers?|members?|admins?|visitors?|people)\s+(?:to\s+)?/iu, "")
    .replace(/^(?:the\s+)?(?:product|application|app|website|site|system)\s+(?:should|must|will|can)\s+/iu, "")
    .replace(/^(?:to\s+)/iu, "")
    .split(/[.;:]/u)[0]
    .trim()
    .replace(/^(?:View|See|Open)\s+/iu, "Open ");
  if (!normalized) return fallback;
  if (normalized.length <= 32) return normalized;
  const clause = normalized
    .split(/,|\s+(?:and|then)\s+/iu)
    .map((value) => value.trim())
    .find((value) => value.length >= 3 && value.length <= 32);
  if (clause !== undefined) return clause;
  const words = normalized.split(/\s+/u);
  const concise = [];
  for (const word of words) {
    if ([...concise, word].join(" ").length > 32) break;
    concise.push(word);
  }
  while (
    concise.length > 1 &&
    /^(?:a|an|and|by|for|from|in|of|or|the|to|with|without)$/iu.test(concise.at(-1))
  ) {
    concise.pop();
  }
  return concise.join(" ") || fallback;
}

function ruleMatches(statements) {
  const matches = [];
  for (const statement of statements) {
    for (const rule of SCREEN_RULES) {
      if (
        (AUTH_PATTERN.test(statement) || REGISTER_PATTERN.test(statement)) &&
        ["form", "detail"].includes(rule.kind)
      ) continue;
      if (rule.pattern.test(statement)) matches.push({ rule, statement });
    }
  }
  return matches;
}

function screenRegions(kind, title, projectTerms) {
  const terms = unique(projectTerms).slice(0, 5);
  const supporting = terms.length > 0 ? terms : [title];
  const presets = {
    authentication: ["identity", "credentials", "access-help"],
    overview: ["priority-action", "activity", "attention"],
    catalog: ["search-and-filter", "result-collection", "selection"],
    detail: ["identity", "essential-details", "primary-action"],
    calendar: ["date-navigation", "availability", "selection"],
    records: ["status-filter", "record-list", "record-detail"],
    form: ["progress", "input-group", "review-and-submit"],
    content: ["feature-story", "work-index", "story-detail"],
    technical: ["resource-navigation", "request-builder", "response-inspector"],
    conversation: ["thread-list", "active-thread", "composer"],
    map: ["search", "map-canvas", "place-detail"],
  };
  return (presets[kind] ?? ["context", "primary-work", "next-action"]).map((regionKind, index) => Object.freeze({
    id: `${slug(title)}-${regionKind}`,
    kind: regionKind,
    title: supporting[index % supporting.length],
    items: Object.freeze(supporting.slice(index, index + 3).length > 0
      ? supporting.slice(index, index + 3)
      : supporting.slice(0, 3)),
  }));
}

function createScreen({ kind, statement, fallbackLabel, fallbackAction, projectTerms, index }) {
  const title = kind === "overview" ? fallbackLabel : titleFromStatement(statement, fallbackLabel);
  const action = kind === "authentication"
    ? fallbackAction
    : actionFromStatement(statement, fallbackAction);
  return Object.freeze({
    id: `screen-${String(index + 1).padStart(2, "0")}-${slug(title)}`,
    kind,
    navLabel: title.length > 24 ? fallbackLabel : title,
    eyebrow: kind === "authentication" ? "Secure access" : `0${index + 1} · ${fallbackLabel}`,
    title,
    summary: sentence(statement),
    primaryAction: action,
    secondaryAction: kind === "authentication" ? "Get help accessing your account" : "View details",
    regions: Object.freeze(screenRegions(kind, title, projectTerms)),
    states: Object.freeze(["default", "loading", "empty", "error", "success"]),
  });
}

function deriveScreens(input, statements, projectTerms) {
  const experience = statements.join(" ");
  const screens = [];
  if (AUTH_PATTERN.test(experience) || REGISTER_PATTERN.test(experience)) {
    const registration = REGISTER_PATTERN.test(experience);
    screens.push(createScreen({
      kind: "authentication",
      statement: registration
        ? `Create an account to continue to ${text(input.productName, "the product")}`
        : `Sign in to continue to ${text(input.productName, "the product")}`,
      fallbackLabel: registration ? "Create account" : "Sign in",
      fallbackAction: registration ? "Create account" : "Sign in",
      projectTerms,
      index: screens.length,
    }));
  }

  const matchedScreenRules = ruleMatches(statements);
  const representedStatements = new Set(
    matchedScreenRules.map(({ statement }) => statement.toLocaleLowerCase()),
  );
  for (const { rule, statement } of matchedScreenRules) {
    if (screens.some((screen) => screen.kind === rule.kind)) continue;
    screens.push(createScreen({
      kind: rule.kind,
      statement,
      fallbackLabel: rule.label,
      fallbackAction: rule.action,
      projectTerms,
      index: screens.length,
    }));
  }

  for (const statement of statements) {
    if (screens.length >= 7) break;
    if (representedStatements.has(statement.toLocaleLowerCase())) continue;
    if (AUTH_PATTERN.test(statement) || REGISTER_PATTERN.test(statement)) continue;
    if (/\b(?:responsive|mobile|desktop|phone|viewport|screen size|usable)\b/iu.test(statement)) continue;
    if (/^(?:primary\s+)?(?:workspace|details?|overview|account|success)$/iu.test(statement)) continue;
    const title = titleFromStatement(statement, "Primary workspace");
    if (screens.some((screen) => screen.title.toLocaleLowerCase() === title.toLocaleLowerCase())) continue;
    screens.push(createScreen({
      kind: "workflow",
      statement,
      fallbackLabel: title,
      fallbackAction: actionFromStatement(statement, "Continue"),
      projectTerms,
      index: screens.length,
    }));
  }

  if (screens.length === 0) {
    screens.push(createScreen({
      kind: "overview",
      statement: text(input.outcome, `Use ${text(input.productName, "the product")}`),
      fallbackLabel: "Overview",
      fallbackAction: text(input.primaryAction, "Get started"),
      projectTerms,
      index: 0,
    }));
  }
  if (screens.length === 1 && screens[0].kind === "authentication") {
    const registration = REGISTER_PATTERN.test(experience);
    screens.push(createScreen({
      kind: "success",
      statement: registration
        ? `Your ${text(input.productName, "account")} account is ready`
        : `Secure access to ${text(input.productName, "the product")} is ready`,
      fallbackLabel: registration ? "Account ready" : "Access granted",
      fallbackAction: "Continue",
      projectTerms,
      index: screens.length,
    }));
  }
  return screens.slice(0, 7).map((screen, index) => Object.freeze({ ...screen, order: index }));
}

function freezeDeep(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
}

/** Create the exact product tree approved by the customer. */
export function createProductRenderSpec(input) {
  const workflows = unique(list(input.workflows));
  const capabilities = unique(list(input.capabilities));
  const dataConcepts = unique(list(input.dataConcepts));
  const surfaceLabels = unique(list(input.surfaceLabels));
  const primaryStatements = unique([
    ...workflows,
    ...(workflows.length === 0 ? capabilities : []),
    text(input.outcome),
  ].filter(Boolean));
  const statements = primaryStatements.length > 0 ? primaryStatements : surfaceLabels;
  const projectTerms = unique([
    ...dataConcepts,
    ...surfaceLabels,
    ...workflows.map((item) => titleFromStatement(item, "")).filter(Boolean),
    ...capabilities,
  ]).slice(0, 12);
  const screens = deriveScreens(input, statements, projectTerms);
  const draft = {
    specVersion: SPEC_VERSION,
    productName: text(input.productName, "Product"),
    productSummary: text(input.outcome, "A complete product experience."),
    audiences: unique(list(input.audiences)),
    projectTerms,
    screens,
    initialScreenId: screens[0].id,
    navigation: screens.map((screen) => Object.freeze({ screenId: screen.id, label: screen.navLabel })),
    transitions: screens.slice(0, -1).map((screen, index) => Object.freeze({
      from: screen.id,
      action: screen.primaryAction,
      to: screens[index + 1].id,
    })),
    responsiveModes: Object.freeze([
      Object.freeze({ id: "phone", width: 390, navigation: "task-priority" }),
      Object.freeze({ id: "tablet", width: 768, navigation: "compact" }),
      Object.freeze({ id: "desktop", width: 1280, navigation: "complete" }),
    ]),
  };
  return freezeDeep({ ...draft, renderSpecId: hash(draft) });
}

export function productRenderSpecRequirements(spec) {
  return Object.freeze({
    renderSpecId: spec.renderSpecId,
    requiredScreenIds: Object.freeze(spec.screens.map((screen) => screen.id)),
    requiredRegionIds: Object.freeze(spec.screens.flatMap((screen) => screen.regions.map((region) => region.id))),
    requiredStateNames: Object.freeze(["default", "loading", "empty", "error", "success"]),
    initialScreenId: spec.initialScreenId,
  });
}
