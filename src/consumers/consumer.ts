import type amqp from 'amqplib';
import { BuildEventSchema } from '../schema/events';
import { EXCHANGES, QUEUES } from '../rabbit/topology';
import { shouldFail, nextAttempt } from '../services/retryService';
import { sendToPoison } from '../services/poisonService';
import { addSuccessEvent } from '../server/store';

const MAX_ATTEMPTS = 3;

/**
 * Starts a competing consumer that pulls from demo.ci.events.
 *
 * Processing pipeline per message:
 *   1. Parse JSON         → invalid JSON     → poison queue
 *   2. Validate Zod schema → schema mismatch → poison queue
 *   3. Simulate failure   → shouldFail()     → retry exchange (TTL 2 s)
 *   4. Success            → ack + store
 *
 * Retry behaviour (build.finished + status=failed):
 *   attempt 1 → shouldFail=true  → publish to retry exchange, ack
 *   attempt 2 → shouldFail=true  → publish to retry exchange, ack
 *   attempt 3 → shouldFail=false → falls through to success path
 */
export async function startConsumer(
  channel:    amqp.ConfirmChannel,
  consumerId: string,
): Promise<amqp.Replies.Consume> {
  // channel.prefetch limits unacknowledged messages per consumer,
  // creating natural load-balancing between the two competing consumers.
  await channel.prefetch(5);

  return channel.consume(QUEUES.MAIN, async (msg) => {
    if (!msg) return; // consumer was cancelled by the broker

    let settled = false;
    try {
      const routingKey   = msg.fields.routingKey;
      let   logPrefix    = `[${consumerId}]`;

      // ── Step 1: Parse JSON ──────────────────────────────────────────────────
      let raw: unknown;
      try {
        raw = JSON.parse(msg.content.toString());
      } catch {
        console.log(`${logPrefix} ✗ Invalid JSON → poison`);
        await sendToPoison(
          channel,
          msg,
          'Invalid JSON: could not parse message body',
        );
        channel.ack(msg);
        settled = true;
        return;
      }

      // ── Step 2: Schema validation ───────────────────────────────────────────
      const result = BuildEventSchema.safeParse(raw);
      if (!result.success) {
        const reason = result.error.issues
          .map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
          .join('; ');
        console.log(`${logPrefix} ✗ Schema invalid → poison  [${reason}]`);
        await sendToPoison(channel, msg, reason);
        channel.ack(msg);
        settled = true;
        return;
      }

      const event  = result.data;
      logPrefix = `[${consumerId}] [${event.traceId.slice(0, 8)}]`;

      console.log(
        `${logPrefix} Processing ${event.type}` +
        ` attempt=${event.attempt}` +
        ` repo=${event.repo} branch=${event.branch}`,
      );

      // ── Step 3: Transient failure simulation ────────────────────────────────
      if (
        event.type === 'build.finished' &&
        event.status === 'failed' &&
        event.attempt > MAX_ATTEMPTS
      ) {
        const reason = `Retry limit exceeded: attempt ${event.attempt} > ${MAX_ATTEMPTS}`;
        console.log(`${logPrefix} ✗ ${reason} → poison`);
        await sendToPoison(channel, msg, reason);
        channel.ack(msg);
        settled = true;
        return;
      }

      if (shouldFail(event)) {
        const retried = nextAttempt(event);
        channel.publish(
          EXCHANGES.RETRY,
          routingKey,                           // same key → same queue after TTL
          Buffer.from(JSON.stringify(retried)),
          { persistent: true, contentType: 'application/json' },
        );
        await channel.waitForConfirms();
        console.log(
          `${logPrefix} ↻ Retry scheduled — attempt ${retried.attempt}` +
          ` (dead-letters back in 2 s)`,
        );
        channel.ack(msg);
        settled = true;
        return;
      }

      // ── Step 4: Success ─────────────────────────────────────────────────────
      addSuccessEvent({ ...event, consumerId });
      console.log(
        `${logPrefix} ✓ ${event.type} processed by ${consumerId}` +
        (event.status    ? ` status=${event.status}`          : '') +
        (event.durationMs ? ` duration=${event.durationMs}ms` : ''),
      );
      channel.ack(msg);
      settled = true;
    } catch (err) {
      console.error(`[${consumerId}] ✗ Handler error`, err);
      if (!settled) {
        channel.nack(msg, false, true);
      }
    }
  });
}
