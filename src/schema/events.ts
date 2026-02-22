import { z } from 'zod';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const EventTypeEnum = z.enum([
  'build.queued',
  'build.started',
  'build.finished',
]);

export type EventType = z.infer<typeof EventTypeEnum>;

export const ProducerIdEnum = z.enum(['publisher-1', 'publisher-2']);

// ─── Main schema ──────────────────────────────────────────────────────────────

/**
 * Strict Zod schema for CI build events.
 * - build.finished requires status + durationMs (enforced via .refine)
 * - All UUIDs are validated
 * - createdAt must be an ISO datetime string
 */
export const BuildEventSchema = z
  .object({
    eventId:    z.string().uuid('eventId must be a valid UUID'),
    type:       EventTypeEnum,
    repo:       z.string().min(1, 'repo is required'),
    branch:     z.string().min(1, 'branch is required'),
    commitSha:  z.string().min(1, 'commitSha is required'),
    status:     z.enum(['success', 'failed']).optional(),
    durationMs: z.number().int().positive().optional(),
    createdAt:  z.string().datetime({ message: 'createdAt must be ISO 8601' }),
    producerId: ProducerIdEnum,
    attempt:    z.number().int().min(1, 'attempt must be >= 1'),
    traceId:    z.string().uuid('traceId must be a valid UUID'),
  })
  .refine(
    (d) => d.type !== 'build.finished' || d.status !== undefined,
    { message: 'build.finished requires status', path: ['status'] },
  )
  .refine(
    (d) => d.type !== 'build.finished' || d.durationMs !== undefined,
    { message: 'build.finished requires durationMs', path: ['durationMs'] },
  );

export type BuildEvent = z.infer<typeof BuildEventSchema>;

// ─── Ancillary record types ───────────────────────────────────────────────────

/** A successfully processed event, enriched with the consumer that handled it */
export type SuccessRecord = BuildEvent & { consumerId: string };

/** A message that was rejected — either malformed or schema-invalid */
export interface PoisonRecord {
  raw:        string;
  reason:     string;
  routingKey: string;
  timestamp:  string;
}
