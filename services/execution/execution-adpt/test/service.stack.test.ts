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

  it('creates 2 ingestion rules (one per source domain)', () => {
    template.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('ingests from advisory bus', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['DECISION_APPROVED']),
      }),
    });
  });

  it('ingests from investor bus', () => {
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
        Match.objectLike({ Key: 'Service', Value: 'execution-adpt' }),
      ]),
    });
  });
});
