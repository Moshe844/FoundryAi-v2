"use client";

import { useState } from "react";

import type { Mission } from "../../experience/contracts";

const ACTIVITY_WINDOW = 200;

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

function DetailSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <details className="eng-sec">
      <summary>
        <Chevron />
        {title}
      </summary>
      <div className="eng-sec-body">{children}</div>
    </details>
  );
}

function evidenceLabel(
  evidence: Readonly<{
    evidenceId: string;
    verificationRequestReference?: string | null;
    workspaceCheckpointReference: string | null;
  }>,
) {
  return [
    evidence.evidenceId,
    evidence.verificationRequestReference,
    evidence.workspaceCheckpointReference,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function EngineeringDetails({ mission }: { mission: Mission }) {
  const storageKey = `foundry:engineering-details:${mission.missionId}`;
  const [open, setOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(storageKey) === "open",
  );
  const [activityLimit, setActivityLimit] = useState(ACTIVITY_WINDOW);
  const activities = [...mission.activities].reverse();
  const metrics = mission.executionMetrics;

  return (
    <details
      className="eng"
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        setOpen(nextOpen);
        window.localStorage.setItem(storageKey, nextOpen ? "open" : "closed");
      }}
    >
      <summary>
        <Chevron />
        Engineering details
        {activities.length > 0 ? ` · ${activities.length} records` : ""}
      </summary>
      <div className="eng-body">
        <p className="t-body-s eng-intro">
          The evidence and operating details below are reconstructed from
          recorded events. They are here for inspection, not as customer
          progress.
        </p>

        <DetailSection title="Activity">
          {activities.length === 0 ? (
            <p className="t-body-s ink-secondary">Nothing recorded yet.</p>
          ) : (
            <>
              <ul className="eng-activity" aria-label="Recorded activity">
                {activities.slice(0, activityLimit).map((item) => (
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
              {activityLimit < activities.length && (
                <button
                  className="btn-quiet small eng-more"
                  onClick={() =>
                    setActivityLimit((limit) =>
                      Math.min(limit + ACTIVITY_WINDOW, activities.length),
                    )
                  }
                >
                  Show the next{" "}
                  {Math.min(
                    ACTIVITY_WINDOW,
                    activities.length - activityLimit,
                  )}{" "}
                  records
                </button>
              )}
            </>
          )}
        </DetailSection>

        <DetailSection title="Model routing">
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
                    <th>task / depth</th>
                    <th>status</th>
                    <th>attempt</th>
                    <th>reason</th>
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
                        {route.depthLevel === null
                          ? ""
                          : ` · depth ${route.depthLevel}`}
                      </td>
                      <td>{route.status.toLowerCase()}</td>
                      <td>{route.attempt}</td>
                      <td>{route.routingReason ?? "not recorded"}</td>
                      <td>{route.inputTokens ?? "—"}</td>
                      <td>{route.outputTokens ?? "—"}</td>
                      <td>
                        {route.costUsd !== null && route.costUsd > 0
                          ? `$${route.costUsd.toFixed(4)}`
                          : "cost unavailable locally"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailSection>

        <DetailSection title="Counters">
          {metrics === null ? (
            <p className="t-body-s ink-secondary">
              No execution counters have been recorded yet.
            </p>
          ) : (
            <dl className="eng-counters">
              <div>
                <dt>providerCallCount</dt>
                <dd>{metrics.providerCallCount}</dd>
              </div>
              <div>
                <dt>uniqueHypothesisCount</dt>
                <dd>{metrics.uniqueHypothesisCount}</dd>
              </div>
              <div>
                <dt>repeatedPipelineCost</dt>
                <dd>{metrics.repeatedPipelineCost}</dd>
              </div>
              <div>
                <dt>installCount</dt>
                <dd>{metrics.installCount}</dd>
              </div>
              <div>
                <dt>reinstallCount</dt>
                <dd>{metrics.reinstallCount}</dd>
              </div>
              <div>
                <dt>rebuildCount</dt>
                <dd>{metrics.rebuildCount}</dd>
              </div>
              <div>
                <dt>runtimeRestartCount</dt>
                <dd>{metrics.runtimeRestartCount}</dd>
              </div>
              <div>
                <dt>repairScopes</dt>
                <dd>{JSON.stringify(metrics.repairScopes)}</dd>
              </div>
            </dl>
          )}
        </DetailSection>

        <DetailSection title="Verification">
          {mission.executionProjection.verification.length === 0 ? (
            <p className="t-body-s ink-secondary">
              No verification obligations have been recorded yet.
            </p>
          ) : (
            <div className="eng-scroll">
              <table>
                <thead>
                  <tr>
                    <th>obligation</th>
                    <th>verdict</th>
                    <th>statement</th>
                    <th>detail</th>
                    <th>evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {mission.executionProjection.verification.map((item) => (
                    <tr key={item.obligationId}>
                      <td>{item.obligationId}</td>
                      <td>{item.result}</td>
                      <td>{item.statement}</td>
                      <td>{item.detail ?? "—"}</td>
                      <td>
                        {item.evidenceReferences.length === 0
                          ? "—"
                          : item.evidenceReferences
                              .map(evidenceLabel)
                              .join(" | ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailSection>

        <DetailSection title="Workspace">
          <dl className="eng-counters">
            <div>
              <dt>mission</dt>
              <dd>{mission.missionId}</dd>
            </div>
            <div>
              <dt>workspace</dt>
              <dd>
                {mission.executionProjection.workspace.workspaceId ??
                  "not recorded"}
              </dd>
            </div>
            <div>
              <dt>checkpoints</dt>
              <dd>
                {mission.executionProjection.workspace.checkpointIds.length ===
                0
                  ? "none recorded"
                  : mission.executionProjection.workspace.checkpointIds.join(
                      ", ",
                    )}
              </dd>
            </div>
            <div>
              <dt>stack</dt>
              <dd>
                {mission.technicalStack.stackId}@
                {mission.technicalStack.stackVersion}
              </dd>
            </div>
            <div>
              <dt>runtime adapter</dt>
              <dd>
                {mission.executionProjection.workspace.runtimeAdapterId}
              </dd>
            </div>
          </dl>
        </DetailSection>
      </div>
    </details>
  );
}
