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

// Execution domain commands
export {
  RecordFill,
  RecordFillSchema,
  type RecordFillPayload,
} from './commands/execution/record-fill';

export {
  SubmitOrder,
  SubmitOrderSchema,
  type SubmitOrderPayload,
} from './commands/execution/submit-order';

export {
  CancelOrder,
  CancelOrderSchema,
  type CancelOrderPayload,
} from './commands/execution/cancel-order';

export {
  RecordDeposit,
  RecordDepositSchema,
  type RecordDepositPayload,
} from './commands/execution/record-deposit';

export {
  RecordWithdrawal,
  RecordWithdrawalSchema,
  type RecordWithdrawalPayload,
} from './commands/execution/record-withdrawal';
