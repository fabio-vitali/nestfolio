import { AlpacaOrderResultSchema, AlpacaTransferResultSchema, AlpacaAccountSnapshotSchema, BrokerCircuitEventSchema } from '../domain/contracts';

export const subjectSchemas = {
  AlpacaOrderResult: AlpacaOrderResultSchema,
  AlpacaTransferResult: AlpacaTransferResultSchema,
  AlpacaAccountSnapshot: AlpacaAccountSnapshotSchema,
  NormalizedEvent: BrokerCircuitEventSchema,
};

export const exemptTypenames: string[] = [];
