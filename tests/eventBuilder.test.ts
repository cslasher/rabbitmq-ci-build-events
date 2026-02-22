import { describe, it, expect } from 'vitest';
import { buildEvent, buildPoisonPayload } from '../src/publishers/eventBuilder';
import { BuildEventSchema } from '../src/schema/events';

// ─── buildEvent ────────────────────────────────────────────────────────────────

describe('buildEvent', () => {
  it('produces a schema-valid build.queued event', () => {
    const event  = buildEvent('publisher-1', 'build.queued');
    const result = BuildEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it('produces a schema-valid build.started event', () => {
    const event  = buildEvent('publisher-2', 'build.started');
    const result = BuildEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    expect(result.success && result.data.type).toBe('build.started');
  });

  it('produces a schema-valid build.finished event with status and durationMs', () => {
    const event  = buildEvent('publisher-1', 'build.finished');
    const result = BuildEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    expect(event.status).toBeDefined();
    expect(event.durationMs).toBeGreaterThan(0);
  });

  it('sets attempt = 1 by default', () => {
    expect(buildEvent('publisher-1', 'build.queued').attempt).toBe(1);
  });

  it('sets producerId correctly', () => {
    expect(buildEvent('publisher-1', 'build.queued').producerId).toBe('publisher-1');
    expect(buildEvent('publisher-2', 'build.queued').producerId).toBe('publisher-2');
  });

  it('generates a valid UUID for eventId', () => {
    const event = buildEvent('publisher-1', 'build.queued');
    expect(event.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('generates a valid UUID for traceId', () => {
    const event = buildEvent('publisher-1', 'build.queued');
    expect(event.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('produces unique eventId and traceId per call', () => {
    const a = buildEvent('publisher-1', 'build.queued');
    const b = buildEvent('publisher-1', 'build.queued');
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.traceId).not.toBe(b.traceId);
  });

  it('respects overrides — fixed status and durationMs', () => {
    const event = buildEvent('publisher-1', 'build.finished', {
      status:     'failed',
      durationMs: 9_999,
    });
    expect(event.status).toBe('failed');
    expect(event.durationMs).toBe(9_999);
  });

  it('respects overrides — fixed repo and branch', () => {
    const event = buildEvent('publisher-1', 'build.queued', {
      repo:   'my-service',
      branch: 'feature/x',
    });
    expect(event.repo).toBe('my-service');
    expect(event.branch).toBe('feature/x');
  });

  it('does not set status/durationMs for build.queued', () => {
    const event = buildEvent('publisher-1', 'build.queued');
    expect(event.status).toBeUndefined();
    expect(event.durationMs).toBeUndefined();
  });

  it('does not set status/durationMs for build.started', () => {
    const event = buildEvent('publisher-1', 'build.started');
    expect(event.status).toBeUndefined();
    expect(event.durationMs).toBeUndefined();
  });

  it('createdAt is a valid ISO string', () => {
    const event = buildEvent('publisher-1', 'build.queued');
    expect(() => new Date(event.createdAt)).not.toThrow();
    expect(new Date(event.createdAt).toISOString()).toBe(event.createdAt);
  });
});

// ─── buildPoisonPayload ────────────────────────────────────────────────────────

describe('buildPoisonPayload', () => {
  it('returns unparseable JSON for even indices (malformed)', () => {
    for (const i of [0, 2, 4, 6]) {
      const raw = buildPoisonPayload(i);
      expect(() => JSON.parse(raw)).toThrow();
    }
  });

  it('returns parseable but schema-invalid JSON for odd indices', () => {
    for (const i of [1, 3, 5, 7]) {
      const raw    = buildPoisonPayload(i);
      const parsed = JSON.parse(raw);
      const result = BuildEventSchema.safeParse(parsed);
      expect(result.success).toBe(false);
    }
  });

  it('returns a string for all indices', () => {
    for (let i = 0; i < 10; i++) {
      expect(typeof buildPoisonPayload(i)).toBe('string');
    }
  });
});
