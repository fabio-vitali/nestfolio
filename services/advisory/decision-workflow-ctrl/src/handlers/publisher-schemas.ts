import { DecisionPacketSchema, MandateSnapshotSchema } from '../domain/contracts';

export const subjectSchemas = {
  DecisionPacket: DecisionPacketSchema,
  MandateSnapshot: MandateSnapshotSchema,
};

export const exemptTypenames: string[] = [];
