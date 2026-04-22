import { InjectionToken } from '@angular/core';

/**
 * Absolute URL of the CopilotKit bridge (CloudFront → AgentCore).
 * Sourced from RuntimeConfig.copilotApiUrl, populated at app bootstrap.
 */
export const COPILOT_API_URL = new InjectionToken<string>('COPILOT_API_URL');
