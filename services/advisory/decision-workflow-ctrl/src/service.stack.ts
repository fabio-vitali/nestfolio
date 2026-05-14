import { join } from 'path';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Orchestration } from '@nestfolio/cdk-constructs/core';
import {
  TRIGGER_EVENT_TYPES,
  ALL_INBOUND_EVENT_TYPES,
  DecisionWorkflowEventTypes,
  MANDATE_LIFECYCLE_EVENT_TYPES,
} from './domain/events';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { DecisionWorkflowDefinition } from './constructs/decision-state-machine';

export class DecisionWorkflowCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    // --- AgentCore Memory ---
    // Per-decision short-term store only. The runtime path (libs/agent-orchestrator
    // memory-client.ts) writes to `/{serviceName}/{tenantId}/decisions/{decisionId}`
    // via BatchCreateMemoryRecords + ListMemoryRecords. No MemoryStrategy is fed
    // by that path, so none is provisioned. Cross-decision learning would require
    // a design workstream to align strategy namespaces with runtime writes.
    const memory = new agentcore.Memory(this, 'AgentMemory', {
      memoryName: `nestfolio_${props.prefix}_agent_memory`,
      description: 'Per-decision short-term agent memory (no long-term strategies)',
      expirationDuration: Duration.days(90),
    });

    // Export memoryId via SSM for agent service stacks
    new StringParameter(this, 'MemoryIdParam', {
      parameterName: this.naming.ssmParameterPath('memory/id'),
      stringValue: memory.memoryId,
    });

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
