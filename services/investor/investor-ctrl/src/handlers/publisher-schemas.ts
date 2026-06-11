import { NotificationCreatedSchema, MonthlyReportSchema } from '../domain/contracts';

export const subjectSchemas = {
  Notification: NotificationCreatedSchema,
  MonthlyReport: MonthlyReportSchema,
};

export const exemptTypenames: string[] = [];
