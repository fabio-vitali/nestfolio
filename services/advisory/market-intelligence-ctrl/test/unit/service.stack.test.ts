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

  describe('MarketSnapshot bootstrap custom resource', () => {
    it('creates a Provider-fronted custom resource backed by the bootstrap Lambda', () => {
      // Provider creates an AWS::CloudFormation::CustomResource via its serviceToken.
      const customResources = template.findResources('AWS::CloudFormation::CustomResource');
      const bootstrapResource = Object.entries(customResources).find(
        ([id]) => id.includes('BootstrapSnapshotResource'),
      );
      expect(bootstrapResource).toBeDefined();

      const [, resource] = bootstrapResource!;
      const serviceToken = (resource as any).Properties?.ServiceToken;
      expect(serviceToken).toBeDefined();
      // ServiceToken is the framework Lambda created by the Provider construct.
      const tokenRef = JSON.stringify(serviceToken);
      expect(tokenRef).toMatch(/BootstrapSnapshotProvider/);
    });

    it('declares a bootstrap Lambda with a >= 5-minute timeout', () => {
      const lambdas = template.findResources('AWS::Lambda::Function');
      const bootstrapEntry = Object.entries(lambdas).find(([id]) =>
        id.startsWith('BootstrapSnapshotFn'),
      );
      expect(bootstrapEntry).toBeDefined();
      const [, fn] = bootstrapEntry!;
      const timeout = (fn as any).Properties?.Timeout;
      expect(typeof timeout).toBe('number');
      expect(timeout).toBeGreaterThanOrEqual(300);
    });

    it('grants dynamodb:GetItem on the state table and events:PutEvents on the advisory bus to the bootstrap Lambda', () => {
      // The bootstrap Lambda's role has policies attached granting read on the
      // state table and PutEvents on the advisoryBus. We assert both actions
      // appear in a policy whose Roles array references the bootstrap Lambda.
      const lambdas = template.findResources('AWS::Lambda::Function');
      const bootstrapLogicalId = Object.keys(lambdas).find((id) =>
        id.startsWith('BootstrapSnapshotFn'),
      );
      expect(bootstrapLogicalId).toBeDefined();

      // Find the IAM Role for the bootstrap Lambda
      const roles = template.findResources('AWS::IAM::Role');
      const bootstrapRoleId = Object.keys(roles).find((id) =>
        id.startsWith('BootstrapSnapshotFnServiceRole'),
      );
      expect(bootstrapRoleId).toBeDefined();

      // Find the inline policies attached to that role
      const policies = template.findResources('AWS::IAM::Policy');
      const bootstrapPolicies = Object.values(policies).filter((p: any) => {
        const roles: any[] = p.Properties?.Roles ?? [];
        return roles.some((r) => r?.Ref === bootstrapRoleId);
      });
      expect(bootstrapPolicies.length).toBeGreaterThan(0);

      const allStatements = bootstrapPolicies.flatMap(
        (p: any) => p.Properties.PolicyDocument.Statement ?? [],
      );
      const allActions = allStatements.flatMap((s: any) =>
        Array.isArray(s.Action) ? s.Action : [s.Action],
      );
      expect(allActions).toContain('dynamodb:GetItem');
      expect(allActions).toContain('events:PutEvents');
    });
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
