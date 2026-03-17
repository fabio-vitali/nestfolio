const mockPublishOrUpload = jest.fn().mockResolvedValue(undefined);
const mockFetchSubmissions = jest.fn();
const mockFilterRecentFilings = jest.fn();

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  EventBridgeBus: jest.fn().mockImplementation(() => ({ publish: jest.fn() })),
  publishOrUpload: mockPublishOrUpload,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  envVar: jest.fn().mockImplementation((name: string) => {
    const vars: Record<string, string> = {
      BUS_NAME: 'test-bus',
      SERVICE_NAME: 'sec-edgar-adpt',
      KB_BUCKET: 'test-kb-bucket',
      TRACKED_CIKS: '0000102909,0000088053',
    };
    return vars[name] ?? '';
  }),
}));

jest.mock('../src/clients/edgar-api', () => ({
  fetchSubmissions: (...args: unknown[]) => mockFetchSubmissions(...args),
  filterRecentFilings: (...args: unknown[]) => mockFilterRecentFilings(...args),
  buildFilingUrl: jest.fn().mockReturnValue('https://sec.gov/filing.htm'),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as any;

import { createHandler } from '../src/handlers/event-publisher';

describe('sec-edgar-adpt event-publisher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchSubmissions.mockResolvedValue({
      cik: '0000102909',
      name: 'Vanguard',
      recentFilings: { filings: [] },
    });
    mockFilterRecentFilings.mockReturnValue([]);
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<html>Filing content</html>'),
    });
  });

  it('fetches submissions for each tracked CIK', async () => {
    const handler = createHandler();
    await handler();

    expect(mockFetchSubmissions).toHaveBeenCalledTimes(2);
    expect(mockFetchSubmissions).toHaveBeenCalledWith('0000102909');
    expect(mockFetchSubmissions).toHaveBeenCalledWith('0000088053');
  });

  it('publishes SEC_8K_FILED for 8-K filings', async () => {
    mockFilterRecentFilings.mockReturnValue([
      { accessionNumber: '0001-23-456', form: '8-K', filingDate: '2026-03-17', primaryDocument: 'doc.htm' },
    ]);

    const handler = createHandler();
    await handler();

    const call8k = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].eventType === 'SEC_8K_FILED',
    );
    expect(call8k).toBeDefined();
    expect(call8k![0].content.source).toBe('sec-edgar');
    expect(call8k![0].content.form).toBe('8-K');
  });

  it('publishes SEC_PROSPECTUS_UPDATED for 485BPOS filings', async () => {
    mockFilterRecentFilings.mockReturnValue([
      { accessionNumber: '0001-23-457', form: '485BPOS', filingDate: '2026-03-16', primaryDocument: 'prospectus.htm' },
    ]);

    const handler = createHandler();
    await handler();

    const callProspectus = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].eventType === 'SEC_PROSPECTUS_UPDATED',
    );
    expect(callProspectus).toBeDefined();
  });

  it('publishes SEC_10K_UPDATED for 10-K filings', async () => {
    mockFilterRecentFilings.mockReturnValue([
      { accessionNumber: '0001-23-458', form: '10-K', filingDate: '2026-03-15', primaryDocument: 'annual.htm' },
    ]);

    const handler = createHandler();
    await handler();

    const call10k = mockPublishOrUpload.mock.calls.find(
      (c: any) => c[0].eventType === 'SEC_10K_UPDATED',
    );
    expect(call10k).toBeDefined();
  });

  it('continues processing remaining CIKs when one fails', async () => {
    mockFetchSubmissions
      .mockRejectedValueOnce(new Error('EDGAR API error'))
      .mockResolvedValueOnce({
        cik: '0000088053',
        name: 'BlackRock',
        recentFilings: { filings: [] },
      });

    const handler = createHandler();
    await handler();

    expect(mockFetchSubmissions).toHaveBeenCalledTimes(2);
  });
});
