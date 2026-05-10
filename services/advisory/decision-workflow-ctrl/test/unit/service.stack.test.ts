/* eslint-disable @typescript-eslint/no-explicit-any */
import { join } from 'path';
import { App } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { DecisionWorkflowCtrlStack } from '../../src/service.stack';

describe('DecisionWorkflowCtrlStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new App();
    const stack = new DecisionWorkflowCtrlStack(app, 'TestStack', {
      prefix: 'test',
      service: 'decision-workflow-ctrl',
      subsystem: 'advisory',
      serviceDir: join(__dirname, '..', '..', 'src'),
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

  it('creates SQS queues for the CallbackIngress + Egress DLQs', () => {
    // Post-Phase-1: only CallbackIngress remains (no TriggerIngress).
    // 1 ingress queue + 1 ingress DLQ + 1 egress DLQ = at least 3.
    const queues = template.findResources('AWS::SQS::Queue');
    expect(Object.keys(queues).length).toBeGreaterThanOrEqual(3);
  });

  it('creates 7 EB→SF trigger rules, one per trigger event', () => {
    // Phase 1 collapse: TriggerIngress + WORKFLOW_TRIGGER intermediate event removed.
    // The Orchestration construct now wires each trigger event directly to the SF
    // state machine via a separate EB Rule (one rule per event type).
    const expectedTriggers = [
      'MANDATE_SNAPSHOT_CREATED',
      'INVESTOR_PROFILE_UPDATED',
      'PORTFOLIO_DRIFT_DETECTED',
      'ORDER_FILLED',
      'ORDER_REJECTED',
      'ORDER_CANCELLED',
      'DEPOSIT_DETECTED',
    ];
    for (const t of expectedTriggers) {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({ 'detail-type': [t] }),
      });
    }
  });

  it('targets the Decision state machine from each trigger rule', () => {
    const rules = template.findResources('AWS::Events::Rule');
    const triggerRules = Object.values(rules).filter((r: any) => {
      const detailTypes = r.Properties?.EventPattern?.['detail-type'];
      if (!Array.isArray(detailTypes) || detailTypes.length !== 1) return false;
      return [
        'MANDATE_SNAPSHOT_CREATED',
        'INVESTOR_PROFILE_UPDATED',
        'PORTFOLIO_DRIFT_DETECTED',
        'ORDER_FILLED',
        'ORDER_REJECTED',
        'ORDER_CANCELLED',
        'DEPOSIT_DETECTED',
      ].includes(detailTypes[0]);
    });
    expect(triggerRules.length).toBe(7);

    for (const rule of triggerRules) {
      const targets = (rule as any).Properties?.Targets ?? [];
      const sfTarget = targets.find((t: any) => {
        const arn = t.Arn;
        return typeof arn === 'object' && JSON.stringify(arn).includes('StateMachine');
      });
      expect(sfTarget).toBeDefined();
    }
  });

  it('does NOT create a TriggerIngress Lambda or queue', () => {
    const synthesized = JSON.stringify(template.toJSON());
    expect(synthesized).not.toContain('TriggerIngress');
  });

  it('does NOT emit WORKFLOW_TRIGGER_* events', () => {
    const synthesized = JSON.stringify(template.toJSON());
    expect(synthesized).not.toContain('WORKFLOW_TRIGGER_CREATED');
    expect(synthesized).not.toContain('WORKFLOW_TRIGGER_UPDATED');
  });

  it('creates a CallbackIngress rule subscribing to agent / compliance / user-response events', () => {
    // Single Ingress matches all 8 ALL_INBOUND_EVENT_TYPES via Match.anyOf.
    template.hasResourceProperties('AWS::Events::Rule', {
      EventPattern: Match.objectLike({
        'detail-type': Match.arrayWith(['INVESTOR_PROFILE_COMPLETED']),
      }),
    });
  });

  it('grants SFN task response to the callback ingress handler', () => {
    const policies = template.findResources('AWS::IAM::Policy');
    const allStatements = Object.values(policies).flatMap(
      (p: any) => p.Properties.PolicyDocument.Statement ?? [],
    );
    const actions = allStatements.flatMap((s: any) =>
      Array.isArray(s.Action) ? s.Action : [s.Action],
    );
    expect(actions).toContain('states:SendTaskSuccess');
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

  // Phase 2 of agentcore-memory-list-records-eventual-consistency: the
  // InvokePortfolioEngine and InvokeAdvisoryNarrative Task subjects must
  // include 'operatingMode.$': '$.agentResults.InvokeInvestorProfile.operatingMode'
  // so downstream Lambdas can read operatingMode from the event subject without
  // a Memory roundtrip. MergeParallelOutputs must lift it from the Parallel
  // result so the JSONPath resolves at runtime.
  describe('MandateProjectorIngress', () => {
    it('subscribes to MANDATE_ISSUED + OPERATING_MODE_CHANGED', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          'detail-type': Match.arrayWith(['MANDATE_ISSUED', 'OPERATING_MODE_CHANGED']),
        }),
      });
    });
  });

  describe('Egress emits MANDATE_SNAPSHOT_CREATED on MandateSnapshot:INSERT', () => {
    it('declares MandateSnapshot insert mapping in EVENT_TYPE_MAP env var', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            EVENT_TYPE_MAP: Match.stringLikeRegexp('MANDATE_SNAPSHOT_CREATED'),
          }),
        }),
      });
    });
  });

  describe('SF role has dynamodb:GetItem on State table', () => {
    it('grants read', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      const allStatements = Object.values(policies).flatMap(
        (p: any) => p.Properties.PolicyDocument.Statement ?? [],
      );
      const actions = allStatements.flatMap((s: any) =>
        Array.isArray(s.Action) ? s.Action : [s.Action],
      );
      expect(actions).toContain('dynamodb:GetItem');
    });
  });

  it('SF definition contains single dynamodb:getItem step (LookupMandateSnapshot)', () => {
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const definitionString = Object.values(stateMachines)[0]?.Properties?.DefinitionString;
    expect(definitionString).toBeDefined();

    const joinParts: any[] = (definitionString as any)['Fn::Join']?.[1] ?? [];
    const definition = joinParts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('');

    expect(definition).toContain('arn:aws:states:::dynamodb:getItem');
    expect(definition).toContain('LookupMandateSnapshot');
    expect(definition).toContain('SetInvestorProfile');
    // The SF must use the synthesized $.investorProfile, NOT raw $.triggerContext, for InvokeInvestorProfile
    expect(definition).toContain('"investorProfile.$":"$.investorProfile"');
    expect(definition).not.toContain('"investorProfile.$":"$.triggerContext"');
  });

  it('propagates operatingMode through SF state from InvokeInvestorProfile to downstream Tasks', () => {
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const definitionString = Object.values(stateMachines)[0]?.Properties?.DefinitionString;
    expect(definitionString).toBeDefined();

    // DefinitionString is a CFN intrinsic Fn::Join — assemble it to a single string for assertion.
    const joinParts: any[] = (definitionString as any)['Fn::Join']?.[1] ?? [];
    const definition = joinParts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('');

    // MergeParallelOutputs lifts operatingMode out of $.parallelResults[0].
    expect(definition).toContain('"operatingMode.$":"$.parallelResults[0].agentResults.InvokeInvestorProfile.operatingMode"');

    // InvokePortfolioEngine + InvokeAdvisoryNarrative subjects reference the lifted path.
    const portfolioMatches = definition.match(/"operatingMode\.\$":"\$\.agentResults\.InvokeInvestorProfile\.operatingMode"/g) ?? [];
    expect(portfolioMatches.length).toBeGreaterThanOrEqual(2);
  });
});
