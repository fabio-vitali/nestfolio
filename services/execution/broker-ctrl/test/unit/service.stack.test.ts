/* eslint-disable @typescript-eslint/no-explicit-any */
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BrokerCtrlStack } from '../../src/service.stack';

describe('BrokerCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new BrokerCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'broker-ctrl',
      subsystem: 'execution',
    });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates one Step Functions state machine (order)', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
  });

  it('creates the order state machine with expected states', () => {
    // DefinitionString is a Fn::Join token, so we inspect the raw resource
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const definitions = Object.values(stateMachines).map((sm: any) => {
      const defStr = sm.Properties?.DefinitionString;
      // Fn::Join produces ["", [...parts...]] — state names are literal string fragments
      if (defStr?.['Fn::Join']) {
        return defStr['Fn::Join'][1].join('');
      }
      return typeof defStr === 'string' ? defStr : JSON.stringify(defStr);
    });
    const orderSM = definitions.find((d: string) =>
      d.includes('ReadExecutionMode'),
    );
    expect(orderSM).toBeDefined();
  });

  it('creates an EventBridge rule for ORDER_SUBMITTED trigger', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': ['ORDER_SUBMITTED'],
      }),
    });
  });

  it('creates SQS queues for four Ingresses + DLQs', () => {
    // 4 ingress queues + 4 ingress DLQs + 1 egress DLQ = at least 9
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(9);
  });

  it('creates Lambda functions for all handlers and CDC publisher', () => {
    // RouteOrderFn + ModeIngress handler + CallbackIngress handler +
    // DepositWithdrawalIngress handler + DepositWithdrawalNormalizerIngress handler +
    // Egress event-publisher = at least 6
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(6);
  });

  it('grants SFN task response to the callback ingress handler', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = allStatements.flatMap((s: any) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('states:SendTaskSuccess');
  });

  it('creates EventBridge rules for inbound callback event types', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const allPatterns = Object.values(rules).map(
      (r: any) => r.Properties?.EventPattern,
    );
    const allDetailTypes = allPatterns.flatMap(
      (p: any) => (p?.['detail-type'] ?? []),
    );
    expect(allDetailTypes).toContain('SIM_ORDER_FILLED');
    expect(allDetailTypes).toContain('ALPACA_ORDER_FILLED');
  });

  it('subscribes the renamed WITHDRAWAL_INITIATED intent (not WITHDRAWAL_REQUESTED)', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const detailTypes = Object.values(rules).flatMap(
      (r: any) => r.Properties?.EventPattern?.['detail-type'] ?? [],
    );
    expect(detailTypes).toContain('DEPOSIT_INITIATED');
    expect(detailTypes).toContain('WITHDRAWAL_INITIATED');
    // funding lifecycle events are egress (CDC), never ingress rules
    expect(detailTypes).not.toContain('WITHDRAWAL_REQUESTED');
    expect(detailTypes).not.toContain('DEPOSIT_REQUESTED');
    expect(detailTypes).not.toContain('DEPOSIT_SETTLED');
    expect(detailTypes).not.toContain('WITHDRAWAL_SETTLED');
  });
});
