jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
}));

import { createTestHarness, fakeSqsRecord, record } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes } from '../../src/domain/events';

const handlers = {
  [BrokerCtrlInboundEventTypes.SIM_DEPOSIT_COMPLETED]: (payload, ctx) => {
    const subject = payload.subject;
    return record('NormalizedEvent', {
      __typename: 'NormalizedEvent',
      tenantId: ctx.tenantId,
      amount: subject.amountCents,
      currency: subject.currency ?? 'USD',
      executionMode: 'simulation',
      timestamp: ctx.timestamp,
    }, {
      pk: `NormalizedEvent#${ctx.tenantId}#${subject.depositId ?? ctx.eventId}`,
      sk: 'DEPOSIT_DETECTED',
    });
  },

  [BrokerCtrlInboundEventTypes.SIM_WITHDRAWAL_COMPLETED]: (payload, ctx) => {
    const subject = payload.subject;
    return record('NormalizedEvent', {
      __typename: 'NormalizedEvent',
      tenantId: ctx.tenantId,
      amount: subject.amount,
      currency: subject.currency ?? 'USD',
      executionMode: 'simulation',
      timestamp: ctx.timestamp,
    }, {
      pk: `NormalizedEvent#${ctx.tenantId}#${subject.withdrawalId ?? ctx.eventId}`,
      sk: 'WITHDRAWAL_COMPLETED',
    });
  },

  [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_COMPLETED]: (payload, ctx) => {
    const subject = payload.subject;
    const isDeposit = subject.direction === 'INCOMING';
    return record('NormalizedEvent', {
      __typename: 'NormalizedEvent',
      tenantId: ctx.tenantId,
      amount: subject.amount,
      executionMode: 'live',
      timestamp: ctx.timestamp,
    }, {
      pk: `NormalizedEvent#${ctx.tenantId}#${subject.transferId ?? ctx.eventId}`,
      sk: isDeposit ? 'DEPOSIT_DETECTED' : 'WITHDRAWAL_COMPLETED',
    });
  },

  [BrokerCtrlInboundEventTypes.ALPACA_TRANSFER_FAILED]: (payload, ctx) => {
    const subject = payload.subject;
    return record('NormalizedEvent', {
      __typename: 'NormalizedEvent',
      tenantId: ctx.tenantId,
      amount: subject.amount,
      executionMode: 'live',
      failureReason: subject.failureReason ?? 'Transfer failed',
      timestamp: ctx.timestamp,
    }, {
      pk: `NormalizedEvent#${ctx.tenantId}#${subject.transferId ?? ctx.eventId}`,
      sk: 'TRANSFER_FAILED',
    });
  },
};

describe('deposit-withdrawal-normalizer', () => {
  const harness = createTestHarness({ serviceName: 'broker-ctrl', handlers });

  it('SIM_DEPOSIT_COMPLETED → NormalizedEvent with sk=DEPOSIT_DETECTED', async () => {
    const sqsRecord = fakeSqsRecord('SIM_DEPOSIT_COMPLETED', {
      depositId: 'dep-1',
      amountCents: 10000,
      currency: 'USD',
    }, { eventId: 'evt-1', tenantId: 't-1' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'NormalizedEvent',
      fields: expect.objectContaining({
        __typename: 'NormalizedEvent',
        tenantId: 't-1',
        amount: 10000,
        currency: 'USD',
        executionMode: 'simulation',
      }),
      overrides: expect.objectContaining({
        pk: 'NormalizedEvent#t-1#dep-1',
        sk: 'DEPOSIT_DETECTED',
      }),
    });
  });

  it('SIM_DEPOSIT_COMPLETED → falls back to eventId when depositId missing', async () => {
    const sqsRecord = fakeSqsRecord('SIM_DEPOSIT_COMPLETED', {
      amountCents: 5000,
    }, { eventId: 'evt-fallback', tenantId: 't-1' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      overrides: expect.objectContaining({
        pk: 'NormalizedEvent#t-1#evt-fallback',
        sk: 'DEPOSIT_DETECTED',
      }),
    });
  });

  it('SIM_WITHDRAWAL_COMPLETED → NormalizedEvent with sk=WITHDRAWAL_COMPLETED', async () => {
    const sqsRecord = fakeSqsRecord('SIM_WITHDRAWAL_COMPLETED', {
      withdrawalId: 'wdl-1',
      amount: 20000,
      currency: 'USD',
    }, { eventId: 'evt-2', tenantId: 't-1' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'NormalizedEvent',
      fields: expect.objectContaining({
        __typename: 'NormalizedEvent',
        tenantId: 't-1',
        amount: 20000,
        executionMode: 'simulation',
      }),
      overrides: expect.objectContaining({
        pk: 'NormalizedEvent#t-1#wdl-1',
        sk: 'WITHDRAWAL_COMPLETED',
      }),
    });
  });

  it('ALPACA_TRANSFER_COMPLETED INCOMING → sk=DEPOSIT_DETECTED', async () => {
    const sqsRecord = fakeSqsRecord('ALPACA_TRANSFER_COMPLETED', {
      transferId: 'xfr-1',
      amount: 50000,
      direction: 'INCOMING',
    }, { eventId: 'evt-3', tenantId: 't-2' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'NormalizedEvent',
      fields: expect.objectContaining({
        tenantId: 't-2',
        amount: 50000,
        executionMode: 'live',
      }),
      overrides: expect.objectContaining({
        pk: 'NormalizedEvent#t-2#xfr-1',
        sk: 'DEPOSIT_DETECTED',
      }),
    });
  });

  it('ALPACA_TRANSFER_COMPLETED OUTGOING → sk=WITHDRAWAL_COMPLETED', async () => {
    const sqsRecord = fakeSqsRecord('ALPACA_TRANSFER_COMPLETED', {
      transferId: 'xfr-2',
      amount: 30000,
      direction: 'OUTGOING',
    }, { eventId: 'evt-4', tenantId: 't-2' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      overrides: expect.objectContaining({
        pk: 'NormalizedEvent#t-2#xfr-2',
        sk: 'WITHDRAWAL_COMPLETED',
      }),
    });
  });

  it('ALPACA_TRANSFER_FAILED → NormalizedEvent with sk=TRANSFER_FAILED', async () => {
    const sqsRecord = fakeSqsRecord('ALPACA_TRANSFER_FAILED', {
      transferId: 'xfr-fail-1',
      amount: 15000,
      failureReason: 'Insufficient funds',
    }, { eventId: 'evt-5', tenantId: 't-3' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'NormalizedEvent',
      fields: expect.objectContaining({
        tenantId: 't-3',
        amount: 15000,
        executionMode: 'live',
        failureReason: 'Insufficient funds',
      }),
      overrides: expect.objectContaining({
        pk: 'NormalizedEvent#t-3#xfr-fail-1',
        sk: 'TRANSFER_FAILED',
      }),
    });
  });

  it('ALPACA_TRANSFER_FAILED → defaults failureReason when missing', async () => {
    const sqsRecord = fakeSqsRecord('ALPACA_TRANSFER_FAILED', {
      transferId: 'xfr-fail-2',
      amount: 10000,
    }, { eventId: 'evt-6', tenantId: 't-3' });

    const result = await harness.process([sqsRecord]);

    expect(result.batchItemFailures).toHaveLength(0);
    const intent = result.intents.find(i => i._tag === 'record');
    expect(intent).toMatchObject({
      fields: expect.objectContaining({
        failureReason: 'Transfer failed',
      }),
    });
  });
});
