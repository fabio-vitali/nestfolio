import { join } from 'path';
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { ServiceStack } from './service-stack';
import { State } from './state';
import { defaultLambdaProps } from '../utils/default-lambda-props';

export interface EgressProps {
  /** State construct — required for DynamoDB Streams CDC */
  state: State;
  /** DynamoDB __typename values to publish events for */
  publishableTypes: string[];
  /** Path to the CDC handler file. Default: join(serviceDir, 'handlers', 'event-publisher.ts') */
  entry?: string;
  /** Extra environment variables merged into the Lambda */
  environment?: Record<string, string>;
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  /** DynamoDB Streams retry attempts before sending to DLQ. Default: 3 */
  retryAttempts?: number;
  /** DynamoDB Streams batch size. Default: DynamoDB stream default */
  batchSize?: number;
}

export class Egress extends Construct {
  readonly handler: NodejsFunction;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: EgressProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { eventBus, serviceName, serviceDir } = serviceStack;
    const state = props.state;

    const entry = props.entry ?? join(serviceDir, 'handlers', 'event-publisher.ts');

    // Build environment from State + bus + extras
    const env: Record<string, string> = {
      SERVICE_NAME: serviceName,
      BUS_NAME: eventBus.eventBusName,
    };
    if (state.table) {
      env['TABLE_NAME'] = state.getTable().tableName;
    }
    if (state.bucket) {
      env['BUCKET_NAME'] = state.getBucket().bucketName;
    }
    if (props.environment) {
      Object.assign(env, props.environment);
    }

    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    this.handler = new NodejsFunction(this, 'Publisher', {
      ...defaultLambdaProps(this),
      ...props.lambdaProps,
      entry,
      environment: env,
    });

    // IAM: State grants
    if (state.table) {
      state.getTable().grantReadWriteData(this.handler);
    }
    if (state.bucket) {
      state.getBucket().grantReadWrite(this.handler);
    }

    // IAM: PutEvents
    this.handler.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [
        `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${eventBus.eventBusName}`,
      ],
    }));

    this.handler.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      bisectBatchOnError: true,
      retryAttempts: props.retryAttempts ?? 3,
      batchSize: props.batchSize,
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
