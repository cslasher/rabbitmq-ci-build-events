/**
 * Single-process entry point.
 *
 * Starts in order:
 *   1. Connect to RabbitMQ and assert topology
 *   2. Spin up consumer-1 and consumer-2 (competing consumers)
 *   3. Start Express dashboard on PORT (default 3000)
 *   4. Register SIGINT / SIGTERM handlers for graceful shutdown
 */
import http from 'http';
import { getConnection, closeConnection } from './rabbit/connection';
import { setupTopology } from './rabbit/topology';
import { startConsumer } from './consumers/consumer';
import { createApp } from './server/app';

const PORT = parseInt(process.env.PORT ?? '3000', 10);

async function main(): Promise<void> {
  // ── RabbitMQ ───────────────────────────────────────────────────────────────
  const conn = await getConnection();

  // Use a short-lived channel just for topology, then close it
  const setupCh = await conn.createChannel();
  await setupTopology(setupCh);
  await setupCh.close();

  // Each consumer needs its own channel so prefetch is per-consumer
  const ch1 = await conn.createChannel();
  const ch2 = await conn.createChannel();

  await startConsumer(ch1, 'consumer-1');
  await startConsumer(ch2, 'consumer-2');
  console.log('[Server] consumer-1 and consumer-2 active');

  // ── Express ────────────────────────────────────────────────────────────────
  const app    = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(PORT, resolve));
  console.log(`[Server] Dashboard → http://localhost:${PORT}`);
  console.log('[Server] Ready. Run publishers in separate terminals.');

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[Server] ${signal} received — shutting down…`);
    server.close();
    try { await ch1.close(); } catch { /* ignore */ }
    try { await ch2.close(); } catch { /* ignore */ }
    await closeConnection();
    console.log('[Server] Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Server] Fatal:', err);
  process.exit(1);
});
