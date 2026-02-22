import type amqp from 'amqplib';
import { QUEUES } from '../rabbit/topology';
import { addPoisonEvent } from '../server/store';
import type { PoisonRecord } from '../schema/events';

/**
 * Routes a rejected message to the poison queue and records it in the
 * in-memory store so the UI can display it immediately.
 *
 * The caller is responsible for ack-ing the original message afterwards.
 */
export async function sendToPoison(
  channel:  amqp.ConfirmChannel,
  msg:      amqp.ConsumeMessage,
  reason:   string,
): Promise<void> {
  const record: PoisonRecord = {
    raw:        msg.content.toString(),
    reason,
    routingKey: msg.fields.routingKey,
    timestamp:  new Date().toISOString(),
  };

  channel.sendToQueue(
    QUEUES.POISON,
    Buffer.from(JSON.stringify(record)),
    { persistent: true, contentType: 'application/json' },
  );
  await channel.waitForConfirms();

  addPoisonEvent(record);
}
