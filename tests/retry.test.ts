import { describe, it, expect } from 'vitest';
import { shouldFail, nextAttempt } from '../src/services/retryService';
import type { BuildEvent } from '../src/schema/events';

// ─── Shared fixture ────────────────────────────────────────────────────────────

const finishedFailed: BuildEvent = {
  eventId:    '550e8400-e29b-41d4-a716-446655440000',
  type:       'build.finished',
  repo:       'backend',
  branch:     'main',
  commitSha:  'abc1234',
  status:     'failed',
  durationMs: 1_500,
  createdAt:  '2024-01-15T10:30:00.000Z',
  producerId: 'publisher-1',
  attempt:    1,
  traceId:    '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
};

// ─── shouldFail ────────────────────────────────────────────────────────────────

describe('shouldFail', () => {
  it('returns true for build.finished + failed + attempt 1 (must retry)', () => {
    expect(shouldFail({ ...finishedFailed, attempt: 1 })).toBe(true);
  });

  it('returns true for build.finished + failed + attempt 2 (must retry)', () => {
    expect(shouldFail({ ...finishedFailed, attempt: 2 })).toBe(true);
  });

  it('returns false for attempt 3 (simulated recovery — let it succeed)', () => {
    expect(shouldFail({ ...finishedFailed, attempt: 3 })).toBe(false);
  });

  it('returns false for attempt > 3', () => {
    expect(shouldFail({ ...finishedFailed, attempt: 4 })).toBe(false);
  });

  it('returns false when status = success (no failure to simulate)', () => {
    expect(shouldFail({ ...finishedFailed, status: 'success' })).toBe(false);
  });

  it('returns false for build.queued (only finished events fail)', () => {
    const queued: BuildEvent = {
      ...finishedFailed,
      type:       'build.queued',
      status:     undefined,
      durationMs: undefined,
    };
    expect(shouldFail(queued)).toBe(false);
  });

  it('returns false for build.started', () => {
    const started: BuildEvent = {
      ...finishedFailed,
      type:       'build.started',
      status:     undefined,
      durationMs: undefined,
    };
    expect(shouldFail(started)).toBe(false);
  });
});

// ─── nextAttempt ──────────────────────────────────────────────────────────────

describe('nextAttempt', () => {
  it('increments attempt by exactly 1', () => {
    expect(nextAttempt({ ...finishedFailed, attempt: 1 }).attempt).toBe(2);
    expect(nextAttempt({ ...finishedFailed, attempt: 2 }).attempt).toBe(3);
  });

  it('preserves traceId across retries (for correlation)', () => {
    const result = nextAttempt(finishedFailed);
    expect(result.traceId).toBe(finishedFailed.traceId);
  });

  it('preserves all fields except attempt', () => {
    const result = nextAttempt(finishedFailed);
    expect(result.type).toBe('build.finished');
    expect(result.repo).toBe('backend');
    expect(result.status).toBe('failed');
    expect(result.durationMs).toBe(1_500);
    expect(result.producerId).toBe('publisher-1');
  });

  it('does not mutate the original event', () => {
    const original = { ...finishedFailed, attempt: 1 };
    nextAttempt(original);
    expect(original.attempt).toBe(1); // unchanged
  });

  it('returns a new object reference', () => {
    const result = nextAttempt(finishedFailed);
    expect(result).not.toBe(finishedFailed);
  });
});

// ─── Full retry sequence ──────────────────────────────────────────────────────

describe('Retry sequence — three hops', () => {
  it('simulates the expected fail→fail→succeed pattern', () => {
    let event: BuildEvent = { ...finishedFailed, attempt: 1 };

    // hop 1
    expect(shouldFail(event)).toBe(true);
    event = nextAttempt(event);
    expect(event.attempt).toBe(2);

    // hop 2
    expect(shouldFail(event)).toBe(true);
    event = nextAttempt(event);
    expect(event.attempt).toBe(3);

    // hop 3 — consumer lets it succeed
    expect(shouldFail(event)).toBe(false);
  });
});
