import { EventBusTrap } from '@nestfolio/integration-testing';
import type { TestContext } from '@nestfolio/test-support';

/**
 * Thin wrapper around EventBusTrap that captures a CDC-emitted event and
 * exposes its `detail.subject` for DRY-wire assertions.
 *
 * Usage pattern:
 *   1. `const trap = await armEventSubjectTrap(ctx, { bus: 'ledger', detailType: 'BALANCE_UPDATED' });`
 *      — call BEFORE any fixture or action that triggers the CDC emission.
 *   2. Trigger the flow (applyFixtures, putEvent, mutation, …).
 *   3. `const subject = await trap.waitForSubject();`
 *      — long-polls SQS until the matching event arrives, returns `detail.subject`.
 *   4. Assert the subject parses against its contract AND lacks identity keys.
 *   5. `await trap.dispose();` — tears down the EB rule + SQS queue.
 *      (The trap also auto-registers with ctx.cleanup, so dispose() is safe but
 *      not strictly required when afterEach already calls ctx.cleanup.runAll().)
 *
 * DRY-wire assertion pattern (use in each gate `it`):
 *
 *   const subject = await trap.waitForSubject(120_000);
 *   expectContractMatch(SomeSchema, subject, 'SomeRow.subject');
 *   // Identity stays in context — not on the subject:
 *   expect((subject as Record<string, unknown>).pk).toBeUndefined();
 *   expect((subject as Record<string, unknown>).sk).toBeUndefined();
 *   expect((subject as Record<string, unknown>).__typename).toBeUndefined();
 *   expect((subject as Record<string, unknown>).tenantId).toBeUndefined();
 */
export interface EventSubjectTrap {
  /** Poll for the first matching event and return its `detail.subject`. */
  waitForSubject(timeoutMs?: number): Promise<Record<string, unknown>>;
  /**
   * Tear down the EB rule and SQS queue.
   * Idempotent — ctx.cleanup auto-calls this; calling it again is safe.
   */
  dispose(): Promise<void>;
}

export async function armEventSubjectTrap(
  ctx: TestContext,
  params: {
    bus: string;
    detailType: string;
    /** Default: ctx.timings.eventTimeout (typically 60s). */
    defaultTimeoutMs?: number;
  },
): Promise<EventSubjectTrap> {
  const trap = new EventBusTrap(ctx);
  await trap.deploy({ bus: params.bus, detailType: params.detailType });

  return {
    async waitForSubject(timeoutMs?: number): Promise<Record<string, unknown>> {
      const event = await trap.waitForEvent({
        detailType: params.detailType,
        timeoutMs: timeoutMs ?? params.defaultTimeoutMs,
      });
      const subject = (event.detail as Record<string, unknown>)['subject'];
      if (subject === undefined || subject === null) {
        throw new Error(
          `EventSubjectTrap.waitForSubject: event ${params.detailType} carried no detail.subject. ` +
            `Full detail: ${JSON.stringify(event.detail).slice(0, 500)}`,
        );
      }
      return subject as Record<string, unknown>;
    },
    async dispose(): Promise<void> {
      await trap.teardown();
    },
  };
}
