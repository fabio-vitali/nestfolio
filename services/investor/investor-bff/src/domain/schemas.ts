import { z } from 'zod';
import { BusEventSchema } from '@nestfolio/event-processor';

// Phase 1 InvestorProfile collapse (2026-05-03):
// MandateCreatedSchema, GoalUpdatedSchema, RiskProfileUpdatedSchema dropped —
// these were Egress emissions from the legacy 7-row InvestorProfile model.
// Phase 1 Tasks 1.3 + 1.6 collapsed all of (Goal, RiskProfile, Mandate,
// OperatingModeRecord) into nested fields on a single InvestorProfile row,
// and Egress no longer emits these legacy event types.

export const OnboardingCompletedSchema = BusEventSchema.extend({
  type: z.literal('ONBOARDING_COMPLETED'),
  subject: z.object({
    tenantId: z.string().uuid(),
    userId: z.string().min(1),
    goal: z.object({ objective: z.string() }),
    horizonYears: z.number().int().min(1).max(30),
    accountMode: z.enum(['simulation', 'live']),
    capitalAmount: z.number().nonnegative(),
    currency: z.string().length(3),
    riskTolerance: z.number().int().min(0).max(3),
    riskExperience: z.number().int().min(0).max(3),
    operatingMode: z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']),
    mandateLevel: z.enum(['ADVISORY', 'DISCRETIONARY']).optional(),
    mandateAccepted: z.literal(true),
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
