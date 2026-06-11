import { OnboardingCompletedRecordSchema, GoLiveConfirmedSchema } from '../domain/contracts';

export const subjectSchemas = {
  OnboardingCompleted: OnboardingCompletedRecordSchema,
  GoLiveConfirmed: GoLiveConfirmedSchema,
};

export const exemptTypenames: string[] = [];
