import {
  materializeToTable,
  parseSubject,
  projectVersioned,
  skip,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';
import { MandateSnapshotSchema } from '../domain/contracts';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../repositories/mandate-snapshot.repository';

function projectMandateSnapshot(payload: EventPayload, ctx: EventContext): WriteIntent {
  // parseSubject validates the inbound mandate payload against the DWC-owned MandateSnapshotSchema.
  // Identity (tenantId/userId) is read from ctx (EventContext extends RequestContext).
  const subject = parseSubject(payload, MandateSnapshotSchema);
  const tenantId = ctx.tenantId;
  const userId = ctx.userId;
  const operatingMode = subject.operatingMode;

  if (!operatingMode) {
    throw new NotRetryableError(
      `${ctx.eventType} missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  // __version is optional in MandateSnapshotSchema so mandate-projector can read
  // it from the parsed subject rather than raw payload.subject with a cast.
  const version = subject.__version;
  if (typeof version !== 'number') return skip();

  // Full-row P1 projection keyed on the Mandate version line. The FIRST write
  // (MANDATE_ISSUED) creates the row -> stream INSERT -> MANDATE_SNAPSHOT_CREATED
  // (the SF trigger) fires once; later OPERATING_MODE_CHANGED overwrites the row
  // -> MODIFY -> no re-trigger.
  return projectVersioned('MandateSnapshot', {
    tenantId,
    userId,
    mandateId: subject.mandateId,
    level: subject.level,
    operatingMode,
    effectiveDate: subject.effectiveDate,
    status: subject.status ?? 'ACTIVE',
  }, {
    version,
    overrides: { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK },
  });
}

export const createHandlers = () => ({
  [InvestorCrossDomainEventTypes.MANDATE_ISSUED]: async (p: EventPayload, c: EventContext) => projectMandateSnapshot(p, c),
  [InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED]: async (p: EventPayload, c: EventContext) => projectMandateSnapshot(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'MANDATE_PROJECTION_FAILED',
});
