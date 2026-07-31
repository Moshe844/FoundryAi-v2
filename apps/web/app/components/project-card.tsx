"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import type { Mission } from "../../experience/contracts";
import { selectProjectSummary } from "../../experience/selectors";

type ProjectCardProps = Readonly<{
  mission: Mission;
  onDelete: (returnFocus: HTMLButtonElement | null) => void;
  onOpen: () => void;
  query?: string;
}>;

function relativeTime(iso: string | null): string {
  if (iso === null) return "";
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return new Date(iso).toLocaleDateString();
}

function highlighted(text: string, query?: string) {
  const trimmed = query?.trim();
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pieces = text.split(new RegExp(`(${escaped})`, "giu"));
  return pieces.map((piece, index) =>
    piece.toLocaleLowerCase() === trimmed.toLocaleLowerCase() ? (
      <mark key={`${piece}-${index}`}>{piece}</mark>
    ) : (
      <Fragment key={`${piece}-${index}`}>{piece}</Fragment>
    ),
  );
}

export function ProjectCard({
  mission,
  onDelete,
  onOpen,
  query,
}: ProjectCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const summary = selectProjectSummary(mission);
  const name = summary.name.value;
  const description = summary.summary.value ?? mission.intent;

  useEffect(() => {
    if (!menuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  return (
    <article className="card project">
      <div className="project-top">
        <span className="mono-mark" aria-hidden="true">
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="project-body">
          <p className="project-name">{highlighted(name, query)}</p>
          <p className="t-body-s project-sum">
            {highlighted(description, query)}
          </p>
        </div>
      </div>
      <div className="project-foot">
        <span className="pill">
          <i aria-hidden="true" />
          {summary.customerPhase.value}
        </span>
        <span className="t-caption ink-tertiary">
          {relativeTime(summary.lastActivityAt.value)}
        </span>
      </div>
      <div className="project-actions">
        <button className="btn btn-secondary btn-wide" onClick={onOpen}>
          {summary.actionLabel.value}
        </button>
        <div className="project-menu">
          <button
            ref={menuButtonRef}
            className="overflow-btn"
            aria-label={`Project actions for ${name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="project-menu-popover" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(menuButtonRef.current);
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
