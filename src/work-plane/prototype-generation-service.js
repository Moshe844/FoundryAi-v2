import { ModelTaskClass } from "../domain/execution.js";
import { normalizeConceptPrototypeContract } from "../domain/live-concept-studio.js";
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
    for (const unsafe of UNSAFE_SOURCE) {
      if (unsafe.pattern.test(file.content)) {
        fail(`files[${index}] contains unsafe ${unsafe.reason}; prototype network and host access are forbidden.`);
      }
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
  const css = byPath.get("styles.css");
  if (
    css !== undefined &&
    !/(?:@media|@container|grid-template-columns\s*:\s*repeat\s*\(\s*auto-(?:fit|fill)|flex-wrap\s*:\s*wrap)/iu.test(css)
  ) fail("styles.css must contain a real responsive transformation.");
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
    "Do not use network requests, external URLs or scripts, environment variables, cookies, parent-window control, database code, authentication, payments, package dependencies, or build tooling.",
    "Keep every style in styles.css. Do not use style attributes or JavaScript element.style mutations; interactions must toggle classes, data attributes, or accessible state because the runtime CSP blocks inline styling.",
    "Forbidden literal patterns in every returned file include data:, blob:, javascript:, http://, https://, protocol-relative host URLs, style= attributes, and .style DOM access. Do not add data stylesheets, data images, preload shims, CSS imports, SVG data URIs, or placeholder network URLs; use local CSS gradients and semantic HTML instead.",
    "Before returning, scan all three files for those forbidden patterns and replace them with class-based, data-attribute-based, local behavior.",
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
