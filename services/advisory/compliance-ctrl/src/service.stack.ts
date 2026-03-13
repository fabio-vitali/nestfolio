import { StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ServiceStack, Ingress, Egress } from '@nestfolio/cdk-constructs';

export class ComplianceCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: StackProps & { prefix: string }) {
    super(scope, id, { ...props, prefix: props.prefix, subsystem: 'advisory', service: 'compliance-ctrl', serviceDir: __dirname });

    const ingress = new Ingress(this, 'Ingress', {
      eventTypes: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_ENRICHED',
        'MANDATE_GRANTED',
        'MANDATE_UPDATED',
        'MANDATE_REVOKED',
        'OPERATING_MODE_CHANGED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      publishableTypes: ['ComplianceCheck', 'AuditArtifact'],
    });

    this.addObservability({ ingress, egress });
  }
}
