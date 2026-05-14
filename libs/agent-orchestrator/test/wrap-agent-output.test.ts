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

  it('uses UTF-8 byte length, not UTF-16 code-unit length, when measuring size', () => {
    // Each '€' is 1 code unit in UTF-16 but 3 bytes in UTF-8. Build a payload
    // whose UTF-16 .length is well under the threshold but whose UTF-8 byte
    // length exceeds it — `JSON.stringify(...).length` would let it through;
    // `Buffer.byteLength(..., 'utf8')` correctly throws.
    const euros = '€'.repeat(INLINE_SIZE_THRESHOLD_BYTES); // length=25000, utf8 bytes ≈ 75000
    const output = { p: euros };
    expect(JSON.stringify(output).length).toBeLessThan(INLINE_SIZE_THRESHOLD_BYTES * 2);
    expect(Buffer.byteLength(JSON.stringify(output), 'utf8')).toBeGreaterThan(INLINE_SIZE_THRESHOLD_BYTES);
    expect(() => wrapAgentOutput(output)).toThrow(OutputTooLargeError);
  });
});
