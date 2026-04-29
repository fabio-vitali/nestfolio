import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { ComplianceEventTypes } from './domain/events';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { AdvisoryIngestEventTypes } from '@nestfolio/advisory-adpt/domain';

export class ComplianceCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        AdvisoryCtrlEventTypes.RECOMMENDATION_PROPOSED,
        AdvisoryIngestEventTypes.MANDATE_CREATED,
        AdvisoryIngestEventTypes.MANDATE_UPDATED,
        AdvisoryIngestEventTypes.OPERATING_MODE_CHANGED,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'ComplianceCheck': {
          insert: { field: 'result', map: {
            APPROVED: ComplianceEventTypes.DECISION_APPROVED,
            BLOCKED: ComplianceEventTypes.DECISION_BLOCKED,
          }},
        },
        'AuditArtifact': {
          insert: ComplianceEventTypes.AUDIT_ARTIFACT_CREATED,
          modify: ComplianceEventTypes.AUDIT_ARTIFACT_UPDATED,
        },
      },
    });

    this.addObservability({ ingress, egress });
  }
}
