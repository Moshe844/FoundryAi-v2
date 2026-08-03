/**
 * Renders the REAL ArtDirectionBoard component against REAL creative DNA
 * produced by the domain layer, for every certification project family.
 *
 * This is a visual proof harness, not a mock: the component, the CSS and the
 * DNA derivation are the same code the customer-facing studio uses. If boards
 * ever collapse back into one shared composition, this gallery shows it.
 *
 *   node scripts/render-art-direction-gallery.mjs [outfile.html]
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { deriveCreativeDNASet } from "../src/domain/creative-direction.js";
import { assessCreativeDirectionSet } from "../src/domain/creative-direction-quality.js";
import { normalizeDesignAlternativeList } from "../src/domain/project-design.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const webRoot = resolve(root, "apps/web");
const require = createRequire(resolve(webRoot, "package.json"));
const esbuild = require("esbuild");

/** Twelve certification projects, each with three genuinely different directions. */
const PROJECTS = [
  {
    project: "Fine-art photographer portfolio",
    family: "portfolio",
    directions: [
      ["Silent Room", "Full-screen photographic stage with a quiet index", "The print is judged before anything else, so the interface disappears.", "Scanning many works quickly is slower than a grid."],
      ["Plate Catalogue", "Contact sheet gallery of every plate", "Collectors compare bodies of work side by side before enquiring.", "No single image gets a monumental moment."],
      ["Essay Sequence", "Narrative story scroll through chapters", "Series work reads as an argument, not a wall of images.", "Buyers hunting one image must scroll past the essay."],
    ],
  },
  {
    project: "Commercial photographer portfolio",
    family: "portfolio",
    directions: [
      ["Rate Card", "Modular gallery grid with a filter strip", "Art buyers filter by sector in seconds and shortlist fast.", "Personal voice is quieter than the catalogue."],
      ["Set Report", "Editorial magazine spread with sidebar notes", "Clients buy the way you work, not only the final frame.", "Slower to skim than a pure grid."],
      ["Booking Desk", "Guided step by step enquiry flow", "Most commercial leads arrive ready to book a date.", "Browsing is subordinate to enquiring."],
    ],
  },
  {
    project: "Filmmaker portfolio",
    family: "portfolio",
    directions: [
      ["Title Sequence", "Immersive full-screen cinematic stage", "Motion is the medium, so the reel opens the moment you arrive.", "Slow on poor connections."],
      ["Cutting Room", "Timeline of every stage of a production", "Producers judge process and range across a body of work.", "Less immediately dramatic than a reel."],
      ["Credits Panel", "Identity and work canvas with a contact anchor", "Commissioners look for the person and the credits together.", "The work is smaller on first view."],
    ],
  },
  {
    project: "Plumbing business website",
    family: "marketing",
    directions: [
      ["Call Now", "Mobile-first stacked screens with a sticky action", "Most plumbing visits are emergencies from a phone.", "Desktop feels sparse."],
      ["Coverage Map", "Map-led surface with a result rail", "Customers first ask whether you cover their street.", "Slower on very old phones."],
      ["Quote Path", "Guided step by step booking flow", "A priced job beats a phone tag, so the quote leads.", "Casual browsers meet a form early."],
    ],
  },
  {
    project: "Luxury service website",
    family: "brand",
    directions: [
      ["Private View", "Immersive full-screen cinematic stage", "Restraint signals price better than any claim.", "Detail seekers must dig."],
      ["House Journal", "Editorial magazine spread with sidebar notes", "Provenance and craft are the argument for the price.", "Longer to read."],
      ["Concierge", "Guided step by step enquiry flow", "High-value clients expect to be handled, not to browse.", "Feels formal for casual interest."],
    ],
  },
  {
    project: "Multi-staff appointment booking application",
    family: "application",
    directions: [
      ["Day Grid", "Calendar of availability and slots", "Staff live in the day view and drag work around it.", "Long-horizon planning is harder."],
      ["Queue Desk", "Task-first workspace with a detail panel", "Front desk works a queue, not a calendar.", "Losing the visual shape of the day."],
      ["Guest Path", "Guided step by step booking flow", "Guests self-book more when asked one question at a time.", "Staff need a second, denser surface."],
    ],
  },
  {
    project: "Insurance customer portal",
    family: "application",
    directions: [
      ["Policy Desk", "Profile-led surface with a credential strip", "Policyholders arrive to check one policy they own.", "Multi-policy households see more switching."],
      ["Claim Track", "Timeline of every claim stage", "The anxious question is always where the claim is.", "Routine document tasks are less prominent."],
      ["Document Table", "Record table with bulk actions", "Brokers manage many policies at once.", "Intimidating for a once-a-year visitor."],
    ],
  },
  {
    project: "Expense approval workspace",
    family: "operations",
    directions: [
      ["Approval Queue", "Task-first workspace with a detail panel", "Approvers clear a queue and never lose their place.", "Trend analysis needs another view."],
      ["Ledger View", "Record table with bulk actions and a filter bar", "Finance approves in batches, not one by one.", "Individual context is thinner."],
      ["Receipt Reader", "Conversation surface with a composer dock", "Most disputes are a question about one receipt.", "Slower for bulk clearing."],
    ],
  },
  {
    project: "School parent portal",
    family: "application",
    directions: [
      ["Family Card", "Profile-led surface per child", "Parents think in children, not in modules.", "Whole-school notices are quieter."],
      ["Term Calendar", "Calendar of the school term", "Dates are the thing parents actually miss.", "Less good for messages."],
      ["Message Thread", "Conversation surface with a thread rail", "Most parent contact is a question to one teacher.", "Dates need a second surface."],
    ],
  },
  {
    project: "Restaurant reservation application",
    family: "operations",
    directions: [
      ["Floor Plan", "Map-led surface of the room", "Hosts seat by looking at the room, not a list.", "Harder on a small phone."],
      ["Service Timeline", "Timeline of covers through the night", "Kitchens plan by the shape of the service.", "Individual bookings are smaller."],
      ["Book a Table", "Guided step by step booking flow", "Guests want a table in three taps.", "Staff tools live elsewhere."],
    ],
  },
  {
    project: "AI document-review application",
    family: "application",
    directions: [
      ["Review Bench", "Task-first workspace with a document detail panel", "Reviewers compare the model's claim against the source.", "Dense on a laptop screen."],
      ["Ask the File", "Conversation surface over the document", "Most questions are conversational, not structural.", "Systematic review is harder."],
      ["Finding Table", "Record table of every finding with bulk actions", "Legal teams triage hundreds of findings at once.", "Loses the document context."],
    ],
  },
  {
    project: "REST API developer experience",
    family: "developer",
    directions: [
      ["Reference Tree", "Documentation explorer with an example pane", "Developers arrive from search, needing one endpoint.", "Poor first-time narrative."],
      ["Console First", "Command surface with a result list", "The fastest proof is a request that returns.", "Weak for conceptual learning."],
      ["Recipe Book", "Narrative story scroll through integration chapters", "Integrators need the whole flow, not one call.", "Slow for lookup."],
    ],
  },
];

function toAlternatives(spec) {
  return spec.directions.map(([name, layoutApproach, whyItFits, tradeoff], index) => ({
    name,
    // A real model returns a paragraph of reasoning per direction. Terse
    // one-liners are correctly rejected by the quality authority, so the
    // harness supplies prose of realistic depth.
    description: `${whyItFits} For a ${spec.project.toLowerCase()}, this decides what the visitor meets first and what they must scroll past.`,
    whyItFits: `${whyItFits} This direction wins on ${["immediacy", "comparison", "commitment"][index]} and accepts weaker ${["breadth", "drama", "browsing"][index]} in exchange.`,
    layoutApproach,
    visualPersonality: `${name} character`,
    informationDensity: ["low", "balanced", "dense"][index],
    navigationApproach: ["quiet index", "persistent rail", "compact top bar"][index],
    mobileBehavior: ["one item per screen", "collapses to cards", "one question per screen"][index],
    tradeoff,
    confidence: { score: 0.85 - index * 0.05, rationale: whyItFits },
    recommended: index === 0,
    preview: {
      typographyCharacter: "set by creative DNA",
      spacingDensity: "set by creative DNA",
      colorMood: `${name} palette`,
      hierarchy: layoutApproach,
    },
  }));
}

// React and react-dom stay external so the bundle can be required normally
// from apps/web; inlining them breaks on CommonJS dynamic requires.
const ssrEntry = resolve(webRoot, ".art-board-ssr.cjs");
esbuild.buildSync({
  stdin: {
    contents: `
      import { renderToStaticMarkup } from "react-dom/server";
      import { ArtDirectionBoard } from "./app/components/art-direction-board";
      module.exports.renderBoard = (direction) =>
        renderToStaticMarkup(ArtDirectionBoard({ direction }));
    `,
    resolveDir: webRoot,
    loader: "tsx",
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server"],
  outfile: ssrEntry,
  logLevel: "silent",
});

const { renderBoard } = require(ssrEntry);
process.on("exit", () => {
  try {
    require("node:fs").unlinkSync(ssrEntry);
  } catch {
    /* best effort cleanup */
  }
});

const sourced = (value) => ({ value, source: { kind: "model", reference: "gallery" } });

const sections = [];
let totalBoards = 0;
const primitiveUse = new Map();

for (const spec of PROJECTS) {
  const normalized = normalizeDesignAlternativeList(toAlternatives(spec), { family: spec.family });
  const withIds = normalized.map((item, index) => ({ ...item, id: `${spec.family}-${index}` }));
  const assessment = assessCreativeDirectionSet(withIds, { family: spec.family });

  const boards = withIds
    .map((item) => {
      const dna = item.creativeDNA;
      primitiveUse.set(dna.compositionPrimitive, (primitiveUse.get(dna.compositionPrimitive) ?? 0) + 1);
      totalBoards += 1;
      const direction = {
        id: item.id,
        name: sourced(item.name),
        description: sourced(item.description),
        whyItFits: sourced(item.whyItFits),
        layoutApproach: sourced(item.layoutApproach),
        visualPersonality: sourced(item.visualPersonality),
        informationDensity: sourced(item.informationDensity),
        navigationApproach: sourced(item.navigationApproach),
        mobileBehavior: sourced(item.mobileBehavior),
        tradeoff: sourced(item.tradeoff),
        confidence: sourced(item.confidence.score),
        preview: {
          typographyCharacter: sourced(item.preview.typographyCharacter),
          spacingDensity: sourced(item.preview.spacingDensity),
          colorMood: sourced(item.preview.colorMood),
          hierarchy: sourced(item.preview.hierarchy),
        },
        visualSystem: item.visualSystem,
        creativeDNA: dna,
        recommended: sourced(item.recommended),
      };
      return `<figure class="cell">
        ${renderBoard(direction)}
        <figcaption>
          <strong>${item.name}</strong>
          <span class="prim">${dna.compositionPrimitive}</span>
          <span class="meta">${dna.typeVoice} · ${dna.typeScale} · ${dna.imageryTreatment} · ${dna.motionStrategy} · ${dna.responsiveTransform}</span>
        </figcaption>
      </figure>`;
    })
    .join("\n");

  sections.push(`<section>
    <h2>${spec.project}
      <em>${assessment.distinctnessScore}% distinct · ${assessment.publishable ? "publishable" : "REJECTED"}</em>
    </h2>
    <div class="row">${boards}</div>
  </section>`);
}

const css = readFileSync(resolve(webRoot, "app/styles/art-board.css"), "utf8");
const html = `<!doctype html><meta charset="utf-8"><title>Foundry art-direction gallery</title>
<style>
${css}
:root { color-scheme: light; }
body { margin:0; padding:28px; font:14px/1.5 "Segoe UI",system-ui,sans-serif; background:#f2f1ee; color:#15171a; }
h1 { font-size:22px; margin:0 0 4px; }
.lede { margin:0 0 26px; color:#5a6068; max-width:80ch; }
section { margin-block-end:34px; }
h2 { font-size:15px; margin:0 0 10px; display:flex; gap:10px; align-items:baseline; }
h2 em { font-style:normal; font-size:11px; color:#6b7280; font-weight:400; }
.row { display:grid; grid-template-columns:repeat(3,1fr); gap:16px; }
.cell { margin:0; }
figcaption { margin-block-start:7px; display:flex; flex-direction:column; gap:2px; }
figcaption strong { font-size:12.5px; }
.prim { font-size:11px; color:#111; background:#e3e2de; border-radius:4px; padding:1px 5px; align-self:flex-start; }
.meta { font-size:10.5px; color:#767c85; }
</style>
<h1>Foundry — art-direction boards across 12 projects</h1>
<p class="lede">Rendered from the real <code>ArtDirectionBoard</code> component and real creative DNA from
<code>src/domain/creative-direction.js</code>. ${totalBoards} boards, ${primitiveUse.size} distinct composition primitives in use.</p>
${sections.join("\n")}`;

const out = resolve(process.argv[2] ?? resolve(root, "artifacts/art-direction-gallery.html"));
writeFileSync(out, html, "utf8");
console.log(`boards: ${totalBoards}`);
console.log(`distinct primitives used: ${primitiveUse.size}`);
console.log([...primitiveUse].map(([k, v]) => `  ${k}: ${v}`).join("\n"));
console.log(`written: ${out}`);
