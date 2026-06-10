import { YahooFinanceArticleSchema } from '../../../src/domain/contracts';

describe('YahooFinanceArticleSchema', () => {
  const validRow = {
    ticker: 'VTI',
    source: 'yahoo-finance',
    articles: [
      { title: 'VTI up 1%', link: 'https://finance.yahoo.com/news/vti', pubDate: 'Mon, 10 Jun 2026 09:00:00 GMT' },
    ],
  };

  it('parses a real Yahoo Finance article row', () => {
    const result = YahooFinanceArticleSchema.parse(validRow);
    expect(result.ticker).toBe('VTI');
    expect(result.source).toBe('yahoo-finance');
    expect(result.articles).toHaveLength(1);
  });

  it('accepts all configured tickers (BND, QQQ, VTIP, SPY)', () => {
    const tickers = ['BND', 'QQQ', 'VTIP', 'SPY'];
    for (const ticker of tickers) {
      const result = YahooFinanceArticleSchema.parse({ ...validRow, ticker, articles: [] });
      expect(result.ticker).toBe(ticker);
    }
  });

  it('rejects a missing ticker field', () => {
    const { ticker: _, ...noTicker } = validRow;
    expect(() => YahooFinanceArticleSchema.parse(noTicker)).toThrow();
  });

  it('rejects a wrong source literal', () => {
    expect(() =>
      YahooFinanceArticleSchema.parse({ ...validRow, source: 'marketwatch' }),
    ).toThrow();
  });

  it('rejects articles as a non-array', () => {
    expect(() =>
      YahooFinanceArticleSchema.parse({ ...validRow, articles: 'not-an-array' }),
    ).toThrow();
  });
});
