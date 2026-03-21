import { z } from 'zod';
import { defineCommand } from '@nestfolio/event-processor/sourcing';
import { type AccountState } from './account-state';

export const RecordFillSchema = z.object({
  orderId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  quantity: z.number().positive(),
  fillPrice: z.number().positive(),
  filledAt: z.string().min(1),
});

export type RecordFillPayload = z.infer<typeof RecordFillSchema>;

export const RecordFill = defineCommand<RecordFillPayload, AccountState>({
  type: 'RecordFill',
  schema: RecordFillSchema,
  apply: (state, payload) => {
    const existing = state.positions[payload.symbol] ?? {
      symbol: payload.symbol,
      quantity: 0,
      averageCostBasis: 0,
      totalCostBasis: 0,
      lastFillPrice: 0,
    };

    if (payload.side === 'BUY') {
      const newQty = existing.quantity + payload.quantity;
      const newCost = existing.totalCostBasis + payload.quantity * payload.fillPrice;
      return {
        ...state,
        positions: {
          ...state.positions,
          [payload.symbol]: {
            ...existing,
            quantity: newQty,
            totalCostBasis: newCost,
            averageCostBasis: newCost / newQty,
            lastFillPrice: payload.fillPrice,
          },
        },
        cashBalanceCents:
          state.cashBalanceCents - Math.round(payload.quantity * payload.fillPrice * 100),
      };
    } else {
      if (payload.quantity > existing.quantity) {
        throw new Error(
          `Cannot sell ${payload.quantity} of ${payload.symbol}: only ${existing.quantity} held`,
        );
      }
      const newQty = existing.quantity - payload.quantity;
      return {
        ...state,
        positions: {
          ...state.positions,
          [payload.symbol]: {
            ...existing,
            quantity: newQty,
            totalCostBasis: newQty > 0 ? existing.averageCostBasis * newQty : 0,
            averageCostBasis: newQty > 0 ? existing.averageCostBasis : 0,
            lastFillPrice: payload.fillPrice,
          },
        },
        cashBalanceCents:
          state.cashBalanceCents + Math.round(payload.quantity * payload.fillPrice * 100),
      };
    }
  },
});
