import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import { createTestAwsClient, type TestContext } from '@nestfolio/test-support';

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
    this.client = createTestAwsClient(SSMClient, ctx.region);
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

  /**
   * Like override(), but derives restoreTo by reading the canonical SSM value
   * (after a .backup-driven crash recovery step). Use this when the canonical
   * value is dynamic (e.g. an ARN minted by CDK) — pass expectedRestorePrefix
   * to validate the canonical is well-formed.
   *
   * Crash-recovery: if ${paramName}.backup exists from a prior crashed run,
   * its value is used to repair the canonical AND becomes restoreTo (the
   * presence of .backup is treated as authoritative — canonical could have
   * been corrupted by the crashed run).
   */
  async overrideAndDeriveRestore(params: {
    paramName: string;
    testValue: string;
    /** Required: prefix the canonical value MUST start with (e.g. 'arn:'). */
    expectedRestorePrefix: string;
    waitMs?: number;
  }): Promise<void> {
    this.paramName = params.paramName;
    this.backupParamName = `${params.paramName}.backup`;

    const backupExists = await this.paramExists(this.backupParamName);

    let restoreTo: string;
    if (backupExists) {
      // Recovery path — a prior run crashed mid-override. .backup is the truth.
      const backupResult = await this.client.send(new GetParameterCommand({
        Name: this.backupParamName,
      }));
      const backupValue = backupResult.Parameter?.Value;
      if (!backupValue || !backupValue.startsWith(params.expectedRestorePrefix)) {
        // Read live canonical too so the error message has full state
        let liveCanonical: string | undefined;
        try {
          const live = await this.client.send(new GetParameterCommand({
            Name: params.paramName,
          }));
          liveCanonical = live.Parameter?.Value;
        } catch {
          // ignore — surface what we have
        }
        throw new Error(
          `SsmOverrideFixture: refusing to recover ${params.paramName} — ` +
          `.backup value '${backupValue}' does not start with '${params.expectedRestorePrefix}', ` +
          `and live canonical is '${liveCanonical}'. ` +
          `Both values are corrupt; restore manually before re-running tests: ` +
          `aws ssm put-parameter --name '${params.paramName}' --value '<canonical>' --type String --overwrite && ` +
          `aws ssm delete-parameter --name '${this.backupParamName}'`,
        );
      }
      restoreTo = backupValue;
      // Repair canonical from .backup (canonical may currently hold a stale mock URL)
      await this.client.send(new PutParameterCommand({
        Name: params.paramName,
        Value: backupValue,
        Type: 'String',
        Overwrite: true,
      }));
      // Leave .backup in place — the standard override path below will reuse it
      // (backupExists branch skips re-writing .backup).
    } else {
      // No .backup — derive restoreTo from canonical
      const canonical = await this.client.send(new GetParameterCommand({
        Name: params.paramName,
      }));
      const canonicalValue = canonical.Parameter?.Value;
      if (!canonicalValue || !canonicalValue.startsWith(params.expectedRestorePrefix)) {
        throw new Error(
          `SsmOverrideFixture: expected canonical SSM value for ${params.paramName} ` +
          `to start with '${params.expectedRestorePrefix}', got: '${canonicalValue}'. ` +
          `Stack may not be deployed, or a prior test run left a non-canonical value behind. ` +
          `Re-deploy the relevant stack before re-running integration tests.`,
        );
      }
      restoreTo = canonicalValue;
      // Write .backup from validated canonical
      await this.client.send(new PutParameterCommand({
        Name: this.backupParamName,
        Value: restoreTo,
        Type: 'String',
        Overwrite: true,
      }));
    }

    this.restoreTo = restoreTo;

    // Write testValue over canonical
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
    try {
      if (!this.paramName || !this.backupParamName || !this.restoreTo) return;
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
    } finally {
      this.client.destroy();
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
