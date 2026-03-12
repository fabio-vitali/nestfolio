// Command infrastructure
export {
  type CommandDef,
  type CommandError,
  type Patches,
  defineCommand,
  applyCommand,
} from './command';

// Reducer / Event replay
export { type LedgerEntry, type EventReducer, replayEvents } from './reducer';

// Account state
export {
  type PositionState,
  type AccountState,
  type PortfolioState, // deprecated alias
  INITIAL_ACCOUNT_STATE,
  INITIAL_PORTFOLIO_STATE, // deprecated alias
} from './state/account-state';

// Ledger domain commands
export {
  RecordFill,
  RecordFillSchema,
  type RecordFillPayload,
} from './commands/ledger/record-fill';

export {
  RecordDeposit,
  RecordDepositSchema,
  type RecordDepositPayload,
} from './commands/ledger/record-deposit';

export {
  RecordWithdrawal,
  RecordWithdrawalSchema,
  type RecordWithdrawalPayload,
} from './commands/ledger/record-withdrawal';

export {
  RecordCorporateAction,
  RecordCorporateActionSchema,
  type RecordCorporateActionPayload,
} from './commands/ledger/record-corporate-action';

// Order lifecycle commands
export {
  SubmitOrder,
  SubmitOrderSchema,
  type SubmitOrderPayload,
} from './commands/order/submit-order';

export {
  CancelOrder,
  CancelOrderSchema,
  type CancelOrderPayload,
} from './commands/order/cancel-order';
