import { parseRssFeed, type RssArticle } from '../src/lambda/rss-parser';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article-1</link>
      <pubDate>Mon, 17 Mar 2026 10:00:00 GMT</pubDate>
      <description>First article description</description>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article-2</link>
      <pubDate>Mon, 17 Mar 2026 12:00:00 GMT</pubDate>
      <description>Second article description</description>
    </item>
  </channel>
</rss>`;

describe('parseRssFeed', () => {
  it('parses RSS XML into articles array', () => {
    const articles = parseRssFeed(SAMPLE_RSS);
    expect(articles).toHaveLength(2);
    expect(articles[0]).toEqual<RssArticle>({
      title: 'Article One',
      link: 'https://example.com/article-1',
      pubDate: 'Mon, 17 Mar 2026 10:00:00 GMT',
      description: 'First article description',
    });
  });

  it('returns empty array for empty feed', () => {
    const xml = `<?xml version="1.0"?><rss><channel></channel></rss>`;
    expect(parseRssFeed(xml)).toEqual([]);
  });

  it('handles missing optional fields gracefully', () => {
    const xml = `<?xml version="1.0"?>
    <rss><channel><item><title>Only Title</title></item></channel></rss>`;
    const articles = parseRssFeed(xml);
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe('Only Title');
    expect(articles[0].link).toBe('');
    expect(articles[0].pubDate).toBe('');
    expect(articles[0].description).toBe('');
  });

  it('throws on invalid XML', () => {
    expect(() => parseRssFeed('not xml at all')).toThrow();
  });
});
