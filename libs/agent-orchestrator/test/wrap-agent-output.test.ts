import { wrapAgentOutput, OutputTooLargeError, INLINE_SIZE_THRESHOLD_BYTES } from '../src/wrap-agent-output';

describe('wrapAgentOutput', () => {
  it('returns the output inline when serialized size is below the threshold', () => {
    const output = { decisionId: 'd1', tenantId: 't1', agent: 'narrative', value: 'small' };
    const wrapped = wrapAgentOutput(output);
    expect(wrapped).toEqual({ kind: 'inline', value: output });
  });

  it('returns inline at exactly the threshold boundary', () => {
    // Build an output whose JSON.stringify length is exactly INLINE_SIZE_THRESHOLD_BYTES
    const padding = 'x'.repeat(INLINE_SIZE_THRESHOLD_BYTES - JSON.stringify({ p: '' }).length);
    const output = { p: padding };
    expect(JSON.stringify(output).length).toBe(INLINE_SIZE_THRESHOLD_BYTES);
    const wrapped = wrapAgentOutput(output);
    expect(wrapped.kind).toBe('inline');
  });

  it('throws OutputTooLargeError when serialized size exceeds the threshold', () => {
    const padding = 'x'.repeat(INLINE_SIZE_THRESHOLD_BYTES + 1);
    const output = { p: padding };
    expect(() => wrapAgentOutput(output)).toThrow(OutputTooLargeError);
    expect(() => wrapAgentOutput(output)).toThrow(/exceeds 25000 bytes/);
  });

  it('reports actual size in the error', () => {
    const padding = 'x'.repeat(INLINE_SIZE_THRESHOLD_BYTES + 100);
    const output = { p: padding };
    let caught: OutputTooLargeError | undefined;
    try { wrapAgentOutput(output); } catch (e) { caught = e as OutputTooLargeError; }
    expect(caught).toBeDefined();
    expect(caught!.actualBytes).toBeGreaterThan(INLINE_SIZE_THRESHOLD_BYTES);
  });
});
