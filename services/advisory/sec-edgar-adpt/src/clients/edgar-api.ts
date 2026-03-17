const BASE_URL = 'https://data.sec.gov';
const USER_AGENT = 'nestfolio/1.0 (advisory-agent; contact@nestfolio.dev)';
const FETCH_TIMEOUT_MS = 15_000;

export interface EdgarFiling {
  readonly accessionNumber: string;
  readonly form: string;
  readonly filingDate: string;
  readonly primaryDocument: string;
}

export interface EdgarSubmissions {
  readonly cik: string;
  readonly entityType: string;
  readonly name: string;
  readonly recentFilings: {
    readonly filings: EdgarFiling[];
  };
}

export async function fetchSubmissions(cik: string): Promise<EdgarSubmissions> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetch(`${BASE_URL}/submissions/CIK${cik}.json`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`EDGAR API error: ${response.status} for CIK ${cik}`);
  }

  return response.json() as Promise<EdgarSubmissions>;
}

export function filterRecentFilings(
  filings: EdgarFiling[],
  targetForms: string[],
  sinceDate: string,
): EdgarFiling[] {
  const formSet = new Set(targetForms);
  return filings.filter(
    (f) => formSet.has(f.form) && f.filingDate >= sinceDate,
  );
}

export function buildFilingUrl(accessionNumber: string, primaryDocument: string): string {
  const stripped = accessionNumber.replace(/-/g, '');
  return `${BASE_URL}/Archives/edgar/data/${stripped}/${primaryDocument}`;
}
