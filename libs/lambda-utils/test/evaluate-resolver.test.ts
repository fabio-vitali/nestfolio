import { join } from 'path';
import { evaluateResolver, createAuthContext } from '../src/test-utils/evaluate-resolver';

// Skip in CI if no AWS credentials
const describeWithAws = process.env.AWS_ACCESS_KEY_ID ? describe : describe.skip;

describeWithAws('evaluateResolver', () => {
  const fixturePath = join(__dirname, 'fixtures', 'echo.fn.js');

  beforeAll(() => {
    const { writeFileSync, mkdirSync } = require('fs');
    mkdirSync(join(__dirname, 'fixtures'), { recursive: true });
    writeFileSync(fixturePath, `
      export function request(ctx) { return { value: ctx.arguments.input }; }
      export function response(ctx) { return ctx.result; }
    `);
  });

  it('evaluates request function', async () => {
    const ctx = createAuthContext('t1', 'u1', { arguments: { input: 'hello' } });
    const result = await evaluateResolver(fixturePath, 'request', ctx);
    expect(result).toEqual({ value: 'hello' });
  });
});
