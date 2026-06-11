import { VirtualTradeSchema, SimDepositCompletedSchema, SimWithdrawalCompletedSchema } from '../domain/contracts';

export const subjectSchemas = {
  VirtualTrade: VirtualTradeSchema,
  DepositDetected: SimDepositCompletedSchema,
  WithdrawalCompleted: SimWithdrawalCompletedSchema,
};

export const exemptTypenames: string[] = [];
