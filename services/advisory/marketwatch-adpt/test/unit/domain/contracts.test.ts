import { MarketWatchArticleSchema } from '../../../src/domain/contracts';

describe('MarketWatchArticleSchema', () => {
  const validRow = {
    feed: 'topstories',
    source: 'marketwatch',
    articles: [
      { title: 'Stocks rally', link: 'https://example.com/story', pubDate: 'Mon, 10 Jun 2026 12:00:00 GMT' },
    ],
  };

  it('parses a real MarketWatch article row', () => {
    const result = MarketWatchArticleSchema.parse(validRow);
    expect(result.feed).toBe('topstories');
    expect(result.source).toBe('marketwatch');
    expect(result.articles).toHaveLength(1);
  });

  it('accepts an empty articles array', () => {
    const result = MarketWatchArticleSchema.parse({ ...validRow, articles: [] });
    expect(result.articles).toHaveLength(0);
  });

  it('rejects a missing feed field', () => {
    const { feed: _, ...noFeed } = validRow;
    expect(() => MarketWatchArticleSchema.parse(noFeed)).toThrow();
  });

  it('rejects a wrong source literal', () => {
    expect(() =>
      MarketWatchArticleSchema.parse({ ...validRow, source: 'yahoo-finance' }),
    ).toThrow();
  });

  it('rejects articles as a non-array', () => {
    expect(() =>
      MarketWatchArticleSchema.parse({ ...validRow, articles: 'not-an-array' }),
    ).toThrow();
  });
});
