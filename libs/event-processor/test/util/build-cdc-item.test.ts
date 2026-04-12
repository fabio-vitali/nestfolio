import { buildCdcItem } from '../../src/util/build-cdc-item';
import type { RequestContext } from '../../src/domain/schemas';
import { asTenantId, asUserId } from '../../src/platform/types/branded';

describe('buildCdcItem', () => {
  const ctx: RequestContext = {
    tenantId: asTenantId('t-1'),
    userId: asUserId('u-1'),
    region: 'us-east-1',
  };

  it('merges keys, typename, context, and fields into a flat DDB item', () => {
    const item = buildCdcItem(
      'AgentInvocation',
      { pk: 'DECISION#d1', sk: 'INV#inv1' },
      ctx,
      { invocationId: 'inv1', status: 'IN_PROGRESS' },
    );

    expect(item).toEqual({
      pk: 'DECISION#d1',
      sk: 'INV#inv1',
      __typename: 'AgentInvocation',
      tenantId: 't-1',
      userId: 'u-1',
      region: 'us-east-1',
      invocationId: 'inv1',
      status: 'IN_PROGRESS',
    });
  });

  it('allows fields to override context values (e.g. tenantId from subject)', () => {
    const item = buildCdcItem(
      'Record',
      { pk: 'X', sk: 'Y' },
      ctx,
      { tenantId: 'override-tenant' },
    );
    expect(item.tenantId).toBe('override-tenant');
  });
});
