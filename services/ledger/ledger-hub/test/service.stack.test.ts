import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LedgerHubStack } from '../src/service.stack';

describe('LedgerHubStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerHubStack(app, 'test-ledger-hub');
    template = Template.fromStack(stack);
  });

  it('creates an EventBridge bus', () => {
    template.resourceCountIs('AWS::Events::EventBus', 1);
  });

  it('creates an event archive with 365-day retention', () => {
    template.hasResourceProperties('AWS::Events::Archive', {
      RetentionDays: 365,
    });
  });

  it('publishes bus ARN to SSM', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Description: 'Ledger event hub bus ARN',
    });
  });

  it('creates forwarding rule to investor-hub', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': [
          'BALANCE_UPDATED',
          'PORTFOLIO_UPDATED',
          'RECONCILIATION_COMPLETED',
          'RECONCILIATION_FAILED',
          'LEDGER_PROCESSING_FAILED',
        ],
      },
    });
  });

  it('creates forwarding rule to advisory-hub', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': [
          'PORTFOLIO_UPDATED',
          'PORTFOLIO_DRIFT_DETECTED',
          'RECONCILIATION_FAILED',
        ],
      },
    });
  });

  it('creates DLQs for forwarding targets', () => {
    const queues = template.findResources('AWS::SQS::Queue', {
      Properties: {
        MessageRetentionPeriod: 1209600,
      },
    });
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(2);
  });

  it('applies standard tags to taggable resources', () => {
    template.hasResourceProperties('AWS::SQS::Queue', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'ledger-hub' }),
      ]),
    });
  });
});
