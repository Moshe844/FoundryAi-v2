# Foundry model-registry governance audit

Audit date: 2026-07-31

## Finding

The registry previously collapsed three different facts into one `ModelManifest`:

1. the provider account returned a model from its catalog;
2. the model was current and compatible with Foundry's endpoint contract;
3. the model was appropriate for general software-engineering work.

The live adapters inferred all three from a broad name prefix or from the presence of `generateContent`. They then assigned generic coding, architecture, planning, debugging, and reasoning scores and zero-dollar pricing. The router correctly consumed those manifests, but the manifests were not trustworthy.

## Exact origin of the reported selections

- `gpt-5.2-pro` first entered the append-only AI registry at sequence 325 on 2026-07-30T14:43:59.332Z and was rediscovered 51 times. Its last pre-audit refresh was sequence 631 on 2026-07-31T17:14:24.084Z. It came from the authenticated OpenAI `/v1/models` response; the old `gpt-` prefix rule incorrectly converted catalog presence into full engineering eligibility.
- `gemini-robotics-er-1.6-preview` first entered at sequence 329 and was rediscovered 50 times. `gemini-robotics-er-2-preview` first entered at sequence 335 and was rediscovered 49 times. They came from the authenticated Gemini models catalog. The old rule treated `generateContent` plus non-legacy status as proof of general reasoning suitability, even though the provider documents Robotics-ER as a robotics and spatial-action model.

These were not fixture IDs and were not inserted by the UI. Their display was historically truthful as provider discoveries; their classification as routable engineering models was not.

## Historical call audit

The immutable mission ledgers contain:

- 224 model-call records;
- 300 route attempts;
- 63 distinct provider/model IDs;
- 1,013,725 recorded input tokens and 531,549 recorded output tokens;
- 13 specialized model IDs used in 20 attempts, including robotics, image, computer-use, deep-research, and omni variants;
- 5 moving `latest` aliases used in 5 attempts;
- 7 attempts across the three reported audited Robotics-ER and GPT-5.2 Pro IDs, including 4 superficially successful Robotics-ER 2 responses;
- `$0` recorded cost for every call because the old manifests and live usage adapter hard-coded cost to zero.

A provider returning syntactically valid output does not retroactively make an inappropriate route suitable. Historical route and result records remain unchanged.

## Corrected trust boundary

The current implementation persists and exposes three separate layers:

- **DiscoveredModel** retains provider/account accessibility, raw catalog metadata, source endpoint, observation time, and identity.
- **ValidatedModel** records purpose, lifecycle, release channel, endpoint compatibility, validation status, reasons, policy version, freshness limit, and official sources.
- **EngineeringEligibleModel** exists only after validation succeeds. It records allowed task classes, capability aliases, eligibility reasons, pricing provenance, and the normalized execution manifest.

The registry now exposes the complete lifecycle state machine: `DISCOVERED`, `VALIDATING`, `ACTIVE_STABLE`, `ACTIVE_PREVIEW`, `EXPERIMENTAL`, `DEPRECATED`, `SHUTDOWN`, `INACCESSIBLE`, `UNVERIFIED`, and `QUARANTINED`. Only `ACTIVE_STABLE` plus a successful engineering validation can be projected into normal routing. Preview, experimental, deprecated, shutdown, inaccessible, unverifiable, and quarantined records remain visible for audit but cannot silently replace a stable model.

Unknown purpose, non-active lifecycle, preview/experimental/moving-alias channels, incompatible endpoints, unmatched current family policy, stale validation, or unknown cost under a cost ceiling fail closed. Specialized models remain visible in the connected catalog and cannot enter the engineering router.

## Authoritative policy sources

- OpenAI model catalog, current-model guidance, and deprecations: `https://developers.openai.com/api/docs/models`, `https://developers.openai.com/api/docs/guides/latest-model`, `https://developers.openai.com/api/docs/deprecations`
- Anthropic Models API, lifecycle, versioning, and pricing: `https://platform.claude.com/docs/en/api/models/list`, `https://platform.claude.com/docs/en/about-claude/model-deprecations`, `https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions`, `https://platform.claude.com/docs/en/about-claude/pricing`
- Gemini model catalog, lifecycle, Robotics-ER, and pricing: `https://ai.google.dev/gemini-api/docs/models`, `https://ai.google.dev/gemini-api/docs/deprecations`, `https://ai.google.dev/gemini-api/docs/robotics-overview`, `https://ai.google.dev/gemini-api/docs/pricing`

The policy snapshot is dated and has a seven-day maximum age. Discovery never refreshes that documentation timestamp by itself.

## Phase 6 refresh and lifecycle controls

Foundry now refreshes provider catalogs and lifecycle evidence at startup, on a daily schedule, and through the manual provider-validation action. Concurrent requests share one in-flight refresh so they cannot create overlapping catalog writes.

Each successful provider refresh records an immutable event containing its exact provider, discovery ID, event ID, and observation timestamp. That timestamp survives a process restart and drives a 24-hour catalog freshness boundary. Automatic routing fails closed after the boundary until a successful refresh completes.

Lifecycle notices are ingested from the official deprecation pages listed above. Foundry persists the normalized notices, fetch time, source URL, and a SHA-256 content hash—not a mutable copy of the provider document. A fresh cached official result is used during a transient source outage; otherwise the dated bundled governance policy remains explicit in the projection rather than masquerading as a live provider result.

If a previously observed model disappears from a later provider response, Foundry preserves its identity, raw historical observations, `lastSeenAt`, and `missingSince`. It moves the current validation projection to `QUARANTINED` pending validation and removes the model from automatic routing. It is never silently deleted, and historical route facts remain untouched.

## Phase 7 capability-driven routing

Every production model task now resolves through a versioned capability contract. Governed models carry explicit capability-support evidence derived from validated purpose, provider catalog metadata, and the maintained engineering-family policy. Routing requires that evidence as well as the configured score threshold; a broad numeric score alone cannot qualify a model.

Live execution consumes the router's exact candidate order. All candidates completely satisfy the task contract before persisted task-specific reliability, cost, and latency are considered. Capability aliases no longer act as an eligibility shortcut. The chosen route records the merged requirements and candidate facts in immutable route evidence.
