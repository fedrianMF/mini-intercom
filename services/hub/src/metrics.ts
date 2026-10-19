import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from '@prometheus-io/client';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  return {
    registry,
    documentsReceived: new Counter({
      name: 'intercom_documents_received_total',
      help: 'Documents accepted for routing',
      labelNames: ['document_type', 'schema_version', 'origin', 'destination'] as const,
      registers: [registry],
    }),
    documentsRejected: new Counter({
      name: 'intercom_documents_invalid_total',
      help: 'Submissions refused by validation',
      labelNames: ['document_type', 'origin', 'reason'] as const,
      registers: [registry],
    }),
    documentTransitions: new Counter({
      name: 'intercom_document_transitions_total',
      help: 'Document state changes',
      labelNames: ['status', 'destination'] as const,
      registers: [registry],
    }),
    outboxPending: new Gauge({
      name: 'intercom_outbox_pending',
      help: 'Messages waiting to be published to the broker',
      registers: [registry],
    }),
    outboxPublishFailures: new Counter({
      name: 'intercom_outbox_publish_failures_total',
      help: 'Failed attempts to publish an outbox message',
      registers: [registry],
    }),
    httpDuration: new Histogram({
      name: 'intercom_http_request_duration_seconds',
      help: 'HTTP request duration',
      labelNames: ['method', 'route', 'status_code'] as const,
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
  };
}

export type Metrics = ReturnType<typeof createMetrics>;
