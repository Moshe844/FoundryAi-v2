# Foundry experience

This is the domain-agnostic localhost Foundry product. Arbitrary web-project
descriptions are sent to the local production API, interpreted by a live
routed model into a persisted `ProjectProfile`, clarified only when
architecture changes, contracted, executed, observed, and verified through the
existing Foundry authorities.

The browser owns no mission state. Recent missions, activity, contracts, and
preview availability are replayed from the Mission Ledger and existing
services. The provider panel exposes status only; credentials remain inside
the local server process.

## Local development

```powershell
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:3000/`. `npm.cmd run dev` starts the browser shell and
the local API on port 3927.

## Validation

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd audit --omit=dev
```

The tests build the production worker, verify server-rendered routes, enforce
responsive/accessibility foundations, require the live API boundary, reject
keyword/localStorage simulation, reject mock preview routes, and reject
certification-domain vocabulary in production UX source.
