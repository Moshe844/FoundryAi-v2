import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeProductTypeDiscovery,
  productTypeDiscoveryPrompt,
  shouldDiscoverProductType,
  validateDiscoveryPortfolioDifferentiation,
} from "../src/domain/product-type-discovery.js";

const families = Object.freeze([
  ["Inventory", [
    ["Store Stock Control", "Shop teams", "Keep shelf counts accurate during daily sales"],
    ["Warehouse Movement Control", "Warehouse operators", "Trace stock as it arrives, moves, and ships"],
    ["Multi-location Replenishment", "Regional inventory managers", "Balance stock and replenish several locations"],
    ["Equipment Custody Tracking", "Operations coordinators", "Know who holds each reusable asset"],
    ["Ingredient Availability", "Kitchen managers", "Prevent shortages by tracking consumable ingredients"],
  ]],
  ["Website", [
    ["Local Service Presence", "Nearby customers", "Turn local website visits into qualified enquiries"],
    ["Professional Expertise Site", "Prospective clients", "Build trust before a services consultation"],
    ["Visual Work Portfolio", "Creative buyers", "Help website visitors judge past work quickly"],
    ["Direct Product Storefront", "Online shoppers", "Let customers discover and purchase products"],
    ["Member Knowledge Site", "Subscribed members", "Organize protected website content for return visits"],
  ]],
  ["Portal", [
    ["Customer Self-service Portal", "Existing customers", "Resolve common account needs without staff help"],
    ["Partner Resource Portal", "Business partners", "Share current materials and partner actions securely"],
    ["Case Progress Portal", "Clients with active cases", "Make milestones, documents, and next steps visible"],
    ["Member Benefits Portal", "Organization members", "Centralize benefits, notices, and member requests"],
    ["Supplier Coordination Portal", "External suppliers", "Coordinate submissions and status across suppliers"],
  ]],
  ["Booking", [
    ["Appointment Booking", "Service customers", "Reserve individual time slots without calling staff"],
    ["Class and Session Booking", "Participants and instructors", "Fill scheduled group sessions with clear capacity"],
    ["Resource Booking", "Teams sharing equipment", "Prevent conflicts when reserving limited resources"],
    ["Venue Booking", "Event organizers", "Match venue availability to event requirements"],
    ["Multi-provider Booking", "Clients and independent providers", "Route booking demand across provider calendars"],
  ]],
  ["API", [
    ["Public Data API", "External developers", "Provide stable read access to published data"],
    ["Partner Operations API", "Approved partner teams", "Exchange controlled business actions with partners"],
    ["Internal Service API", "Internal product teams", "Share trusted operations between internal systems"],
    ["Webhook Intake API", "Integration owners", "Receive and inspect events from connected services"],
    ["Automation Command API", "Workflow developers", "Trigger auditable tasks from automated clients"],
  ]],
  ["Internal tool", [
    ["Operations Queue", "Internal operations staff", "Move recurring work through clear internal stages"],
    ["Approval Workspace", "Internal reviewers", "Route high-impact requests to accountable approvers"],
    ["Team Record Manager", "Internal coordinators", "Maintain shared operational records without spreadsheets"],
    ["Service Desk Console", "Internal support agents", "Triage requests and track resolution ownership"],
    ["Performance Review Dashboard", "Internal team leads", "Spot operational patterns and follow up on exceptions"],
  ]],
]);

function modelCandidate(request, specs) {
  return {
    interpretation: {
      summary: `${request} could describe several products with different users and daily work.`,
      reasoning: `Foundry separated the ${request} interpretations by operating context, primary user, and outcome before choosing a scope.`,
      confidence: 0.66,
    },
    subtypes: specs.map(([title, user, outcome], index) => ({
      title,
      explanation: `${title} is a ${request} direction centered on ${outcome.toLowerCase()}.`,
      likelyUsers: [user],
      likelyPrimaryOutcome: outcome,
      whyItMayFit: `This may fit the broad ${request} request when ${user.toLowerCase()} are the people doing the core work.`,
      confidence: index === 0 ? 0.72 : 0.54,
      recommended: index === 0,
      canCombine: index < 3,
      combinationNote:
        index < 3
          ? "This direction can combine with another compatible operating context."
          : "Use this as the primary direction because its workflow changes the product scope.",
      compatibilityTags: index < 3 ? ["shared-operations"] : [`standalone-${index}`],
      deliveryPlatform: "web",
      requiredCapabilities: ["web-application", "browser-verification"],
    })),
  };
}

test("the six required broad inputs trigger dynamic product-type discovery", () => {
  for (const [request] of families) {
    assert.equal(shouldDiscoverProductType(request), true, request);
  }
  assert.equal(
    shouldDiscoverProductType("Inventory", [{ selection: { kind: "product-subtype" } }]),
    false,
  );
  assert.equal(
    shouldDiscoverProductType("Build an inventory tracker for three retail stores"),
    false,
  );
});

test("validated subtype choices are complete, relevant, distinct, and feasible", () => {
  const discoveries = families.map(([request, specs]) =>
    normalizeProductTypeDiscovery(modelCandidate(request, specs), {
      intent: request,
    }),
  );
  for (const discovery of discoveries) {
    assert.ok(discovery.subtypes.length >= 5 && discovery.subtypes.length <= 10);
    assert.equal(discovery.subtypes.filter((item) => item.recommended).length, 1);
    assert.ok(discovery.subtypes.every((item) => item.deliveryPlatform === "web"));
    assert.equal(new Set(discovery.subtypes.map((item) => item.title)).size, discovery.subtypes.length);
  }
  assert.equal(validateDiscoveryPortfolioDifferentiation(discoveries), true);
  assert.equal(
    new Set(discoveries.map((item) => item.subtypes.map((subtype) => subtype.title).join("|"))).size,
    families.length,
  );
});

test("quality gate rejects repetition, noun substitutions, and unsupported promises", () => {
  const [request, specs] = families[0];
  const repeated = modelCandidate(request, specs);
  repeated.subtypes[1] = structuredClone(repeated.subtypes[0]);
  repeated.subtypes[1].recommended = false;
  assert.throws(
    () => normalizeProductTypeDiscovery(repeated, { intent: request }),
    /repeated interpretation|not meaningfully distinct/u,
  );

  const unsupported = modelCandidate(request, specs);
  unsupported.subtypes[0].requiredCapabilities = ["native-mobile-app"];
  assert.throws(
    () => normalizeProductTypeDiscovery(unsupported, { intent: request }),
    /unsupported Foundry capability/u,
  );

  const nounSwap = modelCandidate(request, specs);
  nounSwap.subtypes = nounSwap.subtypes.map((item, index) => ({
    ...item,
    likelyPrimaryOutcome: `Manage ${request} record ${index + 1}`,
  }));
  assert.throws(
    () => normalizeProductTypeDiscovery(nounSwap, { intent: request }),
    /noun substitutions/u,
  );
});

test("production prompt is context-bound and production contains no subtype catalogue", () => {
  const prompt = productTypeDiscoveryPrompt({
    intent: "Inventory",
    context: ["Three stores share one stock room"],
  });
  assert.match(prompt, /Three stores share one stock room/u);
  assert.match(prompt, /Do not use or imitate a stored category list/u);
  assert.doesNotMatch(prompt, /Retail inventory|Warehouse inventory|Local business website/u);

  const production = [
    readFileSync(new URL("../src/domain/product-type-discovery.js", import.meta.url), "utf8"),
    readFileSync(new URL("../src/understanding-plane/project-understanding-service.js", import.meta.url), "utf8"),
  ].join("\n");
  assert.doesNotMatch(production, /if\s*\([^)]*(?:inventory|website|portal|booking|api|internal tool)/iu);
  assert.doesNotMatch(production, /(?:inventory|website|portal|booking)Subtypes\s*=/iu);
  assert.match(production, /validateStructuredModelOutput[\s\S]*PRODUCT_TYPE_DISCOVERY_SCHEMA/u);
});
