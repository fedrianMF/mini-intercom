import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { startOutboxRelay } from '../src/outbox-relay.js';
import { SCHEMAS_DIR, setup } from './helpers.js';

const envelope = async () => JSON.parse(await readFile(`${SCHEMAS_DIR}/samples/certificado-origen.json`, 'utf8'));

async function send(ctx: Awaited<ReturnType<typeof setup>>, body?: unknown, headers: Record<string, string> = {}) {
  return ctx.app.inject({
    method: 'POST',
    url: '/v1/documents',
    headers: { authorization: `Bearer ${await ctx.bolivia()}`, ...headers },
    payload: body ?? (await envelope()),
  });
}

describe('POST /v1/documents', () => {
  it('requires a valid token', async () => {
    const ctx = await setup();
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/documents', payload: await envelope() });
    expect(res.statusCode).toBe(401);

    const wrongAudience = await ctx.token({ country: 'BO', entity: 'SENAVEX' }, { audience: 'other' });
    const res2 = await ctx.app.inject({ method: 'POST', url: '/v1/documents', headers: { authorization: `Bearer ${wrongAudience}` }, payload: await envelope() });
    expect(res2.statusCode).toBe(401);
  });

  it('requires the send role', async () => {
    const ctx = await setup();
    const token = await ctx.token({ country: 'BO', entity: 'SENAVEX', realm_access: { roles: [] } });
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/documents', headers: { authorization: `Bearer ${token}` }, payload: await envelope() });
    expect(res.statusCode).toBe(403);
  });

  it('takes the origin from the token, not from the body', async () => {
    const ctx = await setup();
    const res = await send(ctx);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body).toMatchObject({ status: 'RECEIVED', originCountry: 'BO', originEntity: 'SENAVEX', destinationCountry: 'PE' });
    expect(res.headers.location).toBe(`/v1/documents/${body.id}`);
    expect(body.payload).toBeUndefined();
  });

  it('returns 422 with the schema errors', async () => {
    const ctx = await setup();
    const body = await envelope();
    body.payload.mercancias = [];
    const res = await send(ctx, body);
    expect(res.statusCode).toBe(422);
    expect(res.json().detail[0]).toContain('/mercancias');
  });

  it('refuses sending to its own country', async () => {
    const ctx = await setup();
    const body = { ...(await envelope()), destinationCountry: 'BO' };
    expect((await send(ctx, body)).statusCode).toBe(422);
  });

  it('is idempotent per entity and key', async () => {
    const ctx = await setup();
    const first = await send(ctx, undefined, { 'idempotency-key': 'BO-2026-000123' });
    const second = await send(ctx, undefined, { 'idempotency-key': 'BO-2026-000123' });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(ctx.repo.docs.size).toBe(1);
  });

  it('echoes the correlation id', async () => {
    const ctx = await setup();
    const res = await send(ctx, undefined, { 'x-correlation-id': 'trace-12345678' });
    expect(res.headers['x-correlation-id']).toBe('trace-12345678');
    expect(ctx.repo.docs.get(res.json().id)?.correlationId).toBe('trace-12345678');
  });
});

describe('document lifecycle', () => {
  it('routes through the outbox, then the destination acknowledges', async () => {
    const ctx = await setup();
    const { id } = (await send(ctx)).json();

    const stop = startOutboxRelay(ctx.repo, ctx.publisher, ctx.metrics, { error: () => undefined }, 5);
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(ctx.publisher.sent).toEqual([{ routingKey: 'PE.certificado-origen', message: { documentId: id } }]);
    expect(ctx.repo.docs.get(id)?.status).toBe('ROUTED');

    const ack = await ctx.app.inject({
      method: 'POST',
      url: `/v1/documents/${id}/acks`,
      headers: { authorization: `Bearer ${await ctx.peru()}` },
      payload: { result: 'accepted' },
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().status).toBe('ACCEPTED');

    const trace = await ctx.app.inject({ method: 'GET', url: `/v1/documents/${id}`, headers: { authorization: `Bearer ${await ctx.bolivia()}` } });
    expect(trace.json().events.map((e: { status: string }) => e.status)).toEqual(['RECEIVED', 'ROUTED', 'ACCEPTED']);
    expect(trace.json().payload.numero).toBe('BO-2026-000123');
  });

  it('keeps messages in the outbox while the broker is down', async () => {
    const ctx = await setup();
    ctx.publisher.fail = true;
    const { id } = (await send(ctx)).json();
    const stop = startOutboxRelay(ctx.repo, ctx.publisher, ctx.metrics, { error: () => undefined }, 5);
    await new Promise((r) => setTimeout(r, 30));
    expect(await ctx.repo.pendingOutbox()).toBe(1);
    expect(ctx.repo.docs.get(id)?.status).toBe('RECEIVED');

    ctx.publisher.fail = false;
    await new Promise((r) => setTimeout(r, 30));
    stop();
    expect(await ctx.repo.pendingOutbox()).toBe(0);
    expect(ctx.repo.docs.get(id)?.status).toBe('ROUTED');
  });

  it('hides documents from countries that are not party to them', async () => {
    const ctx = await setup();
    const { id } = (await send(ctx)).json();
    const res = await ctx.app.inject({ method: 'GET', url: `/v1/documents/${id}`, headers: { authorization: `Bearer ${await ctx.colombia()}` } });
    expect(res.statusCode).toBe(404);
  });

  it('only lets the destination acknowledge, and only once', async () => {
    const ctx = await setup();
    const { id } = (await send(ctx)).json();
    const ackAs = async (token: string, result: string, reason?: string) =>
      ctx.app.inject({ method: 'POST', url: `/v1/documents/${id}/acks`, headers: { authorization: `Bearer ${token}` }, payload: { result, reason } });

    expect((await ackAs(await ctx.bolivia(), 'accepted')).statusCode).toBe(404);
    expect((await ackAs(await ctx.peru(), 'rejected')).statusCode).toBe(400);
    expect((await ackAs(await ctx.peru(), 'rejected', 'importador no registrado')).statusCode).toBe(200);
    expect((await ackAs(await ctx.peru(), 'accepted')).statusCode).toBe(409);
  });

  it('lists sent and received documents per country', async () => {
    const ctx = await setup();
    await send(ctx);
    const sent = await ctx.app.inject({ method: 'GET', url: '/v1/documents?direction=sent', headers: { authorization: `Bearer ${await ctx.bolivia()}` } });
    const received = await ctx.app.inject({ method: 'GET', url: '/v1/documents?direction=received', headers: { authorization: `Bearer ${await ctx.peru()}` } });
    expect(sent.json().items).toHaveLength(1);
    expect(received.json().items).toHaveLength(1);
  });
});

describe('operations endpoints', () => {
  it('reports readiness and exposes metrics', async () => {
    const ctx = await setup();
    expect((await ctx.app.inject({ method: 'GET', url: '/health/ready' })).statusCode).toBe(200);
    ctx.publisher.ready = false;
    const degraded = await ctx.app.inject({ method: 'GET', url: '/health/ready' });
    expect(degraded.statusCode).toBe(503);
    expect(degraded.json().checks.broker).toBe('down');

    await send(ctx);
    const metrics = await ctx.app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.body).toContain('intercom_documents_received_total{document_type="certificado-origen",schema_version="1",origin="BO",destination="PE"} 1');
  });
});
