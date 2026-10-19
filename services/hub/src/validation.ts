import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { validateXML } from 'xmllint-wasm';
import { COUNTRIES } from './config.js';
import type { PayloadFormat } from './domain.js';

// ajv-formats ships CommonJS; under NodeNext its default export is the module object.
const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface DocumentSchema {
  json: ValidateFunction;
  xsd: string;
}

export interface Envelope {
  documentType: string;
  schemaVersion: string;
  destinationCountry: (typeof COUNTRIES)[number];
  format: PayloadFormat;
  payload?: unknown;
  payloadXml?: string;
}

const envelopeSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['documentType', 'schemaVersion', 'destinationCountry', 'format'],
  properties: {
    documentType: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,49}$' },
    schemaVersion: { type: 'string', pattern: '^[0-9]+$' },
    destinationCountry: { enum: [...COUNTRIES] },
    format: { enum: ['json', 'xml'] },
    payload: { type: 'object' },
    payloadXml: { type: 'string', minLength: 1, maxLength: 5_000_000 },
  },
  if: { properties: { format: { const: 'json' } } },
  then: { required: ['payload'], properties: { payloadXml: false } },
  else: { required: ['payloadXml'], properties: { payload: false } },
} as const;

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
}

/**
 * Validates documents against versioned schemas found on disk:
 * schemas/<document-type>/v<version>/<document-type>.schema.json and .xsd
 */
export class DocumentValidator {
  private readonly envelope: ValidateFunction;

  private constructor(
    private readonly ajv: Ajv2020,
    private readonly schemas: Map<string, DocumentSchema>,
  ) {
    this.envelope = ajv.compile(envelopeSchema);
  }

  static async load(schemasDir: string): Promise<DocumentValidator> {
    const ajv = addFormats(new Ajv2020({ allErrors: true, strict: true, strictRequired: false }));
    const schemas = new Map<string, DocumentSchema>();

    for (const type of await readdir(schemasDir, { withFileTypes: true })) {
      if (!type.isDirectory() || type.name === 'samples') continue;
      for (const version of await readdir(join(schemasDir, type.name), { withFileTypes: true })) {
        if (!version.isDirectory() || !/^v[0-9]+$/.test(version.name)) continue;
        const base = join(schemasDir, type.name, version.name, type.name);
        const json = JSON.parse(await readFile(`${base}.schema.json`, 'utf8'));
        const xsd = await readFile(`${base}.xsd`, 'utf8');
        schemas.set(`${type.name}@${version.name.slice(1)}`, { json: ajv.compile(json), xsd });
      }
    }
    return new DocumentValidator(ajv, schemas);
  }

  supportedTypes(): string[] {
    return [...this.schemas.keys()].sort();
  }

  validateEnvelope(body: unknown): body is Envelope {
    return this.envelope(body) as boolean;
  }

  envelopeErrors(): string[] {
    return formatAjvErrors(this.envelope.errors);
  }

  async validatePayload(envelope: Envelope): Promise<ValidationResult> {
    const schema = this.schemas.get(`${envelope.documentType}@${envelope.schemaVersion}`);
    if (!schema) {
      return { valid: false, errors: [`unsupported document type ${envelope.documentType} v${envelope.schemaVersion}`] };
    }

    if (envelope.format === 'json') {
      const valid = schema.json(envelope.payload) as boolean;
      return { valid, errors: valid ? [] : formatAjvErrors(schema.json.errors) };
    }

    const result = await validateXML({
      xml: [{ fileName: 'document.xml', contents: envelope.payloadXml ?? '' }],
      schema: [{ fileName: 'schema.xsd', contents: schema.xsd }],
    });
    return { valid: result.valid, errors: result.errors.map((e) => e.message.trim()) };
  }
}
