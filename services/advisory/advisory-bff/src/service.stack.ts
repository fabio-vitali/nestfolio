import { Construct } from 'constructs';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
import { AdvisoryBffEventTypes } from './domain/events';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';

export class AdvisoryBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED,
        AdvisoryCtrlEventTypes.DECISION_PACKET_UPDATED,
        ComplianceEventTypes.DECISION_APPROVED,
        ComplianceEventTypes.DECISION_BLOCKED,
        AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'DecisionReadModel': {
          insert: AdvisoryBffEventTypes.DECISION_READ_MODEL_CREATED,
          modify: AdvisoryBffEventTypes.DECISION_READ_MODEL_UPDATED,
        },
        'UserInteraction': {
          insert: AdvisoryBffEventTypes.USER_INTERACTION_CREATED,
          modify: AdvisoryBffEventTypes.USER_INTERACTION_UPDATED,
        },
        'UserConfirmation': { insert: AdvisoryBffEventTypes.USER_CONFIRMED },
        'UserRejection': { insert: AdvisoryBffEventTypes.USER_REJECTED },
      },
    });

    new Facade(this, 'Facade', {
      state,
      userPoolSsmPath: `/nestfolio/${this.prefix}-investor/auth/userPoolId`,
      jsResolvers: discoverJsResolvers(__dirname, {
        // Pre-step reads the existing DecisionReadModel so the mutation can
        // copy `taskToken` (originally stamped by the SF
        // USER_CONFIRMATION_REQUESTED state) onto the UserConfirmation /
        // UserRejection row. CDC then re-emits USER_CONFIRMED / USER_REJECTED
        // with `subject.taskToken`, closing the SF callback loop in
        // decision-workflow-ctrl/sfn-callback.ts.
        preSteps: {
          confirmDecision: ['get-decision-readback.fn.js'],
          rejectDecision: ['get-decision-readback.fn.js'],
        },
        extraSteps: {
          confirmDecision: ['get-decision-readback.fn.js'],
          rejectDecision: ['get-decision-readback.fn.js'],
        },
      }),
    });

    new MfeBucket(this, 'MfeBucket', { mfeKey: 'advisory' });

    this.addObservability({ ingress, egress });
  }
}
