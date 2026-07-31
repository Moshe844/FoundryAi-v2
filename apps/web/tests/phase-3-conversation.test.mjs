import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("new Phase 3 presents one progressive working-session stage", async () => {
  const [discovery, composer, styles] = await Promise.all([
    source("../app/components/project-discovery.tsx"),
    source("../app/components/customer-input-composer.tsx"),
    source("../app/globals.css"),
  ]);
  assert.match(discovery, /const stages = \[/u);
  assert.match(discovery, /aria-current=\{stage === index \? "step"/u);
  assert.match(discovery, /stage === 0/u);
  assert.match(discovery, /stage === 6/u);
  assert.match(composer, /Tell Foundry anything else/u);
  assert.match(composer, /Send and revise/u);
  assert.match(styles, /\.discovery-workspace/u);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(290px, 360px\)/u);
  assert.match(styles, /@media \(max-width: 1099px\)/u);
});

test("new Phase 3 exposes customer-created input and visible revision history", async () => {
  const [composer, server, conversation] = await Promise.all([
    source("../app/components/customer-input-composer.tsx"),
    source("../local-api/server.mjs"),
    source("../local-api/discovery-conversation.mjs"),
  ]);
  assert.match(composer, /kind: "customer-message"/u);
  assert.match(composer, /classification: null/u);
  assert.match(composer, /proposal\.smartSuggestions\.map/u);
  assert.doesNotMatch(composer, /<select|option value=/u);
  assert.match(composer, /Plan revised/u);
  assert.match(composer, /Your instructions/u);
  assert.match(server, /projectDiscoveryConversation\(events\)/u);
  assert.match(conversation, /changedSections/u);
});
