import type { SQSEvent, SQSBatchResponse, Context } from 'aws-lambda';
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from '@aws-sdk/client-sfn';
import { createIngestionHandler } from '../engine/create-ingestion-handler';
import { NotRetryableError, logger } from '../internal';
import type { EventPayload } from '../types/handler-config';
import type { EventContext } from '../types/event-context';
import type { WriteIntent } from '../types/write-intent';
import { skip } from '../intents/skip';

export interface ResumeStateMachineConfig {
  serviceName: string;
  handlers: Record<string, ResumeHandler>;
  table?: string;
  bus?: string;
  errorEventType?: string;
}

export type ResumeHandler = (
  payload: EventPayload,
  ctx: EventContext,
) => Promise<{ output: Record<string, unknown>; intents?: WriteIntent[] }>;

export function resumeStateMachine(
  config: ResumeStateMachineConfig,
): (event: SQSEvent, context?: Context) => Promise<SQSBatchResponse> {
  const sfnClient = new SFNClient({});

  const wrappedHandlers: Record<string, (payload: EventPayload, ctx: EventContext) => Promise<WriteIntent | WriteIntent[]>> = {};

  for (const [eventType, resumeHandler] of Object.entries(config.handlers)) {
    wrappedHandlers[eventType] = async (payload: EventPayload, ctx: EventContext) => {
      const taskToken = payload.subject?.taskToken as string | undefined;
      if (!taskToken) {
        throw new NotRetryableError(`Missing taskToken in ${ctx.eventType} event ${ctx.eventId}`);
      }

      try {
        const result = await resumeHandler(payload, ctx);
        const intents = result.intents ?? [];

        try {
          await sfnClient.send(new SendTaskSuccessCommand({
            taskToken,
            output: JSON.stringify(result.output),
          }));
          logger.info('State machine resumed', { eventType: ctx.eventType, taskToken: taskToken.slice(0, 20) });
        } catch (sfnError: unknown) {
          if (sfnError instanceof Error && (
            sfnError.name === 'TaskTimedOut' ||
            sfnError.name === 'InvalidToken' ||
            sfnError.name === 'TaskDoesNotExist'
          )) {
            logger.info('SF task already resolved, treating duplicate as success', {
              eventType: ctx.eventType,
              eventId: ctx.eventId,
              sfnErrorName: sfnError.name,
            });
          } else {
            throw sfnError;
          }
        }

        return intents.length > 0 ? intents : skip();
      } catch (error) {
        // If it's already a NotRetryableError (e.g. missing token), just re-throw
        if (error instanceof NotRetryableError) {
          throw error;
        }

        const err = error instanceof Error ? error : new Error(String(error));

        try {
          // SendTaskFailure field limits: error <= 256 chars, cause <= 32768 chars.
          // Convention: `error` is the short error code (err.name), `cause` is the
          // human-readable description (err.message). Truncate both defensively.
          await sfnClient.send(new SendTaskFailureCommand({
            taskToken,
            error: (err.name || 'Error').slice(0, 256),
            cause: (err.message || '').slice(0, 32768),
          }));
        } catch (sfnError) {
          logger.error('Failed to send task failure to SFN', { sfnError, originalError: err.message });
        }

        throw error;
      }
    };
  }

  return createIngestionHandler({
    serviceName: config.serviceName,
    handlers: wrappedHandlers,
    table: config.table ?? process.env.TABLE_NAME,
    bus: config.bus ?? process.env.BUS_NAME,
    errorEventType: config.errorEventType,
  });
}
