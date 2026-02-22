import type { BuildEvent } from '../schema/events';

/**
 * Determines whether an event should simulate a transient processing failure.
 *
 * Rule (deterministic for demo purposes):
 *   build.finished + status=failed + attempt < 3  →  fail
 *   All other cases                               →  succeed
 *
 * This means:
 *   attempt 1 → fail  (consumer will retry via TTL queue)
 *   attempt 2 → fail  (consumer will retry via TTL queue)
 *   attempt 3 → false (consumer lets it succeed, simulating recovery)
 */
export function shouldFail(event: BuildEvent): boolean {
  return (
    event.type    === 'build.finished' &&
    event.status  === 'failed'         &&
    event.attempt  <  3
  );
}

/**
 * Returns a copy of the event with the attempt counter incremented by one.
 * The traceId is intentionally preserved so all retry hops can be correlated
 * in logs and the UI.
 */
export function nextAttempt(event: BuildEvent): BuildEvent {
  return { ...event, attempt: event.attempt + 1 };
}
