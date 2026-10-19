import type { DocumentRepository } from './db/repository.js';
import type { Publisher } from './messaging/broker.js';
import type { Metrics } from './metrics.js';

interface Logger {
  error: (obj: unknown, msg: string) => void;
}

/** Polls the outbox and publishes pending messages; marks each published document ROUTED. */
export function startOutboxRelay(repo: DocumentRepository, publisher: Publisher, metrics: Metrics, log: Logger, intervalMs: number) {
  let running = true;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (!running) return;
    try {
      if (publisher.isReady()) {
        const published: string[] = [];
        await repo.claimOutbox(50, async (item) => {
          try {
            await publisher.publish(item.routingKey, item.message, item.headers);
            published.push(item.documentId);
          } catch (err) {
            metrics.outboxPublishFailures.inc();
            throw err;
          }
        });
        for (const id of published) {
          const doc = await repo.transition(id, 'ROUTED', 'hub', null);
          if (doc?.status === 'ROUTED') metrics.documentTransitions.inc({ status: 'ROUTED', destination: doc.destinationCountry });
        }
      }
      metrics.outboxPending.set(await repo.pendingOutbox());
    } catch (err) {
      log.error(err, 'outbox relay tick failed');
    } finally {
      if (running) timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);
  return () => {
    running = false;
    clearTimeout(timer);
  };
}
