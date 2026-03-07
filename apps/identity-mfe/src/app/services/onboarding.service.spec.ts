import { TestBed } from '@angular/core/testing';
import { OnboardingService } from './onboarding.service';
import type { GoalInput, MandateInput, RiskProfileInput } from '../stores/onboarding.store';

jest.mock('@nestfolio/appsync-client', () => ({
  mutate: jest.fn(),
  RECORD_ONBOARDING_ANSWER: 'RECORD_ONBOARDING_ANSWER',
  SET_GOAL: 'SET_GOAL',
  SET_RISK_PROFILE: 'SET_RISK_PROFILE',
  SELECT_OPERATING_MODE: 'SELECT_OPERATING_MODE',
  GRANT_MANDATE: 'GRANT_MANDATE',
}));

import { mutate } from '@nestfolio/appsync-client';

const mockMutate = mutate as jest.MockedFunction<typeof mutate>;

describe('OnboardingService', () => {
  let service: OnboardingService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(OnboardingService);
    jest.clearAllMocks();
  });

  describe('recordOnboardingAnswer', () => {
    it('should call mutate with RECORD_ONBOARDING_ANSWER and return result', async () => {
      const input = { step: 'risk-1', payload: { answer: 'low' } };
      const expected = { step: 'risk-1', answeredAt: '2026-03-07T10:00:00Z' };
      mockMutate.mockResolvedValue({ recordOnboardingAnswer: expected });

      const result = await service.recordOnboardingAnswer(input);

      expect(mockMutate).toHaveBeenCalledWith('RECORD_ONBOARDING_ANSWER', { input });
      expect(result).toEqual(expected);
    });
  });

  describe('setGoal', () => {
    it('should call mutate with SET_GOAL and return result', async () => {
      const input: GoalInput = {
        objective: 'Retirement',
        targetAmountCents: 500000,
        currency: 'EUR',
        timeHorizonMonths: 240,
      };
      const expected = {
        goalId: 'g1',
        tenantId: 't1',
        objective: 'Retirement',
        targetAmountCents: 500000,
        currency: 'EUR',
        timeHorizonMonths: 240,
        targetReturn: 0.07,
        createdAt: '2026-03-07T10:00:00Z',
        updatedAt: '2026-03-07T10:00:00Z',
      };
      mockMutate.mockResolvedValue({ setGoal: expected });

      const result = await service.setGoal(input);

      expect(mockMutate).toHaveBeenCalledWith('SET_GOAL', { input });
      expect(result).toEqual(expected);
    });
  });

  describe('setRiskProfile', () => {
    it('should call mutate with SET_RISK_PROFILE and return result', async () => {
      const input: RiskProfileInput = {
        score: 7,
        band: { minEquity: 40, maxEquity: 60 },
      };
      const expected = {
        profileId: 'rp1',
        tenantId: 't1',
        score: 7,
        band: { minEquity: 40, maxEquity: 60 },
        assessedAt: '2026-03-07T10:00:00Z',
        version: 1,
      };
      mockMutate.mockResolvedValue({ setRiskProfile: expected });

      const result = await service.setRiskProfile(input);

      expect(mockMutate).toHaveBeenCalledWith('SET_RISK_PROFILE', { input });
      expect(result).toEqual(expected);
    });
  });

  describe('selectOperatingMode', () => {
    it('should call mutate with SELECT_OPERATING_MODE and return result', async () => {
      const expected = { operatingMode: 'BALANCED', updatedAt: '2026-03-07T10:00:00Z' };
      mockMutate.mockResolvedValue({ selectOperatingMode: expected });

      const result = await service.selectOperatingMode('BALANCED');

      expect(mockMutate).toHaveBeenCalledWith('SELECT_OPERATING_MODE', { mode: 'BALANCED' });
      expect(result).toEqual(expected);
    });
  });

  describe('grantMandate', () => {
    it('should call mutate with GRANT_MANDATE and return result', async () => {
      const input: MandateInput = {
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        coolDownDays: 5,
        rebalanceCadence: 'QUARTERLY',
      };
      const expected = {
        mandateId: 'm1',
        tenantId: 't1',
        level: 'ADVISORY',
        monthlyTurnoverCapPercent: 10,
        maxSingleTradePercent: 5,
        coolDownDays: 5,
        rebalanceCadence: 'QUARTERLY',
        effectiveDate: '2026-03-07',
        revokedAt: null,
        version: 1,
      };
      mockMutate.mockResolvedValue({ grantMandate: expected });

      const result = await service.grantMandate(input);

      expect(mockMutate).toHaveBeenCalledWith('GRANT_MANDATE', { input });
      expect(result).toEqual(expected);
    });
  });

  describe('error handling', () => {
    it('should propagate errors from mutate', async () => {
      mockMutate.mockRejectedValue(new Error('Network error'));

      await expect(service.recordOnboardingAnswer({ step: 'risk-1', payload: {} }))
        .rejects
        .toThrow('Network error');
    });
  });
});
