"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

import {
  NavigationRail,
  type PrimaryDestination,
} from "./navigation-rail";

type ApplicationShellProps = Readonly<{
  activeDestination: PrimaryDestination | null;
  children: ReactNode;
  loadingProviders: boolean;
  providersReady: number;
  onNavigate: (destination: PrimaryDestination) => void;
  onOpenProviders: () => void;
}>;

function providerLabel(loading: boolean, ready: number) {
  if (loading) return "Checking providers…";
  if (ready === 0) return "No providers";
  return `${ready} provider${ready === 1 ? "" : "s"} ready`;
}

export function ApplicationShell({
  activeDestination,
  children,
  loadingProviders,
  providersReady,
  onNavigate,
  onOpenProviders,
}: ApplicationShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const navigationSheetRef = useRef<HTMLElement>(null);
  const label = providerLabel(loadingProviders, providersReady);

  useEffect(() => {
    if (!mobileNavigationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileNavigationOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        const controls = navigationSheetRef.current?.querySelectorAll<
          HTMLButtonElement | HTMLAnchorElement
        >('button:not([disabled]), a[href]');
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
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavigationOpen]);

  function closeMobileNavigation() {
    setMobileNavigationOpen(false);
    menuButtonRef.current?.focus();
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <NavigationRail
        activeDestination={activeDestination}
        providerLabel={label}
        providersReady={providersReady > 0}
        onNavigate={onNavigate}
        onOpenProviders={onOpenProviders}
      />

      <header className="mobile-topbar">
        <button
          ref={menuButtonRef}
          className="mobile-menu-button"
          type="button"
          aria-label="Open navigation"
          aria-expanded={mobileNavigationOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMobileNavigationOpen(true)}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className="mobile-brand"
          type="button"
          onClick={() => onNavigate("home")}
          aria-label="Foundry home"
        >
          <span className="brand-seed" aria-hidden="true" />
          <span className="brand-word">Foundry</span>
        </button>
        <button
          className="mobile-provider-button"
          type="button"
          aria-label={label}
          onClick={onOpenProviders}
        >
          <span
            className={providersReady > 0 ? "orb" : "orb offline"}
            aria-hidden="true"
          />
        </button>
      </header>

      <main className="main" id="main" tabIndex={-1}>
        <div className="content">{children}</div>
      </main>

      {mobileNavigationOpen && (
        <div className="mobile-navigation-layer">
          <button
            className="mobile-navigation-scrim"
            type="button"
            aria-label="Close navigation"
            onClick={closeMobileNavigation}
          />
          <section
            ref={navigationSheetRef}
            className="mobile-navigation-sheet"
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-navigation-heading"
          >
            <div className="mobile-navigation-head">
              <span className="t-label" id="mobile-navigation-heading">
                Navigation
              </span>
              <button
                ref={closeButtonRef}
                className="mobile-navigation-close"
                type="button"
                aria-label="Close navigation"
                onClick={closeMobileNavigation}
              >
                ×
              </button>
            </div>
            <NavigationRail
              activeDestination={activeDestination}
              providerLabel={label}
              providersReady={providersReady > 0}
              mobile
              onNavigate={onNavigate}
              onOpenProviders={() => {
                closeMobileNavigation();
                onOpenProviders();
              }}
              onNavigationComplete={closeMobileNavigation}
            />
          </section>
        </div>
      )}
    </div>
  );
}
