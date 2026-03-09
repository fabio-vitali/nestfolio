import { Injectable } from '@angular/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: { name: string; message: string; stack?: string };
}

@Injectable({ providedIn: 'root' })
export class LoggerService {
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
    console.error(JSON.stringify(entry));
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const entry = this.buildEntry(level, message, context);
    const method = level === 'debug' ? 'debug' : level === 'warn' ? 'warn' : 'log';
    console[method](JSON.stringify(entry));
  }

  private buildEntry(level: LogLevel, message: string, context?: Record<string, unknown>): LogEntry {
    return {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(context ? { context } : {}),
    };
  }
}
