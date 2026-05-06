import { formatStructuredOutputPrompt } from '../src/format-prompt';

describe('formatStructuredOutputPrompt', () => {
  const baseSpec = {
    role: 'test agent',
    task: 'do the test thing',
    schemaShape: '{\n  "field": "string"\n}',
    rules: ['rule one', 'rule two'],
  };

  it('emits the literal section markers', () => {
    const out = formatStructuredOutputPrompt(baseSpec);
    expect(out).toContain('ROLE: test agent');
    expect(out).toContain('TASK: do the test thing');
    expect(out).toContain('SCHEMA SHAPE');
    expect(out).toContain('RULES:');
    expect(out).toContain('Input: {input}');
  });

  it('omits the EXAMPLES block when no examples are provided', () => {
    const out = formatStructuredOutputPrompt(baseSpec);
    expect(out).not.toContain('EXAMPLES:');
  });

  it('renders an EXAMPLES block when examples are provided', () => {
    const out = formatStructuredOutputPrompt({
      ...baseSpec,
      examples: ['example A', 'example B'],
    });
    expect(out).toContain('EXAMPLES:\nexample A\nexample B');
  });

  it('emits the forbid-empty paragraph by default', () => {
    const out = formatStructuredOutputPrompt(baseSpec);
    expect(out).toContain('You MUST call the structured-output tool');
    expect(out).toContain('every required field above MUST be populated');
  });

  it('omits the forbid-empty paragraph when forbidEmpty=false', () => {
    const out = formatStructuredOutputPrompt({ ...baseSpec, forbidEmpty: false });
    expect(out).not.toContain('You MUST call the structured-output tool');
  });

  it('renders schemaShape verbatim — no JSON re-parsing', () => {
    const shape = '{\n  // a comment\n  "field": "string"\n}';
    const out = formatStructuredOutputPrompt({ ...baseSpec, schemaShape: shape });
    expect(out).toContain(shape);
  });

  it('joins rules with leading "- " on each line', () => {
    const out = formatStructuredOutputPrompt(baseSpec);
    expect(out).toContain('RULES:\n- rule one\n- rule two');
  });

  it('places Input: {input} as the final marker', () => {
    const out = formatStructuredOutputPrompt(baseSpec);
    expect(out.endsWith('Input: {input}')).toBe(true);
  });
});
