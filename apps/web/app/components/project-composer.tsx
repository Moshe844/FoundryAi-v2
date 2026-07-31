"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

type ProjectComposerProps = Readonly<{
  busy: boolean;
  busyLabel?: string;
  hint?: ReactNode;
  onSubmit: (intent: string) => void;
  placeholder?: string;
  submitLabel?: string;
  unavailableReason?: string | null;
}>;

function resizeTextarea(textarea: HTMLTextAreaElement) {
  textarea.style.height = "auto";
  const lineHeight = Number.parseFloat(
    window.getComputedStyle(textarea).lineHeight,
  );
  const maximum = Number.isFinite(lineHeight) ? lineHeight * 8 : 240;
  textarea.style.height = `${Math.min(textarea.scrollHeight, maximum)}px`;
  textarea.style.overflowY =
    textarea.scrollHeight > maximum ? "auto" : "hidden";
}

export function ProjectComposer({
  busy,
  busyLabel = "Starting…",
  hint = "Enter to start · Shift + Enter for a new line",
  onSubmit,
  placeholder = "Tell Foundry what outcome you want",
  submitLabel = "Start",
  unavailableReason = null,
}: ProjectComposerProps) {
  const [intent, setIntent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const helpId = useId();
  const unavailableId = useId();

  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea !== null) resizeTextarea(textarea);
  }, [intent]);

  function submit() {
    const trimmed = intent.trim();
    if (trimmed === "" || busy || unavailableReason !== null) {
      textareaRef.current?.focus();
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <div className="composer-stack">
      <form
        className="composer"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="sr-only" htmlFor={`${helpId}-intent`}>
          Describe what you want built
        </label>
        <textarea
          ref={textareaRef}
          id={`${helpId}-intent`}
          suppressHydrationWarning
          value={intent}
          rows={3}
          placeholder={placeholder}
          aria-describedby={`${helpId}${unavailableReason ? ` ${unavailableId}` : ""}`}
          aria-label="Describe what you want built"
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-foot">
          <span id={helpId} className="t-caption ink-tertiary">
            {hint}
          </span>
          <button
            className="btn btn-primary"
            disabled={busy || intent.trim() === "" || unavailableReason !== null}
            aria-describedby={unavailableReason === null ? undefined : unavailableId}
            title={unavailableReason ?? undefined}
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>

      {unavailableReason !== null && (
        <span className="sr-only" id={unavailableId}>
          {unavailableReason}
        </span>
      )}

      <p className="t-body-s capability" aria-live="polite">
        {intent.trim() === ""
          ? "A short request is enough. Foundry will propose the workflows, design, and professional defaults."
          : "That’s enough to start. I’ll ask only if something genuinely changes the project."}
      </p>
    </div>
  );
}
