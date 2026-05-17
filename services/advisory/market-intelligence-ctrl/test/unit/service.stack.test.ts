/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { MarketIntelligenceCtrlStack } from '../../src/service.stack';

describe('MarketIntelligenceCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new MarketIntelligenceCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'market-intelligence-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates SQS queues for Ingress', () => {
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(2);
  });

  it('creates EventBridge rules for inbound event types', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.anyValue(),
      }),
    });
  });

  it('creates the expected Lambda functions (event-listener, CDC, KB ingestion) and no tool Lambdas', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const logicalIds = Object.keys(lambdas);
    expect(logicalIds.some((id) => id.includes('MarketDataTool'))).toBe(false);
    expect(logicalIds.some((id) => id.includes('InstrumentUniverseTool'))).toBe(false);
    expect(logicalIds.some((id) => id.includes('Ingress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('Egress'))).toBe(true);
    expect(logicalIds.some((id) => id.includes('KBIngestion'))).toBe(true);
  });

  it('creates an S3 bucket for KB content', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
  });

  it('grants bedrock:StartIngestionJob to KB ingestion Lambda', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = allStatements.flatMap((s: any) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('bedrock:StartIngestionJob');
  });

  it('grants events:PutEvents to the AgentRuntime execution role', () => {
    const policies = template.findResources('AWS::IAM::Policy', {
      Properties: {
        Roles: Match.arrayWith([
          Match.objectLike({ Ref: Match.stringLikeRegexp('.*AgentRuntime.*') }),
        ]),
      },
    });
    expect(Object.keys(policies).length).toBeGreaterThan(0);

    const statements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = statements.flatMap((s: { Action: string | string[] }) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('events:PutEvents');
  });

  it('grants RetrieveMemoryRecords but not BatchCreate/ListMemoryRecords (inter-agent state via SF, not Memory)', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = allStatements.flatMap((s: any) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('bedrock-agentcore:RetrieveMemoryRecords');
    expect(actions).not.toContain('bedrock-agentcore:BatchCreateMemoryRecords');
    expect(actions).not.toContain('bedrock-agentcore:ListMemoryRecords');
  });

  it('subscribes to 5 feed events plus MARKET_SNAPSHOT_REFRESH_TICK, not ANALYZE_MARKET', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith([
          'YAHOO_FINANCE_UPDATED',
          'MARKETWATCH_UPDATED',
          'SEC_8K_FILED',
          'FRED_INDICATORS_UPDATED',
          'ALPHA_VANTAGE_NEWS_UPDATED',
          'MARKET_SNAPSHOT_REFRESH_TICK',
        ]),
      }),
    });
    // Negative assertion: no rule subscribes to ANALYZE_MARKET
    const rules = template.findResources('AWS::Events::Rule');
    for (const rule of Object.values(rules)) {
      const detailTypes: string[] =
        (rule as any).Properties?.EventPattern?.['detail-type'] ?? [];
      expect(detailTypes).not.toContain('ANALYZE_MARKET');
    }
  });

  it('declares a scheduled rule with rate(15 minutes) targeting the scheduled-emitter Lambda', () => {
    // Pin both the rate AND the target so a future change that repointed the
    // schedule at a different Lambda (or dropped the emitter entirely) fails loudly.
    template.hasResourceProperties('AWS::Events::Rule', {
      ScheduleExpression: 'rate(15 minutes)',
      Targets: Match.arrayWith([
        Match.objectLike({
          Arn: Match.objectLike({
            'Fn::GetAtt': Match.arrayWith([
              Match.stringLikeRegexp('^ScheduledEmitter'),
            ]),
          }),
        }),
      ]),
    });
  });

  it('does not grant states:SendTaskSuccess or states:SendTaskFailure to any role', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    for (const policy of Object.values(policies)) {
      const statements: any[] =
        (policy as any).Properties?.PolicyDocument?.Statement ?? [];
      for (const stmt of statements) {
        const actions: string[] = Array.isArray(stmt.Action)
          ? stmt.Action
          : [stmt.Action];
        expect(actions).not.toContain('states:SendTaskSuccess');
        expect(actions).not.toContain('states:SendTaskFailure');
        expect(actions).not.toContain('states:SendTaskHeartbeat');
      }
    }
  });

  it('does not synthesize any BootstrapSnapshot resources — DWC SF tolerates absent MarketSnapshot via Catch', () => {
    // The bootstrap custom resource solved only the 15-min-post-fresh-deploy race;
    // scheduler-disabled / Bedrock-outage / row-eviction produce the same "absent"
    // state on a long-running stack. DWC SF's LookupMarketSnapshot now Catches the
    // missing-Item failure and routes to HandleMissingMarketSnapshot (empty default).
    // PE+AN tolerate empty marketAnalysis via `?? {}`. The bootstrap is obsolete.
    const customResources = template.findResources('AWS::CloudFormation::CustomResource');
    const lambdas = template.findResources('AWS::Lambda::Function');
    const roles = template.findResources('AWS::IAM::Role');

    expect(
      Object.keys(customResources).filter((id) => id.includes('BootstrapSnapshot')),
    ).toEqual([]);
    expect(Object.keys(lambdas).filter((id) => id.includes('BootstrapSnapshot'))).toEqual([]);
    expect(Object.keys(roles).filter((id) => id.includes('BootstrapSnapshot'))).toEqual([]);
  });

  it('emits MARKET_SNAPSHOT_UPDATED on MarketSnapshot row INSERT or MODIFY', () => {
    // Egress construct declares CDC mappings via EVENT_TYPE_MAP env var on the publisher Lambda.
    template.hasResourceProperties('AWS::Lambda::Function', {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          EVENT_TYPE_MAP: Match.stringLikeRegexp('MarketSnapshot'),
        }),
      }),
    });
    const lambdas = template.findResources('AWS::Lambda::Function');
    const egressLambdaEntry = Object.values(lambdas).find((l: any) => {
      const vars = l.Properties?.Environment?.Variables ?? {};
      return typeof vars.EVENT_TYPE_MAP === 'string'
        && vars.EVENT_TYPE_MAP.includes('MarketSnapshot');
    }) as any;
    expect(egressLambdaEntry).toBeDefined();
    const map = egressLambdaEntry.Properties.Environment.Variables.EVENT_TYPE_MAP as string;
    expect(map).toContain('MARKET_SNAPSHOT_UPDATED');
  });
});
