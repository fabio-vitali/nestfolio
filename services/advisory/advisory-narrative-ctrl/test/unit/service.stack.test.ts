/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AdvisoryNarrativeCtrlStack } from '../../src/service.stack';

describe('AdvisoryNarrativeCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new AdvisoryNarrativeCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'advisory-narrative-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
    });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates SQS queues', () => {
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(2);
  });

  it('creates EventBridge rules for 2 inbound event types', () => {
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({ 'detail-type': Match.anyValue() }),
    });
  });

  it('creates Lambda functions', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(2);
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

  it('grants bedrock:StartIngestionJob', () => {
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

  it('does not grant states:SendTaskSuccess or states:SendTaskFailure to any role', () => {
    // Post advisory-cycle-agent-precomputation Task 7: AN-ctrl emits
    // AgentCompletion / AgentFailure CDC rows; DWC's CallbackIngress owns
    // the states:SendTask* grants exclusively.
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

  it('emits NARRATIVE_COMPLETED on AgentCompletion:INSERT and NARRATIVE_FAILED on AgentFailure:INSERT', () => {
    // Egress construct declares CDC mappings via EVENT_TYPE_MAP env var on the
    // publisher Lambda (JSON-encoded). Verify both completion + failure rows
    // are present alongside the pre-existing mappings.
    const lambdas = template.findResources('AWS::Lambda::Function');
    const egressLambdaEntry = Object.values(lambdas).find((l: any) => {
      const vars = l.Properties?.Environment?.Variables ?? {};
      return typeof vars.EVENT_TYPE_MAP === 'string'
        && vars.EVENT_TYPE_MAP.includes('AgentCompletion');
    }) as any;
    expect(egressLambdaEntry).toBeDefined();
    const map = egressLambdaEntry.Properties.Environment.Variables.EVENT_TYPE_MAP as string;
    expect(map).toContain('AgentCompletion');
    expect(map).toContain('NARRATIVE_COMPLETED');
    expect(map).toContain('AgentFailure');
    expect(map).toContain('NARRATIVE_FAILED');
  });

  it('Ingress SQS Queue has VisibilityTimeout=232 (agentProfile derivation: lambdaTimeout 58s × 4)', () => {
    const queues = template.findResources('AWS::SQS::Queue', {
      Properties: { VisibilityTimeout: 232 },
    });
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(1);
  });

  it('Ingress Lambda has Timeout=58 (agentProfile: ceil(p90×1.5)+5 where p90=35s — raised from 30s to cover observed p99=53.7s)', () => {
    const lambdas = template.findResources('AWS::Lambda::Function', {
      Properties: { Timeout: 58 },
    });
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(1);
  });

  it('Ingress EventSourceMapping has MaximumConcurrency=2 (agentProfile: ceil(4×35/120) — sandbox cap)', () => {
    const esms = template.findResources('AWS::Lambda::EventSourceMapping', {
      Properties: { ScalingConfig: { MaximumConcurrency: 2 } },
    });
    expect(Object.keys(esms).length).toBeGreaterThanOrEqual(1);
  });

  it('caps AN ingress sqsMaxConcurrency to 2 in sandbox via expectedBurstSize=4', () => {
    // expectedBurstSize=4 → ceil(4×35/120)=ceil(1.167)=2. Visibility: 58×4=232 ≤ 240. NOT for prod.
    const esms = template.findResources('AWS::Lambda::EventSourceMapping', {
      Properties: { ScalingConfig: { MaximumConcurrency: 2 } },
    });
    expect(Object.keys(esms).length).toBeGreaterThanOrEqual(1);
  });

  it('caps AN Lambda function ReservedConcurrentExecutions to 1 (layered on SQS ESM floor to achieve effective concurrency=1)', () => {
    // The SQS ESM MaximumConcurrency=2 floor (AWS API constraint) still leaves
    // 1 contention slot: both Lambda instances race for a single micro-VM and
    // one fails with "maxVms limit exceeded" (permanent SF task token failure).
    // reservedConcurrency=1 caps actual concurrent invocations to 1; the 2nd
    // SQS batch hits Lambda throttling and SQS re-delivers it after the
    // visibility timeout — no permanent failure.
    template.hasResourceProperties('AWS::Lambda::Function', {
      ReservedConcurrentExecutions: 1,
    });
  });

  it('overrides the AgentCore Runtime idle/lifetime to 2 min / 30 min', () => {
    template.hasResourceProperties('AWS::BedrockAgentCore::Runtime', {
      LifecycleConfiguration: {
        IdleRuntimeSessionTimeout: 120,
        MaxLifetime: 1800,
      },
    });
  });
});
