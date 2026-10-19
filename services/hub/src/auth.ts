import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { COUNTRIES, type Country } from './config.js';
import type { Principal } from './domain.js';

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: 401 | 403,
  ) {
    super(message);
  }
}

export interface AuthOptions {
  issuer: string;
  audience: string;
  /** Remote JWKS in production; a local key set in tests. */
  keys: JWTVerifyGetKey;
}

export type Authenticator = (authorization: string | undefined) => Promise<Principal>;

export function remoteKeys(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000 });
}

/**
 * Entities authenticate with OAuth 2.0 client credentials (Keycloak).
 * Their country and entity code travel as token claims, so the hub never
 * trusts what the request body says about who is sending.
 */
export function createAuthenticator(options: AuthOptions): Authenticator {
  return async (authorization) => {
    const token = authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new AuthError('missing bearer token', 401);

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, options.keys, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: ['RS256', 'ES256'],
      }));
    } catch {
      throw new AuthError('invalid token', 401);
    }

    const country = payload.country;
    const entity = payload.entity;
    if (typeof country !== 'string' || !COUNTRIES.includes(country as Country) || typeof entity !== 'string') {
      throw new AuthError('token is missing country or entity claims', 403);
    }

    const realmAccess = payload.realm_access as { roles?: unknown } | undefined;
    const roles = Array.isArray(realmAccess?.roles) ? realmAccess.roles.filter((r): r is string => typeof r === 'string') : [];

    return {
      clientId: String(payload.azp ?? payload.client_id ?? payload.sub),
      country: country as Country,
      entity,
      roles,
    };
  };
}
