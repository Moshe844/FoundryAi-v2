# Live HTML Concept Studio architecture

This is the final Layer 3 design authority. It does not begin Milestone 11.

## Authority boundary

The written Project Design and its visual-direction alternatives remain discovery inputs. They are not customer-approved design evidence and cannot activate production fidelity gates.

The design authority progresses through three immutable records:

1. `ConceptPrototypeContract` defines one runnable, isolated concept and the checks it must pass before a customer can see it.
2. `ConceptComposition` records versioned trait selection and conflict resolution when concepts are combined.
3. `ApprovedDesignContract` freezes the selected concept version, its file manifest, screenshots, browser evidence, extracted design system, customer changes, and approval time.

Only an `ApprovedDesignContract` may activate strict production design binding and fidelity verification.

## Runtime and persistence boundary

Prototype workspaces live below a dedicated root and never share a production workspace:

```text
prototype-root/
  <mission-id>/
    <concept-id>/
      v<concept-version>/
        manifest.json
        source/
        evidence/
```

Each concept version receives a separate workspace identity, immutable source manifest, content hash, runtime session, evidence references, timestamps, and retention status. Runtime state and UI state are projections of persisted concept records; React state is never authoritative.

The certified prototype stack is a static semantic HTML/CSS/ES-module application served by a restricted local runtime. It has no database, package installation, environment secrets, external scripts, or network access. The production execution engine remains responsible for model routing, file admission, workspace writes, command/runtime lifecycle, browser verification, evidence, retry limits, and cleanup.

## Stage gates

- A: immutable domain contracts, compatibility gate, and failing-first tests
- B: prototype workspace and lifecycle persistence
- C: routed generation and safe file admission
- D: sandbox, CSP, browser evidence, and quality authority
- E: Studio preview and selection experience
- F: revision and composition
- G: high-originality `shock` strategy
- H: approval extraction and immutable evidence
- I: production prompt and execution binding
- J: deterministic desktop/tablet/mobile fidelity comparison
- K: bounded, scoped design repair
- L: required live certification matrix
- M: regression, cleanup, limitations, and Milestone 11 readiness decision

Every stage is committed only after its scoped tests pass. A later stage cannot weaken an earlier authority boundary.
