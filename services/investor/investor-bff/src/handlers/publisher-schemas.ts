import { InvestorProfileUpdatedSchema, NotificationReadSchema } from '../domain/contracts';
import { MandateSchema, DepositInitiatedSchema, WithdrawalInitiatedSchema, ExecutionModeChangedSchema } from '@nestfolio/investor-adpt/domain';

export const subjectSchemas = {
  InvestorProfile: InvestorProfileUpdatedSchema,
  Notification: NotificationReadSchema,
  Mandate: MandateSchema,
  DepositIntent: DepositInitiatedSchema,
  WithdrawalIntent: WithdrawalInitiatedSchema,
  ExecutionModeChange: ExecutionModeChangedSchema,
};

export const exemptTypenames: string[] = [];
