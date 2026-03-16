import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'reconciliation-ctrl',
  eventTypeMap: buildEventTypeMap(
    ['ReconciliationResult', 'DriftRecord'],
    {
      'ReconciliationResult:INSERT': 'RECONCILIATION_COMPLETED',
      'DriftRecord:INSERT': 'PORTFOLIO_DRIFT_DETECTED',
    },
  ),
});
