import { join } from 'path';
import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class ExecutionCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['DECISION_APPROVED', 'USER_CONFIRMED', 'CIRCUIT_BREAKER_TRIGGERED', 'CIRCUIT_BREAKER_RESET', 'ACCOUNT_CLOSURE_REQUESTED'],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['Order', 'StagedOrder'],
      handlerEntry: join(__dirname, 'handlers/event-publisher.ts'),
    });

    this.addObservability({ ingress, egress });
  }
}
