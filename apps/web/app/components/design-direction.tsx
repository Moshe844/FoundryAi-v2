"use client";

import { useEffect, useRef, useState } from "react";

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

async function post(path: string) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? `Foundry returned HTTP ${response.status}.`);
  return payload;
}

function ConceptPreview({ concept, missionId, onBack, onSelect, selected }: Readonly<{
  concept: LiveConcept;
  missionId: string;
  onBack: () => void;
  onSelect: () => void;
  selected: boolean;
}>) {
  const [device, setDevice] = useState<Device>("desktop");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    post(`/missions/${missionId}/concepts/${concept.contract.conceptId}/preview`)
      .then((payload) => {
        if (!disposed) setPreviewUrl(payload.previewUrl);
      })
      .catch((failure) => {
        if (!disposed) setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => { disposed = true; };
  }, [concept.contract.conceptId, missionId]);

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
          <button type="button" className="btn btn-secondary" data-concept-action="revise">Revise this concept</button>
          <button type="button" className="btn-quiet" data-concept-action="combine">Combine with another</button>
        </div>
      </div>

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
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);

  function requestConcepts() {
    requested.current = true;
    setRequestError(null);
    void post(`/missions/${missionId}/concepts/generate`).catch((failure) => {
      requested.current = false;
      setRequestError(failure instanceof Error ? failure.message : String(failure));
    });
  }

  useEffect(() => {
    if (studio === null && !requested.current) requestConcepts();
  });

  const admitted = studio?.concepts.filter((concept) => concept.verificationStatus === "PASSED") ?? [];
  const recommended = admitted.find((concept) => concept.contract.conceptId === studio?.recommendedConceptId) ?? admitted[0];
  const opened = admitted.find((concept) => concept.contract.conceptId === openedId) ?? null;

  function select(concept: LiveConcept) {
    onChange({
      mode: concept.recommended ? "recommended" : "alternative",
      optionId: concept.contract.conceptId,
      value: concept.contract.conceptName,
    });
  }

  if (opened !== null) {
    return (
      <ConceptPreview
        concept={opened}
        missionId={missionId}
        onBack={() => setOpenedId(null)}
        onSelect={() => select(opened)}
        selected={choice.optionId === opened.contract.conceptId}
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
        {requestError !== null && <p className="banner banner-fault" role="alert">{requestError}</p>}
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
        <button type="button" className="shock-concept-button" data-concept-action="shock">
          <strong>Let Foundry shock me</strong>
          <span>This explores a more surprising direction while preserving your project goals.</span>
        </button>
      </header>

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
