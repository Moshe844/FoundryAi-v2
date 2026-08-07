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
    id: "destructive-actions-are-confirmed",
    // A delivered build wired a Remove control straight to a DELETE request:
    // one click and the record was gone, with no prompt and no undo. It was
    // contract-correct — that run's obligation happened to read "staff can
    // remove discontinued items", where the same request on an earlier run had
    // produced "after a clear confirmation step". A safety property must not
    // depend on which words the understanding phase chose, so this is read from
    // the source like the credential rule, and costs the browser test nothing.
    signals: [EngineeringSignal.ALWAYS],
    violated: (source) => {
      const issuesDelete =
        /method\s*:\s*["'`]DELETE["'`]/iu.test(source) ||
        /["'`]DELETE["'`]\s*,/u.test(source);
      if (!issuesDelete) return false;
      // Any deliberate second step counts: a native confirm, a dialog, or the
      // state that holds a pending removal until it is approved.
      const hasConfirmationStep =
        /\bconfirm\s*\(/u.test(source) ||
        /role\s*=\s*["'`]?(?:alert)?dialog/u.test(source) ||
        /aria-modal/u.test(source) ||
        /<dialog\b/u.test(source) ||
        /\b(?:confirm|confirming|pendingDelete|pendingRemoval|removing|toDelete|toRemove|awaitingConfirm)\w*\b/iu.test(
          source,
        );
      return !hasConfirmationStep;
    },
    message:
      "An action that permanently removes a record must require an explicit confirmation before it takes effect. Do not wire a delete request directly to a control's click handler: hold the pending removal in state and require a second, clearly-labelled approval — or offer an undo — before the request is sent.",
  },
  {
    id: "completed-work-outlives-the-click",
    // A delivered signup passed all fifteen of its checks with zero network
    // calls in the entire product: the submit handler validated the fields and
    // ran setState('success'), and "Access confirmed" was a React state flip.
    // Its obligation read "presents a successful account-creation state", which
    // is exactly what it did — so no wording rule catches this, and no browser
    // check does either, because the confirmation really is on screen. The only
    // reliable tell is in the source: a form that announces completion while
    // the product has no way to store anything has completed nothing.
    signals: [EngineeringSignal.ALWAYS],
    // Read per file. The build that prompted this shipped an unused lib/db.ts,
    // which made the joined product look like it could store something while
    // the page holding the form imported nothing but react.
    perFile: true,
    violated: (file) => {
      if (!/\bpreventDefault\s*\(/u.test(file)) return false;
      if (!announcesCompletion(file)) return false;
      // Calling out to a local module counts: the work may well be done there.
      return !persistsAnything(file) && !importsLocalModule(file);
    },
    message:
      "A form that announces success must make the result outlive the click. This product shows a completion state but never sends or stores anything, so nothing was created. Send the submitted values to a route handler or server action that writes them, and drive the success state from that response — do not flip a local state variable and call it done.",
  },
  {
    id: "validation-errors-clear-as-you-type",
    // Errors were set only in the submit handler and never anywhere else, so
    // after one empty submit the messages stayed painted over fields the user
    // had since filled in correctly: a screenshot showed "Enter your name."
    // under a filled name box. The validation logic was right; the display was
    // stale. Nothing on the browser side notices, because the error text the
    // check looked for is present.
    signals: [EngineeringSignal.USER_INPUT],
    perFile: true,
    violated: (source) => {
      if (!/\bsetErrors?\s*\(/u.test(source)) return false;
      if (!/\bpreventDefault\s*\(/u.test(source)) return false;
      const handlers = onChangeHandlerBodies(source);
      if (handlers.length === 0) return false;
      const clearsWhileTyping = handlers.some((body) =>
        /\bsetErrors?\s*\(|\bvalidate|\bclearError/iu.test(body),
      );
      if (clearsWhileTyping) return false;
      // Recomputing validation in an effect keyed to the fields is equally fine.
      return !/\buseEffect\s*\([\s\S]{0,400}?\bsetErrors?\s*\(/u.test(source);
    },
    message:
      "A validation error must disappear as soon as the field it describes is corrected. Errors here are written only by the submit handler, so they stay on screen over input the user has already fixed. Clear that field's error in its onChange handler, or recompute validation in an effect keyed to the field values.",
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
export function productFilesForFloor(files) {
  return (files ?? []).filter(
    (file) =>
      !/^tests?\//u.test(file.path) &&
      !/\.(?:spec|test)\.[jt]sx?$/u.test(file.path) &&
      !/^(?:public|evidence)\//u.test(file.path) &&
      file.path !== "package-lock.json",
  );
}

export function productSourceForFloor(files) {
  return productFilesForFloor(files)
    .map((file) => String(file.content))
    .join("\n");
}

// Any one of these means a submitted value can leave the component: a request,
// a server action, a client-side store, or a database client. A product that
// has none of them cannot have created anything, whatever it puts on screen.
const PERSISTENCE_PRIMITIVES = Object.freeze([
  /\bfetch\s*\(/u,
  /\bXMLHttpRequest\b/u,
  /\bnavigator\s*\.\s*sendBeacon\b/u,
  /["'`]use server["'`]/u,
  /<form[^>]*\saction=\{/u,
  /\b(?:localStorage|sessionStorage|indexedDB)\b/iu,
  /\b(?:axios|prisma|supabase|sqlite|mongoose|drizzle|knex)\b/iu,
  /\bcookies\s*\(/u,
  /\b(?:writeFile|writeFileSync)\b/u,
  /\b(?:signIn|signUp|createUser)\s*\(/u,
  /\b(?:useMutation|useSWRMutation|revalidatePath|revalidateTag)\b/u,
]);

// A quoted state literal or a boolean flag being raised — the two shapes a
// "we're done" screen takes. Deliberately narrow: a search form that filters a
// list on submit has neither, and must not be reported.
const COMPLETION_ANNOUNCEMENTS = Object.freeze([
  /['"`](?:success|succeeded|submitted|confirmed|completed?|created|registered|done|sent|thanks|thank-?you)['"`]/iu,
  /\bset(?:Is)?(?:Submitted|Success\w*|Confirmed|Registered|Created|Completed?|Done|Sent|Saved)\s*\(\s*true\b/iu,
]);

function persistsAnything(source) {
  return PERSISTENCE_PRIMITIVES.some((pattern) => pattern.test(source));
}

function announcesCompletion(source) {
  return COMPLETION_ANNOUNCEMENTS.some((pattern) => pattern.test(source));
}

// A relative or aliased import of real code — stylesheets and type-only
// imports carry no behaviour, so they do not count as somewhere the work
// could be happening.
function importsLocalModule(source) {
  const importPath = /\bfrom\s*["'`](\.{1,2}\/|@\/)([^"'`]+)["'`]/gu;
  for (const match of source.matchAll(importPath)) {
    if (/\.(?:css|scss|sass|less)$/u.test(match[2])) continue;
    return true;
  }
  return /\bawait\s+import\s*\(\s*["'`](?:\.{1,2}\/|@\/)/u.test(source);
}

// Returns the body of every onChange={...} expression, brace-matched so that
// nested objects and arrow bodies stay with their handler.
function onChangeHandlerBodies(source) {
  const bodies = [];
  const opening = /onChange\s*=\s*\{/gu;
  let match;
  while ((match = opening.exec(source)) !== null) {
    const start = match.index + match[0].length;
    let depth = 1;
    let index = start;
    while (index < source.length && depth > 0) {
      const character = source[index];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      index += 1;
    }
    bodies.push(source.slice(start, index - 1));
  }
  return bodies;
}

export function validateEngineeringFloor(files, signals) {
  const source = productSourceForFloor(files);
  if (source.trim() === "") return;
  // Rules about whether one component wires up to something must read that
  // component alone. Judged across the joined product they pass on a helper
  // sitting in another file that nothing imports.
  const perFileSources = productFilesForFloor(files).map((file) =>
    String(file.content),
  );
  for (const rule of SOURCE_RULES) {
    if (!ruleApplies(rule, signals)) continue;
    const scopes = rule.perFile ? perFileSources : [source];
    const failed = scopes.some((scope) =>
      typeof rule.violated === "function"
        ? rule.violated(scope)
        : !rule.satisfied(scope),
    );
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
