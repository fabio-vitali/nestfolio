import { join } from 'path';
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
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
import { NamingService, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { DecisionWorkflowDefinition } from './constructs/decision-state-machine';

export class DecisionWorkflowCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // --- AgentCore Memory ---
    const hubNaming = new NamingService({ prefix: props.prefix, subsystem: 'advisory', service: 'advisory-hub' });
    const modelSonnetId = StringParameter.valueForStringParameter(this, hubNaming.ssmParameterPath('models/sonnet'));
    const sonnetModel = new BedrockFoundationModel(modelSonnetId);

    const memory = new agentcore.Memory(this, 'AgentMemory', {
      memoryName: `nestfolio_${props.prefix}_agent_memory`,
      description: 'Shared agent memory for cross-decision learning',
      expirationDuration: Duration.days(90),
      memoryStrategies: [
        agentcore.MemoryStrategy.usingUserPreference({
          name: 'InvestorPreferenceLearner',
          namespaces: ['/investor-profile/{actorId}/preferences'],
          customExtraction: {
            model: sonnetModel,
            appendToPrompt: 'Extract investment preferences: risk tolerance level, asset class preferences, ESG constraints, liquidity needs, time horizon, and any stated return targets. Ignore conversational filler.',
          },
          customConsolidation: {
            model: sonnetModel,
            appendToPrompt: 'When consolidating investor preferences, newer statements override older ones for the same dimension. Flag contradictions (e.g., high growth vs conservative).',
          },
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'MarketSignalExtractor',
          namespaces: ['/market-intelligence/{actorId}/signals'],
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'AllocationRationaleExtractor',
          namespaces: ['/portfolio-engine/{actorId}/rationale'],
          customExtraction: {
            model: sonnetModel,
            appendToPrompt: 'Extract portfolio allocation rationale: why each asset class was weighted, which constraints were binding, what trade-offs were made, and confidence level of each recommendation.',
          },
          customConsolidation: {
            model: sonnetModel,
            appendToPrompt: 'Consolidate allocation rationale chronologically. Preserve the reasoning chain — don\'t collapse distinct decisions into a summary.',
          },
        }),
        agentcore.MemoryStrategy.usingUserPreference({
          name: 'NarrativePreferenceLearner',
          namespaces: ['/advisory-narrative/{actorId}/preferences'],
          customExtraction: {
            model: sonnetModel,
            appendToPrompt: 'Extract communication preferences: preferred explanation depth (simple/detailed), terminology level (retail/professional), format preferences (bullet points/prose), and topics the investor engages with most.',
          },
          customConsolidation: {
            model: sonnetModel,
            appendToPrompt: 'Consolidate communication preferences using most recent signals. Weight explicit feedback (I prefer simpler explanations) higher than inferred patterns.',
          },
        }),
        agentcore.MemoryStrategy.usingSummarization({
          name: 'NarrativeSessionSummarizer',
          namespaces: ['/advisory-narrative/{actorId}/sessions/{sessionId}'],
        }),
      ],
    });

    // Grant Memory execution role Bedrock access scoped to inference profiles + foundation models
    if (memory.executionRole) {
      memory.executionRole.addToPrincipalPolicy(new PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream', 'bedrock:GetFoundationModel', 'bedrock:GetInferenceProfile'],
        resources: [
          `arn:aws:bedrock:${Stack.of(this).region}:*:inference-profile/us.*`,
          `arn:aws:bedrock:${Stack.of(this).region}::foundation-model/*`,
        ],
      }));
    }

    // Export memoryId via SSM for agent service stacks
    new StringParameter(this, 'MemoryIdParam', {
      parameterName: this.naming.ssmParameterPath('memory/id'),
      stringValue: memory.memoryId,
    });

    // AssemblePacket Lambda — reads all 4 agent outputs from Memory at assembly time
    const assemblePacketFn = new NodejsFunction(this, 'AssemblePacket', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'assemble-packet.ts'),
      environment: {
        MEMORY_ID: memory.memoryId,
        TABLE_NAME: state.getTable().tableName,
      },
    });
    memory.grantRead(assemblePacketFn);
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
