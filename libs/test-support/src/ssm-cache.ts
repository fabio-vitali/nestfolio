import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { CloudFormationClient, ListStackResourcesCommand } from '@aws-sdk/client-cloudformation';
import { createTestAwsClient } from './aws-client-config';

export class SsmCache {
  private readonly client: SSMClient;
  private readonly cfn: CloudFormationClient;
  private readonly cache = new Map<string, string>();
  private readonly prefix: string;

  constructor(prefix: string, region: string) {
    this.prefix = prefix;
    this.client = createTestAwsClient(SSMClient, region);
    this.cfn = createTestAwsClient(CloudFormationClient, region);
  }

  destroy(): void {
    this.client.destroy();
    this.cfn.destroy();
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

  /** Table name: looks up DynamoDB table from CloudFormation stack resources */
  async tableName(service: string): Promise<string> {
    const cacheKey = `table:${service}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const stackName = `${this.prefix}-${service}`;
    const result = await this.cfn.send(new ListStackResourcesCommand({ StackName: stackName }));
    const table = result.StackResourceSummaries?.find(
      r => r.ResourceType === 'AWS::DynamoDB::Table',
    );
    if (!table?.PhysicalResourceId) {
      throw new Error(`DynamoDB table not found in stack ${stackName}`);
    }
    this.cache.set(cacheKey, table.PhysicalResourceId);
    return table.PhysicalResourceId;
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

  /** CloudFront distribution URL for investor-web (subsystem-scoped):
   * /nestfolio/{prefix}-investor/web/distributionUrl */
  async investorWebDistributionUrl(): Promise<string> {
    return this.get(`/nestfolio/${this.prefix}-investor/web/distributionUrl`);
  }
}
