import type { SuccessRecord, PoisonRecord } from '../schema/events';

// ─── In-memory ring buffers ────────────────────────────────────────────────────

const MAX = 200;

const successEvents: SuccessRecord[] = [];
const poisonEvents:  PoisonRecord[]  = [];

// ─── Mutators ────────────────────────────────────────────────────────────────

export function addSuccessEvent(event: SuccessRecord): void {
  successEvents.unshift(event);           // prepend so newest is first
  if (successEvents.length > MAX) successEvents.length = MAX;
}

export function addPoisonEvent(event: PoisonRecord): void {
  poisonEvents.unshift(event);
  if (poisonEvents.length > MAX) poisonEvents.length = MAX;
}

// ─── Accessors ────────────────────────────────────────────────────────────────

export function getSuccessEvents(): ReadonlyArray<SuccessRecord> {
  return successEvents;
}

export function getPoisonEvents(): ReadonlyArray<PoisonRecord> {
  return poisonEvents;
}
