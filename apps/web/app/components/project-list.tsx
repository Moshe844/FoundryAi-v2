"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { Mission } from "../../experience/contracts";
import { customerPhase } from "../../experience/selectors";
import { ProjectCard } from "./project-card";
import { ProjectComposer } from "./project-composer";

export type ProjectFilter =
  | "all"
  | "building"
  | "needs-you"
  | "delivered"
  | "stopped";

const FILTERS: readonly Readonly<{
  id: ProjectFilter;
  label: string;
}>[] = [
  { id: "all", label: "All" },
  { id: "building", label: "Building" },
  { id: "needs-you", label: "Needs you" },
  { id: "delivered", label: "Delivered" },
  { id: "stopped", label: "Stopped" },
];

function belongsToFilter(mission: Mission, filter: ProjectFilter) {
  if (filter === "all") return true;
  const phase = customerPhase(mission);
  if (filter === "building") {
    return ["Building", "Testing", "Correcting an issue"].includes(phase.label);
  }
  if (filter === "needs-you") {
    return ["Waiting on you", "Needs you"].includes(phase.label);
  }
  if (filter === "delivered") return phase.label === "Delivered";
  return ["Stopped", "Cancelled"].includes(phase.label);
}

export function ProjectGrid({
  limit,
  loading,
  missions,
  onDelete,
  onOpen,
  query,
}: Readonly<{
  limit?: number;
  loading: boolean;
  missions: readonly Mission[];
  onDelete: (
    mission: Mission,
    returnFocus: HTMLButtonElement | null,
  ) => void;
  onOpen: (mission: Mission) => void;
  query?: string;
}>) {
  if (loading) {
    return (
      <div className="grid-3" aria-label="Loading projects">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
    );
  }

  const visible =
    limit === undefined ? missions : missions.slice(0, Math.max(0, limit));
  return (
    <div className="grid-3">
      {visible.map((mission) => (
        <ProjectCard
          key={mission.missionId}
          mission={mission}
          query={query}
          onOpen={() => onOpen(mission)}
          onDelete={(returnFocus) => onDelete(mission, returnFocus)}
        />
      ))}
    </div>
  );
}

export function ProjectsView({
  busy,
  focusRequest,
  loading,
  missions,
  onCreate,
  onDelete,
  onOpen,
  onQueryChange,
  providersReady,
  query,
  searching,
}: Readonly<{
  busy: boolean;
  focusRequest: number;
  loading: boolean;
  missions: readonly Mission[];
  onCreate: (intent: string) => void;
  onDelete: (
    mission: Mission,
    returnFocus: HTMLButtonElement | null,
  ) => void;
  onOpen: (mission: Mission) => void;
  onQueryChange: (query: string) => void;
  providersReady: number;
  query: string;
  searching: boolean;
}>) {
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focusRequest > 0) {
      window.requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [focusRequest]);

  const filtered = useMemo(
    () => missions.filter((mission) => belongsToFilter(mission, filter)),
    [filter, missions],
  );

  return (
    <section className="act">
      <div className="section-head projects-heading">
        <h1 className="t-display-l">Projects</h1>
        <label className="project-search">
          <span className="sr-only">Search your projects</span>
          <input
            ref={inputRef}
            id="project-search"
            className="search-field"
            value={query}
            suppressHydrationWarning
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search your projects"
            type="search"
          />
          <kbd>Ctrl K</kbd>
        </label>
      </div>

      <div className="phase-filters" aria-label="Filter projects">
        {FILTERS.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            className={filter === candidate.id ? "active" : undefined}
            aria-pressed={filter === candidate.id}
            onClick={() => setFilter(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <div className={searching ? "list-dim" : undefined} aria-busy={searching}>
        {loading ? (
          <ProjectGrid
            loading
            missions={[]}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        ) : filtered.length === 0 ? (
          <div className="empty catalogue-empty">
            <p className="t-body-m">
              {query.trim().length >= 2
                ? `Nothing matches “${query.trim()}”.`
                : filter === "all"
                  ? "You haven't started anything yet."
                  : `No ${FILTERS.find((item) => item.id === filter)?.label.toLocaleLowerCase()} projects.`}
            </p>
            {query.trim().length >= 2 && (
              <button
                className="btn-quiet small"
                onClick={() => onQueryChange("")}
              >
                Clear search
              </button>
            )}
            {(filter === "all" || query.trim().length >= 2) && (
              <div className="measure empty-composer">
                <ProjectComposer
                  busy={busy}
                  unavailableReason={
                    providersReady === 0
                      ? "Add a model provider first."
                      : null
                  }
                  onSubmit={onCreate}
                />
              </div>
            )}
          </div>
        ) : (
          <ProjectGrid
            loading={false}
            missions={filtered}
            query={query.trim().length >= 2 ? query : undefined}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        )}
      </div>
    </section>
  );
}
