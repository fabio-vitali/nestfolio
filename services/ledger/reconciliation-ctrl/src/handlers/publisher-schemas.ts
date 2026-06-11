import { ReconciliationResultSchema, DriftRecordSchema } from '../domain/contracts';

export const subjectSchemas = {
  ReconciliationResult: ReconciliationResultSchema,
  DriftRecord: DriftRecordSchema,
};

export const exemptTypenames: string[] = [];
