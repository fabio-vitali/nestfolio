import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv } from '@nestfolio/lambda-utils';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';
import { getProfile } from '../resolvers/profile.resolver';
import { setGoal, updateGoal, getGoals } from '../resolvers/goal.resolver';
import { setRiskProfile } from '../resolvers/risk-profile.resolver';
import { grantMandate, updateMandate, revokeMandate } from '../resolvers/mandate.resolver';
import { selectOperatingMode } from '../resolvers/operating-mode.resolver';
import { initiateDeposit } from '../resolvers/deposit.resolver';
import { requestWithdrawal } from '../resolvers/withdrawal.resolver';
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
} from '../resolvers/notification.resolver';

const TABLE_NAME = requireEnv('TABLE_NAME');
const repository = new InvestorProfileRepository(TABLE_NAME, new DynamoDBClient({}));

export const handler = async (
  event: AppSyncResolverEvent<Record<string, unknown>>,
): Promise<unknown> => {
  const fieldName = event.info.fieldName;
  const claims = event.identity as Record<string, unknown> | undefined;
  const tenantId = (claims?.['claims'] as Record<string, string>)?.['custom:tenant_id'] ?? '';
  const userId = (claims?.['claims'] as Record<string, string>)?.['sub'] ?? '';
  const args = event.arguments ?? {};

  logger.info('Resolving field', { fieldName, tenantId, userId });

  switch (fieldName) {
    // Queries
    case 'getProfile':
      return getProfile(repository, tenantId, userId);

    case 'getGoals':
      return getGoals(repository, tenantId, userId);

    case 'getNotifications': {
      const limit = (args.limit as number) ?? 20;
      const cursor = args.cursor as string | undefined;
      const result = await getNotifications(repository, tenantId, userId, limit, cursor);
      return {
        items: result.items,
        nextCursor: result.nextCursor,
      };
    }

    case 'getUnreadCount':
      return getUnreadCount(repository, tenantId, userId);

    // Mutations
    case 'setGoal':
      return setGoal(repository, tenantId, userId, args.input as {
        objective: string;
        targetAmountCents: number;
        currency: string;
        timeHorizonMonths: number;
        targetReturn: number;
      });

    case 'updateGoal':
      return updateGoal(
        repository,
        tenantId,
        userId,
        args.goalId as string,
        args.input as Record<string, unknown>,
      );

    case 'setRiskProfile':
      return setRiskProfile(repository, tenantId, userId, args.input as {
        score: number;
        band: { minEquity: number; maxEquity: number };
      });

    case 'grantMandate':
      return grantMandate(repository, tenantId, userId, args.input as {
        level: 'ADVISORY' | 'DISCRETIONARY';
        monthlyTurnoverCapPercent: number;
        maxSingleTradePercent: number;
        coolDownDays: number;
        rebalanceCadence: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
      });

    case 'updateMandate':
      return updateMandate(repository, tenantId, userId, args.input as {
        level: 'ADVISORY' | 'DISCRETIONARY';
        monthlyTurnoverCapPercent: number;
        maxSingleTradePercent: number;
        coolDownDays: number;
        rebalanceCadence: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
      });

    case 'revokeMandate':
      return revokeMandate(repository, tenantId, userId);

    case 'selectOperatingMode':
      return selectOperatingMode(
        repository,
        tenantId,
        userId,
        args.mode as 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE',
      );

    case 'initiateDeposit':
      return initiateDeposit(tenantId, userId, args.input as {
        amountCents: number;
        currency: string;
      });

    case 'requestWithdrawal':
      return requestWithdrawal(tenantId, userId, args.input as {
        amountCents: number;
        currency: string;
      });

    case 'markNotificationRead':
      return markNotificationRead(repository, tenantId, userId, args.notificationId as string);

    case 'requestAccountClosure':
      return { closureId: '', status: 'PENDING', requestedAt: new Date().toISOString() };

    case 'recordOnboardingAnswer':
      return { step: 'COMPLETED', answeredAt: new Date().toISOString() };

    default:
      throw new Error(`Unknown field: ${fieldName}`);
  }
};
