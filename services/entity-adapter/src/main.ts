import amqp, { type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { decide, onTransientFailure, TransientError, type Decision, type InboundDocument } from './logic.js';

const env = (name: string, fallback?: string) => {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing environment variable ${name}`);
  return value;
};

const config = {
  country: env('COUNTRY'),
  amqpUrl: env('AMQP_URL'),
  hubUrl: env('HUB_URL'),
  tokenUrl: env('TOKEN_URL'),
  clientId: env('CLIENT_ID'),
  clientSecret: env('CLIENT_SECRET'),
  maxAttempts: Number(env('MAX_ATTEMPTS', '3')),
  failRate: Number(env('FAIL_RATE', '0')),
};

const log = (level: 'info' | 'warn' | 'error', msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, time: new Date().toISOString(), service: `adapter-${config.country}`, msg, ...extra }));

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.expiresAt > Date.now() + 10_000) return token.value;
  const res = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }),
  });
  if (!res.ok) throw new TransientError(`token endpoint returned ${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return token.value;
}

async function acknowledge(doc: InboundDocument, decision: Decision, correlationId: string) {
  let res: Response;
  try {
    res = await fetch(`${config.hubUrl}/v1/documents/${doc.documentId}/acks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken()}`, 'x-correlation-id': correlationId },
      body: JSON.stringify(decision),
    });
  } catch (err) {
    throw new TransientError(`hub unreachable: ${(err as Error).message}`);
  }
  // 409 means a previous attempt already recorded the answer.
  if (res.ok || res.status === 409) return;
  if (res.status >= 500 || res.status === 401) throw new TransientError(`hub returned ${res.status}`);
  throw new Error(`hub refused ack with ${res.status}: ${await res.text()}`);
}

async function deliverToNationalSystem(doc: InboundDocument): Promise<Decision> {
  if (Math.random() < config.failRate) throw new TransientError('national system timeout (simulated)');
  return decide(doc, config.country);
}

async function handle(channel: ConfirmChannel, msg: ConsumeMessage) {
  const headers = msg.properties.headers ?? {};
  const attempt = Number(headers['x-attempt'] ?? 1);
  const correlationId = String(headers['x-correlation-id'] ?? '');
  const doc = JSON.parse(msg.content.toString()) as InboundDocument;

  try {
    const decision = await deliverToNationalSystem(doc);
    await acknowledge(doc, decision, correlationId);
    log('info', 'document processed', { documentId: doc.documentId, result: decision.result, attempt, correlationId });
  } catch (err) {
    const reason = (err as Error).message;
    const next = err instanceof TransientError ? onTransientFailure(attempt, config.maxAttempts) : ({ action: 'dead-letter' } as const);
    const exchange = next.action === 'retry' ? 'intercom.retry' : 'intercom.dead';
    await new Promise<void>((resolve, reject) =>
      channel.publish(
        exchange,
        msg.fields.routingKey,
        msg.content,
        {
          persistent: true,
          contentType: 'application/json',
          headers: { ...headers, 'x-attempt': next.action === 'retry' ? next.nextAttempt : attempt, 'x-failure-reason': reason },
        },
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    log('warn', next.action === 'retry' ? 'delivery failed, retry scheduled' : 'delivery failed, dead-lettered', {
      documentId: doc.documentId, attempt, reason, correlationId,
    });
  }
  channel.ack(msg);
}

async function main() {
  const queue = `entity.${config.country}.inbox`;
  for (;;) {
    try {
      const connection = await amqp.connect(config.amqpUrl);
      const channel = await connection.createConfirmChannel();
      await channel.checkQueue(queue); // the hub declares the topology
      await channel.prefetch(5);
      await channel.consume(queue, (msg) => {
        if (msg) handle(channel, msg).catch((err) => log('error', 'handler crashed', { err: String(err) }));
      });
      log('info', 'consuming', { queue });
      await new Promise((resolve) => connection.once('close', resolve));
      log('warn', 'broker connection closed');
    } catch (err) {
      log('warn', 'broker not ready, retrying', { err: String(err) });
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

void main();
