import { z } from 'zod';

/**
 * MarketWatchArticle subject — the `MarketWatchArticle` row (pk='MarketWatch#SYSTEM',
 * sk=`Feed#${feedPath}`), CDC-emitted as MARKETWATCH_UPDATED. Global — no tenant/region.
 * project() injects pk/sk/__typename, so the subject is fields-only.
 * RSS items are opaque at the producer level (parsed by event-processor parseRssFeed).
 */
export const MarketWatchArticleSchema = z.object({
  feed: z.string(),
  source: z.literal('marketwatch'),
  articles: z.array(z.unknown()),
});

export type MarketWatchArticle = z.infer<typeof MarketWatchArticleSchema>;
