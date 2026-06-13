import { AlpacaOrderResultSchema, AlpacaAccountSnapshotSchema, BrokerCircuitEventSchema } from '../domain/contracts';
import { AlpacaTransferResultSchema } from '@nestfolio/execution-adpt/domain';

export const subjectSchemas = {
  AlpacaOrderResult: AlpacaOrderResultSchema,
  AlpacaTransferResult: AlpacaTransferResultSchema,
  AlpacaAccountSnapshot: AlpacaAccountSnapshotSchema,
  NormalizedEvent: BrokerCircuitEventSchema,
};

export const exemptTypenames: string[] = [];
