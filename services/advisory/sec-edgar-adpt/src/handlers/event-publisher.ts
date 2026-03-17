import {
  EventBridgeBus,
  envVar,
  logger,
  publishOrUpload,
} from '@nestfolio/event-processor';
import { fetchSubmissions, filterRecentFilings, buildFilingUrl } from '../clients/edgar-api';
import { SecEdgarAdptEventTypes } from '../service-domain/events';

const TARGET_FORMS = ['8-K', '485BPOS', 'N-1A', '10-K', '10-Q'];

const FORM_TO_EVENT: Record<string, string> = {
  '8-K': SecEdgarAdptEventTypes.SEC_8K_FILED,
  '485BPOS': SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
  'N-1A': SecEdgarAdptEventTypes.SEC_PROSPECTUS_UPDATED,
  '10-K': SecEdgarAdptEventTypes.SEC_10K_UPDATED,
  '10-Q': SecEdgarAdptEventTypes.SEC_10K_UPDATED,
};

function getCutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function createHandler() {
  const busName = envVar('BUS_NAME');
  const serviceName = envVar('SERVICE_NAME');
  const bucket = envVar('KB_BUCKET');
  const ciks = envVar('TRACKED_CIKS').split(',').map((c) => c.trim());

  const bus = new EventBridgeBus(busName, serviceName);

  return async (): Promise<void> => {
    const sinceDate = getCutoffDate();
    logger.info('Starting SEC EDGAR filing scan', { ciks, sinceDate });

    for (const cik of ciks) {
      try {
        const submissions = await fetchSubmissions(cik);
        const filings = filterRecentFilings(
          submissions.recentFilings.filings,
          TARGET_FORMS,
          sinceDate,
        );

        logger.info('Found filings', { cik, name: submissions.name, count: filings.length });

        for (const filing of filings) {
          const eventType = FORM_TO_EVENT[filing.form];
          if (!eventType) continue;

          try {
            const filingUrl = buildFilingUrl(filing.accessionNumber, filing.primaryDocument);
            const response = await fetch(filingUrl, {
              headers: { 'User-Agent': 'nestfolio/1.0 (advisory-agent; contact@nestfolio.dev)' },
            });

            const content = response.ok ? await response.text() : '';

            await publishOrUpload({
              bus,
              bucket,
              eventType,
              content: {
                source: 'sec-edgar',
                cik,
                issuer: submissions.name,
                form: filing.form,
                filingDate: filing.filingDate,
                accessionNumber: filing.accessionNumber,
                body: content,
              },
              serviceName,
            });

            logger.info('Published filing event', {
              eventType,
              cik,
              form: filing.form,
              accessionNumber: filing.accessionNumber,
            });
          } catch (error) {
            logger.error('Failed to fetch/publish filing', {
              cik,
              accessionNumber: filing.accessionNumber,
              error,
            });
          }
        }
      } catch (error) {
        logger.error('Failed to process CIK', { cik, error });
      }
    }
  };
}

export const handler = createHandler();
