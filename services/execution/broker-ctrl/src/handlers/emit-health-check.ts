import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { CircuitBreakerRepository } from '../repositories/circuit-breaker.repository';
import { BrokerCtrlRoutedEventTypes } from '../domain/events';
import { logger, requireEnv, getUUID, getTime } from '@nestfolio/event-processor';

const TABLE_NAME = requireEnv('TABLE_NAME');
const BUS_NAME = requireEnv('BUS_NAME');
const SERVICE_NAME = 'broker-ctrl';
const REGION = process.env.AWS_REGION ?? 'us-east-1';

const circuitBreakerRepo = new CircuitBreakerRepository(TABLE_NAME);
const eb = new EventBridgeClient({});

export interface EmitHealthCheckEvent {
  tenantId: string;
  userId: string;
  symbol: string;
  taskToken: string;
  attemptCount: number;
}

/**
 * Small Lambda invoked by the circuit-breaker-heal SF with waitForTaskToken.
 *
 * 1. Stores the healTaskToken on the CircuitBreaker DDB record so that
 *    CallbackResolver can look it up when the ALPACA_ACCOUNT_SNAPSHOT arrives.
 * 2. Emits ALPACA_ACCOUNT_CHECK to EventBridge so the Alpaca adapter polls
 *    account health.
 */
export async function handler(event: EmitHealthCheckEvent) {
  const { tenantId, symbol, taskToken } = event;

  logger.info('Storing healTaskToken and emitting health check', { tenantId, symbol });

  // 1. Store healTaskToken on CircuitBreaker record
  await circuitBreakerRepo.storeHealTaskToken(tenantId, symbol, taskToken);

  // 2. Emit ALPACA_ACCOUNT_CHECK
  const detail = {
    id: getUUID(),
    type: BrokerCtrlRoutedEventTypes.ALPACA_ACCOUNT_CHECK,
    timestamp: getTime(),
    subject: { symbol },
    context: { tenantId, userId: event.userId, region: REGION },
  };
  const response = await eb.send(new PutEventsCommand({
    Entries: [{
      EventBusName: BUS_NAME,
      Source: `${BUS_NAME}@${SERVICE_NAME}`,
      DetailType: BrokerCtrlRoutedEventTypes.ALPACA_ACCOUNT_CHECK,
      Detail: JSON.stringify(detail),
    }],
  }));

  if (response.FailedEntryCount && response.FailedEntryCount > 0) {
    throw new Error(`Failed to emit ALPACA_ACCOUNT_CHECK: ${JSON.stringify(response.Entries)}`);
  }

  logger.info('Health check emitted', { tenantId, symbol });
}
