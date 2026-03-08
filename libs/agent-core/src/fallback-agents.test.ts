import { createFallbackNode, createFallbackNodeMap, getFallbackAllocationConfig } from './fallback-agents';
import { AGENT_TYPES, AgentType } from './model-config';
import {
  GoalInterpretationSchema,
  RiskAssessmentSchema,
  MarketResearchSchema,
  PortfolioConstructionSchema,
  RebalancePlanSchema,
  ExplanationSchema,
} from './output-schemas';

const SCHEMA_MAP: Record<AgentType, import('zod').ZodType> = {
  'user-goals': GoalInterpretationSchema,
  'risk-assessment': RiskAssessmentSchema,
  'market-research': MarketResearchSchema,
  'portfolio-construction': PortfolioConstructionSchema,
  'rebalance-planner': RebalancePlanSchema,
  'explainability': ExplanationSchema,
};

describe('fallback-agents', () => {
  describe('createFallbackNode', () => {
    it.each([...AGENT_TYPES])('returns a function for agent type "%s"', (type) => {
      const node = createFallbackNode(type);
      expect(typeof node).toBe('function');
    });

    it.each([...AGENT_TYPES])(
      'fallback node for "%s" returns output that passes Zod schema validation',
      async (type) => {
        const node = createFallbackNode(type);
        const result = await node({ input: 'test' });

        expect(result).toHaveProperty(type);
        const schema = SCHEMA_MAP[type];
        const parsed = schema.safeParse(result[type]);
        expect(parsed.success).toBe(true);
      },
    );

    it.each([...AGENT_TYPES])(
      'fallback node for "%s" ignores input state',
      async (type) => {
        const node = createFallbackNode(type);

        const result1 = await node({ input: 'context-a', extra: 42 });
        const result2 = await node({ input: 'context-b', different: true });

        expect(result1).toEqual(result2);
      },
    );
  });

  describe('createFallbackNodeMap', () => {
    it('returns a complete map with all 6 agent types', () => {
      const map = createFallbackNodeMap();

      for (const type of AGENT_TYPES) {
        expect(map).toHaveProperty(type);
        expect(typeof map[type]).toBe('function');
      }
      expect(Object.keys(map)).toHaveLength(6);
    });

    it('each node in the map produces schema-valid output', async () => {
      const map = createFallbackNodeMap();

      for (const type of AGENT_TYPES) {
        const result = await map[type]({ input: 'test' });
        const schema = SCHEMA_MAP[type];
        const parsed = schema.safeParse(result[type]);
        expect(parsed.success).toBe(true);
      }
    });
  });

  describe('risk-profile-aware fallback (portfolio-construction)', () => {
    it('returns conservative allocation (30% VTI / 50% BND / 20% VTIP)', async () => {
      const node = createFallbackNode('portfolio-construction', { riskProfile: 'conservative' });
      const result = await node({});
      const pc = result['portfolio-construction'] as { allocations: Array<{ ticker: string; weight: number }> };

      expect(pc.allocations).toHaveLength(3);
      expect(pc.allocations.find((a) => a.ticker === 'VTI')?.weight).toBe(0.3);
      expect(pc.allocations.find((a) => a.ticker === 'BND')?.weight).toBe(0.5);
      expect(pc.allocations.find((a) => a.ticker === 'VTIP')?.weight).toBe(0.2);

      // Validate against Zod schema
      const parsed = PortfolioConstructionSchema.safeParse(pc);
      expect(parsed.success).toBe(true);
    });

    it('returns balanced allocation (60% VTI / 40% BND) — default', async () => {
      const node = createFallbackNode('portfolio-construction', { riskProfile: 'balanced' });
      const result = await node({});
      const pc = result['portfolio-construction'] as { allocations: Array<{ ticker: string; weight: number }> };

      expect(pc.allocations).toHaveLength(2);
      expect(pc.allocations.find((a) => a.ticker === 'VTI')?.weight).toBe(0.6);
      expect(pc.allocations.find((a) => a.ticker === 'BND')?.weight).toBe(0.4);
    });

    it('returns aggressive allocation (80% VTI / 10% BND / 10% QQQ)', async () => {
      const node = createFallbackNode('portfolio-construction', { riskProfile: 'aggressive' });
      const result = await node({});
      const pc = result['portfolio-construction'] as { allocations: Array<{ ticker: string; weight: number }> };

      expect(pc.allocations).toHaveLength(3);
      expect(pc.allocations.find((a) => a.ticker === 'VTI')?.weight).toBe(0.8);
      expect(pc.allocations.find((a) => a.ticker === 'BND')?.weight).toBe(0.1);
      expect(pc.allocations.find((a) => a.ticker === 'QQQ')?.weight).toBe(0.1);

      const parsed = PortfolioConstructionSchema.safeParse(pc);
      expect(parsed.success).toBe(true);
    });

    it('createFallbackNodeMap with investor context applies to portfolio-construction', async () => {
      const map = createFallbackNodeMap({ riskProfile: 'conservative' });
      const result = await map['portfolio-construction']({});
      const pc = result['portfolio-construction'] as { allocations: Array<{ ticker: string; weight: number }> };

      expect(pc.allocations).toHaveLength(3);
      expect(pc.allocations.find((a) => a.ticker === 'VTIP')).toBeDefined();
    });

    it('getFallbackAllocationConfig returns correct config per profile', () => {
      const conservative = getFallbackAllocationConfig('conservative');
      expect(conservative.allocations).toHaveLength(3);
      expect(conservative.expectedReturn).toBeLessThan(0.065);

      const aggressive = getFallbackAllocationConfig('aggressive');
      expect(aggressive.allocations).toHaveLength(3);
      expect(aggressive.expectedReturn).toBeGreaterThan(0.065);
    });
  });
});
