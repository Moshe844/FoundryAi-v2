// Foundry's verification proves a build matches its plan. It never asked
// whether the plan was competent, so a contract that never mentioned hashing
// produced an admin login storing passwords in plaintext and passed every
// gate: 13 of 13 contract checks and 12 of 12 fidelity aspects.
//
// The engineering floor is the set of obligations a competent engineer honours
// whether or not the customer asked. Foundry adds them itself, from detected
// capability signals rather than from anything the model proposed, so they
// apply to every project type by construction.
//
// Two enforcement shapes, because they need different evidence:
//   - Source rules are deterministic admission checks. No model call, no repair
//     budget: a violation fails the bundle before it is ever built.
//   - Obligations are real browser-checked contract entries, verified in the
//     running product like any other approved outcome.

export class EngineeringFloorViolation extends Error {
  constructor(message) {
    super(message);
    this.name = "EngineeringFloorViolation";
  }
}

// Signals are detected from the whole project description, not from a fixed
// project taxonomy, so an unfamiliar product still triggers the floor it needs.
export const EngineeringSignal = Object.freeze({
  ALWAYS: "always",
  CREDENTIALS: "credentials",
  PERSISTENCE: "persistence",
  USER_INPUT: "user-input",
  DESTRUCTIVE: "destructive-action",
  UPLOAD: "file-upload",
  PAYMENT: "payment",
});

// Trailing \w* throughout: these match running prose, where the plural and
// the verb form are the common case ("uploads photos", "cancels a booking").
const SIGNAL_PATTERNS = Object.freeze({
  [EngineeringSignal.CREDENTIALS]:
    /\b(?:password\w*|passphrase\w*|credential\w*|sign[- ]?in\w*|signin\w*|log[- ]?in\w*|login\w*|sign[- ]?up\w*|signup\w*|authenticat\w*|account creation|api key\w*|access token\w*)\b/iu,
  [EngineeringSignal.USER_INPUT]:
    /\b(?:form\w*|submit\w*|enter\w*|input\w*|create\w*|register\w*|book\w*|order\w*|request\w*|message\w*|comment\w*|review\w*|apply|applies|add|adds|adding|update\w*|edit\w*|save\w*|post\w*|record\w*|log\w*|assign\w*|schedul\w*|reserv\w*|rate\w*|vote\w*|search\w*|filter\w*)\b/iu,
  [EngineeringSignal.DESTRUCTIVE]:
    /\b(?:delete\w*|remove\w*|archive\w*|cancel\w*|revoke\w*|deactivate\w*|discard\w*)\b/iu,
  [EngineeringSignal.UPLOAD]:
    /\b(?:upload\w*|attach\w*|photo\w*|image\w*|avatar\w*)\b/iu,
  [EngineeringSignal.PAYMENT]:
    /\b(?:payment\w*|checkout\w*|card\w*|billing|invoice\w*|subscription\w*|charge\w*|purchase\w*)\b/iu,
});

const PERSISTENCE_CAPABILITIES = new Set([
  "sqlite-persistence",
  "create-records",
  "update-records",
  "refresh-persistence",
]);

function corpus(profile, projectDesign) {
  return JSON.stringify([
    profile?.summary ?? "",
    profile?.name ?? "",
    profile?.primaryJourneys ?? [],
    profile?.outcomes ?? [],
    profile?.dataConcepts ?? [],
    profile?.proposedFeatures ?? [],
    projectDesign?.projectIntent ?? {},
    projectDesign?.userExperiencePlan ?? {},
    projectDesign?.productProposal?.essentialCapabilities ?? [],
  ]);
}

export function detectEngineeringSignals(profile, projectDesign = null) {
  const text = corpus(profile, projectDesign);
  const signals = new Set([EngineeringSignal.ALWAYS]);
  for (const [signal, pattern] of Object.entries(SIGNAL_PATTERNS)) {
    if (pattern.test(text)) signals.add(signal);
  }
  if (
    (profile?.capabilities ?? []).some((capability) =>
      PERSISTENCE_CAPABILITIES.has(capability),
    )
  ) {
    signals.add(EngineeringSignal.PERSISTENCE);
  }
  // Anything that carries credentials, a payment, an upload, or a record the
  // customer creates is user input by definition, whatever words the
  // description happened to use. Relying on vocabulary alone left products
  // that plainly accept input with no server-validation obligation, which is
  // precisely the gap that made this floor look like an authentication
  // feature rather than a general one.
  for (const implying of [
    EngineeringSignal.CREDENTIALS,
    EngineeringSignal.PAYMENT,
    EngineeringSignal.UPLOAD,
    EngineeringSignal.DESTRUCTIVE,
  ]) {
    if (signals.has(implying)) signals.add(EngineeringSignal.USER_INPUT);
  }
  if (signals.has(EngineeringSignal.PERSISTENCE)) {
    signals.add(EngineeringSignal.USER_INPUT);
  }
  return signals;
}

const CREDENTIAL_COLUMN =
  "password|passwd|passphrase|secret|api_key|apikey|access_token|token_hash|credential";

// Persisting a credential: a schema column, or a write that carries one.
const PERSISTED_CREDENTIAL = new RegExp(
  `(?:CREATE\\s+TABLE[^;]{0,400}\\b(?:${CREDENTIAL_COLUMN})\\b` +
    `|(?:INSERT\\s+INTO|UPDATE)[^;'"\`]{0,240}\\b(?:${CREDENTIAL_COLUMN})\\b` +
    `|\\.(?:set|put|write|save|create)\\s*\\([^)]{0,120}\\b(?:${CREDENTIAL_COLUMN})\\b)`,
  "iu",
);

const CREDENTIAL_HASHED =
  /\b(?:bcrypt|argon2|scryptSync|scrypt|pbkdf2Sync|pbkdf2|createHash)\s*\(/u;

// Each rule is deliberately a presence-or-absence check over the generated
// source rather than a dataflow analysis: precise enough to catch the real
// defect, conservative enough not to fail a correct build.
const SOURCE_RULES = Object.freeze([
  {
    id: "credentials-are-hashed",
    // Ungated on purpose. The rule already reads what the source does rather
    // than what the description said, and a build that persists a credential
    // must hash it whether or not anyone thought to mention credentials when
    // describing the project.
    signals: [EngineeringSignal.ALWAYS],
    // Deliberately keyed off what the source actually does, not off a declared
    // capability. The build that shipped plaintext passwords did persist them,
    // but its profile never listed a persistence capability, so a
    // signal-gated rule would have let it straight through.
    violated: (source) =>
      PERSISTED_CREDENTIAL.test(source) && !CREDENTIAL_HASHED.test(source),
    message:
      "Stored credentials must be irreversibly hashed before persistence. Use node:crypto scryptSync (or pbkdf2Sync) with a per-record random salt, and compare with timingSafeEqual; never write a password, passphrase, or access token into storage as given.",
  },
  {
    id: "sql-is-parameterized",
    signals: [EngineeringSignal.PERSISTENCE],
    violated: (source) =>
      /(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)[^;'"`]{0,200}\$\{/iu.test(source),
    message:
      "SQL must bind values as parameters. Build every statement with ? placeholders and pass values to run/get/all; never interpolate a value into SQL with a template literal.",
  },
  {
    id: "no-embedded-secrets",
    signals: [EngineeringSignal.ALWAYS],
    violated: (source) =>
      /\b(?:api[_-]?key|apikey|secret|access[_-]?token|private[_-]?key)\b\s*[:=]\s*["'`][A-Za-z0-9_\-./+]{16,}["'`]/iu.test(
        source,
      ),
    message:
      "Generated source must not embed a literal API key, secret, or access token. Read any such value from the environment at runtime.",
  },
  {
    id: "uploads-are-validated",
    signals: [EngineeringSignal.UPLOAD, EngineeringSignal.PERSISTENCE],
    requiresAll: true,
    satisfied: (source) =>
      !/formData\s*\(|multipart\/form-data|\.file\b/u.test(source) ||
      /\b(?:size|byteLength|length)\b[^;\n]{0,60}[<>]=?[^;\n]{0,40}\d/u.test(source),
    message:
      "An accepted file upload must be validated for type and size on the server before it is stored.",
  },
  {
    id: "no-card-data-at-rest",
    signals: [EngineeringSignal.PAYMENT, EngineeringSignal.PERSISTENCE],
    requiresAll: true,
    violated: (source) =>
      /(?:INSERT\s+INTO|UPDATE)[^;'"`]{0,200}\b(?:card_number|cardnumber|pan|cvv|cvc|card_cvc|security_code)\b/iu.test(
        source,
      ),
    message:
      "Card numbers, CVV/CVC values, and equivalent payment secrets must never be persisted. Store only a non-reversible reference.",
  },
]);

function ruleApplies(rule, signals) {
  return rule.requiresAll === true
    ? rule.signals.every((signal) => signals.has(signal))
    : rule.signals.some((signal) => signals.has(signal));
}

export function engineeringFloorRequirements(signals) {
  return SOURCE_RULES.filter((rule) => ruleApplies(rule, signals)).map(
    (rule) => Object.freeze({ id: rule.id, message: rule.message }),
  );
}

// Applied to the customer-facing product source only. Test files legitimately
// contain literal credentials and inline SQL, and failing a build for its own
// fixtures would be the same mistake as counting evidence/ as changed source.
export function productSourceForFloor(files) {
  return (files ?? [])
    .filter(
      (file) =>
        !/^tests?\//u.test(file.path) &&
        !/\.(?:spec|test)\.[jt]sx?$/u.test(file.path) &&
        !/^(?:public|evidence)\//u.test(file.path) &&
        file.path !== "package-lock.json",
    )
    .map((file) => String(file.content))
    .join("\n");
}

export function validateEngineeringFloor(files, signals) {
  const source = productSourceForFloor(files);
  if (source.trim() === "") return;
  for (const rule of SOURCE_RULES) {
    if (!ruleApplies(rule, signals)) continue;
    const failed =
      typeof rule.violated === "function"
        ? rule.violated(source)
        : !rule.satisfied(source);
    if (failed) {
      throw new EngineeringFloorViolation(
        `Engineering floor "${rule.id}" is not met. ${rule.message}`,
      );
    }
  }
}

// Behavioural guarantees cannot be read out of source, so they become real
// browser-checked obligations alongside the customer's own approved outcomes.
const OBLIGATION_RULES = Object.freeze([
  {
    signals: [EngineeringSignal.CREDENTIALS],
    sourceRequirement: "engineering-floor-session-end",
    outcome: (name) =>
      `${name} lets a signed-in person end their session, and the signed-out state no longer exposes the signed-in view.`,
    evidence: ["Browser evidence of signing in, signing out, and the resulting signed-out state"],
  },
  {
    signals: [EngineeringSignal.CREDENTIALS],
    sourceRequirement: "engineering-floor-protected-access",
    outcome: (name) =>
      `${name} refuses access to a signed-in-only area when no valid session is present, instead of rendering it.`,
    evidence: ["Browser evidence that a protected route is refused without a session"],
  },
  {
    signals: [EngineeringSignal.USER_INPUT],
    sourceRequirement: "engineering-floor-server-validation",
    outcome: (name) =>
      `${name} rejects invalid submitted data at the server and reports it, so validation does not depend only on the browser.`,
    evidence: ["Observed server rejection of an invalid submission with a visible message"],
  },
  {
    signals: [EngineeringSignal.DESTRUCTIVE],
    sourceRequirement: "engineering-floor-destructive-confirmation",
    outcome: (name) =>
      `${name} requires an explicit confirmation before an action that destroys or removes data takes effect.`,
    evidence: ["Browser evidence that the destructive action requires confirmation"],
  },
  {
    signals: [EngineeringSignal.ALWAYS],
    sourceRequirement: "engineering-floor-safe-errors",
    outcome: (name) =>
      `${name} shows a person a plain recovery message when something fails, without exposing stack traces or internal diagnostics.`,
    evidence: ["Observed failure state showing a human message and no internal diagnostic text"],
  },
]);

// Off, on measurement rather than caution. The harness did remove the
// scaffolding cost, so generation passed admission first time with these
// enabled — but each guarantee is still one more browser check the model must
// implement and the build must then satisfy. Turning five on took an ordinary
// project from ten browser checks to fifteen, and observation converged from
// fifteen failures to nine and then stopped moving.
//
// The guarantees are generic by nature — ending a session, refusing an
// unauthenticated route, rejecting invalid input at the server, confirming a
// destructive action. None of them is project-specific, so the way to make
// them affordable is for the harness to observe them directly, the way it
// already measures responsive and accessibility evidence, instead of asking
// the model for five more assertions. Until then they cost more than they
// prove. The source rules below stay on unconditionally: they cost the
// browser test nothing and still reject a build that stores a credential in
// the clear.
export const ENGINEERING_FLOOR_OBLIGATIONS_ENABLED = false;

export function engineeringFloorVerificationEntries(productName, signals) {
  if (!ENGINEERING_FLOOR_OBLIGATIONS_ENABLED) return [];
  const name = String(productName ?? "This project").trim() || "This project";
  return OBLIGATION_RULES.filter((rule) =>
    rule.signals.some((signal) => signals.has(signal)),
  ).map((rule) =>
    Object.freeze({
      observableOutcome: rule.outcome(name),
      acceptanceMethod: "browser-check",
      evidenceRequired: [...rule.evidence],
      sourceRequirement: rule.sourceRequirement,
      origin: "foundry-derived",
      dependencyIndexes: [],
    }),
  );
}

// The floor is cheapest to satisfy when the generator is told about it up
// front, rather than discovering it as an admission failure.
export function engineeringFloorPromptSegments(signals) {
  const requirements = engineeringFloorRequirements(signals);
  // Behavioural guarantees are stated only while they are also verified. An
  // instruction the build is never checked against is noise in an already
  // enormous prompt, and worse, it invites the model to spend its budget on
  // work no gate will confirm.
  const behavioural = ENGINEERING_FLOOR_OBLIGATIONS_ENABLED
    ? OBLIGATION_RULES.filter((rule) =>
        rule.signals.some((signal) => signals.has(signal)),
      )
    : [];
  if (requirements.length === 0 && behavioural.length === 0) return [];
  return [
    "Engineering floor — these hold whether or not they appear in the approved requirements, and admission rejects a bundle that violates one:",
    ...requirements.map((requirement) => `- ${requirement.message}`),
    ...behavioural.map((rule) => `- ${rule.outcome("The product")}`),
  ];
}
