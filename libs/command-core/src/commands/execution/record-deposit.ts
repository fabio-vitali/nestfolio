import { z } from 'zod';
import { defineCommand } from '../../command';
import { type PortfolioState } from '../../state/account-state';

export const RecordDepositSchema = z.object({
  depositId: z.string().min(1),
  amountCents: z.number().int().positive(),
  depositedAt: z.string().min(1),
});

export type RecordDepositPayload = z.infer<typeof RecordDepositSchema>;

export const RecordDeposit = defineCommand<RecordDepositPayload, PortfolioState>({
  type: 'RecordDeposit',
  schema: RecordDepositSchema,
  apply: (state, payload) => ({
    ...state,
    cashBalanceCents: state.cashBalanceCents + payload.amountCents,
  }),
});
