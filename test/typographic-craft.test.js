import assert from "node:assert/strict";
import test from "node:test";

import { typographicCraftIssues } from "../src/domain/typographic-craft.js";

// Lifted from the delivered build the customer called ugly: a coherent
// editorial composition whose buttons, inputs and labels were all set in
// Georgia at 12-16px.
const DELIVERED_UGLY = `:root{--paper:#f5efe5;--ink:#332a24;--accent:#b84a32}
body{background:var(--paper);color:var(--ink);font-family:Georgia,serif}
.welcome h1{font-family:Georgia,serif;font-size:clamp(52px,7vw,94px);line-height:.91}
.mode button,.textButton{appearance:none;border:0;cursor:pointer;font:600 13px Georgia,serif}
input{width:100%;padding:13px 12px;font:16px Georgia,serif}
@media(max-width:720px){.page{padding:24px 20px}}`;

test("a display face on the interface layer is reported", () => {
  const issues = typographicCraftIssues(DELIVERED_UGLY);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /georgia/u);
});

test("the report names the selectors at fault, not just the fact", () => {
  const [issue] = typographicCraftIssues(DELIVERED_UGLY);
  assert.match(issue, /\.mode button,\.textButton/u);
  assert.match(issue, /"input"/u);
});

test("the font shorthand's weight is not mistaken for its size", () => {
  // `font: 600 13px Georgia, serif` -- reading the first number as the size
  // takes the family to be "13px" and the defect goes unseen.
  assert.equal(typographicCraftIssues("button{font:600 13px Georgia,serif}").length, 1);
  assert.equal(
    typographicCraftIssues("label{font:italic small-caps bold 14px/1.4 Palatino,serif}").length,
    1,
  );
});

test("a display face kept to headings over a sans interface is left alone", () => {
  const split = `body{font-family:Georgia,serif;color:#1a1a1a}
h1,h2{font-family:Georgia,serif;font-size:64px;letter-spacing:-.03em}
input,button,label,small{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px}`;
  assert.deepEqual(typographicCraftIssues(split), []);
});

test("a concept that never restyles its controls is left alone", () => {
  assert.deepEqual(
    typographicCraftIssues(`body{font-family:ui-sans-serif,system-ui}h1{font-size:60px}`),
    [],
  );
});

test("font:inherit on a control adopts the document face and is judged by it", () => {
  assert.equal(
    typographicCraftIssues(`body{font-family:Georgia,serif}input,button{font:inherit}`).length,
    1,
  );
  assert.deepEqual(
    typographicCraftIssues(`body{font-family:ui-sans-serif,system-ui}input,button{font:inherit}`),
    [],
  );
});

test("a monospace interface is a legitimate choice", () => {
  assert.deepEqual(
    typographicCraftIssues(`input,button{font-family:ui-monospace,Menlo,monospace}`),
    [],
  );
});

test("empty or absent stylesheets report nothing", () => {
  assert.deepEqual(typographicCraftIssues(""), []);
  assert.deepEqual(typographicCraftIssues(undefined), []);
});
