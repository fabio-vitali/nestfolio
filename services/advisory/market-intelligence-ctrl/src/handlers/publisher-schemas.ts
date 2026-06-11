import { MarketSnapshotSchema } from '../domain/contracts';

export const subjectSchemas = {
  MarketSnapshot: MarketSnapshotSchema,
};

export const exemptTypenames: string[] = ['AgentInvocation'];
