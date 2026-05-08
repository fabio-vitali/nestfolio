import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AdvisoryAdptStack } from '../../src/service.stack';

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

  it('creates 3 ingestion rules (one per source domain)', () => {
    template.resourceCountIs('AWS::Events::Rule', 3);
  });

  it('ingests from investor bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith([
          'INVESTOR_PROFILE_CREATED',
          'INVESTOR_PROFILE_UPDATED',
          'MANDATE_ISSUED',
          'MANDATE_REVOKED',
        ]),
      }),
    });
  });

  it('ingests from execution bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['ORDER_FILLED']),
      }),
    });
  });

  it('ingests from ledger bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['PORTFOLIO_UPDATED']),
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
        Match.objectLike({ Key: 'Service', Value: 'advisory-adpt' }),
      ]),
    });
  });
});
