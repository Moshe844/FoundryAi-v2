"use client";

import type { Provider } from "../../experience/contracts";

function refreshTime(value: string | null) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(value)
  ) {
    return "awaiting refresh";
  }
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

export function ProviderView({
  onRefresh,
  providers,
  refreshing,
}: Readonly<{
  onRefresh: () => void;
  providers: readonly Provider[];
  refreshing: boolean;
}>) {
  return (
    <section className="act provider-view">
      <div className="section-head">
        <div>
          <p className="t-micro eyebrow">Settings</p>
          <h1 className="t-display-l">Model providers</h1>
        </div>
        <button
          className="btn btn-secondary"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? "Validating…" : "Validate providers again"}
        </button>
      </div>

      <p className="t-body-m ink-secondary measure">
        Foundry reads provider keys from the <code>.env</code> file in your
        project folder. They stay in the local server process — they&rsquo;re
        never sent to this page and never written into your project&rsquo;s
        history.
      </p>

      <div className="provider-grid">
        {providers.map((provider) => (
          <article className="card provider-card" key={provider.providerId}>
            <div className="project-foot">
              <strong className="t-title-s">{provider.displayName}</strong>
              <span
                className={`pill ${provider.available ? "pill-delivered" : "pill-neutral"}`}
              >
                <i aria-hidden="true" />
                {provider.available ? "Available" : "Unavailable"}
              </span>
            </div>
            <p className="t-body-s ink-secondary">{provider.reason}</p>
            <p className="t-caption ink-tertiary">
              Auto routing: {provider.autoRoutingAvailable ? "ready" : "paused"}
              {provider.refreshStale ? " · model metadata is stale" : " · metadata is fresh"}
              {` · last refreshed ${refreshTime(provider.lastSuccessfulRefreshAt)}`}
            </p>
            <p className="t-caption ink-tertiary">
              Lifecycle source: {provider.lifecycleSourceStatus}
              {provider.nextScheduledRefreshAt === null
                ? " · awaiting the first successful refresh"
                : ` · next scheduled refresh ${refreshTime(provider.nextScheduledRefreshAt)}`}
            </p>
            <details className="provider-models">
              <summary>
                {provider.models.length} approved for engineering
              </summary>
              <div>
                {provider.models.map((model) => (
                  <p className="t-caption ink-tertiary" key={model.modelId}>
                    {model.displayName} · {model.status}
                  </p>
                ))}
              </div>
            </details>
            <details className="provider-models">
              <summary>
                {provider.connectedModels.filter((model) => model.catalogPresence === "PRESENT").length} connected catalog models
              </summary>
              <div>
                {provider.connectedModels.map((model) => (
                  <div className="provider-model-entry" key={model.modelId}>
                    <p className="t-caption ink-tertiary">
                      {model.displayName} · {model.purpose} · {model.lifecycle} · {model.releaseChannel} · {model.catalogPresence === "PRESENT" ? "provider reported" : "missing from provider"} · {model.engineeringEligible ? "approved" : "not routable"}
                    </p>
                    <p className="t-caption ink-tertiary">
                      Last seen: {refreshTime(model.lastSeenAt)} · last validated: {refreshTime(model.lastValidatedAt)}
                    </p>
                    {!model.engineeringEligible && model.reasons.length > 0 ? (
                      <p className="t-caption ink-tertiary">
                        Why: {model.reasons.join("; ")}.
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>
          </article>
        ))}
      </div>

      <p className="t-caption ink-tertiary provider-disclaimer">
        Connected means the provider account exposes a model. Approved means
        Foundry separately verified its purpose, lifecycle, endpoint, release
        channel, and engineering policy before allowing it into routing.
        Your provider&rsquo;s billing is the authority on cost.
      </p>
    </section>
  );
}
