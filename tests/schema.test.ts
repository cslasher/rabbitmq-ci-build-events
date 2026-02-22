import { describe, it, expect } from 'vitest';
import { BuildEventSchema } from '../src/schema/events';

// ─── Shared valid base event ───────────────────────────────────────────────────

const validBase = {
  eventId:   '550e8400-e29b-41d4-a716-446655440000',
  type:      'build.queued' as const,
  repo:      'frontend',
  branch:    'main',
  commitSha: 'abc1234',
  createdAt: '2024-01-15T10:30:00.000Z',
  producerId:'publisher-1' as const,
  attempt:   1,
  traceId:   '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
};

// ─── Valid events ──────────────────────────────────────────────────────────────

describe('BuildEventSchema — valid events', () => {
  it('accepts a valid build.queued event', () => {
    const result = BuildEventSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.type).toBe('build.queued');
  });

  it('accepts a valid build.started event', () => {
    const result = BuildEventSchema.safeParse({ ...validBase, type: 'build.started' });
    expect(result.success).toBe(true);
  });

  it('accepts a valid build.finished event with status and durationMs', () => {
    const result = BuildEventSchema.safeParse({
      ...validBase,
      type:       'build.finished',
      status:     'success',
      durationMs: 5_000,
    });
    expect(result.success).toBe(true);
  });

  it('accepts build.finished with status=failed', () => {
    const result = BuildEventSchema.safeParse({
      ...validBase,
      type:       'build.finished',
      status:     'failed',
      durationMs: 1_200,
    });
    expect(result.success).toBe(true);
  });

  it('accepts attempt values greater than 1 (retry hops)', () => {
    expect(BuildEventSchema.safeParse({ ...validBase, attempt: 2 }).success).toBe(true);
    expect(BuildEventSchema.safeParse({ ...validBase, attempt: 3 }).success).toBe(true);
  });

  it('accepts publisher-2 as producerId', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, producerId: 'publisher-2' }).success,
    ).toBe(true);
  });
});

// ─── build.finished-specific rules ────────────────────────────────────────────

describe('BuildEventSchema — build.finished refinements', () => {
  it('rejects build.finished without status', () => {
    const result = BuildEventSchema.safeParse({
      ...validBase,
      type:       'build.finished',
      durationMs: 3_000,
      // status intentionally omitted
    });
    expect(result.success).toBe(false);
  });

  it('rejects build.finished without durationMs', () => {
    const result = BuildEventSchema.safeParse({
      ...validBase,
      type:   'build.finished',
      status: 'success',
      // durationMs intentionally omitted
    });
    expect(result.success).toBe(false);
  });

  it('rejects build.finished with invalid status value', () => {
    const result = BuildEventSchema.safeParse({
      ...validBase,
      type:       'build.finished',
      status:     'unknown',
      durationMs: 1_000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects durationMs = 0 (must be positive)', () => {
    const result = BuildEventSchema.safeParse({
      ...validBase,
      type:       'build.finished',
      status:     'success',
      durationMs: 0,
    });
    expect(result.success).toBe(false);
  });
});

// ─── Field validation ──────────────────────────────────────────────────────────

describe('BuildEventSchema — field validation', () => {
  it('rejects eventId that is not a UUID', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, eventId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejects traceId that is not a UUID', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, traceId: 'bad-trace' }).success,
    ).toBe(false);
  });

  it('rejects unknown event type', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, type: 'build.cancelled' }).success,
    ).toBe(false);
  });

  it('rejects unknown producerId', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, producerId: 'publisher-9' }).success,
    ).toBe(false);
  });

  it('rejects attempt = 0', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, attempt: 0 }).success,
    ).toBe(false);
  });

  it('rejects attempt = -1', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, attempt: -1 }).success,
    ).toBe(false);
  });

  it('rejects missing repo', () => {
    const { repo, ...without } = validBase;
    expect(BuildEventSchema.safeParse(without).success).toBe(false);
  });

  it('rejects empty repo string', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, repo: '' }).success,
    ).toBe(false);
  });

  it('rejects invalid ISO datetime', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, createdAt: '2024-01-15' }).success,
    ).toBe(false);
  });

  it('rejects non-string createdAt', () => {
    expect(
      BuildEventSchema.safeParse({ ...validBase, createdAt: 1705315800000 }).success,
    ).toBe(false);
  });

  it('rejects completely empty object', () => {
    expect(BuildEventSchema.safeParse({}).success).toBe(false);
  });

  it('rejects null', () => {
    expect(BuildEventSchema.safeParse(null).success).toBe(false);
  });
});
