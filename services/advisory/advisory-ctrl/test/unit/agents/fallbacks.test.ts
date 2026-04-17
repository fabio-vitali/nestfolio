import { FALLBACK_MAP, createFallbackMap, getFallbackAllocationConfig } from '../../../src/agents/fallbacks';
import { AGENT_TYPES, type AgentType } from '../../../src/agents/config';
import {
  GoalInterpretationSchema,
  RiskAssessmentSchema,
  MarketResearchSchema,
  PortfolioConstructionSchema,
  RebalancePlanSchema,
  ExplanationSchema,
} from '../../../src/agents/schemas';
import type { ZodType } from 'zod';

const SCHEMA_MAP: Record<AgentType, ZodType> = {
  'user-goals': GoalInterpretationSchema,
  'risk-assessment': RiskAssessmentSchema,
  'market-research': MarketResearchSchema,
  'portfolio-construction': PortfolioConstructionSchema,
  'rebalance-planner': RebalancePlanSchema,
  explainability: ExplanationSchema,
};

describe('Advisory Agent Fallbacks', () => {
  describe('FALLBACK_MAP', () => {
    it('has a fallback for every agent type', () => {
      for (const type of AGENT_TYPES) {
        expect(FALLBACK_MAP[type]).toBeDefined();
        expect(typeof FALLBACK_MAP[type]).toBe('function');
      }
      expect(Object.keys(FALLBACK_MAP)).toHaveLength(6);
    });

    it.each([...AGENT_TYPES])(
      'fallback for "%s" returns output that passes Zod schema',
      (type) => {
        const output = FALLBACK_MAP[type]({});
        const schema = SCHEMA_MAP[type];
        const parsed = schema.safeParse(output);
        if (!parsed.success) {
          console.error(`Schema error for ${type}:`, parsed.error);
        }
        expect(parsed.success).toBe(true);
      },
    );
  });

  describe('risk-profile-aware fallback (portfolio-construction)', () => {
    it('conservative fallback: 3 allocations with VTI=0.3, BND=0.5, VTIP=0.2', () => {
      const map = createFallbackMap({ riskProfile: 'conservative' });
      const pc = map['portfolio-construction']({}) as {
        allocations: Array<{ ticker: string; weight: number }>;
      };
      expect(pc.allocations).toHaveLength(3);
      expect(pc.allocations.find((a) => a.ticker === 'VTI')?.weight).toBe(0.3);
      expect(pc.allocations.find((a) => a.ticker === 'BND')?.weight).toBe(0.5);
      expect(pc.allocations.find((a) => a.ticker === 'VTIP')?.weight).toBe(0.2);

      expect(PortfolioConstructionSchema.safeParse(pc).success).toBe(true);
    });

    it('aggressive fallback: 3 allocations with VTI=0.8, BND=0.1, QQQ=0.1', () => {
      const map = createFallbackMap({ riskProfile: 'aggressive' });
      const pc = map['portfolio-construction']({}) as {
        allocations: Array<{ ticker: string; weight: number }>;
      };
      expect(pc.allocations).toHaveLength(3);
      expect(pc.allocations.find((a) => a.ticker === 'VTI')?.weight).toBe(0.8);
      expect(pc.allocations.find((a) => a.ticker === 'QQQ')?.weight).toBe(0.1);

      expect(PortfolioConstructionSchema.safeParse(pc).success).toBe(true);
    });

    it('balanced fallback: 2 allocations VTI=0.6, BND=0.4 (default)', () => {
      const pc = FALLBACK_MAP['portfolio-construction']({}) as {
        allocations: Array<{ ticker: string; weight: number }>;
      };
      expect(pc.allocations).toHaveLength(2);
      expect(pc.allocations.find((a) => a.ticker === 'VTI')?.weight).toBe(0.6);
      expect(pc.allocations.find((a) => a.ticker === 'BND')?.weight).toBe(0.4);
    });

    it('createFallbackMap without context returns default FALLBACK_MAP', () => {
      const map = createFallbackMap();
      expect(map).toBe(FALLBACK_MAP);
    });
  });

  describe('getFallbackAllocationConfig', () => {
    it('conservative has lower expectedReturn', () => {
      const config = getFallbackAllocationConfig('conservative');
      expect(config.allocations).toHaveLength(3);
      expect(config.expectedReturn).toBeLessThan(0.065);
    });

    it('aggressive has higher expectedReturn', () => {
      const config = getFallbackAllocationConfig('aggressive');
      expect(config.allocations).toHaveLength(3);
      expect(config.expectedReturn).toBeGreaterThan(0.065);
    });
  });
});
