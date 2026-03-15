import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LedgerBffStack } from '../src/service.stack';

describe('LedgerBffStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App({ context: { prefix: 'test' } });
    const stack = new LedgerBffStack(app, 'test-ledger-bff', { prefix: 'test' });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates EventListener Lambda with SERVICE_NAME env var', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: {
        Variables: Match.objectLike({
          SERVICE_NAME: 'ledger-bff',
          TABLE_NAME: Match.anyValue(),
          BUS_NAME: Match.anyValue(),
        }),
      },
    });
  });

  it('creates Ingress from ledger-hub with correct event types', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: {
        'detail-type': Match.arrayWith([
          'BALANCE_UPDATED',
          'PORTFOLIO_UPDATED',
          'LEDGER_ENTRY_RECORDED',
        ]),
      },
    });
  });

  it('does NOT create Egress (pure read-model)', () => {
    // Egress would create a Lambda with CUSTOM_EVENT_TYPE_MAP env var
    // Verify no function has that env var
    const lambdas = template.findResources('AWS::Lambda::Function');
    const hasEgress = Object.values(lambdas).some((lambda) => {
      const env = (lambda as any).Properties?.Environment?.Variables;
      return env && 'CUSTOM_EVENT_TYPE_MAP' in env;
    });
    expect(hasEgress).toBe(false);
  });

  it('creates Facade with AppSync GraphQL API', () => {
    template.resourceCountIs('AWS::AppSync::GraphQLApi', 1);
  });

  it('creates JS pipeline resolvers for 6 queries', () => {
    // Each JS resolver creates an AppSync Resolver with PipelineConfig
    const resolvers = template.findResources('AWS::AppSync::Resolver');
    const pipelineResolvers = Object.values(resolvers).filter(
      (r) => (r as any).Properties?.Kind === 'PIPELINE',
    );
    // 6 JS pipeline resolvers
    expect(pipelineResolvers.length).toBe(6);
  });

  it('creates Lambda resolvers for getPortfolioAt and getSimulationComparison', () => {
    const resolvers = template.findResources('AWS::AppSync::Resolver');
    const lambdaResolvers = Object.values(resolvers).filter(
      (r) => (r as any).Properties?.Kind !== 'PIPELINE',
    );
    // 2 Lambda resolvers (getPortfolioAt, getSimulationComparison)
    expect(lambdaResolvers.length).toBe(2);
  });

  it('creates Monitoring construct', () => {
    // Monitoring creates CloudWatch alarms — at least one should exist
    const alarms = template.findResources('AWS::CloudWatch::Alarm');
    expect(Object.keys(alarms).length).toBeGreaterThan(0);
  });

  it('creates Dashboard construct', () => {
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  it('applies standard tags', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      Tags: Match.arrayWith([
        Match.objectLike({ Key: 'Service', Value: 'ledger-bff' }),
      ]),
    });
  });
});
