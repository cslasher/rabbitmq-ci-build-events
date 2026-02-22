import { randomUUID } from 'crypto';
import type { BuildEvent, EventType } from '../schema/events';

// ─── Sample data pools ────────────────────────────────────────────────────────

const REPOS = [
  'frontend',
  'backend',
  'api-gateway',
  'auth-service',
  'payment-svc',
] as const;

const BRANCHES = [
  'main',
  'develop',
  'feature/auth',
  'fix/memory-leak',
  'release/2.0',
] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function shortSha(): string {
  // 7-char hex string, e.g. "a3f9c12"
  return Math.random().toString(16).slice(2, 9);
}

// ─── Valid event builder ──────────────────────────────────────────────────────

/**
 * Builds a schema-valid BuildEvent.
 * Callers may pass overrides to fix specific fields (useful in tests).
 */
export function buildEvent(
  producerId: 'publisher-1' | 'publisher-2',
  type: EventType,
  overrides: Partial<BuildEvent> = {},
): BuildEvent {
  const base: BuildEvent = {
    eventId:    randomUUID(),
    type,
    repo:       pick(REPOS),
    branch:     pick(BRANCHES),
    commitSha:  shortSha(),
    createdAt:  new Date().toISOString(),
    producerId,
    attempt:    1,
    traceId:    randomUUID(),
    ...overrides,
  };

  // build.finished needs status + durationMs unless overridden
  if (type === 'build.finished' && overrides.status === undefined) {
    base.status     = Math.random() > 0.4 ? 'success' : 'failed';
    base.durationMs = Math.floor(Math.random() * 30_000) + 500;
  }

  return base;
}

// ─── Poison payload builder ───────────────────────────────────────────────────

/**
 * Returns a raw string that is either unparseable JSON (even index) or a
 * structurally invalid object that will fail Zod validation (odd index).
 */
export function buildPoisonPayload(index: number): string {
  if (index % 2 === 0) {
    // Malformed JSON — JSON.parse will throw
    return `{ "eventId": "${randomUUID()}", "type": "build.queued", broken {{{{`;
  }
  // Valid JSON but missing required fields (repo, branch, commitSha, etc.)
  return JSON.stringify({
    eventId:  randomUUID(),
    type:     'build.queued',
    malformed: true,
    // intentionally omits: repo, branch, commitSha, createdAt,
    //                       producerId, attempt, traceId
  });
}
