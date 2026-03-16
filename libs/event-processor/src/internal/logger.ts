import { Logger } from '@aws-lambda-powertools/logger';

/**
 * Shared logger instance — service name derived from Lambda function name.
 */
export const logger = new Logger({
  serviceName: process.env.AWS_LAMBDA_FUNCTION_NAME ?? 'local',
  logLevel: (process.env.LOG_LEVEL as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR') ?? 'INFO',
});
