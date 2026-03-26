import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'broker-sim-adpt',
  eventTypeMap: buildEventTypeMap(
    ['VirtualTrade', 'VirtualCashBalance', 'VirtualPosition', 'DepositDetected', 'WithdrawalCompleted'],
    {
      'DepositDetected:INSERT': 'DEPOSIT_DETECTED',
      'WithdrawalCompleted:INSERT': 'WITHDRAWAL_COMPLETED',
    },
  ),
});
