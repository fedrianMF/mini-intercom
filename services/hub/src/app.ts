import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import { AuthError, type Authenticator } from './auth.js';
import type { DocumentRepository } from './db/repository.js';
import type { DocumentRecord, DocumentStatus, Principal } from './domain.js';
import type { Publisher } from './messaging/broker.js';
import type { Metrics } from './metrics.js';
import type { DocumentValidator } from './validation.js';

export interface AppDeps {
  repo: DocumentRepository;
  publisher: Publisher;
  validator: DocumentValidator;
  authenticate: Authenticator;
  metrics: Metrics;
  logLevel?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal;
  }
}

const ROLE_SEND = 'documents:send';
const ROLE_RECEIVE = 'documents:receive';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problem(status: number, title: string, detail?: unknown) {
  return { type: 'about:blank', status, title, ...(detail === undefined ? {} : { detail }) };
}

/** What a caller sees: the payload only goes to the two parties of the exchange. */
function view(doc: DocumentRecord, includePayload: boolean) {
  const { payload, payloadXml, ...summary } = doc;
  return includePayload ? { ...summary, payload: doc.format === 'json' ? payload : undefined, payloadXml: payloadXml ?? undefined } : summary;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { repo, publisher, validator, authenticate, metrics } = deps;
  const app = Fastify({
    logger: { level: deps.logLevel ?? 'info', redact: ['req.headers.authorization'] },
    bodyLimit: 6 * 1024 * 1024,
    genReqId: (req) => {
      const header = req.headers['x-correlation-id'];
      return typeof header === 'string' && /^[\w-]{8,64}$/.test(header) ? header : randomUUID();
    },
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-correlation-id', req.id);
  });
  app.addHook('onResponse', async (req, reply) => {
    metrics.httpDuration.observe(
      { method: req.method, route: req.routeOptions.url ?? 'unknown', status_code: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });
  app.setErrorHandler((err: FastifyError | AuthError, req, reply) => {
    if (err instanceof AuthError) return reply.code(err.statusCode).type('application/problem+json').send(problem(err.statusCode, err.message));
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err, 'unhandled error');
    return reply.code(status).type('application/problem+json').send(problem(status, status === 500 ? 'internal error' : err.message));
  });

  const requireRole = (role: string) => async (req: FastifyRequest) => {
    req.principal = await authenticate(req.headers.authorization);
    if (!req.principal.roles.includes(role)) throw new AuthError(`missing role ${role}`, 403);
  };

  // --- Health and metrics (not exposed through the gateway) ---
  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_req, reply) => {
    const checks = { database: 'ok', broker: publisher.isReady() ? 'ok' : 'down' };
    try {
      await repo.ping();
    } catch {
      checks.database = 'down';
    }
    const ready = Object.values(checks).every((c) => c === 'ok');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ok' : 'degraded', checks });
  });
  app.get('/metrics', async (_req, reply) => reply.type(metrics.registry.contentType).send(await metrics.registry.metrics()));

  // --- Document exchange API ---
  app.get('/v1/document-types', async () => ({ items: validator.supportedTypes() }));

  app.post('/v1/documents', { preHandler: requireRole(ROLE_SEND) }, async (req, reply) => {
    const { principal } = req;
    const body = req.body;

    if (!validator.validateEnvelope(body)) {
      metrics.documentsRejected.inc({ document_type: 'unknown', origin: principal.country, reason: 'envelope' });
      return reply.code(400).type('application/problem+json').send(problem(400, 'invalid envelope', validator.envelopeErrors()));
    }
    if (body.destinationCountry === principal.country) {
      return reply.code(422).type('application/problem+json').send(problem(422, 'destination must be another member country'));
    }

    const result = await validator.validatePayload(body);
    if (!result.valid) {
      metrics.documentsRejected.inc({ document_type: body.documentType, origin: principal.country, reason: 'schema' });
      return reply.code(422).type('application/problem+json').send(problem(422, 'document does not match its schema', result.errors));
    }

    const idempotencyKey = req.headers['idempotency-key'];
    const canonical = body.format === 'json' ? JSON.stringify(body.payload) : (body.payloadXml ?? '');
    const { document, created } = await repo.create(
      {
        documentType: body.documentType,
        schemaVersion: body.schemaVersion,
        originCountry: principal.country,
        originEntity: principal.entity,
        destinationCountry: body.destinationCountry,
        idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey.slice(0, 100) : null,
        format: body.format,
        payload: body.format === 'json' ? body.payload : null,
        payloadXml: body.format === 'xml' ? (body.payloadXml ?? null) : null,
        payloadSha256: createHash('sha256').update(canonical).digest('hex'),
        correlationId: req.id,
      },
      principal.clientId,
    );

    if (created) {
      metrics.documentsReceived.inc({ document_type: document.documentType, schema_version: document.schemaVersion, origin: document.originCountry, destination: document.destinationCountry });
      req.log.info({ documentId: document.id, destination: document.destinationCountry }, 'document received');
    }
    return reply
      .code(created ? 202 : 200)
      .header('location', `/v1/documents/${document.id}`)
      .send(view(document, false));
  });

  app.get<{ Querystring: { direction?: string; status?: string; limit?: string } }>(
    '/v1/documents',
    { preHandler: requireRole(ROLE_SEND) },
    async (req, reply) => {
      const direction = req.query.direction === 'received' ? 'received' : 'sent';
      const status = req.query.status?.toUpperCase() as DocumentStatus | undefined;
      if (status && !['RECEIVED', 'ROUTED', 'ACCEPTED', 'REJECTED', 'FAILED'].includes(status)) {
        return reply.code(400).send(problem(400, 'unknown status'));
      }
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      const items = await repo.list({ country: req.principal.country, direction, status, limit });
      return { items: items.map((d) => view(d, false)) };
    },
  );

  const loadForParty = async (req: FastifyRequest<{ Params: { id: string } }>) => {
    if (!UUID.test(req.params.id)) return null;
    const doc = await repo.findById(req.params.id);
    if (!doc) return null;
    const { country } = req.principal;
    return doc.originCountry === country || doc.destinationCountry === country ? doc : null;
  };

  app.get<{ Params: { id: string } }>('/v1/documents/:id', { preHandler: requireRole(ROLE_SEND) }, async (req, reply) => {
    const doc = await loadForParty(req);
    if (!doc) return reply.code(404).send(problem(404, 'document not found'));
    return { ...view(doc, true), events: await repo.events(doc.id) };
  });

  app.post<{ Params: { id: string }; Body: { result?: string; reason?: string } }>(
    '/v1/documents/:id/acks',
    { preHandler: requireRole(ROLE_RECEIVE) },
    async (req, reply) => {
      const doc = await loadForParty(req);
      if (!doc || doc.destinationCountry !== req.principal.country) return reply.code(404).send(problem(404, 'document not found'));

      const result = req.body?.result;
      if (result !== 'accepted' && result !== 'rejected') {
        return reply.code(400).send(problem(400, 'result must be accepted or rejected'));
      }
      if (result === 'rejected' && !req.body.reason) {
        return reply.code(400).send(problem(400, 'a rejection needs a reason'));
      }

      const to: DocumentStatus = result === 'accepted' ? 'ACCEPTED' : 'REJECTED';
      const updated = await repo.transition(doc.id, to, req.principal.clientId, req.body.reason ? { reason: req.body.reason } : null);
      if (!updated || updated.status !== to) {
        return reply.code(409).send(problem(409, `document is already ${updated?.status ?? doc.status}`));
      }
      metrics.documentTransitions.inc({ status: to, destination: updated.destinationCountry });
      return view(updated, false);
    },
  );

  return app;
}

