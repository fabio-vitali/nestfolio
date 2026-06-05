import { type Observable, type Subscription, retry, timer } from 'rxjs';

/**
 * Subscribe-before-query + reconnect-requery transport glue, shared by every
 * dashboard live-push channel (Activity feed, PortfolioSummary, future
 * surfaces). Establish the subscription BEFORE the initial snapshot query so a
 * frame arriving mid-load is not lost; on a dropped connection, re-query the
 * backing store (to recover rows missed while disconnected) and re-subscribe
 * after a short backoff.
 *
 * Pairs with a last-write-wins store setter on the consumer side: the reconnect
 * re-query is a backfill snapshot that must not clobber a newer live frame.
 *
 * Framework-free (rxjs only) so it is liftable to any MFE.
 */
export interface SubscribeThenReconcileOptions<T> {
  /**
   * The live subscription Observable (e.g. `graphql.subscribe(...)`). Must be
   * cold/re-runnable: `retry` re-subscribes to it after each drop, which
   * re-opens the underlying WebSocket.
   */
  source: Observable<T>;
  /** Applies each live frame to local state. */
  onFrame: (frame: T) => void;
  /**
   * Called on every dropped connection BEFORE re-subscribing, to re-query the
   * backing store and reconcile rows missed while disconnected. Best-effort:
   * its rejection is swallowed and must not abort the retry.
   */
  onReconnect?: () => void | Promise<void>;
  /** Backoff before re-subscribing after a drop (ms). */
  reconnectBackoffMs: number;
}

export function subscribeThenReconcile<T>(
  opts: SubscribeThenReconcileOptions<T>,
): Subscription {
  return opts.source
    .pipe(
      retry({
        delay: () => {
          if (opts.onReconnect) {
            // Swallow rejection — a failed backfill must not abort the retry.
            void Promise.resolve(opts.onReconnect()).catch(() => {});
          }
          return timer(opts.reconnectBackoffMs);
        },
      }),
    )
    .subscribe({ next: (frame) => opts.onFrame(frame) });
}
