import { DecisionReadModelSchema, UserConfirmationSchema, UserRejectionSchema } from '../domain/contracts';

export const subjectSchemas = {
  DecisionReadModel: DecisionReadModelSchema,
  UserConfirmation: UserConfirmationSchema,
  UserRejection: UserRejectionSchema,
};

export const exemptTypenames: string[] = ['AdvisoryStatus', 'UserInteraction'];
