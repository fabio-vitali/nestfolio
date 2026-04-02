import {
  type EventReducer,
  applyCommand,
} from '@nestfolio/event-processor/sourcing';
import { type AccountState } from './account-state';
import { RecordDeposit } from './record-deposit';
import { RecordWithdrawal } from './record-withdrawal';
import { RecordFill } from './record-fill';
import { RecordCorporateAction } from './record-corporate-action';

export const accountReducer: EventReducer<AccountState> = (state, entry) => {
  const p = entry.payload as Record<string, unknown>;

  switch (entry.eventType) {
    case 'DEPOSIT_DETECTED': {
      const result = applyCommand(RecordDeposit, {
        depositId: p['depositId'] as string,
        amountCents: p['amountCents'] as number,
        depositedAt: p['depositedAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
    case 'WITHDRAWAL_COMPLETED': {
      const result = applyCommand(RecordWithdrawal, {
        withdrawalId: p['withdrawalId'] as string,
        amountCents: p['amountCents'] as number,
        withdrawnAt: p['completedAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
    case 'ORDER_FILLED':
    case 'ORDER_PARTIALLY_FILLED': {
      const result = applyCommand(RecordFill, {
        orderId: p['orderId'] as string,
        symbol: p['symbol'] as string,
        side: p['side'] as 'BUY' | 'SELL',
        quantity: p['quantity'] as number,
        fillPrice: p['fillPrice'] as number,
        filledAt: p['filledAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
    case 'CORPORATE_ACTION_APPLIED': {
      const result = applyCommand(RecordCorporateAction, {
        actionId: p['actionId'] as string,
        symbol: p['symbol'] as string,
        actionType: p['actionType'] as 'STOCK_SPLIT' | 'REVERSE_SPLIT' | 'DIVIDEND',
        quantityMultiplier: p['quantityMultiplier'] as number | undefined,
        costBasisDivisor: p['costBasisDivisor'] as number | undefined,
        dividendPerShareCents: p['dividendPerShareCents'] as number | undefined,
        appliedAt: p['appliedAt'] as string,
      }, state);
      return result.ok ? result.value.nextState : state;
    }
    case 'ORDER_REJECTED':
    case 'ORDER_CANCELLED':
    default:
      return state;
  }
};
