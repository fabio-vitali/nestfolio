import { ComplianceCheckSchema } from '../domain/contracts';

export const subjectSchemas = {
  ComplianceCheck: ComplianceCheckSchema,
};

export const exemptTypenames: string[] = ['AuditArtifact'];
