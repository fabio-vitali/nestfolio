import {
  DecisionReadModelSchema, UserConfirmationSchema, UserRejectionSchema, AdvisoryStatusSchema,
} from '../domain/contracts';

export const subjectSchemas = {
  DecisionReadModel: DecisionReadModelSchema,
  UserConfirmation: UserConfirmationSchema,
  UserRejection: UserRejectionSchema,
  AdvisoryStatus: AdvisoryStatusSchema,
};

export const exemptTypenames: string[] = [];
