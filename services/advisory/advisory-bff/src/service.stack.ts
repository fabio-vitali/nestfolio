import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs';

export class AdvisoryBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, { ...props, subsystem: 'advisory', service: 'advisory-bff', serviceDir: __dirname });

    const prefix = this.node.tryGetContext('prefix');

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_ENRICHED',
        'DECISION_APPROVED',
        'DECISION_BLOCKED',
        'USER_CONFIRMATION_REQUESTED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['DecisionReadModel', 'UserInteraction', 'UserConfirmation', 'UserRejection'],
    });

    new Facade(this, 'Facade', {
      userPoolSsmPath: `/nestfolio/${prefix}-investor/auth/userPoolId`,
      jsResolvers: discoverJsResolvers(__dirname, {
        extraSteps: {
          confirmDecision: ['get-decision-readback.fn.js'],
          rejectDecision: ['get-decision-readback.fn.js'],
        },
      }),
    });

    this.addObservability({ ingress, egress });
  }
}
