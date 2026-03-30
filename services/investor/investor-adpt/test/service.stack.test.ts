import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { InvestorAdptStack } from '../src/service.stack';

describe('InvestorAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new InvestorAdptStack(app, 'test-investor-adpt', {
      prefix: 'test',
      subsystem: 'investor',
      service: 'investor-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates cross-domain forwarding rules', () => {
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('forwards to advisory bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['GOAL_UPDATED']),
      }),
    });
  });

  it('forwards to execution bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['DEPOSIT_INITIATED']),
      }),
    });
  });

  it('creates DLQs with 14-day retention', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'investor-adpt' }),
      ]),
    });
  });
});
