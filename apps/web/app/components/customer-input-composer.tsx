"use client";

import { useRef, useState } from "react";

import type {
  CustomerFollowUpAnswer,
  DiscoveryConversation,
  FoundryProposal,
} from "../../experience/contracts";

function messageAnswer(
  value: string,
  profileVersion: number,
): CustomerFollowUpAnswer {
  const uniqueId = globalThis.crypto.randomUUID();
  return {
    questionId: `customer-message-${uniqueId}`,
    answer: value,
    selection: {
      kind: "customer-message",
      subjectId: `customer-message-${uniqueId}`,
      mode: "message",
      optionId: null,
      value,
      reason: "The customer added natural project context.",
      classification: null,
      sourceProfileVersion: profileVersion,
    },
  };
}

function correctedMessageAnswer(
  value: string,
  profileVersion: number,
  classification: string,
): CustomerFollowUpAnswer {
  const answer = messageAnswer(value, profileVersion);
  return {
    ...answer,
    selection: answer.selection === undefined
      ? undefined
      : { ...answer.selection, classification },
  };
}

export function CustomerInputComposer({
  busy,
  conversation,
  profileVersion,
  proposal,
  onSubmit,
}: Readonly<{
  busy: boolean;
  conversation: DiscoveryConversation;
  profileVersion: number;
  proposal: FoundryProposal;
  onSubmit: (answer: CustomerFollowUpAnswer) => Promise<void>;
}>) {
  const [message, setMessage] = useState("");
  const [correcting, setCorrecting] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function send(value = message.trim(), classification: string | null = null) {
    const normalized = value.trim();
    if (normalized === "" || busy) return;
    await onSubmit(
      classification === null
        ? messageAnswer(normalized, profileVersion)
        : correctedMessageAnswer(normalized, profileVersion, classification),
    );
    setMessage("");
  }

  const revision = conversation.latestRevision;
  return (
    <aside className="discovery-companion" aria-label="Your input and plan changes">
      <div className="companion-heading">
        <p className="t-label ink-tertiary">Open conversation</p>
        <h2 className="t-title-m">Tell Foundry anything else</h2>
        <p className="t-body-s ink-secondary">
          Write naturally. I&rsquo;ll work out what the instruction changes and
          show you the revised plan.
        </p>
      </div>

      {proposal.smartSuggestions.length > 0 && (
        <div className="smart-suggestion-region" aria-label="Suggestions for this project">
          <p className="t-caption ink-tertiary">Useful things to add</p>
          <div className="smart-suggestion-list">
            {proposal.smartSuggestions.map((suggestion) => (
              <button
                type="button"
                className="smart-suggestion-chip"
                disabled={busy}
                title={suggestion.reason.value}
                key={suggestion.id}
                onClick={() => void send(suggestion.label.value)}
              >
                {suggestion.label.value}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="sr-only" htmlFor="customer-conversation-message">
        Tell Foundry anything else
      </label>
      <textarea
        ref={textareaRef}
        id="customer-conversation-message"
        className="plain-textarea conversation-note"
        data-contract-field="customer-note"
        rows={4}
        maxLength={5_000}
        placeholder="Add a preference, rule, correction, or missing fact"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <div className="composer-actions">
        <span className="t-caption ink-tertiary">
          {message.length.toLocaleString()} / 5,000
        </span>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || message.trim() === ""}
          onClick={() => void send()}
        >
          {busy ? "Revising…" : "Send and revise"}
        </button>
      </div>

      {revision.profileVersion > 1 && (
        <div className="revision-summary" role="status" aria-live="polite">
          <span className="revision-dot" aria-hidden="true" />
          <div>
            <strong>Plan revised</strong>
            {revision.changedSections.length > 0 ? (
              <p>
                This changes {revision.changedSections.join(", ").toLowerCase()}.
              </p>
            ) : (
              <p>Your instruction is attached to the plan.</p>
            )}
          </div>
        </div>
      )}

      {conversation.messages.length > 0 && (
        <details className="customer-message-history">
          <summary className="t-body-s">
            Your instructions ({conversation.messages.length})
          </summary>
          <ol>
            {conversation.messages.map((item) => (
              <li key={`${item.messageId}-${item.profileVersion}`}>
                <span className="t-caption">
                  {item.kind === "context"
                    ? "Project instruction"
                    : item.kind.replaceAll("-", " ")}
                </span>
                <p className="t-body-s">{item.text.replace(/^[^:]+:\s*/u, "")}</p>
                <p className="t-caption ink-tertiary">{item.interpretation}</p>
                {item.affectedSections.length > 0 && (
                  <p className="t-caption ink-tertiary">Updated: {item.affectedSections.join(", ")}</p>
                )}
                <button className="btn-quiet small" type="button" onClick={() => setCorrecting((current) => current === item.messageId ? null : item.messageId)}>
                  Correct interpretation
                </button>
                {correcting === item.messageId && (
                  <div className="message-interpretation-correction">
                    <span className="t-caption">Treat this instruction as</span>
                    <div className="interpretation-kind-buttons">
                      {[
                        "design-preference", "workflow-change", "feature-request",
                        "business-rule", "role", "integration", "limitation",
                        "content-requirement", "acceptance-expectation", "correction", "other",
                      ].map((kind) => (
                        <button
                          className="btn-quiet small"
                          disabled={busy}
                          key={kind}
                          type="button"
                          onClick={() => void send(`Correction: interpret my prior instruction \"${item.text}\" as ${kind.replaceAll("-", " ")}.`, kind).then(() => setCorrecting(null))}
                        >
                          {kind.replaceAll("-", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </aside>
  );
}
