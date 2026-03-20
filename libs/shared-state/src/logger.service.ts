import { Injectable } from '@angular/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Breadcrumb {
  message: string;
  timestamp: string;
  data?: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
  breadcrumbs?: Breadcrumb[];
}

@Injectable({ providedIn: 'root' })
export class LoggerService {
  private context: Record<string, unknown> = {};
  private breadcrumbs: Breadcrumb[] = [];
  private readonly MAX_BREADCRUMBS = 20;

  setContext(ctx: Record<string, unknown>): void {
    this.context = { ...this.context, ...ctx };
  }

  clearContext(): void {
    this.context = {};
    this.breadcrumbs = [];
  }

  addBreadcrumb(message: string, data?: unknown): void {
    this.breadcrumbs.push({ message, timestamp: new Date().toISOString(), data });
    if (this.breadcrumbs.length > this.MAX_BREADCRUMBS) {
      this.breadcrumbs.shift();
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    const entry = this.buildEntry('error', message, context);
    if (error instanceof Error) {
      entry.error = { name: error.name, message: error.message, stack: error.stack };
    } else if (error !== undefined) {
      entry.error = { name: 'UnknownError', message: String(error) };
    }
    // Include breadcrumbs on errors for debugging
    if (this.breadcrumbs.length > 0) {
      entry.breadcrumbs = [...this.breadcrumbs];
    }
    // eslint-disable-next-line no-console
    console.error(JSON.stringify(entry));
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry = this.buildEntry(level, message, context);
    const method = level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : 'log';
    // eslint-disable-next-line no-console
    console[method](JSON.stringify(entry));
  }

  private buildEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
    const mergedContext = Object.keys(this.context).length > 0 || context
      ? { ...this.context, ...context }
      : undefined;
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(mergedContext ? { context: mergedContext } : {}),
    };
  }
}
