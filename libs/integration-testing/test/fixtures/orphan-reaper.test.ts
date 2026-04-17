import {
  LambdaClient, ListFunctionsCommand, DeleteFunctionCommand,
} from '@aws-sdk/client-lambda';
import {
  IAMClient, ListRolesCommand, DeleteRoleCommand,
  DetachRolePolicyCommand,
} from '@aws-sdk/client-iam';
import {
  SQSClient, ListQueuesCommand, DeleteQueueCommand,
} from '@aws-sdk/client-sqs';
import {
  EventBridgeClient, ListRulesCommand, RemoveTargetsCommand,
  DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { OrphanReaper } from '../../src/fixtures/orphan-reaper';

// Stub `send` on each real client's prototype. Real instances pass smithy's
// `client instanceof ClientCtor` paginator check (createPaginator.js:17), which
// jest.mock-replaced classes don't, while still routing every call through our spies.
const lambdaSend = jest.fn();
const iamSend = jest.fn();
const sqsSend = jest.fn();
const ebSend = jest.fn();

LambdaClient.prototype.send = lambdaSend as never;
IAMClient.prototype.send = iamSend as never;
SQSClient.prototype.send = sqsSend as never;
EventBridgeClient.prototype.send = ebSend as never;

const OLD_TIMESTAMP = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
const RECENT_TIMESTAMP = Date.now() - 10 * 60 * 1000;  // 10 minutes ago
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCtx = { region: 'us-east-1', prefix: 'dev' } as any;

describe('OrphanReaper', () => {
  beforeEach(() => {
    lambdaSend.mockReset();
    iamSend.mockReset();
    sqsSend.mockReset();
    ebSend.mockReset();
  });

  it('paginates ListFunctions and deletes only old integ-mock-* across all pages', async () => {
    // Page 1: only dev-* functions (orphan would be missed without pagination)
    lambdaSend.mockImplementationOnce((cmd) => {
      if (cmd instanceof ListFunctionsCommand) {
        return Promise.resolve({
          Functions: [
            { FunctionName: 'dev-some-service', LastModified: new Date().toISOString() },
          ],
          NextMarker: 'page2',
        });
      }
      return Promise.resolve({});
    });
    // Page 2: the orphan integ-mock that pagination must reach
    lambdaSend.mockImplementationOnce((cmd) => {
      if (cmd instanceof ListFunctionsCommand) {
        return Promise.resolve({
          Functions: [
            { FunctionName: 'integ-mock-alpaca-' + OLD_TIMESTAMP, LastModified: new Date(OLD_TIMESTAMP).toISOString() },
            { FunctionName: 'integ-mock-agent-' + RECENT_TIMESTAMP, LastModified: new Date(RECENT_TIMESTAMP).toISOString() },
          ],
        });
      }
      return Promise.resolve({});
    });
    // Subsequent calls (DeleteFunctionUrlConfig + DeleteFunction) → ok
    lambdaSend.mockResolvedValue({});
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    // Confirm pagination triggered: 2 ListFunctions calls
    const listCalls = lambdaSend.mock.calls.filter(c => c[0] instanceof ListFunctionsCommand);
    expect(listCalls).toHaveLength(2);

    // Only the OLD orphan was deleted (recent one is skipped)
    const deleteCallNames = lambdaSend.mock.calls
      .filter(c => c[0] instanceof DeleteFunctionCommand)
      .map(c => c[0].input.FunctionName);
    expect(deleteCallNames).toEqual(['integ-mock-alpaca-' + OLD_TIMESTAMP]);
  });

  it('iterates all 4 domain buses with -event-bus suffix for EB rule cleanup', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const listRuleCalls = ebSend.mock.calls.filter(c => c[0] instanceof ListRulesCommand);
    expect(listRuleCalls).toHaveLength(4);
    const busNames = listRuleCalls.map(c => c[0].input.EventBusName);
    expect(busNames).toEqual([
      'dev-advisory-event-bus',
      'dev-investor-event-bus',
      'dev-execution-event-bus',
      'dev-ledger-event-bus',
    ]);
  });

  it('paginates ListQueues and deletes only old integ-trap-{ts}-* queues', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    iamSend.mockResolvedValueOnce({ Roles: [] });
    // Page 1
    sqsSend.mockImplementationOnce((cmd) => {
      if (cmd instanceof ListQueuesCommand) {
        return Promise.resolve({
          QueueUrls: [`https://sqs.us-east-1.amazonaws.com/123/integ-trap-${OLD_TIMESTAMP}-abc`],
          NextToken: 'page2',
        });
      }
      return Promise.resolve({});
    });
    // Page 2
    sqsSend.mockImplementationOnce((cmd) => {
      if (cmd instanceof ListQueuesCommand) {
        return Promise.resolve({
          QueueUrls: [`https://sqs.us-east-1.amazonaws.com/123/integ-trap-${RECENT_TIMESTAMP}-def`],
        });
      }
      return Promise.resolve({});
    });
    sqsSend.mockResolvedValue({}); // DeleteQueue
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const listCalls = sqsSend.mock.calls.filter(c => c[0] instanceof ListQueuesCommand);
    expect(listCalls).toHaveLength(2);
    const deleteCalls = sqsSend.mock.calls.filter(c => c[0] instanceof DeleteQueueCommand);
    expect(deleteCalls).toHaveLength(1);
  });

  it('paginates ListRoles and deletes old integ-mock-* roles', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    // Page 1: only non-matching roles
    iamSend.mockImplementationOnce((cmd) => {
      if (cmd instanceof ListRolesCommand) {
        return Promise.resolve({
          Roles: [{ RoleName: 'unrelated-role', CreateDate: new Date() }],
          Marker: 'page2',
        });
      }
      return Promise.resolve({});
    });
    // Page 2: the orphan
    iamSend.mockImplementationOnce((cmd) => {
      if (cmd instanceof ListRolesCommand) {
        return Promise.resolve({
          Roles: [{ RoleName: 'integ-mock-alpaca-' + OLD_TIMESTAMP, CreateDate: new Date(OLD_TIMESTAMP) }],
        });
      }
      return Promise.resolve({});
    });
    // ListAttachedRolePolicies → one policy
    iamSend.mockResolvedValueOnce({ AttachedPolicies: [{ PolicyArn: 'arn:aws:iam::aws:policy/X' }] });
    iamSend.mockResolvedValue({});
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const detachCalls = iamSend.mock.calls.filter(c => c[0] instanceof DetachRolePolicyCommand);
    const deleteCalls = iamSend.mock.calls.filter(c => c[0] instanceof DeleteRoleCommand);
    expect(detachCalls).toHaveLength(1);
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][0].input.RoleName).toBe('integ-mock-alpaca-' + OLD_TIMESTAMP);
  });

  it('does not throw when cleanup encounters errors', async () => {
    lambdaSend.mockRejectedValue(new Error('AccessDenied'));
    iamSend.mockRejectedValue(new Error('AccessDenied'));
    sqsSend.mockRejectedValue(new Error('AccessDenied'));
    ebSend.mockRejectedValue(new Error('AccessDenied'));

    const reaper = new OrphanReaper(mockCtx);
    await expect(reaper.cleanup()).resolves.not.toThrow();
  });

  it('targets EB rules for removal before deleting them', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });
    // First bus has an old rule with one target
    ebSend.mockImplementationOnce((cmd) => {
      if (cmd instanceof ListRulesCommand) {
        return Promise.resolve({
          Rules: [{ Name: `integ-trap-${OLD_TIMESTAMP}-abc` }],
        });
      }
      return Promise.resolve({});
    });
    ebSend.mockResolvedValueOnce({ Targets: [{ Id: 't1' }] });
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const removeTargetCalls = ebSend.mock.calls.filter(c => c[0] instanceof RemoveTargetsCommand);
    const deleteRuleCalls = ebSend.mock.calls.filter(c => c[0] instanceof DeleteRuleCommand);
    expect(removeTargetCalls).toHaveLength(1);
    expect(deleteRuleCalls).toHaveLength(1);
  });
});
