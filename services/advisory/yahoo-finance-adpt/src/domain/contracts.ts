import { z } from 'zod';

/**
 * YahooFinanceArticle subject — the `YahooFinanceArticle` row (pk='YahooFinance#SYSTEM',
 * sk=`Ticker#${ticker}`), CDC-emitted as YAHOO_FINANCE_UPDATED. Global — no tenant/region.
 * project() injects pk/sk/__typename, so the subject is fields-only.
 * RSS items are opaque at the producer level (parsed by event-processor parseRssFeed).
 */
export const YahooFinanceArticleSchema = z.object({
  ticker: z.string(),
  source: z.literal('yahoo-finance'),
  articles: z.array(z.unknown()),
});

export type YahooFinanceArticle = z.infer<typeof YahooFinanceArticleSchema>;
