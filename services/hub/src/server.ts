import pg from 'pg';
import { buildApp } from './app.js';
import { createAuthenticator, remoteKeys } from './auth.js';
import { loadConfig } from './config.js';
import { migrate } from './db/migrate.js';
import { PgDocumentRepository } from './db/repository.js';
import { routingKeyFor, type DocumentRecord, type RoutedMessage } from './domain.js';
import { Broker } from './messaging/broker.js';
import { createMetrics } from './metrics.js';
import { startOutboxRelay } from './outbox-relay.js';
import { DocumentValidator } from './validation.js';

function toMessage(doc: DocumentRecord): RoutedMessage {
  return {
    documentId: doc.id,
    documentType: doc.documentType,
    schemaVersion: doc.schemaVersion,
    originCountry: doc.originCountry,
    originEntity: doc.originEntity,
    destinationCountry: doc.destinationCountry,
    format: doc.format,
    payload: doc.payload,
    payloadXml: doc.payloadXml,
    payloadSha256: doc.payloadSha256,
    sentAt: doc.createdAt,
  };
}

async function main() {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
  const metrics = createMetrics();
  const validator = await DocumentValidator.load(config.schemasDir);
  const repo = new PgDocumentRepository(pool, routingKeyFor, toMessage);

  // The logger lives on the app, so build it before the broker.
  let broker: Broker | undefined;
  const app = buildApp({
    repo,
    publisher: { isReady: () => broker?.isReady() ?? false, publish: (...args) => broker!.publish(...args) },
    validator,
    authenticate: createAuthenticator({ issuer: config.oidcIssuer, audience: config.oidcAudience, keys: remoteKeys(config.oidcJwksUrl) }),
    metrics,
    logLevel: config.logLevel,
  });

  if (config.runMigrations) await migrate(pool, (msg) => app.log.info(msg));

  broker = new Broker(config.amqpUrl, app.log);
  await broker.connect();
  await broker.consumeDeadLetters(async (letter) => {
    const doc = await repo.transition(letter.documentId, 'FAILED', 'hub', { reason: letter.reason, attempts: letter.attempts });
    if (doc?.status === 'FAILED') {
      metrics.documentTransitions.inc({ status: 'FAILED', destination: doc.destinationCountry });
      app.log.warn({ documentId: doc.id, reason: letter.reason }, 'document delivery failed');
    }
  });

  const stopRelay = startOutboxRelay(repo, broker, metrics, app.log, config.outboxPollMs);

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    stopRelay();
    await app.close();
    await broker?.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  app.log.info({ documentTypes: validator.supportedTypes() }, 'schemas loaded');
  await app.listen({ host: '0.0.0.0', port: config.port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
