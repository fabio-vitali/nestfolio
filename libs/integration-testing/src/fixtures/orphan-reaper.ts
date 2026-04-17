import {
  LambdaClient, paginateListFunctions, DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
} from '@aws-sdk/client-lambda';
import {
  IAMClient, paginateListRoles, DeleteRoleCommand,
  DetachRolePolicyCommand, ListAttachedRolePoliciesCommand,
} from '@aws-sdk/client-iam';
import {
  SQSClient, paginateListQueues, DeleteQueueCommand,
} from '@aws-sdk/client-sqs';
import {
  EventBridgeClient, ListRulesCommand, RemoveTargetsCommand,
  ListTargetsByRuleCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import type { TestContext } from '@nestfolio/test-support';

const ONE_HOUR_MS = 60 * 60 * 1000;
const DOMAIN_BUSES = ['advisory', 'investor', 'execution', 'ledger'];

export class OrphanReaper {
  private readonly region: string;
  private readonly prefix: string;

  constructor(ctx: TestContext) {
    this.region = ctx.region;
    this.prefix = ctx.prefix;
  }

  // All List* calls use AWS SDK v3 paginators so reaper sees every integ-* resource
  // regardless of where it lands in alphabetical order vs. account-wide page boundaries.
  async cleanup(): Promise<void> {
    await Promise.allSettled([
      this.reapLambdas(),
      this.reapIamRoles(),
      this.reapSqsQueues(),
    ]);
    await this.reapEventBridgeRules().catch(err =>
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: EB rule cleanup failed', err),
    );
  }

  private async reapLambdas(): Promise<void> {
    const lambda = new LambdaClient({ region: this.region });
    try {
      const cutoff = Date.now() - ONE_HOUR_MS;
      for await (const page of paginateListFunctions({ client: lambda }, {})) {
        for (const fn of page.Functions ?? []) {
          if (!fn.FunctionName?.startsWith('integ-mock-')) continue;
          const modified = new Date(fn.LastModified ?? 0).getTime();
          if (modified > cutoff) continue;

          try {
            await lambda.send(new DeleteFunctionUrlConfigCommand({ FunctionName: fn.FunctionName }));
          } catch { /* may not have URL config */ }
          await lambda.send(new DeleteFunctionCommand({ FunctionName: fn.FunctionName }));
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: Lambda cleanup failed', err);
    }
  }

  private async reapIamRoles(): Promise<void> {
    const iam = new IAMClient({ region: this.region });
    try {
      const cutoff = Date.now() - ONE_HOUR_MS;
      for await (const page of paginateListRoles({ client: iam }, {})) {
        for (const role of page.Roles ?? []) {
          if (!role.RoleName?.startsWith('integ-mock-')) continue;
          const created = new Date(role.CreateDate ?? 0).getTime();
          if (created > cutoff) continue;

          const policies = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: role.RoleName }));
          for (const policy of policies.AttachedPolicies ?? []) {
            await iam.send(new DetachRolePolicyCommand({
              RoleName: role.RoleName,
              PolicyArn: policy.PolicyArn,
            }));
          }
          await iam.send(new DeleteRoleCommand({ RoleName: role.RoleName }));
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: IAM role cleanup failed', err);
    }
  }

  private async reapSqsQueues(): Promise<void> {
    const sqs = new SQSClient({ region: this.region });
    try {
      const cutoff = Date.now() - ONE_HOUR_MS;
      for await (const page of paginateListQueues({ client: sqs }, { QueueNamePrefix: 'integ-trap-' })) {
        for (const url of page.QueueUrls ?? []) {
          const name = url.split('/').pop() ?? '';
          const match = name.match(/^integ-trap-(\d+)-/);
          if (!match) continue;
          const created = Number(match[1]);
          if (created > cutoff) continue;

          await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: SQS queue cleanup failed', err);
    }
  }

  private async reapEventBridgeRules(): Promise<void> {
    const eb = new EventBridgeClient({ region: this.region });
    try {
      const cutoff = Date.now() - ONE_HOUR_MS;

      for (const domain of DOMAIN_BUSES) {
        const busName = `${this.prefix}-${domain}-event-bus`;
        // @aws-sdk/client-eventbridge does not ship a ListRules paginator helper, so loop manually on NextToken.
        let nextToken: string | undefined;
        do {
          const page = await eb.send(new ListRulesCommand({
            NamePrefix: 'integ-trap-',
            EventBusName: busName,
            NextToken: nextToken,
          }));
          for (const rule of page.Rules ?? []) {
            if (!rule.Name) continue;
            const match = rule.Name.match(/^integ-trap-(\d+)-/);
            if (!match) continue;
            const created = Number(match[1]);
            if (created > cutoff) continue;

            const targets = await eb.send(new ListTargetsByRuleCommand({
              Rule: rule.Name,
              EventBusName: busName,
            }));
            const targetIds = (targets.Targets ?? []).map(t => t.Id!).filter(Boolean);
            if (targetIds.length > 0) {
              await eb.send(new RemoveTargetsCommand({
                Rule: rule.Name,
                EventBusName: busName,
                Ids: targetIds,
              }));
            }
            await eb.send(new DeleteRuleCommand({
              Name: rule.Name,
              EventBusName: busName,
            }));
          }
          nextToken = page.NextToken;
        } while (nextToken);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OrphanReaper: EB rule cleanup failed', err);
    }
  }
}
