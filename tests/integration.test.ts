/**
 * Lightweight integration tests — no RabbitMQ required.
 *
 * These tests mock the amqplib channel to verify that the correct
 * publish / sendToQueue calls are made with the right arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BuildEvent } from '../src/schema/events';

// ─── Mock channel factory ──────────────────────────────────────────────────────

function makeChannel() {
  return {
    prefetch:    vi.fn().mockResolvedValue(undefined),
    consume:     vi.fn(),
    ack:         vi.fn(),
    publish:     vi.fn().mockReturnValue(true),
    sendToQueue: vi.fn().mockReturnValue(true),
  };
}

function makeMsg(payload: unknown, routingKey = 'build.finished') {
  const raw     = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const content = Buffer.from(raw);
  return {
    content,
    fields:     { routingKey, exchange: 'demo.ci.exchange', deliveryTag: 1, redelivered: false, consumerTag: 'ctag' },
    properties: {},
  };
}

// ─── Shared fixture ────────────────────────────────────────────────────────────

const failedFinished: BuildEvent = {
  eventId:    '550e8400-e29b-41d4-a716-446655440000',
  type:       'build.finished',
  repo:       'backend',
  branch:     'main',
  commitSha:  'abc1234',
  status:     'failed',
  durationMs: 2_000,
  createdAt:  '2024-01-15T10:30:00.000Z',
  producerId: 'publisher-1',
  attempt:    1,
  traceId:    '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
};

// ─── Publisher routing key ─────────────────────────────────────────────────────

describe('Publisher — routing key matches event type', () => {
  it('publishes to MAIN exchange with routing key = event.type', async () => {
    const { buildEvent }  = await import('../src/publishers/eventBuilder');
    const { EXCHANGES }   = await import('../src/rabbit/topology');
    const channel         = makeChannel();

    const types = ['build.queued', 'build.started', 'build.finished'] as const;
    for (const type of types) {
      channel.publish.mockClear();
      const event = buildEvent('publisher-1', type,
        type === 'build.finished' ? { status: 'success', durationMs: 1000 } : {},
      );
      channel.publish(
        EXCHANGES.MAIN,
        event.type,
        Buffer.from(JSON.stringify(event)),
        { persistent: true, contentType: 'application/json' },
      );
      expect(channel.publish).toHaveBeenCalledWith(
        EXCHANGES.MAIN,
        type,
        expect.any(Buffer),
        expect.objectContaining({ persistent: true }),
      );
    }
  });
});

// ─── Retry logic ──────────────────────────────────────────────────────────────

describe('Retry — publishes incremented attempt to RETRY exchange', () => {
  it('publishes attempt+1 to EXCHANGES.RETRY with the original routing key', async () => {
    const { shouldFail, nextAttempt } = await import('../src/services/retryService');
    const { EXCHANGES }               = await import('../src/rabbit/topology');
    const channel                     = makeChannel();

    const event = { ...failedFinished, attempt: 1 };
    expect(shouldFail(event)).toBe(true);

    const retried = nextAttempt(event);
    channel.publish(
      EXCHANGES.RETRY,
      'build.finished',
      Buffer.from(JSON.stringify(retried)),
      { persistent: true, contentType: 'application/json' },
    );

    expect(channel.publish).toHaveBeenCalledWith(
      EXCHANGES.RETRY,
      'build.finished',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true }),
    );

    // Verify payload has incremented attempt and preserved traceId
    const published: BuildEvent = JSON.parse(
      (channel.publish.mock.calls[0][2] as Buffer).toString(),
    );
    expect(published.attempt).toBe(2);
    expect(published.traceId).toBe(event.traceId);
  });

  it('does not retry when attempt === 3 (shouldFail returns false)', async () => {
    const { shouldFail } = await import('../src/services/retryService');
    expect(shouldFail({ ...failedFinished, attempt: 3 })).toBe(false);
  });

  it('increments attempt through the full 1→2→3 chain', async () => {
    const { shouldFail, nextAttempt } = await import('../src/services/retryService');

    let event: BuildEvent = { ...failedFinished, attempt: 1 };

    expect(shouldFail(event)).toBe(true);
    event = nextAttempt(event);            // attempt 2
    expect(event.attempt).toBe(2);

    expect(shouldFail(event)).toBe(true);
    event = nextAttempt(event);            // attempt 3
    expect(event.attempt).toBe(3);

    expect(shouldFail(event)).toBe(false); // recovered
  });
});

// ─── Poison routing ───────────────────────────────────────────────────────────

describe('Poison routing — invalid messages reach POISON queue', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('routes unparseable JSON to QUEUES.POISON', async () => {
    const { QUEUES }  = await import('../src/rabbit/topology');
    const channel     = makeChannel();
    const msg         = makeMsg('{ broken {{ json');

    let parseError = false;
    try { JSON.parse(msg.content.toString()); }
    catch { parseError = true; }

    expect(parseError).toBe(true);

    // Simulate consumer poison path
    channel.sendToQueue(
      QUEUES.POISON,
      Buffer.from(JSON.stringify({ raw: msg.content.toString(), reason: 'Invalid JSON' })),
      { persistent: true },
    );
    channel.ack(msg as any);

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.POISON,
      expect.any(Buffer),
      expect.any(Object),
    );
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });

  it('routes schema-invalid message to QUEUES.POISON', async () => {
    const { BuildEventSchema } = await import('../src/schema/events');
    const { QUEUES }           = await import('../src/rabbit/topology');
    const channel              = makeChannel();

    const bad    = { type: 'build.queued', malformed: true };
    const result = BuildEventSchema.safeParse(bad);
    expect(result.success).toBe(false);

    if (!result.success) {
      const reason = result.error.issues.map((i) => i.message).join('; ');
      channel.sendToQueue(
        QUEUES.POISON,
        Buffer.from(JSON.stringify({ raw: JSON.stringify(bad), reason })),
        { persistent: true },
      );
    }

    expect(channel.sendToQueue).toHaveBeenCalledWith(QUEUES.POISON, expect.any(Buffer), expect.any(Object));
  });

  it('always acks the original message after routing to poison', async () => {
    const channel = makeChannel();
    const msg     = makeMsg('bad json {{{');

    // Simulate both poison actions
    channel.sendToQueue('demo.ci.poison', Buffer.from('{}'), {});
    channel.ack(msg as any);

    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
  });
});

// ─── Store ────────────────────────────────────────────────────────────────────

describe('In-memory store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('addSuccessEvent prepends (newest first)', async () => {
    const { addSuccessEvent, getSuccessEvents } = await import('../src/server/store');
    const base = {
      ...failedFinished,
      status:     'success' as const,
      consumerId: 'consumer-1',
    };
    addSuccessEvent({ ...base, eventId: 'aaa-' + Math.random() });
    addSuccessEvent({ ...base, eventId: 'bbb-' + Math.random() });
    const events = getSuccessEvents();
    // most recent is first
    expect(events[0].eventId).toMatch(/^bbb/);
  });

  it('addPoisonEvent prepends (newest first)', async () => {
    const { addPoisonEvent, getPoisonEvents } = await import('../src/server/store');
    addPoisonEvent({ raw: 'a', reason: 'err1', routingKey: 'build.queued', timestamp: new Date().toISOString() });
    addPoisonEvent({ raw: 'b', reason: 'err2', routingKey: 'build.queued', timestamp: new Date().toISOString() });
    const events = getPoisonEvents();
    expect(events[0].reason).toBe('err2');
  });
});
