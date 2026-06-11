import { NormalizedOrderEventSchema } from '../domain/contracts';
import { FundingSnapshotSchema } from '@nestfolio/execution-adpt/domain';

export const subjectSchemas = {
  NormalizedEvent: NormalizedOrderEventSchema,
  FundingEvent: FundingSnapshotSchema,
};

export const exemptTypenames: string[] = [];
