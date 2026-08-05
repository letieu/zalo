import { getWorkerNames } from '@/lib/events/bus';

// Side-effect imports: each worker self-registers on the event bus.
import './task-worker';
import './memory-worker';
import './summary-worker';
import './contact-worker';
import './embedding-worker';

/**
 * Call once at boot (before draining the outbox) so every worker is
 * registered. Returns the registered worker names for observability.
 */
export function ensureWorkersRegistered(): string[] {
  return getWorkerNames();
}
