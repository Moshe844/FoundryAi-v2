// A read-back, in the sense a pilot or a nurse means it: repeat the instruction
// back to the person who gave it, in their terms, so they can catch what you
// misheard. Foundry's contracts kept losing things the customer asked for, and
// no gate caught it because the obvious gate does not work.
//
// The obvious gate is lexical: reject an exclusion that reuses a word from the
// request. It fails on the first real example. A request for "a full
// login/signup page for a scheduling tool" correctly excludes "appointment
// scheduling" -- and the word "scheduling" is right there in the request. Word
// overlap cannot tell a deliverable from the domain it sits in.
//
// So the decomposition is semantic and a model does it -- but a model asked
// "does this contract cover the request?" answers yes. Three properties make
// its answer checkable instead of trusted:
//
//   1. Asks are extracted from the raw request ALONE, before the proposal is
//      visible. A model that has already read the proposal rationalises it.
//   2. Coverage must cite. Every ask claimed as covered must quote the exact
//      capability or exclusion that covers it, and the quote is then verified
//      against the proposal deterministically, here, with no model involved.
//      "Do you cover it?" is unfalsifiable; "which line covers it?" is not.
//   3. Silence is a miss. An ask with no valid citation is UNACCOUNTED, never
//      assumed fine.
//
// What this module owns is (2) and (3): the checking. The extraction is a model
// call elsewhere, and its output is only ever believed as far as its citations
// can be verified.

export const AskDisposition = Object.freeze({
  // Named in the proposal as something the first version will do.
  BUILDING: "BUILDING",
  // Named in the proposal as deliberately out of scope. Legitimate, but it must
  // be shown to the customer -- an exclusion they never saw is a silent drop.
  EXCLUDED: "EXCLUDED",
  // A qualifier rather than a deliverable: the industry, the audience, the
  // tone. "For a scheduling tool" is context; "signup" is not.
  CONTEXT: "CONTEXT",
  // Nothing in the proposal accounts for it. This is the defect the read-back
  // exists to surface.
  UNACCOUNTED: "UNACCOUNTED",
});

const DISPOSITIONS = Object.freeze(Object.values(AskDisposition));
const CITING_DISPOSITIONS = Object.freeze([
  AskDisposition.BUILDING,
  AskDisposition.EXCLUDED,
]);

export const REQUEST_READBACK_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["asks"],
  properties: Object.freeze({
    asks: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["ask", "quotedFromRequest", "disposition", "citation"],
        properties: Object.freeze({
          // The ask in plain terms: "people can create an account".
          ask: { type: "string", minLength: 1, maxLength: 160 },
          // The customer's own words it came from, so the read-back is
          // recognisably theirs and a wrong decomposition is obvious on sight.
          quotedFromRequest: { type: "string", minLength: 1, maxLength: 160 },
          disposition: { type: "string", enum: [...DISPOSITIONS] },
          // The exact proposal text that accounts for this ask; null for
          // CONTEXT and UNACCOUNTED, which cite nothing by definition. Written
          // as anyOf rather than a type union: the response validator takes a
          // single type string, and a union silently makes the whole schema
          // malformed rather than optional.
          citation: {
            anyOf: [{ type: "string", maxLength: 400 }, { type: "null" }],
          },
        }),
      }),
    }),
  }),
});

// Phase one: the asks, extracted from the request text and nothing else.
// Deliberately a separate call from the mapping. A model that can see the
// proposal decomposes the request into exactly the asks the proposal happens to
// satisfy and never emits the one that is missing -- and no amount of citation
// checking recovers an ask that was never generated, because there is nothing
// to check. Blindness here is what makes the citation check downstream worth
// anything.
export const REQUEST_ASKS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["asks"],
  properties: Object.freeze({
    asks: Object.freeze({
      type: "array",
      minItems: 1,
      maxItems: 24,
      items: Object.freeze({
        type: "object",
        additionalProperties: false,
        required: ["ask", "quotedFromRequest", "kind"],
        properties: Object.freeze({
          ask: { type: "string", minLength: 1, maxLength: 160 },
          quotedFromRequest: { type: "string", minLength: 1, maxLength: 160 },
          // DELIVERABLE must be accounted for by the proposal. CONTEXT is a
          // qualifier -- the industry, the audience, the tone -- and nothing
          // needs to be built for it.
          kind: { type: "string", enum: ["DELIVERABLE", "CONTEXT"] },
        }),
      }),
    }),
  }),
});

/**
 * Phase two may only dispose of the asks phase one found. It may not add one,
 * drop one, or reword one -- so a mapping model cannot quietly delete the ask
 * it has no citation for. Compared on the ask text, which phase one froze.
 */
export function assertAsksUnchanged(extracted, mapped) {
  const before = (extracted?.asks ?? []).map((entry) => normalizedText(entry.ask));
  const after = (mapped?.asks ?? []).map((entry) => normalizedText(entry.ask));
  const dropped = before.filter((ask) => !after.includes(ask));
  const invented = after.filter((ask) => !before.includes(ask));
  if (dropped.length === 0 && invented.length === 0) return;
  const parts = [];
  if (dropped.length > 0) {
    parts.push(`dropped ${dropped.length} (${dropped.slice(0, 3).join("; ")})`);
  }
  if (invented.length > 0) {
    parts.push(`invented ${invented.length} (${invented.slice(0, 3).join("; ")})`);
  }
  throw new TypeError(
    `The read-back must dispose of exactly the asks read from the request: ${parts.join(", ")}. Every extracted ask needs a disposition, and no ask may be added at mapping time.`,
  );
}

function normalizedText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/[^a-z0-9']+/gu, " ")
    .trim();
}

export function normalizeRequestReadback(value, label = "requestReadback") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  if (!Array.isArray(value.asks) || value.asks.length === 0) {
    throw new TypeError(`${label}.asks must list at least one ask.`);
  }
  const asks = value.asks.map((entry, index) => {
    const at = `${label}.asks[${index}]`;
    if (entry === null || typeof entry !== "object") {
      throw new TypeError(`${at} must be an object.`);
    }
    for (const key of ["ask", "quotedFromRequest"]) {
      if (typeof entry[key] !== "string" || entry[key].trim() === "") {
        throw new TypeError(`${at}.${key} must be a non-empty string.`);
      }
    }
    if (!DISPOSITIONS.includes(entry.disposition)) {
      throw new TypeError(
        `${at}.disposition must be one of ${DISPOSITIONS.join(", ")}.`,
      );
    }
    const citation =
      typeof entry.citation === "string" && entry.citation.trim() !== ""
        ? entry.citation.trim()
        : null;
    return Object.freeze({
      ask: entry.ask.trim(),
      quotedFromRequest: entry.quotedFromRequest.trim(),
      disposition: entry.disposition,
      citation,
    });
  });
  return Object.freeze({ asks: Object.freeze(asks) });
}

// Everything the proposal says it will do or deliberately will not do. A
// citation has to match one of these lines, so a model cannot claim coverage by
// paraphrasing something the contract never said.
export function citableProposalLines(design) {
  const proposal = design?.productProposal ?? {};
  return Object.freeze([
    ...(proposal.essentialCapabilities ?? []),
    ...(proposal.recommendedCapabilities ?? []),
    ...(proposal.intentionallyExcludedCapabilities ?? []),
    ...(proposal.futureCapabilities ?? []),
    ...(design?.explicitExclusions ?? []),
  ].map((line) => String(line)));
}

function citationResolves(citation, lines) {
  const needle = normalizedText(citation);
  if (needle === "") return false;
  return lines.some((line) => {
    const hay = normalizedText(line);
    // Either direction: the model may quote a whole capability or the clause of
    // one. What it may not do is cite words the proposal never contains.
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  });
}

/**
 * Deterministically re-judges a model's read-back against the proposal it
 * claims to describe. Any ask whose citation does not resolve is demoted to
 * UNACCOUNTED: an unverifiable claim of coverage is treated exactly like no
 * claim at all, which is the whole point of requiring a citation.
 *
 * Returns the settled read-back plus the reasons anything was demoted.
 */
export function settleRequestReadback(readback, design) {
  const normalized = normalizeRequestReadback(readback);
  const lines = citableProposalLines(design);
  const demotions = [];
  const asks = normalized.asks.map((entry) => {
    if (!CITING_DISPOSITIONS.includes(entry.disposition)) {
      // CONTEXT and UNACCOUNTED cite nothing, so there is nothing to verify.
      return Object.freeze({ ...entry, citation: null });
    }
    if (entry.citation === null) {
      demotions.push(
        `"${entry.ask}" was reported as ${entry.disposition} with no citation.`,
      );
      return Object.freeze({
        ...entry,
        disposition: AskDisposition.UNACCOUNTED,
        citation: null,
      });
    }
    if (!citationResolves(entry.citation, lines)) {
      demotions.push(
        `"${entry.ask}" was reported as ${entry.disposition} citing "${entry.citation.slice(0, 80)}", which appears nowhere in the proposal.`,
      );
      return Object.freeze({
        ...entry,
        disposition: AskDisposition.UNACCOUNTED,
        citation: null,
      });
    }
    return entry;
  });
  return Object.freeze({
    asks: Object.freeze(asks),
    demotions: Object.freeze(demotions),
  });
}

export function unaccountedAsks(settled) {
  return (settled?.asks ?? []).filter(
    (entry) => entry.disposition === AskDisposition.UNACCOUNTED,
  );
}

export function excludedAsks(settled) {
  return (settled?.asks ?? []).filter(
    (entry) => entry.disposition === AskDisposition.EXCLUDED,
  );
}

/**
 * The line the customer reads above the approve button. It exists so that the
 * blueprint cannot present itself as a faithful plan while something the
 * customer asked for is missing from it.
 */
export function readbackSummary(settled) {
  const missing = unaccountedAsks(settled);
  const excluded = excludedAsks(settled);
  if (missing.length > 0) {
    return `${missing.length} thing${missing.length === 1 ? "" : "s"} you asked for ${missing.length === 1 ? "is" : "are"} not in this plan.`;
  }
  if (excluded.length > 0) {
    return `Everything you asked for is accounted for. ${excluded.length} part${excluded.length === 1 ? " is" : "s are"} deliberately left out — check that you agree.`;
  }
  return "Everything you asked for is in this plan.";
}
