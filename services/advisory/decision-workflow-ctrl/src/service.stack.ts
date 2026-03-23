import { join } from 'path';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { BedrockFoundationModel } from '@aws-cdk/aws-bedrock-alpha';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { NamingService, defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { DecisionStateMachine } from './constructs/decision-state-machine';
import {
  TRIGGER_EVENT_TYPES,
  AGENT_COMPLETION_EVENT_TYPES,
  COMPLIANCE_EVENT_TYPES,
  USER_RESPONSE_EVENT_TYPES,
} from './domain/events';

export class DecisionWorkflowCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

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
          namespaces: ['/advisory-narrative/{actorId}/sessions'],
        }),
      ],
    });

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
        TABLE_NAME: this.state.getTable().tableName,
      },
    });
    memory.grantRead(assemblePacketFn);
    this.state.getTable().grantWriteData(assemblePacketFn);

    // --- State machine ---
    const decisionSm = new DecisionStateMachine(this, 'DecisionStateMachine', {
      eventBus: this.eventBus,
      table: this.state.getTable(),
      serviceName: this.serviceName,
      assemblePacketFnArn: assemblePacketFn.functionArn,
    });
    const { stateMachine } = decisionSm;

    // Grant the state machine permission to invoke the AssemblePacket Lambda
    assemblePacketFn.grantInvoke(stateMachine);

    // --- Ingress 1: Trigger events → materializeToTable (event-listener.ts) ---
    const triggerIngress = new Ingress(this, 'TriggerIngress', {
      eventTypes: [...TRIGGER_EVENT_TYPES],
    });

    // --- Ingress 2: Callback events → resumeStateMachine (sfn-callback.ts) ---
    const callbackEventTypes = [
      ...AGENT_COMPLETION_EVENT_TYPES,
      ...COMPLIANCE_EVENT_TYPES,
      ...USER_RESPONSE_EVENT_TYPES,
    ];
    const callbackIngress = new Ingress(this, 'CallbackIngress', {
      eventTypes: callbackEventTypes,
      entry: join(__dirname, 'handlers', 'sfn-callback.ts'),
    });

    // Grant callback Lambda permissions to send task tokens to Step Functions
    stateMachine.grantTaskResponse(callbackIngress.handler);

    // --- Egress: CDC from DDB Streams ---
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['WorkflowTrigger', 'DecisionPacket', 'AgentOutput'],
    });

    // --- Observability ---
    this.addObservability({ ingress: triggerIngress, egress });
  }
}
