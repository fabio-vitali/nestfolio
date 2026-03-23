import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';
import { SecEdgarAdptEventTypes, SecEdgarEntityTypes } from '../domain/events';
import type { StreamRecord } from '@nestfolio/event-processor';

const FORM_TO_EVENT: Record<string, string> = {
  '8-K': SecEdgarAdptEventTypes.SEC_8K_FILED,
  '485BPOS': SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
  'N-1A': SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
  '10-K': SecEdgarAdptEventTypes.SEC_10K_UPDATED,
  '10-Q': SecEdgarAdptEventTypes.SEC_10K_UPDATED,
};

function resolveFilingEventType(record: StreamRecord): string {
  const formType = (record as Record<string, unknown>)['formType'] as string | undefined;
  if (formType && FORM_TO_EVENT[formType]) {
    return FORM_TO_EVENT[formType];
  }
  return SecEdgarAdptEventTypes.SEC_8K_FILED;
}

export const handler = changeDataCapture({
  serviceName: 'sec-edgar-adpt',
  eventTypeMap: buildEventTypeMap([...SecEdgarEntityTypes], {
    'SecFiling:INSERT': resolveFilingEventType,
    'SecFiling:MODIFY': resolveFilingEventType,
  }),
});
