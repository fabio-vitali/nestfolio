import { join } from 'path';
import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { CfnRule, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { NodejsFunction, NodejsFunctionProps } from 'aws-cdk-lib/aws-lambda-nodejs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import type { EventName } from '@nestfolio/event-types';
import { ServiceStack } from './service-stack';
import { State } from './state';
import { defaultLambdaProps } from '../utils/default-lambda-props';
import type { LambdaProfile } from '../utils/lambda-profiles';

export interface IngressProps {
  eventTypes: EventName[];
  /** State construct for DynamoDB/S3 grants. Optional — stateless adapters have no state. */
  state?: State;
  /** Path to the event listener handler file. Default: join(serviceDir, 'handlers', 'event-listener.ts') */
  entry?: string;
  /** Extra environment variables merged into the Lambda */
  environment?: Record<string, string>;
  /** Override defaultLambdaProps (e.g. timeout, memorySize) */
  lambdaProps?: Partial<NodejsFunctionProps>;
  /**
   * Workload profile supplying Lambda and event-source defaults.
   * Precedence: explicit props > profile > construct defaults.
   */
  profile?: LambdaProfile;
  batchSize?: number;
  maxBatchingWindowMs?: number;
  /** Maximum batching window as CDK Duration. Takes precedence over maxBatchingWindowMs. */
  maxBatchingWindow?: Duration;
  /** Maximum concurrent Lambda invocations from the SQS event source. Unset = no cap. */
  maxConcurrency?: number;
  /**
   * Lambda function-level reserved concurrency cap.
   *
   * Use this alongside `maxConcurrency` to enforce effective concurrency=1 when
   * the SQS ESM `ScalingConfig.MaximumConcurrency` floor of 2 (AWS API constraint)
   * would otherwise allow 2 Lambda instances to compete for a single micro-VM slot,
   * causing the second to fail with "maxVms limit exceeded" (permanent SF task token
   * failure). Setting `reservedConcurrency: 1` lets the second batch hit Lambda
   * throttling instead — SQS re-queues it after the visibility timeout rather than
   * treating the failure as terminal.
   */
  reservedConcurrency?: number;
  maxRetries?: number;
  /** Visibility timeout for the SQS queue. Precedence: explicit prop > profile.visibilityTimeout > 6× effectiveLambdaTimeout. */
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

    // Create Lambda — precedence: explicit lambdaTimeout > explicit lambdaProps > profile.lambdaProps > defaultLambdaProps
    const profileLambdaProps = props.profile?.lambdaProps ?? {};
    const lambdaTimeoutOverride: Partial<NodejsFunctionProps> = props.lambdaTimeout
      ? { timeout: props.lambdaTimeout }
      : {};
    this.handler = new NodejsFunction(this, 'Handler', {
      ...defaultLambdaProps(this),
      ...profileLambdaProps,
      ...props.lambdaProps,
      ...lambdaTimeoutOverride,
      entry,
      environment: env,
      ...(props.reservedConcurrency !== undefined
        ? { reservedConcurrentExecutions: props.reservedConcurrency }
        : {}),
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
      encryption: QueueEncryption.SQS_MANAGED,
    });

    // Lambda timeout source (for auto-calculated visibility timeout):
    // explicit lambdaTimeout > explicit lambdaProps.timeout > profile.lambdaProps.timeout > 30s fallback
    const effectiveLambdaTimeout =
      props.lambdaTimeout
      ?? (props.lambdaProps?.timeout as Duration | undefined)
      ?? (profileLambdaProps.timeout as Duration | undefined)
      ?? Duration.seconds(30);
    const visibilityTimeout = props.visibilityTimeout
      ?? props.profile?.visibilityTimeout
      ?? Duration.seconds(6 * effectiveLambdaTimeout.toSeconds());

    this.queue = new Queue(this, 'Queue', {
      visibilityTimeout,
      encryption: QueueEncryption.SQS_MANAGED,
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
    cfnRule.addPropertyOverride('EventPattern', {
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
    });

    // SQS -> Lambda — precedence: explicit prop > profile default > construct default
    const profile = props.profile;
    const batchSize = props.batchSize ?? profile?.sqsBatchSize ?? 10;
    const batchingWindow =
      props.maxBatchingWindow
      ?? (props.maxBatchingWindowMs != null ? Duration.millis(props.maxBatchingWindowMs) : undefined)
      ?? profile?.sqsMaxBatchingWindow
      ?? Duration.seconds(1);
    const maxConcurrency = props.maxConcurrency ?? profile?.sqsMaxConcurrency;

    this.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize,
      maxBatchingWindow: batchingWindow,
      maxConcurrency,
      reportBatchItemFailures: true,
    }));
  }
}
