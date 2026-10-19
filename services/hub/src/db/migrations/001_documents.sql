CREATE TABLE documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type       text        NOT NULL,
  schema_version      text        NOT NULL,
  origin_country      char(2)     NOT NULL,
  origin_entity       text        NOT NULL,
  destination_country char(2)     NOT NULL,
  idempotency_key     text,
  format              text        NOT NULL CHECK (format IN ('json', 'xml')),
  payload             jsonb,
  payload_xml         text,
  payload_sha256      char(64)    NOT NULL,
  status              text        NOT NULL,
  correlation_id      text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((format = 'json' AND payload IS NOT NULL) OR (format = 'xml' AND payload_xml IS NOT NULL))
);

CREATE UNIQUE INDEX documents_idempotency_uq ON documents (origin_entity, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX documents_origin_idx ON documents (origin_country, created_at DESC);
CREATE INDEX documents_destination_idx ON documents (destination_country, created_at DESC);
CREATE INDEX documents_status_idx ON documents (status) WHERE status IN ('RECEIVED', 'ROUTED');

-- Append-only trace: every state change of a document, with who caused it.
CREATE TABLE document_events (
  id          bigserial   PRIMARY KEY,
  document_id uuid        NOT NULL REFERENCES documents (id),
  status      text        NOT NULL,
  actor       text        NOT NULL,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX document_events_document_idx ON document_events (document_id, id);

-- Transactional outbox: written in the same transaction as the document,
-- published to RabbitMQ by the relay, so no document is lost if the broker is down.
CREATE TABLE outbox (
  id           bigserial   PRIMARY KEY,
  document_id  uuid        NOT NULL REFERENCES documents (id),
  routing_key  text        NOT NULL,
  message      jsonb       NOT NULL,
  headers      jsonb       NOT NULL DEFAULT '{}',
  attempts     integer     NOT NULL DEFAULT 0,
  last_error   text,
  available_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE published_at IS NULL;
