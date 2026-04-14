import { update } from '@nestfolio/event-processor';
import { operatingModeChanged } from '../../../src/transforms/operating-mode-changed';
import { resolveGuardrailParams } from '../../../src/domain/guardrail-params';

const makePayload = (mode: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE') => ({
  subject: { tenantId: 't1', userId: 'u1', mode },
});

const makeCtx = () => ({
  tenantId: 't1',
  userId: 'u1',
  region: 'us-east-1',
  timestamp: '2026-01-01T00:00:00.000Z',
  eventId: 'e1',
  eventType: 'OPERATING_MODE_CHANGED',
  serviceName: 'investor-bff',
});

describe('operatingModeChanged transform', () => {
  it.each([
    ['CONSERVATIVE' as const],
    ['BALANCED' as const],
    ['AGGRESSIVE' as const],
  ])('should return update intent with guardrail params for %s mode', (mode) => {
    const payload = makePayload(mode);
    const ctx = makeCtx();
    const params = resolveGuardrailParams(mode);

    const result = operatingModeChanged(payload, ctx);

    expect(result).toEqual(
      update('Mandate', {
        ...params,
        operatingMode: mode,
      }, {
        overrides: {
          pk: 'InvestorProfile#t1#u1',
          sk: 'Mandate',
        },
      }),
    );
  });

  it('should use pk InvestorProfile#<tenantId>#<userId>', () => {
    const payload = { subject: { tenantId: 'tenant-abc', userId: 'user-xyz', mode: 'BALANCED' as const } };
    const ctx = makeCtx();

    const result = operatingModeChanged(payload, ctx) as ReturnType<typeof update>;

    expect(result._tag).toBe('update');
    expect(result.overrides?.pk).toBe('InvestorProfile#tenant-abc#user-xyz');
    expect(result.overrides?.sk).toBe('Mandate');
  });

  it('should include operatingMode field in the update', () => {
    const payload = makePayload('AGGRESSIVE');
    const ctx = makeCtx();

    const result = operatingModeChanged(payload, ctx) as ReturnType<typeof update>;

    expect(result.updates['operatingMode']).toBe('AGGRESSIVE');
  });
});
