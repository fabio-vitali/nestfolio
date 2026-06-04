import { join } from 'path';
import { Construct } from 'constructs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { ServiceStack, ServiceStackProps, State, Ingress, Egress, Facade, discoverJsResolvers } from '@nestfolio/cdk-constructs/core';
import { MfeBucket } from '@nestfolio/cdk-constructs/extensions';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
import { AdvisoryBffEventTypes } from './domain/events';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';

export class AdvisoryBffStack extends ServiceStack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, { ...props, serviceDir: __dirname });

    const state = new State(this, 'State');

    const ingress = new Ingress(this, 'Ingress', {
      state,
      // advisory-bff is a P1 versioned projection of the single authoritative
      // DecisionPacket producer: it subscribes to the full-row CDC snapshots
      // (CREATED + UPDATED), whose effects arrive inside the versioned snapshot.
      // WS-2 adds the two SF-direct cycle-lifecycle events (emitted by
      // decision-workflow-ctrl BEFORE any DecisionPacket exists): STARTED →
      // GENERATING (v0), FAILED → FAILED (v1), projected onto the same
      // DecisionReadModel row via the version guard. The Ingress $or source
      // filter already accepts the SF-direct source (bare serviceName).
      eventTypes: [
        DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
        DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
        DecisionWorkflowEventTypes.DECISION_CYCLE_STARTED,
        DecisionWorkflowEventTypes.DECISION_CYCLE_FAILED,
      ],
    });

    const egress = new Egress(this, 'Egress', {
      state,
      eventTypes: {
        'DecisionReadModel': {
          insert: AdvisoryBffEventTypes.DECISION_READ_MODEL_CREATED,
          modify: AdvisoryBffEventTypes.DECISION_READ_MODEL_UPDATED,
        },
        'AdvisoryStatus': {
          insert: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
          modify: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
        },
        'UserInteraction': {
          insert: AdvisoryBffEventTypes.USER_INTERACTION_CREATED,
          modify: AdvisoryBffEventTypes.USER_INTERACTION_UPDATED,
        },
        'UserConfirmation': { insert: AdvisoryBffEventTypes.USER_CONFIRMED },
        'UserRejection': { insert: AdvisoryBffEventTypes.USER_REJECTED },
      },
    });

    const facade = new Facade(this, 'Facade', {
      state,
      enableIamAuth: true,
      userPoolSsmPath: `/nestfolio/${this.prefix}-investor/auth/userPoolId`,
      jsResolvers: discoverJsResolvers(__dirname, {
        noneDataSource: ['publishDecisionUpdate'],
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

    const decisionPublisher = new NodejsFunction(this, 'DecisionPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'decision-publisher.ts'),
      environment: facade.graphqlUrl ? { APPSYNC_URL: facade.graphqlUrl } : {},
    });
    decisionPublisher.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        retryAttempts: 3,
      }),
    );
    if (facade.api) {
      decisionPublisher.addToRolePolicy(new PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${facade.api.arn}/*`],
      }));
    }

    // P3 derived aggregate: recompute AdvisoryStatus.inFlightCount post-commit by
    // counting non-terminal DecisionReadModel rows. A second DDB-stream consumer
    // (alongside DecisionPublisher) so the count is always a pure function of the
    // projected rows — replacing the prior two-writer accumulate() race.
    const advisoryStatusProjector = new NodejsFunction(this, 'AdvisoryStatusProjector', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'advisory-status-projector.ts'),
      environment: { TABLE_NAME: state.getTable().tableName },
    });
    advisoryStatusProjector.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      retryAttempts: 3,
    }));
    state.getTable().grantReadWriteData(advisoryStatusProjector);

    this.addObservability({ ingress, egress });
  }
}
