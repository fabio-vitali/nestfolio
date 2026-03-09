import { z } from 'zod';

// --- Mutation input schemas ---

export const GoalInputSchema = z.object({
  objective: z.string().min(1).max(500),
  targetAmountCents: z.number().int().positive(),
  currency: z.string().length(3),
  timeHorizonMonths: z.number().int().positive().max(600),
  targetReturn: z.number().min(0).max(100),
});

export const UpdateGoalInputSchema = z.object({
  objective: z.string().min(1).max(500).optional(),
  targetAmountCents: z.number().int().positive().optional(),
  currency: z.string().length(3).optional(),
  timeHorizonMonths: z.number().int().positive().max(600).optional(),
  targetReturn: z.number().min(0).max(100).optional(),
}).refine((obj) => Object.keys(obj).length > 0, {
  message: 'At least one field must be provided for update',
});

export const GoalIdSchema = z.string().min(1).max(256);

export const RiskProfileInputSchema = z.object({
  score: z.number().int().min(1).max(10),
  band: z.object({
    minEquity: z.number().min(0).max(100),
    maxEquity: z.number().min(0).max(100),
  }).refine((band) => band.minEquity <= band.maxEquity, {
    message: 'minEquity must be less than or equal to maxEquity',
  }),
});

const MandateLevelSchema = z.enum(['ADVISORY', 'DISCRETIONARY']);
const RebalanceCadenceSchema = z.enum(['WEEKLY', 'MONTHLY', 'QUARTERLY']);

export const MandateInputSchema = z.object({
  level: MandateLevelSchema,
  monthlyTurnoverCapPercent: z.number().min(0).max(100),
  maxSingleTradePercent: z.number().min(0).max(100),
  coolDownDays: z.number().int().min(0).max(365),
  rebalanceCadence: RebalanceCadenceSchema,
});

export const OperatingModeSchema = z.enum(['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE']);

export const MoneyInputSchema = z.object({
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
});

export const NotificationIdSchema = z.string().min(1).max(256);

export const OnboardingAnswerInputSchema = z.object({
  stepId: z.string().min(1).max(100).optional(),
  questionId: z.string().min(1).max(100).optional(),
  answer: z.unknown().optional(),
});
