import { Construct } from 'constructs';
import { join } from 'path';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs';
import { DecisionStateMachine } from './constructs/decision-state-machine';
import { ALL_INBOUND_EVENT_TYPES } from './service-domain/events';

export class DecisionWorkflowCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    // --- State machine ---
    const { stateMachine } = new DecisionStateMachine(this, 'DecisionStateMachine', {
      eventBus: this.eventBus,
      table: this.state.getTable(),
      serviceName: this.serviceName,
    });

    // --- Ingress: 17 inbound event types ---
    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [...ALL_INBOUND_EVENT_TYPES],
    });

    // Grant the event-listener Lambda permissions to start executions and send task tokens
    ingress.handler.addEnvironment('STATE_MACHINE_ARN', stateMachine.stateMachineArn);
    stateMachine.grantStartExecution(ingress.handler);
    stateMachine.grantTaskResponse(ingress.handler);

    // --- Egress: CDC from DDB Streams ---
    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['DecisionPacket', 'AgentOutput', 'EditEvent'],
      handlerEntry: join(__dirname, 'handlers/event-publisher-cdc.ts'),
    });

    // --- Observability ---
    this.addObservability({ ingress, egress });
  }
}
