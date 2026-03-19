import { join } from 'path';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as agentcore from '@aws-cdk/aws-bedrock-agentcore-alpha';
import { ServiceStack, ServiceStackProps, Ingress, Egress, defaultLambdaProps } from '@nestfolio/cdk-constructs';
import { DecisionStateMachine } from './constructs/decision-state-machine';
import { ALL_INBOUND_EVENT_TYPES } from './service-domain/events';

export class DecisionWorkflowCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    // --- AgentCore Memory ---
    const memory = new agentcore.Memory(this, 'AgentMemory', {
      memoryName: `nestfolio_${props.prefix}_agent_memory`,
      description: 'Shared agent memory for cross-decision learning',
      expirationDuration: Duration.days(90),
      memoryStrategies: [
        agentcore.MemoryStrategy.usingUserPreference({
          name: 'InvestorPreferenceLearner',
          namespaces: ['/investor-profile/{actorId}/preferences'],
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'MarketSignalExtractor',
          namespaces: ['/market-intelligence/{actorId}/signals'],
        }),
        agentcore.MemoryStrategy.usingSemantic({
          name: 'AllocationRationaleExtractor',
          namespaces: ['/portfolio-engine/{actorId}/rationale'],
        }),
        agentcore.MemoryStrategy.usingUserPreference({
          name: 'NarrativePreferenceLearner',
          namespaces: ['/advisory-narrative/{actorId}/preferences'],
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

    // --- Ingress: 17 inbound event types ---
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [...ALL_INBOUND_EVENT_TYPES],
    });

    // Grant the event-listener Lambda permissions to start executions and send task tokens
    ingress.handler.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    stateMachine.grantStartExecution(ingress.handler);
    stateMachine.grantTaskResponse(ingress.handler);

    // Grant Memory access to ingress handler
    ingress.handler.addEnvironment('MEMORY_ID', memory.memoryId);
    memory.grantWrite(ingress.handler);
    memory.grantRead(ingress.handler);

    // --- Egress: CDC from DDB Streams ---
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['DecisionPacket', 'AgentOutput', 'EditEvent'],
    });

    // --- Observability ---
    this.addObservability({ ingress, egress });
  }
}
