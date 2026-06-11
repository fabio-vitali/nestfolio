import { OrderSchema, StagedOrderSchema } from '../domain/contracts';

export const subjectSchemas = {
  Order: OrderSchema,
  StagedOrder: StagedOrderSchema,
};

export const exemptTypenames: string[] = [];
