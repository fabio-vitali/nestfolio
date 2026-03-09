import { Tracer } from '@aws-lambda-powertools/tracer';

/**
 * Shared Tracer instance — service name derived from Lambda function name.
 * Adds X-Ray annotations and subsegments for better observability.
 */
export const tracer = new Tracer({
  serviceName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local',
});
