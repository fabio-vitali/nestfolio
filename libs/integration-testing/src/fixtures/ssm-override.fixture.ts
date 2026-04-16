import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import type { TestContext } from '@nestfolio/test-support';

/**
 * Each instance handles exactly one SSM parameter override.
 * To override multiple params, create a separate SsmOverrideFixture per param.
 */
export class SsmOverrideFixture {
  private readonly client: SSMClient;
  private readonly ctx: TestContext;
  private paramName?: string;
  private backupParamName?: string;

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
    this.backupParamName = `${params.paramName}.backup`;

    // Check if .backup exists (crash recovery)
    const backupExists = await this.paramExists(this.backupParamName);

    if (!backupExists) {
      // First override — save current value to .backup
      const current = await this.client.send(new GetParameterCommand({
        Name: params.paramName,
      }));
      const originalValue = current.Parameter?.Value;
      if (originalValue) {
        await this.client.send(new PutParameterCommand({
          Name: this.backupParamName,
          Value: originalValue,
          Type: 'String',
          Overwrite: true,
        }));
      }
    }
    // If backupExists: previous run crashed. .backup already has the real value. Don't overwrite it.

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
    if (!this.paramName || !this.backupParamName) return;
    try {
      const backup = await this.client.send(new GetParameterCommand({
        Name: this.backupParamName,
      }));
      const originalValue = backup.Parameter?.Value;
      if (originalValue) {
        await this.client.send(new PutParameterCommand({
          Name: this.paramName,
          Value: originalValue,
          Type: 'String',
          Overwrite: true,
        }));
      }
      // Delete .backup — clean slate for next run
      await this.client.send(new DeleteParameterCommand({
        Name: this.backupParamName,
      }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('SsmOverrideFixture: failed to restore SSM value', err);
    }
  }

  private async paramExists(name: string): Promise<boolean> {
    try {
      await this.client.send(new GetParameterCommand({ Name: name }));
      return true;
    } catch {
      return false;
    }
  }
}
