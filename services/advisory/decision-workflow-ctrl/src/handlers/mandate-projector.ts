import {
  materializeToTable,
  projectVersioned,
  skip,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../repositories/mandate-snapshot.repository';

function projectMandateSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as string | undefined;

  if (!operatingMode) {
    throw new NotRetryableError(
      `${ctx.eventType} missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  const version = subject.__version;
  if (typeof version !== 'number') return skip();

  // Full-row P1 projection keyed on the Mandate version line. The FIRST write
  // (MANDATE_ISSUED) creates the row -> stream INSERT -> MANDATE_SNAPSHOT_CREATED
  // (the SF trigger) fires once; later OPERATING_MODE_CHANGED overwrites the row
  // -> MODIFY -> no re-trigger.
  return projectVersioned('MandateSnapshot', {
    tenantId,
    userId,
    mandateId: subject.mandateId as string | undefined,
    level: subject.level as string | undefined,
    operatingMode,
    effectiveDate: subject.effectiveDate as string | undefined,
    status: (subject.status as string | undefined) ?? 'ACTIVE',
  }, {
    version,
    overrides: { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK },
  });
}

export const createHandlers = () => ({
  [InvestorBffEventTypes.MANDATE_ISSUED]: async (p: EventPayload, c: EventContext) => projectMandateSnapshot(p, c),
  [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: async (p: EventPayload, c: EventContext) => projectMandateSnapshot(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'MANDATE_PROJECTION_FAILED',
});
