import { createFallbackNode, createFallbackNodeMap } from './fallback-agents';
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
});
