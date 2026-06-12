import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress } from '@nestfolio/cdk-constructs/core';
import { ComplianceEventTypes } from './domain/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { InvestorCrossDomainEventTypes } from '@nestfolio/investor-adpt/domain';

export class ComplianceCtrlStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.RECOMMENDATION_PROPOSED,
        InvestorCrossDomainEventTypes.MANDATE_ISSUED,
        InvestorCrossDomainEventTypes.OPERATING_MODE_CHANGED,
        InvestorCrossDomainEventTypes.MANDATE_REVOKED,
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
      },
    });

    this.addObservability({ ingress, egress });
  }
}
