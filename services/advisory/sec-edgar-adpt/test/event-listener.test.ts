import { fakeSqsRecord } from '@nestfolio/event-processor';

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      TRACKED_CIKS: '0000102909,0000088053',
      TABLE_NAME: 'test-table',
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'sec-edgar-adpt',
    };
    return vars[name] ?? '';
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

import { createHandlers, createDeps } from '../src/handlers/event-listener';
import { SecEdgarAdptEventTypes } from '../src/domain/events';

const SAMPLE_FILINGS = [
  { form: '8-K', filingDate: '2026-03-17', accessionNumber: '0001-23-456', content: '<html>8-K content</html>' },
  { form: '485BPOS', filingDate: '2026-03-16', accessionNumber: '0001-23-457', content: '<html>Prospectus</html>' },
  { form: '10-K', filingDate: '2026-03-15', accessionNumber: '0001-23-458', content: '<html>Annual report</html>' },
];

describe('sec-edgar-adpt event-listener', () => {
  let mockGetBaseUrl: jest.Mock;
  let mockFetchCikFilings: jest.Mock;
  let handlers: ReturnType<typeof createHandlers>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetBaseUrl = jest.fn().mockResolvedValue('https://data.sec.gov');
    mockFetchCikFilings = jest.fn().mockResolvedValue({
      issuer: 'Vanguard Index Funds',
      filings: SAMPLE_FILINGS,
    });
    const deps = { getBaseUrl: mockGetBaseUrl, fetchCikFilings: mockFetchCikFilings };
    const ciks = ['0000102909', '0000088053'];
    handlers = createHandlers(deps, ciks);
  });

  describe('FETCH_SEC_EDGAR_REQUESTED handler', () => {
    function makeContext() {
      const sqsRecord = fakeSqsRecord(SecEdgarAdptEventTypes.FETCH_REQUESTED, {});
      const payload = JSON.parse(sqsRecord.body).detail;
      const ctx = { tenantId: 'SYSTEM', eventId: payload.id };
      return { payload, ctx };
    }

    it('calls fetchCikFilings for each tracked CIK', async () => {
      const { payload, ctx } = makeContext();
      await handlers[SecEdgarAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockFetchCikFilings).toHaveBeenCalledTimes(2);
      expect(mockFetchCikFilings).toHaveBeenCalledWith(
        '0000102909',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
      expect(mockFetchCikFilings).toHaveBeenCalledWith(
        '0000088053',
        expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      );
    });

    it('returns a WriteIntent for each filing from each CIK', async () => {
      const { payload, ctx } = makeContext();
      const intents = await handlers[SecEdgarAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      // 2 CIKs × 3 filings each = 6 intents
      expect(intents).toHaveLength(6);
    });

    it('each WriteIntent has typename SecFiling', async () => {
      const { payload, ctx } = makeContext();
      const intents = await handlers[SecEdgarAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      for (const intent of intents) {
        expect((intent as Record<string, unknown>).typename).toBe('SecFiling');
      }
    });

    it('includes formType in each intent fields', async () => {
      const { payload, ctx } = makeContext();
      const intents = await handlers[SecEdgarAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      const formTypes = intents.map((i: unknown) => (i as Record<string, Record<string, unknown>>).fields.formType);
      expect(formTypes).toContain('8-K');
      expect(formTypes).toContain('485BPOS');
      expect(formTypes).toContain('10-K');
    });

    it('sets pk to SecFiling#<cik> and sk to Filing#<accessionNumber>', async () => {
      mockFetchCikFilings.mockResolvedValue({
        issuer: 'Vanguard',
        filings: [SAMPLE_FILINGS[0]],
      });
      const { payload, ctx } = makeContext();
      const intents = await handlers[SecEdgarAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      const first = intents[0] as Record<string, Record<string, unknown>>;
      expect(first.overrides.pk).toBe('SecFiling#0000102909');
      expect(first.overrides.sk).toBe('Filing#0001-23-456');
    });

    it('skips a CIK and continues when fetchCikFilings throws', async () => {
      mockFetchCikFilings
        .mockRejectedValueOnce(new Error('EDGAR API error'))
        .mockResolvedValueOnce({ issuer: 'BlackRock', filings: [SAMPLE_FILINGS[0]] });

      const { payload, ctx } = makeContext();
      const intents = await handlers[SecEdgarAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(mockFetchCikFilings).toHaveBeenCalledTimes(2);
      expect(intents).toHaveLength(1);
    });

    it('returns empty array when all CIKs return no filings', async () => {
      mockFetchCikFilings.mockResolvedValue({ issuer: 'Vanguard', filings: [] });

      const { payload, ctx } = makeContext();
      const intents = await handlers[SecEdgarAdptEventTypes.FETCH_REQUESTED](payload, ctx);

      expect(intents).toHaveLength(0);
    });
  });

  describe('createDeps', () => {
    it('returns an object with fetchCikFilings function', () => {
      const deps = createDeps(['0000102909']);
      expect(typeof deps.fetchCikFilings).toBe('function');
    });
  });
});
