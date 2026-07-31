"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import type {
  Mission,
  PreviewState,
  PreviewStateName,
} from "../../experience/contracts";

const MIN_WIDTH = 480;
const WIDTH_STEP = 40;

function bounds() {
  if (typeof window === "undefined") {
    return { minimum: MIN_WIDTH, maximum: 960 };
  }
  const maximum = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.7));
  return { minimum: Math.min(MIN_WIDTH, maximum), maximum };
}

function clampWidth(width: number) {
  const { minimum, maximum } = bounds();
  return Math.round(Math.min(maximum, Math.max(minimum, width)));
}

function StateMessage({
  plainCause,
  state,
}: {
  plainCause: string | null;
  state: PreviewStateName;
}) {
  const copy: Record<
    Exclude<PreviewStateName, "absent" | "live" | "rebuilding">,
    { title: string; detail: string }
  > = {
    starting: {
      title: "Starting it up",
      detail: "I’ll show it here after it answers a real request.",
    },
    disconnected: {
      title: "Lost connection",
      detail: "The application was running, but this preview can’t reach it.",
    },
    crashed: {
      title: "It stopped running. I’m looking at why.",
      detail: "Your project files and recorded work are still safe.",
    },
    stopped: {
      title: "The preview isn’t running any more.",
      detail: "The project files are still in your workspace.",
    },
    error: {
      title: "It didn’t start.",
      detail:
        plainCause ??
        "The recorded startup check did not succeed.",
    },
    unavailable: {
      title: "A preview isn’t available.",
      detail: "There is no recorded runtime address to show.",
    },
  };
  const message =
    state === "absent" || state === "live" || state === "rebuilding"
      ? null
      : copy[state];
  if (message === null) return null;
  return (
    <div className={`preview-state preview-state-${state}`}>
      <div>
        <p className="t-title-s">{message.title}</p>
        <p className="t-body-s ink-secondary">{message.detail}</p>
      </div>
    </div>
  );
}

export function PreviewDock({
  fullWidth = false,
  hideWidthPresets = false,
  mission,
  notice = null,
  preview,
}: {
  fullWidth?: boolean;
  hideWidthPresets?: boolean;
  mission: Mission;
  notice?: string | null;
  preview: PreviewState;
}) {
  const storageKey = `foundry:preview-width:${mission.missionId}`;
  const collapseKey = `foundry:preview-collapsed:${mission.missionId}`;
  const [collapsed, setCollapsed] = useState(
    () =>
      !fullWidth &&
      typeof window !== "undefined" &&
      window.localStorage.getItem(collapseKey) === "true",
  );
  const [width, setWidth] = useState(() => {
    if (fullWidth || typeof window === "undefined") return 560;
    const stored = Number(window.localStorage.getItem(storageKey));
    return Number.isFinite(stored) && stored > 0
      ? clampWidth(stored)
      : clampWidth(560);
  });
  const [frameKey, setFrameKey] = useState(0);
  const [frameWidth, setFrameWidth] = useState<
    "desktop" | "tablet" | "phone"
  >("desktop");
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const dragStart = useRef<{ clientX: number; width: number } | null>(null);
  const url = preview.readinessUrl.value;
  const projectedState = preview.state.value;
  const visibleState = projectedState;

  useEffect(() => {
    if (fullWidth) return;
    function onResize() {
      setWidth((current) => clampWidth(current));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fullWidth]);

  const host = useMemo(() => {
    if (url === null) return null;
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }, [url]);

  if (projectedState === "absent") return null;

  function storeWidth(nextWidth: number) {
    const integerWidth = clampWidth(nextWidth);
    setWidth(integerWidth);
    window.localStorage.setItem(storageKey, String(integerWidth));
  }

  function setIsCollapsed(nextCollapsed: boolean) {
    setCollapsed(nextCollapsed);
    window.localStorage.setItem(collapseKey, String(nextCollapsed));
  }

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    dragStart.current = { clientX: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (dragStart.current === null) return;
    storeWidth(
      dragStart.current.width + dragStart.current.clientX - event.clientX,
    );
  }

  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    dragStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onResizeKey(event: KeyboardEvent<HTMLButtonElement>) {
    const { minimum, maximum } = bounds();
    if (event.key === "ArrowLeft") storeWidth(width + WIDTH_STEP);
    else if (event.key === "ArrowRight") storeWidth(width - WIDTH_STEP);
    else if (event.key === "Home") storeWidth(minimum);
    else if (event.key === "End") storeWidth(maximum);
    else if (event.key === "Escape") setIsCollapsed(true);
    else return;
    event.preventDefault();
  }

  if (!fullWidth && collapsed) {
    return (
      <div className="preview-collapsed" style={{ width: 44 }}>
        <span className="preview-collapsed-label" aria-hidden="true">
          Preview
        </span>
        <button
          className="preview-show"
          onClick={() => setIsCollapsed(false)}
          title="Show preview"
          aria-label="Show preview"
        >
          Show preview
        </button>
      </div>
    );
  }

  return (
    <aside
      className={`preview-shell${fullWidth ? " full-width" : ""}${
        expanded ? " expanded" : ""
      }`}
      style={fullWidth ? undefined : { width }}
      aria-label="Application preview"
    >
      {!fullWidth && (
        <button
          className="preview-resizer"
          role="separator"
          aria-label="Resize preview"
          aria-orientation="vertical"
          aria-valuemin={bounds().minimum}
          aria-valuemax={bounds().maximum}
          aria-valuenow={width}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onKeyDown={onResizeKey}
        />
      )}
      <div className="preview">
        <div className="preview-bar">
          <span className="preview-bar-title">
            {visibleState === "live" ? "Live preview" : "Preview"}
          </span>
          <div className="preview-tools">
            {!hideWidthPresets &&
              (["desktop", "tablet", "phone"] as const).map((preset) => (
              <button
                key={preset}
                aria-label={`${preset[0].toUpperCase()}${preset.slice(1)} width`}
                title={`${preset[0].toUpperCase()}${preset.slice(1)} width`}
                aria-pressed={frameWidth === preset}
                onClick={() => setFrameWidth(preset)}
              >
                {preset === "desktop" ? "▭" : preset === "tablet" ? "▱" : "▯"}
              </button>
              ))}
            {!fullWidth && (
              <button
                onClick={() => setExpanded((current) => !current)}
                aria-label={
                  expanded ? "Leave expanded preview" : "Expand preview"
                }
                title={expanded ? "Leave expanded preview" : "Expand preview"}
              >
                {expanded ? "↙" : "⤢"}
              </button>
            )}
            {url !== null && (
              <>
                <button
                  onClick={() => {
                    setFrameLoaded(false);
                    setFrameKey((key) => key + 1);
                  }}
                  aria-label="Reload preview"
                  title="Reload preview"
                >
                  ↻
                </button>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open in a new tab"
                  title="Open in a new tab"
                >
                  ↗
                </a>
              </>
            )}
            {!fullWidth && (
              <button
                onClick={() => setIsCollapsed(true)}
                aria-label="Collapse the preview panel"
                title="Collapse"
              >
                ×
              </button>
            )}
          </div>
        </div>
        {notice !== null && (
          <p className="preview-notice" role="note">
            {notice}
          </p>
        )}
        <div
          className={`preview-body preview-body-${visibleState} frame-${frameWidth}${
            visibleState === "rebuilding" ? " rebuilding" : ""
          }`}
        >
          {url !== null &&
            ["starting", "live", "rebuilding", "disconnected"].includes(
              visibleState,
            ) && (
              <iframe
                key={frameKey}
                title={`Preview of ${mission.profile?.name ?? "your project"}`}
                src={url}
                onLoad={() => setFrameLoaded(true)}
              />
            )}
          {visibleState === "starting" && !frameLoaded && (
            <StateMessage
              plainCause={mission.executionProjection.runtime?.plainCause ?? null}
              state="starting"
            />
          )}
          {visibleState !== "starting" && (
            <StateMessage
              plainCause={mission.executionProjection.runtime?.plainCause ?? null}
              state={visibleState}
            />
          )}
        </div>
        <div className="preview-foot">
          {visibleState === "rebuilding" ? (
            <span>Rebuilding — this preview is from a moment ago</span>
          ) : visibleState === "live" ? (
            <>
              <span className="orb" aria-hidden="true" />
              <span>Live · {host}</span>
            </>
          ) : visibleState === "starting" ? (
            <span>Starting</span>
          ) : visibleState === "disconnected" ? (
            <>
              <span>Lost the connection</span>
              <button
                className="btn-quiet small"
                onClick={() => setFrameKey((key) => key + 1)}
              >
                Reconnect
              </button>
            </>
          ) : visibleState === "crashed" ? (
            <span>Crashed</span>
          ) : visibleState === "stopped" ? (
            <span>Not running</span>
          ) : (
            <span>Unavailable</span>
          )}
        </div>
      </div>
    </aside>
  );
}
