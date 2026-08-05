import { dbQueries } from '@/lib/db/sqlite';
import { OutboxEvent } from '@/types';

/**
 * Event bus (spec §3): every ingest event is published once to the outbox;
 * independent workers consume it. Each worker registers under a stable name
 * and delivery is tracked per (event, worker) — so a worker crash or new
 * worker simply picks up where it left off on the next drain.
 *
 * V1 transport is the in-process drain loop over the SQLite outbox. The
 * interface is deliberately broker-shaped: swapping in BullMQ/Redis keeps
 * every worker unchanged, only drain() becomes a consumer.
 */

export type WorkerHandler = (event: OutboxEvent) => Promise<void>;

const handlers: Record<string, WorkerHandler> = {};
let draining = false;

export function registerWorker(name: string, handler: WorkerHandler): void {
  // Idempotent: Next.js dev hot-reload re-evaluates worker modules without
  // dropping the registry, so a duplicate registration is a no-op.
  if (handlers[name]) return;
  handlers[name] = handler;
}

export function getWorkerNames(): string[] {
  return Object.keys(handlers);
}

/**
 * Deliver every pending outbox event to each registered worker, exactly once
 * per worker (idempotent via event_deliveries). Errors are logged and left
 * undelivered so the next drain retries. Runs single-flight.
 */
export async function drainOutbox(): Promise<{ delivered: number; skipped: number; failed: number }> {
  if (draining) return { delivered: 0, skipped: 0, failed: 0 };
  draining = true;
  let delivered = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const events = dbQueries.getPendingEvents();
    for (const event of events) {
      for (const [name, handler] of Object.entries(handlers)) {
        if (dbQueries.isEventDelivered(event.id, name)) {
          skipped++;
          continue;
        }
        try {
          await handler(event);
          dbQueries.markEventDelivered(event.id, name);
          delivered++;
        } catch (err) {
          failed++;
          console.error(`[events] worker '${name}' failed on event ${event.id} (${event.type}):`, err);
        }
      }
    }
  } finally {
    draining = false;
  }

  if (delivered > 0 || failed > 0) {
    console.log(`[events] drain: ${delivered} delivered, ${skipped} skipped (already done), ${failed} failed`);
  }
  return { delivered, skipped, failed };
}
