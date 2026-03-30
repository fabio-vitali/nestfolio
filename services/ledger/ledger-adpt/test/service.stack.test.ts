import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LedgerAdptStack } from '../src/service.stack';

describe('LedgerAdptStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerAdptStack(app, 'test-ledger-adpt', {
      prefix: 'test',
      subsystem: 'ledger',
      service: 'ledger-adpt',
    });
    template = Template.fromStack(stack);
  });

  it('creates cross-domain forwarding rules', () => {
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('forwards to investor bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['BALANCE_UPDATED']),
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
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.hasResourceProperties('AWS::SQS::Queue', {
      MessageRetentionPeriod: 1209600,
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'ledger-adpt' }),
      ]),
    });
  });
});
