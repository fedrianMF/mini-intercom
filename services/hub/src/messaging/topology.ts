import type { Channel } from 'amqplib';
import { COUNTRIES } from '../config.js';

export const EXCHANGES = {
  documents: 'intercom.documents',
  retry: 'intercom.retry',
  dead: 'intercom.dead',
} as const;

export const RETRY_DELAY_MS = 10_000;
export const DEAD_LETTER_QUEUE = 'intercom.dead-letters';

export function inboxQueue(country: string): string {
  return `entity.${country}.inbox`;
}

/**
 * documents (topic)  --<CC>.#-->  entity.<CC>.inbox  (one queue per member country)
 * retry (topic)      --#------->  intercom.retry.delay  --TTL--> back to documents with the same routing key
 * dead (fanout)      ---------->  intercom.dead-letters (the hub marks those documents FAILED)
 *
 * Declarations are idempotent, so the hub and every adapter can run this at startup.
 */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertExchange(EXCHANGES.documents, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.retry, 'topic', { durable: true });
  await channel.assertExchange(EXCHANGES.dead, 'fanout', { durable: true });

  for (const country of COUNTRIES) {
    const queue = inboxQueue(country);
    await channel.assertQueue(queue, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
    await channel.bindQueue(queue, EXCHANGES.documents, `${country}.#`);
  }

  await channel.assertQueue('intercom.retry.delay', {
    durable: true,
    arguments: { 'x-message-ttl': RETRY_DELAY_MS, 'x-dead-letter-exchange': EXCHANGES.documents },
  });
  await channel.bindQueue('intercom.retry.delay', EXCHANGES.retry, '#');

  await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true, arguments: { 'x-queue-type': 'quorum' } });
  await channel.bindQueue(DEAD_LETTER_QUEUE, EXCHANGES.dead, '');
}
