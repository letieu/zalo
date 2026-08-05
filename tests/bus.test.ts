import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { registerWorker, drainOutbox, getWorkerNames } from '@/lib/events/bus';
import { dbQueries, resetDatabase } from '@/lib/db/sqlite';

/**
 * Bus tests register their own handlers under bus-test-* names. Handlers are
 * suite-global (module cache), so they must no-op on events from other test
 * files, and every test must drain the outbox it creates.
 */

function disableAutoWorkers() {
  dbQueries.updateSettings({
    auto_task_extraction: false,
    auto_task_completion: false,
    auto_memory_extraction: false,
    auto_summary: false,
    auto_embeddings: false,
  });
}

beforeEach(() => {
  resetDatabase();
});

afterEach(() => {
  // Never leave events behind for other test files.
  drainOutbox().catch(() => undefined);
});

const noop = async () => {};

describe('registerWorker', () => {
  it('is idempotent (dev hot-reload safety)', () => {
    registerWorker('bus-test-dup', noop);
    registerWorker('bus-test-dup', noop);
    const names = getWorkerNames();
    expect(names.filter(n => n === 'bus-test-dup')).toHaveLength(1);
  });
});

describe('drainOutbox', () => {
  it('delivers each event to each worker exactly once', async () => {
    const seen: Array<{ eventId: string; worker: string }> = [];
    registerWorker('bus-test-a', async (e) => { seen.push({ eventId: e.id, worker: 'a' }); });
    registerWorker('bus-test-b', async (e) => { seen.push({ eventId: e.id, worker: 'b' }); });

    const evt1 = dbQueries.publishEvent('message.saved', { message_id: 'm1' });
    const evt2 = dbQueries.publishEvent('message.saved', { message_id: 'm2' });

    const first = await drainOutbox();
    expect(first.failed).toBe(0);
    expect(seen).toEqual([
      { eventId: evt1.id, worker: 'a' },
      { eventId: evt1.id, worker: 'b' },
      { eventId: evt2.id, worker: 'a' },
      { eventId: evt2.id, worker: 'b' },
    ]);

    // Second drain: nothing re-runs (log rows persist; deliveries are the proof).
    const second = await drainOutbox();
    expect(second.delivered).toBe(0);
    expect(seen).toHaveLength(4);
    expect(dbQueries.isEventDelivered(evt1.id, 'bus-test-a')).toBe(true);
    expect(dbQueries.isEventDelivered(evt2.id, 'bus-test-b')).toBe(true);
  });

  it('isolates a failing worker: others still delivered, failure retried next drain', async () => {
    const okRuns: string[] = [];
    let flakyRuns = 0;
    registerWorker('bus-test-ok', async (e) => { okRuns.push(e.id); });
    registerWorker('bus-test-flaky', async () => {
      flakyRuns++;
      if (flakyRuns === 1) throw new Error('transient');
    });

    const evt = dbQueries.publishEvent('message.saved', { message_id: 'm1' });

    const first = await drainOutbox();
    expect(first.delivered).toBeGreaterThanOrEqual(1); // handlers registered by earlier tests also consume
    expect(first.failed).toBe(1);    // bus-test-flaky
    expect(okRuns).toEqual([evt.id]);
    expect(flakyRuns).toBe(1);
    expect(dbQueries.isEventDelivered(evt.id, 'bus-test-ok')).toBe(true);
    expect(dbQueries.isEventDelivered(evt.id, 'bus-test-flaky')).toBe(false);
    // Event stays in the durable log while one worker is unconfirmed.
    expect(dbQueries.getPendingEvents().map(e => e.id)).toEqual([evt.id]);

    const second = await drainOutbox();
    expect(second.delivered).toBe(1); // flaky retried and succeeded
    expect(flakyRuns).toBe(2);
    expect(dbQueries.isEventDelivered(evt.id, 'bus-test-flaky')).toBe(true);
  });

  it('is single-flight: concurrent drain is a no-op', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(r => { release = r; });
    let entered = 0;
    registerWorker('bus-test-slow', async () => { entered++; await gate; });
    dbQueries.publishEvent('message.saved', { message_id: 'm1' });

    const p1 = drainOutbox(); // enters, hits the gate, yields
    const p2 = drainOutbox(); // sees draining=true
    const r2 = await p2;
    expect(r2).toEqual({ delivered: 0, skipped: 0, failed: 0 });
    release();
    const r1 = await p1;
    expect(r1.delivered).toBeGreaterThanOrEqual(1); // slow + every earlier handler
    expect(entered).toBe(1);
  });

  it('unknown event types are delivered harmlessly (worker decides)', async () => {
    registerWorker('bus-test-tolerant', noop);
    dbQueries.publishEvent('unknown.type' as never, { anything: true });
    const r = await drainOutbox();
    expect(r.failed).toBe(0);
  });
});
