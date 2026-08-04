import assert from "node:assert/strict";
import test from "node:test";

import { createDesignRenderContract, renderDesignConceptDocument } from "../src/domain/design-concept-renderer.js";
import { createProductRenderSpec, productRenderSpecRequirements } from "../src/domain/product-render-spec.js";

const projects = [
  {
    name: "Pulse Studio",
    outcome: "Members create an account, discover fitness classes, reserve a place, and manage bookings.",
    workflows: ["Create a member account", "Browse fitness classes", "View class details and availability", "Book a class", "Manage upcoming bookings"],
    capabilities: ["Class discovery", "Live availability", "Booking management"],
    dataConcepts: ["Class", "Instructor", "Booking"],
    expectedKinds: ["authentication", "calendar", "catalog", "records"],
    expectedWords: ["fitness classes", "upcoming bookings"],
  },
  {
    name: "Fieldstock",
    outcome: "Warehouse teams monitor inventory, inspect item details, and create purchase orders.",
    workflows: ["Review the inventory overview", "Search inventory items", "Open item details", "Create a purchase order", "Track order history"],
    capabilities: ["Inventory search", "Reorder workflow", "Order records"],
    dataConcepts: ["Inventory item", "Supplier", "Purchase order"],
    expectedKinds: ["overview", "catalog", "detail", "form", "records"],
    expectedWords: ["purchase order", "inventory"],
  },
  {
    name: "Mara Voss",
    outcome: "Present photographic bodies of work and make considered editorial inquiries easy.",
    workflows: ["Browse selected photography projects", "Open a project story", "Read the artist profile", "Send an editorial inquiry"],
    capabilities: ["Project index", "Case study stories", "Inquiry form"],
    dataConcepts: ["Photograph", "Series", "Project story"],
    expectedKinds: ["content", "detail", "form"],
    expectedWords: ["photography projects", "editorial inquiry"],
  },
  {
    name: "Relay API",
    outcome: "Developers authenticate, explore endpoints, construct requests, inspect responses, and monitor webhooks.",
    workflows: ["Authenticate with an API token", "Browse API endpoints", "Build a request", "Inspect the response", "Review webhook activity"],
    capabilities: ["Endpoint explorer", "Request builder", "Response inspector", "Webhook logs"],
    dataConcepts: ["Endpoint", "Request", "Response", "Webhook event"],
    expectedKinds: ["authentication", "technical", "records"],
    expectedWords: ["API endpoints", "webhook activity"],
  },
];

test("product render specs derive distinct complete screen graphs across unrelated domains", () => {
  const specs = projects.map((project) => createProductRenderSpec({
    productName: project.name,
    outcome: project.outcome,
    workflows: project.workflows,
    capabilities: project.capabilities,
    dataConcepts: project.dataConcepts,
    audiences: ["Primary customer"],
  }));

  assert.equal(new Set(specs.map((spec) => spec.renderSpecId)).size, projects.length);
  specs.forEach((spec, index) => {
    const project = projects[index];
    const kinds = spec.screens.map((screen) => screen.kind);
    for (const kind of project.expectedKinds) assert.ok(kinds.includes(kind), `${project.name} omitted ${kind}`);
    const source = JSON.stringify(spec);
    for (const word of project.expectedWords) assert.match(source, new RegExp(word, "iu"));
    assert.ok(spec.screens.every((screen) => screen.states.length === 5));
    assert.equal(spec.transitions.length, Math.max(0, spec.screens.length - 1));
    const requirements = productRenderSpecRequirements(spec);
    assert.equal(requirements.requiredScreenIds.length, spec.screens.length);
    assert.ok(requirements.requiredRegionIds.length >= spec.screens.length * 3);
    assert.ok(Object.isFrozen(spec));
    assert.ok(Object.isFrozen(spec.screens));
  });
});

test("rule-derived screens are not duplicated as generic workflow screens", () => {
  const spec = createProductRenderSpec({
    productName: "Catalogue Shortlist",
    outcome: "Visitors browse catalogue items and save a shortlist.",
    workflows: [
      "Browse items, open details, and save selections",
      "Review the saved shortlist and remove selections",
    ],
    capabilities: ["Catalogue browsing", "Saved shortlist"],
    dataConcepts: ["Catalogue item", "Shortlist"],
    audiences: ["Visitors"],
  });

  assert.deepEqual(spec.screens.map((screen) => screen.kind), [
    "catalog",
    "records",
  ]);
  assert.doesNotMatch(
    JSON.stringify(spec.screens),
    /"title":"Primary workspace"/u,
  );
  assert.doesNotMatch(
    JSON.stringify(spec.screens),
    /"primaryAction":"Continue"/u,
  );
  assert.ok(
    spec.screens.some((screen) => screen.primaryAction === "Browse items"),
  );
  assert.doesNotMatch(
    JSON.stringify(spec.screens),
    /"primaryAction":"Explore"/u,
  );
});

test("long rule-matched workflows never become synthetic fallback actions", () => {
  const spec = createProductRenderSpec({
    productName: "Catalogue Shortlist",
    outcome: "Visitors browse catalogue items and save a shortlist.",
    workflows: [
      "Browse catalogue items, open details, and save preferred items",
      "Review the saved shortlist and remove items that no longer fit",
    ],
    capabilities: ["Catalogue browsing", "Saved shortlist"],
    dataConcepts: ["Catalogue item", "Shortlist"],
    audiences: ["Visitors"],
  });

  assert.ok(
    spec.screens.some(
      (screen) => screen.primaryAction === "Browse catalogue items",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(spec.screens),
    /"primaryAction":"(?:Explore|Continue)"/u,
  );
  assert.doesNotMatch(
    JSON.stringify(spec.screens),
    /"title":"Primary workspace"/u,
  );
});

test("long workflows keep project-specific actions instead of generic Continue labels", () => {
  const spec = createProductRenderSpec({
    productName: "Catalogue Shortlist",
    outcome: "Visitors browse catalogue items and save a shortlist.",
    workflows: [
      "Browse the catalogue and open item details",
      "Save items to a shortlist and remove them later",
      "Revisit the shortlist without entering a checkout flow",
    ],
    capabilities: ["Catalogue browsing", "Saved shortlist"],
    dataConcepts: ["Catalogue item", "Shortlist"],
    audiences: ["Visitors"],
  });

  assert.doesNotMatch(
    JSON.stringify(spec.screens),
    /"primaryAction":"Continue"/u,
  );
  assert.ok(
    spec.screens.some(
      (screen) => screen.primaryAction === "Save items to a shortlist",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(spec.screens),
    /"title":"Primary workspace"/u,
  );
});

test("every concept document renders its exact product graph instead of generic template copy", () => {
  for (const project of projects) {
    const contract = createDesignRenderContract({
      productName: project.name,
      outcome: project.outcome,
      workflows: project.workflows,
      capabilities: project.capabilities,
      dataConcepts: project.dataConcepts,
      directionName: `${project.name} signature direction`,
      personality: "Confident, clear, and product-specific.",
      creativeDNA: {
        compositionPrimitive: project.name === "Relay API" ? "documentation-explorer" : "task-workspace",
        primaryAction: project.workflows.at(-1),
        surfaceSequence: project.capabilities,
        surfaceLabels: project.dataConcepts,
      },
    });
    const document = renderDesignConceptDocument(contract);
    assert.match(document, new RegExp(`data-foundry-render-spec="${contract.productRenderSpec.renderSpecId}"`, "u"));
    for (const screen of contract.productRenderSpec.screens) {
      assert.match(document, new RegExp(`data-foundry-screen="${screen.id}"`, "u"));
    }
    for (const term of project.expectedWords) assert.match(document, new RegExp(term, "iu"));
    assert.doesNotMatch(document, /Threshold|First-Version Admin Experience|Complete concept · task workspace/iu);
  }
});
