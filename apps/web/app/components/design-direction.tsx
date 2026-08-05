"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { LiveConcept, LiveConceptStudio } from "../../experience/contracts";
import type { CustomDesignComposition } from "../../experience/custom-direction";

const API = "http://127.0.0.1:3927";

export type DesignDirectionChoice = Readonly<{
  mode: "recommended" | "alternative" | "other";
  optionId?: string;
  value?: string;
  composition?: CustomDesignComposition;
}>;

type Device = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTH: Readonly<Record<Device, number | null>> = {
  desktop: null,
  tablet: 768,
  mobile: 390,
};

class ConceptApiError extends Error {
  payload: Record<string, unknown>;

  constructor(message: string, payload: Record<string, unknown>) {
    super(message);
    this.payload = payload;
  }
}

async function post(path: string, value: Record<string, unknown> = {}) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new ConceptApiError(String(payload.error ?? `Foundry returned HTTP ${response.status}.`), payload);
  return payload;
}

const COMPOSITION_TRAITS = ["composition", "navigation", "typography", "imagery", "responsive"] as const;

function ConceptPreview({ concept, concepts, missionId, onBack, onSelect, selected, studio }: Readonly<{
  concept: LiveConcept;
  concepts: readonly LiveConcept[];
  missionId: string;
  onBack: () => void;
  onSelect: () => void;
  selected: boolean;
  studio: LiveConceptStudio;
}>) {
  const [device, setDevice] = useState<Device>("desktop");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<"revision" | "composition" | null>(null);
  const [instruction, setInstruction] = useState("");
  const otherConcepts = concepts.filter((entry) => entry.contract.conceptId !== concept.contract.conceptId);
  const [otherId, setOtherId] = useState(otherConcepts[0]?.contract.conceptId ?? "");
  const [traitSources, setTraitSources] = useState<Record<string, string>>({
    composition: concept.contract.conceptId,
    navigation: otherConcepts[0]?.contract.conceptId ?? concept.contract.conceptId,
    typography: otherConcepts[0]?.contract.conceptId ?? concept.contract.conceptId,
    imagery: concept.contract.conceptId,
    responsive: concept.contract.conceptId,
  });
  const [operationError, setOperationError] = useState<string | null>(null);
  const [conflictPayload, setConflictPayload] = useState<Record<string, unknown> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let disposed = false;
    post(`/missions/${missionId}/concepts/${concept.contract.conceptId}/preview`)
      .then((payload) => {
        if (!disposed) setPreviewUrl(String(payload.previewUrl));
      })
      .catch((failure) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => { disposed = true; };
  }, [concept.contract.conceptId, concept.contract.conceptVersion, missionId]);

  async function submitRevision() {
    setSubmitting(true);
    setOperationError(null);
    try {
      await post(`/missions/${missionId}/concepts/${concept.contract.conceptId}/revise`, { instruction });
      setEditor(null);
    } catch (failure) {
      setOperationError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitComposition(resolutions: readonly Readonly<{ trait: string; resolution: string }>[] = []) {
    const selectedTraits = COMPOSITION_TRAITS.map((trait) => ({ trait, conceptId: traitSources[trait] }));
    const sourceConceptIds = [...new Set(selectedTraits.map((entry) => entry.conceptId))];
    if (sourceConceptIds.length < 2) {
      setOperationError("Choose qualities from at least two concepts.");
      return;
    }
    setSubmitting(true);
    setOperationError(null);
    try {
      await post(`/missions/${missionId}/concepts/compose`, {
        compositionId: conflictPayload?.compositionId,
        sourceConceptIds,
        selectedTraits,
        customerNotes: instruction.trim() === "" ? [] : [instruction.trim()],
        conflictResolution: resolutions,
      });
      setConflictPayload(null);
      setEditor(null);
    } catch (failure) {
      if (failure instanceof ConceptApiError && Array.isArray(failure.payload.conflicts)) {
        setConflictPayload(failure.payload);
      } else {
        setOperationError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const width = DEVICE_WIDTH[device];
  return (
    <section className="live-concept-detail" aria-label={`${concept.contract.conceptName} live preview`}>
      <header className="live-concept-detail-head">
        <div>
          <button type="button" className="btn-quiet small" onClick={onBack}>← All concepts</button>
          <p className="t-label ink-tertiary">Live concept · version {concept.contract.conceptVersion}</p>
          <h2 className="t-title-l">{concept.contract.conceptName}</h2>
          <p className="t-body-m ink-secondary">{concept.contract.creativeThesis}</p>
        </div>
        <div className="concept-device-controls" role="group" aria-label="Preview size">
          {(["desktop", "tablet", "mobile"] as const).map((name) => (
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              aria-pressed={device === name}
              key={name}
              onClick={() => setDevice(name)}
            >
              {name[0].toUpperCase() + name.slice(1)}
            </button>
          ))}
        </div>
      </header>

      <div className="live-concept-stage" data-device={device}>
        <div className="live-concept-browser" style={{ width: width === null ? "100%" : `${width}px` }}>
          <div className="live-concept-browser-bar" aria-hidden="true"><span /><span /><span /></div>
          {previewUrl !== null ? (
            <iframe
              title={`${concept.contract.conceptName} interactive prototype`}
              src={previewUrl}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
            />
          ) : error !== null ? (
            <div className="concept-preview-message" role="alert">{error}</div>
          ) : (
            <div className="concept-preview-message" aria-live="polite">Starting the isolated preview…</div>
          )}
        </div>
      </div>

      <div className="live-concept-detail-grid">
        <div>
          <p className="t-label ink-tertiary">Why it works</p>
          <p className="t-body-m">{concept.contract.designRationale}</p>
          <p className="t-body-s ink-secondary">{concept.contract.intendedAudienceResponse}</p>
        </div>
        <div className="concept-detail-actions">
          <button type="button" className="btn btn-primary" onClick={onSelect}>
            {selected ? "Selected concept" : "Select this concept"}
          </button>
          <button type="button" className="btn btn-secondary" data-concept-action="revise" onClick={() => setEditor("revision")}>Revise this concept</button>
          <button type="button" className="btn-quiet" data-concept-action="combine" onClick={() => setEditor("composition")}>Combine with another</button>
        </div>
      </div>

      {editor === "revision" && (
        <section className="concept-evolution-panel" aria-label="Revise this concept">
          <div>
            <p className="t-label">Tell Foundry what to change</p>
            <p className="t-body-s ink-secondary">Only affected design scopes regenerate. Everything else stays bound to this version.</p>
          </div>
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Make the images much larger and reduce the animation." />
          <div className="concept-evolution-actions">
            <button type="button" className="btn btn-primary" disabled={submitting || instruction.trim().length < 2} onClick={() => void submitRevision()}>{submitting ? "Revisingâ€¦" : "Generate revision"}</button>
            <button type="button" className="btn-quiet" onClick={() => setEditor(null)}>Cancel</button>
          </div>
        </section>
      )}

      {editor === "composition" && (
        <section className="concept-evolution-panel" aria-label="Combine concepts">
          <div>
            <p className="t-label">Choose where each quality comes from</p>
            <p className="t-body-s ink-secondary">Foundry checks the combination for conflicts before generating new HTML.</p>
          </div>
          <label className="concept-source-anchor">Combine with
            <select value={otherId} onChange={(event) => {
              const nextId = event.target.value;
              setOtherId(nextId);
              setTraitSources((current) => ({ ...current, navigation: nextId, typography: nextId }));
            }}>
              {otherConcepts.map((entry) => <option value={entry.contract.conceptId} key={entry.contract.conceptId}>{entry.contract.conceptName}</option>)}
            </select>
          </label>
          <div className="concept-trait-grid">
            {COMPOSITION_TRAITS.map((trait) => (
              <label key={trait}>{trait[0].toUpperCase() + trait.slice(1)}
                <select value={traitSources[trait]} onChange={(event) => setTraitSources((current) => ({ ...current, [trait]: event.target.value }))}>
                  {[concept, ...otherConcepts].map((entry) => <option value={entry.contract.conceptId} key={entry.contract.conceptId}>{entry.contract.conceptName}</option>)}
                </select>
              </label>
            ))}
          </div>
          <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Optional note: keep the opening especially spacious." />
          {conflictPayload !== null && Array.isArray(conflictPayload.conflicts) && (
            <div className="concept-conflict" role="alert">
              <p className="t-label">This combination needs one resolution</p>
              {(conflictPayload.conflicts as { trait: string; reason: string; recommendation: string }[]).map((conflict) => (
                <div key={conflict.trait}>
                  <p>{conflict.reason}</p>
                  <p className="ink-secondary">Foundry recommends: {conflict.recommendation}</p>
                </div>
              ))}
              <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void submitComposition((conflictPayload.conflicts as { trait: string; recommendation: string }[]).map((entry) => ({ trait: entry.trait, resolution: entry.recommendation })))}>Use the recommended resolution</button>
            </div>
          )}
          <div className="concept-evolution-actions">
            <button type="button" className="btn btn-primary" disabled={submitting || otherId === ""} onClick={() => void submitComposition()}>{submitting ? "Combiningâ€¦" : "Generate combined concept"}</button>
            <button type="button" className="btn-quiet" onClick={() => setEditor(null)}>Cancel</button>
          </div>
        </section>
      )}

      {operationError !== null && <p className="banner banner-fault" role="alert">{operationError}</p>}
      {studio.evolution?.conceptId === concept.contract.conceptId && studio.evolution.status === "GENERATING" && (
        <p className="banner" aria-live="polite">Foundry is generating and browser-checking the new concept versionâ€¦</p>
      )}
      {studio.evolution?.conceptId === concept.contract.conceptId && studio.evolution.status === "PASSED" && studio.evolution.changedSummary.length > 0 && (
        <aside className="concept-change-summary"><p className="t-label">What changed</p><ul>{studio.evolution.changedSummary.map((item) => <li key={item}>{item}</li>)}</ul></aside>
      )}
      {studio.evolution?.conceptId === concept.contract.conceptId && ["FAILED", "INTERRUPTED"].includes(studio.evolution.status) && (
        <p className="banner banner-fault" role="alert">{studio.evolution.error ?? "The concept change stopped before admission. The prior safe version is still available."}</p>
      )}

      <details className="concept-advanced-evidence">
        <summary>Advanced evidence</summary>
        <dl>
          <div><dt>Content hash</dt><dd>{concept.contentHash.slice(0, 16)}…</dd></div>
          <div><dt>Browser gate</dt><dd>{concept.verificationStatus}</dd></div>
          <div><dt>Responsive proof</dt><dd>Mobile, tablet, and desktop screenshots plus measured DOM evidence</dd></div>
          <div><dt>Runtime safety</dt><dd>Isolated origin, strict CSP, no external network or secrets</dd></div>
        </dl>
      </details>
    </section>
  );
}

export function DesignDirection({
  choice,
  missionId,
  onChange,
  studio,
}: Readonly<{
  choice: DesignDirectionChoice;
  missionId: string;
  onChange: (choice: DesignDirectionChoice) => void;
  studio: LiveConceptStudio | null;
}>) {
  const requested = useRef(false);
  const handledEvolution = useRef<string | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<{
    message: string;
    scope: "generate" | "shock";
  } | null>(null);

  function requestConcepts() {
    requested.current = true;
    setRequestError(null);
    void post(`/missions/${missionId}/concepts/generate`).catch((failure) => {
      setRequestError({
        message: failure instanceof Error ? failure.message : String(failure),
        scope: "generate",
      });
    });
  }

  function requestShockConcept() {
    setRequestError(null);
    void post(`/missions/${missionId}/concepts/shock`).catch((failure) => {
      setRequestError({
        message: failure instanceof Error ? failure.message : String(failure),
        scope: "shock",
      });
    });
  }

  useEffect(() => {
    if (studio === null && !requested.current) requestConcepts();
  });

  const admitted = useMemo(
    () => studio?.concepts.filter((concept) => concept.verificationStatus === "PASSED") ?? [],
    [studio?.concepts],
  );
  const recommended = admitted.find((concept) => concept.contract.conceptId === studio?.recommendedConceptId) ?? admitted[0];
  const opened = admitted.find((concept) => concept.contract.conceptId === openedId) ?? null;

  useEffect(() => {
    const evolution = studio?.evolution;
    if (evolution?.status !== "PASSED" || evolution.completedAt === null || handledEvolution.current === evolution.completedAt) return;
    const evolved = admitted.find((concept) => concept.contract.conceptId === evolution.conceptId);
    if (evolved === undefined) return;
    handledEvolution.current = evolution.completedAt;
    const timer = window.setTimeout(() => {
      setOpenedId(evolved.contract.conceptId);
      onChange({
        mode: "alternative",
        optionId: evolved.contract.conceptId,
        value: evolved.contract.conceptName,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [admitted, onChange, studio?.evolution]);

  function select(concept: LiveConcept) {
    onChange({
      mode: concept.recommended ? "recommended" : "alternative",
      optionId: concept.contract.conceptId,
      value: concept.contract.conceptName,
    });
  }

  if (opened !== null && studio !== null) {
    return (
      <ConceptPreview
        key={`${opened.contract.conceptId}:v${opened.contract.conceptVersion}`}
        concept={opened}
        concepts={admitted}
        missionId={missionId}
        onBack={() => setOpenedId(null)}
        onSelect={() => select(opened)}
        selected={choice.optionId === opened.contract.conceptId}
        studio={studio}
      />
    );
  }

  if (studio === null || studio.status === "GENERATING") {
    return (
      <section className="live-concept-loading" aria-live="polite">
        <p className="t-label ink-tertiary">Live Concept Studio</p>
        <h2 className="t-title-l">Foundry is building three real directions.</h2>
        <p className="t-body-m ink-secondary">
          Each direction is generated as isolated HTML, CSS, and interaction code, then opened in a real browser at mobile, tablet, and desktop sizes. Broken concepts stay hidden.
        </p>
        <div className="concept-generation-progress">
          <span style={{ width: `${Math.max(12, admitted.length * 33)}%` }} />
        </div>
        <p className="t-caption ink-tertiary">{admitted.length} of 3 concepts admitted</p>
        {studio === null && requestError?.scope === "generate" && (
          <div className="banner banner-fault" role="alert">
            <p>{requestError.message}</p>
            <button type="button" className="btn-quiet" onClick={requestConcepts}>Try again</button>
          </div>
        )}
      </section>
    );
  }

  if (studio.status !== "READY") {
    return (
      <section className="design-quality-blocker" role="alert">
        <p className="t-label">Live Concept Studio paused</p>
        <h2 className="t-title-l">Foundry did not produce three safe concepts.</h2>
        <p className="t-body-m">{studio.error ?? "The interrupted concept session can be resumed from its immutable artifacts."}</p>
        <button type="button" className="btn btn-primary" onClick={requestConcepts}>Try concept generation again</button>
      </section>
    );
  }

  return (
    <section className="live-concept-studio">
      <header className="live-concept-masthead">
        <div>
          <p className="t-label ink-tertiary">Live Concept Studio</p>
          <h2 className="t-title-l">Choose the experience Foundry will build.</h2>
          <p className="t-body-m ink-secondary">
            These are working, responsive prototypes—not design descriptions. Open any concept to scroll, resize, and interact with it before choosing.
          </p>
        </div>
        <button
          type="button"
          className="shock-concept-button"
          data-concept-action="shock"
          disabled={studio.evolution?.status === "GENERATING"}
          onClick={requestShockConcept}
        >
          <strong>{studio.evolution?.kind === "shock" && studio.evolution.status === "GENERATING" ? "Creating the surprising directionâ€¦" : "Let Foundry shock me"}</strong>
          <span>This explores a more surprising direction while preserving your project goals.</span>
        </button>
      </header>

      {requestError?.scope === "shock" && <p className="banner banner-fault" role="alert">{requestError.message}</p>}

      {recommended !== undefined && (
        <aside className="concept-recommendation">
          <p className="t-label">Foundry recommends {recommended.contract.conceptName}</p>
          <p className="t-body-s">{studio.recommendationReason}</p>
        </aside>
      )}

      <div className="live-concept-grid" role="radiogroup" aria-label="Live concepts">
        {admitted.map((concept) => {
          const selected = choice.optionId === concept.contract.conceptId ||
            (choice.optionId === undefined && concept.contract.conceptId === recommended?.contract.conceptId);
          return (
            <article className="live-concept-card" data-selected={selected} key={concept.contract.conceptId}>
              <button type="button" className="concept-thumbnail" onClick={() => setOpenedId(concept.contract.conceptId)}>
                {/* Evidence images are immutable local API artifacts, not optimization candidates. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {concept.thumbnailUrl !== null && <img src={concept.thumbnailUrl} alt={`Desktop view of ${concept.contract.conceptName}`} />}
                <span>Open live concept</span>
              </button>
              <div className="live-concept-card-body">
                <div className="live-concept-card-title">
                  <h3 className="t-title-s">{concept.contract.conceptName}</h3>
                  {concept.recommended && <span className="badge">Recommended</span>}
                </div>
                <p className="t-body-s">{concept.contract.creativeThesis}</p>
                <p className="t-caption ink-secondary"><b>Different because</b> {concept.keyDistinction}</p>
                <p className="t-caption ink-secondary"><b>Tradeoff</b> {concept.tradeoff}</p>
                <div className="live-concept-card-actions">
                  <button type="button" className="btn btn-secondary btn-compact" onClick={() => setOpenedId(concept.contract.conceptId)}>Open</button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className="btn-quiet small"
                    onClick={() => select(concept)}
                  >
                    {selected ? "Selected" : "Select"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <details className="concept-advanced-evidence">
        <summary>Advanced generation evidence</summary>
        <p>{studio.generation.inputTokens + studio.generation.outputTokens} tokens · ${studio.generation.costUsd.toFixed(4)} estimated model cost</p>
        <p>Every displayed concept passed runtime, browser-error, overflow, responsive, accessibility, isolation, and differentiation admission.</p>
      </details>
    </section>
  );
}
