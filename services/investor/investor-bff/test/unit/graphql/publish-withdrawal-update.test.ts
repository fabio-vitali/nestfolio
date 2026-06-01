import { request, response } from '../../../src/graphql/js-function/publish-withdrawal-update.fn.js';

describe('publish-withdrawal-update resolver', () => {
  it('request returns an empty NONE-datasource payload', () => {
    expect(request({})).toEqual({ payload: {} });
  });

  it('response echoes arguments INCLUDING withdrawalId (the @aws_subscribe filter pivot)', () => {
    const args = {
      withdrawalId: 'wd-1',
      status: 'SETTLED',
      amountCents: 200000,
      currency: 'USD',
      settledAt: '2026-06-01T13:00:00Z',
      failedAt: null,
      reason: null,
    };
    const out = response({ arguments: args });
    expect(out.withdrawalId).toBe('wd-1');
    expect(out).toMatchObject(args);
  });
});
