import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'investor-bff',
  eventTypeMap: buildEventTypeMap(
    ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal', 'ExecutionModeChange'],
    {
      'Deposit:INSERT': 'DEPOSIT_INITIATED',
      'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED',
      'ExecutionModeChange:INSERT': 'EXECUTION_MODE_CHANGED',
    },
  ),
});
