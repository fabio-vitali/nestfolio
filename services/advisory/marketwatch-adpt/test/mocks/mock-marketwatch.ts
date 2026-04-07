import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

function xml(statusCode: number, body: string): APIGatewayProxyResultV2 {
  return { statusCode, body, headers: { 'Content-Type': 'application/xml' } };
}

function rssResponse(feedName: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>MarketWatch ${feedName}</title>
    <link>https://www.marketwatch.com</link>
    <description>Mock ${feedName} feed</description>
    <item>
      <title>Mock ${feedName} Article 1</title>
      <link>https://mock.example.com/${feedName}-1</link>
      <pubDate>Mon, 07 Apr 2026 12:00:00 GMT</pubDate>
      <description>Integration test mock article for ${feedName}</description>
    </item>
    <item>
      <title>Mock ${feedName} Article 2</title>
      <link>https://mock.example.com/${feedName}-2</link>
      <pubDate>Mon, 07 Apr 2026 11:00:00 GMT</pubDate>
      <description>Second mock article for ${feedName}</description>
    </item>
  </channel>
</rss>`;
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath;

  if (path.endsWith('/topstories')) {
    return xml(200, rssResponse('topstories'));
  }

  if (path.endsWith('/marketpulse')) {
    return xml(200, rssResponse('marketpulse'));
  }

  return xml(404, '<error>Unknown feed</error>');
}
