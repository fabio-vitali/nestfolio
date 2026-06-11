import { changeDataCapture } from '@nestfolio/event-processor';
import { subjectSchemas, exemptTypenames } from './publisher-schemas';

export const handler = changeDataCapture({ schemas: subjectSchemas, exemptTypenames });
