import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'investor-bff',
  eventTypeMap: buildEventTypeMap(
    ['Goal', 'RiskProfile', 'Mandate', 'OperatingModeRecord', 'InvestorProfile', 'Deposit', 'Withdrawal'],
    { 'Deposit:INSERT': 'DEPOSIT_INITIATED', 'Withdrawal:INSERT': 'WITHDRAWAL_REQUESTED' },
  ),
});
