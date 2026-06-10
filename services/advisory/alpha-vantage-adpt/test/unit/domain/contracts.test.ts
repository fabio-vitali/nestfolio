import { AlphaVantageArticleSchema, EconomicIndicatorSchema } from '../../../src/domain/contracts';

describe('AlphaVantageArticleSchema', () => {
  // Fixture from test/unit/handlers/event-listener.test.ts SAMPLE_ARTICLES
  const validArticle = {
    title: 'VTI gains 2%',
    url: 'https://example.com/vti',
    time_published: '20260317T100000',
    summary: 'Total market ETF surges',
    overall_sentiment_score: 0.85,
  };

  it('parses a real unit-test article shape', () => {
    const result = AlphaVantageArticleSchema.parse(validArticle);
    expect(result.title).toBe('VTI gains 2%');
    expect(result.time_published).toBe('20260317T100000');
  });

  it('types overall_sentiment_score as a number when present', () => {
    const result = AlphaVantageArticleSchema.parse({ ...validArticle, overall_sentiment_score: 0.5 });
    // Typed (not passed-through-untyped): exact number value retained
    expect(result.overall_sentiment_score).toBe(0.5);
    expect(typeof result.overall_sentiment_score).toBe('number');
  });

  it('omits overall_sentiment_score when absent (optional)', () => {
    const { overall_sentiment_score: _, ...noScore } = validArticle;
    const result = AlphaVantageArticleSchema.parse(noScore);
    expect(result.overall_sentiment_score).toBeUndefined();
  });

  it('rejects a wrong-typed overall_sentiment_score', () => {
    expect(() =>
      AlphaVantageArticleSchema.parse({ ...validArticle, overall_sentiment_score: 'high' }),
    ).toThrow();
  });

  it('parses integration-mock article shape with ticker_sentiment', () => {
    const integArticle = {
      title: 'Mock Alpha Vantage Article 1',
      url: 'https://mock.example.com/article-1',
      time_published: '20260407T120000',
      summary: 'Integration test mock article for alpha-vantage-adpt',
      source: 'MockNews',
      ticker_sentiment: [{ ticker: 'VTI', relevance_score: '0.95', ticker_sentiment_score: '0.5' }],
    };
    const result = AlphaVantageArticleSchema.parse(integArticle);
    expect(result.title).toBe('Mock Alpha Vantage Article 1');
    // passthrough: extra fields preserved
    expect((result as any).source).toBe('MockNews');
    expect((result as any).ticker_sentiment).toHaveLength(1);
  });

  it('rejects an article missing required title', () => {
    const { title: _, ...noTitle } = validArticle;
    expect(() => AlphaVantageArticleSchema.parse(noTitle)).toThrow();
  });

  it('rejects an article missing required url', () => {
    const { url: _, ...noUrl } = validArticle;
    expect(() => AlphaVantageArticleSchema.parse(noUrl)).toThrow();
  });
});

describe('EconomicIndicatorSchema', () => {
  // Fixture from test/unit/handlers/event-listener.test.ts SAMPLE_INDICATOR
  const validIndicator = {
    function: 'REAL_GDP',
    data: {
      name: 'Real Gross Domestic Product',
      interval: 'annual',
      unit: 'billions of dollars',
      data: [{ date: '2025-01-01', value: '29000' }],
    },
  };

  it('parses a real economic indicator fields object', () => {
    const result = EconomicIndicatorSchema.parse(validIndicator);
    expect(result.function).toBe('REAL_GDP');
    expect(result.data).toBeDefined();
  });

  it('accepts all tracked economic functions', () => {
    const fns = ['REAL_GDP', 'CPI', 'TREASURY_YIELD', 'FEDERAL_FUNDS_RATE', 'UNEMPLOYMENT'];
    for (const fn of fns) {
      const result = EconomicIndicatorSchema.parse({ function: fn, data: { data: [] } });
      expect(result.function).toBe(fn);
    }
  });

  it('rejects a missing function field', () => {
    const { function: _, ...noFn } = validIndicator;
    expect(() => EconomicIndicatorSchema.parse(noFn)).toThrow();
  });
});
