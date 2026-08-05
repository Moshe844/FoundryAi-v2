/**
 * Server-renders the real DesignDirection studio for a real project, using
 * creative DNA produced by the domain layer. Proof of the customer-facing
 * surface, not a mockup.
 *
 *   node scripts/render-creative-studio.mjs [outfile.html]
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeDesignAlternativeList } from "../src/domain/project-design.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const webRoot = resolve(root, "apps/web");
const require = createRequire(resolve(webRoot, "package.json"));
const esbuild = require("esbuild");

const PROJECT = {
  family: "portfolio",
  recommendedStyle: "A silent room where the print is the only thing speaking",
  reason:
    "Fine-art buyers decide on the image within seconds. Every direction below removes something different to protect that moment, and each one loses something real in exchange.",
  directions: [
    {
      name: "Silent Room",
      layoutApproach: "Full-screen photographic stage with a quiet index",
      why: "The print is judged before anything else, so the interface disappears until the visitor asks for it. This direction wins on immediacy and accepts weaker breadth in exchange.",
      tradeoff: "Scanning a large body of work quickly is slower than a grid.",
      density: "One work at a time",
      nav: "Hidden index revealed on demand",
      mobile: "One work per screen, swiped",
    },
    {
      name: "Plate Catalogue",
      layoutApproach: "Contact sheet gallery of every plate",
      why: "Collectors compare bodies of work side by side before they enquire, so the whole catalogue is visible at once. This direction wins on comparison and accepts weaker drama in exchange.",
      tradeoff: "No single image gets a monumental moment.",
      density: "Dense, many works visible",
      nav: "Persistent filter rail",
      mobile: "Two-column sheet that stays a sheet",
    },
    {
      name: "Essay Sequence",
      layoutApproach: "Editorial spread with sidebar notes and plates",
      why: "Series work reads as an argument rather than a wall of images, so the writing and the plates share the page. This direction wins on commitment and accepts weaker browsing in exchange.",
      tradeoff: "Buyers hunting one image must scroll past the essay.",
      density: "Balanced text and image",
      nav: "Masthead with chapter links",
      mobile: "Text column first, plates follow",
    },
  ],
};

const alternatives = normalizeDesignAlternativeList(
  PROJECT.directions.map((item, index) => ({
    name: item.name,
    description: `${item.why} For a fine-art photographer, this decides what a visitor meets first and what they must scroll past.`,
    whyItFits: item.why,
    layoutApproach: item.layoutApproach,
    visualPersonality: `${item.name} character`,
    informationDensity: item.density,
    navigationApproach: item.nav,
    mobileBehavior: item.mobile,
    tradeoff: item.tradeoff,
    confidence: { score: 0.86 - index * 0.06, rationale: item.why },
    recommended: index === 0,
    preview: {
      typographyCharacter: "set by creative DNA",
      spacingDensity: "set by creative DNA",
      colorMood: `${item.name} palette`,
      hierarchy: item.layoutApproach,
    },
  })),
  { family: PROJECT.family },
);

const sourced = (value) => ({ value, source: { kind: "model", reference: "studio" } });

const uiAlternatives = alternatives.map((item, index) => ({
  id: `direction-${index + 1}`,
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
  creativeDNA: item.creativeDNA,
  recommended: sourced(item.recommended),
}));

const direction = {
  recommendedStyle: sourced(PROJECT.recommendedStyle),
  reason: sourced(PROJECT.reason),
  layoutApproach: sourced(PROJECT.directions[0].layoutApproach),
  tone: sourced("Quiet, gallery-like, unhurried"),
  mobilePriority: sourced(PROJECT.directions[0].mobile),
  accessibilityConsiderations: sourced(["Meaning never depends on colour alone."]),
};

const ssrEntry = resolve(webRoot, ".studio-ssr.cjs");
esbuild.buildSync({
  stdin: {
    contents: `
      import { createElement } from "react";
      import { renderToStaticMarkup } from "react-dom/server";
      import { DesignDirection } from "./app/components/design-direction";
      // createElement, not a direct call: hooks need React's dispatcher.
      module.exports.render = (props) =>
        renderToStaticMarkup(createElement(DesignDirection, props));
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

const { render } = require(ssrEntry);
const markup = render({
  alternatives: uiAlternatives,
  choice: { mode: "recommended", optionId: "direction-1" },
  direction,
  outcome: "Present complete bodies of work and make considered collector inquiries easy.",
  productName: "a fine-art photographer portfolio",
  workflows: ["Opening image", "Selected projects", "Artist context", "Inquiry path"],
  onChange: () => {},
});
try {
  unlinkSync(ssrEntry);
} catch {
  /* best effort cleanup */
}

const styles = ["tokens.css", "shell.css", "design-intelligence.css", "design-quality.css", "art-board.css", "creative-studio.css"]
  .map((name) => {
    try {
      return readFileSync(resolve(webRoot, "app/styles", name), "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

const html = `<!doctype html><meta charset="utf-8"><title>Foundry creative-direction studio</title>
<style>
${styles}
body { margin:0; padding:32px; background:#faf9f7; color:#15171a;
  font:15px/1.55 "Segoe UI",system-ui,sans-serif; }
.act { max-width:1240px; margin-inline:auto; }
.t-title-l{font-size:26px;font-weight:640;} .t-title-m{font-size:18px;font-weight:620;}
.t-title-s{font-size:15px;font-weight:640;} .t-body-m{font-size:15px;} .t-body-s{font-size:13.5px;}
.t-caption{font-size:12px;} .t-label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:640;}
.ink-secondary{color:#4d545c;} .ink-tertiary{color:#7a828b;}
.badge{font-size:10.5px;font-weight:650;padding:2px 7px;border-radius:999px;background:#15171a;color:#fff;text-transform:uppercase;letter-spacing:.05em;}
.btn{padding:9px 15px;border-radius:9px;border:1px solid #15171a26;background:#fff;font:inherit;font-size:13.5px;cursor:pointer;}
.btn-primary{background:#15171a;color:#fff;border-color:#15171a;}
.btn-quiet{border:0;background:none;font:inherit;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer;color:#4d545c;}
.small{font-size:12.5px;} .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);}
.plain-textarea{width:100%;padding:9px;border-radius:9px;border:1px solid #15171a2e;font:inherit;font-size:13.5px;}
</style>
${markup}`;

const out = resolve(process.argv[2] ?? resolve(root, "artifacts/creative-studio.html"));
writeFileSync(out, html, "utf8");
console.log(`primitives: ${alternatives.map((a) => a.creativeDNA.compositionPrimitive).join(", ")}`);
console.log(`written: ${out}`);
