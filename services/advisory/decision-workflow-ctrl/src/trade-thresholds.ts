/**
 * Thresholds used by AssemblePacket to derive proposedTrades.
 *
 * MICRO_TRADE_EPSILON_BPS is the minimum absolute delta — in basis points
 * of portfolioValueCents — at which a rebalance trade is emitted. Trades
 * below this threshold are dropped to avoid generating broker activity
 * for changes that round to a few dollars. 100 bps = 1%.
 */
export const MICRO_TRADE_EPSILON_BPS = 100 as const;
