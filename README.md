# RabbitMQ CI Build Events — Advanced Messaging Patterns Demo

A self-contained Node.js + TypeScript demo that illustrates five RabbitMQ
patterns using a realistic CI/CD event stream as the domain.

---

## File Tree

```Plaintext
rabbitmq-ci-build-events/
├── src/
│   ├── schema/
│   │   └── events.ts          # Zod schema — BuildEvent, SuccessRecord, PoisonRecord
│   ├── rabbit/
│   │   ├── connection.ts      # Shared AMQP connection singleton
│   │   └── topology.ts        # Exchange / queue declarations (idempotent)
│   ├── publishers/
│   │   ├── eventBuilder.ts    # Valid event factory + poison payload builder
│   │   └── publisher.ts       # Publishes N messages at a configurable rate
│   ├── consumers/
│   │   └── consumer.ts        # JSON parse → schema validate → retry/poison/succeed
│   ├── services/
│   │   ├── retryService.ts    # shouldFail() + nextAttempt()
│   │   └── poisonService.ts   # sendToPoison() — writes to queue and in-memory store
│   ├── server/
│   │   ├── store.ts           # In-memory ring buffers (200 success + 200 poison)
│   │   └── app.ts             # Express: GET / (dashboard), GET /events (SSE)
│   ├── index.ts               # Single-process: topology + 2 consumers + Express
│   └── publish.ts             # CLI publisher
├── tests/
│   ├── schema.test.ts         # Zod schema validation unit tests
│   ├── retry.test.ts          # shouldFail / nextAttempt unit tests
│   ├── eventBuilder.test.ts   # Event factory + poison builder tests
│   └── integration.test.ts    # Mocked channel — routing/retry/poison flows
├── package.json
├── tsconfig.json
└── README.md
```

---

## Prerequisites

| Tool    | Version    |
| ------- | ---------- |
| Node.js | 18+        |
| Docker  | any recent |

RabbitMQ must be running before you start the server:

```bash
docker run -d --name rabbit \
  -p 5672:5672 -p 15672:15672 \
  rabbitmq:3-management
```

---

## Setup

```bash
cd rabbitmq-ci-build-events
npm install
```

---

## Running the Demo

### Terminal 1 — start the server (consumers + dashboard)

```bash
npm start
```

You should see:

```Plaintext
[RabbitMQ] Connected to amqp://localhost
[Topology] Exchanges and queues asserted ✓
[Server] consumer-1 and consumer-2 active
[Server] Dashboard → http://localhost:3000
[Server] Ready. Run publishers in separate terminals.
```

### Terminal 2 — publisher 1

```bash
npm run publish:1
```

### Terminal 3 — publisher 2

```bash
npm run publish:2
```

### Dashboard

Open <http://localhost:3000> — the page updates live via Server-Sent Events.

---

## CLI Options (publishers)

```bash
ts-node src/publish.ts \
  --producerId   publisher-1   # publisher-1 | publisher-2
  --count        50            # total messages
  --rateMs       50            # ms between messages
  --poisonCount  5             # how many to make malformed
```

---

## Architecture Overview

```Plaintext
                         ┌──────────────────────────────────────┐
                         │        demo.ci.exchange (direct)      │
                         │                                        │
publisher-1 ─────────────►  routing key: build.queued            │
publisher-2 ─────────────►  routing key: build.started           │
                         │  routing key: build.finished           │
                         └──────────────┬───────────────────────┘
                                        │ binding (all 3 keys)
                                        ▼
                              ┌──────────────────┐
                              │  demo.ci.events   │  ← main work queue
                              └────────┬─────────┘
                                       │ competing consumers (prefetch 5)
                          ┌────────────┴───────────┐
                          ▼                         ▼
                     consumer-1               consumer-2
                          │                         │
             ┌────────────┼─────────────────────────┤
             │            │                         │
        Invalid JSON  Schema fail            shouldFail()
        or schema err  (Zod)                attempt < 3
             │            │                         │
             ▼            ▼                         ▼
        ┌──────────┐  ┌──────────┐      ┌──────────────────────┐
        │  poison  │  │  poison  │      │ demo.ci.retry.exchange│
        │  queue   │  │  queue   │      └──────────┬───────────┘
        └──────────┘  └──────────┘                 │ binding (all 3 keys)
                                                    ▼
                                        ┌─────────────────────┐
                                        │ demo.ci.retry.queue  │
                                        │  x-message-ttl: 2000 │
                                        │  x-dlx: demo.ci.exch │
                                        └──────────┬──────────┘
                                                   │ TTL expires → dead-letter
                                                   │ (original routing key)
                                                   ▼
                                        back to demo.ci.events
                                        (attempt incremented)
```

---

## Patterns Explained

### 1. Direct Exchange + Routing Keys

A _direct_ exchange routes messages to queues based on an exact string match
between the message's routing key and the queue binding key.

```Plaintext
publisher publishes with routingKey = "build.finished"
    → exchange finds bindings where bindingKey == "build.finished"
    → delivers to demo.ci.events
```

The main queue is bound to all three keys (`build.queued`, `build.started`,
`build.finished`) so every event type lands in the same queue.

**Where to look:** `src/rabbit/topology.ts` — `setupTopology()`

---

### 2. Competing Consumers

Two consumers (`consumer-1`, `consumer-2`) both call `channel.consume` on the
**same** queue (`demo.ci.events`). RabbitMQ round-robins unacknowledged message
slots across them.

`channel.prefetch(5)` limits each consumer to at most 5 unacknowledged messages
at once. This prevents a slow consumer from starving the other and keeps load
balanced during processing spikes.

**Observable effect:** roughly half the success rows in the UI are blue
(consumer-1) and half are green (consumer-2).

**Where to look:** `src/consumers/consumer.ts`, `src/index.ts`

---

### 3. Retry with Dead-Letter Queue + TTL

This pattern avoids busy-retry loops while keeping the work queue unblocked.

**Topology:**

```Plaintext
demo.ci.retry.exchange  (direct)
        │
        └─► demo.ci.retry.queue
                x-message-ttl:          2000   ← message expires after 2 s
                x-dead-letter-exchange: demo.ci.exchange
```

**Flow for a transient failure (build.finished + status=failed, attempt 1):**

1. Consumer detects failure → publishes to `demo.ci.retry.exchange` with
   routing key = `build.finished` and `attempt = 2`.
2. Message sits in `demo.ci.retry.queue` for 2 000 ms.
3. TTL fires → RabbitMQ dead-letters the message to `demo.ci.exchange` using
   the **same routing key** it arrived with (`build.finished`).
4. Message re-enters `demo.ci.events` and is picked up by a consumer.
5. On attempt 2, same thing happens → attempt 3.
6. On attempt 3, `shouldFail()` returns `false` → message succeeds.

No `x-dead-letter-routing-key` is set on the queue; RabbitMQ preserves the
original routing key automatically, which is how the message re-enters the
correct binding.

**Where to look:**

- Topology: `src/rabbit/topology.ts`
- Logic: `src/services/retryService.ts`, `src/consumers/consumer.ts`

---

### 4. Poison Message Handling

A message becomes _poison_ in two ways:

| Cause          | Detection                          | Action               |
| -------------- | ---------------------------------- | -------------------- |
| Malformed JSON | `JSON.parse` throws                | `sendToPoison` + ack |
| Schema invalid | `BuildEventSchema.safeParse` fails | `sendToPoison` + ack |

The original message is **always acknowledged** after routing to poison.
This prevents it from being re-delivered indefinitely. The Zod validation
error message is stored alongside the raw bytes in `demo.ci.poison`.

Each publisher deliberately injects 5 poison messages per run (alternating
between broken JSON and structurally invalid objects).

**Where to look:** `src/services/poisonService.ts`, `src/consumers/consumer.ts`

---

### 5. Schema Validation with Zod

All messages are validated with a strict Zod schema before processing.
Conditional refinements enforce domain rules:

```typescript
.refine(d => d.type !== 'build.finished' || d.status !== undefined)
.refine(d => d.type !== 'build.finished' || d.durationMs !== undefined)
```

If validation fails the consumer extracts a human-readable reason from
`error.issues` and stores it in the poison record.

**Where to look:** `src/schema/events.ts`

---

## What to Observe in the RabbitMQ Dashboard (port 15672)

Login: `guest` / `guest`

### Exchanges tab

| Exchange                 | Type   | Purpose                           |
| ------------------------ | ------ | --------------------------------- |
| `demo.ci.exchange`       | direct | Primary inbound exchange          |
| `demo.ci.retry.exchange` | direct | Holds messages awaiting retry TTL |

### Queues tab

| Queue                 | What to watch                                               |
| --------------------- | ----------------------------------------------------------- |
| `demo.ci.events`      | Message rate — should be near zero when publishers are done |
| `demo.ci.retry.queue` | Spikes briefly when failures arrive, drains every ~2 s      |
| `demo.ci.poison`      | Grows by ~10 per run (5 per publisher)                      |

Click a queue → **Get messages** to inspect raw payloads.

### Bindings sub-tab (demo.ci.retry.queue)

Confirms the TTL and dead-letter-exchange arguments are set correctly.

---

## Running Tests

No RabbitMQ needed:

```bash
npm test
```

Expected output (all passing):

```Plaintext
✓ tests/schema.test.ts          (17 tests)
✓ tests/retry.test.ts           (10 tests)
✓ tests/eventBuilder.test.ts    (13 tests)
✓ tests/integration.test.ts     (11 tests)
```

Watch mode:

```bash
npm run test:watch
```

---

## Troubleshooting

**`ECONNREFUSED` on startup**

RabbitMQ isn't running. Start it:

```bash
docker start rabbit
# or if not created yet:
docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

**`PRECONDITION_FAILED — inequivalent arg`**

A queue or exchange was previously declared with different arguments.
Delete the old queues in the Management UI (Queues → Delete) or:

```bash
docker restart rabbit
```

**Messages pile up in `demo.ci.retry.queue` and never drain**

The `x-dead-letter-exchange` argument was not set at queue creation time,
or the exchange name is misspelled. Restart Rabbit (see above) to get a
clean slate.

### UI shows "Disconnected"

The Express server is not running, or the `/events` SSE endpoint returned
an error. Check the terminal running `npm start`.

### Only one consumer appears in the logs

Both consumers share the same channel pool. If one channel errors out, restart
the server. Verify both are registered in the RabbitMQ **Channels** tab.

---

## Demo Script

### Step 1: Start everything

```bash
# Terminal 1
npm start
# → watch for "consumer-1 and consumer-2 active"

# Terminal 2
npm run publish:1

# Terminal 3
npm run publish:2
```

### Step 2: What the logs should show (Terminal 1)

```Plaintext
[consumer-1] [550e8400] Processing build.queued attempt=1 repo=frontend branch=main
[consumer-2] [6ba7b81] Processing build.finished attempt=1 repo=backend branch=main
[consumer-2] [6ba7b81] ↻ Retry scheduled — attempt 2 (dead-letters back in 2 s)
...
[consumer-1] ✗ Invalid JSON → poison
[consumer-1] ✗ Schema invalid → poison  [root: Required]
...
(after ~2 s gap)
[consumer-2] [6ba7b81] Processing build.finished attempt=2 repo=backend branch=main
[consumer-2] [6ba7b81] ↻ Retry scheduled — attempt 3 (dead-letters back in 2 s)
...
(after ~2 s gap)
[consumer-1] [6ba7b81] ✓ build.finished processed by consumer-1 status=failed duration=...ms
```

Key things to notice:

- `consumer-1` and `consumer-2` interleave, demonstrating competing consumers.
- The same `traceId` prefix appears across all three retry hops.
- Poison messages are acked immediately (no retry loop).
- After attempt 3, `build.finished+failed` events **succeed** (simulated recovery).

### Step 3: What the UI should display

Open <http://localhost:3000>

- **Successful Events table**: blue rows (consumer-1) and green rows (consumer-2)
  mixed together. Some `build.finished` rows will show `attempt=3`, proving
  they went through the retry loop.
- **Poison / Failed Events table**: red rows with truncated raw payloads and
  the specific Zod or JSON error reason.
- The `SSE status` pill in the top-right shows **Connected** and updates every second.

### Step 4: What to inspect in RabbitMQ (<http://localhost:15672>)

1. **Queues** → `demo.ci.retry.queue`
   - During publishing you'll see the _Ready_ count briefly rise and fall
     as TTL-expired messages dead-letter back to the main exchange.

2. **Queues** → `demo.ci.poison`
   - After both publishers finish: ~10 messages (5 per publisher).
   - Click **Get messages** to see the raw poison records.

3. **Exchanges** → `demo.ci.exchange` → **Bindings**
   - Three bindings: `build.queued`, `build.started`, `build.finished`
     all routing to `demo.ci.events`.

4. **Channels** tab
   - Two consumer channels visible during processing, each with
     `prefetch count = 5`.
