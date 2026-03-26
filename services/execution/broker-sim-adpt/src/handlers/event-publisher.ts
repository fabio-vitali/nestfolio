import { changeDataCapture } from '@nestfolio/event-processor';
import { BrokerSimEventTypes } from '../domain/events';

export const handler = changeDataCapture({
  serviceName: 'broker-sim-adpt',
  eventTypeMap: {
    'VirtualTrade:INSERT': (record) =>
      record.status === 'REJECTED'
        ? BrokerSimEventTypes.SIM_ORDER_REJECTED
        : BrokerSimEventTypes.SIM_ORDER_FILLED,
    'VirtualTrade:MODIFY': (record) =>
      record.status === 'REJECTED'
        ? BrokerSimEventTypes.SIM_ORDER_REJECTED
        : BrokerSimEventTypes.SIM_ORDER_FILLED,
    'DepositDetected:INSERT': BrokerSimEventTypes.SIM_DEPOSIT_COMPLETED,
    'WithdrawalCompleted:INSERT': BrokerSimEventTypes.SIM_WITHDRAWAL_COMPLETED,
  },
});
