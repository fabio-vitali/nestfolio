import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { createEventHandler, skip, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { requireEnv } from '@nestfolio/event-processor';
import { type BusEvent, type Pipe, type UnitOfWork } from '@nestfolio/event-processor';
import { PortfolioRepository } from '../repositories/portfolio.repository';
import { BalanceUpdatedPipe } from '../pipes/balance-updated.pipe';
import { PortfolioUpdatedPipe } from '../pipes/portfolio-updated.pipe';
import { LedgerEntryRecordedPipe } from '../pipes/ledger-entry-recorded.pipe';

export interface NamedPipe {
  name: string;
  pipe: Pipe<UnitOfWork<BusEvent<Record<string, unknown>>>>;
}

export interface EventListenerDeps {
  readonly eventPipeMap: Record<string, NamedPipe[]>;
}

function toUow(payload: EventPayload, ctx: EventContext) {
  const event = {
    id: ctx.eventId,
    type: ctx.eventType,
    timestamp: ctx.timestamp,
    subject: payload.subject,
    context: payload.context ?? { tenantId: ctx.tenantId },
  };
  return { event, payload: payload.subject as Record<string, unknown>, record: {} };
}

export const createHandlers = (deps: EventListenerDeps) => {
  const allEventTypes = Object.keys(deps.eventPipeMap);

  return Object.fromEntries(
    allEventTypes.map((type) => [
      type,
      async (payload: EventPayload, ctx: EventContext) => {
        const namedPipes = deps.eventPipeMap[type];
        if (!namedPipes || namedPipes.length === 0) return skip();

        const uow = toUow(payload, ctx);
        for (const { pipe } of namedPipes) {
          await pipe.process(uow);
        }
        return skip();
      },
    ]),
  );
};

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const dynamoClient = new DynamoDBClient({});
const repository = new PortfolioRepository(TABLE_NAME, dynamoClient);

const balanceUpdatedPipe = new BalanceUpdatedPipe(repository);
const portfolioUpdatedPipe = new PortfolioUpdatedPipe(repository);
const ledgerEntryRecordedPipe = new LedgerEntryRecordedPipe(repository);

const EVENT_PIPE_MAP: Record<string, NamedPipe[]> = {
  BALANCE_UPDATED: [
    { name: 'balanceUpdated', pipe: balanceUpdatedPipe },
  ],
  PORTFOLIO_UPDATED: [
    { name: 'portfolioUpdated', pipe: portfolioUpdatedPipe },
  ],
  LEDGER_ENTRY_RECORDED: [
    { name: 'ledgerEntryRecorded', pipe: ledgerEntryRecordedPipe },
  ],
};

const deps: EventListenerDeps = {
  eventPipeMap: EVENT_PIPE_MAP,
};

export const handler = createEventHandler({
  serviceName: 'ledger-bff',
  handlers: createHandlers(deps),
  table: TABLE_NAME,
  bus: requireEnv('BUS_NAME'),
  errorEventType: 'LEDGER_BFF_FAILED',
});
