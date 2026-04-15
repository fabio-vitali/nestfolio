/* eslint-disable @typescript-eslint/no-explicit-any */
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { BrokerAlpacaAdptStack } from '../src/service.stack';

describe('BrokerAlpacaAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new BrokerAlpacaAdptStack(app, 'TestStack', {
      prefix: 'test',
      service: 'broker-alpaca-adpt',
      subsystem: 'execution',
    });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates three Step Functions state machines (order polling, transfer polling, heal)', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 3);
  });

  it('creates an EventBridge Connection for Alpaca API auth', () => {
    template.resourceCountIs('AWS::Events::Connection', 1);
  });

  it('creates an EventBridge rule for BROKER_CIRCUIT_OPEN trigger', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': ['BROKER_CIRCUIT_OPEN'],
      }),
    });
  });

  it('creates EventBridge rules for order and transfer polling triggers', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const allPatterns = Object.values(rules).map(
      (r: any) => r.Properties?.EventPattern,
    );
    const allDetailTypes = allPatterns.flatMap(
      (p: any) => (p?.['detail-type'] ?? []),
    );
    expect(allDetailTypes).toContain('ALPACA_ORDER_PLACED');
    expect(allDetailTypes).toContain('ALPACA_TRANSFER_INITIATED');
  });

  it('creates the heal state machine with expected states', () => {
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const definitions = Object.values(stateMachines).map((sm: any) => {
      const defStr = sm.Properties?.DefinitionString;
      if (defStr?.['Fn::Join']) {
        return defStr['Fn::Join'][1].join('');
      }
      return typeof defStr === 'string' ? defStr : JSON.stringify(defStr);
    });
    const healSM = definitions.find((d: string) =>
      d.includes('InitAttemptCount') && d.includes('HealthCheck'),
    );
    expect(healSM).toBeDefined();
  });

  it('configures NormalizedEvent passthrough in egress CDC event type map', () => {
    // The Egress handler Lambda should have EVENT_TYPE_MAP env var that includes NormalizedEvent
    const lambdas = template.findResources('AWS::Lambda::Function');
    const egressLambda = Object.values(lambdas).find((fn: any) => {
      const envVars = fn.Properties?.Environment?.Variables ?? {};
      return envVars.EVENT_TYPE_MAP && envVars.EVENT_TYPE_MAP.includes('NormalizedEvent');
    });
    expect(egressLambda).toBeDefined();

    const eventTypeMap = JSON.parse(
      (egressLambda as any).Properties.Environment.Variables.EVENT_TYPE_MAP,
    );
    expect(eventTypeMap['NormalizedEvent:INSERT']).toEqual({
      field: 'sk',
      passthrough: true,
    });
  });

  it('creates SQS queues for ingress, orchestration DLQs', () => {
    // 1 ingress queue + 1 ingress DLQ + 1 egress DLQ +
    // 3 orchestration DLQs (order, transfer, heal) = at least 6
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(6);
  });

  it('creates Lambda functions for ingress handler, CDC publisher, and poll handlers', () => {
    // Ingress handler + Egress event-publisher + OrderPollFn + TransferPollFn = at least 4
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(4);
  });
});
