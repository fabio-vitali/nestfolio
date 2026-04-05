import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export class SsmCache {
  private readonly client: SSMClient;
  private readonly cache = new Map<string, string>();
  private readonly prefix: string;

  constructor(prefix: string, region: string) {
    this.prefix = prefix;
    this.client = new SSMClient({ region });
  }

  private async get(paramName: string): Promise<string> {
    const cached = this.cache.get(paramName);
    if (cached) return cached;

    const result = await this.client.send(new GetParameterCommand({ Name: paramName }));
    const value = result.Parameter?.Value;
    if (!value) throw new Error(`SSM parameter not found: ${paramName}`);

    this.cache.set(paramName, value);
    return value;
  }

  /** Bus ARN: /nestfolio/{prefix}-{subsystem}/event-hub/busArn */
  async busArn(subsystem: string): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-${subsystem}/event-hub/busArn`);
  }

  /** Table name: deterministic "{prefix}-{service}-table" — no SSM needed */
  tableName(service: string): string {
    return `${this.prefix}-${service}-table`;
  }

  /** GraphQL URL: /nestfolio/{prefix}-{service}/api/graphqlUrl */
  async graphqlUrl(service: string): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-${service}/api/graphqlUrl`);
  }

  /** Cognito User Pool ID: /nestfolio/{prefix}-investor/auth/userPoolId */
  async userPoolId(): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-investor/auth/userPoolId`);
  }

  /** Cognito Client ID: /nestfolio/{prefix}-investor/auth/userPoolClientId */
  async userPoolClientId(): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-investor/auth/userPoolClientId`);
  }
}
