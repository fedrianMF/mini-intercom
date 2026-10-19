export const COUNTRIES = ['BO', 'CO', 'EC', 'PE'] as const;
export type Country = (typeof COUNTRIES)[number];

export interface Config {
  port: number;
  databaseUrl: string;
  amqpUrl: string;
  oidcIssuer: string;
  oidcJwksUrl: string;
  oidcAudience: string;
  schemasDir: string;
  runMigrations: boolean;
  outboxPollMs: number;
  logLevel: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    amqpUrl: required('AMQP_URL'),
    oidcIssuer: required('OIDC_ISSUER'),
    oidcJwksUrl: required('OIDC_JWKS_URL'),
    oidcAudience: process.env.OIDC_AUDIENCE ?? 'intercom-hub',
    schemasDir: process.env.SCHEMAS_DIR ?? new URL('../../../schemas', import.meta.url).pathname,
    runMigrations: process.env.RUN_MIGRATIONS === 'true',
    outboxPollMs: Number(process.env.OUTBOX_POLL_MS ?? 1000),
    logLevel: process.env.LOG_LEVEL ?? 'info',
  };
}
