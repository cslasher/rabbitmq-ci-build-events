# Summary

You are a senior backend engineer. Generate a small but educational RabbitMQ demo repo illustrating advanced messaging patterns clearly and correctly.

Pre-request (already done by human):
RabbitMQ is running locally via:
docker run -d --name rabbit -p 5672:5672 -p 15672:15672 rabbitmq:3-management

Goal:
Demonstrate:

- Direct exchange + routing keys
- Competing consumers
- Poison message handling
- Retry with DLQ + TTL pattern
- Schema validation
- Single-process consumer + Express UI
- Automated tests

Keep it educational, clean, and runnable.

---

## SCENARIO: CI BUILD EVENTS

Each valid message:

- eventId (uuid)
- type: build.queued | build.started | build.finished
- repo
- branch
- commitSha (short)
- status (only for build.finished): success | failed
- durationMs (only for build.finished)
- createdAt (ISO string)
- producerId (publisher-1 or publisher-2)
- attempt (number, starts at 1)
- traceId (uuid, constant across retries)

---

## RABBITMQ TOPOLOGY

Exchange:

- demo.ci.exchange (direct, durable)

Main Queue:

- demo.ci.events (durable)
- Bound to exchange with routing keys:
  - build.queued
  - build.started
  - build.finished

Retry Pattern:

- Retry exchange: demo.ci.retry.exchange
- Retry queue: demo.ci.retry.queue
  - TTL: 2000ms
  - dead-letter-exchange: demo.ci.exchange
  - dead-letter-routing-key: original routing key
- Max attempts: 3

Poison Queue:

- demo.ci.poison (durable)

---

## COMPETING CONSUMERS

- Two consumers (consumer-1, consumer-2)
- Both consume from demo.ci.events
- channel.prefetch(5)
- Log consumerId for each message
- Show load distribution clearly

---

## TRANSIENT FAILURE SIMULATION

Simulate deterministic transient failure:

- If build.finished AND status=failed:
  - Fail processing for attempts 1 and 2
  - Succeed on attempt 3

Retry rules:

- If attempt < 3:
  - Publish to retry exchange with incremented attempt
  - Preserve traceId
  - ACK original message
- If attempt == 3 and still failing:
  - Route to poison queue
  - ACK original

---

## POISON MESSAGES

Each publisher generates:

- 50 messages total
- 5 poison messages (malformed JSON or missing required fields)

Consumers:

- Validate using Zod schema
- Invalid schema → route to poison queue with reason
- ACK original

---

## SINGLE PROCESS ARCHITECTURE

One Node process must:

- Start Express (port 3000)
- Start consumer-1 and consumer-2 concurrently
- Provide SSE endpoint: /events
- Store last 200 successful messages in memory
- Store last 200 poison messages in memory

---

## WEB UI

Render a simple HTML page at `http://localhost:3000`

Requirements:

- Two sections:
  1. Successful Events
  2. Poison / Failed Events
- Render events in HTML tables
- Most recent at top

Styling requirement:

- consumer-1 rows should have one subtle style (e.g. light blue background)
- consumer-2 rows should have a different subtle style (e.g. light green background)
- Poison rows should be lightly red-tinted
- Keep styling minimal and clean (no CSS frameworks)

---

## PUBLISHERS

Two publishers:

- publisher-1
- publisher-2

CLI options:
--count (default 50)
--rateMs (default 50)
--poisonCount (default 5)

Publish to demo.ci.exchange using routing key matching event.type.

---

## SCHEMA VALIDATION

- Use Zod
- Validate message payload strictly
- Include error reason when sending to poison queue

---

## GRACEFUL SHUTDOWN

Handle SIGINT:

- Close channels
- Close RabbitMQ connection
- Stop Express server

---

## AUTOMATED TESTS

Generate tests using Vitest (preferred) or Jest.

Include:

1. Unit Tests:
   - Zod schema validation
   - Retry decision logic
   - Poison detection
   - Transient failure simulation
   - Event builder

2. Integration Test (lightweight):
   - Mock amqplib channel to verify:
   - publish called with correct routing key
   - retry increments attempt
   - poison routing occurs

Tests must:

- Not require RabbitMQ to run
- Be runnable via npm test

---

## PROJECT REQUIREMENTS

- Node.js + TypeScript
- amqplib
- zod
- vitest
- minimal dependencies
- Clean modular structure:
  - rabbit/
  - publishers/
  - consumers/
  - server/
  - schema/
  - services/
  - tests/

---

## OUTPUT FORMAT

1. Show full file tree
2. Show full contents of every file
3. Include README with:
   - Setup steps
   - Architecture explanation
   - What to observe in RabbitMQ UI (15672)
   - Explanation of retry pattern
   - Explanation of competing consumers
   - Troubleshooting section

After generating code:
Provide a “Demo Script”:

- Exact commands to run
- What logs should show
- What UI should display
- What to inspect in RabbitMQ dashboard
