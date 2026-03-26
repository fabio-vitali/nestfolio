import { changeDataCapture } from '@nestfolio/event-processor';
import { AlpacaAdptEventTypes } from '../domain/events';

export const handler = changeDataCapture({
  serviceName: 'broker-alpaca-adpt',
  eventTypeMap: {
    'AlpacaOrderResult:INSERT': (record) => {
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
    'AlpacaOrderResult:MODIFY': (record) => {
      const status = record.status as string;
      switch (status) {
        case 'FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_FILLED;
        case 'PARTIALLY_FILLED': return AlpacaAdptEventTypes.ALPACA_ORDER_PARTIALLY_FILLED;
        case 'REJECTED': return AlpacaAdptEventTypes.ALPACA_ORDER_REJECTED;
        case 'CANCELLED': return AlpacaAdptEventTypes.ALPACA_ORDER_CANCELLED;
        default: return `ALPACA_ORDER_${status}`;
      }
    },
    'AlpacaTransferResult:INSERT': (record) => {
      const status = record.status as string;
      switch (status) {
        case 'INITIATED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_INITIATED;
        case 'COMPLETED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_COMPLETED;
        case 'FAILED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_FAILED;
        default: return `ALPACA_TRANSFER_${status}`;
      }
    },
    'AlpacaTransferResult:MODIFY': (record) => {
      const status = record.status as string;
      switch (status) {
        case 'COMPLETED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_COMPLETED;
        case 'FAILED': return AlpacaAdptEventTypes.ALPACA_TRANSFER_FAILED;
        default: return `ALPACA_TRANSFER_${status}`;
      }
    },
    'AlpacaAccountSnapshot:INSERT': AlpacaAdptEventTypes.ALPACA_ACCOUNT_SNAPSHOT,
  },
});
