import {
  LambdaClient, ListFunctionsCommand, DeleteFunctionCommand,
  DeleteFunctionUrlConfigCommand,
} from '@aws-sdk/client-lambda';
import {
  IAMClient, ListRolesCommand, DeleteRoleCommand,
  DetachRolePolicyCommand, ListAttachedRolePoliciesCommand,
} from '@aws-sdk/client-iam';
import {
  SQSClient, ListQueuesCommand, DeleteQueueCommand,
} from '@aws-sdk/client-sqs';
import {
  EventBridgeClient, ListRulesCommand, RemoveTargetsCommand,
  ListTargetsByRuleCommand, DeleteRuleCommand,
} from '@aws-sdk/client-eventbridge';
import { OrphanReaper } from '../../src/fixtures/orphan-reaper';

jest.mock('@aws-sdk/client-lambda', () => {
  const actual = jest.requireActual('@aws-sdk/client-lambda');
  return { ...actual, LambdaClient: jest.fn() };
});
jest.mock('@aws-sdk/client-iam', () => {
  const actual = jest.requireActual('@aws-sdk/client-iam');
  return { ...actual, IAMClient: jest.fn() };
});
jest.mock('@aws-sdk/client-sqs', () => {
  const actual = jest.requireActual('@aws-sdk/client-sqs');
  return { ...actual, SQSClient: jest.fn() };
});
jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return { ...actual, EventBridgeClient: jest.fn() };
});

const lambdaSend = jest.fn();
const iamSend = jest.fn();
const sqsSend = jest.fn();
const ebSend = jest.fn();

(LambdaClient as jest.Mock).mockImplementation(() => ({ send: lambdaSend }));
(IAMClient as jest.Mock).mockImplementation(() => ({ send: iamSend }));
(SQSClient as jest.Mock).mockImplementation(() => ({ send: sqsSend }));
(EventBridgeClient as jest.Mock).mockImplementation(() => ({ send: ebSend }));

const OLD_TIMESTAMP = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
const RECENT_TIMESTAMP = Date.now() - 10 * 60 * 1000;  // 10 minutes ago
const mockCtx = { region: 'us-east-1', prefix: 'dev' } as any;

describe('OrphanReaper', () => {
  beforeEach(() => {
    lambdaSend.mockReset();
    iamSend.mockReset();
    sqsSend.mockReset();
    ebSend.mockReset();
  });

  it('should delete old integ-mock-* Lambda functions', async () => {
    lambdaSend.mockResolvedValueOnce({
      Functions: [
        { FunctionName: 'integ-mock-alpaca-' + OLD_TIMESTAMP, LastModified: new Date(OLD_TIMESTAMP).toISOString() },
        { FunctionName: 'integ-mock-agent-' + RECENT_TIMESTAMP, LastModified: new Date(RECENT_TIMESTAMP).toISOString() },
        { FunctionName: 'production-fn', LastModified: new Date().toISOString() },
      ],
    });
    lambdaSend.mockResolvedValue({}); // DeleteFunctionUrlConfig + DeleteFunction
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });
    ebSend.mockResolvedValue({ Rules: [] }); // 4 buses × ListRules

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const deleteCallNames = lambdaSend.mock.calls
      .filter(c => c[0] instanceof DeleteFunctionCommand)
      .map(c => c[0].input.FunctionName);
    expect(deleteCallNames).toEqual(['integ-mock-alpaca-' + OLD_TIMESTAMP]);
  });

  it('should iterate all 4 domain buses for EB rules', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({ QueueUrls: [] });
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const listRuleCalls = ebSend.mock.calls.filter(c => c[0] instanceof ListRulesCommand);
    expect(listRuleCalls).toHaveLength(4);
    const busNames = listRuleCalls.map(c => c[0].input.EventBusName);
    expect(busNames).toEqual(['dev-advisory', 'dev-investor', 'dev-execution', 'dev-ledger']);
  });

  it('should delete old SQS queues matching integ-trap-{timestamp} pattern', async () => {
    lambdaSend.mockResolvedValueOnce({ Functions: [] });
    iamSend.mockResolvedValueOnce({ Roles: [] });
    sqsSend.mockResolvedValueOnce({
      QueueUrls: [
        `https://sqs.us-east-1.amazonaws.com/123/integ-trap-${OLD_TIMESTAMP}-abc123`,
        `https://sqs.us-east-1.amazonaws.com/123/integ-trap-${RECENT_TIMESTAMP}-def456`,
      ],
    });
    sqsSend.mockResolvedValue({}); // DeleteQueue
    ebSend.mockResolvedValue({ Rules: [] });

    const reaper = new OrphanReaper(mockCtx);
    await reaper.cleanup();

    const deleteCalls = sqsSend.mock.calls.filter(c => c[0] instanceof DeleteQueueCommand);
    expect(deleteCalls).toHaveLength(1); // Only old one
  });

  it('should not throw when cleanup encounters errors', async () => {
    lambdaSend.mockRejectedValue(new Error('AccessDenied'));
    iamSend.mockRejectedValue(new Error('AccessDenied'));
    sqsSend.mockRejectedValue(new Error('AccessDenied'));
    ebSend.mockRejectedValue(new Error('AccessDenied'));

    const reaper = new OrphanReaper(mockCtx);
    await expect(reaper.cleanup()).resolves.not.toThrow();
  });
});
