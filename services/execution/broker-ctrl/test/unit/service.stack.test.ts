/* eslint-disable @typescript-eslint/no-explicit-any */
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BrokerCtrlStack } from '../../src/service.stack';

function orderSmDefinition(template: Template): string {
  const sms = template.findResources('AWS::StepFunctions::StateMachine');
  const defs = Object.values(sms).map((sm: any) => {
    const d = sm.Properties?.DefinitionString;
    return d?.['Fn::Join'] ? d['Fn::Join'][1].join('') : (typeof d === 'string' ? d : JSON.stringify(d));
  });
  return defs.find((d: string) => d.includes('ReadExecutionMode'))!;
}

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

  it('order SF reads identity from $.context and order data from $.subject (break A)', () => {
    const def = orderSmDefinition(template);
    expect(def).toContain("ExecutionMode#{}', $.context.tenantId");
    expect(def).toContain('$.subject.orderId');
    expect(def).toContain('$.subject.symbol');
    expect(def).toContain('$.subject.side');
    expect(def).toContain('$.subject.quantityOrAmountCents');
    expect(def).toContain('$.context.userId');
    // the broken flat identity read is gone
    expect(def).not.toContain("ExecutionMode#{}', $.tenantId");
  });

  it('order SF tolerates an absent ExecutionMode row by defaulting to simulation (absent-cache resilience)', () => {
    const def = orderSmDefinition(template);
    // The ExecutionMode cache row is written only at go-live (investor-bff
    // confirmGoLive); a simulation-mode investor pre-go-live — or a mode-cache
    // write that has not yet settled — has no row, so ReadExecutionMode's GetItem
    // returns no Item. RouteOrder's `$.executionMode.Item.mode.S` read would then
    // throw an UNCATCHABLE States.Runtime and fail the whole order. A Choice guards
    // the read: present → use it; absent → default to simulation (the onboarded
    // default, and the safe no-real-money direction). See feedback-states-runtime-uncatchable.
    expect(def).toContain('CheckExecutionMode');
    expect(def).toContain('DefaultExecutionMode');
    // isPresent guard on the exact path RouteOrder consumes
    expect(def).toContain('$.executionMode.Item.mode.S');
    expect(def).toContain('"IsPresent":true');
    // the absent-row default routes to the simulation adapter
    expect(def).toContain('simulation');
  });

  it('NormalizedEvent PutItems write symbol and side, and no flat-envelope identity read survives (break A + D producer)', () => {
    const def = orderSmDefinition(template);
    // Every state reads identity from $.context / order data from $.subject — no flat reads anywhere
    // (this is what catches a missed state, e.g. the deeply-nested HandleTimeout branch).
    expect(def).not.toContain('"$.tenantId"');
    expect(def).not.toContain('"$.orderId"');
    expect(def).not.toContain('"$.userId"');
    expect(def).not.toContain('"$.region"');
    // symbol/side written in both Lambda payloads (RouteOrder + WaitForMoreFills)
    // AND all three NormalizedEvent PutItems (Filled + Rejected + Escalated) = 5 occurrences.
    expect((def.match(/\$\.subject\.symbol/g) ?? []).length).toBeGreaterThanOrEqual(5);
    expect((def.match(/\$\.subject\.side/g) ?? []).length).toBeGreaterThanOrEqual(5);
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
