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
import { INITIAL_ACCOUNT_STATE } from '@nestfolio/command-core';
import { PortfolioRepository } from '../repositories/portfolio.repository';
import { TimeTravelService } from '../services/time-travel.service';
import { TimestampSchema } from '../validation/schemas';

interface ResolverDeps {
  readonly repository: PortfolioRepository;
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
        case 'getPortfolioAt': {
          const timestamp = TimestampSchema.parse(args.timestamp);

          const state = await deps.timeTravelService.getPortfolioAt(tenantId, timestamp);
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
            cashBalanceCents: state.cashBalanceCents,
            positions,
            totalValueCents,
          };
        }

        case 'getSimulationComparison': {
          const [actualLatest, simulatedLatest, actualPositions, simulatedPositions] =
            await Promise.all([
              deps.repository.getLatest(tenantId),
              deps.repository.getSimulationLatest(tenantId),
              deps.repository.getPositions(tenantId),
              deps.repository.getSimulationPositions(tenantId),
            ]);

          const actualCash = (actualLatest?.['cashBalanceCents'] as number) ?? INITIAL_ACCOUNT_STATE.cashBalanceCents;
          const simulatedCash = (simulatedLatest?.['cashBalanceCents'] as number) ?? INITIAL_ACCOUNT_STATE.cashBalanceCents;

          // Build actual portfolio
          const actualPositionsList = actualPositions.map((p) => ({
            symbol: p['symbol'] as string,
            quantity: (p['quantity'] as number) ?? 0,
            averageCostBasis: (p['averageCostBasis'] as number) ?? 0,
            totalCostBasis: (p['totalCostBasis'] as number) ?? 0,
            lastFillPrice: (p['lastFillPrice'] as number) ?? 0,
          }));

          let actualTotalValue = actualCash;
          for (const pos of actualPositionsList) {
            actualTotalValue += Math.round(pos.quantity * pos.lastFillPrice * 100);
          }

          // Build simulated portfolio
          const simulatedPositionsList = simulatedPositions.map((p) => ({
            symbol: p['symbol'] as string,
            quantity: (p['quantity'] as number) ?? 0,
            averageCostBasis: (p['averageCostBasis'] as number) ?? 0,
            totalCostBasis: (p['totalCostBasis'] as number) ?? 0,
            lastFillPrice: (p['lastFillPrice'] as number) ?? 0,
          }));

          let simulatedTotalValue = simulatedCash;
          for (const pos of simulatedPositionsList) {
            simulatedTotalValue += Math.round(pos.quantity * pos.lastFillPrice * 100);
          }

          // Build position diffs
          const allSymbols = new Set<string>();
          const actualBySymbol = new Map<string, typeof actualPositionsList[0]>();
          const simulatedBySymbol = new Map<string, typeof simulatedPositionsList[0]>();

          for (const pos of actualPositionsList) {
            allSymbols.add(pos.symbol);
            actualBySymbol.set(pos.symbol, pos);
          }
          for (const pos of simulatedPositionsList) {
            allSymbols.add(pos.symbol);
            simulatedBySymbol.set(pos.symbol, pos);
          }

          const positionDiffs = Array.from(allSymbols).map((symbol) => {
            const aQty = actualBySymbol.get(symbol)?.quantity ?? 0;
            const sQty = simulatedBySymbol.get(symbol)?.quantity ?? 0;
            return {
              symbol,
              actualQuantity: aQty,
              simulatedQuantity: sQty,
              quantityDiff: sQty - aQty,
            };
          });

          return {
            actual: {
              cashBalanceCents: actualCash,
              positions: actualPositionsList,
              totalValueCents: actualTotalValue,
            },
            simulated: {
              cashBalanceCents: simulatedCash,
              positions: simulatedPositionsList,
              totalValueCents: simulatedTotalValue,
            },
            cashDeltaCents: simulatedCash - actualCash,
            positionDiffs,
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
const bus = new EventBridgeBus(requireEnv('BUS_NAME'), 'ledger-bff');
const repository = new PortfolioRepository(TABLE_NAME, new DynamoDBClient({}));

const timeTravelService = new TimeTravelService(repository);
const deps: ResolverDeps = { repository, timeTravelService };

export const handler = applyMiddleware(
  createResolver(deps) as (event: unknown) => Promise<unknown>,
  withErrorPublishing(bus, 'LEDGER_BFF_FAILED'),
  withLambdaContext(),
  withTiming('ledger-bff-graphql-resolver'),
);
