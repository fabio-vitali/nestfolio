import { BalanceUpdatedSchema, PortfolioUpdatedSchema, LedgerEntryRecordedSchema } from '../domain/contracts';

export const subjectSchemas = {
  BalanceEvent: BalanceUpdatedSchema,
  PortfolioEvent: PortfolioUpdatedSchema,
  LedgerEntryEvent: LedgerEntryRecordedSchema,
};

export const exemptTypenames: string[] = [];
