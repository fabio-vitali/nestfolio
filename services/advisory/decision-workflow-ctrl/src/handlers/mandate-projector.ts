import {
  materializeToTable,
  record,
  update,
  NotRetryableError,
  type EventPayload,
  type EventContext,
  type WriteIntent,
} from '@nestfolio/event-processor';
import { InvestorBffEventTypes } from '@nestfolio/investor-bff/events';
import { mandateSnapshotPk, MANDATE_SNAPSHOT_SK } from '../repositories/mandate-snapshot.repository';

function processMandateIssued(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as string | undefined;
  const level = subject.level as string | undefined;
  const mandateId = subject.mandateId as string | undefined;
  const effectiveDate = subject.effectiveDate as string | undefined;

  if (!operatingMode) {
    throw new NotRetryableError(
      `MANDATE_ISSUED missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  return record('MandateSnapshot', {
    tenantId, userId, mandateId, level, operatingMode, effectiveDate,
    status: 'ACTIVE',
  }, { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK });
}

function processOperatingModeChanged(payload: EventPayload, ctx: EventContext): WriteIntent {
  const subject = payload.subject ?? {};
  const tenantId = (subject.tenantId as string) ?? ctx.tenantId;
  const userId = (subject.userId as string) ?? tenantId;
  const operatingMode = subject.operatingMode as string | undefined;

  if (!operatingMode) {
    throw new NotRetryableError(
      `OPERATING_MODE_CHANGED missing operatingMode for tenant=${tenantId} user=${userId}`,
    );
  }

  return update('MandateSnapshot', { tenantId, userId, operatingMode }, {
    overrides: { pk: mandateSnapshotPk(tenantId, userId), sk: MANDATE_SNAPSHOT_SK },
  });
}

export const createHandlers = () => ({
  [InvestorBffEventTypes.MANDATE_ISSUED]: async (p: EventPayload, c: EventContext) => processMandateIssued(p, c),
  [InvestorBffEventTypes.OPERATING_MODE_CHANGED]: async (p: EventPayload, c: EventContext) => processOperatingModeChanged(p, c),
});

export const handler = materializeToTable({
  serviceName: 'decision-workflow-ctrl',
  handlers: createHandlers(),
  errorEventType: 'MANDATE_PROJECTION_FAILED',
});
