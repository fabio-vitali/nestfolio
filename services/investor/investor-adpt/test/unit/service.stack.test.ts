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

  it('creates 3 ingestion rules (one per source domain)', () => {
    template.resourceCountIs('AWS::Events::Rule', 3);
  });

  it('ingests from advisory bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['DECISION_PACKET_CREATED']),
      }),
    });
  });

  it('ingests from execution bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['ORDER_STAGED']),
      }),
    });
  });

  it('ingests from ledger bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['BALANCE_UPDATED']),
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
        Match.objectLike({ Key: 'Service', Value: 'investor-adpt' }),
      ]),
    });
  });
});
