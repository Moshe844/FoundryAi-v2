"use client";

import { useMemo, useState } from "react";

import type {
  CustomerFollowUpAnswer,
  ProductTypeDiscovery as ProductTypeDiscoveryModel,
} from "../../experience/contracts";

function confidenceLabel(score: number) {
  if (score >= 0.8) return "High confidence";
  if (score >= 0.6) return "Good signal";
  return "Possible fit";
}

export function ProductTypeDiscovery({
  busy,
  discovery,
  onContinue,
}: Readonly<{
  busy: boolean;
  discovery: ProductTypeDiscoveryModel;
  onContinue: (answers: CustomerFollowUpAnswer[]) => Promise<boolean>;
}>) {
  const recommended = useMemo(
    () => discovery.subtypes.find((subtype) => subtype.recommended),
    [discovery],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showOther, setShowOther] = useState(false);
  const [other, setOther] = useState("");
  const [showContext, setShowContext] = useState(false);
  const [context, setContext] = useState("");
  const [combinationNotice, setCombinationNotice] = useState("");

  function toggle(optionId: string) {
    const subtype = discovery.subtypes.find((item) => item.optionId === optionId);
    if (!subtype) return;
    setShowOther(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(optionId)) {
        next.delete(optionId);
        return next;
      }
      const selected = discovery.subtypes.filter((item) => next.has(item.optionId));
      const sharedTags = selected.reduce<Set<string>>(
        (shared, item) =>
          new Set([...shared].filter((tag) => item.compatibilityTags.includes(tag))),
        new Set(subtype.compatibilityTags),
      );
      if (
        !subtype.canCombine ||
        selected.some((item) => !item.canCombine) ||
        (selected.length > 0 && sharedTags.size === 0)
      ) {
        setCombinationNotice(
          selected.length > 0
            ? `${subtype.title} changes the core workflow, so Foundry will use it as the primary direction instead of combining incompatible products.`
            : "",
        );
        return new Set([optionId]);
      }
      setCombinationNotice(subtype.combinationNote);
      next.add(optionId);
      return next;
    });
  }

  function answersFor(mode: "selected" | "delegate") {
    const choices =
      mode === "delegate"
        ? recommended === undefined
          ? []
          : [recommended]
        : discovery.subtypes.filter((subtype) => selectedIds.has(subtype.optionId));
    const answers: CustomerFollowUpAnswer[] = choices.map((subtype) => ({
      questionId: `product-subtype-${subtype.optionId}`,
      answer:
        mode === "delegate"
          ? `Let Foundry decide. Use ${subtype.title}.`
          : subtype.title,
      selection: {
        kind: "product-subtype",
        subjectId: "product-type",
        mode:
          mode === "delegate"
            ? "delegate"
            : subtype.recommended && choices.length === 1
              ? "accept-recommendation"
              : "select-option",
        optionId: subtype.optionId,
        value: subtype.title,
        reason: subtype.whyItMayFit,
        classification: "product subtype",
        sourceProfileVersion: 1,
      },
    }));
    if (showOther && other.trim()) {
      answers.push({
        questionId: "product-subtype-other",
        answer: other.trim(),
        selection: {
          kind: "product-subtype",
          subjectId: "product-type",
          mode: "other",
          optionId: null,
          value: other.trim(),
          reason: "The customer described a product type beyond the generated choices.",
          classification: "product subtype",
          sourceProfileVersion: 1,
        },
      });
    }
    if (context.trim()) {
      answers.push({
        questionId: "product-subtype-context",
        answer: context.trim(),
        selection: {
          kind: "customer-message",
          subjectId: "product-subtype-context",
          mode: "message",
          optionId: null,
          value: context.trim(),
          reason: "The customer added business context before product design.",
          classification: "context",
          sourceProfileVersion: 1,
        },
      });
    }
    return answers;
  }

  const canContinue =
    recommended !== undefined || selectedIds.size > 0 || (showOther && other.trim() !== "");

  return (
    <section className="product-type-studio" aria-labelledby="product-type-title">
      <header className="product-type-hero">
        <p className="t-label eyebrow">Product strategy · Step 1 of 8</p>
        <h1 className="t-display-l" id="product-type-title">
          What kind of {discovery.originalRequest.toLowerCase()} do you mean?
        </h1>
        <p className="t-body-l lead">{discovery.interpretation.summary}</p>
        <p className="t-body-s product-type-reasoning">
          {discovery.interpretation.reasoning}
        </p>
      </header>

      <div className="product-type-grid" role="group" aria-label="Product type choices">
        {discovery.subtypes.map((subtype) => {
          const selected = selectedIds.has(subtype.optionId);
          return (
            <button
              aria-pressed={selected}
              className="product-type-card"
              disabled={busy}
              key={subtype.optionId}
              onClick={() => toggle(subtype.optionId)}
              type="button"
            >
              <span className="product-type-card-head">
                <span className="t-title-s">{subtype.title}</span>
                {subtype.recommended && (
                  <span className="product-type-recommended">Foundry recommends</span>
                )}
              </span>
              <span className="t-body-s product-type-explanation">
                {subtype.explanation}
              </span>
              <span className="product-type-detail">
                <span>For</span>
                <strong>{subtype.likelyUsers.join(", ")}</strong>
              </span>
              <span className="product-type-detail">
                <span>Outcome</span>
                <strong>{subtype.likelyPrimaryOutcome}</strong>
              </span>
              <span className="product-type-fit">{subtype.whyItMayFit}</span>
              <span className="product-type-confidence">
                {confidenceLabel(subtype.confidence.score)} · {subtype.confidence.reason}
              </span>
              <span className="product-type-select-mark" aria-hidden="true">
                {selected ? "Selected" : subtype.canCombine ? "Select or combine" : "Select"}
              </span>
            </button>
          );
        })}
      </div>

      {combinationNotice !== "" && (
        <p className="t-body-s product-type-reasoning" role="status">
          {combinationNotice}
        </p>
      )}

      <div className="product-type-escape">
        <button
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => {
            setShowOther((visible) => !visible);
            setSelectedIds(new Set());
          }}
          type="button"
        >
          Something else
        </button>
        <button
          className="btn-quiet"
          disabled={busy}
          onClick={() => setShowContext((visible) => !visible)}
          type="button"
        >
          {showContext ? "Hide extra context" : "Add a short note"}
        </button>
      </div>

      {showOther && (
        <label className="product-type-custom">
          <span className="t-label">Describe another type</span>
          <textarea
            autoFocus
            disabled={busy}
            onChange={(event) => setOther(event.target.value)}
            placeholder="For example, what makes your version different?"
            rows={3}
            value={other}
          />
        </label>
      )}
      {showContext && (
        <label className="product-type-custom">
          <span className="t-label">Anything Foundry should know</span>
          <textarea
            disabled={busy}
            onChange={(event) => setContext(event.target.value)}
            placeholder="Your business, customers, existing process, or a constraint"
            rows={3}
            value={context}
          />
        </label>
      )}

      <footer className="product-type-actions">
        <button
          className="btn btn-primary"
          disabled={busy || !canContinue}
          onClick={() =>
            void onContinue(
              answersFor(
                selectedIds.size > 0 || (showOther && other.trim() !== "")
                  ? "selected"
                  : "delegate",
              ),
            )
          }
          type="button"
        >
          {busy
            ? "Designing your proposal…"
            : selectedIds.size > 1
              ? `Combine ${selectedIds.size} choices and continue`
              : selectedIds.size === 1 || (showOther && other.trim())
                ? "Use this direction and continue"
                : "Continue with Foundry’s recommendation"}
        </button>
        <button
          className="btn btn-secondary"
          disabled={busy || recommended === undefined}
          onClick={() => void onContinue(answersFor("delegate"))}
          type="button"
        >
          Let Foundry decide
        </button>
        <p className="t-caption">
          Next, Foundry will design the complete proposal around this choice. Nothing is built yet.
        </p>
      </footer>
    </section>
  );
}
