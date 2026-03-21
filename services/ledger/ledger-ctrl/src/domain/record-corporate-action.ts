import { z } from 'zod';
import { defineCommand } from '@nestfolio/event-processor/sourcing';
import { type AccountState } from './account-state';

export const RecordCorporateActionSchema = z.object({
  actionId: z.string().min(1),
  symbol: z.string().min(1),
  actionType: z.enum(['STOCK_SPLIT', 'REVERSE_SPLIT', 'DIVIDEND']),
  quantityMultiplier: z.number().positive().optional(),
  costBasisDivisor: z.number().positive().optional(),
  dividendPerShareCents: z.number().int().nonnegative().optional(),
  appliedAt: z.string().min(1),
});

export type RecordCorporateActionPayload = z.infer<typeof RecordCorporateActionSchema>;

export const RecordCorporateAction = defineCommand<RecordCorporateActionPayload, AccountState>({
  type: 'RecordCorporateAction',
  schema: RecordCorporateActionSchema,
  apply: (state, payload) => {
    const position = state.positions[payload.symbol];
    if (!position) throw new Error(`No position for symbol ${payload.symbol}`);

    if (payload.actionType === 'DIVIDEND') {
      const dividendCents = (payload.dividendPerShareCents ?? 0) * position.quantity;
      return {
        ...state,
        cashBalanceCents: state.cashBalanceCents + dividendCents,
      };
    }

    const multiplier = payload.quantityMultiplier ?? 1;
    const divisor = payload.costBasisDivisor ?? 1;
    const newQuantity = position.quantity * multiplier;
    const newAvgCost = position.averageCostBasis / divisor;

    return {
      ...state,
      positions: {
        ...state.positions,
        [payload.symbol]: {
          ...position,
          quantity: newQuantity,
          averageCostBasis: newAvgCost,
          lastFillPrice: position.lastFillPrice / divisor,
        },
      },
    };
  },
});
