import { project, getTime, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';

interface OperatingModeChangedSubject {
  tenantId: string;
  userId: string;
  mode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
}

export function operatingModeChanged(
  payload: EventPayload,
  ctx: EventContext,
): WriteIntent {
  const s = payload.subject as unknown as OperatingModeChangedSubject;
  const tenantId = s.tenantId ?? ctx.tenantId;
  const userId = s.userId ?? ctx.userId;
  const now = getTime();
  const pk = `InvestorProfile#${tenantId}#${userId}`;
  return project(
    'InvestorProfile',
    {
      tenantId,
      userId,
      operatingMode: s.mode,
      updatedAt: now,
      timestamp: now,
    },
    { pk, sk: 'InvestorProfile' },
  );
}
