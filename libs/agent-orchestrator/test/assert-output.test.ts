import { assertOrchestratorOutput } from '../src/assert-output';
import { EmptyAgentResponseError } from '../src/errors';
import type { AgentNodeResult } from '../src/with-fallback';

const CTX = { decisionId: 'd-1', agent: 'test-agent' };

describe('assertOrchestratorOutput', () => {
  it('does not throw when every expected key is ok:true with a non-empty object output', () => {
    const result: Record<string, AgentNodeResult> = {
      alpha: { ok: true, output: { foo: 'bar' } },
      beta: { ok: true, output: { baz: 1 } },
    };
    expect(() => assertOrchestratorOutput(result, ['alpha', 'beta'], CTX)).not.toThrow();
  });

  it('does not throw when expected key maps to a non-empty array', () => {
    const result: Record<string, AgentNodeResult> = {
      alpha: { ok: true, output: { items: [1, 2] } },
    };
    expect(() => assertOrchestratorOutput(result, ['alpha'], CTX)).not.toThrow();
  });

  it('throws EmptyAgentResponseError when expected key is missing', () => {
    const result: Record<string, AgentNodeResult> = {
      alpha: { ok: true, output: { foo: 'bar' } },
    };
    try {
      assertOrchestratorOutput(result, ['alpha', 'missing-key'], CTX);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EmptyAgentResponseError);
      expect((err as EmptyAgentResponseError).missingOrEmptyKeys).toEqual(['missing-key']);
    }
  });

  it('throws EmptyAgentResponseError when an expected key maps to ok:true with empty object', () => {
    const result: Record<string, AgentNodeResult> = {
      alpha: { ok: true, output: {} },
    };
    try {
      assertOrchestratorOutput(result, ['alpha'], CTX);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EmptyAgentResponseError);
      expect((err as EmptyAgentResponseError).missingOrEmptyKeys).toEqual(['alpha']);
    }
  });

  it('throws EmptyAgentResponseError when an expected key maps to ok:true with empty array', () => {
    const result: Record<string, AgentNodeResult> = {
      alpha: { ok: true, output: [] as unknown as Record<string, unknown> },
    };
    try {
      assertOrchestratorOutput(result, ['alpha'], CTX);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EmptyAgentResponseError);
      expect((err as EmptyAgentResponseError).missingOrEmptyKeys).toEqual(['alpha']);
    }
  });

  it('throws EmptyAgentResponseError when an expected key maps to ok:false (defensive)', () => {
    const result: Record<string, AgentNodeResult> = {
      alpha: { ok: false, reason: 'boom', fallback: { foo: 'bar' } },
    };
    try {
      assertOrchestratorOutput(result, ['alpha'], CTX);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EmptyAgentResponseError);
      expect((err as EmptyAgentResponseError).missingOrEmptyKeys).toEqual(['alpha']);
    }
  });

  it('exposes responseKeys reflecting all keys present in the result', () => {
    const result: Record<string, AgentNodeResult> = {
      alpha: { ok: true, output: {} },
      beta: { ok: true, output: { x: 1 } },
    };
    try {
      assertOrchestratorOutput(result, ['alpha'], CTX);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as EmptyAgentResponseError).responseKeys.sort()).toEqual(['alpha', 'beta']);
    }
  });
});
