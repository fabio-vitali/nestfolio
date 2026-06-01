import { request, response } from '../../../src/graphql/js-function/publish-deposit-update.fn.js';

describe('publish-deposit-update resolver', () => {
  it('request returns an empty NONE-datasource payload', () => {
    expect(request({})).toEqual({ payload: {} });
  });

  it('response echoes arguments INCLUDING depositId (the @aws_subscribe filter pivot)', () => {
    const args = {
      depositId: 'dep-1',
      status: 'DETECTED',
      amountCents: 500000,
      currency: 'USD',
      detectedAt: '2026-06-01T12:00:00Z',
      settledAt: null,
      failedAt: null,
      reason: null,
    };
    const out = response({ arguments: args });
    // The pivot MUST be present in the response or every broadcast drops silently
    // (feedback_appsync_subscribe_filter_args).
    expect(out.depositId).toBe('dep-1');
    expect(out).toMatchObject(args);
  });
});
