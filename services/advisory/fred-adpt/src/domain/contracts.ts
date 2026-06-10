import { z } from 'zod';

/**
 * FredIndicator subject — the `FredIndicator` row (pk='Fred#SYSTEM', sk=`Indicator#${seriesId}`),
 * CDC-emitted as FRED_INDICATORS_UPDATED. Global — no tenant/region.
 * project() injects pk/sk/__typename, so the subject is fields-only.
 */
export const FredIndicatorSchema = z.object({
  seriesId: z.string(),
  label: z.string(),
  date: z.string(),
  value: z.string(),
});

export type FredIndicator = z.infer<typeof FredIndicatorSchema>;
