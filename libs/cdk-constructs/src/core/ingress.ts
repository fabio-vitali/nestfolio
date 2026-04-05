import { join } from 'path';
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { CfnRule, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { ServiceStack } from './service-stack';
import { State } from './state';
import { defaultLambdaProps } from '../utils/default-lambda-props';

export interface IngressProps {
  eventTypes: string[];
  /** State construct for DynamoDB/S3 grants. Optional — stateless adapters have no state. */
  state?: State;
  /** Path to the event listener handler file. Default: join(serviceDir, 'handlers', 'event-listener.ts') */
  entry?: string;
  /** Extra environment variables merged into the Lambda */
  environment?: Record<string, string>;
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  batchSize?: number;
  maxBatchingWindowMs?: number;
  /** Maximum batching window as CDK Duration. Takes precedence over maxBatchingWindowMs. */
  maxBatchingWindow?: Duration;
  maxRetries?: number;
  /** Visibility timeout for the SQS queue. If not set but lambdaTimeout is provided, auto-calculated as 6x lambdaTimeout. */
  visibilityTimeout?: Duration;
  /** Lambda timeout. Used to auto-calculate visibilityTimeout = 6 x lambdaTimeout when visibilityTimeout is not set. */
  lambdaTimeout?: Duration;
}

export class Ingress extends Construct {
  readonly handler: NodejsFunction;
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

    const serviceStack = ServiceStack.of(this);
    const { eventBus, serviceName, serviceDir } = serviceStack;
    const state = props.state;

    const entry = props.entry ?? join(serviceDir, 'handlers', 'event-listener.ts');

    // Build environment from State + bus + extras
    const env: Record<string, string> = {
      SERVICE_NAME: serviceName,
      BUS_NAME: eventBus.eventBusName,
    };
    if (state?.table) {
      env['TABLE_NAME'] = state.getTable().tableName;
    }
    if (state?.bucket) {
      env['BUCKET_NAME'] = state.getBucket().bucketName;
    }
    if (props.environment) {
      Object.assign(env, props.environment);
    }

    // Create Lambda
    this.handler = new NodejsFunction(this, 'Handler', {
      ...defaultLambdaProps(this),
      ...props.lambdaProps,
      entry,
      environment: env,
    });

    // IAM: State grants
    if (state?.table) {
      state.getTable().grantReadWriteData(this.handler);
    }
    if (state?.bucket) {
      state.getBucket().grantReadWrite(this.handler);
    }

    // IAM: PutEvents for publishErrorEvent
    this.handler.addToRolePolicy(new PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [
        `arn:aws:events:${Stack.of(this).region}:${Stack.of(this).account}:event-bus/${eventBus.eventBusName}`,
      ],
    }));

    // SQS: DLQ + Queue
    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.KMS_MANAGED,
    });

    const visibilityTimeout = props.visibilityTimeout
      ?? (props.lambdaTimeout
        ? Duration.seconds(6 * props.lambdaTimeout.toSeconds())
        : Duration.seconds(180));

    this.queue = new Queue(this, 'Queue', {
      visibilityTimeout,
      encryption: QueueEncryption.KMS_MANAGED,
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: props.maxRetries ?? 10,
      },
    });

    // EventBridge Rule -> SQS
    // Source filter via $or: pass normal events + test events targeting this service only
    // Note: array-level OR with mixed content filters (anything-but + prefix) doesn't work
    // for SQS targets despite passing test-event-pattern validation. Use $or instead.
    const rule = new Rule(this, 'Rule', {
      eventBus,
      eventPattern: { detailType: props.eventTypes },
      targets: [new SqsQueue(this.queue)],
    });

    // Override with $or pattern at L1 level (CDK EventPattern doesn't support $or)
    const cfnRule = rule.node.defaultChild as CfnRule;
    cfnRule.addPropertyOverride('EventPattern', JSON.stringify({
      '$or': [
        {
          'detail-type': props.eventTypes,
          'source': [{ 'anything-but': { 'prefix': 'integration-test:' } }],
        },
        {
          'detail-type': props.eventTypes,
          'source': [{ 'prefix': `integration-test:${serviceName}` }],
        },
      ],
    }));

    // SQS -> Lambda
    const batchingWindow = props.maxBatchingWindow
      ?? Duration.millis(props.maxBatchingWindowMs ?? 1000);

    this.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: batchingWindow,
      reportBatchItemFailures: true,
    }));
  }
}
