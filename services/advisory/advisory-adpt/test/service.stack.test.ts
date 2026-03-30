import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AdvisoryAdptStack } from '../src/service.stack';

describe('AdvisoryAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new AdvisoryAdptStack(app, 'test-advisory-adpt', {
      prefix: 'test',
      subsystem: 'advisory',
      service: 'advisory-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates cross-domain forwarding rules', () => {
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('forwards to investor bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['DECISION_PACKET_CREATED']),
      }),
    });
  });

  it('forwards to execution bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['USER_CONFIRMED']),
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
        Match.objectLike({ Key: 'Service', Value: 'advisory-adpt' }),
      ]),
    });
  });
});
