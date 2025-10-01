import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

export interface ClientEntry {
  toolId: string;
  token: string;
  allowedMethods: string[];
}

export interface ProviderConfig {
  baseUrl: string;
  defaultModel: string;
  capabilities: string[];
  defaults?: Record<string, string>;
  scores?: Record<string, number>;
  notes?: string;
}

export interface RateLimitConfig {
  maxRequests: number;
  intervalMs: number;
}

export interface CallerConfig {
  host: string;
  port: number;
  clients: ClientEntry[];
  providers: Record<string, ProviderConfig>;
  retry?: {
    maxAttempts?: number;
  };
  rateLimit?: RateLimitConfig;
}

export function loadConfig(): CallerConfig {
  dotenv.config();

  const host = process.env.LLM_CALLER_HOST ?? '127.0.0.1';
  const port = Number(process.env.LLM_CALLER_PORT ?? '4037');
  const retryAttempts = Number.parseInt(process.env.LLM_CALLER_RETRY_ATTEMPTS ?? '', 10);
  const rateLimitMax = Number(process.env.LLM_CALLER_RATE_LIMIT_MAX ?? '0');
  const rateLimitInterval = Number(process.env.LLM_CALLER_RATE_LIMIT_INTERVAL_MS ?? '0');

  const registryPath = path.resolve('config/client-registry.json');
  const providersPath = path.resolve('config/providers.json');

  const clients = fs.existsSync(registryPath)
    ? JSON.parse(fs.readFileSync(registryPath, 'utf-8')).clients ?? []
    : [];

  const providers = fs.existsSync(providersPath)
    ? JSON.parse(fs.readFileSync(providersPath, 'utf-8')).providers ?? {}
    : {};

  const rateLimit =
    Number.isFinite(rateLimitMax) && rateLimitMax > 0 &&
    Number.isFinite(rateLimitInterval) && rateLimitInterval > 0
      ? {
          maxRequests: Math.floor(rateLimitMax),
          intervalMs: Math.floor(rateLimitInterval)
        }
      : undefined;

  return {
    host,
    port,
    clients,
    providers,
    retry: Number.isFinite(retryAttempts) ? { maxAttempts: retryAttempts } : undefined,
    rateLimit
  };
}
