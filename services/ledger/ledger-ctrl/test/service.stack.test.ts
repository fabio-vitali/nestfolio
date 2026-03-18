import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LedgerCtrlStack } from '../src/service.stack';

describe('LedgerCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerCtrlStack(app, 'test-ledger-ctrl', { prefix: 'test', service: 'ledger-ctrl', subsystem: 'ledger', serviceDir: join(__dirname, '..', 'src') });
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

  it('creates Egress for BalanceEvent, PortfolioEvent, LedgerEntryEvent (custom handler)', () => {
    // Egress now uses a custom handlerEntry — no CUSTOM_EVENT_TYPE_MAP env var
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          BUS_NAME: Match.anyValue(),
          SERVICE_NAME: 'ledger-ctrl',
        }),
      },
    });
    // Verify CUSTOM_EVENT_TYPE_MAP is absent from all Lambda functions
    const lambdas = template.findResources('AWS::Lambda::Function');
    for (const [, resource] of Object.entries(lambdas)) {
      const vars = (resource as any).Properties?.Environment?.Variables ?? {};
      expect(vars).not.toHaveProperty('CUSTOM_EVENT_TYPE_MAP');
    }
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
