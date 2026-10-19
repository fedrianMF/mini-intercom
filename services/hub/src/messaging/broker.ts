import amqp, { type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { assertTopology, DEAD_LETTER_QUEUE, EXCHANGES } from './topology.js';

export interface Publisher {
  publish(routingKey: string, message: unknown, headers: Record<string, string>): Promise<void>;
  isReady(): boolean;
}

export interface DeadLetter {
  documentId: string;
  reason: string;
  attempts: number;
}

/**
 * Thin wrapper over a confirm channel: publish() resolves only after the
 * broker has persisted the message, which is what lets the outbox mark it sent.
 */
export class Broker implements Publisher {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  constructor(
    private readonly url: string,
    private readonly log: { info: (msg: string) => void; error: (obj: unknown, msg: string) => void },
  ) {}

  async connect(): Promise<void> {
    this.connection = await amqp.connect(this.url);
    this.connection.on('close', () => {
      this.channel = null;
      this.log.error({}, 'broker connection closed, reconnecting in 5s');
      setTimeout(() => this.connect().catch((err) => this.log.error(err, 'broker reconnect failed')), 5_000);
    });
    this.connection.on('error', (err) => this.log.error(err, 'broker connection error'));
    const channel = await this.connection.createConfirmChannel();
    await assertTopology(channel);
    this.channel = channel;
    this.log.info('connected to broker');
  }

  isReady(): boolean {
    return this.channel !== null;
  }

  async publish(routingKey: string, message: unknown, headers: Record<string, string>): Promise<void> {
    const channel = this.channel;
    if (!channel) throw new Error('broker not connected');
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        EXCHANGES.documents,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        { persistent: true, contentType: 'application/json', headers: { ...headers, 'x-attempt': 1 } },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }

  /** Consumes documents that adapters gave up on after their retries. */
  async consumeDeadLetters(handler: (letter: DeadLetter) => Promise<void>): Promise<void> {
    const channel = this.channel;
    if (!channel) throw new Error('broker not connected');
    await channel.prefetch(10);
    await channel.consume(DEAD_LETTER_QUEUE, async (msg: ConsumeMessage | null) => {
      if (!msg) return;
      try {
        const body = JSON.parse(msg.content.toString()) as { documentId?: string };
        const headers = msg.properties.headers ?? {};
        if (body.documentId) {
          await handler({
            documentId: body.documentId,
            reason: String(headers['x-failure-reason'] ?? 'delivery failed'),
            attempts: Number(headers['x-attempt'] ?? 0),
          });
        }
        channel.ack(msg);
      } catch (err) {
        this.log.error(err, 'failed to process dead letter');
        channel.nack(msg, false, true);
      }
    });
  }

  async close(): Promise<void> {
    this.connection?.removeAllListeners('close');
    await this.connection?.close().catch(() => undefined);
  }
}
