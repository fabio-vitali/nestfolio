import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IEventBus, Rule } from 'aws-cdk-lib/aws-events';
import { SqsQueue } from 'aws-cdk-lib/aws-events-targets';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

export interface IngressProps {
  eventBus: IEventBus;
  eventTypes: string[];
  handler: IFunction;
  batchSize?: number;
  maxBatchingWindowMs?: number;
  maxRetries?: number;
}

export class Ingress extends Construct {
  readonly queue: Queue;
  readonly dlq: Queue;

  constructor(scope: Construct, id: string, props: IngressProps) {
    super(scope, id);

    this.dlq = new Queue(this, 'DLQ', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new Queue(this, 'Queue', {
      visibilityTimeout: Duration.seconds(180),
      deadLetterQueue: {
        queue: this.dlq,
        maxReceiveCount: props.maxRetries ?? 10,
      },
    });

    new Rule(this, 'Rule', {
      eventBus: props.eventBus,
      eventPattern: {
        detailType: props.eventTypes,
      },
      targets: [new SqsQueue(this.queue)],
    });

    props.handler.addEventSource(new SqsEventSource(this.queue, {
      batchSize: props.batchSize ?? 10,
      maxBatchingWindow: Duration.millis(props.maxBatchingWindowMs ?? 1000),
      reportBatchItemFailures: true,
    }));
  }
}
