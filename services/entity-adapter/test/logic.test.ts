import { describe, expect, it } from 'vitest';
import { decide, onTransientFailure, type InboundDocument } from '../src/logic.js';

const doc = (overrides: Partial<InboundDocument> = {}): InboundDocument => ({
  documentId: 'd1', documentType: 'certificado-origen', originCountry: 'BO', destinationCountry: 'PE',
  format: 'json', payload: { importador: { pais: 'PE' } }, payloadXml: null, ...overrides,
});

describe('decide', () => {
  it('accepts a document for a local importer', () => {
    expect(decide(doc(), 'PE')).toEqual({ result: 'accepted' });
  });
  it('rejects an importer registered elsewhere, in JSON and XML', () => {
    expect(decide(doc({ payload: { importador: { pais: 'CO' } } }), 'PE').result).toBe('rejected');
    const xml = '<Importador><Nombre>X</Nombre><Pais>EC</Pais></Importador>';
    expect(decide(doc({ format: 'xml', payload: null, payloadXml: xml }), 'PE').result).toBe('rejected');
  });
});

describe('onTransientFailure', () => {
  it('retries until the limit, then dead-letters', () => {
    expect(onTransientFailure(1, 3)).toEqual({ action: 'retry', nextAttempt: 2 });
    expect(onTransientFailure(3, 3)).toEqual({ action: 'dead-letter' });
  });
});
