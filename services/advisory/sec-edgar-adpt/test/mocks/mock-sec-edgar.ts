import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
}

function text(statusCode: number, body: string): APIGatewayProxyResultV2 {
  return { statusCode, body, headers: { 'Content-Type': 'text/html' } };
}

const today = new Date().toISOString().split('T')[0];

const MOCK_SUBMISSIONS: Record<string, unknown> = {
  '0000102909': {
    cik: '0000102909',
    entityType: 'filer',
    name: 'Vanguard Group Inc',
    recentFilings: {
      filings: [
        { accessionNumber: '0000102909-26-000001', form: '8-K', filingDate: today, primaryDocument: 'filing.htm' },
      ],
    },
  },
  '0000088053': {
    cik: '0000088053',
    entityType: 'filer',
    name: 'Fidelity Management & Research',
    recentFilings: {
      filings: [
        { accessionNumber: '0000088053-26-000001', form: '485BPOS', filingDate: today, primaryDocument: 'prospectus.htm' },
      ],
    },
  },
  '0000914208': {
    cik: '0000914208',
    entityType: 'filer',
    name: 'iShares Trust',
    recentFilings: {
      filings: [
        { accessionNumber: '0000914208-26-000001', form: '10-K', filingDate: today, primaryDocument: 'annual.htm' },
      ],
    },
  },
};

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;

  // Submissions endpoint: /submissions/CIK{cik}.json
  const submissionMatch = path.match(/\/submissions\/CIK(\d+)\.json/);
  if (submissionMatch) {
    const cik = submissionMatch[1];
    const data = MOCK_SUBMISSIONS[cik];
    if (!data) return json(404, { error: `CIK ${cik} not found` });
    return json(200, data);
  }

  // Filing content: /Archives/edgar/data/{accessionStripped}/{doc}
  if (path.includes('/Archives/edgar/data/')) {
    return text(200, `<html><body><h1>Mock SEC Filing Document</h1><p>Integration test filing content for ${path}</p></body></html>`);
  }

  return json(404, { error: `Unknown path: ${path}` });
}
