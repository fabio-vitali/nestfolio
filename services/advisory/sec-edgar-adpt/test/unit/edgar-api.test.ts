const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

import {
  fetchSubmissions,
  filterRecentFilings,
  normalizeRecentFilings,
  buildFilingUrl,
  EDGAR_USER_AGENT,
  type EdgarFiling,
} from '../../src/clients/edgar-api';

const TEST_BASE_URL = 'https://data.sec.gov';

// Real SEC EDGAR response shape: filings as parallel arrays under `filings.recent`
const SAMPLE_SUBMISSIONS = {
  cik: '0000102909',
  entityType: 'ETF',
  name: 'Vanguard Index Funds',
  filings: {
    recent: {
      accessionNumber: ['0001-23-456', '0001-23-457', '0001-23-458', '0001-23-459'],
      form: ['8-K', '485BPOS', '10-K', 'N-CSR'],
      filingDate: ['2026-03-17', '2026-03-16', '2026-03-15', '2026-03-10'],
      primaryDocument: ['doc.htm', 'prospectus.htm', 'annual.htm', 'report.htm'],
    },
  },
};

describe('edgar-api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_SUBMISSIONS),
    } as Response);
  });

  describe('fetchSubmissions', () => {
    it('fetches submissions for a CIK with SEC-compliant User-Agent header', async () => {
      const result = await fetchSubmissions(TEST_BASE_URL, '0000102909');

      expect(mockFetch).toHaveBeenCalledWith(
        `${TEST_BASE_URL}/submissions/CIK0000102909.json`,
        expect.objectContaining({
          headers: expect.objectContaining({
            // SEC requires "App/Org Name contact-email" format
            'User-Agent': EDGAR_USER_AGENT,
          }),
        }),
      );
      expect(result.cik).toBe('0000102909');
    });

    it('returns the raw submissions object with filings.recent parallel arrays', async () => {
      const result = await fetchSubmissions(TEST_BASE_URL, '0000102909');
      expect(result.filings.recent.accessionNumber).toHaveLength(4);
      expect(result.filings.recent.form[0]).toBe('8-K');
    });

    it('throws a clear error (not TypeError) when the API response is non-ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
      } as Response);

      await expect(fetchSubmissions(TEST_BASE_URL, '0000102909')).rejects.toThrow(
        'EDGAR API error: 403 for CIK 0000102909',
      );
    });

    it('throws a clear shape-error (not undefined.filings TypeError) when body lacks filings property', async () => {
      // Simulates a 200 with an HTML/error body that cannot be parsed as the expected shape
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'maintenance' }),
      } as Response);

      await expect(fetchSubmissions(TEST_BASE_URL, '0000102909')).rejects.toThrow(
        /unexpected shape for CIK 0000102909/,
      );
    });

    it('throws a clear shape-error when the body is null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      } as Response);

      await expect(fetchSubmissions(TEST_BASE_URL, '0000102909')).rejects.toThrow(
        /unexpected shape/,
      );
    });
  });

  describe('normalizeRecentFilings', () => {
    it('converts parallel arrays into EdgarFiling objects', () => {
      const filings = normalizeRecentFilings(SAMPLE_SUBMISSIONS);
      expect(filings).toHaveLength(4);
      expect(filings[0]).toEqual({
        accessionNumber: '0001-23-456',
        form: '8-K',
        filingDate: '2026-03-17',
        primaryDocument: 'doc.htm',
      });
    });

    it('returns empty array when filings.recent.accessionNumber is empty', () => {
      const empty = {
        ...SAMPLE_SUBMISSIONS,
        filings: { recent: { accessionNumber: [], form: [], filingDate: [], primaryDocument: [] } },
      };
      expect(normalizeRecentFilings(empty)).toEqual([]);
    });
  });

  describe('buildFilingUrl', () => {
    it('constructs filing URL from base URL, accession number, and document', () => {
      const url = buildFilingUrl(TEST_BASE_URL, '0001-23-456', 'doc.htm');
      expect(url).toBe(`${TEST_BASE_URL}/Archives/edgar/data/000123456/doc.htm`);
    });
  });

  describe('filterRecentFilings', () => {
    const filings: EdgarFiling[] = [
      { accessionNumber: '0001-23-456', form: '8-K', filingDate: '2026-03-17', primaryDocument: 'doc.htm' },
      { accessionNumber: '0001-23-457', form: '485BPOS', filingDate: '2026-03-16', primaryDocument: 'prospectus.htm' },
      { accessionNumber: '0001-23-458', form: '10-K', filingDate: '2026-03-15', primaryDocument: 'annual.htm' },
      { accessionNumber: '0001-23-459', form: 'N-CSR', filingDate: '2026-03-10', primaryDocument: 'report.htm' },
    ];

    it('returns only filings matching target forms since cutoff date', () => {
      const result = filterRecentFilings(filings, ['8-K', '485BPOS', '10-K'], '2026-03-15');
      expect(result).toHaveLength(3);
      expect(result.map((f) => f.form)).toEqual(['8-K', '485BPOS', '10-K']);
    });

    it('excludes filings before cutoff date', () => {
      const result = filterRecentFilings(filings, ['8-K', '485BPOS', '10-K', 'N-CSR'], '2026-03-16');
      expect(result).toHaveLength(2);
    });

    it('excludes forms not in target list', () => {
      const result = filterRecentFilings(filings, ['8-K'], '2026-03-01');
      expect(result).toHaveLength(1);
      expect(result[0].form).toBe('8-K');
    });
  });
});
