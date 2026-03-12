import { z } from 'zod';
import { defineCommand } from '../../command';
import { type PortfolioState } from '../../state/account-state';

export const RecordWithdrawalSchema = z.object({
  withdrawalId: z.string().min(1),
  amountCents: z.number().int().positive(),
  withdrawnAt: z.string().min(1),
});

export type RecordWithdrawalPayload = z.infer<typeof RecordWithdrawalSchema>;

export const RecordWithdrawal = defineCommand<RecordWithdrawalPayload, PortfolioState>({
  type: 'RecordWithdrawal',
  schema: RecordWithdrawalSchema,
  apply: (state, payload) => {
    if (payload.amountCents > state.cashBalanceCents) {
      throw new Error(
        `Insufficient cash: requested ${payload.amountCents} cents but only ${state.cashBalanceCents} available`,
      );
    }
    return {
      ...state,
      cashBalanceCents: state.cashBalanceCents - payload.amountCents,
    };
  },
});
