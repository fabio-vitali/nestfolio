import { update, type WriteIntent, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { resolveGuardrailParams } from '../domain/guardrail-params';

interface OperatingModeChangedSubject {
  tenantId: string;
  userId: string;
  mode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';
}

export function operatingModeChanged(
  payload: EventPayload,
  _ctx: EventContext,
): WriteIntent {
  const s = payload.subject as unknown as OperatingModeChangedSubject;
  const params = resolveGuardrailParams(s.mode);

  return update('Mandate', {
    ...params,
    operatingMode: s.mode,
  }, {
    overrides: {
      pk: `InvestorProfile#${s.tenantId}#${s.userId}`,
      sk: 'Mandate',
    },
  });
}
