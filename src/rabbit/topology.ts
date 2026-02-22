import type amqp from 'amqplib';

// ─── Exchange names ───────────────────────────────────────────────────────────

export const EXCHANGES = {
  /** Primary direct exchange — publishers send here */
  MAIN:  'demo.ci.exchange',
  /**
   * Retry exchange — consumers publish failed messages here.
   * The retry queue has a TTL; when messages expire they are
   * dead-lettered back to MAIN using the original routing key.
   */
  RETRY: 'demo.ci.retry.exchange',
} as const;

// ─── Queue names ─────────────────────────────────────────────────────────────

export const QUEUES = {
  /** Main work queue — all consumers compete here */
  MAIN:   'demo.ci.events',
  /**
   * Holding queue for retry messages.
   * x-message-ttl:           2 000 ms before dead-lettering
   * x-dead-letter-exchange:  EXCHANGES.MAIN
   * The routing key used when publishing to EXCHANGES.RETRY is preserved,
   * so the dead-lettered message re-enters QUEUES.MAIN with the correct key.
   */
  RETRY:  'demo.ci.retry.queue',
  /** Terminal queue for messages that cannot be processed */
  POISON: 'demo.ci.poison',
} as const;

// ─── Routing keys ─────────────────────────────────────────────────────────────

export const ROUTING_KEYS = [
  'build.queued',
  'build.started',
  'build.finished',
] as const;

export type RoutingKey = (typeof ROUTING_KEYS)[number];

// ─── Topology setup ───────────────────────────────────────────────────────────

/**
 * Idempotently asserts all exchanges and queues.
 * Safe to call on every startup — RabbitMQ ignores duplicate declares
 * with matching arguments.
 */
export async function setupTopology(channel: amqp.Channel): Promise<void> {
  // ── Exchanges ──────────────────────────────────────────────────────────────
  await channel.assertExchange(EXCHANGES.MAIN,  'direct', { durable: true });
  await channel.assertExchange(EXCHANGES.RETRY, 'direct', { durable: true });

  // ── Main work queue ────────────────────────────────────────────────────────
  await channel.assertQueue(QUEUES.MAIN, { durable: true });
  for (const key of ROUTING_KEYS) {
    await channel.bindQueue(QUEUES.MAIN, EXCHANGES.MAIN, key);
  }

  // ── Retry queue ────────────────────────────────────────────────────────────
  // Messages sit here for 2 s, then dead-letter back to EXCHANGES.MAIN with
  // their original routing key → re-queued into QUEUES.MAIN automatically.
  await channel.assertQueue(QUEUES.RETRY, {
    durable: true,
    arguments: {
      'x-message-ttl':           2_000,
      'x-dead-letter-exchange':  EXCHANGES.MAIN,
      // No x-dead-letter-routing-key: RabbitMQ reuses the message's own key
    },
  });
  for (const key of ROUTING_KEYS) {
    await channel.bindQueue(QUEUES.RETRY, EXCHANGES.RETRY, key);
  }

  // ── Poison queue ───────────────────────────────────────────────────────────
  await channel.assertQueue(QUEUES.POISON, { durable: true });

  console.log('[Topology] Exchanges and queues asserted ✓');
}
