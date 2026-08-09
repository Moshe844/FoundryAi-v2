import assert from "node:assert/strict";
import test from "node:test";

import {
  checkBodies,
  collusiveCheckIssues,
} from "../src/domain/observation-independence.js";

// Verbatim from a delivered dashboard. "Open tickets" counted everything not
// closed, so three open, two pending and one closed reported five open --
// and this check passed, because filtering to Pending leaves two non-closed
// rows. Counting rows actually marked Open would have read 0 and failed.
const COLLUDING = `'obligation-005':async({page}:C)=>{let correct=false;const d:Record<string,boolean|string>={correct:false};try{await page.locator('#status').selectOption('Pending');correct=await page.getByTestId('open-count').textContent().then((s:string|null)=>s==='2');d.correct=correct}catch(e:unknown){d.error=fail(e)}return{passed:correct,diagnostics:d}},`;

// From the same build, and correct: the expected row count comes from counting
// what the page rendered, not from a number the author decided on.
const DERIVED = `'obligation-004':async({page}:C)=>{let filtered=false;const d:Record<string,boolean|string>={filtered:false};try{await page.locator('#customer').fill('Avery');filtered=await page.locator('tbody tr').count()===1&&await page.locator('tbody').innerText().then((s:string)=>s.includes('Avery'));d.filtered=filtered}catch(e:unknown){d.error=fail(e)}return{passed:filtered,diagnostics:d}},`;

test("a displayed number settled against a literal is reported", () => {
  const issues = collusiveCheckIssues(COLLUDING);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /obligation-005/u);
  assert.match(issues[0], /passes whenever the code is consistently wrong/u);
});

test("the report says what to do instead, not merely that it is wrong", () => {
  const [issue] = collusiveCheckIssues(COLLUDING);
  assert.match(issue, /count the elements that genuinely satisfy the condition/u);
});

test("a check that counts what the page rendered is left alone", () => {
  assert.deepEqual(collusiveCheckIssues(DERIVED), []);
});

test("reading back a value the test itself typed is a round trip, not collusion", () => {
  // fill('7') then inputValue()==='7' takes its expectation from the test's own
  // hand. Weak, but not the defect -- and rejecting it would send a correct
  // check back to be rewritten.
  const roundTrip = `'obligation-002':c=>check(c,async p=>{const i=p.getByLabel(/Quantity/).first();await i.fill('7');await i.blur();return await i.inputValue()==='7'}),`;
  assert.deepEqual(collusiveCheckIssues(roundTrip), []);
});

test("a check asserting text that is not a number is untouched", () => {
  const label = `'obligation-003':async({page}:C)=>{return await page.getByRole('heading').textContent().then((s:string|null)=>s==='Tickets')},`;
  assert.deepEqual(collusiveCheckIssues(label), []);
});

test("toHaveText against a bare number is the same defect in another spelling", () => {
  const assertion = `'obligation-007':async({page,expect}:C)=>{await expect(page.getByTestId('total')).toHaveText('12');return true},`;
  assert.equal(collusiveCheckIssues(assertion).length, 1);
});

test("deriving with evaluate counts as deriving", () => {
  const evaluated = `'obligation-008':async({page}:C)=>{const expected=await page.evaluate(()=>document.querySelectorAll('tr[data-open]').length);const shown=Number(await page.getByTestId('open-count').textContent());return shown===expected},`;
  assert.deepEqual(collusiveCheckIssues(evaluated), []);
});

test("checks are split so one check's derivation cannot excuse another", () => {
  const both = DERIVED + COLLUDING;
  assert.equal(checkBodies(both).length, 2);
  const issues = collusiveCheckIssues(both);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /obligation-005/u);
});
