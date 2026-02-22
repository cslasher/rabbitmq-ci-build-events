import type amqp from 'amqplib';
import { EXCHANGES } from '../rabbit/topology';
import { buildEvent, buildPoisonPayload } from './eventBuilder';
import type { EventType } from '../schema/events';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PublisherOptions {
  producerId:   'publisher-1' | 'publisher-2';
  count:        number;
  rateMs:       number;
  poisonCount:  number;
}

const EVENT_TYPES: EventType[] = [
  'build.queued',
  'build.started',
  'build.finished',
];

// ─── Publisher ────────────────────────────────────────────────────────────────

/**
 * Publishes `count` messages to demo.ci.exchange.
 * `poisonCount` of those will be intentionally malformed to exercise
 * poison-queue handling on the consumer side.
 */
export async function runPublisher(
  channel: amqp.Channel,
  opts: PublisherOptions,
): Promise<void> {
  const { producerId, count, rateMs, poisonCount } = opts;

  // Randomly scatter poison messages across the sequence
  const poisonIndices = new Set<number>();
  while (poisonIndices.size < Math.min(poisonCount, count)) {
    poisonIndices.add(Math.floor(Math.random() * count));
  }

  for (let i = 0; i < count; i++) {
    const isPoison = poisonIndices.has(i);
    let payload: Buffer;
    let routingKey: string;

    if (isPoison) {
      // Route through a real routing key so the message is delivered to the
      // main queue — the consumer will catch the parse/schema error.
      payload    = Buffer.from(buildPoisonPayload(i));
      routingKey = 'build.queued';
    } else {
      const type  = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
      const event = buildEvent(producerId, type);
      payload     = Buffer.from(JSON.stringify(event));
      routingKey  = event.type;
    }

    channel.publish(EXCHANGES.MAIN, routingKey, payload, {
      persistent:   true,
      contentType:  'application/json',
    });

    const tag = isPoison ? 'POISON' : 'valid ';
    process.stdout.write(
      `[${producerId}] #${String(i + 1).padStart(3)} ${tag} → ${routingKey}\n`,
    );

    await sleep(rateMs);
  }

  console.log(
    `\n[${producerId}] Done — ${count} messages published (${poisonCount} poison).`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
