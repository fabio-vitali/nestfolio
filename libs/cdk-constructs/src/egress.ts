import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { ServiceStack } from './service-stack';
import { defaultLambdaProps } from './default-lambda-props';
import { EVENT_PUBLISHER_ENTRY } from '@nestfolio/lambda-utils';

export interface EgressProps {
  /** DynamoDB __typename values to publish events for */
  publishableTypes: string[];
  /**
   * Optional map of "__typename:eventName" -> custom DetailType.
   * e.g. { 'Deposit:INSERT': 'DEPOSIT_INITIATED' }
   * Overrides the default convention-based naming for matched keys.
   */
  customEventTypeMap?: Record<string, string>;
}

export class Egress extends Construct {
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: EgressProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { state, eventBus, serviceName } = serviceStack;

    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const publisher = new NodejsFunction(this, 'Publisher', {
      ...defaultLambdaProps(this),
      entry: EVENT_PUBLISHER_ENTRY,
      environment: {
        BUS_NAME: eventBus.eventBusName,
        SERVICE_NAME: serviceName,
        ...(props.customEventTypeMap && {
          CUSTOM_EVENT_TYPE_MAP: JSON.stringify(props.customEventTypeMap),
        }),
      },
    });

    publisher.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [
        `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${eventBus.eventBusName}`,
      ],
    }));

    publisher.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: 3,
      onFailure: new SqsDlq(this.dlq),
      filters: props.publishableTypes.flatMap(typeName => [
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('INSERT'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual(typeName) },
            },
          },
        }),
        FilterCriteria.filter({
          eventName: FilterRule.isEqual('MODIFY'),
          dynamodb: {
            NewImage: {
              __typename: { S: FilterRule.isEqual(typeName) },
            },
          },
        }),
      ]),
    }));
  }
}
