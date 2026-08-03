"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApplicationShell } from "./components/application-shell";
import { ActiveExecution as ActiveExecutionSurface } from "./components/active-execution";
import { CompletionHandoff } from "./components/completion-handoff";
import { DecisionBrief } from "./components/decision-brief";
import { HomeView } from "./components/home-view";
import { LifecycleOutcome } from "./components/lifecycle-outcome";
import { ProjectDiscovery } from "./components/project-discovery";
import { ProductTypeDiscovery } from "./components/product-type-discovery";
import { ProjectsView } from "./components/project-list";
import { ProviderView } from "./components/provider-view";
import { StartBuildingTransition } from "./components/start-building-transition";
import { UnsupportedRequest } from "./components/unsupported-request";
import type {
  CustomerFollowUpAnswer,
  Mission,
  Provider,
} from "../experience/contracts";
import { selectFoundryExperience } from "../experience/selectors";
import {
  validateMission,
  validateMissionList,
  validateProviderList,
} from "../experience/validation";
import { effectiveMissionQuery } from "../experience/intake";

const API = "http://127.0.0.1:3927";

function scrollToSurfaceStart() {
  window.requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  });
}

/*
 * Retained in git history: the pre-Phase-E page-local build projection.
 * The live page now consumes the replayed execution view model exclusively.
 *
const PERSISTENCE_CAPABILITIES = new Set([
  "sqlite-persistence",
  "create-records",
  "update-records",
  "refresh-persistence",
]);

type PhaseKey =
  | "understand"
  | "design"
  | "structure"
  | "workflows"
  | "data"
  | "prepare"
  | "run"
  | "test"
  | "verify";

const PHASES: Array<{
  key: PhaseKey;
  label: string;
  why: (profile: ProjectProfile | null) => string;
}> = [
  {
    key: "understand",
    label: "Understanding what you need",
    why: () => "Reading your request and working out what matters.",
  },
  {
    key: "design",
    label: "Designing the experience",
    why: () => "Working out the pages and how people move between them.",
  },
  {
    key: "structure",
    label: "Creating the application structure",
    why: () => "Setting up the project so everything has a place.",
  },
  {
    key: "workflows",
    label: "Building the main workflows",
    why: (profile) => {
      const outcome = profile?.outcomes[0];
      if (!outcome) return "So the main things people need to do actually work.";
      return `So ${outcome.charAt(0).toLowerCase()}${outcome.slice(1)}.`;
    },
  },
  {
    key: "data",
    label: "Connecting data",
    why: (profile) => {
      const concept = profile?.dataConcepts[0];
      return concept
        ? `I'm connecting ${concept.toLowerCase()} to permanent storage so nothing anyone enters is lost.`
        : "I'm connecting this to permanent storage so nothing anyone enters is lost.";
    },
  },
  {
    key: "prepare",
    label: "Preparing it to run",
    why: () =>
      "Installing what it needs and building it the way it would really ship — not a development shortcut.",
  },
  {
    key: "run",
    label: "Running the application",
    why: () =>
      "Starting it for real. I won't show you a preview until it actually answers a request.",
  },
  {
    key: "test",
    label: "Testing important actions",
    why: () =>
      "Driving it in a real browser the way a real person would, rather than trusting that it compiled.",
  },
  {
    key: "verify",
    label: "Verifying the result",
    why: () =>
      "Checking every promise I made in the plan. Anything that doesn't hold, I'll tell you about.",
  },
];

const REPAIR_LINES = [
  "A workflow didn't behave as expected.",
  "I found the likely cause.",
  "I'm correcting the affected part.",
  "I'm rerunning only the checks that matter.",
];
*/

/* ==========================================================================
   State translation — no lifecycle enum reaches the DOM
   ========================================================================== */

const TERMINAL = new Set([
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
  "EXHAUSTED",
  "CANCELLED",
]);

/* ==========================================================================
   Helpers
   ========================================================================== */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "Foundry didn't answer within 30 seconds. This project is recorded and safe to reopen.",
      );
    }
    throw new Error(
      "I can't reach the Foundry service on this machine. Start it with: cd apps\\web && npm.cmd run dev",
    );
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Foundry returned HTTP ${response.status}.`);
  }
  return payload;
}

/* ==========================================================================
   Engineering details — everything internal, losslessly preserved
   ========================================================================== */

/*
 * Retained in git history: the pre-Phase-E page-local engineering disclosure.
 *
function EngineeringDetails({ mission }: { mission: Mission }) {
  const metrics = mission.executionMetrics;
  return (
    <details className="eng">
      <summary>
        <Chevron />
        Engineering details
        {mission.activities.length > 0
          ? ` · ${mission.activities.length} records`
          : ""}
      </summary>
      <div className="eng-body">
        <p className="t-body-s eng-intro">
          Everything below is reconstructed from records Foundry can&rsquo;t
          rewrite. It&rsquo;s here for proof, not for you to act on.
        </p>

        <div className="eng-sec">
          <h4>Activity</h4>
          {mission.activities.length === 0 ? (
            <p className="t-body-s ink-secondary">Nothing recorded yet.</p>
          ) : (
            <ul className="eng-activity">
              {[...mission.activities].reverse().map((item) => (
                <li key={item.sequence}>
                  <p className="t-body-s">
                    <strong>{item.title}</strong>
                  </p>
                  <p className="t-caption ink-tertiary">
                    {item.kind} ·{" "}
                    {new Date(item.occurredAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="t-body-s ink-secondary">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="eng-sec">
          <h4>Model routing</h4>
          {mission.modelRouting.length === 0 ? (
            <p className="t-body-s ink-secondary">
              No model route has been recorded yet.
            </p>
          ) : (
            <div className="eng-scroll">
              <table>
                <thead>
                  <tr>
                    <th>provider</th>
                    <th>model</th>
                    <th>task</th>
                    <th>status</th>
                    <th>attempt</th>
                    <th>in</th>
                    <th>out</th>
                    <th>cost</th>
                  </tr>
                </thead>
                <tbody>
                  {[...mission.modelRouting].reverse().map((route, index) => (
                    <tr
                      key={`${route.requestId}-${route.attempt}-${route.sequence}-${index}`}
                    >
                      <td>{route.providerFamily ?? route.provider}</td>
                      <td>{route.modelId}</td>
                      <td>
                        {route.taskClass.replaceAll("_", " ").toLowerCase()}
                        {route.depthLevel ? ` · depth ${route.depthLevel}` : ""}
                      </td>
                      <td>{route.status.toLowerCase()}</td>
                      <td>{route.attempt}</td>
                      <td>{route.inputTokens ?? "—"}</td>
                      <td>{route.outputTokens ?? "—"}</td>
                      <td>
                        {route.costUsd && route.costUsd > 0
                          ? `$${route.costUsd.toFixed(4)}`
                          : "cost unavailable locally"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {metrics && (
          <div className="eng-sec">
            <h4>Counters</h4>
            <p className="t-mono ink-secondary">
              providerCallCount {metrics.providerCallCount} ·
              uniqueHypothesisCount {metrics.uniqueHypothesisCount} ·
              repeatedPipelineCost {metrics.repeatedPipelineCost} · installCount{" "}
              {metrics.installCount} · reinstallCount {metrics.reinstallCount} ·
              rebuildCount {metrics.rebuildCount} · runtimeRestartCount{" "}
              {metrics.runtimeRestartCount}
            </p>
            {Object.keys(metrics.repairScopes).length > 0 && (
              <p className="t-mono ink-secondary">
                repairScopes {JSON.stringify(metrics.repairScopes)}
              </p>
            )}
          </div>
        )}

        {mission.contract && (
          <div className="eng-sec">
            <h4>Verification</h4>
            <div className="eng-scroll">
              <table>
                <thead>
                  <tr>
                    <th>obligation</th>
                    <th>verified</th>
                    <th>statement</th>
                  </tr>
                </thead>
                <tbody>
                  {mission.contract.obligations.map((obligation) => (
                    <tr key={obligation.obligationId}>
                      <td>{obligation.obligationId}</td>
                      <td>
                        {metrics?.verifiedObligationIds.includes(
                          obligation.obligationId,
                        )
                          ? "SATISFIED"
                          : "—"}
                      </td>
                      <td>{obligation.statement}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="eng-sec">
          <h4>Workspace</h4>
          <code>
            {mission.missionId}
            {mission.profile
              ? `\n${mission.profile.selectedStack.stackId}@${mission.profile.selectedStack.version}`
              : ""}
          </code>
        </div>
      </div>
    </details>
  );
}
*/

/* ==========================================================================
   Preview dock
   ========================================================================== */

/*
 * Retained in git history: the pre-Phase-E fixed preview.
 *
type PreviewWidth = "desktop" | "tablet" | "phone";

function Preview({
  mission,
  onCollapse,
  collapsed,
  onRestore,
  fullWidth = false,
}: {
  mission: Mission;
  collapsed: boolean;
  onCollapse: () => void;
  onRestore: () => void;
  fullWidth?: boolean;
}) {
  const [width, setWidth] = useState<PreviewWidth>("desktop");
  const [frameLoaded, setFrameLoaded] = useState(false);
  const url = mission.previewUrl;

  // The dock does not exist until a real readiness observation produced a URL.
  if (!url) return null;

  if (collapsed) {
    return (
      <div className="preview-collapsed">
        <span className="t-label ink-secondary">
          <span className="orb" aria-hidden="true" style={{ display: "inline-block", marginRight: 7 }} />
          Preview · Live
        </span>
        <button className="btn-quiet small" onClick={onRestore}>
          Show preview
        </button>
      </div>
    );
  }

  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  const stopped = TERMINAL.has(mission.state) && mission.state !== "SUCCEEDED";

  return (
    <div className="preview">
      <div className="preview-bar">
        <span className="preview-bar-title">Preview</span>
        <div className="preview-tools">
          {(["desktop", "tablet", "phone"] as PreviewWidth[]).map((option) => (
            <button
              key={option}
              aria-pressed={width === option}
              aria-label={`${option[0].toUpperCase()}${option.slice(1)} width`}
              title={`${option[0].toUpperCase()}${option.slice(1)} width`}
              onClick={() => setWidth(option)}
            >
              {option === "desktop" ? "▭" : option === "tablet" ? "▤" : "▯"}
            </button>
          ))}
          <a href={url} target="_blank" rel="noreferrer" aria-label="Open in a new tab" title="Open in a new tab">
            ↗
          </a>
          {!fullWidth && (
            <button
              onClick={onCollapse}
              aria-label="Collapse the preview panel"
              title="Collapse"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div
        className={`preview-body${width === "tablet" ? " narrow" : ""}${
          width === "phone" ? " phone" : ""
        }${mission.state === "REPAIRING" ? " rebuilding" : ""}`}
      >
        {stopped ? (
          <div className="preview-state">
            <div>
              <p className="t-title-s">The preview isn&rsquo;t running any more.</p>
              <p className="t-body-s ink-secondary" style={{ marginTop: 8 }}>
                The project files are still in your workspace.
              </p>
            </div>
          </div>
        ) : (
          <>
            <iframe
              title={`Preview of ${mission.profile?.name ?? "your project"}`}
              src={url}
              onLoad={() => setFrameLoaded(true)}
            />
            {!frameLoaded && (
              <div className="preview-state pulsing">
                <p className="t-body-m">Starting it up</p>
              </div>
            )}
          </>
        )}
      </div>
      <div className="preview-foot">
        {stopped ? (
          <span>Not running</span>
        ) : mission.state === "REPAIRING" ? (
          <span>Rebuilding — this preview is from a moment ago</span>
        ) : (
          <>
            <span className="orb" aria-hidden="true" />
            <span>Live · {host}</span>
          </>
        )}
      </div>
    </div>
  );
}
*/

/* ==========================================================================
   Reading (understanding in progress)
   ========================================================================== */

function Reading({
  mission,
  busy,
  onRetry,
}: {
  mission: Mission;
  busy: boolean;
  onRetry: () => Promise<void>;
}) {
  const route = mission.activeModelRoute;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!mission.running) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [mission.running, route?.occurredAt]);
  const startedAt = route?.occurredAt ?? mission.updatedAt;
  const elapsedSeconds = startedAt
    ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1_000))
    : 0;
  const elapsed = elapsedSeconds >= 60
    ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
    : `${elapsedSeconds}s`;
  const failedRoutes = mission.modelRouting.filter(
    (candidate) => candidate.status === "FAILED",
  ).length;
  return (
    <section className="act measure">
      <h1 className="t-display-l">Working out what you need</h1>
      <p
        className="t-body-l lead"
        aria-live={mission.error ? "off" : "polite"}
      >
        I&rsquo;m thinking through what a business like yours normally needs, so
        I can come back with a proposal rather than a list of questions.
      </p>
      <p className="t-body-s ink-tertiary" style={{ marginTop: "var(--space-4)" }}>
        {route
          ? `${route.providerFamily ?? route.provider} · ${route.modelId} · ${elapsed}`
          : "Choosing a model for this."}
      </p>
      {failedRoutes > 0 && (
        <p className="t-body-s ink-tertiary" style={{ marginTop: "var(--space-2)" }}>
          {failedRoutes} earlier {failedRoutes === 1 ? "route" : "routes"} did not complete. Foundry is trying another approved route.
        </p>
      )}
      <p className="t-body-s ink-tertiary" style={{ marginTop: "var(--space-5)" }}>
        This is already recorded. You can leave and come back.
      </p>

      {mission.error && (
        <div className="banner banner-fault" role="alert" style={{ marginTop: "var(--space-6)" }}>
          <div className="banner-body">
            <strong>I couldn&rsquo;t work out what you need from that.</strong>
            <p className="t-body-s">{mission.error}</p>
            <button
              className="btn btn-secondary btn-compact"
              style={{ marginTop: "var(--space-3)" }}
              disabled={busy}
              onClick={() => void onRetry()}
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ==========================================================================
   The Build
   ========================================================================== */

/*
 * Retained in git history: the pre-Phase-E monolithic execution surface.
 *
function Spine({
  mission,
  currentIndex,
  fixing,
}: {
  mission: Mission;
  currentIndex: number;
  fixing: boolean;
}) {
  const profile = mission.profile;
  const hasPersistence =
    profile?.capabilities.some((capability) =>
      PERSISTENCE_CAPABILITIES.has(capability),
    ) ?? false;

  const phases = PHASES.filter(
    (phase) => phase.key !== "data" || hasPersistence,
  );
  const repairStep = Math.min(
    mission.executionMetrics?.uniqueHypothesisCount ?? 1,
    REPAIR_LINES.length,
  );

  return (
    <ol className="spine">
      {phases.map((phase) => {
        const index = PHASES.findIndex((candidate) => candidate.key === phase.key);
        const state =
          index < currentIndex
            ? "done"
            : index === currentIndex
              ? fixing
                ? "fixing"
                : "now"
              : "";
        return (
          <li key={phase.key} className={state}>
            <span className="spine-mark">
              <span className="spine-dot" aria-hidden="true">
                {state === "done" ? "✓" : ""}
              </span>
              <span className="spine-line" />
            </span>
            <div className="spine-body">
              <span className="spine-text">{phase.label}</span>
              {state === "fixing" && (
                <ul className="repair">
                  {REPAIR_LINES.slice(0, repairStep).map((line, lineIndex) => (
                    <li
                      key={line}
                      className={lineIndex === repairStep - 1 ? "active" : ""}
                    >
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TheBuild({
  mission,
  busy,
  onStop,
}: {
  mission: Mission;
  busy: boolean;
  onStop: () => void;
}) {
  const phase = customerPhase(mission);
  const [collapsed, setCollapsed] = useState(false);
  const hasPreview = Boolean(mission.previewUrl);
  const currentPhase = PHASES[Math.min(phase.spineIndex, PHASES.length - 1)];
  const [elapsed, setElapsed] = useState(() => elapsedLabel(mission));

  // Elapsed updates every 10s, not every second.
  useEffect(() => {
    const timer = window.setInterval(() => setElapsed(elapsedLabel(mission)), 10_000);
    return () => window.clearInterval(timer);
  }, [mission]);

  return (
    <section className="act">
      <div className="build-head">
        <h1 className="t-title-l">{mission.profile?.name ?? mission.intent}</h1>
        <div className="build-head-meta">
          <PhasePill mission={mission} />
          {elapsed && <span className="t-caption ink-tertiary">{elapsed}</span>}
          <button
            className="btn btn-secondary btn-compact"
            disabled={busy}
            onClick={onStop}
          >
            Stop
          </button>
        </div>
      </div>

      {mission.error && (
        <div className="banner banner-fault" role="alert" style={{ marginTop: "var(--space-5)" }}>
          <div className="banner-body">
            <p className="t-body-s">{mission.error}</p>
          </div>
        </div>
      )}

      <div className={`dock-layout${hasPreview && !collapsed ? " has-dock" : ""}`}>
        <div>
          <Spine
            mission={mission}
            currentIndex={phase.spineIndex}
            fixing={phase.fixing}
          />

          <div className="now-block measure" aria-live="polite" aria-atomic="true">
            <h2 className="t-display-l">
              {phase.fixing ? "Correcting an issue" : currentPhase.label}
            </h2>
            <p className="now-why">
              {phase.fixing
                ? "I found the likely cause. I'm correcting the affected part and rerunning only the checks that matter."
                : currentPhase.why(mission.profile)}
            </p>
          </div>

          <p className="t-body-s ink-tertiary">
            You can leave this page. I&rsquo;ll keep going and everything is
            recorded.
          </p>

          <EngineeringDetails mission={mission} />
        </div>

        {hasPreview && (
          <div>
            <Preview
              mission={mission}
              collapsed={collapsed}
              onCollapse={() => setCollapsed(true)}
              onRestore={() => setCollapsed(false)}
            />
          </div>
        )}
      </div>
    </section>
  );
}

void TheBuild;
*/

/* ==========================================================================
   Delivery
   ========================================================================== */

/*
 * Retained in git history: the pre-Phase-F page-local lifecycle surfaces.
 * Completion and terminal outcomes now consume the canonical sourced model.
 *
function Delivery({
  experience,
  mission,
}: {
  experience: ReturnType<typeof selectFoundryExperience>;
  mission: Mission;
}) {
  const profile = mission.profile;
  const checks = profile?.verificationPlan.checks ?? [];
  const verification = mission.executionProjection.verification;
  const verified = new Set(
    verification
      .filter((item) => item.result === "SATISFIED")
      .map((item) => item.obligationId),
  );
  const provedCount = verified.size;
  const [showAll, setShowAll] = useState(false);
  const verifiedChecks = checks.filter((check) => verified.has(check.checkId));
  const visible = showAll ? verifiedChecks : verifiedChecks.slice(0, 5);
  const browserVerified = verification.some(
    (item) =>
      item.result === "SATISFIED" &&
      item.evidenceReferences.some((reference) =>
        reference.evidenceId.includes("browser-evidence"),
      ),
  );
  const allVerified =
    verification.length > 0 &&
    verification.every((item) => item.result === "SATISFIED");
  const unverifiedCount = verification.length - provedCount;
  const elapsed = buildElapsedLabel(mission);

  const limitations = [
    ...(profile?.constraints ?? []),
    "The database suits a single copy of the application.",
    "Browser testing runs in Chromium-based browsers.",
  ];

  return (
    <section className="act completion-workspace">
      <div
        className={`delivery-layout${
          experience.preview.state.value !== "absent" ? " has-preview" : ""
        }`}
      >
        <article className="delivery delivery-intro">
          <p className="t-micro eyebrow">{profile?.name ?? "Your project"}</p>
          <h1 className="t-display-xl" aria-live="polite">
            {allVerified
              ? "It’s built, and I’ve proved it works."
              : "The build finished, but one promise still needs proof."}
          </h1>
          <p className="t-body-l lead measure">
            Here&rsquo;s the handover: what I built, the calls I made and why,
            what I left out on purpose, and where I&rsquo;d take it next.
          </p>

          <ul className="delivery-status" aria-label="Build results">
            <li>
              <span aria-hidden="true">✓</span>
              Build finished{elapsed === null ? "" : ` in ${elapsed}`}
            </li>
            <li>
              <span aria-hidden="true">{allVerified ? "✓" : "!"}</span>
              {allVerified
                ? `${provedCount} contract check${
                    provedCount === 1 ? "" : "s"
                  } passed`
                : `${provedCount} of ${verification.length} checks verified · ${unverifiedCount} needs review`}
            </li>
            {browserVerified && (
              <li>
                <span aria-hidden="true">✓</span>
                Browser automation passed
              </li>
            )}
          </ul>
        </article>

        {experience.preview.state.value !== "absent" && (
          <aside className="delivery-preview" aria-label="Live application">
            <PreviewDock
              mission={mission}
              notice={
                allVerified
                  ? null
                  : "Draft preview · A customer-content claim still needs real source material."
              }
              preview={experience.preview}
              fullWidth
            />
          </aside>
        )}

        <article className="delivery delivery-body">
          <dl className="delivery-details">
            <div className="field-row">
              <dt>What you got</dt>
              <dd className="t-body-m">{profile?.summary ?? mission.intent}</dd>
            </div>
            <div className="field-row">
              <dt>What I proved</dt>
              <dd>
                <p className="t-body-m">
                  <span className="count-strong">
                    {provedCount} of {checks.length}
                  </span>
                </p>
                <ul
                  className="proved t-body-m stack-list"
                  style={{ marginTop: "var(--space-3)" }}
                >
                  {visible.map((check) => (
                    <li key={check.checkId}>{check.label}</li>
                  ))}
                </ul>
                {verifiedChecks.length > 5 && !showAll && (
                  <button
                    className="btn-quiet small"
                    style={{ marginTop: "var(--space-3)" }}
                    onClick={() => setShowAll(true)}
                  >
                    Show all {verifiedChecks.length}
                  </button>
                )}
              </dd>
            </div>
            {profile && profile.architectureDecisions.length > 0 && (
              <div className="field-row">
                <dt>Why I built it this way</dt>
                <dd>
                  <ul className="reasoning stack-list">
                    {profile.architectureDecisions.map((decision) => (
                      <li key={decision} className="t-body-m">
                        {decision}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <div className="field-row">
              <dt>What I left out on purpose</dt>
              <dd>
                <ul className="left-out stack-list">
                  {limitations.map((item) => (
                    <li key={item} className="t-body-m">
                      {item}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
            {profile && profile.contextualSuggestions.length > 0 && (
              <div className="field-row">
                <dt>If this became Version 2</dt>
                <dd>
                  <p
                    className="t-body-m"
                    style={{ marginBottom: "var(--space-3)" }}
                  >
                    This is where I&rsquo;d take it next, in the order I&rsquo;d
                    do it.
                  </p>
                  <ol className="numbered t-body-m stack-list">
                    {profile.contextualSuggestions.map((suggestion) => (
                      <li key={suggestion.suggestionId}>
                        <span>
                          <strong>{suggestion.label}</strong> —{" "}
                          {suggestion.rationale}
                        </span>
                      </li>
                    ))}
                  </ol>
                </dd>
              </div>
            )}
          </dl>

          <EngineeringDetailsPanel mission={mission} />
        </article>
      </div>
    </section>
  );
}

==========================================================================
Stopped / cancelled
==========================================================================

function Stopped({
  mission,
  onReopen,
}: {
  mission: Mission;
  onReopen: () => void;
}) {
  const phase = customerPhase(mission);
  const cancelled = mission.state === "CANCELLED";
  const checks = mission.profile?.verificationPlan.checks ?? [];
  const verified = mission.executionMetrics?.verifiedObligationIds.length ?? 0;

  return (
    <section className="act">
      <div className="build-head">
        <h1 className="t-title-l">{mission.profile?.name ?? mission.intent}</h1>
        <PhasePill mission={mission} />
      </div>

      <div className="measure" style={{ marginTop: "var(--space-8)" }}>
        <h2 className="t-display-l">
          {cancelled
            ? "You stopped this build."
            : mission.state === "EXHAUSTED"
              ? "I stopped at the safe repair limit."
              : mission.state === "BLOCKED"
                ? "I need a decision before I can carry on."
                : "I stopped, and I couldn't finish this."}
        </h2>
      </div>

      <dl style={{ marginTop: "var(--space-6)", maxWidth: 900 }}>
        <div className="field-row">
          <dt>What I was doing</dt>
          <dd className="t-body-m">{phase.status}</dd>
        </div>
        {mission.error && (
          <div className="field-row">
            <dt>What happened</dt>
            <dd className="t-body-m">{mission.error}</dd>
          </div>
        )}
        <div className="field-row">
          <dt>What I did prove</dt>
          <dd className="t-body-m">
            {checks.length > 0
              ? `${verified} of ${checks.length} promises held before I stopped.`
              : "Nothing had been proved yet."}
          </dd>
        </div>
        <div className="field-row">
          <dt>The plan is saved</dt>
          <dd className="t-body-m">
            Every decision and assumption is still here.
          </dd>
        </div>
      </dl>

      <div className="continue-row">
        <button className="btn btn-secondary" onClick={onReopen}>
          Back to your projects
        </button>
      </div>

      <EngineeringDetailsPanel mission={mission} />
    </section>
  );
}
*/

/* ==========================================================================
   Sheets
   ========================================================================== */

function ConfirmSheet({
  heading,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  returnFocus,
  onConfirm,
  onCancel,
}: {
  heading: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  returnFocus: HTMLElement | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const safeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    safeRef.current?.focus();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (returnFocus?.isConnected) {
        returnFocus.focus();
      } else {
        document.getElementById("main")?.focus();
      }
    };
  }, [returnFocus]);

  return (
    <>
      <button
        className="scrim"
        type="button"
        aria-label={`Close ${heading}`}
        tabIndex={-1}
        onClick={() => onCancelRef.current()}
      />
      <div className="sheet-wrap">
        <div
          ref={sheetRef}
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-heading"
          aria-describedby="confirm-body"
        >
          <h2 className="t-title-l" id="confirm-heading">
            {heading}
          </h2>
          <p
            className="t-body-m ink-secondary"
            id="confirm-body"
            style={{ marginTop: "var(--space-3)" }}
          >
            {body}
          </p>
          <div className="sheet-actions">
            <button className="btn btn-secondary" ref={safeRef} onClick={onCancel}>
              {cancelLabel}
            </button>
            <button
              className={destructive ? "btn btn-destructive" : "btn btn-primary"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ==========================================================================
   Page
   ========================================================================== */

export default function Page() {
  const [view, setView] = useState<
    "home" | "projects" | "providers" | "project"
  >("home");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [current, setCurrent] = useState<Mission | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [refreshingProviders, setRefreshingProviders] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [startHandoff, setStartHandoff] = useState<{
    missionId: string;
    projectName: string;
    baselineActivitySequence: number;
    startedAt: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loadedQuery, setLoadedQuery] = useState("");
  const [catalogueRevision, setCatalogueRevision] = useState(0);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const missionQuery = effectiveMissionQuery(search);
  const searching = loadedQuery !== missionQuery;
  const [confirm, setConfirm] = useState<
    | { kind: "delete"; mission: Mission; returnFocus: HTMLElement | null }
    | { kind: "stop"; mission: Mission; returnFocus: HTMLElement | null }
    | null
  >(null);
  const deletedMissionIdsRef = useRef(new Set<string>());
  const urlStateReadyRef = useRef(false);
  const currentMissionId = current?.missionId ?? null;

  /* ---- provider registry ---- */
  useEffect(() => {
    let cancelled = false;
    api<unknown>("/providers")
      .then(validateProviderList)
      .then((loadedProviders) => {
        if (cancelled) return;
        setProviders(loadedProviders);
        setLoadingProviders(false);
      })
      .catch((failure) => {
        if (cancelled) return;
        setLoadingProviders(false);
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- URL-backed, debounced, cancellable catalogue search ---- */
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => {
        api<unknown>(
          `/missions?q=${encodeURIComponent(missionQuery)}`,
          { signal: controller.signal },
        )
          .then(validateMissionList)
          .then((loadedMissions) => {
            setMissions(
              loadedMissions.filter(
                  (mission) =>
                    !deletedMissionIdsRef.current.has(mission.missionId),
                )
                .sort(
                  (left, right) =>
                    new Date(right.updatedAt ?? 0).getTime() -
                    new Date(left.updatedAt ?? 0).getTime(),
                ),
            );
            setLoadingCatalogue(false);
            setLoadedQuery(missionQuery);
          })
          .catch((failure) => {
            if (
              failure instanceof DOMException &&
              failure.name === "AbortError"
            ) {
              return;
            }
            setLoadingCatalogue(false);
            setLoadedQuery(missionQuery);
            setError(
              failure instanceof Error ? failure.message : String(failure),
            );
          });
      },
      missionQuery === "" ? 0 : 200,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [catalogueRevision, missionQuery]);

  /* ---- fetch the full mission after opening a catalogue summary ---- */
  useEffect(() => {
    if (currentMissionId === null) return;
    const controller = new AbortController();
    api<unknown>(`/missions/${currentMissionId}`, {
      signal: controller.signal,
    })
      .then(validateMission)
      .then((mission) => {
        if (deletedMissionIdsRef.current.has(mission.missionId)) return;
        setCurrent(mission);
      })
      .catch((failure) => {
        if (
          failure instanceof DOMException &&
          failure.name === "AbortError"
        ) {
          return;
        }
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    return () => controller.abort();
  }, [currentMissionId]);

  /* ---- shareable search state and the global search shortcut ---- */
  useEffect(() => {
    const readyTimer = window.setTimeout(() => {
      const initial =
        new URL(window.location.href).searchParams.get("q") ?? "";
      if (initial !== "") {
        setSearch(initial);
        setView("projects");
      }
      urlStateReadyRef.current = true;
    }, 0);
    function onPopState() {
      const query =
        new URL(window.location.href).searchParams.get("q") ?? "";
      setSearch(query);
      if (query !== "") setView("projects");
    }
    function onShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("projects");
        setSearchFocusRequest((request) => request + 1);
      }
    }
    window.addEventListener("popstate", onPopState);
    window.addEventListener("keydown", onShortcut);
    return () => {
      window.clearTimeout(readyTimer);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("keydown", onShortcut);
    };
  }, []);

  useEffect(() => {
    if (!urlStateReadyRef.current) return;
    const url = new URL(window.location.href);
    if (view === "projects" && search !== "") {
      url.searchParams.set("q", search);
    } else {
      url.searchParams.delete("q");
    }
    window.history.replaceState(null, "", url);
  }, [search, view]);

  /* ---- polling ---- */
  useEffect(() => {
    if (
      currentMissionId === null ||
      (TERMINAL.has(current?.state ?? "") && !current?.running)
    ) return;
    let disposed = false;
    let timer: number | undefined;
    let requestController: AbortController | null = null;

    const poll = async () => {
      requestController = new AbortController();
      try {
        const mission = validateMission(
          await api<unknown>(`/missions/${currentMissionId}`, {
            signal: requestController.signal,
          }),
        );
        if (
          disposed ||
          deletedMissionIdsRef.current.has(mission.missionId)
        ) return;
        setCurrent((existing) => {
          if (existing?.missionId !== mission.missionId) return existing;
          const existingTime = Date.parse(existing.updatedAt ?? "");
          const candidateTime = Date.parse(mission.updatedAt ?? "");
          return Number.isFinite(existingTime) &&
            Number.isFinite(candidateTime) &&
            candidateTime < existingTime
            ? existing
            : mission;
        });
        setMissions((items) => [
          mission,
          ...items.filter((item) => item.missionId !== mission.missionId),
        ]);
        setError(null);
      } catch (failure) {
        if (
          !disposed &&
          !(failure instanceof DOMException && failure.name === "AbortError") &&
          !deletedMissionIdsRef.current.has(currentMissionId)
        ) {
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      } finally {
        if (!disposed) {
          timer = window.setTimeout(poll, current?.error === null ? 1000 : 3000);
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      requestController?.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [current?.error, current?.running, current?.state, currentMissionId]);

  const open = useCallback((mission: Mission) => {
    setStartHandoff(null);
    setCurrent(mission);
    setError(null);
    setView("project");
    scrollToSurfaceStart();
  }, []);

  const navigate = useCallback((destination: "home" | "projects") => {
    setView(destination);
    setError(null);
    if (destination === "home") setSearch("");
  }, []);

  async function create(intent: string) {
    if (!intent) return;
    setBusy(true);
    setError(null);
    try {
      const mission = validateMission(
        await api<unknown>("/missions", {
          method: "POST",
          body: JSON.stringify({ intent }),
        }),
      );
      setCurrent(mission);
      setMissions((items) => [mission, ...items]);
      setView("project");
      scrollToSurfaceStart();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function clarify(answers: CustomerFollowUpAnswer[]): Promise<boolean> {
    if (current === null) return false;
    const missionId = current.missionId;
    setBusy(true);
    setError(null);
    try {
      let revised = validateMission(
          await api<unknown>(`/missions/${missionId}/clarify`, {
            method: "POST",
            body: JSON.stringify({ answers }),
          }),
        );
      setCurrent(revised);
      for (let attempt = 0; revised.running && attempt < 180; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 650));
        revised = validateMission(await api<unknown>(`/missions/${missionId}`));
        setCurrent(revised);
      }
      if (revised.running) {
        throw new Error("Foundry is still revising this project. The recorded instruction is safe; refresh to continue.");
      }
      if (revised.error !== null) throw new Error(revised.error);
      if (revised.proposalConfirmed) scrollToSurfaceStart();
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function start(): Promise<boolean> {
    if (current === null) return false;
    setBusy(true);
    setError(null);
    try {
      await api<{ accepted: true; missionId: string }>(
        `/missions/${current.missionId}/start`,
        { method: "POST", body: "{}" },
      );
      setStartHandoff({
        missionId: current.missionId,
        projectName: current.profile?.name ?? current.intent,
        baselineActivitySequence: Math.max(
          0,
          ...current.activities.map((activity) => activity.sequence),
        ),
        startedAt: Date.now(),
      });
      setCurrent((mission) =>
        mission === null ? null : { ...mission, running: true, error: null },
      );
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function stop(mission: Mission) {
    setBusy(true);
    setError(null);
    try {
      setCurrent(
        validateMission(
          await api<unknown>(`/missions/${mission.missionId}/stop`, {
            method: "POST",
            body: "{}",
          }),
        ),
      );
      setStartHandoff(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function retryUnderstanding() {
    if (current === null) return;
    setBusy(true);
    setError(null);
    try {
      setCurrent(
        validateMission(
          await api<unknown>(`/missions/${current.missionId}/understand`, {
            method: "POST",
            body: "{}",
          }),
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function refreshProviders() {
    setRefreshingProviders(true);
    setError(null);
    try {
      const payload = await api<unknown>("/providers/refresh", {
        method: "POST",
        body: "{}",
      });
      setProviders(validateProviderList(payload));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setRefreshingProviders(false);
    }
  }

  function retryHomeLoading() {
    setError(null);
    setLoadingCatalogue(true);
    setCatalogueRevision((revision) => revision + 1);
    void refreshProviders();
  }

  async function deleteProject(mission: Mission) {
    deletedMissionIdsRef.current.add(mission.missionId);
    const wasCurrent = current?.missionId === mission.missionId;
    setMissions((items) =>
      items.filter((item) => item.missionId !== mission.missionId),
    );
    if (wasCurrent) {
      setCurrent(null);
      setView("projects");
    }
    setBusy(true);
    setError(null);
    try {
      await api<{ deleted: true; missionId: string }>(
        `/missions/${mission.missionId}`,
        { method: "DELETE" },
      );
    } catch (failure) {
      deletedMissionIdsRef.current.delete(mission.missionId);
      setMissions((items) =>
        items.some((item) => item.missionId === mission.missionId)
          ? items
          : [mission, ...items],
      );
      if (wasCurrent) {
        setCurrent(mission);
        setView("project");
      }
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  const providersReady = providers.filter((provider) => provider.available).length;

  /* ---- project surface routing ---- */
  function renderProject(mission: Mission) {
    const experience = selectFoundryExperience(mission, providers);
    if (startHandoff?.missionId === mission.missionId) {
      return (
        <StartBuildingTransition
          activityArrived={mission.activities.some(
            (activity) =>
              activity.sequence > startHandoff.baselineActivitySequence,
          )}
          onComplete={() => setStartHandoff(null)}
          onStop={() =>
            setConfirm({
              kind: "stop",
              mission,
              returnFocus:
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null,
            })
          }
          projectName={startHandoff.projectName}
          startedAt={startHandoff.startedAt}
        />
      );
    }
    if (
      mission.profile === null &&
      mission.productTypeDiscovery !== null
    ) {
      return (
        <ProductTypeDiscovery
          busy={busy || mission.running}
          discovery={mission.productTypeDiscovery}
          onContinue={clarify}
        />
      );
    }
    if (experience.surface === "reading") {
      return (
        <Reading mission={mission} busy={busy} onRetry={retryUnderstanding} />
      );
    }
    if (
      experience.surface === "unsupported" &&
      experience.understanding !== null &&
      experience.unsupported !== null
    ) {
      return (
        <UnsupportedRequest
          understanding={experience.understanding}
          unsupported={experience.unsupported}
          busy={busy}
          onDesignWeb={async () => {
            await clarify([
              {
                questionId: "customer-web-version",
                answer:
                  "Design a web version of this instead. It must run in a browser.",
              },
            ]);
          }}
          onStartOver={() => setView("home")}
        />
      );
    }
    if (experience.surface === "completion") {
      return <CompletionHandoff experience={experience} mission={mission} />;
    }
    if (
      ["failed", "blocked", "cancelled"].includes(experience.surface) &&
      experience.lifecycleOutcome !== null
    ) {
      return (
        <LifecycleOutcome
          mission={mission}
          outcome={experience.lifecycleOutcome}
          onBack={() => setView("projects")}
          onStartSomethingNew={() => setView("home")}
        />
      );
    }
    if (
      experience.surface === "understanding" &&
      experience.understanding !== null
    ) {
      return (
        <ProjectDiscovery
          key={`discovery-${mission.missionId}`}
          understanding={experience.understanding}
          conversation={mission.discoveryConversation}
          decisions={experience.clarification}
          busy={busy}
          missionRunning={mission.running}
          onClarify={clarify}
          profileVersion={mission.profile?.profileVersion ?? 1}
        />
      );
    }
    if (
      experience.surface === "plan" &&
      experience.decisionBrief !== null
    ) {
      return (
        <DecisionBrief
          brief={experience.decisionBrief}
          blueprint={mission.productBlueprint}
          busy={busy}
          missionRunning={mission.running}
          onStart={start}
          onClarify={clarify}
          profileVersion={mission.profile?.profileVersion ?? 1}
        />
      );
    }
    return (
      <ActiveExecutionSurface
        experience={experience}
        mission={mission}
        busy={busy}
        onStop={() =>
          setConfirm({
            kind: "stop",
            mission,
            returnFocus:
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null,
          })
        }
      />
    );
  }

  return (
    <>
      <ApplicationShell
        activeDestination={
          view === "home" || view === "projects" ? view : null
        }
        loadingProviders={loadingProviders}
        providersReady={providersReady}
        onNavigate={navigate}
        onOpenProviders={() => setView("providers")}
      >
        {view === "home" && (
          <HomeView
            missions={missions}
            loading={loadingCatalogue}
            busy={busy}
            error={error}
            providersReady={providersReady}
            onCreate={(intent) => void create(intent)}
            onOpen={open}
            onDelete={(mission, returnFocus) =>
              setConfirm({ kind: "delete", mission, returnFocus })
            }
            onRefreshProviders={() => void refreshProviders()}
            onRetry={retryHomeLoading}
            onShowAll={() => setView("projects")}
            refreshingProviders={refreshingProviders}
          />
        )}

        {view === "projects" && (
          <ProjectsView
            busy={busy}
            focusRequest={searchFocusRequest}
            loading={loadingCatalogue}
            missions={missions}
            onCreate={(intent) => void create(intent)}
            onDelete={(mission, returnFocus) =>
              setConfirm({ kind: "delete", mission, returnFocus })
            }
            onOpen={open}
            onQueryChange={setSearch}
            providersReady={providersReady}
            query={search}
            searching={searching}
          />
        )}

        {view === "providers" && (
          <ProviderView
            providers={providers}
            refreshing={refreshingProviders}
            onRefresh={() => void refreshProviders()}
          />
        )}

        {view === "project" && current && renderProject(current)}
      </ApplicationShell>

      {confirm?.kind === "delete" && (
        <ConfirmSheet
          heading={`Delete ${confirm.mission.profile?.name ?? "this project"}?`}
          body="It's removed from your projects. The record of what happened stays on disk."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          destructive
          returnFocus={confirm.returnFocus}
          onConfirm={() => {
            const mission = confirm.mission;
            setConfirm(null);
            void deleteProject(mission);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm?.kind === "stop" && (
        <ConfirmSheet
          heading="Stop this build?"
          body="Work so far is kept and the plan stays saved. You can review it later or start something new."
          confirmLabel="Stop the build"
          cancelLabel="Keep building"
          returnFocus={confirm.returnFocus}
          onConfirm={() => {
            const mission = confirm.mission;
            setConfirm(null);
            void stop(mission);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}
