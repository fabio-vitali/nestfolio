import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

/**
 * AlphaVantageArticle subject — the `AlphaVantageArticle` row
 * (pk='AlphaVantage#SYSTEM', sk=`Article#${ticker}#${dateStr}#${i}`),
 * CDC-emitted as ALPHA_VANTAGE_NEWS_UPDATED. Global — no tenant/region.
 * project() injects pk/sk/__typename, so the subject is fields-only.
 *
 * The article comes raw from the Alpha Vantage NEWS_SENTIMENT feed.
 * Known fields are typed; the feed can include additional keys — passthrough preserves them.
 */
export const AlphaVantageArticleSchema = z
  .object({
    title: z.string(),
    url: z.string(),
    time_published: z.string(),
    summary: z.string(),
    overall_sentiment_score: z.number().optional(),
  })
  .passthrough();

export type AlphaVantageArticle = z.infer<typeof AlphaVantageArticleSchema>;

/**
 * EconomicIndicator subject — the `EconomicIndicator` row
 * (pk='AlphaVantage#SYSTEM', sk=`Indicator#${fn}`),
 * CDC-emitted as ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED. Global — no tenant/region.
 * NOTE: typename `EconomicIndicator` is distinct from fred's `FredIndicator`.
 */
export const EconomicIndicatorSchema = z.object({
  function: z.string(),
  data: z.unknown(),
});

export type EconomicIndicator = z.infer<typeof EconomicIndicatorSchema>;

/** Inbound fetch trigger — empty subject (fetch-trigger.ts emits subject:{}). */
export const FetchRequestedSchema = z.object({});

export const alphaVantageAdptEventSubjects = {
  ALPHA_VANTAGE_ECONOMIC_INDICATOR_UPDATED: EconomicIndicatorSchema,
  ALPHA_VANTAGE_NEWS_UPDATED: AlphaVantageArticleSchema,
  FETCH_ALPHA_VANTAGE_REQUESTED: FetchRequestedSchema,
} as const satisfies Record<string, ZodTypeAny>;
