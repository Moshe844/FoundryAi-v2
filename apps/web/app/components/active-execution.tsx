"use client";

import { useEffect, useRef, useState } from "react";

import type {
  FoundryExperienceModel,
  Mission,
} from "../../experience/contracts";
import { buildElapsedLabel } from "../../experience/timing";
import { EngineeringDetails } from "./engineering-details";
import { PhaseSpine } from "./phase-spine";
import { PreviewDock } from "./preview-dock";

type NeedsYouItem = Readonly<{
  id: string;
  description: string;
  action: string | null;
}>;

type ViewportMode = "mobile" | "tablet" | "desktop";

function useViewportMode(): ViewportMode {
  const [mode, setMode] = useState<ViewportMode>("desktop");

  useEffect(() => {
    function update() {
      setMode(
        window.innerWidth < 768
          ? "mobile"
          : window.innerWidth < 1280
            ? "tablet"
            : "desktop",
      );
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return mode;
}

function MobilePreviewSheet({
  invoker,
  mission,
  notice,
  onClose,
  preview,
}: {
  invoker: React.RefObject<HTMLButtonElement | null>;
  mission: Mission;
  notice: string | null;
  onClose: () => void;
  preview: FoundryExperienceModel["preview"];
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previewInvoker = invoker.current;
    document.body.style.overflow = "hidden";
    done.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = sheet.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], iframe, [tabindex]:not([tabindex="-1"])',
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

    function keepFocusInside(event: FocusEvent) {
      if (
        event.target instanceof Node &&
        !sheet.current?.contains(event.target)
      ) {
        done.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", keepFocusInside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", keepFocusInside);
      document.body.style.overflow = previousOverflow;
      if (previewInvoker?.isConnected) {
        previewInvoker.focus();
      } else {
        document.getElementById("main")?.focus();
      }
    };
  }, [invoker]);

  return (
    <div
      ref={sheet}
      className="mobile-preview-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-preview-heading"
    >
      <div className="mobile-preview-head">
        <button
          ref={done}
          className="btn btn-secondary"
          type="button"
          onClick={() => onCloseRef.current()}
        >
          Done
        </button>
        <h2 className="t-title-s" id="mobile-preview-heading">
          Live preview
        </h2>
      </div>
      <PreviewDock
        fullWidth
        hideWidthPresets
        mission={mission}
        notice={notice}
        preview={preview}
      />
    </div>
  );
}

export function NeedsYouSlot({ items }: { items: readonly NeedsYouItem[] }) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (items.length > 0) heading.current?.focus();
  }, [items.length]);

  if (items.length === 0) return null;
  const first = items[0];
  return (
    <section className="needs" role="status" aria-live="assertive">
      <p className="t-micro needs-label">Needs you</p>
      <h2 className="t-title-m" ref={heading} tabIndex={-1}>
        {first.description}
      </h2>
      {first.action && (
        <p className="t-body-s ink-secondary">{first.action}</p>
      )}
      {items.length > 1 && (
        <p className="t-caption ink-tertiary">{items.length - 1} more waiting</p>
      )}
    </section>
  );
}

export function ActiveExecution({
  busy,
  experience,
  mission,
  onStop,
}: {
  busy: boolean;
  experience: FoundryExperienceModel;
  mission: Mission;
  onStop: () => void;
}) {
  const [elapsed, setElapsed] = useState<string | null>(null);
  const [tabletTab, setTabletTab] = useState<"build" | "preview">("build");
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
  const viewportMode = useViewportMode();
  const previewInvoker = useRef<HTMLButtonElement>(null);
  const tabletScroll = useRef({ build: 0, preview: 0 });
  const needsYou: NeedsYouItem[] = [];

  if (
    experience.approval.available.value &&
    experience.approval.description.value
  ) {
    needsYou.push({
      id: experience.approval.requestId.value ?? "approval",
      description: experience.approval.description.value,
      action: "Review this request so I can carry on.",
    });
  }
  if (experience.blocker?.active.value) {
    needsYou.push({
      id: "blocker",
      description:
        experience.blocker.description.value ??
        "I need something from you before I can carry on.",
      action: experience.blocker.customerAction.value,
    });
  }

  useEffect(() => {
    const updateElapsed = () => setElapsed(buildElapsedLabel(mission));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 10_000);
    return () => window.clearInterval(timer);
  }, [mission]);

  const hasPreview = experience.preview.state.value !== "absent";
  const notice =
    (mission.profile?.customerContent.missingBeforeLaunch.length ?? 0) > 0
      ? "Draft preview · Final customer content is still needed before launch."
      : null;

  function selectTabletTab(next: "build" | "preview") {
    tabletScroll.current[tabletTab] = window.scrollY;
    setTabletTab(next);
    window.requestAnimationFrame(() => {
      window.scrollTo({
        top: tabletScroll.current[next],
        left: 0,
        behavior: "auto",
      });
    });
  }

  return (
    <section className="act execution-workspace">
      <div className="build-head">
        <h1 className="t-title-l">
          {mission.profile?.name ?? mission.intent}
        </h1>
        <div className="build-head-meta">
          <span className="pill working">
            <i aria-hidden="true" />
            <span>{experience.project.customerPhase.value}</span>
          </span>
          {elapsed && (
            <span className="build-time t-caption desktop-build-action">
              Elapsed&nbsp;·&nbsp;{elapsed}
            </span>
          )}
          <button
            className="btn btn-secondary btn-compact desktop-build-action"
            disabled={busy}
            onClick={onStop}
          >
            Stop
          </button>
          <details className="mobile-build-menu">
            <summary aria-label="Build actions">⋯</summary>
            <div>
              {elapsed && (
                <span className="t-caption">
                  Elapsed&nbsp;·&nbsp;{elapsed}
                </span>
              )}
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={onStop}
              >
                Stop
              </button>
            </div>
          </details>
        </div>
      </div>

      <NeedsYouSlot items={needsYou} />

      {hasPreview && viewportMode === "tablet" && (
        <div className="preview-tabs" role="tablist" aria-label="Build view">
          <button
            id="build-tab"
            type="button"
            role="tab"
            aria-controls="build-panel"
            aria-selected={tabletTab === "build"}
            onClick={() => selectTabletTab("build")}
          >
            Build
          </button>
          <button
            id="preview-tab"
            type="button"
            role="tab"
            aria-controls="preview-panel"
            aria-selected={tabletTab === "preview"}
            onClick={() => selectTabletTab("preview")}
          >
            Preview
            {experience.preview.state.value === "live" && (
              <span className="orb" aria-hidden="true" />
            )}
          </button>
        </div>
      )}

      <div
        className={`dock-layout${
          hasPreview && viewportMode === "desktop" ? " has-dock" : ""
        }`}
      >
        <div
          className="build-main"
          id={viewportMode === "tablet" ? "build-panel" : undefined}
          role={viewportMode === "tablet" ? "tabpanel" : undefined}
          aria-labelledby={
            viewportMode === "tablet" ? "build-tab" : undefined
          }
          hidden={viewportMode === "tablet" && tabletTab !== "build"}
        >
          <PhaseSpine
            announceRepair={needsYou.length === 0}
            compact={viewportMode === "mobile"}
            experience={experience}
            mission={mission}
          />

          <div
            className="now-block measure"
            aria-live={
              needsYou.length > 0 || experience.repair !== null
                ? "off"
                : "polite"
            }
            aria-atomic="true"
          >
            <h2 className="t-display-l">
              {experience.narrative.headline.value}
            </h2>
            <p className="now-why">{experience.narrative.detail.value}</p>
          </div>

          <p className="t-body-s ink-tertiary">
            You can leave this page. I&rsquo;ll keep going and everything is
            recorded.
          </p>

          <EngineeringDetails key={mission.missionId} mission={mission} />
        </div>

        {hasPreview && viewportMode === "desktop" && (
          <PreviewDock
            key={mission.missionId}
            mission={mission}
            notice={notice}
            preview={experience.preview}
          />
        )}

        {hasPreview && viewportMode === "tablet" && (
          <div
            className="tablet-preview-panel"
            id="preview-panel"
            role="tabpanel"
            aria-labelledby="preview-tab"
            hidden={tabletTab !== "preview"}
          >
            <PreviewDock
              fullWidth
              key={mission.missionId}
              mission={mission}
              notice={notice}
              preview={experience.preview}
            />
          </div>
        )}
      </div>

      {hasPreview && viewportMode === "mobile" && (
        <div className="mobile-preview-action">
          <button
            ref={previewInvoker}
            className="btn btn-primary btn-wide"
            type="button"
            onClick={() => setMobilePreviewOpen(true)}
          >
            View preview
          </button>
        </div>
      )}

      {hasPreview && viewportMode === "mobile" && mobilePreviewOpen && (
        <MobilePreviewSheet
          invoker={previewInvoker}
          mission={mission}
          notice={notice}
          preview={experience.preview}
          onClose={() => setMobilePreviewOpen(false)}
        />
      )}
    </section>
  );
}
