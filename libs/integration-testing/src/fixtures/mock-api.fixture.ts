import {
  IAMClient, CreateRoleCommand, DeleteRoleCommand,
  AttachRolePolicyCommand, DetachRolePolicyCommand,
} from '@aws-sdk/client-iam';
import {
  LambdaClient, CreateFunctionCommand, DeleteFunctionCommand,
  GetFunctionConfigurationCommand, CreateFunctionUrlConfigCommand,
  DeleteFunctionUrlConfigCommand, AddPermissionCommand,
} from '@aws-sdk/client-lambda';
import type { TestContext } from '@nestfolio/test-support';

const BASIC_EXECUTION_POLICY = 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole';

export class MockApiFixture {
  private readonly iam: IAMClient;
  private readonly lambda: LambdaClient;
  private readonly ctx: TestContext;

  private roleName?: string;
  private roleArn?: string;
  private functionName?: string;

  constructor(ctx: TestContext) {
    this.ctx = ctx;
    this.iam = new IAMClient({ region: ctx.region });
    this.lambda = new LambdaClient({ region: ctx.region });
  }

  async deploy(params: {
    name: string;
    handlerAsset: Buffer;
  }): Promise<string> {
    const timestamp = Date.now();
    this.roleName = `integ-mock-${params.name}-${timestamp}`;
    this.functionName = `integ-mock-${params.name}-${timestamp}`;

    // Create IAM role
    const assumeRolePolicy = JSON.stringify({
      Version: '2012-10-17',
      Statement: [{
        Effect: 'Allow',
        Principal: { Service: 'lambda.amazonaws.com' },
        Action: 'sts:AssumeRole',
      }],
    });

    const roleResult = await this.iam.send(new CreateRoleCommand({
      RoleName: this.roleName,
      AssumeRolePolicyDocument: assumeRolePolicy,
    }));
    this.roleArn = roleResult.Role!.Arn!;

    await this.iam.send(new AttachRolePolicyCommand({
      RoleName: this.roleName,
      PolicyArn: BASIC_EXECUTION_POLICY,
    }));

    // Create Lambda (retry on IAM propagation)
    let attempts = 0;
    while (attempts < 5) {
      try {
        await this.lambda.send(new CreateFunctionCommand({
          FunctionName: this.functionName,
          Runtime: 'nodejs24.x',
          Handler: 'index.handler',
          Role: this.roleArn,
          Code: { ZipFile: params.handlerAsset },
          Timeout: 30,
          MemorySize: 128,
        }));
        break;
      } catch (err: unknown) {
        const errName = (err as { name?: string }).name;
        if (errName === 'InvalidParameterValueException' && attempts < 4) {
          attempts++;
          await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          continue;
        }
        throw err;
      }
    }

    // Wait for Active state
    let state = '';
    while (state !== 'Active') {
      const config = await this.lambda.send(new GetFunctionConfigurationCommand({
        FunctionName: this.functionName,
      }));
      state = config.State ?? '';
      if (state !== 'Active') {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Create Function URL
    const urlResult = await this.lambda.send(new CreateFunctionUrlConfigCommand({
      FunctionName: this.functionName,
      AuthType: 'NONE',
    }));

    // Add public invoke permissions (both are required for NONE auth)
    await this.lambda.send(new AddPermissionCommand({
      FunctionName: this.functionName,
      StatementId: 'FunctionURLAllowPublicAccess',
      Action: 'lambda:InvokeFunctionUrl',
      Principal: '*',
      FunctionUrlAuthType: 'NONE',
    }));
    await this.lambda.send(new AddPermissionCommand({
      FunctionName: this.functionName,
      StatementId: 'FunctionInvokeAllowPublicAccess',
      Action: 'lambda:InvokeFunction',
      Principal: '*',
    }));

    // Register cleanup
    this.ctx.cleanup.register('MockApiFixture', () => this.teardown());

    return urlResult.FunctionUrl!.replace(/\/+$/, '');
  }

  async teardown(): Promise<void> {
    try {
      if (this.functionName) {
        try {
          await this.lambda.send(new DeleteFunctionUrlConfigCommand({
            FunctionName: this.functionName,
          }));
        } catch { /* may not exist */ }
        await this.lambda.send(new DeleteFunctionCommand({
          FunctionName: this.functionName,
        }));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('MockApiFixture: failed to delete Lambda', err);
    }
    try {
      if (this.roleName) {
        await this.iam.send(new DetachRolePolicyCommand({
          RoleName: this.roleName,
          PolicyArn: BASIC_EXECUTION_POLICY,
        }));
        await this.iam.send(new DeleteRoleCommand({ RoleName: this.roleName }));
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('MockApiFixture: failed to delete IAM role', err);
    }
    this.lambda.destroy();
    this.iam.destroy();
  }
}
