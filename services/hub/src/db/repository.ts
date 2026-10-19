import pg from 'pg';
import type { Country } from '../config.js';
import { ALLOWED_FROM, type DocumentEvent, type DocumentRecord, type DocumentStatus, type NewDocument, type RoutedMessage } from '../domain.js';

export interface OutboxItem {
  id: number;
  documentId: string;
  routingKey: string;
  message: RoutedMessage;
  headers: Record<string, string>;
  attempts: number;
}

export interface ListFilter {
  country: Country;
  direction: 'sent' | 'received';
  status?: DocumentStatus;
  limit: number;
}

export interface DocumentRepository {
  /** Stores the document, its first event and its outbox message atomically. */
  create(doc: NewDocument, actor: string): Promise<{ document: DocumentRecord; created: boolean }>;
  findById(id: string): Promise<DocumentRecord | null>;
  events(id: string): Promise<DocumentEvent[]>;
  list(filter: ListFilter): Promise<DocumentRecord[]>;
  /** Returns the updated document, or null when the transition is not allowed. */
  transition(id: string, to: DocumentStatus, actor: string, detail: Record<string, unknown> | null): Promise<DocumentRecord | null>;
  claimOutbox(limit: number, handler: (item: OutboxItem) => Promise<void>): Promise<number>;
  pendingOutbox(): Promise<number>;
  ping(): Promise<void>;
}

interface DocumentRow {
  id: string;
  document_type: string;
  schema_version: string;
  origin_country: Country;
  origin_entity: string;
  destination_country: Country;
  idempotency_key: string | null;
  format: 'json' | 'xml';
  payload: unknown;
  payload_xml: string | null;
  payload_sha256: string;
  status: DocumentStatus;
  correlation_id: string;
  created_at: Date;
  updated_at: Date;
}

function toRecord(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    documentType: row.document_type,
    schemaVersion: row.schema_version,
    originCountry: row.origin_country,
    originEntity: row.origin_entity,
    destinationCountry: row.destination_country,
    idempotencyKey: row.idempotency_key,
    format: row.format,
    payload: row.payload,
    payloadXml: row.payload_xml,
    payloadSha256: row.payload_sha256,
    status: row.status,
    correlationId: row.correlation_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class PgDocumentRepository implements DocumentRepository {
  constructor(
    private readonly pool: pg.Pool,
    private readonly routingKey: (doc: NewDocument) => string,
    private readonly toMessage: (doc: DocumentRecord) => RoutedMessage,
  ) {}

  async create(doc: NewDocument, actor: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<DocumentRow>(
        `INSERT INTO documents (document_type, schema_version, origin_country, origin_entity, destination_country,
           idempotency_key, format, payload, payload_xml, payload_sha256, status, correlation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RECEIVED',$11)
         ON CONFLICT (origin_entity, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          doc.documentType, doc.schemaVersion, doc.originCountry, doc.originEntity, doc.destinationCountry,
          doc.idempotencyKey, doc.format, doc.format === 'json' ? JSON.stringify(doc.payload) : null,
          doc.payloadXml, doc.payloadSha256, doc.correlationId,
        ],
      );

      const row = inserted.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        const existing = await this.pool.query<DocumentRow>(
          'SELECT * FROM documents WHERE origin_entity = $1 AND idempotency_key = $2',
          [doc.originEntity, doc.idempotencyKey],
        );
        return { document: toRecord(existing.rows[0]!), created: false };
      }

      const record = toRecord(row);
      await client.query('INSERT INTO document_events (document_id, status, actor) VALUES ($1, $2, $3)', [record.id, 'RECEIVED', actor]);
      await client.query('INSERT INTO outbox (document_id, routing_key, message, headers) VALUES ($1, $2, $3, $4)', [
        record.id,
        this.routingKey(doc),
        JSON.stringify(this.toMessage(record)),
        JSON.stringify({ 'x-correlation-id': doc.correlationId }),
      ]);
      await client.query('COMMIT');
      return { document: record, created: true };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async findById(id: string) {
    const { rows } = await this.pool.query<DocumentRow>('SELECT * FROM documents WHERE id = $1', [id]);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async events(id: string) {
    const { rows } = await this.pool.query<{ status: DocumentStatus; actor: string; detail: Record<string, unknown> | null; created_at: Date }>(
      'SELECT status, actor, detail, created_at FROM document_events WHERE document_id = $1 ORDER BY id',
      [id],
    );
    return rows.map((r) => ({ status: r.status, actor: r.actor, detail: r.detail, createdAt: r.created_at.toISOString() }));
  }

  async list(filter: ListFilter) {
    const column = filter.direction === 'sent' ? 'origin_country' : 'destination_country';
    const params: unknown[] = [filter.country, filter.limit];
    let where = `${column} = $1`;
    if (filter.status) {
      params.push(filter.status);
      where += ' AND status = $3';
    }
    const { rows } = await this.pool.query<DocumentRow>(
      `SELECT * FROM documents WHERE ${where} ORDER BY created_at DESC LIMIT $2`,
      params,
    );
    return rows.map(toRecord);
  }

  async transition(id: string, to: DocumentStatus, actor: string, detail: Record<string, unknown> | null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<DocumentRow>('SELECT * FROM documents WHERE id = $1 FOR UPDATE', [id]);
      const current = rows[0];
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }
      if (current.status === to) {
        await client.query('ROLLBACK');
        return toRecord(current);
      }
      if (!ALLOWED_FROM[to].includes(current.status)) {
        await client.query('ROLLBACK');
        return null;
      }
      const updated = await client.query<DocumentRow>(
        'UPDATE documents SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [id, to],
      );
      await client.query('INSERT INTO document_events (document_id, status, actor, detail) VALUES ($1, $2, $3, $4)', [
        id, to, actor, detail ? JSON.stringify(detail) : null,
      ]);
      await client.query('COMMIT');
      return toRecord(updated.rows[0]!);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Locks a batch of unpublished messages (SKIP LOCKED lets several hub
   * replicas share the work), hands each one to the publisher and records
   * the outcome. Failures back off exponentially, capped at five minutes.
   */
  async claimOutbox(limit: number, handler: (item: OutboxItem) => Promise<void>) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string; document_id: string; routing_key: string; message: RoutedMessage; headers: Record<string, string>; attempts: number;
      }>(
        `SELECT id, document_id, routing_key, message, headers, attempts FROM outbox
         WHERE published_at IS NULL AND available_at <= now()
         ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      for (const row of rows) {
        const item: OutboxItem = {
          id: Number(row.id), documentId: row.document_id, routingKey: row.routing_key,
          message: row.message, headers: row.headers, attempts: row.attempts,
        };
        try {
          await handler(item);
          await client.query('UPDATE outbox SET published_at = now(), attempts = attempts + 1 WHERE id = $1', [item.id]);
        } catch (err) {
          await client.query(
            `UPDATE outbox SET attempts = attempts + 1, last_error = $2,
               available_at = now() + least(interval '5 minutes', interval '1 second' * power(2, attempts))
             WHERE id = $1`,
            [item.id, err instanceof Error ? err.message : String(err)],
          );
        }
      }
      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async pendingOutbox() {
    const { rows } = await this.pool.query<{ count: string }>('SELECT count(*) FROM outbox WHERE published_at IS NULL');
    return Number(rows[0]?.count ?? 0);
  }

  async ping() {
    await this.pool.query('SELECT 1');
  }
}
