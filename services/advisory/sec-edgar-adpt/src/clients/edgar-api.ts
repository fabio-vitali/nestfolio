// SEC EDGAR requires a User-Agent header identifying the application and a contact email.
// Without it the API returns 403 Forbidden. See: https://www.sec.gov/os/accessing-edgar-data
export const EDGAR_USER_AGENT = 'Nestfolio sec-edgar-adpt admin@nestfolio.dev';
const FETCH_TIMEOUT_MS = 15_000;

export interface EdgarFiling {
  readonly accessionNumber: string;
  readonly form: string;
  readonly filingDate: string;
  readonly primaryDocument: string;
}

// The real SEC EDGAR submissions API returns filings as parallel arrays under
// `filings.recent`, NOT as an array of objects under `recentFilings.filings`.
// Shape: https://data.sec.gov/submissions/CIK##########.json
interface EdgarFilingsRecent {
  readonly accessionNumber: string[];
  readonly form: string[];
  readonly filingDate: string[];
  readonly primaryDocument: string[];
}

interface EdgarSubmissions {
  readonly cik: string;
  readonly entityType: string;
  readonly name: string;
  readonly filings: {
    readonly recent: EdgarFilingsRecent;
  };
}

/**
 * Convert the SEC EDGAR parallel-array `filings.recent` into EdgarFiling objects.
 * Returns an empty array if the structure is missing (defensive guard).
 */
export function normalizeRecentFilings(submissions: EdgarSubmissions): EdgarFiling[] {
  const recent = submissions?.filings?.recent;
  if (!recent?.accessionNumber?.length) return [];

  return recent.accessionNumber.map((accessionNumber, i) => ({
    accessionNumber,
    form: recent.form[i] ?? '',
    filingDate: recent.filingDate[i] ?? '',
    primaryDocument: recent.primaryDocument[i] ?? '',
  }));
}

export async function fetchSubmissions(baseUrl: string, cik: string): Promise<EdgarSubmissions> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetch(`${baseUrl}/submissions/CIK${cik}.json`, {
    headers: { 'User-Agent': EDGAR_USER_AGENT },
    signal: controller.signal,
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`EDGAR API error: ${response.status} for CIK ${cik}`);
  }

  const body = await response.json() as unknown;

  // Defensive guard: if the response body is not the expected shape, surface a
  // clear error rather than allowing `undefined.filings` to throw later.
  if (
    typeof body !== 'object' ||
    body === null ||
    !('filings' in body) ||
    typeof (body as Record<string, unknown>).filings !== 'object'
  ) {
    throw new Error(`EDGAR API returned unexpected shape for CIK ${cik}`);
  }

  return body as EdgarSubmissions;
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

export function buildFilingUrl(baseUrl: string, accessionNumber: string, primaryDocument: string): string {
  const stripped = accessionNumber.replace(/-/g, '');
  return `${baseUrl}/Archives/edgar/data/${stripped}/${primaryDocument}`;
}
