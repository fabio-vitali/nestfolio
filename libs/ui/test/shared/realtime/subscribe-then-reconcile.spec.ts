import { Subject } from 'rxjs';
import { subscribeThenReconcile } from '../../../src/shared/realtime/subscribe-then-reconcile';

describe('subscribeThenReconcile', () => {
  it('applies each live frame via onFrame', () => {
    const source = new Subject<number>();
    const frames: number[] = [];
    const sub = subscribeThenReconcile({
      source,
      onFrame: (f) => frames.push(f),
      reconnectBackoffMs: 1000,
    });

    source.next(1);
    source.next(2);

    expect(frames).toEqual([1, 2]);
    sub.unsubscribe();
  });

  it('calls onReconnect once when the source errors (drop), before re-subscribing', () => {
    const source = new Subject<number>();
    const onReconnect = jest.fn();
    const sub = subscribeThenReconcile({
      source,
      onFrame: () => {},
      onReconnect,
      reconnectBackoffMs: 1000,
    });

    // A WS drop surfaces as an error on the source. retry() catches it, runs
    // onReconnect synchronously, then waits reconnectBackoffMs before
    // re-subscribing. We never advance the timer, so the (terminated) Subject
    // is never re-subscribed — mirrors the proven container reconnect test.
    source.error(new Error('ws dropped'));

    expect(onReconnect).toHaveBeenCalledTimes(1);
    sub.unsubscribe(); // cancels the pending backoff timer
  });

  it('is safe when onReconnect is omitted', () => {
    const source = new Subject<number>();
    const sub = subscribeThenReconcile({
      source,
      onFrame: () => {},
      reconnectBackoffMs: 1000,
    });

    expect(() => source.error(new Error('ws dropped'))).not.toThrow();
    sub.unsubscribe();
  });
});
