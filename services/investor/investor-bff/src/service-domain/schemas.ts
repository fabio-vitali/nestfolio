import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

export const MandateGrantedSchema = BusEventSchema.extend({
  type: z.literal('MANDATE_GRANTED'),
  subject: z.object({
    mandateId: z.string(),
    level: z.enum(['ADVISORY', 'DISCRETIONARY']),
    effectiveDate: z.string().datetime(),
  }),
});

export type MandateGrantedEvent = z.infer<typeof MandateGrantedSchema>;

export const GoalUpdatedSchema = BusEventSchema.extend({
  type: z.literal('GOAL_UPDATED'),
  subject: z.object({
    goalId: z.string(),
    objective: z.string(),
    timeHorizonMonths: z.number().int().positive(),
    targetReturn: z.number().min(0).max(1),
  }),
});

export type GoalUpdatedEvent = z.infer<typeof GoalUpdatedSchema>;

export const RiskProfileUpdatedSchema = BusEventSchema.extend({
  type: z.literal('RISK_PROFILE_UPDATED'),
  subject: z.object({
    profileId: z.string(),
    score: z.number().int().min(1).max(10),
    band: z.object({
      minEquity: z.number().min(0).max(1),
      maxEquity: z.number().min(0).max(1),
    }),
  }),
});

export type RiskProfileUpdatedEvent = z.infer<typeof RiskProfileUpdatedSchema>;

export const OnboardingCompletedSchema = BusEventSchema.extend({
  type: z.literal('ONBOARDING_COMPLETED'),
  subject: z.object({
    tenantId: z.string().uuid(),
    operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
    riskScore: z.number().int().min(1).max(10),
    goalId: z.string(),
  }),
});

export type OnboardingCompletedEvent = z.infer<typeof OnboardingCompletedSchema>;

export const DepositInitiatedSchema = BusEventSchema.extend({
  type: z.literal('DEPOSIT_INITIATED'),
  subject: z.object({
    depositId: z.string(),
    amountCents: z.number().int().positive(),
    currency: z.string().length(3),
  }),
});

export type DepositInitiatedEvent = z.infer<typeof DepositInitiatedSchema>;
