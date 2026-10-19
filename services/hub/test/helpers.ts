import { randomUUID } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../src/app.js';
import { createAuthenticator } from '../src/auth.js';
import type { DocumentRepository, ListFilter, OutboxItem } from '../src/db/repository.js';
import { ALLOWED_FROM, routingKeyFor, type DocumentEvent, type DocumentRecord, type DocumentStatus, type NewDocument } from '../src/domain.js';
import type { Publisher } from '../src/messaging/broker.js';
import { createMetrics } from '../src/metrics.js';
import { DocumentValidator } from '../src/validation.js';

export const SCHEMAS_DIR = new URL('../../../schemas', import.meta.url).pathname;
const ISSUER = 'http://keycloak.test/realms/intercom';
const AUDIENCE = 'intercom-hub';

export class InMemoryRepository implements DocumentRepository {
  docs = new Map<string, DocumentRecord>();
  history = new Map<string, DocumentEvent[]>();
  outbox: (OutboxItem & { published: boolean })[] = [];

  async create(doc: NewDocument, actor: string) {
    const existing = [...this.docs.values()].find(
      (d) => doc.idempotencyKey !== null && d.originEntity === doc.originEntity && d.idempotencyKey === doc.idempotencyKey,
    );
    if (existing) return { document: existing, created: false };
    const now = new Date().toISOString();
    const record: DocumentRecord = { ...doc, id: randomUUID(), status: 'RECEIVED', createdAt: now, updatedAt: now };
    this.docs.set(record.id, record);
    this.history.set(record.id, [{ status: 'RECEIVED', actor, detail: null, createdAt: now }]);
    this.outbox.push({
      id: this.outbox.length + 1, documentId: record.id, routingKey: routingKeyFor(doc),
      message: { documentId: record.id } as never, headers: {}, attempts: 0, published: false,
    });
    return { document: record, created: true };
  }
  async findById(id: string) {
    return this.docs.get(id) ?? null;
  }
  async events(id: string) {
    return this.history.get(id) ?? [];
  }
  async list(filter: ListFilter) {
    return [...this.docs.values()]
      .filter((d) => (filter.direction === 'sent' ? d.originCountry : d.destinationCountry) === filter.country)
      .filter((d) => !filter.status || d.status === filter.status)
      .slice(0, filter.limit);
  }
  async transition(id: string, to: DocumentStatus, actor: string, detail: Record<string, unknown> | null) {
    const doc = this.docs.get(id);
    if (!doc) return null;
    if (doc.status === to) return doc;
    if (!ALLOWED_FROM[to].includes(doc.status)) return null;
    const updated = { ...doc, status: to, updatedAt: new Date().toISOString() };
    this.docs.set(id, updated);
    this.history.get(id)!.push({ status: to, actor, detail, createdAt: updated.updatedAt });
    return updated;
  }
  async claimOutbox(limit: number, handler: (item: OutboxItem) => Promise<void>) {
    const pending = this.outbox.filter((o) => !o.published).slice(0, limit);
    for (const item of pending) {
      item.attempts += 1;
      try {
        await handler(item);
        item.published = true;
      } catch {
        // stays pending, like the real outbox
      }
    }
    return pending.length;
  }
  async pendingOutbox() {
    return this.outbox.filter((o) => !o.published).length;
  }
  async ping() {}
}

export class FakePublisher implements Publisher {
  ready = true;
  fail = false;
  sent: { routingKey: string; message: unknown }[] = [];
  isReady() {
    return this.ready;
  }
  async publish(routingKey: string, message: unknown) {
    if (this.fail) throw new Error('broker unavailable');
    this.sent.push({ routingKey, message });
  }
}

export async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
  const repo = new InMemoryRepository();
  const publisher = new FakePublisher();
  const metrics = createMetrics();
  const app = buildApp({
    repo,
    publisher,
    validator: await DocumentValidator.load(SCHEMAS_DIR),
    authenticate: createAuthenticator({ issuer: ISSUER, audience: AUDIENCE, keys: createLocalJWKSet({ keys: [jwk] }) }),
    metrics,
    logLevel: 'silent',
  });

  const token = (claims: Record<string, unknown>, opts: { issuer?: string; audience?: string } = {}) =>
    new SignJWT({ realm_access: { roles: ['documents:send', 'documents:receive'] }, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(opts.issuer ?? ISSUER)
      .setAudience(opts.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  return {
    app,
    repo,
    publisher,
    metrics,
    token,
    bolivia: () => token({ azp: 'senavex-bo', country: 'BO', entity: 'SENAVEX' }),
    peru: () => token({ azp: 'vuce-pe', country: 'PE', entity: 'VUCE-PE' }),
    colombia: () => token({ azp: 'vuce-co', country: 'CO', entity: 'VUCE-CO' }),
  };
}
