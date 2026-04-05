import type { IntegrationContext } from '../context';
import type { CognitoTokens } from './cognito.fixture';

export class AppSyncClient {
  private readonly graphqlUrl: Promise<string>;
  private readonly idToken: string;

  constructor(ctx: IntegrationContext, tokens: CognitoTokens) {
    this.graphqlUrl = ctx.ssm.graphqlUrl('investor-bff');
    this.idToken = tokens.idToken;
  }

  async query<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.execute<T>(operation, variables);
  }

  async mutate<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
    return this.execute<T>(operation, variables);
  }

  private async execute<T>(operation: string, variables?: Record<string, unknown>): Promise<T> {
    const url = await this.graphqlUrl;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.idToken,
      },
      body: JSON.stringify({ query: operation, variables }),
    });

    const json = await response.json() as { data?: T; errors?: unknown[] };
    if (json.errors?.length) {
      throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    return json.data as T;
  }
}
