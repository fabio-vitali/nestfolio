import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import {
  requireEnv,
  authorizeTenant,
  validateQueryDepth,
  applyMiddleware,
  withLambdaContext,
  withTiming,
  withErrorPublishing,
  EventBridgeBus,
} from '@nestfolio/lambda-utils';
import { INITIAL_PORTFOLIO_STATE } from '@nestfolio/command-core';
import { LedgerRepository } from '../repositories/ledger.repository';
import { TimeTravelService } from '../services/time-travel.service';
import { StreamTypeSchema, TimestampSchema, OrderHistoryArgsSchema } from '../validation/schemas';

interface ResolverDeps {
  readonly repository: LedgerRepository;
  readonly timeTravelService: TimeTravelService;
}

export const createResolver = (deps: ResolverDeps) =>
  async (
    event: AppSyncResolverEvent<Record<string, unknown>>,
  ): Promise<unknown> => {
    try {
      validateQueryDepth(event.info.selectionSetGraphQL);
      const tenantId = authorizeTenant(event);
      const fieldName = event.info.fieldName;
      const args = event.arguments ?? {};

      logger.info('Resolving field', { fieldName, tenantId });

      switch (fieldName) {
        case 'getLedgerPortfolio': {
          const streamType = StreamTypeSchema.parse(args.streamType);
          const snapshot = await deps.repository.getLatestSnapshot(tenantId, streamType);
          if (!snapshot) {
            return {
              positions: [],
              cashBalanceCents: INITIAL_PORTFOLIO_STATE.cashBalanceCents,
              totalValueCents: INITIAL_PORTFOLIO_STATE.cashBalanceCents,
              positionCount: 0,
              snapshotAt: new Date().toISOString(),
              streamType: streamType.toUpperCase(),
            };
          }
          const positionSnapshots = await deps.repository.getPositionSnapshots(tenantId, streamType);
          return {
            positions: positionSnapshots,
            cashBalanceCents: snapshot['cashBalanceCents'],
            totalValueCents: snapshot['totalValueCents'],
            positionCount: snapshot['positionCount'],
            snapshotAt: snapshot['snapshotAt'],
            streamType: streamType.toUpperCase(),
          };
        }

        case 'getPortfolioAt': {
          const streamType = StreamTypeSchema.parse(args.streamType);
          const timestamp = TimestampSchema.parse(args.timestamp);

          const state = await deps.timeTravelService.getPortfolioAt(tenantId, streamType, timestamp);
          const positions = Object.entries(state.positions).map(([symbol, pos]) => ({
            symbol,
            quantity: pos.quantity,
            averageCostBasis: pos.averageCostBasis,
            totalCostBasis: pos.totalCostBasis,
            lastFillPrice: pos.lastFillPrice,
          }));
          let totalValueCents = state.cashBalanceCents;
          for (const pos of Object.values(state.positions)) {
            totalValueCents += Math.round(pos.quantity * pos.lastFillPrice * 100);
          }

          return {
            positions,
            cashBalanceCents: state.cashBalanceCents,
            totalValueCents,
            positionCount: positions.length,
            snapshotAt: timestamp,
            streamType: streamType.toUpperCase(),
          };
        }

        case 'getSimulationComparison': {
          const [actualSnapshot, simulatedSnapshot, actualPositions, simulatedPositions] =
            await Promise.all([
              deps.repository.getLatestSnapshot(tenantId, 'actual'),
              deps.repository.getLatestSnapshot(tenantId, 'simulated'),
              deps.repository.getPositionSnapshots(tenantId, 'actual'),
              deps.repository.getPositionSnapshots(tenantId, 'simulated'),
            ]);

          const initialValue = INITIAL_PORTFOLIO_STATE.cashBalanceCents;
          const actualTotal = (actualSnapshot?.['totalValueCents'] as number) ?? initialValue;
          const simulatedTotal = (simulatedSnapshot?.['totalValueCents'] as number) ?? initialValue;
          const actualReturn = ((actualTotal - initialValue) / initialValue) * 100;
          const simulatedReturn = ((simulatedTotal - initialValue) / initialValue) * 100;

          // Build position-level divergence
          const allSymbols = new Set<string>();
          const actualBySymbol = new Map<string, Record<string, unknown>>();
          const simulatedBySymbol = new Map<string, Record<string, unknown>>();

          for (const pos of actualPositions) {
            const sym = pos['symbol'] as string;
            allSymbols.add(sym);
            actualBySymbol.set(sym, pos);
          }
          for (const pos of simulatedPositions) {
            const sym = pos['symbol'] as string;
            allSymbols.add(sym);
            simulatedBySymbol.set(sym, pos);
          }

          const positionDifferences = Array.from(allSymbols).map((symbol) => {
            const aPos = actualBySymbol.get(symbol);
            const sPos = simulatedBySymbol.get(symbol);
            const aQty = (aPos?.['quantity'] as number) ?? 0;
            const sQty = (sPos?.['quantity'] as number) ?? 0;
            const aPrice = (aPos?.['lastFillPrice'] as number) ?? 0;
            const sPrice = (sPos?.['lastFillPrice'] as number) ?? 0;
            return {
              symbol,
              actualQuantity: aQty,
              simulatedQuantity: sQty,
              quantityDifference: sQty - aQty,
              actualValueCents: Math.round(aQty * aPrice * 100),
              simulatedValueCents: Math.round(sQty * sPrice * 100),
            };
          });

          // Count decisions: simulated stream entries represent all decisions,
          // actual stream entries represent approved/executed ones
          const [simEntries, actualEntries] = await Promise.all([
            deps.repository.countDistinctDecisions(tenantId, 'simulated'),
            deps.repository.countDistinctDecisions(tenantId, 'actual'),
          ]);
          const totalDecisions = simEntries;
          const missedDecisions = Math.max(0, simEntries - actualEntries);

          return {
            actual: {
              totalValueCents: actualTotal,
              cashBalanceCents: (actualSnapshot?.['cashBalanceCents'] as number) ?? initialValue,
              positionCount: (actualSnapshot?.['positionCount'] as number) ?? 0,
              totalReturnPercent: Math.round(actualReturn * 100) / 100,
              totalReturnCents: actualTotal - initialValue,
            },
            simulated: {
              totalValueCents: simulatedTotal,
              cashBalanceCents: (simulatedSnapshot?.['cashBalanceCents'] as number) ?? initialValue,
              positionCount: (simulatedSnapshot?.['positionCount'] as number) ?? 0,
              totalReturnPercent: Math.round(simulatedReturn * 100) / 100,
              totalReturnCents: simulatedTotal - initialValue,
            },
            divergence: {
              returnDifferencePercent: Math.round((simulatedReturn - actualReturn) * 100) / 100,
              returnDifferenceCents: simulatedTotal - actualTotal,
              positionDifferences,
              missedDecisions,
              totalDecisions,
            },
          };
        }

        case 'getTimeTravelAvailability': {
          const [earliest, latest] = await Promise.all([
            deps.repository.getEarliestCheckpoint(tenantId, 'actual'),
            deps.repository.getCheckpointBefore(tenantId, 'actual', '9999-12-31'),
          ]);
          if (!earliest || !latest) {
            return { available: false, oldestDate: null, latestDate: null };
          }
          const oldestDate = (earliest['sk'] as string).replace('Checkpoint#', '');
          const latestDate = (latest['sk'] as string).replace('Checkpoint#', '');
          return { available: true, oldestDate, latestDate };
        }

        case 'getOrderHistory': {
          const parsed = OrderHistoryArgsSchema.parse(args);
          const streamType = parsed.streamType;
          const result = await deps.repository.getOrderHistory(tenantId, streamType, {
            orderId: parsed.orderId,
            limit: parsed.limit,
            cursor: parsed.cursor,
          });
          return {
            entries: result.entries,
            nextCursor: result.nextCursor ?? null,
            hasMore: !!result.nextCursor,
          };
        }

        default:
          throw new Error(`Unknown field: ${fieldName}`);
      }
    } catch (error) {
      logger.error('GraphQL resolver error', { error, fieldName: event.info.fieldName });
      throw error;
    }
  };

// Production wiring
const TABLE_NAME = requireEnv('TABLE_NAME');
const bus = new EventBridgeBus(requireEnv('BUS_NAME'), 'order-ledger');
const repository = new LedgerRepository(TABLE_NAME, new DynamoDBClient({}));

const timeTravelService = new TimeTravelService(repository);
const deps: ResolverDeps = { repository, timeTravelService };

export const handler = applyMiddleware(
  createResolver(deps) as (event: unknown) => Promise<unknown>,
  withErrorPublishing(bus, 'ORDER_LEDGER_FAILED'),
  withLambdaContext(),
  withTiming('order-ledger-graphql-resolver'),
);
