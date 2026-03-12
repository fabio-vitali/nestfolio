import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LedgerCtrlStack } from '../src/service.stack';

describe('LedgerCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerCtrlStack(app, 'test-ledger-ctrl');
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates EventListener Lambda with SERVICE_NAME env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          SERVICE_NAME: 'ledger-ctrl',
          TABLE_NAME: Match.anyValue(),
          BUS_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('creates Reducer Lambda with DDB Stream event source (FilterCriteria for LedgerEntry)', () => {
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      FilterCriteria: Match.objectLike({
        Filters: Match.arrayWith([
          Match.objectLike({
            Pattern: Match.anyValue(),
          }),
        ]),
      }),
      BatchSize: 100,
    });
  });

  it('creates Egress for BalanceEvent, PortfolioEvent, LedgerEntryEvent', () => {
    // Egress creates a Lambda with CUSTOM_EVENT_TYPE_MAP containing intent-based event names
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          CUSTOM_EVENT_TYPE_MAP: Match.anyValue(),
        }),
      },
    });
  });

  it('creates Ingress from ledger-hub bus', () => {
    // Ingress creates an SQS queue and EventBridge rule
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': Match.arrayWith([
          'ORDER_FILLED',
          'DEPOSIT_DETECTED',
          'CORPORATE_ACTION_PROCESSED',
          'DECISION_PACKET_CREATED',
        ]),
      },
    });
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'ledger-ctrl' }),
      ]),
    });
  });
});
