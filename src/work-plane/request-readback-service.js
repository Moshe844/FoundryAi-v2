import { ModelTaskClass } from "../domain/execution.js";
import { ModelExecutionStage } from "./model-gateway.js";
import {
  AskDisposition,
  REQUEST_ASKS_SCHEMA,
  REQUEST_READBACK_SCHEMA,
  assertAsksUnchanged,
  citableProposalLines,
  settleRequestReadback,
} from "../domain/request-readback.js";

const FOCUSED_AUTH_FEATURES = Object.freeze([
  ["Account creation", /\b(?:create (?:an? )?account|sign[- ]?up|signup|register)\b/iu],
  ["Credential sign-in", /\b(?:sign[- ]?in|login|log[- ]?in|credentials?)\b/iu],
  ["Durable accounts", /\b(?:durable|persist\w*|saved account)\b/iu],
  ["Refresh-safe sessions", /\b(?:refresh|remain signed|stay signed|sessions?)\b/iu],
  ["Session-revoking sign-out", /\b(?:sign[- ]?out|logout|log[- ]?out|revok\w*)\b/iu],
  ["Responsive presentation", /\b(?:responsive|mobile|phone|narrow screen)\b/iu],
  ["Accessible keyboard forms", /\b(?:accessible|accessibility|keyboard|focus|labels?)\b/iu],
  ["Useful validation and authentication errors", /\b(?:validation|invalid|incorrect|authentication errors?|useful errors?)\b/iu],
]);

export function deterministicFocusedAuthenticationReadback({
  originalCustomerRequest,
  projectDesign,
  profileVersion = 1,
}) {
  const request = String(originalCustomerRequest ?? "").trim();
  const planText = JSON.stringify(projectDesign ?? {});
  if (
    !/\b(?:create (?:an? )?account|sign[- ]?up|signup|register)\b/iu.test(request) ||
    !/\b(?:sign[- ]?in|login|log[- ]?in|credentials?)\b/iu.test(request) ||
    !/\b(?:refresh|sessions?|sign[- ]?out|revok\w*)\b/iu.test(request) ||
    /\b(?:booking|appointments?|dashboard|portal|store|shop|todos?|school|expense|portfolio|assistant|rest api)\b/iu.test(request)
  ) {
    return null;
  }
  const lines = citableProposalLines(projectDesign);
  const asks = [];
  for (const [ask, pattern] of FOCUSED_AUTH_FEATURES) {
    const requested = pattern.exec(request);
    if (requested === null) continue;
    const citation = lines.find((line) => pattern.test(line)) ?? null;
    asks.push(Object.freeze({
      ask,
      quotedFromRequest: requested[0],
      disposition:
        citation === null
          ? AskDisposition.UNACCOUNTED
          : AskDisposition.BUILDING,
      citation,
    }));
  }
  if (asks.length < 3 || !/\b(?:account|authenticat|credential|session)\b/iu.test(planText)) {
    return null;
  }
  const settled = settleRequestReadback({ asks }, projectDesign);
  return Object.freeze({
    asks: settled.asks,
    demotions: settled.demotions,
    originalCustomerRequest: request,
    profileVersion,
    deterministicFastLane: true,
  });
}

// Two calls, deliberately. The first reads the customer's request and nothing
// else; the second disposes of exactly what the first found, citing the
// proposal line by line. Splitting them is the whole mechanism: a single call
// that can see the proposal decomposes the request into precisely the asks the
// proposal satisfies, and the ask that went missing is never written down at
// all. See src/domain/request-readback.js for why the citations are then
// re-checked here rather than believed.

function extractionPrompt(originalCustomerRequest) {
  return [
    "Read the customer's request below and list every distinct thing they asked for. Work only from their words. You are not being shown any plan, and you must not imagine one: your job is to record the request faithfully, not to decide what is reasonable or feasible.",
    "Split compound requests: \"a booking form and a calendar view\" is two asks, not one, and so is any phrase joined by a slash. A qualifier that describes the product's setting, audience, industry or tone is kind CONTEXT; something that has to be built or has to work is kind DELIVERABLE.",
    "Include asks the customer implied by a word like \"full\", \"complete\", or \"working\" only where that word commits to something specific and nameable. Do not pad the list with things they never mentioned.",
    "quotedFromRequest must be the customer's own words, copied exactly from the request, so they can recognise their own sentence.",
    `Customer request:\n${originalCustomerRequest}`,
  ].join("\n\n");
}

function mappingPrompt(asks, lines) {
  return [
    "Below is a list of things a customer asked for, and the complete list of lines from the plan that was produced for them. Decide, for each ask, what the plan does about it.",
    "Return exactly the same asks, with the same wording, in any order. Do not add an ask. Do not remove one. If you cannot account for an ask, say so with UNACCOUNTED — that is a useful, expected answer and it is what this exists to find.",
    "BUILDING means a plan line commits to doing it. EXCLUDED means a plan line deliberately puts it out of scope. CONTEXT means it describes the setting rather than something to build. UNACCOUNTED means no plan line addresses it either way.",
    "For BUILDING and EXCLUDED you must set citation to text copied exactly from one of the plan lines below. The citation is checked against those lines automatically, and an ask whose citation is not found there is recorded as UNACCOUNTED. Do not paraphrase, and do not cite a line that only sounds related.",
    `Asks:\n${JSON.stringify(asks.map((entry) => ({ ask: entry.ask, quotedFromRequest: entry.quotedFromRequest })))}`,
    `Plan lines:\n${JSON.stringify(lines)}`,
  ].join("\n\n");
}

export function createRequestReadbackService({ modelGateway }) {
  return Object.freeze({
    /**
     * Returns the settled read-back, or null when it could not be produced.
     * Null is not "nothing is missing" -- the caller must present it as
     * unavailable, never as a clean bill of health.
     */
    async readBack({
      missionId,
      originalCustomerRequest,
      projectDesign,
      profileVersion = 1,
    }) {
      const request = String(originalCustomerRequest ?? "").trim();
      if (request === "") return null;
      const lines = citableProposalLines(projectDesign);
      if (lines.length === 0) return null;
      const baseId = `${missionId}-readback-v${profileVersion}`;

      const extraction = await modelGateway.request({
        requestId: `${baseId}-asks`,
        missionId,
        workUnitId: `${baseId}-work`,
        idempotencyKey: `${baseId}-asks`,
        purpose: extractionPrompt(request),
        taskClass: ModelTaskClass.STRUCTURED_TRANSFORMATION,
        executionStage: ModelExecutionStage.REQUEST_READBACK,
        contextReferences: [{ kind: "customer-request", id: missionId }],
        expectedStructuredOutputSchema: REQUEST_ASKS_SCHEMA,
        sensitiveValues: [],
        depthLevel: 1,
        routingReason:
          "Decomposing one short request into its asks is a mechanical reading task, and it must not see the plan it will be checked against.",
      });
      const asks = extraction.structuredOutput?.asks ?? [];
      if (asks.length === 0) return null;

      const mapping = await modelGateway.request({
        requestId: `${baseId}-mapping`,
        missionId,
        workUnitId: `${baseId}-work`,
        idempotencyKey: `${baseId}-mapping`,
        purpose: mappingPrompt(asks, lines),
        taskClass: ModelTaskClass.STRUCTURED_TRANSFORMATION,
        executionStage: ModelExecutionStage.REQUEST_READBACK,
        contextReferences: [
          { kind: "customer-request", id: missionId },
          { kind: "project-design-version", id: `${missionId}-v${profileVersion}` },
        ],
        expectedStructuredOutputSchema: REQUEST_READBACK_SCHEMA,
        sensitiveValues: [],
        depthLevel: 1,
        routingReason:
          "Matching a fixed list of asks against a fixed list of plan lines is mechanical; the citations it produces are verified deterministically afterwards.",
      });

      // Neither phase may close the gap the other opened: the mapping has to
      // dispose of exactly the asks that were read, and every citation it makes
      // has to resolve against the plan.
      assertAsksUnchanged({ asks }, mapping.structuredOutput);
      const settled = settleRequestReadback(
        mapping.structuredOutput,
        projectDesign,
      );
      return Object.freeze({
        asks: settled.asks,
        demotions: settled.demotions,
        originalCustomerRequest: request,
        profileVersion,
      });
    },
  });
}
