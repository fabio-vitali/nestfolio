import { formatToolContext, MAX_SECTION_BYTES } from '../../../src/agents/tools/format-context';

describe('formatToolContext', () => {
  it('produces labelled sections for each entry', () => {
    const out = formatToolContext({
      'Market data': { indices: [{ ticker: 'SPY', price: 450 }] },
    });
    expect(out).toContain('Market data:');
    expect(out).toContain('SPY');
  });

  it('emits a stable "none" placeholder when data is null', () => {
    const out = formatToolContext({ 'Market data': null });
    expect(out).toContain('Market data:');
    expect(out).toContain('none');
  });

  it('truncates each section independently at MAX_SECTION_BYTES', () => {
    const bigString = 'x'.repeat(MAX_SECTION_BYTES + 500);
    const out = formatToolContext({ 'Big': { blob: bigString } });
    expect(out).toContain('[truncated]');
    const bigSection = out.split('Big:')[1] ?? '';
    expect(bigSection.length).toBeLessThanOrEqual(MAX_SECTION_BYTES + 100);
  });

  it('preserves order of sections as passed', () => {
    const out = formatToolContext({ A: 1, B: 2, C: 3 });
    expect(out.indexOf('A:')).toBeLessThan(out.indexOf('B:'));
    expect(out.indexOf('B:')).toBeLessThan(out.indexOf('C:'));
  });
});
