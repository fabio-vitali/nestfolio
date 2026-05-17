import { join } from 'path';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { BedrockFoundationModel } from '@aws-cdk/aws-bedrock-alpha';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Orchestration } from '@nestfolio/cdk-constructs/core';
import {
  TRIGGER_EVENT_TYPES,
  ALL_INBOUND_EVENT_TYPES,
  DecisionWorkflowEventTypes,
  MANDATE_LIFECYCLE_EVENT_TYPES,
} from './domain/events';
import { InvestorProfileEventTypes } from '@nestfolio/investor-profile-ctrl/events';
import { MarketIntelligenceEventTypes } from '@nestfolio/market-intelligence-ctrl/events';
import { defaultLambdaProps, NamingService } from '@nestfolio/cdk-constructs/utils';
import { DecisionWorkflowDefinition } from './constructs/decision-state-machine';

export class DecisionWorkflowCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // --- Haiku model SSM lookup (shared by Memory strategies + IAM grant) ---
    // Haiku per OQ #2 of the Phase B design spec (cost-optimal for extraction;
    // aligns with agentcore-cost-safeguards posture).
    // advisory-hub owns the cross-service model SSM parameters; read from its namespace.
    const hubNaming = new NamingService({
      prefix: props.prefix,
      subsystem: 'advisory',
      service: 'advisory-hub',
    });
    const modelHaikuId = StringParameter.valueForStringParameter(
      this,
      hubNaming.ssmParameterPath('models/haiku'),
    );
    // BedrockFoundationModel is a plain value object (not a Construct) — safe to share.
    const haikuModel = new BedrockFoundationModel(modelHaikuId);

    // --- AgentCore Memory ---
    // Four long-term MemoryStrategies (Phase B — inter-agent-state-handoff):
    //   1. InvestorPreferenceLearner (USER_PREFERENCE_MEMORY, Haiku extraction only)
    //      Namespace: /investor-profile-ctrl/{actorId}/preferences
    //   2. MarketSignalExtractor (SEMANTIC_MEMORY, Haiku extraction only)
    //      Namespace: /market-intelligence-ctrl/{actorId}/signals
    //   3. PortfolioRationaleArchivist (SEMANTIC_MEMORY, Haiku extraction only)
    //      Namespace: /portfolio-engine-ctrl/{actorId}/rationale
    //   4. NarrativeRationaleArchivist (SEMANTIC_MEMORY, Haiku extraction + consolidation)
    //      Namespace: /advisory-narrative-ctrl/{actorId}/rationale
    //      (consolidation dropped in Lever B — strategy collapsed in next commit)
    //
    // Note: AWS AgentCore enforces a hard limit of 1 namespace per MemoryStrategy
    // (surfaced at deploy: "Member must have length less than or equal to 1").
    // The original unified RationaleArchivist with 2 namespaces synthesised valid CFN
    // but was rejected at deploy time. Split into two strategies with identical prompts.
    //
    // Strategies stay empty until the 4 agent services start emitting via
    // MemoryClient.emitLongTermEvent (Tasks 6-9). The runtime path (libs/agent-orchestrator
    // memory-client.ts) still writes short-term records to:
    //   /{serviceName}/{tenantId}/decisions/{decisionId}
    // via BatchCreateMemoryRecords + ListMemoryRecords — that path is orthogonal.
    const memory = new agentcore.Memory(this, 'AgentMemory', {
      memoryName: `nestfolio_${props.prefix}_agent_memory`,
      description: 'Long-term cross-decision recall (preferences/signals/rationale)',
      expirationDuration: Duration.days(90),
      memoryStrategies: [
        agentcore.MemoryStrategy.usingUserPreference({
          name: 'InvestorPreferenceLearner',
          namespaces: ['/investor-profile-ctrl/{actorId}/preferences'],
          customExtraction: {
            model: haikuModel,
            appendToPrompt:
              'Extract investor preferences: risk tolerance level, asset class ' +
              'preferences, ESG constraints, liquidity needs, time horizon, and ' +
              'stated return targets. One fact per record. Ignore mechanical ' +
              'decision details.',
          },
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'MarketSignalExtractor',
          namespaces: ['/market-intelligence-ctrl/{actorId}/signals'],
          customExtraction: {
            model: haikuModel,
            appendToPrompt:
              'Extract market signals with cross-decision shelf life: sector ' +
              'trends, regime indicators, signal strength, and direction. Ignore ' +
              'one-off intraday noise. One signal per record.',
          },
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'PortfolioRationaleArchivist',
          namespaces: ['/portfolio-engine-ctrl/{actorId}/rationale'],
          customExtraction: {
            model: haikuModel,
            appendToPrompt:
              'Extract recommendation rationale: which assets were weighted and ' +
              'why, which constraints were binding, what trade-offs were chosen, ' +
              'and the investor-facing narrative summary including tone. One ' +
              'rationale per record, scoped to the decision it explains.',
          },
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'NarrativeRationaleArchivist',
          namespaces: ['/advisory-narrative-ctrl/{actorId}/rationale'],
          customExtraction: {
            model: haikuModel,
            appendToPrompt:
              'Extract recommendation rationale: which assets were weighted and ' +
              'why, which constraints were binding, what trade-offs were chosen, ' +
              'and the investor-facing narrative summary including tone. One ' +
              'rationale per record, scoped to the decision it explains.',
          },
          customConsolidation: {
            model: haikuModel,
            appendToPrompt:
              "Consolidate chronologically. Preserve the reasoning chain — " +
              "don't collapse distinct decisions into a summary.",
          },
        }),
      ],
    });

    // Export memoryId via SSM for agent service stacks
    new StringParameter(this, 'MemoryIdParam', {
      parameterName: this.naming.ssmParameterPath('memory/id'),
      stringValue: memory.memoryId,
    });

    // --- Bedrock extraction model grant for MemoryStrategies (Phase B) ---
    // The alpha construct property is `memory.executionRole?: iam.IRole`.
    // The JS constructor always sets it via `props.executionRole ?? this._createMemoryRole()`
    // (verified in node_modules/.../memory/memory.js:513), so for `new Memory(...)` it is
    // always defined. The `?` in the TypeScript interface covers imported memories only.
    //
    // Without this grant, MemoryStrategies silently fail to extract —
    // symptom: searchLongTermMemory returns [] forever.
    //
    // Inference profile ARN pattern matches the repo convention in
    // libs/cdk-constructs/src/extensions/agent-runtime.ts:buildBedrockModelResources.
    // SSM deploy-time token → can't inspect literal at synth; wildcard region/account
    // is the established pattern for cross-region inference profiles.
    // IAM grant for Bedrock InvokeModel. Cross-region inference profiles
    // (e.g., us.anthropic.claude-haiku-4-5-...) route to base models across
    // multiple regions, so scoping to a single-region foundation-model ARN
    // would break routing. The pair (profile ARN + foundation-model/*) is
    // the established repo pattern — see
    // libs/cdk-constructs/src/extensions/agent-runtime.ts:buildBedrockModelResources.
    const memoryModelResources = [
      `arn:aws:bedrock:*:*:inference-profile/${modelHaikuId}`,
      `arn:aws:bedrock:*::foundation-model/*`,
    ];

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    memory.executionRole!.addToPrincipalPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: memoryModelResources,
    }));

    // AssemblePacket Lambda — reads all 4 agent outputs from the SF state Parameters
    // payload (post-Phase-A 2026-05-14). No Memory reads, no eventual-consistency
    // retry loop. See docs/backlog/inter-agent-state-handoff-sf-vs-memory.md.
    const assemblePacketFn = new NodejsFunction(this, 'AssemblePacket', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'assemble-packet.ts'),
      environment: {
        TABLE_NAME: state.getTable().tableName,
      },
    });
    state.getTable().grantWriteData(assemblePacketFn);

    // --- Decision Orchestration ---
    // IMPORTANT: Use id 'DecisionStateMachine' to preserve CloudFormation logical IDs
    const decisionWorkflow = new DecisionWorkflowDefinition(this, 'DecisionWorkflow', {
      eventBus: this.eventBus,
      table: state.getTable(),
      tableName: state.getTable().tableName,
      serviceName: this.serviceName,
      assemblePacketFnArn: assemblePacketFn.functionArn,
    });

    // Direct EB → SF: 7 trigger events start the state machine. Auto-named
    // executions (no executionName field — AWS doesn't expose per-target Name
    // for the native EB→SF integration). Phase 1's fan-out collapse removed
    // the multi-event-per-action duplication that previously motivated dedup;
    // remaining at-least-once redelivery risk is theoretical and unobserved.
    const orchestration = new Orchestration(this, 'DecisionStateMachine', {
      state,
      definitionBody: decisionWorkflow.definitionBody,
      triggers: [...TRIGGER_EVENT_TYPES],
      timeout: Duration.hours(72),
    });
    assemblePacketFn.grantInvoke(orchestration.stateMachine);
    this.eventBus.grantPutEventsTo(orchestration.stateMachine);

    // CallbackIngress remains: agent completions + compliance + user responses
    // resume the SF via SendTaskSuccess. No more TriggerIngress.
    const callbackIngress = new Ingress(this, 'CallbackIngress', {
      state,
      eventTypes: [...ALL_INBOUND_EVENT_TYPES],
      entry: join(__dirname, 'handlers', 'sfn-callback.ts'),
    });
    orchestration.grantCallbackAccess(callbackIngress.handler);

    // MandateProjectorIngress — projects MandateSnapshot rows so the SF can resolve
    // operatingMode for ALL triggers via Direct DynamoDB GetItem (no Lambda).
    const mandateProjectorIngress = new Ingress(this, 'MandateProjectorIngress', {
      state,
      eventTypes: [...MANDATE_LIFECYCLE_EVENT_TYPES],
      entry: join(__dirname, 'handlers', 'mandate-projector.ts'),
    });
    void mandateProjectorIngress; // observability intentionally omitted — addObservability accepts only one ingress

    // SnapshotProjectorIngress — projects DWC-local InvestorProfileSnapshot +
    // MarketSnapshot rows from IP-ctrl and MI-ctrl snapshot events so the SF
    // (Task 9) can read pre-computed agent outputs via Direct DDB GetItem
    // without cross-service IAM grants.
    const snapshotProjectorIngress = new Ingress(this, 'SnapshotProjectorIngress', {
      state,
      eventTypes: [
        InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_CREATED,
        InvestorProfileEventTypes.INVESTOR_PROFILE_SNAPSHOT_UPDATED,
        MarketIntelligenceEventTypes.MARKET_SNAPSHOT_UPDATED,
      ],
      entry: join(__dirname, 'handlers', 'snapshot-projector.ts'),
    });
    void snapshotProjectorIngress; // observability intentionally omitted — addObservability accepts only one ingress

    // SF role: dynamodb:GetItem on the local State table for LookupMandateSnapshot.
    state.getTable().grantReadData(orchestration.stateMachine);

    // --- Egress: CDC from DDB Streams ---
    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'DecisionPacket': {
          insert: DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
          modify: DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
        },
        'AgentOutput': {
          insert: DecisionWorkflowEventTypes.AGENT_OUTPUT_CREATED,
          modify: DecisionWorkflowEventTypes.AGENT_OUTPUT_UPDATED,
        },
        'MandateSnapshot': {
          insert: DecisionWorkflowEventTypes.MANDATE_SNAPSHOT_CREATED,
          // No modify entry — operatingMode changes do NOT re-trigger first decision.
        },
      },
    });

    // --- Observability ---
    this.addObservability({
      ingress: callbackIngress,
      egress,
      orchestration,
    });
  }
}
