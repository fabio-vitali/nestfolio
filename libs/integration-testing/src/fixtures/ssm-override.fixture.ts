import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import type { TestContext } from '@nestfolio/test-support';

/**
 * Each instance handles exactly one SSM parameter override.
 * To override multiple params, create a separate SsmOverrideFixture per param.
 *
 * Caller MUST pass `restoreTo`: the canonical production value to put back on
 * cleanup. The fixture writes that value (not whatever it reads from SSM) into
 * `.backup`, so corruption from prior bugs cannot self-perpetuate.
 *
 * On first run (no `.backup`), the current SSM value MUST equal `restoreTo` —
 * otherwise the param has already been corrupted (e.g. a previous test crashed
 * under an older fixture that left a mock URL in place). The fixture refuses to
 * proceed, surfacing the corruption to the caller instead of immortalizing it.
 */
export class SsmOverrideFixture {
  private readonly client: SSMClient;
  private readonly ctx: TestContext;
  private paramName?: string;
  private backupParamName?: string;
  private restoreTo?: string;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.client = new SSMClient({ region: ctx.region });
  }

  async override(params: {
    paramName: string;
    testValue: string;
    /** Canonical production value to restore on cleanup. Required — no implicit "current value as truth". */
    restoreTo: string;
    waitMs?: number;
  }): Promise<void> {
    this.paramName = params.paramName;
    this.backupParamName = `${params.paramName}.backup`;
    this.restoreTo = params.restoreTo;

    const backupExists = await this.paramExists(this.backupParamName);

    if (!backupExists) {
      // First override — verify current value matches the expected canonical value
      // before saving anything to .backup. This catches corruption from prior runs
      // (e.g. an older fixture left a mock URL behind) instead of perpetuating it.
      const current = await this.client.send(new GetParameterCommand({
        Name: params.paramName,
      }));
      const currentValue = current.Parameter?.Value;
      if (currentValue !== params.restoreTo) {
        throw new Error(
          `SsmOverrideFixture: refusing to back up ${params.paramName} — ` +
          `expected restoreTo='${params.restoreTo}' but current value is '${currentValue}'. ` +
          `The parameter is likely corrupted from a prior failed test. ` +
          `Restore manually before running tests: ` +
          `aws ssm put-parameter --name '${params.paramName}' --value '${params.restoreTo}' --type String --overwrite`,
        );
      }
      // Save the canonical value (not the live read) — this is the value restore() will put back.
      await this.client.send(new PutParameterCommand({
        Name: this.backupParamName,
        Value: params.restoreTo,
        Type: 'String',
        Overwrite: true,
      }));
    }
    // If backupExists: previous run crashed mid-override. .backup already holds the
    // canonical value from that run's `restoreTo` — leave it untouched.

    await this.client.send(new PutParameterCommand({
      Name: params.paramName,
      Value: params.testValue,
      Type: 'String',
      Overwrite: true,
    }));

    // Wait for parameterStoreTtl expiry
    const waitMs = params.waitMs ?? 6_000;
    await new Promise(resolve => setTimeout(resolve, waitMs));

    this.ctx.cleanup.register('SsmOverrideFixture', () => this.restore());
  }

  async restore(): Promise<void> {
    if (!this.paramName || !this.backupParamName || !this.restoreTo) return;
    try {
      // Always restore to the caller-provided canonical value. We pass it through
      // memory rather than reading from .backup so a corrupted .backup cannot
      // re-poison the live parameter.
      await this.client.send(new PutParameterCommand({
        Name: this.paramName,
        Value: this.restoreTo,
        Type: 'String',
        Overwrite: true,
      }));
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
