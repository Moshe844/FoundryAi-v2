export function projectIsDeleted(events) {
  return events.some(
    (record) =>
      record.fact?.metadata?.projectCatalogueOperation?.operation ===
      "DELETED",
  );
}

export function recordProjectDeletion({
  control,
  missionId,
  timestamp,
  suffix,
}) {
  const events = control.ledger.reportEvents(missionId);
  if (projectIsDeleted(events)) {
    return { deleted: true, missionId, alreadyDeleted: true };
  }
  const evidenceId = `${missionId}-catalogue-delete-${suffix}`;
  const deletionEvidence = control.evidence.captureCatalogueDeletion({
    evidenceId,
    missionId,
    kind: "http-response-result",
    captureMethod: "local-customer-project-deletion",
    producingSubsystem: "LOCAL_API",
    timestamp,
    payload: {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deleted: true, missionId }),
    },
    sensitiveValues: [],
    workspaceCheckpointReference: null,
    obligationReference: null,
    verificationRequestReference: null,
    commandReference: null,
    workUnitReference: null,
    metadata: { operation: "project-catalogue-delete" },
  });
  control.catalogue.recordDeletionFact({
    missionId,
    eventId: `${missionId}-catalogue-deleted-${suffix}`,
    causationId: `${missionId}-customer-delete-${suffix}`,
    occurredAt: timestamp,
    producingSubsystem: "LOCAL_API",
    fact: {
      statement: `Project "${missionId}" was removed from the customer catalogue.`,
      resultBearing: true,
      evidenceReferences: [
        {
          evidenceId: deletionEvidence.evidenceId,
          workspaceCheckpointReference: null,
        },
      ],
      workspaceCheckpointReference: null,
      workUnitReference: null,
      metadata: {
        projectCatalogueOperation: {
          operation: "DELETED",
          occurredAt: timestamp,
        },
      },
    },
  });
  return { deleted: true, missionId, alreadyDeleted: false };
}
