import { z } from 'zod';
import { defineCommand } from '@nestfolio/command-core';
import { type AccountState } from './account-state';

export const RecordWithdrawalSchema = z.object({
  withdrawalId: z.string().min(1),
  amountCents: z.number().int().positive(),
  withdrawnAt: z.string().min(1),
});

export type RecordWithdrawalPayload = z.infer<typeof RecordWithdrawalSchema>;

export const RecordWithdrawal = defineCommand<RecordWithdrawalPayload, AccountState>({
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
