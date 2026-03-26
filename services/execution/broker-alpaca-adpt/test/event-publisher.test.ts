import { createCdcTestHarness, fakeDdbStreamRecord, StreamRecord } from '@nestfolio/event-processor';
import { AlpacaAdptEventTypes } from '../src/domain/events';

const eventTypeMap = {
  'AlpacaOrderResult:INSERT': (record: StreamRecord) => {
    const status = record.status as string;
    switch (status) {
      case 'PLACED': return AlpacaAdptEventTypes.ALPACA_ORDER_PLACED;
      case 'FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_FILLED;
      case 'PARTIALLY_FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_PARTIALLY_FILLED;
      case 'REJECTED': return AlpacaAdptEventTypes.ALPACA_ORDER_REJECTED;
      case 'CANCELLED': return AlpacaAdptEventTypes.ALPACA_ORDER_CANCELLED;
      case 'CANCEL_FAILED': return AlpacaAdptEventTypes.ALPACA_ORDER_CANCEL_FAILED;
      default: return `ALPACA_ORDER_${status}`;
    }
  },
  'AlpacaOrderResult:MODIFY': (record: StreamRecord) => {
    const status = record.status as string;
    switch (status) {
      case 'FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_FILLED;
      case 'PARTIALLY_FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_PARTIALLY_FILLED;
      case 'REJECTED': return AlpacaAdptEventTypes.ALPACA_ORDER_REJECTED;
      case 'CANCELLED': return AlpacaAdptEventTypes.ALPACA_ORDER_CANCELLED;
      default: return `ALPACA_ORDER_${status}`;
    }
  },
  'AlpacaTransferResult:INSERT': (record: StreamRecord) => {
    const status = record.status as string;
    switch (status) {
      case 'INITIATED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_INITIATED;
      case 'COMPLETED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_COMPLETED;
      case 'FAILED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_FAILED;
      default: return `ALPACA_TRANSFER_${status}`;
    }
  },
  'AlpacaTransferResult:MODIFY': (record: StreamRecord) => {
    const status = record.status as string;
    switch (status) {
      case 'COMPLETED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_COMPLETED;
      case 'FAILED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_FAILED;
      default: return `ALPACA_TRANSFER_${status}`;
    }
  },
  'AlpacaAccountSnapshot:INSERT': AlpacaAdptEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
};

describe('broker-alpaca-adpt event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'broker-alpaca-adpt', eventTypeMap });

  describe('AlpacaOrderResult INSERT', () => {
    it('publishes ALPACA_ORDER_PLACED for status=PLACED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'PLACED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_PLACED');
    });

    it('publishes ALPACA_ORDER_FILLED for status=FILLED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'FILLED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_FILLED');
    });

    it('publishes ALPACA_ORDER_PARTIALLY_FILLED for status=PARTIALLY_FILLED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'PARTIALLY_FILLED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_PARTIALLY_FILLED');
    });

    it('publishes ALPACA_ORDER_REJECTED for status=REJECTED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'REJECTED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_REJECTED');
    });

    it('publishes ALPACA_ORDER_CANCELLED for status=CANCELLED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'CANCELLED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_CANCELLED');
    });

    it('publishes ALPACA_ORDER_CANCEL_FAILED for status=CANCEL_FAILED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'CANCEL_FAILED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_CANCEL_FAILED');
    });
  });

  describe('AlpacaOrderResult MODIFY', () => {
    it('publishes ALPACA_ORDER_FILLED for MODIFY status=FILLED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('MODIFY', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'FILLED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_FILLED');
    });

    it('publishes ALPACA_ORDER_CANCELLED for MODIFY status=CANCELLED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('MODIFY', { __typename: 'AlpacaOrderResult', tenantId: 't1', status: 'CANCELLED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ORDER_CANCELLED');
    });
  });

  describe('AlpacaTransferResult INSERT', () => {
    it('publishes ALPACA_TRANSFER_INITIATED for status=INITIATED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaTransferResult', tenantId: 't1', status: 'INITIATED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_TRANSFER_INITIATED');
    });

    it('publishes ALPACA_TRANSFER_COMPLETED for status=COMPLETED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaTransferResult', tenantId: 't1', status: 'COMPLETED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_TRANSFER_COMPLETED');
    });

    it('publishes ALPACA_TRANSFER_FAILED for status=FAILED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', { __typename: 'AlpacaTransferResult', tenantId: 't1', status: 'FAILED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_TRANSFER_FAILED');
    });
  });

  describe('AlpacaTransferResult MODIFY', () => {
    it('publishes ALPACA_TRANSFER_COMPLETED for MODIFY status=COMPLETED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('MODIFY', { __typename: 'AlpacaTransferResult', tenantId: 't1', status: 'COMPLETED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_TRANSFER_COMPLETED');
    });

    it('publishes ALPACA_TRANSFER_FAILED for MODIFY status=FAILED', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('MODIFY', { __typename: 'AlpacaTransferResult', tenantId: 't1', status: 'FAILED' }),
      ]);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_TRANSFER_FAILED');
    });
  });

  describe('AlpacaAccountSnapshot INSERT', () => {
    it('publishes ALPACA_ACCOUNT_SNAPSHOT', async () => {
      const result = await harness.process([
        fakeDdbStreamRecord('INSERT', {
          __typename: 'AlpacaAccountSnapshot',
          tenantId: 't1',
          equity: '125000.00',
          buyingPower: '50000.00',
        }),
      ]);
      expect(result.publishedEvents).toHaveLength(1);
      expect(result.publishedEvents[0].eventType).toBe('ALPACA_ACCOUNT_SNAPSHOT');
    });
  });
});
