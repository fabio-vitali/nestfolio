import {
  materializeToTable,
  project,
  requireEnv,
  logger,
  type WriteIntent,
  type EventPayload,
  type EventContext,
} from '@nestfolio/event-processor';
import { fetchSubmissions, filterRecentFilings, buildFilingUrl } from '../clients/edgar-api';
import { SecEdgarAdptEventTypes, type SecFiling } from '../domain/events';

const TARGET_FORMS = ['8-K', '485BPOS', 'N-1A', '10-K', '10-Q'];
const USER_AGENT = 'nestfolio/1.0 (advisory-agent; contact@nestfolio.dev)';

function getCutoffDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export interface EventListenerDeps {
  getBaseUrl: () => Promise<string>;
  fetchCikFilings: (cik: string, sinceDate: string) => Promise<{ issuer: string; filings: Array<{ form: string; filingDate: string; accessionNumber: string; content: string }> }>;
}

async function resolveBaseUrl(): Promise<string> {
  const port = process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT ?? '2773';
  const token = process.env.AWS_SESSION_TOKEN!;
  const paramName = process.env.EDGAR_BASE_URL_PARAM!;

  const res = await fetch(
    `http://localhost:${port}/systemsmanager/parameters/get?name=${encodeURIComponent(paramName)}`,
    { headers: { 'X-Aws-Parameters-Secrets-Token': token } },
  );
  const data = await res.json() as { Parameter: { Value: string } };
  return data.Parameter.Value;
}

export function createDeps(_ciks: string[]): EventListenerDeps {
  let cachedBaseUrl: string | undefined;

  const getBaseUrl = async () => {
    if (!cachedBaseUrl) {
      cachedBaseUrl = await resolveBaseUrl();
    }
    return cachedBaseUrl;
  };

  return {
    getBaseUrl,
    async fetchCikFilings(cik: string, sinceDate: string) {
      const baseUrl = await getBaseUrl();
      const submissions = await fetchSubmissions(baseUrl, cik);
      const filteredFilings = filterRecentFilings(
        submissions.recentFilings.filings,
        TARGET_FORMS,
        sinceDate,
      );

      const enriched: Array<{ form: string; filingDate: string; accessionNumber: string; content: string }> = [];

      for (const filing of filteredFilings) {
        try {
          const filingUrl = buildFilingUrl(baseUrl, filing.accessionNumber, filing.primaryDocument);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15_000);
          const response = await fetch(filingUrl, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const content = response.ok ? await response.text() : '';
          enriched.push({ form: filing.form, filingDate: filing.filingDate, accessionNumber: filing.accessionNumber, content });
        } catch (error) {
          logger.error('Failed to fetch filing content', { cik, accessionNumber: filing.accessionNumber, error });
        }
      }

      return { issuer: submissions.name, filings: enriched };
    },
  };
}

export const TRACKED_CIKS_ENV = 'TRACKED_CIKS';

async function handleFetchRequested(
  deps: EventListenerDeps,
  ciks: string[],
  _payload: EventPayload,
  _ctx: EventContext,
): Promise<WriteIntent[]> {
  const sinceDate = getCutoffDate();
  logger.info('Starting SEC EDGAR filing scan', { ciks, sinceDate });

  const intents: WriteIntent[] = [];

  for (const cik of ciks) {
    try {
      const { issuer, filings } = await deps.fetchCikFilings(cik, sinceDate);
      logger.info('Found filings', { cik, issuer, count: filings.length });

      for (const filing of filings) {
        const filingData: Omit<SecFiling, '__typename' | 'pk' | 'sk'> = {
          cik,
          issuer,
          formType: filing.form,
          filingDate: filing.filingDate,
          accessionNumber: filing.accessionNumber,
          body: filing.content,
          source: 'sec-edgar',
          fetchedAt: new Date().toISOString(),
        };

        intents.push(
          project('SecFiling', filingData, {
            pk: `SecFiling#${cik}`,
            sk: `Filing#${filing.accessionNumber}`,
          }),
        );
      }
    } catch (error) {
      logger.error('Failed to process CIK', { cik, error });
    }
  }

  logger.info('SEC EDGAR scan complete', { fetched: intents.length });
  return intents;
}

export function createHandlers(deps: EventListenerDeps, ciks: string[]) {
  return {
    [SecEdgarAdptEventTypes.FETCH_REQUESTED]: (payload: EventPayload, ctx: EventContext) =>
      handleFetchRequested(deps, ciks, payload, ctx),
  };
}

// Production wiring
const ciks = requireEnv(TRACKED_CIKS_ENV).split(',').map((c) => c.trim());
const deps = createDeps(ciks);

export const handler = materializeToTable({
  serviceName: 'sec-edgar-adpt',
  handlers: createHandlers(deps, ciks),
  errorEventType: 'SEC_EDGAR_ADPT_FAILED',
});
