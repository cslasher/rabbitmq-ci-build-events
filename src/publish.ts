/**
 * CLI publisher entry point.
 *
 * Usage:
 *   npm run publish:1
 *   npm run publish:2
 *
 * Or directly:
 *   ts-node src/publish.ts --producerId publisher-2 --count 100 --rateMs 20 --poisonCount 8
 *
 * Flags (all optional):
 *   --producerId   publisher-1 | publisher-2   (default: publisher-1)
 *   --count        total messages to publish   (default: 50)
 *   --rateMs       delay between messages ms   (default: 50)
 *   --poisonCount  number of malformed msgs    (default: 5)
 */
import { getConnection, closeConnection } from './rabbit/connection';
import { setupTopology } from './rabbit/topology';
import { runPublisher, type PublisherOptions } from './publishers/publisher';

// ─── Minimal argv parser ───────────────────────────────────────────────────────

function parseArgs(): PublisherOptions {
  const args = process.argv.slice(2);

  function flag(name: string, fallback: string): string {
    const idx = args.indexOf(name);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  }

  const producerId = flag('--producerId', 'publisher-1') as PublisherOptions['producerId'];
  const count      = parseInt(flag('--count',       '50'), 10);
  const rateMs     = parseInt(flag('--rateMs',      '50'), 10);
  const poisonCount = parseInt(flag('--poisonCount', '5'), 10);

  if (!['publisher-1', 'publisher-2'].includes(producerId)) {
    console.error('--producerId must be publisher-1 or publisher-2');
    process.exit(1);
  }

  return { producerId, count, rateMs, poisonCount };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();
  console.log('[Publisher] Options:', opts);

  const conn    = await getConnection();

  // Ensure topology exists (idempotent — safe even if server already set it up)
  const setupCh = await conn.createChannel();
  await setupTopology(setupCh);
  await setupCh.close();

  const channel = await conn.createChannel();
  await runPublisher(channel, opts);

  await channel.close();
  await closeConnection();
}

main().catch((err) => {
  console.error('[Publisher] Fatal:', err);
  process.exit(1);
});
