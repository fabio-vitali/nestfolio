// Producer-owned value-object contracts for the advisory domain. Imports ONLY zod.
// ProposedTrade is advisory-produced; it nests inside the decision packet / order subjects
// (proposedTrades: ProposedTrade[]). execution-ctrl imports the TYPE cross-domain via
// @nestfolio/advisory-adpt/domain UNCHANGED — the import path is preserved by re-export.
import { z } from 'zod';

/** A proposed trade within a decision packet. */
export const ProposedTradeSchema = z.object({
  symbol: z.string(),
  assetClass: z.string(),
  side: z.enum(['BUY', 'SELL']),
  quantityOrAmountCents: z.number(),
  targetWeightPercent: z.number(),
  rationale: z.string(),
});
export type ProposedTrade = z.infer<typeof ProposedTradeSchema>;
