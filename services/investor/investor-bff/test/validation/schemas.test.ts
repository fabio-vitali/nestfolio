import { GoalInputSchema, UpdateGoalInputSchema } from '../../src/validation/schemas';

describe('GoalInputSchema', () => {
  const validGoal = {
    objective: 'Retirement savings',
    targetAmountCents: 10_000_00,
    currency: 'USD',
    timeHorizonMonths: 240,
    targetReturn: 0.07,
  };

  describe('targetReturn boundary validation', () => {
    it('should accept targetReturn = 0 (lower boundary)', () => {
      const result = GoalInputSchema.safeParse({ ...validGoal, targetReturn: 0 });
      expect(result.success).toBe(true);
    });

    it('should accept targetReturn = 0.5 (mid-range)', () => {
      const result = GoalInputSchema.safeParse({ ...validGoal, targetReturn: 0.5 });
      expect(result.success).toBe(true);
    });

    it('should accept targetReturn = 1 (upper boundary)', () => {
      const result = GoalInputSchema.safeParse({ ...validGoal, targetReturn: 1 });
      expect(result.success).toBe(true);
    });

    it('should reject targetReturn = 1.01 (above max)', () => {
      const result = GoalInputSchema.safeParse({ ...validGoal, targetReturn: 1.01 });
      expect(result.success).toBe(false);
    });

    it('should reject targetReturn = -0.01 (below min)', () => {
      const result = GoalInputSchema.safeParse({ ...validGoal, targetReturn: -0.01 });
      expect(result.success).toBe(false);
    });

    it('should reject targetReturn = 100 (way above max)', () => {
      const result = GoalInputSchema.safeParse({ ...validGoal, targetReturn: 100 });
      expect(result.success).toBe(false);
    });
  });
});

describe('UpdateGoalInputSchema', () => {
  describe('targetReturn boundary validation', () => {
    it('should accept targetReturn = 0 (lower boundary)', () => {
      const result = UpdateGoalInputSchema.safeParse({ targetReturn: 0 });
      expect(result.success).toBe(true);
    });

    it('should accept targetReturn = 100 (upper boundary for update)', () => {
      const result = UpdateGoalInputSchema.safeParse({ targetReturn: 100 });
      expect(result.success).toBe(true);
    });

    it('should reject targetReturn = 100.01 (above update max)', () => {
      const result = UpdateGoalInputSchema.safeParse({ targetReturn: 100.01 });
      expect(result.success).toBe(false);
    });

    it('should reject targetReturn = -0.01 (below min)', () => {
      const result = UpdateGoalInputSchema.safeParse({ targetReturn: -0.01 });
      expect(result.success).toBe(false);
    });

    it('should reject empty update object', () => {
      const result = UpdateGoalInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
