import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DocumentValidator, type Envelope } from '../src/validation.js';
import { SCHEMAS_DIR } from './helpers.js';

const sample = async () => JSON.parse(await readFile(`${SCHEMAS_DIR}/samples/certificado-origen.json`, 'utf8')) as Envelope;
const sampleXml = () => readFile(`${SCHEMAS_DIR}/samples/certificado-origen.xml`, 'utf8');

describe('DocumentValidator', () => {
  it('discovers versioned schemas on disk', async () => {
    const validator = await DocumentValidator.load(SCHEMAS_DIR);
    expect(validator.supportedTypes()).toEqual(['certificado-origen@1']);
  });

  it('accepts the JSON sample', async () => {
    const validator = await DocumentValidator.load(SCHEMAS_DIR);
    const envelope = await sample();
    expect(validator.validateEnvelope(envelope)).toBe(true);
    expect(await validator.validatePayload(envelope)).toEqual({ valid: true, errors: [] });
  });

  it('reports every JSON Schema violation', async () => {
    const validator = await DocumentValidator.load(SCHEMAS_DIR);
    const envelope = await sample();
    const payload = envelope.payload as { numero: string; mercancias: { subpartidaNandina: string }[] };
    payload.numero = 'bad';
    payload.mercancias[0]!.subpartidaNandina = '123';
    const result = await validator.validatePayload(envelope);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.join()).toContain('/numero');
  });

  it('validates XML against the XSD', async () => {
    const validator = await DocumentValidator.load(SCHEMAS_DIR);
    const envelope: Envelope = { documentType: 'certificado-origen', schemaVersion: '1', destinationCountry: 'CO', format: 'xml', payloadXml: await sampleXml() };
    expect(await validator.validatePayload(envelope)).toEqual({ valid: true, errors: [] });

    const broken = { ...envelope, payloadXml: envelope.payloadXml!.replace('<SubpartidaNandina>10085090', '<SubpartidaNandina>ABC') };
    const result = await validator.validatePayload(broken);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('SubpartidaNandina');
  });

  it('rejects an envelope that mixes formats', async () => {
    const validator = await DocumentValidator.load(SCHEMAS_DIR);
    const envelope = { ...(await sample()), payloadXml: '<x/>' };
    expect(validator.validateEnvelope(envelope)).toBe(false);
  });

  it('rejects unknown document versions', async () => {
    const validator = await DocumentValidator.load(SCHEMAS_DIR);
    const result = await validator.validatePayload({ ...(await sample()), schemaVersion: '9' });
    expect(result).toEqual({ valid: false, errors: ['unsupported document type certificado-origen v9'] });
  });
});
