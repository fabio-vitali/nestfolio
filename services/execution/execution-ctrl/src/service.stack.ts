import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class ExecutionCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props, subsystem: 'execution', service: 'execution-ctrl', serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: ['DECISION_APPROVED', 'USER_CONFIRMED', 'CIRCUIT_BREAKER_TRIGGERED', 'CIRCUIT_BREAKER_RESET', 'ACCOUNT_CLOSURE_REQUESTED'],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['Order', 'StagedOrder'],
    });

    this.addObservability({ ingress, egress });
  }
}
