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

  describe('Phase B — Long-term MemoryStrategies', () => {
    // CFN serialises all property names as PascalCase via the generated converters in
    // aws-bedrockagentcore.generated.js. The alpha construct's render() produces camelCase
    // JS objects; the CfnMemory toCloudFormation mapper uppercases every key before
    // writing the template, so assertions must use PascalCase throughout.
    const getStrategies = () => {
      const memory = template.findResources('AWS::BedrockAgentCore::Memory');
      return (Object.values(memory)[0] as any)?.Properties?.MemoryStrategies ?? [];
    };

    it('attaches 4 strategies to the Memory resource', () => {
      const strategies = getStrategies();
      expect(strategies).toHaveLength(4);
    });

    it('attaches InvestorPreferenceLearner with USER_PREFERENCE_MEMORY type, custom Haiku extraction + consolidation', () => {
      const strategies = getStrategies();
      const learner = strategies.find(
        (s: any) => s.CustomMemoryStrategy?.Name === 'InvestorPreferenceLearner',
      );
      expect(learner).toBeDefined();
      const cfg = learner?.CustomMemoryStrategy?.Configuration?.UserPreferenceOverride;
      expect(cfg?.Extraction?.AppendToPrompt).toContain('risk tolerance');
      expect(cfg?.Consolidation?.AppendToPrompt).toContain('newer statements override');
      expect(learner?.CustomMemoryStrategy?.Namespaces).toEqual([
        '/investor-profile-ctrl/{actorId}/preferences',
      ]);
    });

    it('attaches MarketSignalExtractor with SEMANTIC_MEMORY type, custom Haiku extraction only', () => {
      const strategies = getStrategies();
      const extractor = strategies.find(
        (s: any) => s.CustomMemoryStrategy?.Name === 'MarketSignalExtractor',
      );
      expect(extractor).toBeDefined();
      const cfg = extractor?.CustomMemoryStrategy?.Configuration?.SemanticOverride;
      expect(cfg?.Extraction?.AppendToPrompt).toContain('cross-decision shelf life');
      expect(extractor?.CustomMemoryStrategy?.Namespaces).toEqual([
        '/market-intelligence-ctrl/{actorId}/signals',
      ]);
    });

    it('attaches PortfolioRationaleArchivist with SEMANTIC_MEMORY type, custom Haiku extraction + consolidation', () => {
      const strategies = getStrategies();
      const archivist = strategies.find(
        (s: any) => s.CustomMemoryStrategy?.Name === 'PortfolioRationaleArchivist',
      );
      expect(archivist).toBeDefined();
      const cfg = archivist?.CustomMemoryStrategy?.Configuration?.SemanticOverride;
      expect(cfg?.Extraction?.AppendToPrompt).toContain('investor-facing narrative');
      expect(cfg?.Consolidation?.AppendToPrompt).toContain('reasoning chain');
      expect(archivist?.CustomMemoryStrategy?.Namespaces).toEqual([
        '/portfolio-engine-ctrl/{actorId}/rationale',
      ]);
    });

    it('attaches NarrativeRationaleArchivist with SEMANTIC_MEMORY type, custom Haiku extraction + consolidation', () => {
      const strategies = getStrategies();
      const archivist = strategies.find(
        (s: any) => s.CustomMemoryStrategy?.Name === 'NarrativeRationaleArchivist',
      );
      expect(archivist).toBeDefined();
      const cfg = archivist?.CustomMemoryStrategy?.Configuration?.SemanticOverride;
      expect(cfg?.Extraction?.AppendToPrompt).toContain('investor-facing narrative');
      expect(cfg?.Consolidation?.AppendToPrompt).toContain('reasoning chain');
      expect(archivist?.CustomMemoryStrategy?.Namespaces).toEqual([
        '/advisory-narrative-ctrl/{actorId}/rationale',
      ]);
    });
  });

  it('creates an AssemblePacket Lambda without MEMORY_ID env var (post-Phase-A: agent outputs arrive via SF state Parameters, not Memory)', () => {
    const lambdas = template.findResources('AWS::Lambda::Function');
    const assemblePacketLambda = Object.values(lambdas).find(
      (l: any) =>
        typeof l.Properties.Description === 'string'
          ? l.Properties.Description.includes('AssemblePacket')
          : false,
    ) ?? Object.entries(lambdas).find(
      ([logicalId]) => logicalId.includes('AssemblePacket'),
    )?.[1];
    expect(assemblePacketLambda).toBeDefined();
    // MEMORY_ID was dropped in Phase A of inter-agent-state-handoff-sf-vs-memory.
    expect(
      (assemblePacketLambda as any).Properties.Environment?.Variables?.MEMORY_ID,
    ).toBeUndefined();
    // TABLE_NAME is still required for the DecisionPacketRepository write.
    expect(
      (assemblePacketLambda as any).Properties.Environment?.Variables?.TABLE_NAME,
    ).toBeDefined();
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

  describe('SnapshotProjectorIngress', () => {
    it('subscribes to INVESTOR_PROFILE_SNAPSHOT_{CREATED,UPDATED} + MARKET_SNAPSHOT_UPDATED', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: Match.objectLike({
          'detail-type': Match.arrayWith([
            'INVESTOR_PROFILE_SNAPSHOT_CREATED',
            'INVESTOR_PROFILE_SNAPSHOT_UPDATED',
            'MARKET_SNAPSHOT_UPDATED',
          ]),
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

  it('SF definition contains the three dynamodb:getItem steps (LookupMandateSnapshot + LookupInvestorProfileSnapshot + LookupMarketSnapshot)', () => {
    // Post-precomputation rewire: in addition to the existing mandate lookup,
    // the SF now reads InvestorProfile + Market snapshot rows from its own table.
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const definitionString = Object.values(stateMachines)[0]?.Properties?.DefinitionString;
    expect(definitionString).toBeDefined();

    const joinParts: any[] = (definitionString as any)['Fn::Join']?.[1] ?? [];
    const definition = joinParts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('');

    expect(definition).toContain('arn:aws:states:::dynamodb:getItem');
    expect(definition).toContain('LookupMandateSnapshot');
    expect(definition).toContain('LookupInvestorProfileSnapshot');
    expect(definition).toContain('LookupMarketSnapshot');
    expect(definition).toContain('SetInvestorProfile');
    // The mandate-resolution branches both set the synthesized $.investorProfile —
    // either hoisted from $.triggerContext.operatingMode or read from the mandate row.
    // PE + AN read $.investorProfile.operatingMode downstream.
    expect(definition).toContain('"operatingMode.$":"$.investorProfile.operatingMode"');
  });

  it('propagates operatingMode through SF state via ResolveMandateSnapshot to PE + AN', () => {
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const definitionString = Object.values(stateMachines)[0]?.Properties?.DefinitionString;
    expect(definitionString).toBeDefined();

    // DefinitionString is a CFN intrinsic Fn::Join — assemble it to a single string for assertion.
    const joinParts: any[] = (definitionString as any)['Fn::Join']?.[1] ?? [];
    const definition = joinParts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('');

    // After the precomputation rewire, operatingMode comes from one of two paths:
    //   1. HoistMandateFromTrigger lifts from $.triggerContext.operatingMode
    //   2. SetInvestorProfile lifts from $.mandateSnapshot.operatingMode (read by LookupMandateSnapshot)
    // Either way it ends up at $.investorProfile.operatingMode, which PE + AN read.
    expect(definition).toContain('"operatingMode.$":"$.triggerContext.operatingMode"');
    expect(definition).toContain('"operatingMode.$":"$.mandateSnapshot.operatingMode"');

    // InvokePortfolioEngine + InvokeAdvisoryNarrative subjects reference $.investorProfile.operatingMode.
    const downstreamMatches = definition.match(/"operatingMode\.\$":"\$\.investorProfile\.operatingMode"/g) ?? [];
    expect(downstreamMatches.length).toBeGreaterThanOrEqual(2);
  });

  it('grants bedrock:InvokeModel + WithResponseStream on inference-profile + foundation-model resources', () => {
    // Cross-region inference profiles route to foundation models — both
    // ARNs must be granted, matching agent-runtime.ts's buildBedrockModelResources
    // pattern. AWS deploy fails with "Role does not have access for the specified
    // model" if either is missing.
    //
    // The inference-profile ARN is Fn::Join because it concatenates a static prefix
    // with an SSM resolve token (StringParameter.valueForStringParameter).
    // CDK synthesises: {"Fn::Join":["",["arn:aws:bedrock:*:*:inference-profile/",{"Ref":"...SSM..."}]]}
    // The foundation-model/* ARN is a plain string.
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            Resource: Match.arrayWith([
              // inference-profile ARN with SSM-resolved model id
              { 'Fn::Join': Match.anyValue() },
              // foundation-model wildcard
              'arn:aws:bedrock:*::foundation-model/*',
            ]),
          }),
        ]),
      }),
    });
  });

  // Phase A of inter-agent-state-handoff-sf-vs-memory: agent outputs flow through
  // Step Functions state via `$.agentResults.<StateId>.agentOutput` instead of via
  // AgentCore Memory ListMemoryRecords (which has a >40s eventual-consistency
  // window — see docs/backlog/agentcore-memory-list-records-eventual-consistency.md).
  // Task 2 plumbs upstream agentOutput onto downstream task subjects and into
  // AssembleDecisionPacket's Lambda Payload.
  describe('Inter-agent state handoff (Phase A — Task 2)', () => {
    // Helper: parse the SF DefinitionString back to a JSON object so we can
    // address individual states by name. The DefinitionString is a CFN Fn::Join
    // mixing JSON-string fragments with CFN intrinsic Refs (e.g. {Ref: ...}).
    // We swap each intrinsic out for a synthetic string token before parsing.
    const getStateMachineDefinition = (): any => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const definitionString = Object.values(stateMachines)[0]?.Properties?.DefinitionString;
      const joinParts: any[] = (definitionString as any)['Fn::Join']?.[1] ?? [];
      const joined = joinParts
        .map((p, i) => (typeof p === 'string' ? p : `__CFN_INTRINSIC_${i}__`))
        .join('');
      return JSON.parse(joined);
    };

    it('plumbs all 4 agent outputs into AssembleDecisionPacket invocation Parameters', () => {
      const definition = getStateMachineDefinition();
      const assemblePacketState = definition.States['AssembleDecisionPacket'];
      expect(assemblePacketState.Parameters.Payload).toMatchObject({
        'investorProfile.$': '$.agentResults.InvokeInvestorProfile.agentOutput',
        'marketAnalysis.$': '$.agentResults.InvokeMarketIntelligence.agentOutput',
        'portfolio.$': '$.agentResults.InvokePortfolioEngine.agentOutput',
        'narrative.$': '$.agentResults.InvokeAdvisoryNarrative.agentOutput',
      });
    });

    it('plumbs investor-profile agentOutput into PortfolioEngine subject', () => {
      const definition = getStateMachineDefinition();
      const portfolioInvocation = definition.States['InvokePortfolioEngine'];
      const subject = portfolioInvocation.Parameters.Entries[0].Detail.subject;
      expect(subject['investorProfile.$']).toBe('$.agentResults.InvokeInvestorProfile.agentOutput');
      expect(subject['marketAnalysis.$']).toBe('$.agentResults.InvokeMarketIntelligence.agentOutput');
    });

    it('plumbs investor-profile + market-intelligence + portfolio agentOutputs into AdvisoryNarrative subject', () => {
      const definition = getStateMachineDefinition();
      const narrativeInvocation = definition.States['InvokeAdvisoryNarrative'];
      const subject = narrativeInvocation.Parameters.Entries[0].Detail.subject;
      expect(subject['investorProfile.$']).toBe('$.agentResults.InvokeInvestorProfile.agentOutput');
      expect(subject['marketAnalysis.$']).toBe('$.agentResults.InvokeMarketIntelligence.agentOutput');
      expect(subject['portfolio.$']).toBe('$.agentResults.InvokePortfolioEngine.agentOutput');
    });

    it('MergeProjections lifts agentOutput from both parallel branches so downstream JSONPaths resolve', () => {
      // Renamed from MergeParallelOutputs in the agent-precomputation rewire — IP + Market
      // are now precomputed DDB snapshot reads, not waitForTaskToken agent calls.
      const definition = getStateMachineDefinition();
      const merge = definition.States['MergeProjections'];
      const agentResults = merge.Parameters.agentResults;
      expect(agentResults.InvokeInvestorProfile['agentOutput.$']).toBe(
        '$.parallelResults[0].agentResults.InvokeInvestorProfile.agentOutput',
      );
      expect(agentResults.InvokeMarketIntelligence['agentOutput.$']).toBe(
        '$.parallelResults[1].agentResults.InvokeMarketIntelligence.agentOutput',
      );
    });
  });
});
