import { ModelTaskClass } from "../domain/execution.js";
import { normalizeConceptPrototypeContract } from "../domain/live-concept-studio.js";
import { typographicCraftIssues } from "../domain/typographic-craft.js";
import { ModelExecutionStage } from "./model-gateway.js";

export const CONCEPT_GENERATION_OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["files", "generationSummary"],
  properties: Object.freeze({
    files: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: Object.freeze({
          path: Object.freeze({ type: "string", minLength: 1, maxLength: 240 }),
          content: Object.freeze({ type: "string", minLength: 1, maxLength: 1_000_000 }),
        }),
      }),
    }),
    generationSummary: Object.freeze({ type: "string", minLength: 1, maxLength: 4_000 }),
  }),
});

const UNSAFE_SOURCE = Object.freeze([
  { pattern: /\b(?:fetch|WebSocket|XMLHttpRequest|EventSource|sendBeacon)\s*\(/iu, reason: "network API" },
  { pattern: /https?:\/\/|["'(]\s*\/\/[A-Za-z0-9]/iu, reason: "external URL" },
  { pattern: /\b(?:data|blob|javascript):/iu, reason: "unsafe embedded or executable URL" },
  { pattern: /\b(?:eval|Function)\s*\(/u, reason: "dynamic code execution" },
  { pattern: /\b(?:process\.env|import\.meta\.env|document\.cookie)\b/u, reason: "secret-bearing environment access" },
  {
    pattern: /\b(?:window|globalThis|self)\s*\.\s*(?:parent|top|opener)\b|\b(?:parent|top|opener)\s*\.\s*(?:postMessage|location|document|frames)\b/u,
    reason: "parent-window control",
  },
  { pattern: /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//iu, reason: "external script" },
  { pattern: /<form\b[^>]*\baction\s*=\s*["'](?:https?:)?\/\//iu, reason: "external form action" },
  { pattern: /<[^>]+\bstyle\s*=/iu, reason: "inline styling blocked by the prototype CSP" },
  { pattern: /\.style(?:\.|\s*=)/u, reason: "DOM inline styling blocked by the prototype CSP" },
]);

// What to do instead, per rule. A refusal that only names the rule leaves the
// regeneration to guess, and it guesses the same thing.
const UNSAFE_REMEDY = Object.freeze({
  "inline styling blocked by the prototype CSP":
    "Move those declarations into styles.css and apply them with a class.",
  "DOM inline styling blocked by the prototype CSP":
    "Toggle a class or a data attribute instead of assigning to element.style, and express the states in styles.css.",
  "external URL":
    "Use no absolute or protocol-relative URLs. For imagery use CSS gradients, shapes, or inline SVG markup; link within the prototype with relative paths only.",
  "unsafe embedded or executable URL":
    "Remove the data:, blob: or javascript: URL. Draw with CSS or inline SVG elements rather than encoding an asset.",
  "external script": "Remove the script tag; the prototype loads concept.js only.",
  "external form action": "Leave the form action empty and handle submission locally in concept.js.",
  "network API": "The prototype has no network. Hold sample data in a local constant in concept.js.",
  "dynamic code execution":
    "Write the behaviour directly instead of building it from a string. To evaluate arithmetic, hold the operands and the pending operator in variables and apply them with real operators, or tokenize the expression and walk the tokens; never hand a string to eval or new Function.",
  "secret-bearing environment access": "The prototype has no environment or cookies; use local constants.",
  "parent-window control": "The prototype is origin-isolated and may not reach its host page.",
});

function fail(message) {
  throw new TypeError(`Prototype generation: ${message}`);
}

function validateGeneratedOutput(value, contract) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("model output must be an object.");
  }
  if (
    !Array.isArray(value.files) ||
    typeof value.generationSummary !== "string" ||
    value.generationSummary.trim() === ""
  ) fail("model output must contain files and generationSummary.");
  const expected = [...contract.expectedFiles].sort();
  const files = value.files.map((file, index) => {
    if (
      file === null ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      Object.keys(file).sort().join(",") !== "content,path" ||
      typeof file.path !== "string" ||
      typeof file.content !== "string" ||
      file.content === ""
    ) fail(`files[${index}] is invalid.`);
    // The match holds the exact offending text and its position, and both were
    // discarded. Four concepts in one session were refused with only "contains
    // unsafe inline styling", each regeneration reproducing the same defect
    // because nothing told it where to look; the studio then had too few
    // directions to offer a choice and the mission stopped before a build.
    for (const unsafe of UNSAFE_SOURCE) {
      const match = unsafe.pattern.exec(file.content);
      if (match === null) continue;
      const before = file.content.slice(0, match.index);
      const line = before.split("\n").length;
      const column = match.index - (before.lastIndexOf("\n") + 1) + 1;
      const excerpt = file.content
        .slice(Math.max(0, match.index - 40), match.index + match[0].length + 60)
        .replace(/\s+/gu, " ")
        .trim();
      fail(
        `files[${index}] (${file.path}) contains unsafe ${unsafe.reason} at line ${line} column ${column}: "${match[0].slice(0, 60)}" — in: ${excerpt}. ${UNSAFE_REMEDY[unsafe.reason] ?? "Remove it; the prototype runs origin-isolated with no network or host access."}`,
      );
    }
    return { path: file.path, content: file.content };
  });
  const actual = files.map((file) => file.path).sort();
  if (
    actual.length !== expected.length ||
    actual.some((path, index) => path !== expected[index])
  ) fail(`generated files must match the contract exactly: ${expected.join(", ")}.`);
  const byPath = new Map(files.map((file) => [file.path, file.content]));
  const html = byPath.get("index.html");
  if (
    html !== undefined &&
    (
      !/^\s*<!doctype html>/iu.test(html) ||
      !/<html\b[^>]*\blang=/iu.test(html) ||
      !/<main\b/iu.test(html) ||
      !/<link\b[^>]*href=["'](?:\/|\.\/)?styles\.css["']/iu.test(html)
    )
  ) fail("index.html must be semantic, localized, and load isolated concept CSS.");
  // Caught here rather than after admission: a heading is deterministic markup,
  // and discovering it missing only once the concept has been opened at three
  // viewports costs half a minute and a whole direction. A calculator concept
  // was lost exactly that way while its two siblings were admitted.
  if (html !== undefined && !/<h[1-6]\b[^>]*>\s*\S/iu.test(html)) {
    fail(
      "index.html must contain at least one heading element (h1-h6) with visible text. Admission refuses a concept that has no heading at any viewport, including a minimal tool whose display is the main content -- name the surface rather than leaving it unlabelled.",
    );
  }
  const css = byPath.get("styles.css");
  if (
    css !== undefined &&
    !/(?:@media|@container|grid-template-columns\s*:\s*repeat\s*\(\s*auto-(?:fit|fill)|flex-wrap\s*:\s*wrap)/iu.test(css)
  ) fail("styles.css must contain a real responsive transformation.");
  if (css !== undefined) {
    for (const issue of typographicCraftIssues(css)) fail(issue);
  }
  return Object.freeze({
    files: Object.freeze(files.map((file) => Object.freeze(file))),
    generationSummary: value.generationSummary.trim().slice(0, 1_000),
  });
}

function prompt(contract, admissionFeedback = []) {
  return [
    "Generate one real, runnable Live HTML Concept Studio prototype from the exact immutable contract below.",
    "Return only the declared structured output. Do not describe code instead of writing it.",
    "Use semantic HTML, isolated CSS, and only lightweight local JavaScript interaction.",
    "Implement the project-specific surfaces, sequence, navigation, hierarchy, typography, spacing, colors, imagery treatment, motion constraints, responsive behavior, accessibility rules, and deliberate exclusions.",
    "Use clearly fictional sample content under the sampleContentPolicy. Never invent customer facts.",
    // Concepts kept arriving with one typeface doing every job, which is what
    // made otherwise sound compositions read as homemade. State the split.
    "TYPOGRAPHY: run two faces with separate jobs. The display face carries the typeVoice and is used only for headings, pull quotes and large numerals. The interface face carries every control, label, input, placeholder, table cell, badge and helper text, and must be a stack built for small screen text: ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif — or ui-monospace, SFMono-Regular, \"Cascadia Mono\", Menlo, monospace when the typeVoice is mono-technical. Never set a serif, cursive or display family on a button, input, select, textarea, label or small.",
    "Build a real type scale rather than arbitrary sizes: pick a base of 15-17px for body and interface text, and derive headings from it with clear steps. Set line-height near 1.5 for body text and 1.0-1.15 for display sizes, and give large display type negative letter-spacing while leaving small text alone.",
    "Craft the surface as well as the layout: keep one consistent corner-radius language, one consistent border colour, and enough contrast that body text sits at 4.5:1 or better against its background. Prefer generous vertical rhythm over decoration.",
    "Do not use network requests, external URLs or scripts, environment variables, cookies, parent-window control, database code, authentication, payments, package dependencies, or build tooling.",
    "Keep every style in styles.css. Do not use style attributes or JavaScript element.style mutations; interactions must toggle classes, data attributes, or accessible state because the runtime CSP blocks inline styling.",
    "Forbidden literal patterns in every returned file include data:, blob:, javascript:, http://, https://, protocol-relative host URLs, style= attributes, and .style DOM access. Do not add data stylesheets, data images, preload shims, CSS imports, SVG data URIs, or placeholder network URLs; use local CSS gradients and semantic HTML instead.",
    "Before returning, scan all three files for those forbidden patterns and replace them with class-based, data-attribute-based, local behavior.",
    ...(contract.strategy === "shock"
      ? [
          "HIGH_ORIGINALITY_STRATEGY: deliberately avoid the safest common pattern. Create uncommon but purposeful composition, memorable hierarchy, strong art direction, unexpected but understandable interaction or sequencing, and distinctive typography or imagery treatment.",
          "The result must still satisfy the project outcome, primary users, required workflows, accessibility, responsive behavior, technical feasibility, and every explicit exclusion. Do not create a generic SaaS shell and do not use arbitrary novelty.",
        ]
      : []),
    // Overflow used to be the only admission rule the generator was told, so it
    // was the only one it reliably satisfied. A calculator direction was
    // refused at all three viewports for having no heading -- a fair rule the
    // model had never been given -- and the studio offered two directions
    // instead of three. Admission is deterministic; there is no reason to make
    // the model guess it.
    "The concept is refused admission unless every viewport shows: a <main> landmark; at least one real heading element (h1-h6) with visible text, even on a minimal tool where the display is the main content; at least two distinct semantic sections; at least one keyboard-focusable control that takes focus on Tab; alt text on every image; and no console or page errors. Satisfy all of these in the markup rather than treating them as optional polish.",
    // Horizontal overflow is the most common reason a concept is refused
    // admission, and a refused concept can take the studio below the two
    // directions a choice requires.
    "The concept is opened at 390px, 768px and 1280px wide and is refused if anything overflows horizontally at any of them. Never give an element a fixed width, min-width, or padding that can exceed the viewport. Let grids and flex rows wrap, allow flex and grid children to shrink with min-width:0, keep media and tables to max-width:100%, and give any element that must scroll its own overflow-x container rather than widening the page.",
    "Every expected file must be returned exactly once. The concept must run as a static origin-isolated HTML/CSS/ES-module application.",
    `CONCEPT_PROTOTYPE_CONTRACT ${contract.integrityHash}`,
    JSON.stringify(contract),
    ...(admissionFeedback.length === 0
      ? []
      : [
          "PRIOR_ADMISSION_FAILURES_TO_CORRECT",
          admissionFeedback.map((entry) => String(entry).slice(0, 1_000)).join("\n"),
        ]),
  ].join("\n\n");
}

export function createPrototypeGenerationService({ modelGateway, workspaceService }) {
  if (modelGateway === null || typeof modelGateway?.request !== "function") {
    fail("modelGateway.request is required.");
  }
  if (workspaceService === null || typeof workspaceService?.provision !== "function") {
    fail("workspaceService is required.");
  }
  const inFlight = new Map();

  async function generateOnce(contract, admissionFeedback) {
    let workspace;
    try {
      workspace = workspaceService.get(contract);
    } catch {
      workspace = workspaceService.provision(contract);
    }
    if (workspace.status === "FINALIZED") {
      return Object.freeze({
        conceptContract: contract,
        workspace,
        generationSummary: "Reused the immutable concept artifact.",
        cached: true,
        usage: Object.freeze({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
        requestId: null,
      });
    }
    const baseId = `${contract.missionId}-${contract.conceptId}-v${contract.conceptVersion}`;
    const response = await modelGateway.request({
      requestId: `${baseId}-prototype-generation`,
      missionId: contract.missionId,
      workUnitId: `${baseId}-prototype-work`,
      idempotencyKey: `prototype-${contract.integrityHash.slice(0, 48)}`,
      purpose: prompt(contract, admissionFeedback),
      taskClass: ModelTaskClass.FILE_GENERATION,
      executionStage: ModelExecutionStage.DESIGN_PROTOTYPE,
      contextReferences: [
        { kind: "concept-prototype-contract", id: contract.integrityHash },
        {
          kind: "project-design-version",
          id: `${contract.missionId}-v${contract.sourceProjectDesignVersion}`,
        },
      ],
      expectedStructuredOutputSchema: CONCEPT_GENERATION_OUTPUT_SCHEMA,
      sensitiveValues: [],
      structuredOutputValidator: (output) => validateGeneratedOutput(output, contract),
      depthLevel: 2,
      routingReason: "A lightweight static concept needs capable HTML/CSS generation at the lowest adequate design-coding depth.",
    });
    const output = validateGeneratedOutput(response.structuredOutput, contract);
    workspaceService.writeFiles(
      contract,
      Object.fromEntries(output.files.map((file) => [file.path, file.content])),
    );
    workspace = workspaceService.finalize(contract);
    return Object.freeze({
      conceptContract: contract,
      workspace,
      generationSummary: output.generationSummary,
      cached: false,
      usage: Object.freeze({
        inputTokens: response.tokenMetadata?.inputTokens ?? 0,
        outputTokens: response.tokenMetadata?.outputTokens ?? 0,
        costUsd: response.costMetadata?.costUsd ?? 0,
      }),
      requestId: response.requestId,
    });
  }

  function generate({ conceptContract: input, admissionFeedback = [] }) {
    const contract = normalizeConceptPrototypeContract(input);
    if (!Array.isArray(admissionFeedback) || admissionFeedback.some((entry) => typeof entry !== "string")) {
      fail("admissionFeedback must be an array of strings.");
    }
    const key = contract.integrityHash;
    if (inFlight.has(key)) return inFlight.get(key);
    const operation = generateOnce(contract, admissionFeedback).finally(() => inFlight.delete(key));
    inFlight.set(key, operation);
    return operation;
  }

  return Object.freeze({ generate });
}
