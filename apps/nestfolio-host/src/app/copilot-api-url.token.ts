import { InjectionToken } from '@angular/core';

/**
 * Absolute URL of the CopilotKit bridge (CloudFront → AgentCore).
 * Sourced from RuntimeConfig.copilotApiUrl, populated by APP_INITIALIZER
 * in app.config.ts.
 */
export const COPILOT_API_URL = new InjectionToken<string>('COPILOT_API_URL');
