import type { Country } from './config.js';

export type DocumentStatus = 'RECEIVED' | 'ROUTED' | 'ACCEPTED' | 'REJECTED' | 'FAILED';
export type PayloadFormat = 'json' | 'xml';

export interface Principal {
  clientId: string;
  country: Country;
  entity: string;
  roles: string[];
}

export interface NewDocument {
  documentType: string;
  schemaVersion: string;
  originCountry: Country;
  originEntity: string;
  destinationCountry: Country;
  idempotencyKey: string | null;
  format: PayloadFormat;
  payload: unknown;
  payloadXml: string | null;
  payloadSha256: string;
  correlationId: string;
}

export interface DocumentRecord extends NewDocument {
  id: string;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentEvent {
  status: DocumentStatus;
  actor: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export interface RoutedMessage {
  documentId: string;
  documentType: string;
  schemaVersion: string;
  originCountry: Country;
  originEntity: string;
  destinationCountry: Country;
  format: PayloadFormat;
  payload: unknown;
  payloadXml: string | null;
  payloadSha256: string;
  sentAt: string;
}

export function routingKeyFor(doc: Pick<NewDocument, 'destinationCountry' | 'documentType'>): string {
  return `${doc.destinationCountry}.${doc.documentType}`;
}

/** States a document may come from when moving to each state. Final states have no way out. */
export const ALLOWED_FROM: Record<DocumentStatus, DocumentStatus[]> = {
  RECEIVED: [],
  ROUTED: ['RECEIVED'],
  ACCEPTED: ['RECEIVED', 'ROUTED'],
  REJECTED: ['RECEIVED', 'ROUTED'],
  FAILED: ['RECEIVED', 'ROUTED'],
};
