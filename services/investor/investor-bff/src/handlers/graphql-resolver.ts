import { AppSyncResolverEvent } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { logger } from '@nestfolio/platform-core';
import { requireEnv, authorizeTenant, validateQueryDepth, applyMiddleware, withLambdaContext, withTiming } from '@nestfolio/lambda-utils';
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
import {
  GoalInputSchema,
  UpdateGoalInputSchema,
  GoalIdSchema,
  RiskProfileInputSchema,
  MandateInputSchema,
  OperatingModeSchema,
  MoneyInputSchema,
  NotificationIdSchema,
  OnboardingAnswerInputSchema,
} from '../validation/schemas';

interface ResolverDeps {
  readonly repository: InvestorProfileRepository;
}

export const createResolver = (deps: ResolverDeps) =>
  async (
    event: AppSyncResolverEvent<Record<string, unknown>>,
  ): Promise<unknown> => {
    try {
      validateQueryDepth(event.info.selectionSetGraphQL);
      const tenantId = authorizeTenant(event);
      const fieldName = event.info.fieldName;
      const claims = event.identity as Record<string, unknown> | undefined;
      const userId = (claims?.['claims'] as Record<string, string>)?.['sub'] ?? '';
      const args = event.arguments ?? {};

      logger.info('Resolving field', { fieldName, tenantId, userId });

      switch (fieldName) {
      // Queries
      case 'getProfile':
        return getProfile(deps.repository, tenantId, userId);

      case 'getGoals':
        return getGoals(deps.repository, tenantId, userId);

      case 'getNotifications': {
        const limit = (args.limit as number) ?? 20;
        const cursor = args.cursor as string | undefined;
        const result = await getNotifications(deps.repository, tenantId, userId, limit, cursor);
        return {
          items: result.items,
          nextCursor: result.nextCursor,
        };
      }

      case 'getUnreadCount':
        return getUnreadCount(deps.repository, tenantId, userId);

      // Mutations
      case 'setGoal': {
        const input = GoalInputSchema.parse(args.input);
        return setGoal(deps.repository, tenantId, userId, input);
      }

      case 'updateGoal': {
        const goalId = GoalIdSchema.parse(args.goalId);
        const input = UpdateGoalInputSchema.parse(args.input);
        return updateGoal(deps.repository, tenantId, userId, goalId, input);
      }

      case 'setRiskProfile': {
        const input = RiskProfileInputSchema.parse(args.input);
        return setRiskProfile(deps.repository, tenantId, userId, input);
      }

      case 'grantMandate': {
        const input = MandateInputSchema.parse(args.input);
        return grantMandate(deps.repository, tenantId, userId, input);
      }

      case 'updateMandate': {
        const input = MandateInputSchema.parse(args.input);
        return updateMandate(deps.repository, tenantId, userId, input);
      }

      case 'revokeMandate':
        return revokeMandate(deps.repository, tenantId, userId);

      case 'selectOperatingMode': {
        const mode = OperatingModeSchema.parse(args.mode);
        return selectOperatingMode(deps.repository, tenantId, userId, mode);
      }

      case 'initiateDeposit': {
        const input = MoneyInputSchema.parse(args.input);
        return initiateDeposit(tenantId, userId, input);
      }

      case 'requestWithdrawal': {
        const input = MoneyInputSchema.parse(args.input);
        return requestWithdrawal(tenantId, userId, input);
      }

      case 'markNotificationRead': {
        const notificationId = NotificationIdSchema.parse(args.notificationId);
        return markNotificationRead(deps.repository, tenantId, userId, notificationId);
      }

      case 'requestAccountClosure':
        return { closureId: '', status: 'PENDING', requestedAt: new Date().toISOString() };

      case 'recordOnboardingAnswer': {
        OnboardingAnswerInputSchema.parse(args.input);
        return { step: 'COMPLETED', answeredAt: new Date().toISOString() };
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
const resolverDeps: ResolverDeps = {
  repository: new InvestorProfileRepository(TABLE_NAME, new DynamoDBClient({})),
};

export const handler = applyMiddleware(
  createResolver(resolverDeps) as (event: unknown) => Promise<unknown>,
  withLambdaContext(),
  withTiming('investor-bff-graphql-resolver'),
);
