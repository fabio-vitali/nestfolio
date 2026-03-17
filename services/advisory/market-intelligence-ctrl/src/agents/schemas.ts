import { z } from 'zod';

export const MarketAnalysisOutputSchema = z.object({
  signals: z.array(z.object({
    type: z.string(),
    ticker: z.string(),
    sentiment: z.enum(['BULLISH', 'BEARISH', 'NEUTRAL']),
    confidence: z.number().min(0).max(1),
    source: z.string(),
  })),
  tickersMentioned: z.array(z.string()),
  marketOutlook: z.string(),
  confidenceScore: z.number().min(0).max(1),
});
