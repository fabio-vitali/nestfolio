import { readFileSync } from 'fs';
import { AppSyncClient, EvaluateCodeCommand } from '@aws-sdk/client-appsync';

const client = new AppSyncClient({ region: process.env.AWS_REGION || 'us-east-1' });

export interface EvalContext {
  arguments?: Record<string, unknown>;
  identity?: {
    claims?: Record<string, string>;
    username?: string;
  };
  stash?: Record<string, unknown>;
  prev?: { result?: unknown };
  result?: unknown;
  error?: { message: string; type: string } | null;
  env?: Record<string, string>;
  info?: { fieldName?: string; parentTypeName?: string; selectionSetGraphQL?: string };
}

export async function evaluateResolver(
  codePath: string,
  fn: 'request' | 'response',
  ctx: EvalContext,
): Promise<unknown> {
  const code = readFileSync(codePath, 'utf-8');
  const result = await client.send(
    new EvaluateCodeCommand({
      runtime: { name: 'APPSYNC_JS', runtimeVersion: '1.0.0' },
      code,
      context: JSON.stringify(ctx),
      function: fn,
    }),
  );
  if (result.error) {
    return { __error: true, message: result.error.message, type: result.error.codeErrors?.[0]?.errorType };
  }
  return JSON.parse(result.evaluationResult!);
}

export function createAuthContext(
  tenantId: string,
  userId: string,
  overrides: Partial<EvalContext> = {},
): EvalContext {
  return {
    arguments: {},
    identity: {
      claims: { 'custom:tenant_id': tenantId, 'sub': userId },
      username: `${userId}@example.com`,
    },
    stash: {},
    prev: { result: null },
    result: null,
    error: null,
    ...overrides,
  };
}
