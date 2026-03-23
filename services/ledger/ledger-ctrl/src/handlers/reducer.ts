import { replayAndReduce } from '@nestfolio/event-processor';
import { type LedgerEntry } from '@nestfolio/event-processor/sourcing';
import { accountReducer, INITIAL_ACCOUNT_STATE, type AccountState } from '../domain';

/**
 * Adapts accountReducer (which expects LedgerEntry) to the replayAndReduce
 * pipeline contract (which passes Record<string, unknown> from DDB items).
 */
function adaptReducer(state: AccountState, event: Record<string, unknown>): AccountState {
  return accountReducer(state, event as unknown as LedgerEntry);
}

export const handler = replayAndReduce<AccountState>({
  serviceName: 'ledger-ctrl',
  filter: (record) => record.__typename === 'LedgerEntry',
  groupBy: {
    key: (record) => `${record.tenantId as string}#${record.streamType as string}`,
  },
  reducer: adaptReducer,
  initialState: INITIAL_ACCOUNT_STATE,
  snapshot: {
    key: (groupKey) => {
      const [tenantId, streamType] = groupKey.split('#');
      return { pk: `Account#${tenantId}#${streamType}`, sk: 'Snapshot#latest' };
    },
    daily: true,
  },
});
