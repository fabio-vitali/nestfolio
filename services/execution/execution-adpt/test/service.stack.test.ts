import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { ExecutionAdptStack } from '../src/service.stack';

describe('ExecutionAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new ExecutionAdptStack(app, 'test-execution-adpt', {
      prefix: 'test',
      subsystem: 'execution',
      service: 'execution-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates cross-domain forwarding rules', () => {
    template.resourceCountIs('AWS::Events::Rule', 3);
  });

  it('forwards to investor bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['ORDER_STAGED']),
      }),
    });
  });

  it('forwards to ledger bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['ORDER_FILLED']),
      }),
    });
  });

  it('forwards to advisory bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['PORTFOLIO_DRIFT_DETECTED']),
      }),
    });
  });

  it('creates DLQs with 14-day retention', () => {
    template.resourceCountIs('AWS::SQS::Queue', 3);
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'execution-adpt' }),
      ]),
    });
  });
});
