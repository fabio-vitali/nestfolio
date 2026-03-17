const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import {
  fetchSubmissions,
  filterRecentFilings,
  type EdgarFiling,
} from '../src/clients/edgar-api';

const SAMPLE_SUBMISSIONS = {
  cik: '0000102909',
  entityType: 'ETF',
  name: 'Vanguard Index Funds',
  recentFilings: {
    filings: [
      { accessionNumber: '0001-23-456', form: '8-K', filingDate: '2026-03-17', primaryDocument: 'doc.htm' },
      { accessionNumber: '0001-23-457', form: '485BPOS', filingDate: '2026-03-16', primaryDocument: 'prospectus.htm' },
      { accessionNumber: '0001-23-458', form: '10-K', filingDate: '2026-03-15', primaryDocument: 'annual.htm' },
      { accessionNumber: '0001-23-459', form: 'N-CSR', filingDate: '2026-03-10', primaryDocument: 'report.htm' },
    ],
  },
};

describe('edgar-api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SAMPLE_SUBMISSIONS),
    });
  });

  describe('fetchSubmissions', () => {
    it('fetches submissions for a CIK with User-Agent header', async () => {
      const result = await fetchSubmissions('0000102909');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://data.sec.gov/submissions/CIK0000102909.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringContaining('nestfolio'),
          }),
        }),
      );
      expect(result.cik).toBe('0000102909');
    });
  });

  describe('filterRecentFilings', () => {
    it('returns only filings matching target forms since cutoff date', () => {
      const filings = filterRecentFilings(
        SAMPLE_SUBMISSIONS.recentFilings.filings as EdgarFiling[],
        ['8-K', '485BPOS', '10-K'],
        '2026-03-15',
      );
      expect(filings).toHaveLength(3);
      expect(filings.map((f) => f.form)).toEqual(['8-K', '485BPOS', '10-K']);
    });

    it('excludes filings before cutoff date', () => {
      const filings = filterRecentFilings(
        SAMPLE_SUBMISSIONS.recentFilings.filings as EdgarFiling[],
        ['8-K', '485BPOS', '10-K', 'N-CSR'],
        '2026-03-16',
      );
      expect(filings).toHaveLength(2);
    });

    it('excludes forms not in target list', () => {
      const filings = filterRecentFilings(
        SAMPLE_SUBMISSIONS.recentFilings.filings as EdgarFiling[],
        ['8-K'],
        '2026-03-01',
      );
      expect(filings).toHaveLength(1);
      expect(filings[0].form).toBe('8-K');
    });
  });
});
