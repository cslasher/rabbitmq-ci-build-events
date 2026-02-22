import amqp from 'amqplib';

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://localhost';

// amqplib v0.10 separates the base Connection interface (close/events only)
// from ChannelModel, which is what connect() actually returns and what
// exposes createChannel() / createConfirmChannel().
let connection: amqp.ChannelModel | null = null;

/**
 * Returns (or creates) a single shared AMQP connection.
 * Callers should create their own channels from this connection.
 */
export async function getConnection(): Promise<amqp.ChannelModel> {
  if (!connection) {
    connection = await amqp.connect(RABBITMQ_URL);
    console.log(`[RabbitMQ] Connected to ${RABBITMQ_URL}`);

    connection.on('error', (err: Error) => {
      console.error('[RabbitMQ] Connection error:', err.message);
      connection = null;
    });

    connection.on('close', () => {
      console.log('[RabbitMQ] Connection closed');
      connection = null;
    });
  }
  return connection;
}

export async function closeConnection(): Promise<void> {
  if (connection) {
    try {
      await connection.close();
    } catch {
      // already closed — ignore
    }
    connection = null;
  }
}
