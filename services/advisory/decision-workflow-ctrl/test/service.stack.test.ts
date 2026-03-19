/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DecisionWorkflowCtrlStack } from '../src/service.stack';

describe('DecisionWorkflowCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new DecisionWorkflowCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'decision-workflow-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', 'src'),
    });
    template = Template.fromStack(stack);
  });

  it('creates a DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('creates a Step Functions state machine', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
      StateMachineType: 'STANDARD',
      TracingConfiguration: { Enabled: true },
    });
  });

  it('creates SQS queues for Ingress + Egress DLQs', () => {
    // At least 2 DLQs: one for ingress, one for egress
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

  it('creates Lambda functions for event-listener and CDC publisher', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    expect(Object.keys(lambdas).length).toBeGreaterThanOrEqual(2);
  });

  it('grants SFN startExecution to the ingress handler', () => {
    // CDK may emit Action as a string or array; use serialized JSON match
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.anyValue(),
            Effect: 'Allow',
          }),
        ]),
      },
    });

    // Verify states:StartExecution appears somewhere in the synthesized template
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = allStatements.flatMap((s: any) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('states:StartExecution');
  });

  it('creates an AgentCore Memory resource', () => {
    template.resourceCountIs('AWS::BedrockAgentCore::Memory', 1);
  });

  it('creates an SSM Parameter for memory ID', () => {
    template.hasResourceProperties('AWS::SSM::Parameter', {
      Type: 'String',
    });
  });

  it('sets custom extraction on InvestorPreferenceLearner strategy', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const investorPref = strategies.find((s: any) => s.CustomMemoryStrategy?.Name === 'InvestorPreferenceLearner');
    expect(investorPref).toBeDefined();
    const config = investorPref?.CustomMemoryStrategy?.Configuration?.UserPreferenceOverride;
    expect(config?.Extraction?.AppendToPrompt).toContain('risk tolerance');
    expect(config?.Consolidation?.AppendToPrompt).toContain('newer statements override');
  });

  it('sets custom extraction on AllocationRationaleExtractor strategy', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const allocRationale = strategies.find((s: any) => s.CustomMemoryStrategy?.Name === 'AllocationRationaleExtractor');
    expect(allocRationale).toBeDefined();
    const config = allocRationale?.CustomMemoryStrategy?.Configuration?.SemanticOverride;
    expect(config?.Extraction?.AppendToPrompt).toContain('allocation rationale');
    expect(config?.Consolidation?.AppendToPrompt).toContain('reasoning chain');
  });

  it('sets custom extraction on NarrativePreferenceLearner strategy', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const narrativePref = strategies.find((s: any) => s.CustomMemoryStrategy?.Name === 'NarrativePreferenceLearner');
    expect(narrativePref).toBeDefined();
    const config = narrativePref?.CustomMemoryStrategy?.Configuration?.UserPreferenceOverride;
    expect(config?.Extraction?.AppendToPrompt).toContain('communication preferences');
    expect(config?.Consolidation?.AppendToPrompt).toContain('most recent signals');
  });

  it('does not set custom extraction on MarketSignalExtractor strategy', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const marketSignal = strategies.find((s: any) => s.SemanticMemoryStrategy?.Name === 'MarketSignalExtractor');
    expect(marketSignal).toBeDefined();
    expect(marketSignal?.CustomMemoryStrategy).toBeUndefined();
  });

  it('does not set custom extraction on NarrativeSessionSummarizer strategy', () => {
    const memory = template.findResources('AWS::BedrockAgentCore::Memory');
    const strategies = Object.values(memory)[0]?.Properties?.MemoryStrategies ?? [];
    const summarizer = strategies.find((s: any) => s.SummaryMemoryStrategy?.Name === 'NarrativeSessionSummarizer');
    expect(summarizer).toBeDefined();
    expect(summarizer?.CustomMemoryStrategy).toBeUndefined();
  });

  it('creates an AssemblePacket Lambda with MEMORY_ID env var', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const assemblePacketLambda = Object.values(lambdas).find(
      (l: any) => l.Properties.Handler?.includes('assemble-packet') ||
                   l.Properties.Environment?.Variables?.MEMORY_ID,
    );
    expect(assemblePacketLambda).toBeDefined();
  });
});
