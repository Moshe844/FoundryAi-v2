"use client";

import type { Mission } from "../../experience/contracts";
import { ProjectComposer } from "./project-composer";
import { ProjectGrid } from "./project-list";

export function HomeView({
  busy,
  error,
  loading,
  missions,
  onCreate,
  onDelete,
  onOpen,
  onRefreshProviders,
  onRetry,
  onShowAll,
  providersReady,
  refreshingProviders,
}: Readonly<{
  busy: boolean;
  error: string | null;
  loading: boolean;
  missions: readonly Mission[];
  onCreate: (intent: string) => void;
  onDelete: (
    mission: Mission,
    returnFocus: HTMLButtonElement | null,
  ) => void;
  onOpen: (mission: Mission) => void;
  onRefreshProviders: () => void;
  onRetry: () => void;
  onShowAll: () => void;
  providersReady: number;
  refreshingProviders: boolean;
}>) {
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
                Describe the outcome in a sentence. I&rsquo;ll design it, choose
                how it&rsquo;s built, build it, run it, and prove it works.
              </p>
            </div>

            <div className="measure home-composer">
              {!loading && providersReady === 0 && (
                <div className="banner banner-attention" role="alert">
                  <div className="banner-body">
                    <strong>
                      I can&rsquo;t start without a model provider.
                    </strong>
                    <p className="t-body-s">
                      Add an OpenAI, Anthropic, or Google key to the{" "}
                      <code>.env</code> file in your project folder, then
                      re-check. I won&rsquo;t substitute anything for real
                      intelligence.
                    </p>
                    <button
                      className="btn btn-secondary btn-compact"
                      disabled={refreshingProviders}
                      onClick={onRefreshProviders}
                    >
                      {refreshingProviders
                        ? "Checking…"
                        : "Re-check providers"}
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div className="banner banner-fault" role="alert">
                  <div className="banner-body">
                    <p className="t-body-s">{error}</p>
                    <button
                      type="button"
                      className="btn btn-secondary btn-compact"
                      onClick={onRetry}
                    >
                      Try again
                    </button>
                  </div>
                </div>
              )}

              <ProjectComposer
                busy={busy}
                unavailableReason={
                  providersReady === 0 ? "Add a model provider first." : null
                }
                onSubmit={onCreate}
              />
              <p className="t-body-s trust">
                I&rsquo;ll come back with a plan before anything is built.
              </p>
              <p className="t-caption capability-line">
                I build for the web today — web apps, business websites,
                customer portals, internal tools, and web APIs. Ask me for a
                mobile, desktop, or native game build and I&rsquo;ll tell you
                honestly instead of substituting something else.
              </p>
            </div>
          </div>

          <aside className="how-panel">
            <p className="t-label">How this works</p>
            {[
              [
                "01",
                "You describe the outcome",
                "One sentence. No specs, no page lists, no technical decisions.",
              ],
              [
                "02",
                "I come back with a proposal",
                "The whole thing — including what I’d add that you didn’t ask for, and why.",
              ],
              [
                "03",
                "You decide only what matters",
                "Usually one or two things. Skip them and I’ll use my judgement.",
              ],
              [
                "04",
                "I build it and prove it",
                "I run it in a real browser against every promise I made.",
              ],
            ].map(([number, title, detail]) => (
              <div className="how-step" key={number}>
                <span className="how-num" aria-hidden="true">
                  {number}
                </span>
                <span className="how-body">
                  <span className="how-title">{title}</span>
                  <span className="how-detail t-body-s">{detail}</span>
                </span>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <section className="act">
        <div className="section-head">
          <h2 className="t-title-m">Your projects</h2>
          {!loading && missions.length > 6 && (
            <button className="btn-quiet small" onClick={onShowAll}>
              Show all {missions.length} →
            </button>
          )}
        </div>
        {!loading && missions.length === 0 ? (
          <p className="t-body-m empty">
            Nothing here yet. Your first project will appear here and stay
            resumable.
          </p>
        ) : (
          <ProjectGrid
            limit={6}
            loading={loading}
            missions={missions}
            onDelete={onDelete}
            onOpen={onOpen}
          />
        )}
      </section>
    </>
  );
}
