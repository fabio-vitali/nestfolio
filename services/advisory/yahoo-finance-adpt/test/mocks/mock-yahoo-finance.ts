import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function xml(statusCode: number, body: string): APIGatewayProxyResultV2 {
  return { statusCode, body, headers: { 'Content-Type': 'application/xml' } };
}

function rssResponse(ticker: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Yahoo Finance ${ticker} Headlines</title>
    <link>https://finance.yahoo.com</link>
    <description>Mock headlines for ${ticker}</description>
    <item>
      <title>${ticker} rises on strong earnings</title>
      <link>https://mock.example.com/${ticker.toLowerCase()}-1</link>
      <pubDate>Mon, 07 Apr 2026 12:00:00 GMT</pubDate>
      <description>Mock article about ${ticker} performance</description>
    </item>
    <item>
      <title>${ticker} analyst upgrades</title>
      <link>https://mock.example.com/${ticker.toLowerCase()}-2</link>
      <pubDate>Mon, 07 Apr 2026 11:00:00 GMT</pubDate>
      <description>Mock analyst coverage for ${ticker}</description>
    </item>
  </channel>
</rss>`;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters ?? {};
  const ticker = params['s'] ?? '';

  if (!ticker) {
    return xml(400, '<error>Missing ticker parameter</error>');
  }

  return xml(200, rssResponse(ticker));
}
