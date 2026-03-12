import {
  type EventReducer,
  type AccountState,
  applyCommand,
  RecordFill,
} from '@nestfolio/command-core';

interface FillPayload {
  readonly orderId: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly quantity: number;
  readonly fillPrice: number;
  readonly filledAt: string;
}

interface DepositPayload {
  readonly amountCents: number;
}

interface WithdrawalPayload {
  readonly amountCents: number;
}

export const accountReducer: EventReducer<AccountState> = (state, entry) => {
  switch (entry.eventType) {
    case 'ORDER_FILLED':
    case 'ORDER_PARTIALLY_FILLED': {
      const fill = entry.payload as FillPayload;
      const result = applyCommand(RecordFill, fill, state);
      return result.ok ? result.value.nextState : state;
    }
    case 'DEPOSIT_DETECTED': {
      const deposit = entry.payload as DepositPayload;
      return {
        ...state,
        cashBalanceCents: state.cashBalanceCents + deposit.amountCents,
        lastEventSequence: entry.sequenceNo,
      };
    }
    case 'WITHDRAWAL_COMPLETED': {
      const withdrawal = entry.payload as WithdrawalPayload;
      return {
        ...state,
        cashBalanceCents: state.cashBalanceCents - withdrawal.amountCents,
        lastEventSequence: entry.sequenceNo,
      };
    }
    default:
      return state;
  }
};
