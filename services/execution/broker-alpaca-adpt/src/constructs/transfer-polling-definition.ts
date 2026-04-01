import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

export interface TransferPollingDefinitionProps {
  readonly pollHandlerFn: IFunction;
}

export class TransferPollingDefinition extends Construct {
  readonly definitionBody: sfn.DefinitionBody;

  constructor(scope: Construct, id: string, props: TransferPollingDefinitionProps) {
    super(scope, id);

    const { pollHandlerFn } = props;

    // 1. Extract input fields from CDC event detail
    const extractInput = new sfn.Pass(this, 'ExtractInput', {
      parameters: {
        'tenantId.$': '$.context.tenantId',
        'nestfolioTransferId.$': '$.subject.nestfolioTransferId',
        'alpacaTransferId.$': '$.subject.alpacaTransferId',
        'backoffSeconds': 60,
      },
    });

    // 2. Wait with dynamic backoff
    const wait = new sfn.Wait(this, 'Wait', {
      time: sfn.WaitTime.secondsPath('$.backoffSeconds'),
    });

    // 3. Poll transfer status
    const pollTransferStatus = new tasks.LambdaInvoke(this, 'PollTransferStatus', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'poll',
        'tenantId.$': '$.tenantId',
        'nestfolioTransferId.$': '$.nestfolioTransferId',
        'alpacaTransferId.$': '$.alpacaTransferId',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultSelector: {
        'status.$': '$.Payload.status',
        'tenantId.$': '$.Payload.tenantId',
        'nestfolioTransferId.$': '$.Payload.nestfolioTransferId',
        'alpacaTransferId.$': '$.Payload.alpacaTransferId',
        'failureReason.$': '$.Payload.failureReason',
        'backoffSeconds.$': '$.Payload.backoffSeconds',
      },
      resultPath: '$',
      retryOnServiceExceptions: false,
    });

    pollTransferStatus.addRetry({
      errors: ['States.TaskFailed'],
      interval: Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2,
    });

    // 4. Write completed
    const writeCompleted = new tasks.LambdaInvoke(this, 'WriteCompleted', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'write',
        'tenantId.$': '$.tenantId',
        'nestfolioTransferId.$': '$.nestfolioTransferId',
        'alpacaTransferId.$': '$.alpacaTransferId',
        'status': 'COMPLETED',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    const endCompleted = new sfn.Succeed(this, 'EndCompleted');

    // 5. Write failed
    const writeFailed = new tasks.LambdaInvoke(this, 'WriteFailed', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'write',
        'tenantId.$': '$.tenantId',
        'nestfolioTransferId.$': '$.nestfolioTransferId',
        'alpacaTransferId.$': '$.alpacaTransferId',
        'status': 'FAILED',
        'failureReason.$': '$.failureReason',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    const endFailed = new sfn.Succeed(this, 'EndFailed');

    // 6. Increment backoff (min(backoffSeconds * 2, 14400))
    const incrementBackoff = new sfn.Pass(this, 'IncrementBackoff', {
      parameters: {
        'tenantId.$': '$.tenantId',
        'nestfolioTransferId.$': '$.nestfolioTransferId',
        'alpacaTransferId.$': '$.alpacaTransferId',
        'backoffSeconds.$': 'States.MathAdd($.backoffSeconds, $.backoffSeconds)',
      },
    });

    // Cap backoff at 14400s (4 hours)
    const capBackoff = new sfn.Choice(this, 'CapBackoff')
      .when(sfn.Condition.numberGreaterThan('$.backoffSeconds', 14400),
        new sfn.Pass(this, 'SetMaxBackoff', {
          parameters: {
            'tenantId.$': '$.tenantId',
            'nestfolioTransferId.$': '$.nestfolioTransferId',
            'alpacaTransferId.$': '$.alpacaTransferId',
            'backoffSeconds': 14400,
          },
        }).next(wait))
      .otherwise(wait);

    // 7. Handle timeout
    const handleTimeout = new tasks.LambdaInvoke(this, 'HandleTimeout', {
      lambdaFunction: pollHandlerFn,
      payload: sfn.TaskInput.fromObject({
        'action': 'timeout',
        'tenantId.$': '$.tenantId',
        'nestfolioTransferId.$': '$.nestfolioTransferId',
        'alpacaTransferId.$': '$.alpacaTransferId',
        'backoffSeconds.$': '$.backoffSeconds',
      }),
      resultPath: sfn.JsonPath.DISCARD,
    });

    const endTimeout = new sfn.Succeed(this, 'EndTimeout');

    // 8. Check status choice
    const checkStatus = new sfn.Choice(this, 'CheckStatus')
      .when(sfn.Condition.stringEquals('$.status', 'COMPLETED'), writeCompleted)
      .when(sfn.Condition.stringEquals('$.status', 'FAILED'), writeFailed)
      .otherwise(incrementBackoff);

    // Wire the chain
    writeCompleted.next(endCompleted);
    writeFailed.next(endFailed);
    incrementBackoff.next(capBackoff);
    handleTimeout.next(endTimeout);

    pollTransferStatus.addCatch(handleTimeout, {
      errors: ['States.Timeout'],
      resultPath: '$.error',
    });

    wait.next(pollTransferStatus);
    pollTransferStatus.next(checkStatus);

    const definition = extractInput.next(wait);

    this.definitionBody = sfn.DefinitionBody.fromChainable(definition);
  }
}
