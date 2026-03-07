import { z } from 'zod';

const MarketSignalSchema = z.object({
  ticker: z.string().min(1).describe('Asset ticker symbol'),
  signal: z
    .enum(['strong-buy', 'buy', 'hold', 'sell', 'strong-sell'])
    .describe('Directional signal'),
  strength: z
    .number()
    .min(0)
    .max(1)
    .describe('Signal confidence strength (0-1)'),
  rationale: z.string().min(1).describe('Brief rationale for this signal'),
});

export const MarketResearchSchema = z.object({
  signals: z.array(MarketSignalSchema).describe('Market signals per asset'),
  marketRegime: z
    .enum(['risk-on', 'risk-off', 'transitional', 'crisis'])
    .describe('Current macro market regime assessment'),
  sectorRotation: z
    .record(z.string(), z.number().min(-1).max(1))
    .describe('Sector rotation scores (-1 underweight to +1 overweight)'),
});

export type MarketResearch = z.infer<typeof MarketResearchSchema>;
