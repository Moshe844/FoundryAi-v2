import assert from "node:assert/strict";
import test from "node:test";

import {
  hasBalancedJavaScriptDelimiters,
  hasBalancedJsxTags,
} from "../src/work-plane/production-mission-service.js";

test("JSX admission accepts nested controls that directly follow text", () => {
  const source = `
    import type { FormEvent } from "react";
    async function submit(event: FormEvent<HTMLFormElement>): Promise<string> {
      event.preventDefault();
      return "ok";
    }
    export default function Page() {
      return <main><form onSubmit={submit}><label>Name<input required /></label><label>Project type<select><option>Campaign</option></select></label></form></main>;
    }
  `;

  assert.equal(hasBalancedJsxTags(source), true);
});

test("JSX admission still rejects a genuinely mismatched nested tag", () => {
  assert.equal(
    hasBalancedJsxTags("export default function Page(){return <main><label>Name<input /></main>}"),
    false,
  );
});

test("delimiter admission accepts apostrophes in rendered JSX text", () => {
  assert.equal(
    hasBalancedJavaScriptDelimiters(
      "export default function Page(){return <p>We'll be in touch soon.</p>}",
    ),
    true,
  );
});

test("delimiter admission still rejects an unescaped apostrophe in a JavaScript string", () => {
  assert.equal(
    hasBalancedJavaScriptDelimiters("const title = 'photographer's work';"),
    false,
  );
});
