import assert from "node:assert/strict";
import test from "node:test";

import {
  ENGINEERING_FLOOR_OBLIGATIONS_ENABLED,
  EngineeringSignal,
  detectEngineeringSignals,
  engineeringFloorPromptSegments,
  engineeringFloorVerificationEntries,
  validateEngineeringFloor,
} from "../src/domain/engineering-floor.js";

function profile(overrides = {}) {
  return {
    name: "Test Project",
    summary: "A project.",
    primaryJourneys: [],
    outcomes: [],
    dataConcepts: [],
    proposedFeatures: [],
    capabilities: ["web-application"],
    ...overrides,
  };
}

const files = (content) => [{ path: "app/api/route.ts", content }];

test("signals are detected from the project description, not a fixed taxonomy", () => {
  const booking = detectEngineeringSignals(
    profile({
      summary: "Clients book an appointment and can cancel it later.",
      primaryJourneys: ["A client submits a booking request"],
    }),
  );
  assert.ok(booking.has(EngineeringSignal.USER_INPUT));
  assert.ok(booking.has(EngineeringSignal.DESTRUCTIVE));
  assert.ok(booking.has(EngineeringSignal.ALWAYS));
  assert.ok(!booking.has(EngineeringSignal.CREDENTIALS));

  const shop = detectEngineeringSignals(
    profile({ summary: "Customers checkout and pay by card.", dataConcepts: ["Order"] }),
  );
  assert.ok(shop.has(EngineeringSignal.PAYMENT));

  const gallery = detectEngineeringSignals(
    profile({ summary: "An artist uploads photos of their work." }),
  );
  assert.ok(gallery.has(EngineeringSignal.UPLOAD));

  // Persistence is inferred from declared capability too.
  const portal = detectEngineeringSignals(
    profile({ capabilities: ["web-application", "sqlite-persistence"] }),
  );
  assert.ok(portal.has(EngineeringSignal.PERSISTENCE));
});

test("a stored credential must be hashed regardless of declared capabilities", () => {
  // The real defect: the profile declared no persistence capability, yet the
  // build persisted passwords. A capability-gated rule would miss it.
  const signals = detectEngineeringSignals(
    profile({ summary: "Admins sign in with a password." }),
  );
  assert.ok(!signals.has(EngineeringSignal.PERSISTENCE));

  const plaintext = files(`
    db.exec("CREATE TABLE IF NOT EXISTS admins (id INTEGER, email TEXT, password TEXT)");
    db.prepare('INSERT INTO admins (email, password) VALUES (?, ?)').run(email, password);
  `);
  assert.throws(
    () => validateEngineeringFloor(plaintext, signals),
    /credentials-are-hashed/u,
  );

  const hashed = files(`
    import { randomBytes, scryptSync } from 'node:crypto';
    db.exec("CREATE TABLE IF NOT EXISTS admins (id INTEGER, email TEXT, password TEXT)");
    const salt = randomBytes(16).toString('hex');
    const digest = scryptSync(password, salt, 64).toString('hex');
    db.prepare('INSERT INTO admins (email, password) VALUES (?, ?)').run(email, salt + ':' + digest);
  `);
  assert.doesNotThrow(() => validateEngineeringFloor(hashed, signals));
});

test("a project that stores no credential is never asked to hash one", () => {
  const signals = detectEngineeringSignals(
    profile({ summary: "Visitors sign in to read articles.", capabilities: ["web-application", "sqlite-persistence"] }),
  );
  const noCredentialStorage = files(`
    db.prepare('INSERT INTO articles (title, body) VALUES (?, ?)').run(title, body);
  `);
  assert.doesNotThrow(() => validateEngineeringFloor(noCredentialStorage, signals));
});

test("SQL values must be bound, not interpolated", () => {
  const signals = detectEngineeringSignals(
    profile({ capabilities: ["web-application", "sqlite-persistence"] }),
  );
  assert.throws(
    () => validateEngineeringFloor(files("db.prepare(`SELECT * FROM orders WHERE id = ${id}`).get();"), signals),
    /sql-is-parameterized/u,
  );
  assert.doesNotThrow(() =>
    validateEngineeringFloor(files("db.prepare('SELECT * FROM orders WHERE id = ?').get(id);"), signals),
  );
});

test("literal secrets are rejected in every project type", () => {
  const signals = detectEngineeringSignals(profile());
  assert.throws(
    () => validateEngineeringFloor(files("const apiKey = 'sk_live_9f8a7b6c5d4e3f2a1b0c';"), signals),
    /no-embedded-secrets/u,
  );
  assert.doesNotThrow(() =>
    validateEngineeringFloor(files("const apiKey = process.env.API_KEY;"), signals),
  );
});

test("card data is never persisted", () => {
  const signals = detectEngineeringSignals(
    profile({ summary: "Customers pay by card at checkout.", capabilities: ["web-application", "sqlite-persistence"] }),
  );
  assert.throws(
    () => validateEngineeringFloor(files("db.prepare('INSERT INTO payments (card_number, cvv) VALUES (?, ?)').run(n, c);"), signals),
    /no-card-data-at-rest/u,
  );
  assert.doesNotThrow(() =>
    validateEngineeringFloor(files("db.prepare('INSERT INTO payments (provider_reference) VALUES (?)').run(ref);"), signals),
  );
});

test("test fixtures are not held to the product source rules", () => {
  const signals = detectEngineeringSignals(profile({ summary: "Admins sign in with a password." }));
  const onlyInTests = [
    { path: "tests/auth.spec.ts", content: "db.prepare('INSERT INTO admins (password) VALUES (?)').run('literal');" },
  ];
  assert.doesNotThrow(() => validateEngineeringFloor(onlyInTests, signals));
});

test("behavioural guarantees are defined but gated until Foundry owns the test harness", () => {
  // Each behavioural guarantee becomes another check the model-written browser
  // test must compute, and that test already satisfies fifty admission gates.
  // Turning four on at once pushed it past what the generator could write, so
  // builds began failing before they reached verification. The rules stay
  // defined; the flag is the single switch that re-arms them.
  const signals = detectEngineeringSignals(profile({ summary: "Admins sign in with a password." }));
  const entries = engineeringFloorVerificationEntries("Admin Portal", signals);

  if (ENGINEERING_FLOOR_OBLIGATIONS_ENABLED) {
    const requirements = entries.map((entry) => entry.sourceRequirement);
    assert.ok(requirements.includes("engineering-floor-session-end"));
    assert.ok(requirements.includes("engineering-floor-protected-access"));
    for (const entry of entries) {
      assert.equal(entry.acceptanceMethod, "browser-check");
      assert.equal(entry.origin, "foundry-derived");
      assert.ok(entry.evidenceRequired.length > 0);
    }
  } else {
    assert.deepEqual(entries, [], "gated off, no obligation may reach the contract");
  }
});

test("the source floor is always stated to the generator, gated or not", () => {
  // Source rules cost the browser test nothing, so they are never gated: the
  // plaintext-credential defect stays caught either way.
  const signals = detectEngineeringSignals(profile({ summary: "Admins sign in with a password." }));
  const segments = engineeringFloorPromptSegments(signals).join("\n");
  assert.match(segments, /irreversibly hashed/u);
  assert.match(segments, /admission rejects a bundle that violates one/u);
  assert.equal(
    /end their session/u.test(segments),
    ENGINEERING_FLOOR_OBLIGATIONS_ENABLED,
    "a behaviour must be stated only while it is also verified",
  );
});

test("the floor scales with what a project does, not with whether it has a login", () => {
  // The obligations must not read as an authentication feature. A read-only
  // page earns one guarantee; a product that takes input, deletes things, and
  // holds credentials earns several. Vocabulary alone left a checkout and a
  // stock tracker with no server-validation obligation, so input-bearing
  // signals now imply user input outright.
  const floor = (summary, capabilities = ["web-application"]) =>
    engineeringFloorVerificationEntries(
      "Project",
      detectEngineeringSignals(profile({ summary, capabilities })),
    ).map((entry) => entry.sourceRequirement.replace("engineering-floor-", ""));

  if (!ENGINEERING_FLOOR_OBLIGATIONS_ENABLED) {
    // Gated off, nothing reaches the contract; the shape below is what the
    // rules produce once the harness can observe them without asking the model
    // for another assertion each.
    assert.deepEqual(floor("A menu of dishes with prices and opening hours."), []);
    return;
  }

  // Every project, however simple, must fail honestly.
  assert.deepEqual(floor("A menu of dishes with prices and opening hours."), ["safe-errors"]);

  // Anything that accepts input must reject it server-side, whatever words
  // the description used for "input".
  for (const summary of [
    "Staff add stock items and update quantities.",
    "Customers pay by card at checkout.",
    "Colleagues write and edit shared reference pages.",
    "Visitors post suggestions and browse what others submitted.",
    "An artist uploads photos of their work.",
  ]) {
    assert.ok(
      floor(summary, ["web-application", "sqlite-persistence"]).includes("server-validation"),
      `server-validation missing for: ${summary}`,
    );
  }

  // Removing data requires confirmation, in any product.
  assert.ok(
    floor("Staff remove discontinued items.", ["web-application", "sqlite-persistence"])
      .includes("destructive-confirmation"),
  );

  // The two credential guarantees appear only where credentials do.
  const auth = floor("Admins sign in with a password.");
  assert.ok(auth.includes("session-end"));
  assert.ok(auth.includes("protected-access"));
  const brochure = floor("A gallery of finished work with a contact form.");
  assert.ok(!brochure.includes("session-end"));
  assert.ok(!brochure.includes("protected-access"));
});

test("a record cannot be destroyed without an explicit confirmation", () => {
  // A delivered build wired a Remove control straight to a DELETE request:
  // one click and the record was gone. It was contract-correct — that run's
  // obligation read "staff can remove discontinued items", where the same
  // request on an earlier run produced "after a clear confirmation step". A
  // safety property must not depend on which words the understanding phase
  // chose, so this is read from the source and costs the browser test nothing.
  const signals = detectEngineeringSignals(
    profile({ summary: "Staff remove discontinued items.", capabilities: ["web-application", "sqlite-persistence"] }),
  );

  const unconfirmed = files(
    "<button aria-label={`Remove ${item.name}`} onClick={()=>send('DELETE',{id:item.id})}>Remove</button>",
  );
  assert.throws(
    () => validateEngineeringFloor(unconfirmed, signals),
    /destructive-actions-are-confirmed/u,
  );

  // Any deliberate second step satisfies it, in the shapes a real project uses.
  for (const confirmed of [
    "<button onClick={()=>{ if (confirm('Remove ' + item.name + '?')) send('DELETE',{id:item.id}) }}>Remove</button>",
    "const [removing,setRemoving]=useState(null); <button onClick={()=>setRemoving(item)}>Remove</button>{removing&&<div role='dialog' aria-modal='true'><button onClick={()=>send('DELETE',{id:removing.id})}>Confirm</button></div>}",
    "const [pendingDelete,setPendingDelete]=useState(null); async function reallyDelete(){ await fetch('/api/items',{method:'DELETE'}) }",
  ]) {
    assert.doesNotThrow(
      () => validateEngineeringFloor(files(confirmed), signals),
      confirmed.slice(0, 60),
    );
  }

  // A project that never deletes anything is not asked to confirm one, and the
  // rule applies whether or not the description mentioned removal.
  assert.doesNotThrow(() =>
    validateEngineeringFloor(files("export default function P(){return <main><h1>Menu</h1></main>}"), signals),
  );
  const noMentionOfRemoval = detectEngineeringSignals(
    profile({ summary: "A dashboard of current stock levels." }),
  );
  assert.throws(
    () => validateEngineeringFloor(unconfirmed, noMentionOfRemoval),
    /destructive-actions-are-confirmed/u,
  );
});

// The signup that passed fifteen of fifteen checks while creating no account:
// its submit handler validated the fields and ran setState('success'), and the
// product contained no fetch at all. Both defects below are read from that
// delivered file.
const FAKE_SUCCESS_SIGNUP = `'use client';
import { FormEvent, useState } from 'react';
export default function AccessPage() {
  const [name,setName]=useState(''); const [errors,setErrors]=useState({});
  const [state,setState]=useState('form');
  const submit=(event: FormEvent)=>{event.preventDefault();
    const e={}; if(!name.trim()) e.name='Enter your name.';
    setErrors(e); if(Object.keys(e).length===0) setState('success');};
  return <form onSubmit={submit}><input onChange={(event)=>setName(event.target.value)} />
    {state==='success' && <p>Access confirmed.</p>}</form>;
}`;

test("a form that announces success without sending anything is a floor violation", () => {
  assert.throws(
    () =>
      validateEngineeringFloor(
        [{ path: "app/page.tsx", content: FAKE_SUCCESS_SIGNUP }],
        new Set([EngineeringSignal.ALWAYS]),
      ),
    /completed-work-outlives-the-click/u,
  );
});

test("an unused persistence helper elsewhere does not excuse the form", () => {
  assert.throws(
    () =>
      validateEngineeringFloor(
        [
          { path: "app/page.tsx", content: FAKE_SUCCESS_SIGNUP },
          { path: "lib/db.ts", content: "export const db = createClient('sqlite');" },
        ],
        new Set([EngineeringSignal.ALWAYS]),
      ),
    /completed-work-outlives-the-click/u,
  );
});

test("a form that posts its values clears the persistence floor", () => {
  const posts = FAKE_SUCCESS_SIGNUP.replace(
    "setState('success')",
    "fetch('/api/accounts',{method:'POST'}).then(()=>setState('success'))",
  );
  assert.doesNotThrow(() =>
    validateEngineeringFloor(
      [{ path: "app/page.tsx", content: posts }],
      new Set([EngineeringSignal.ALWAYS]),
    ),
  );
});

test("validation errors that are never cleared while typing are a floor violation", () => {
  assert.throws(
    () =>
      validateEngineeringFloor(
        [{ path: "app/page.tsx", content: FAKE_SUCCESS_SIGNUP }],
        new Set([EngineeringSignal.USER_INPUT]),
      ),
    /validation-errors-clear-as-you-type/u,
  );
});

test("clearing the field's error in its onChange satisfies the floor", () => {
  const clears = FAKE_SUCCESS_SIGNUP.replace(
    "onChange={(event)=>setName(event.target.value)}",
    "onChange={(event)=>{setName(event.target.value);setErrors({});}}",
  );
  assert.doesNotThrow(() =>
    validateEngineeringFloor(
      [{ path: "app/page.tsx", content: clears }],
      new Set([EngineeringSignal.USER_INPUT]),
    ),
  );
});

test("a search form that filters a list on submit is not mistaken for a success screen", () => {
  const search = `'use client';
import { FormEvent, useState } from 'react';
export default function Catalogue() {
  const [query,setQuery]=useState(''); const [results,setResults]=useState([]);
  const submit=(event: FormEvent)=>{event.preventDefault();
    setResults(ITEMS.filter((item)=>item.name.includes(query)));};
  return <form onSubmit={submit}><input onChange={(event)=>setQuery(event.target.value)} /></form>;
}`;
  assert.doesNotThrow(() =>
    validateEngineeringFloor(
      [{ path: "app/page.tsx", content: search }],
      new Set([EngineeringSignal.ALWAYS, EngineeringSignal.USER_INPUT]),
    ),
  );
});

test("a field FormData cannot read is a floor violation", () => {
  // A delivered signup rejected valid input every time: the handler read
  // FormData.get("email") while the input carried only id="email". FormData is
  // keyed by name, so the value was always null and the request never left.
  const unnamed = `'use client';
export default function Access() {
  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '');
    if (!/^\S+@\S+$/.test(email)) return;
    await fetch('/api/auth', { method: 'POST' });
  };
  return <form onSubmit={submit}><input id="email" type="email" onChange={() => {}} /></form>;
}`;
  assert.throws(
    () =>
      validateEngineeringFloor(
        [{ path: "app/page.tsx", content: unnamed }],
        new Set([EngineeringSignal.USER_INPUT]),
      ),
    /submitted-fields-reach-the-handler/u,
  );

  const named = unnamed.replace('<input id="email"', '<input name="email" id="email"');
  assert.doesNotThrow(() =>
    validateEngineeringFloor(
      [{ path: "app/page.tsx", content: named }],
      new Set([EngineeringSignal.USER_INPUT]),
    ),
  );
});

test("a .get call that is not a FormData read is left alone", () => {
  // Map and URLSearchParams both have .get; only a file that builds a FormData
  // is judged by this rule.
  const usesAMap = `const cache = new Map(); const value = cache.get('email');
export default function Page(){ return <input id="email" />; }`;
  assert.doesNotThrow(() =>
    validateEngineeringFloor(
      [{ path: "app/page.tsx", content: usesAMap }],
      new Set([EngineeringSignal.USER_INPUT]),
    ),
  );
});
