import { ErrorHandler, Injectable, inject } from '@angular/core';
import { LoggerService } from './logger.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly logger = inject(LoggerService);

  handleError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));

    this.logger.error('Unhandled error', err, {
      source: 'GlobalErrorHandler',
      url: typeof window !== 'undefined' ? window.location.href : undefined,
    });
  }
}
