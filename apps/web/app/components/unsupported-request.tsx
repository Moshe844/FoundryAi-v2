import type {
  ProjectUnderstanding,
  UnsupportedSummary,
} from "../../experience/contracts";

export function UnsupportedRequest({
  understanding,
  unsupported,
  busy,
  onDesignWeb,
  onStartOver,
}: {
  understanding: ProjectUnderstanding;
  unsupported: UnsupportedSummary;
  busy: boolean;
  onDesignWeb: () => Promise<void>;
  onStartOver: () => void;
}) {
  return (
    <section className="act unsupported-workspace">
      <div className="measure">
        <p className="t-micro eyebrow">What I understand</p>
        <h1 className="t-display-l">{understanding.projectName.value}</h1>
        <p className="t-body-l lead">{understanding.summary.value}</p>
      </div>
      <div className="decline" style={{ marginTop: "var(--space-8)" }}>
        <p className="unsupported-platform t-micro">
          Requested platform · {unsupported.requestedPlatform.value}
        </p>
        <h2 className="t-title-l">
          I can’t build this one — and I won’t fake it.
        </h2>
        <p className="t-body-m">
          You asked for {unsupported.requestedDescription.value}. Today I build
          for the web: {unsupported.supportedOutcome.value}. I could build
          something that looks close and doesn’t run the way you need, but I’d
          rather tell you.
        </p>
        <p className="t-body-m">{unsupported.alternative.value}</p>
        <div className="decline-actions">
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void onDesignWeb()}
          >
            {busy ? "Rethinking…" : "Design a web version"}
          </button>
          <button className="btn-quiet small" onClick={onStartOver}>
            Start something else
          </button>
        </div>
      </div>
    </section>
  );
}
