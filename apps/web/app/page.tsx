"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ApplicationShell } from "./components/application-shell";
import type {
  Mission,
  ProjectProfile,
  ProjectQuestion as Question,
  ProjectSuggestion as Suggestion,
  Provider,
} from "../experience/contracts";
import {
  customerPhase,
  selectFoundryExperience,
} from "../experience/selectors";
import {
  validateMission,
  validateMissionList,
  validateProviderList,
} from "../experience/validation";

const API = "http://127.0.0.1:3927";

/* ==========================================================================
   Types — unchanged API contract
   ========================================================================== */

type Answer = {
  mode: "none" | "decide" | "choice" | "other" | "skip";
  choice?: string;
  text?: string;
};

/* ==========================================================================
   Copy and translation tables
   ========================================================================== */

const STARTERS = [
  "A website for my business",
  "An appointment booking system",
  "A customer portal with logins",
  "An internal tool for my team",
  "An API for reservations",
];

const LEXICON: Array<{ keys: string[]; completions: string[] }> = [
  {
    keys: ["booking", "bookings", "appointment", "appointments"],
    completions: [
      "for a hair studio",
      "for a dental practice",
      "with staff calendars",
      "that takes a deposit",
    ],
  },
  {
    keys: ["shop", "store", "sell", "selling"],
    completions: [
      "with a catalogue and prices",
      "that takes card payments",
      "that tracks what is left",
    ],
  },
  {
    keys: ["website", "site"],
    completions: [
      "with a contact form",
      "with service pages",
      "with customer reviews",
    ],
  },
  {
    keys: ["portal", "login", "logins", "account", "accounts"],
    completions: [
      "where customers see their own records",
      "with password reset",
      "with staff and customer roles",
    ],
  },
  {
    keys: ["records", "catalogue", "catalog"],
    completions: [
      "that tracks who changed what",
      "with a printable report",
      "with search and filters",
    ],
  },
  {
    keys: ["api"],
    completions: [
      "for another team to call",
      "with rate limiting",
      "with documentation",
    ],
  },
  {
    keys: ["dashboard", "report", "reports"],
    completions: [
      "for my team",
      "with a weekly summary",
      "that exports to a spreadsheet",
    ],
  },
  {
    keys: ["crm", "customers", "clients"],
    completions: ["with notes and history", "with a follow-up reminder"],
  },
];

/** Stack capability identifiers are never shown raw. */
const CAPABILITY_COPY: Record<string, string | null> = {
  "web-application": null,
  typescript: null,
  "sqlite-persistence": "Its own database",
  "create-records": "People can add records",
  "update-records": "People can change records",
  "refresh-persistence": "Data survives a refresh",
  "production-build": "Built the way it would really ship",
  "development-runtime": "Runs on your machine",
  "browser-verification": "Tested in a real browser",
  "automated-tests": "Automated tests included",
  "package-export": "A portable project folder you own",
};

const PERSISTENCE_CAPABILITIES = new Set([
  "sqlite-persistence",
  "create-records",
  "update-records",
  "refresh-persistence",
]);

function translateCapability(identifier: string): string | null {
  if (identifier in CAPABILITY_COPY) return CAPABILITY_COPY[identifier];
  if (typeof console !== "undefined") {
    console.warn(
      `[foundry] Capability "${identifier}" has no customer wording yet.`,
    );
  }
  const spaced = identifier.replaceAll("-", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

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

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return new Date(iso).toLocaleDateString();
}

function elapsedLabel(mission: Mission): string | null {
  const first = mission.activities[0];
  if (!first) return null;
  const minutes = Math.floor((Date.now() - new Date(first.occurredAt).getTime()) / 60000);
  if (minutes < 1) return "under a minute";
  return `${minutes} min`;
}

function Chevron() {
  return (
    <svg
      className="chev"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.5 6.5 5 3 8.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PhasePill({ mission }: { mission: Mission }) {
  const phase = customerPhase(mission);
  return (
    <span className={`pill ${phase.pill}`}>
      <i aria-hidden="true" />
      {phase.label}
    </span>
  );
}

/* ==========================================================================
   Engineering details — everything internal, losslessly preserved
   ========================================================================== */

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

/* ==========================================================================
   Preview dock
   ========================================================================== */

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

/* ==========================================================================
   Home
   ========================================================================== */

function Composer({
  value,
  onChange,
  onSubmit,
  busy,
  disabled,
  placeholder,
  hint,
  submitLabel,
  busyLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  busy: boolean;
  disabled?: boolean;
  placeholder: string;
  hint: ReactNode;
  submitLabel: string;
  busyLabel: string;
}) {
  return (
    <form
      className="composer"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="sr-only" htmlFor="project-intent">
        Describe what you want built
      </label>
      <textarea
        id="project-intent"
        suppressHydrationWarning
        value={value}
        rows={3}
        placeholder={placeholder}
        aria-describedby="intent-help"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            if (!busy && value.trim()) onSubmit();
          }
        }}
      />
      <div className="composer-foot">
        <span id="intent-help" className="t-caption ink-tertiary">
          {hint}
        </span>
        <button
          className="btn btn-primary"
          disabled={busy || !value.trim() || disabled}
          title={disabled ? "Add a model provider first." : undefined}
        >
          {busy ? busyLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}

function ProjectCard({
  mission,
  onOpen,
  onDelete,
  query,
}: {
  mission: Mission;
  onOpen: () => void;
  onDelete: () => void;
  query?: string;
}) {
  const phase = customerPhase(mission);
  const name = mission.profile?.name ?? mission.intent;
  const summary = mission.profile?.summary ?? mission.intent;

  const highlight = (text: string) => {
    const q = query?.trim();
    if (!q) return text;
    const index = text.toLowerCase().indexOf(q.toLowerCase());
    if (index < 0) return text;
    return (
      <>
        {text.slice(0, index)}
        <mark>{text.slice(index, index + q.length)}</mark>
        {text.slice(index + q.length)}
      </>
    );
  };

  return (
    <article className="card project">
      <div className="project-top">
        <span className="mono-mark" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="project-body">
          <p className="project-name">{highlight(name)}</p>
          <p className="t-body-s project-sum">{highlight(summary)}</p>
        </div>
      </div>
      <div className="project-foot">
        <PhasePill mission={mission} />
        <span className="t-caption ink-tertiary">
          {relativeTime(mission.updatedAt)}
        </span>
      </div>
      <div className="project-actions">
        <button className="btn btn-secondary btn-wide" onClick={onOpen}>
          {phase.action}
        </button>
        <button
          className="overflow-btn"
          aria-label={`Delete ${name}`}
          title="Delete project"
          onClick={onDelete}
        >
          ⋯
        </button>
      </div>
    </article>
  );
}

function Home({
  missions,
  loading,
  busy,
  error,
  providersReady,
  onCreate,
  onOpen,
  onDelete,
  onOpenProviders,
  onRefreshProviders,
  refreshingProviders,
}: {
  missions: Mission[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  providersReady: number;
  onCreate: (intent: string) => Promise<void>;
  onOpen: (mission: Mission) => void;
  onDelete: (mission: Mission) => void;
  onOpenProviders: () => void;
  onRefreshProviders: () => Promise<void>;
  refreshingProviders: boolean;
}) {
  const [intent, setIntent] = useState("");

  const words = intent.trim() ? intent.trim().split(/\s+/) : [];
  const suggestions = useMemo(() => {
    if (words.length === 0) return { kind: "starters" as const, items: STARTERS };
    if (words.length >= 4) return { kind: "enough" as const, items: [] };
    const lower = intent.toLowerCase();
    const hits: string[] = [];
    for (const entry of LEXICON) {
      if (entry.keys.some((key) => new RegExp(`\\b${key}\\b`).test(lower))) {
        hits.push(...entry.completions);
      }
    }
    return hits.length > 0
      ? { kind: "completions" as const, items: hits.slice(0, 5) }
      : { kind: "starters" as const, items: STARTERS };
  }, [intent, words.length]);

  return (
    <>
      <section className="act">
        <div className="masthead">
          <span className="t-micro">Foundry</span>
          <span className="masthead-rule" aria-hidden="true" />
          <span className="t-caption">
            Design · Architecture · Build · Proof
          </span>
        </div>

        <div className="home-split">
        <div>
        <div className="measure">
          <h1 className="t-display-xl">What should I build for you?</h1>
          <p className="t-body-l lead">
            A sentence is enough. I&rsquo;ll work out what a business like yours
            needs, propose it, then build it, run it, and prove it works.
          </p>
        </div>

        <div className="measure" style={{ marginTop: "var(--space-6)" }}>
          {!loading && providersReady === 0 && (
            <div className="banner banner-attention" role="alert">
              <div className="banner-body">
                <strong>I can&rsquo;t start without a model provider.</strong>
                <p className="t-body-s">
                  Add an OpenAI, Anthropic, or Google key to the{" "}
                  <code>.env</code> file in your project folder, then re-check. I
                  won&rsquo;t substitute anything for real intelligence.
                </p>
                <button
                  className="btn btn-secondary btn-compact"
                  style={{ marginTop: "var(--space-3)" }}
                  disabled={refreshingProviders}
                  onClick={() => void onRefreshProviders()}
                >
                  {refreshingProviders ? "Checking…" : "Re-check providers"}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="banner banner-fault" role="alert">
              <div className="banner-body">
                <p className="t-body-s">{error}</p>
              </div>
            </div>
          )}

          <Composer
            value={intent}
            onChange={setIntent}
            onSubmit={() => void onCreate(intent.trim())}
            busy={busy}
            disabled={providersReady === 0}
            placeholder="A booking site for my studio"
            hint="Enter to start · Shift + Enter for a new line"
            submitLabel="Start"
            busyLabel="Starting…"
          />
          <p className="t-body-s trust">
            I&rsquo;ll come back with a proposal before anything is built — and
            I&rsquo;ll tell you what I&rsquo;d add that you didn&rsquo;t ask for.
          </p>

          {suggestions.kind === "enough" ? (
            <p className="t-body-s capability">
              That&rsquo;s enough to start. I&rsquo;ll ask if anything&rsquo;s
              genuinely unclear.
            </p>
          ) : (
            <>
              <p className="t-micro ink-tertiary" style={{ marginTop: "var(--space-6)" }}>
                Try
              </p>
              <div className="chips">
                {suggestions.items.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className="chip"
                    onClick={() =>
                      setIntent((current) =>
                        suggestions.kind === "completions"
                          ? `${current.replace(/\s+$/, "")} ${item}`
                          : item,
                      )
                    }
                  >
                    {suggestions.kind === "completions" ? `… ${item}` : item}
                  </button>
                ))}
              </div>
            </>
          )}

        </div>
        </div>

        {/* Real information about how the work runs, not filler for empty space. */}
        <aside className="how-panel">
          <p className="t-label">How this works</p>
          <div className="how-step">
            <span className="how-num" aria-hidden="true">01</span>
            <span className="how-body">
              <span className="how-title">You describe the outcome</span>
              <span className="how-detail t-body-s">
                One sentence. No specs, no page lists, no technical decisions.
              </span>
            </span>
          </div>
          <div className="how-step">
            <span className="how-num" aria-hidden="true">02</span>
            <span className="how-body">
              <span className="how-title">I come back with a proposal</span>
              <span className="how-detail t-body-s">
                The whole thing — including what I&rsquo;d add that you
                didn&rsquo;t ask for, and why.
              </span>
            </span>
          </div>
          <div className="how-step">
            <span className="how-num" aria-hidden="true">03</span>
            <span className="how-body">
              <span className="how-title">You decide only what matters</span>
              <span className="how-detail t-body-s">
                Usually one or two things. Skip them and I&rsquo;ll use my
                judgement.
              </span>
            </span>
          </div>
          <div className="how-step">
            <span className="how-num" aria-hidden="true">04</span>
            <span className="how-body">
              <span className="how-title">I build it and prove it</span>
              <span className="how-detail t-body-s">
                Run in a real browser against every promise I made. If something
                doesn&rsquo;t hold, I say so.
              </span>
            </span>
          </div>
          <p className="how-foot t-caption">
            Web work only — web apps, business websites, customer portals,
            internal tools, and web APIs. Ask for mobile, desktop, or a native
            game and I&rsquo;ll tell you honestly rather than substitute
            something else.
          </p>
        </aside>
        </div>
      </section>

      <section className="act">
        <div className="section-head">
          <h2 className="t-title-m">Your projects</h2>
          {providersReady > 0 && (
            <button className="btn-quiet small" onClick={onOpenProviders}>
              Model providers
            </button>
          )}
        </div>
        {loading ? (
          <div className="grid-3">
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        ) : missions.length === 0 ? (
          <p className="t-body-m empty">
            Nothing here yet. Your first project will appear here and stay
            resumable.
          </p>
        ) : (
          <div className="grid-3">
            {missions.slice(0, 6).map((mission) => (
              <ProjectCard
                key={mission.missionId}
                mission={mission}
                onOpen={() => onOpen(mission)}
                onDelete={() => onDelete(mission)}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

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
  return (
    <section className="act measure">
      <h1 className="t-display-l">Working out what you need</h1>
      <p className="t-body-l lead" aria-live="polite">
        I&rsquo;m thinking through what a business like yours normally needs, so
        I can come back with a proposal rather than a list of questions.
      </p>
      <p className="t-body-s ink-tertiary" style={{ marginTop: "var(--space-4)" }}>
        {route
          ? `${route.providerFamily ?? route.provider} · ${route.modelId}`
          : "Choosing a model for this."}
      </p>
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
   Unsupported request
   ========================================================================== */

const PLATFORM_COPY: Record<string, string> = {
  mobile: "a native mobile app",
  desktop: "a desktop application you install",
  game: "a native game",
  other: "something I don't have a certified way to build",
};

function Decline({
  mission,
  busy,
  onDesignWeb,
  onStartOver,
}: {
  mission: Mission;
  busy: boolean;
  onDesignWeb: () => Promise<void>;
  onStartOver: () => void;
}) {
  const profile = mission.profile!;
  const asked = PLATFORM_COPY[profile.platform] ?? PLATFORM_COPY.other;
  return (
    <section className="act">
      <div className="measure">
        <p className="t-micro eyebrow">What I understand</p>
        <h1 className="t-display-l">{profile.name}</h1>
        <p className="t-body-l lead">{profile.summary}</p>
      </div>
      <div className="decline" style={{ marginTop: "var(--space-8)" }}>
        <h2 className="t-title-l">
          I can&rsquo;t build this one — and I won&rsquo;t fake it.
        </h2>
        <p className="t-body-m">
          You asked for {asked}. Today I build for the web: web apps, business
          websites, customer portals, internal tools, and web APIs. I could build
          something that looks close and doesn&rsquo;t run the way you need, but
          I&rsquo;d rather tell you.
        </p>
        <p className="t-body-m">
          A web version would work in a phone&rsquo;s browser, and people
          wouldn&rsquo;t need to install anything. If that&rsquo;s useful,
          I&rsquo;ll design that instead.
        </p>
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

/* ==========================================================================
   The Read — understanding, decisions, ideas
   ========================================================================== */

function QuestionCard({
  question,
  answer,
  onChange,
}: {
  question: Question;
  answer: Answer;
  onChange: (next: Answer) => void;
}) {
  const recommended = question.answerOptions[0];
  const [showAll, setShowAll] = useState(false);
  const visible = showAll
    ? question.answerOptions
    : question.answerOptions.slice(0, 4);

  return (
    <fieldset className="question">
      <legend className="t-title-s question-prompt">{question.prompt}</legend>
      {/* Foundry's thinking is visible by default — it educates rather than gates. */}
      <p className="t-body-m question-reason">{question.reason}</p>

      <button
        type="button"
        className="opt opt-decide"
        role="radio"
        aria-checked={answer.mode === "decide"}
        onClick={() => onChange({ mode: "decide" })}
      >
        <span className="opt-row">
          <span className="opt-check" aria-hidden="true">
            ✓
          </span>
          <span>
            <span className="opt-decide-head">
              <span className="opt-decide-lead">I recommend {recommended}</span>
              <span className="badge">My recommendation</span>
            </span>
            <span className="opt-decide-detail t-body-s">
              Leave this with me and that&rsquo;s what I&rsquo;ll do.
            </span>
          </span>
        </span>
      </button>

      <div className="opt-grid" role="radiogroup" aria-label={question.prompt}>
        {visible.map((option) => (
          <button
            type="button"
            key={option}
            className="opt"
            role="radio"
            aria-checked={answer.mode === "choice" && answer.choice === option}
            onClick={() => onChange({ mode: "choice", choice: option })}
          >
            <span className="opt-row">
              <span className="opt-check" aria-hidden="true">
                ✓
              </span>
              <span>{option}</span>
            </span>
          </button>
        ))}
      </div>

      {question.answerOptions.length > 4 && !showAll && (
        <div className="q-links">
          <button type="button" className="btn-quiet small" onClick={() => setShowAll(true)}>
            More options
          </button>
        </div>
      )}

      <div className="q-links">
        <button
          type="button"
          className="btn-quiet small"
          onClick={() =>
            onChange(
              answer.mode === "other"
                ? { mode: "none" }
                : { mode: "other", text: "" },
            )
          }
        >
          Something else…
        </button>
        <button
          type="button"
          className="btn-quiet small"
          onClick={() =>
            onChange(
              answer.mode === "skip"
                ? { mode: "none" }
                : { mode: "skip", text: "" },
            )
          }
        >
          Skip for now
        </button>
      </div>

      {answer.mode === "other" && (
        <div className="q-extra">
          <label htmlFor={`other-${question.questionId}`} className="t-body-s">
            In your own words
          </label>
          <textarea
            id={`other-${question.questionId}`}
            suppressHydrationWarning
            rows={2}
            placeholder="What should I do instead?"
            value={answer.text ?? ""}
            onChange={(event) =>
              onChange({ mode: "other", text: event.target.value })
            }
          />
        </div>
      )}

      {answer.mode === "skip" && (
        <div className="q-extra">
          <p className="t-body-s skip-reassure">
            Fine by me — I&rsquo;ll go with {recommended.toLowerCase()} and keep
            going.
          </p>
          <label htmlFor={`skip-${question.questionId}`} className="t-body-s">
            Anything you&rsquo;d like Foundry to keep in mind?
          </label>
          <textarea
            id={`skip-${question.questionId}`}
            suppressHydrationWarning
            rows={2}
            value={answer.text ?? ""}
            onChange={(event) =>
              onChange({ mode: "skip", text: event.target.value })
            }
          />
        </div>
      )}

    </fieldset>
  );
}

function buildAnswerPayload(
  question: Question,
  answer: Answer,
): { questionId: string; answer: string } {
  const recommended = question.answerOptions[0];
  switch (answer.mode) {
    case "choice":
      return { questionId: question.questionId, answer: answer.choice! };
    case "other":
      return { questionId: question.questionId, answer: answer.text!.trim() };
    case "skip": {
      const note = answer.text?.trim();
      return {
        questionId: question.questionId,
        answer: note
          ? `Skipped by the customer. Use your professional judgement. Keep in mind: ${note}`
          : "Skipped by the customer. Use your professional judgement.",
      };
    }
    case "decide":
    case "none":
    default:
      return {
        questionId: question.questionId,
        answer: `Foundry decides. Recommended: ${recommended}. Use your professional judgement.`,
      };
  }
}

function Suggestions({
  suggestions,
  selected,
  onToggle,
}: {
  suggestions: readonly Suggestion[];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  if (suggestions.length === 0) return null;
  const count = suggestions.filter((s) => selected[s.suggestionId]).length;
  return (
    <section className="act">
      <div className="rule-head">
        <span className="rule-mark" aria-hidden="true" />
        <h2 className="t-title-m">I&rsquo;d also recommend</h2>
      </div>
      <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
        These aren&rsquo;t upsells or a checklist. They&rsquo;re the things
        I&rsquo;d push for if we were sitting down together, because businesses
        like yours usually get real value from them.
      </p>
      <div className="sug-stack">
        {suggestions.map((suggestion) => {
          const on = selected[suggestion.suggestionId] === true;
          return (
            <button
              type="button"
              key={suggestion.suggestionId}
              className="sug"
              role="switch"
              aria-checked={on}
              onClick={() => onToggle(suggestion.suggestionId)}
            >
              <span className="sug-toggle" aria-hidden="true">
                {on ? "✓" : "+"}
              </span>
              <span className="sug-body">
                <span className="sug-title">{suggestion.label}</span>
                <span className="sug-why t-body-s">{suggestion.rationale}</span>
              </span>
              <span className="sug-state t-caption" aria-hidden="true">
                {on ? "Added" : "Add"}
              </span>
            </button>
          );
        })}
      </div>
      {count > 0 && (
        <p className="t-body-s ink-tertiary" style={{ marginTop: "var(--space-4)" }}>
          {count} added. I&rsquo;ll build {count === 1 ? "it" : "them"} and prove{" "}
          {count === 1 ? "it works" : "they work"} like everything else.
        </p>
      )}
    </section>
  );
}

function TheRead({
  mission,
  busy,
  onClarify,
}: {
  mission: Mission;
  busy: boolean;
  onClarify: (
    answers: Array<{ questionId: string; answer: string }>,
  ) => Promise<void>;
}) {
  const profile = mission.profile!;
  const questions = profile.openQuestions;
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [profile.name]);

  const answeredCount = questions.filter((question) => {
    const answer = answers[question.questionId];
    if (!answer) return false;
    if (answer.mode === "choice") return true;
    if (answer.mode === "other") return Boolean(answer.text?.trim());
    return false;
  }).length;

  const included = profile.capabilities
    .map(translateCapability)
    .filter((label): label is string => label !== null);

  const selectedCount = profile.contextualSuggestions.filter(
    (suggestion) => selected[suggestion.suggestionId],
  ).length;

  async function submit() {
    const questionAnswers = questions.map((question) =>
      buildAnswerPayload(question, answers[question.questionId] ?? { mode: "none" }),
    );
    const suggestionAnswers = profile.contextualSuggestions
      .filter((suggestion) => selected[suggestion.suggestionId])
      .map((suggestion) => ({
        questionId: suggestion.suggestionId,
        answer: `Include this project idea: ${suggestion.label}. ${suggestion.rationale}`,
      }));
    await onClarify([...questionAnswers, ...suggestionAnswers]);
    setAnswers({});
    setSelected({});
  }

  // Judgement calls and deliberate exclusions are different things and are
  // shown separately — the second is what makes the first credible.
  const reasoning = profile.architectureDecisions.slice(0, 5);
  const leftOut = profile.constraints.slice(0, 5);

  return (
    <>
      {/* ---- Foundry speaks first: the proposal, not a form ---- */}
      <section className="act">
        <div className="voice measure">
          <span className="voice-mark" aria-hidden="true" />
          <p className="t-label voice-label">
            {profile.profileVersion > 1
              ? "Here's what I'm thinking now"
              : "Here's what I'm thinking"}
          </p>
          <h1 className="t-display-l voice-title" ref={headingRef} tabIndex={-1}>
            {profile.name}
          </h1>
          <p className="t-body-l voice-lead">{profile.summary}</p>
        </div>

        <div className="proposal">
          <div className="rule-head">
            <span className="rule-mark" aria-hidden="true" />
            <h2 className="t-title-m">Here&rsquo;s what I&rsquo;d build</h2>
          </div>
          <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
            This is the whole thing, not a starting point. I&rsquo;ve included
            what a business like yours normally needs, whether or not you asked
            for it.
          </p>

          <ol className="proposal-list">
            {profile.outcomes.map((outcome, index) => (
              <li key={outcome}>
                <span className="proposal-num" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="proposal-text">{outcome}</span>
              </li>
            ))}
          </ol>

          {included.length > 0 && (
            <div className="included">
              <p className="t-label ink-tertiary">
                Built in as standard — I didn&rsquo;t need to ask
              </p>
              <div className="included-chips">
                {included.map((label) => (
                  <span className="included-chip" key={label}>
                    <span className="included-tick" aria-hidden="true">
                      ✓
                    </span>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {profile.primaryActors.length > 0 && (
            <p className="t-body-s ink-tertiary proposal-actors">
              Designed for {profile.primaryActors.join(", ")}.
            </p>
          )}
        </div>
      </section>

      {/* ---- The calls I made, and what I gave up to make them ---- */}
      {reasoning.length > 0 && (
        <section className="act">
          <div className="rule-head">
            <span className="rule-mark" aria-hidden="true" />
            <h2 className="t-title-m">The calls I made, and why</h2>
          </div>
          <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
            These are decisions, not options. I&rsquo;ve already weighed them —
            but if one looks wrong for your business, say so and I&rsquo;ll
            rethink it.
          </p>
          <ul className="reasoning measure">
            {reasoning.map((item) => (
              <li key={item} className="t-body-m">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- What I deliberately left out: scope stated up front ---- */}
      {leftOut.length > 0 && (
        <section className="act">
          <div className="rule-head">
            <span className="rule-mark" aria-hidden="true" />
            <h2 className="t-title-m">What I&rsquo;ve deliberately left out</h2>
          </div>
          <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
            Knowing what a project isn&rsquo;t matters as much as knowing what it
            is. None of this is an oversight — ask for any of it and I&rsquo;ll
            fold it in.
          </p>
          <ul className="left-out measure">
            {leftOut.map((item) => (
              <li key={item} className="t-body-m">
                {item}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Curated recommendations ---- */}
      <Suggestions
        suggestions={profile.contextualSuggestions}
        selected={selected}
        onToggle={(id) =>
          setSelected((current) => ({ ...current, [id]: !current[id] }))
        }
      />

      {/* ---- Only what genuinely needs the customer ---- */}
      {questions.length > 0 && (
        <section className="act">
          <div className="rule-head">
            <span className="rule-mark" aria-hidden="true" />
            <h2 className="t-title-m">
              {questions.length === 1
                ? "One thing only you can decide"
                : `${questions.length} things only you can decide`}
            </h2>
          </div>
          <p className="t-body-m lead measure" style={{ marginTop: 0 }}>
            Everything else I&rsquo;ve already decided. If you&rsquo;d rather not
            weigh in, skip it and I&rsquo;ll use my judgement — that&rsquo;s a
            perfectly good answer.
          </p>
          <p className="sr-only">
            Nothing here is required. Anything you skip, I&rsquo;ll decide.
          </p>

          <div style={{ marginTop: "var(--space-6)", maxWidth: 840 }}>
            {questions.map((question) => (
              <QuestionCard
                key={question.questionId}
                question={question}
                answer={answers[question.questionId] ?? { mode: "none" }}
                onChange={(next) =>
                  setAnswers((current) => ({
                    ...current,
                    [question.questionId]: next,
                  }))
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* ---- Does this sound right? ---- */}
      <section className="act confirm-band">
        <h2 className="t-title-l">Does this sound right?</h2>
        <p className="t-body-m lead measure" style={{ marginTop: "var(--space-2)" }}>
          {selectedCount > 0
            ? `I'll fold in the ${selectedCount} idea${selectedCount === 1 ? "" : "s"} you picked and write the plan.`
            : "If it does, I'll turn this into a plan with everything I intend to prove before I call it done."}
        </p>
        <div className="continue-row">
          <button
            className="btn btn-primary btn-large"
            disabled={busy || mission.running}
            onClick={() => void submit()}
          >
            {busy || mission.running
              ? "Working it through…"
              : questions.length > 0
                ? "Yes — write the plan"
                : "Write the plan"}
          </button>
          {questions.length > 0 && (
            <span className="t-body-s continue-note">
              {answeredCount === 0
                ? `All ${questions.length} left to me`
                : `${answeredCount} answered · ${questions.length - answeredCount} left to me`}
            </span>
          )}
        </div>
      </section>
    </>
  );
}

/* ==========================================================================
   The Plan
   ========================================================================== */

function ThePlan({
  mission,
  busy,
  onStart,
  onClarify,
}: {
  mission: Mission;
  busy: boolean;
  onStart: () => Promise<void>;
  onClarify: (
    answers: Array<{ questionId: string; answer: string }>,
  ) => Promise<void>;
}) {
  const profile = mission.profile!;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [assumptionOpen, setAssumptionOpen] = useState(false);
  const [assumption, setAssumption] = useState("");
  const [showAllChecks, setShowAllChecks] = useState(false);

  const hasPersistence = profile.capabilities.some((capability) =>
    PERSISTENCE_CAPABILITIES.has(capability),
  );
  const checks = profile.verificationPlan.checks;
  const visibleChecks = showAllChecks ? checks : checks.slice(0, 4);
  const working = busy || mission.running;

  return (
    <section className="act">
      <div className="measure">
        <span className="voice-mark" aria-hidden="true" />
        <p className="t-label voice-label">Before I start</p>
        <h1 className="t-display-l">Here&rsquo;s the plan</h1>
        <p className="t-body-l lead">
          Everything I&rsquo;m going to build, the calls I&rsquo;ve made on your
          behalf, and exactly what I&rsquo;ll prove before I tell you it&rsquo;s
          done. Nothing here is guesswork you have to check.
        </p>
      </div>

      <dl style={{ marginTop: "var(--space-8)", maxWidth: 900 }}>
        <div className="field-row">
          <dt>What I&rsquo;ll build</dt>
          <dd className="t-body-m">
            {profile.name} — {profile.summary}
          </dd>
        </div>
        <div className="field-row">
          <dt>Who it&rsquo;s for</dt>
          <dd className="t-body-m">
            <div className="inline-list">
              {profile.primaryActors.map((actor) => (
                <span key={actor}>{actor}</span>
              ))}
            </div>
          </dd>
        </div>
        <div className="field-row">
          <dt>How people will use it</dt>
          <dd>
            <ol className="numbered t-body-m stack-list">
              {profile.outcomes.map((outcome) => (
                <li key={outcome}>{outcome}</li>
              ))}
            </ol>
          </dd>
        </div>
        <div className="field-row">
          <dt>How it&rsquo;s put together</dt>
          <dd>
            <p className="t-body-m">
              {hasPersistence
                ? "A web application with its own database, built the way it would really ship, running on your machine."
                : "A website built the way it would really ship, running on your machine."}
            </p>
            <details>
              <summary
                className="t-label"
                style={{ color: "var(--accent-fill)", marginTop: "var(--space-3)" }}
              >
                <Chevron />
                Technical shape
              </summary>
              <p className="t-body-s ink-secondary" style={{ marginTop: "var(--space-3)" }}>
                Next.js · TypeScript · SQLite · npm · Playwright for browser
                testing. I chose this because it&rsquo;s the one setup I&rsquo;ve
                certified end to end: I can generate it, build it, run it, test
                it, and watch it work.
              </p>
              <p className="t-body-s ink-tertiary" style={{ marginTop: "var(--space-2)" }}>
                Worth knowing: the database suits a single copy of the
                application, and browser testing runs in Chromium-based browsers.
              </p>
            </details>
          </dd>
        </div>
        {profile.architectureDecisions.length > 0 && (
          <div className="field-row">
            <dt>Decisions I made</dt>
            <dd>
              <ul className="bullets t-body-m stack-list">
                {profile.architectureDecisions.map((decision) => (
                  <li key={decision}>{decision}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {profile.constraints.length > 0 && (
          <div className="field-row">
            <dt>What I&rsquo;m assuming</dt>
            <dd>
              <ul className="bullets t-body-m stack-list">
                {profile.constraints.map((constraint) => (
                  <li key={constraint}>{constraint}</li>
                ))}
              </ul>
              <button
                className="btn-quiet small"
                style={{ marginTop: "var(--space-3)" }}
                onClick={() => setAssumptionOpen((value) => !value)}
              >
                Change an assumption
              </button>
              {assumptionOpen && (
                <div style={{ marginTop: "var(--space-3)" }}>
                  <label htmlFor="assumption" className="t-body-s ink-secondary">
                    What should I understand differently?
                  </label>
                  <textarea
                    id="assumption"
                    className="plain-textarea"
                    suppressHydrationWarning
                    rows={3}
                    style={{ marginTop: "var(--space-2)" }}
                    value={assumption}
                    onChange={(event) => setAssumption(event.target.value)}
                  />
                  <button
                    className="btn btn-secondary btn-compact"
                    style={{ marginTop: "var(--space-2)" }}
                    disabled={working || !assumption.trim()}
                    onClick={async () => {
                      await onClarify([
                        {
                          questionId: "customer-assumption-change",
                          answer: assumption.trim(),
                        },
                      ]);
                      setAssumption("");
                      setAssumptionOpen(false);
                    }}
                  >
                    Update the plan
                  </button>
                </div>
              )}
            </dd>
          </div>
        )}
        <div className="field-row">
          <dt>What I&rsquo;ll prove</dt>
          <dd>
            <p className="t-body-m">{checks.length} things, including:</p>
            <ul className="proved t-body-m stack-list" style={{ marginTop: "var(--space-3)" }}>
              {visibleChecks.map((check) => (
                <li key={check.checkId}>{check.label}</li>
              ))}
            </ul>
            {checks.length > 4 && !showAllChecks && (
              <button
                className="btn-quiet small"
                style={{ marginTop: "var(--space-3)" }}
                onClick={() => setShowAllChecks(true)}
              >
                Show all {checks.length}
              </button>
            )}
          </dd>
        </div>
      </dl>

      <div className="continue-row">
        <button
          className="btn btn-primary"
          disabled={working}
          onClick={() => void onStart()}
        >
          {working ? "Starting…" : "Start building"}
        </button>
        <button className="btn-quiet small" onClick={() => setNoteOpen((v) => !v)}>
          Add a note
        </button>
        <button
          className="btn-quiet small"
          disabled={working}
          onClick={() =>
            void onClarify([
              {
                questionId: "customer-reconsider",
                answer:
                  "Reconsider the plan and tell me if you'd do it differently.",
              },
            ])
          }
        >
          Reconsider this
        </button>
      </div>

      {noteOpen && (
        <div style={{ marginTop: "var(--space-4)", maxWidth: 640 }}>
          <label htmlFor="plan-note" className="t-body-s ink-secondary">
            Anything else I should know?
          </label>
          <textarea
            id="plan-note"
            className="plain-textarea"
            suppressHydrationWarning
            rows={3}
            style={{ marginTop: "var(--space-2)" }}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button
            className="btn btn-secondary btn-compact"
            style={{ marginTop: "var(--space-2)" }}
            disabled={working || !note.trim()}
            onClick={async () => {
              await onClarify([
                { questionId: "customer-note", answer: note.trim() },
              ]);
              setNote("");
              setNoteOpen(false);
            }}
          >
            Add it to the plan
          </button>
        </div>
      )}
    </section>
  );
}

/* ==========================================================================
   The Build
   ========================================================================== */

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

/* ==========================================================================
   Delivery
   ========================================================================== */

function Delivery({ mission }: { mission: Mission }) {
  const profile = mission.profile;
  const checks = profile?.verificationPlan.checks ?? [];
  const verified = new Set(mission.executionMetrics?.verifiedObligationIds ?? []);
  const provedCount = verified.size > 0 ? verified.size : checks.length;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? checks : checks.slice(0, 5);

  const limitations = [
    ...(profile?.constraints ?? []),
    "The database suits a single copy of the application.",
    "Browser testing runs in Chromium-based browsers.",
  ];

  return (
    <section className="act">
      <div className="delivery">
        <p className="t-micro eyebrow">{profile?.name ?? "Your project"}</p>
        <h1 className="t-display-xl" aria-live="polite">
          It&rsquo;s built, and I&rsquo;ve proved it works.
        </h1>
        <p className="t-body-l lead measure">
          Here&rsquo;s the handover: what I built, the calls I made and why, what
          I left out on purpose, and where I&rsquo;d take it next.
        </p>

        {mission.previewUrl && (
          <div className="delivery-preview">
            <Preview
              mission={mission}
              collapsed={false}
              onCollapse={() => {}}
              onRestore={() => {}}
              fullWidth
            />
          </div>
        )}

        <dl style={{ marginTop: "var(--space-8)" }}>
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
              <ul className="proved t-body-m stack-list" style={{ marginTop: "var(--space-3)" }}>
                {visible.map((check) => (
                  <li key={check.checkId}>{check.label}</li>
                ))}
              </ul>
              {checks.length > 5 && !showAll && (
                <button
                  className="btn-quiet small"
                  style={{ marginTop: "var(--space-3)" }}
                  onClick={() => setShowAll(true)}
                >
                  Show all {checks.length}
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
                <p className="t-body-m" style={{ marginBottom: "var(--space-3)" }}>
                  This is where I&rsquo;d take it next, in the order I&rsquo;d do
                  it.
                </p>
                <ol className="numbered t-body-m stack-list">
                  {profile.contextualSuggestions.map((suggestion) => (
                    <li key={suggestion.suggestionId}>
                      <span>
                        <strong>{suggestion.label}</strong> — {suggestion.rationale}
                      </span>
                    </li>
                  ))}
                </ol>
              </dd>
            </div>
          )}
        </dl>

        <EngineeringDetails mission={mission} />
      </div>
    </section>
  );
}

/* ==========================================================================
   Stopped / cancelled
   ========================================================================== */

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
              ? "I ran out of safe approaches."
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

      <EngineeringDetails mission={mission} />
    </section>
  );
}

/* ==========================================================================
   Sheets
   ========================================================================== */

function ConfirmSheet({
  heading,
  body,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: {
  heading: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const safeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    safeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <>
      <div className="scrim" />
      <div className="sheet-wrap">
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-heading"
        >
          <h2 className="t-title-l" id="confirm-heading">
            {heading}
          </h2>
          <p className="t-body-m ink-secondary" style={{ marginTop: "var(--space-3)" }}>
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

function ProvidersSheet({
  providers,
  refreshing,
  onRefresh,
  onClose,
}: {
  providers: Provider[];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside
        className="side-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="providers-heading"
      >
        <div className="sheet-head">
          <div>
            <h2 className="t-title-l" id="providers-heading">
              Model providers
            </h2>
          </div>
          <button className="close-btn" ref={closeRef} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="t-body-s ink-secondary">
          Foundry reads provider keys from the <code>.env</code> file in your
          project folder. They stay in the local server process — they&rsquo;re
          never sent to this page and never written into your project&rsquo;s
          history.
        </p>

        <div style={{ marginTop: "var(--space-6)", display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {providers.map((provider) => (
            <div className="card" key={provider.providerId}>
              <div className="project-foot">
                <strong className="t-body-m">{provider.displayName}</strong>
                <span
                  className={`pill ${provider.available ? "pill-delivered" : "pill-neutral"}`}
                >
                  <i aria-hidden="true" />
                  {provider.available ? "Available" : "Unavailable"}
                </span>
              </div>
              <p className="t-body-s ink-secondary" style={{ marginTop: "var(--space-2)" }}>
                {provider.reason}
              </p>
              {provider.models.map((model) => (
                <p className="t-caption ink-tertiary" key={model.modelId}>
                  {model.displayName} · {model.status}
                </p>
              ))}
            </div>
          ))}
        </div>

        <p className="t-caption ink-tertiary" style={{ marginTop: "var(--space-5)" }}>
          These are the models Foundry could use, not models fixed to one
          project. I pick an eligible model for each step based on the work being
          done. Your provider&rsquo;s billing is the authority on cost.
        </p>

        <button
          className="btn btn-secondary"
          style={{ marginTop: "var(--space-5)" }}
          disabled={refreshing}
          onClick={() => void onRefresh()}
        >
          {refreshing ? "Validating…" : "Validate providers again"}
        </button>
      </aside>
    </>
  );
}

/* ==========================================================================
   Page
   ========================================================================== */

export default function Page() {
  const [view, setView] = useState<"home" | "projects" | "project">("home");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [current, setCurrent] = useState<Mission | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showProviders, setShowProviders] = useState(false);
  const [refreshingProviders, setRefreshingProviders] = useState(false);
  const [loadingCatalogue, setLoadingCatalogue] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Derived, not stored: results are stale while the loaded query trails input.
  const [loadedQuery, setLoadedQuery] = useState("");
  const searching = loadedQuery !== search;
  const [confirm, setConfirm] = useState<
    | { kind: "delete"; mission: Mission }
    | { kind: "stop"; mission: Mission }
    | null
  >(null);
  const deletedMissionIdsRef = useRef(new Set<string>());
  const currentMissionId = current?.missionId ?? null;

  /* ---- catalogue + providers ---- */
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<unknown>(`/missions?q=${encodeURIComponent(search)}`),
      api<unknown>("/providers"),
    ])
      .then(async ([missionPayload, providerPayload]) => {
        const loadedMissions = validateMissionList(missionPayload);
        const loadedProviders = validateProviderList(providerPayload);
        let updated: Mission | null = null;
        if (currentMissionId !== null) {
          updated = validateMission(
            await api<unknown>(`/missions/${currentMissionId}`),
          );
        }
        if (cancelled) return;
        setMissions(
          loadedMissions.filter(
            (mission) => !deletedMissionIdsRef.current.has(mission.missionId),
          ),
        );
        setProviders(loadedProviders);
        setLoadingCatalogue(false);
        setLoadedQuery(search);
        if (
          updated !== null &&
          !deletedMissionIdsRef.current.has(updated.missionId)
        ) {
          setCurrent(updated);
        }
      })
      .catch((failure) => {
        if (cancelled) return;
        if (
          currentMissionId === null ||
          !deletedMissionIdsRef.current.has(currentMissionId)
        ) {
          setLoadingCatalogue(false);
          setLoadedQuery(search);
          setError(failure.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentMissionId, search]);

  /* ---- polling ---- */
  useEffect(() => {
    if (currentMissionId === null || TERMINAL.has(current?.state ?? "")) return;
    const timer = window.setInterval(
      () => {
        api<unknown>(`/missions/${currentMissionId}`)
          .then(validateMission)
          .then((mission) => {
            if (deletedMissionIdsRef.current.has(mission.missionId)) return;
            setCurrent(mission);
            setMissions((items) => [
              mission,
              ...items.filter((item) => item.missionId !== mission.missionId),
            ]);
          })
          .catch((failure) => {
            if (!deletedMissionIdsRef.current.has(currentMissionId)) {
              setError(failure.message);
            }
          });
      },
      current?.error === null ? 1000 : 3000,
    );
    return () => window.clearInterval(timer);
  }, [current?.error, current?.state, currentMissionId]);

  const open = useCallback((mission: Mission) => {
    setCurrent(mission);
    setError(null);
    setView("project");
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
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function clarify(answers: Array<{ questionId: string; answer: string }>) {
    if (current === null) return;
    setBusy(true);
    setError(null);
    try {
      setCurrent(
        validateMission(
          await api<unknown>(`/missions/${current.missionId}/clarify`, {
            method: "POST",
            body: JSON.stringify({ answers }),
          }),
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (current === null) return;
    setBusy(true);
    setError(null);
    try {
      await api<{ accepted: true; missionId: string }>(
        `/missions/${current.missionId}/start`,
        { method: "POST", body: "{}" },
      );
      setCurrent((mission) =>
        mission === null ? null : { ...mission, running: true, error: null },
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
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
    if (experience.surface === "reading") {
      return (
        <Reading mission={mission} busy={busy} onRetry={retryUnderstanding} />
      );
    }
    if (experience.surface === "unsupported") {
      return (
        <Decline
          mission={mission}
          busy={busy}
          onDesignWeb={() =>
            clarify([
              {
                questionId: "customer-web-version",
                answer:
                  "Design a web version of this instead. It must run in a browser.",
              },
            ])
          }
          onStartOver={() => setView("home")}
        />
      );
    }
    if (experience.surface === "completion") {
      return <Delivery mission={mission} />;
    }
    if (experience.surface === "stopped") {
      return <Stopped mission={mission} onReopen={() => setView("projects")} />;
    }
    if (experience.surface === "understanding") {
      return <TheRead mission={mission} busy={busy} onClarify={clarify} />;
    }
    if (experience.surface === "plan") {
      return (
        <ThePlan
          mission={mission}
          busy={busy}
          onStart={start}
          onClarify={clarify}
        />
      );
    }
    return (
      <TheBuild
        mission={mission}
        busy={busy}
        onStop={() => setConfirm({ kind: "stop", mission })}
      />
    );
  }

  return (
    <>
      <ApplicationShell
        activeDestination={view === "project" ? null : view}
        loadingProviders={loadingCatalogue}
        providersReady={providersReady}
        onNavigate={setView}
        onOpenProviders={() => setShowProviders(true)}
      >
          {view === "home" && (
            <Home
              missions={missions}
              loading={loadingCatalogue}
              busy={busy}
              error={error}
              providersReady={providersReady}
              onCreate={create}
              onOpen={open}
              onDelete={(mission) => setConfirm({ kind: "delete", mission })}
              onOpenProviders={() => setShowProviders(true)}
              onRefreshProviders={refreshProviders}
              refreshingProviders={refreshingProviders}
            />
          )}

          {view === "projects" && (
            <section className="act">
              <div className="section-head">
                <h1 className="t-display-l">Projects</h1>
                <input
                  className="search-field"
                  value={search}
                  suppressHydrationWarning
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search your projects"
                  aria-label="Search your projects"
                />
              </div>
              {missions.length === 0 ? (
                <p className="t-body-m empty">
                  {search
                    ? `Nothing matches “${search}”.`
                    : "You haven't started anything yet."}
                  {search && (
                    <>
                      {" "}
                      <button className="btn-quiet small" onClick={() => setSearch("")}>
                        Clear search
                      </button>
                    </>
                  )}
                </p>
              ) : (
                <div className={`grid-3${searching ? " list-dim" : ""}`}>
                  {missions.map((mission) => (
                    <ProjectCard
                      key={mission.missionId}
                      mission={mission}
                      query={search}
                      onOpen={() => open(mission)}
                      onDelete={() => setConfirm({ kind: "delete", mission })}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {view === "project" && current && renderProject(current)}
      </ApplicationShell>

      {showProviders && (
        <ProvidersSheet
          providers={providers}
          refreshing={refreshingProviders}
          onRefresh={refreshProviders}
          onClose={() => setShowProviders(false)}
        />
      )}

      {confirm?.kind === "delete" && (
        <ConfirmSheet
          heading={`Delete ${confirm.mission.profile?.name ?? "this project"}?`}
          body="It's removed from your projects. The record of what happened stays on disk."
          confirmLabel="Delete"
          cancelLabel="Keep it"
          destructive
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
          body="Work so far is kept and the plan stays saved. You can reopen this and start again."
          confirmLabel="Stop the build"
          cancelLabel="Keep building"
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
