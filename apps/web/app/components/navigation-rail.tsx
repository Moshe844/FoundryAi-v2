"use client";

export type PrimaryDestination = "home" | "projects";

type NavigationRailProps = Readonly<{
  activeDestination: PrimaryDestination | null;
  providerLabel: string;
  providersReady: boolean;
  mobile?: boolean;
  onNavigate: (destination: PrimaryDestination) => void;
  onOpenProviders: () => void;
  onNavigationComplete?: () => void;
}>;

function HomeIcon() {
  return (
    <svg
      className="nav-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 6.5 8 2l6 4.5V14H2V6.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ProjectsIcon() {
  return (
    <svg
      className="nav-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="M2 6.5h12" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function NavigationRail({
  activeDestination,
  providerLabel,
  providersReady,
  mobile = false,
  onNavigate,
  onOpenProviders,
  onNavigationComplete,
}: NavigationRailProps) {
  function navigate(destination: PrimaryDestination) {
    onNavigate(destination);
    onNavigationComplete?.();
  }

  return (
    <nav
      className={mobile ? "rail rail-mobile" : "rail rail-desktop"}
      aria-label="Foundry"
    >
      <button
        className="brand"
        onClick={() => navigate("home")}
        aria-label="Foundry home"
      >
        <span className="brand-seed" aria-hidden="true" />
        <span className="brand-word">Foundry</span>
      </button>
      <div className="nav">
        <button
          className={
            activeDestination === "home" ? "nav-item active" : "nav-item"
          }
          onClick={() => navigate("home")}
          aria-current={activeDestination === "home" ? "page" : undefined}
        >
          <HomeIcon />
          <span>Home</span>
        </button>
        <button
          className={
            activeDestination === "projects" ? "nav-item active" : "nav-item"
          }
          onClick={() => navigate("projects")}
          aria-current={activeDestination === "projects" ? "page" : undefined}
        >
          <ProjectsIcon />
          <span>Projects</span>
        </button>
      </div>
      <div className="rail-spacer" />
      <div className="rail-foot">
        <button className="provider-chip" onClick={onOpenProviders}>
          <span
            className={providersReady ? "orb" : "orb offline"}
            aria-hidden="true"
          />
          <span>{providerLabel}</span>
        </button>
      </div>
    </nav>
  );
}
