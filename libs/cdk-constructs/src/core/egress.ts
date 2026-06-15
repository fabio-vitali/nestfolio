import { join } from 'path';
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { StartingPosition, FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { ServiceStack } from './service-stack';
import { ManagedNodejsFunction } from './managed-function';
import { State } from './state';
import { defaultLambdaProps } from '../utils/default-lambda-props';
import type { EventTypesMap } from './event-types';
import { buildRuntimeConfig, collectAllEventTypes, extractFilters } from './event-types';
import type { LambdaProfile } from '../utils/lambda-profiles';

export interface EgressProps {
  /** State construct — required for DynamoDB Streams CDC */
  state: State;
  /** Declarative event type mapping: record type → event config */
  eventTypes: EventTypesMap;
  /** Path to the CDC handler file. Default: join(serviceDir, 'handlers', 'event-publisher.ts') */
  entry?: string;
  /** Extra environment variables merged into the Lambda */
  environment?: Record<string, string>;
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  /**
   * Workload profile supplying publisher Lambda and DDB Stream defaults.
   * Precedence: explicit props > profile > construct defaults.
   */
  profile?: LambdaProfile;
  /** DynamoDB Streams retry attempts before sending to DLQ. Default: 3 */
  retryAttempts?: number;
  /** DynamoDB Streams batch size. Default: DynamoDB stream default */
  batchSize?: number;
  /** DynamoDB Streams batching window. Default: unset (AWS default 0s) */
  maxBatchingWindow?: Duration;
  /** DynamoDB Streams parallelization factor. Default: unset (AWS default 1) */
  parallelizationFactor?: number;
}

export class Egress extends Construct {
  readonly handler: NodejsFunction;
  readonly dlq: Queue;
  private readonly _eventTypes: EventTypesMap;

  constructor(scope: Construct, id: string, props: EgressProps) {
    super(scope, id);

    this._eventTypes = props.eventTypes;
    const serviceStack = ServiceStack.of(this);
    const { eventBus, serviceName, serviceDir } = serviceStack;
    const state = props.state;

    const entry = props.entry ?? join(serviceDir, 'handlers', 'event-publisher.ts');

    // Build environment from State + bus + event type config
    const env: Record<string, string> = {
      SERVICE_NAME: serviceName,
      BUS_NAME: eventBus.eventBusName,
      EVENT_TYPE_MAP: JSON.stringify(buildRuntimeConfig(props.eventTypes)),
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

    // Publisher Lambda — precedence: explicit lambdaProps > profile.lambdaProps > defaultLambdaProps
    const profileLambdaProps = props.profile?.lambdaProps ?? {};
    this.handler = new ManagedNodejsFunction(this, 'Publisher', {
      ...defaultLambdaProps(this),
      ...profileLambdaProps,
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
    this.handler.addToRolePolicy(
      new PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${eventBus.eventBusName}`,
        ],
      }),
    );

    // DynamoDB Streams event source — group filters by action, OR __typename values
    // AWS limits filters to 5 per event source mapping; grouping gives max 3 (INSERT/MODIFY/REMOVE)
    const filters = extractFilters(props.eventTypes);
    const grouped = new Map<string, string[]>();
    for (const { typeName, action } of filters) {
      const list = grouped.get(action) ?? [];
      list.push(typeName);
      grouped.set(action, list);
    }
    const filterCriteria = [...grouped.entries()].map(([action, typeNames]) => {
      const imageKey = action === 'REMOVE' ? 'OldImage' : 'NewImage';
      return FilterCriteria.filter({
        eventName: FilterRule.isEqual(action),
        dynamodb: {
          [imageKey]: {
            __typename: { S: typeNames },
          },
        },
      });
    });
    // DynamoDB Streams event source — precedence: explicit prop > profile > construct default
    const profile = props.profile;
    const eventSourceBatchSize =
      props.batchSize ?? profile?.ddbStreamBatchSize;
    const eventSourceMaxBatchingWindow =
      props.maxBatchingWindow ?? profile?.ddbStreamMaxBatchingWindow;
    const eventSourceParallelizationFactor =
      props.parallelizationFactor ?? profile?.ddbStreamParallelizationFactor;

    this.handler.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        bisectBatchOnError: true,
        retryAttempts: props.retryAttempts ?? 3,
        batchSize: eventSourceBatchSize,
        maxBatchingWindow: eventSourceMaxBatchingWindow,
        parallelizationFactor: eventSourceParallelizationFactor,
        onFailure: new SqsDlq(this.dlq),
        filters: filterCriteria,
      }),
    );
  }

  /** Returns every possible event type string this service can emit. */
  allEventTypes(): string[] {
    return collectAllEventTypes(this._eventTypes);
  }
}
