import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildEvent } from '../src/schema/events';

function makeChannel() {
  return {
    prefetch: vi.fn().mockResolvedValue(undefined),
    consume: vi.fn().mockResolvedValue({ consumerTag: 'ctag-1' }),
    ack: vi.fn(),
    nack: vi.fn(),
    publish: vi.fn().mockReturnValue(true),
    sendToQueue: vi.fn().mockReturnValue(true),
    waitForConfirms: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMsg(payload: unknown, routingKey = 'build.finished') {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return {
    content: Buffer.from(raw),
    fields: {
      routingKey,
      exchange: 'demo.ci.exchange',
      deliveryTag: 1,
      redelivered: false,
      consumerTag: 'ctag',
    },
    properties: {},
  };
}

const failedFinished: BuildEvent = {
  eventId: '550e8400-e29b-41d4-a716-446655440000',
  type: 'build.finished',
  repo: 'backend',
  branch: 'main',
  commitSha: 'abc1234',
  status: 'failed',
  durationMs: 2_000,
  createdAt: '2024-01-15T10:30:00.000Z',
  producerId: 'publisher-1',
  attempt: 1,
  traceId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
};

async function registerConsumer(channel: ReturnType<typeof makeChannel>) {
  const { startConsumer } = await import('../src/consumers/consumer');
  await startConsumer(channel as any, 'consumer-1');
  const handler = channel.consume.mock.calls[0]?.[1];
  expect(handler).toBeTypeOf('function');
  return handler as (msg: any) => Promise<void>;
}

describe('Consumer integration safety', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sets prefetch to 5 for competing-consumer fairness', async () => {
    const channel = makeChannel();
    await registerConsumer(channel);
    expect(channel.prefetch).toHaveBeenCalledWith(5);
  });

  it('acks only after retry publish is confirm-acked', async () => {
    const { EXCHANGES } = await import('../src/rabbit/topology');
    const channel = makeChannel();
    const handler = await registerConsumer(channel);
    const msg = makeMsg({ ...failedFinished, attempt: 1 }, 'build.finished');

    await handler(msg);

    expect(channel.publish).toHaveBeenCalledWith(
      EXCHANGES.RETRY,
      'build.finished',
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, contentType: 'application/json' }),
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();

    const published = JSON.parse(channel.publish.mock.calls[0][2].toString());
    expect(published.attempt).toBe(2);
    expect(published.traceId).toBe(failedFinished.traceId);
  });

  it('nacks (requeue) when retry publish confirm fails', async () => {
    const channel = makeChannel();
    channel.waitForConfirms.mockRejectedValueOnce(new Error('confirm failed'));
    const handler = await registerConsumer(channel);
    const msg = makeMsg({ ...failedFinished, attempt: 1 }, 'build.finished');

    await handler(msg);

    expect(channel.publish).toHaveBeenCalledTimes(1);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('routes invalid JSON to poison and acks only after confirm success', async () => {
    const { QUEUES } = await import('../src/rabbit/topology');
    const channel = makeChannel();
    const handler = await registerConsumer(channel);
    const msg = makeMsg('{ broken {{ json', 'build.queued');

    await handler(msg);

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.POISON,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, contentType: 'application/json' }),
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(msg);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks (requeue) when poison publish confirm fails', async () => {
    const channel = makeChannel();
    channel.waitForConfirms.mockRejectedValueOnce(new Error('confirm failed'));
    const handler = await registerConsumer(channel);
    const msg = makeMsg('{ broken {{ json', 'build.queued');

    await handler(msg);

    expect(channel.sendToQueue).toHaveBeenCalledTimes(1);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(msg, false, true);
  });

  it('routes schema-invalid payloads to poison safely', async () => {
    const { QUEUES } = await import('../src/rabbit/topology');
    const channel = makeChannel();
    const handler = await registerConsumer(channel);
    const msg = makeMsg({ type: 'build.queued', malformed: true }, 'build.queued');

    await handler(msg);

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.POISON,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, contentType: 'application/json' }),
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('routes failed events beyond max attempts to poison (no retry publish)', async () => {
    const { QUEUES } = await import('../src/rabbit/topology');
    const channel = makeChannel();
    const handler = await registerConsumer(channel);
    const msg = makeMsg({ ...failedFinished, attempt: 4 }, 'build.finished');

    await handler(msg);

    expect(channel.publish).not.toHaveBeenCalled();
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      QUEUES.POISON,
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, contentType: 'application/json' }),
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();

    const poisonRecord = JSON.parse(channel.sendToQueue.mock.calls[0][1].toString());
    expect(poisonRecord.reason).toContain('Retry limit exceeded');
  });
});
