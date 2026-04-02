import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';

export class ComplianceCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        'DECISION_PACKET_CREATED',
        'DECISION_PACKET_UPDATED',
        'MANDATE_CREATED',
        'MANDATE_UPDATED',
        'OPERATING_MODE_CHANGED',
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'ComplianceCheck': {
          insert: { field: 'result', map: {
            APPROVED: 'DECISION_APPROVED',
            BLOCKED: 'DECISION_BLOCKED',
          }},
        },
        'AuditArtifact': 'AUDIT_ARTIFACT',
      },
    });

    this.addObservability({ ingress, egress });
  }
}
