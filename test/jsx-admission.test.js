import assert from "node:assert/strict";
import test from "node:test";

import { hasBalancedJsxTags } from "../src/work-plane/production-mission-service.js";

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
