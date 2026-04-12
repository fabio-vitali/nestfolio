import { SSMClient, GetParameterCommand, PutParameterCommand } from '@aws-sdk/client-ssm';
import type { TestContext } from '@nestfolio/test-support';

export class SsmOverrideFixture {
  private readonly client: SSMClient;
  private readonly ctx: TestContext;
  private paramName?: string;
  private originalValue?: string;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new SSMClient({ region: ctx.region });
  }

  async override(params: {
    paramName: string;
    testValue: string;
    waitMs?: number;
  }): Promise<void> {
    this.paramName = params.paramName;

    // Save current value
    const current = await this.client.send(new GetParameterCommand({
      Name: params.paramName,
    }));
    this.originalValue = current.Parameter?.Value;

    // Overwrite with test value
    await this.client.send(new PutParameterCommand({
      Name: params.paramName,
      Value: params.testValue,
      Type: 'String',
      Overwrite: true,
    }));

    // Wait for parameterStoreTtl expiry
    const waitMs = params.waitMs ?? 6_000;
    await new Promise(resolve => setTimeout(resolve, waitMs));

    // Register cleanup
    this.ctx.cleanup.register('SsmOverrideFixture', () => this.restore());
  }

  async restore(): Promise<void> {
    if (!this.paramName || !this.originalValue) return;
    try {
      await this.client.send(new PutParameterCommand({
        Name: this.paramName,
        Value: this.originalValue,
        Type: 'String',
        Overwrite: true,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('SsmOverrideFixture: failed to restore SSM value', err);
    }
  }
}
