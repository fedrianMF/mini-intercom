export interface InboundDocument {
  documentId: string;
  documentType: string;
  originCountry: string;
  destinationCountry: string;
  format: 'json' | 'xml';
  payload: unknown;
  payloadXml: string | null;
}

export type Decision = { result: 'accepted' } | { result: 'rejected'; reason: string };

/**
 * Stand-in for the national system's business checks. A real adapter would
 * call the customs or sanitary agency here; this one applies one rule so the
 * rejection path can be exercised end to end.
 */
export function decide(doc: InboundDocument, country: string): Decision {
  if (doc.destinationCountry !== country) {
    return { result: 'rejected', reason: `document addressed to ${doc.destinationCountry}, received by ${country}` };
  }
  if (doc.format === 'json') {
    const importer = (doc.payload as { importador?: { pais?: string } } | null)?.importador;
    if (importer?.pais && importer.pais !== country) {
      return { result: 'rejected', reason: `importador registrado en ${importer.pais}, no en ${country}` };
    }
  } else {
    const country_ = doc.payloadXml?.match(/<Importador>[\s\S]*?<Pais>([A-Z]{2})<\/Pais>/)?.[1];
    if (country_ && country_ !== country) {
      return { result: 'rejected', reason: `importador registrado en ${country_}, no en ${country}` };
    }
  }
  return { result: 'accepted' };
}

export type RetryAction = { action: 'retry'; nextAttempt: number } | { action: 'dead-letter' };

/** Transient failures are retried with a fixed delay until maxAttempts, then dead-lettered. */
export function onTransientFailure(attempt: number, maxAttempts: number): RetryAction {
  return attempt < maxAttempts ? { action: 'retry', nextAttempt: attempt + 1 } : { action: 'dead-letter' };
}

export class TransientError extends Error {}
