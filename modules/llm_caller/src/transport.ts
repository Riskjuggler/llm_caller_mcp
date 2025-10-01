import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify';
import { createHash } from 'node:crypto';
import type { CallerConfig, RateLimitConfig } from './loadConfig.js';
import { unauthorized, forbidden, internalError, CallerError } from './errors.js';
import { createValidator } from './validation.js';
import type { Logger } from './logger.js';
import type {
  Orchestrator,
  ProviderStreamEvent,
  ProviderHealthStatus
} from './orchestrator.js';
import { isProviderError, ProviderError } from './providerErrors.js';
import { recordRequest, type MetricMethod } from './metrics.js';

interface ChatRequestPayload {
  requestId: string;
  callerTool?: string;
  messages: Array<{ role: string; content: string }>;
  provider?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

const validateChatRequest = createValidator<ChatRequestPayload>('chat_request.schema.json');

interface EmbedRequestPayload {
  requestId: string;
  callerTool?: string;
  inputs: Array<string | number[]>;
  provider?: string;
  model?: string;
}

const validateEmbedRequest = createValidator<EmbedRequestPayload>('embed_request.schema.json');

const MAX_RETRY_AFTER_MS = 60_000;
const MAX_STREAM_DELTA_CHARS = 4_000;
const CONTROL_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

interface MCPRequestContext {
  toolId: string;
  allowedMethods: string[];
  token: string;
}

interface ModelsQuery {
  provider?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    llmContext?: MCPRequestContext;
  }
}

export interface Server {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  instance: FastifyInstance;
}

export function createServer(config: CallerConfig, orchestrator: Orchestrator, logger: Logger): Server {
  const fastify = Fastify({ logger: false });
  const failureCounts = new Map<string, number>();
  const rateLimiter = config.rateLimit ? createRateLimiter(config.rateLimit) : undefined;

  const recordClientFailure = (token: string | undefined, metadata: Record<string, unknown>): void => {
    if (!token) {
      return;
    }
    const tokenHash = anonymizeToken(token);
    const current = failureCounts.get(tokenHash) ?? 0;
    const next = current + 1;
    failureCounts.set(tokenHash, next);
    logger.warn({
      level: 'warn',
      message: 'Client failure recorded',
      metadata: {
        tokenHash,
        failureCount: next,
        ...metadata
      }
    });
  };

  const consumeRateLimit = (
    token: string | undefined,
    method: MetricMethod,
    provider: string | undefined,
    requestId: string,
    startedAt: number,
    reply: FastifyReply
  ): boolean => {
    if (!rateLimiter) {
      return true;
    }

    const result = rateLimiter.tryConsume(token);
    if (result.allowed) {
      return true;
    }

    const clampResult = clampRetryAfter(result.retryAfterMs, logger, {
      requestId,
      endpoint: `${method}-rate-limit`
    }) ?? MAX_RETRY_AFTER_MS;

    if (token) {
      logger.warn({
        level: 'warn',
        message: 'Rate limit exceeded',
        metadata: {
          tokenHash: anonymizeToken(token),
          method,
          retryAfterMs: clampResult
        }
      });
    }

    reply.header('Retry-After', formatRetryAfter(clampResult));
    reply.status(429).send({
      error: 'RATE_LIMIT',
      message: 'Too many requests; slow down.',
      retryAfterMs: clampResult,
      traceId: requestId
    });

    recordRequest({
      method,
      outcome: 'error',
      durationMs: Date.now() - startedAt,
      provider,
      classification: 'RATE_LIMIT',
      retries: 0
    });

    return false;
  };

  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    enforceLoopback(request);
    const context = authenticate(request, config);
    request.llmContext = context;
  });

  fastify.post('/mcp/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const context = request.llmContext;
    if (!context) {
      throw internalError('Missing client context');
    }
    if (!context.allowedMethods.includes('chat')) {
      throw forbidden('Client not permitted to call chat');
    }

    const payload = validateChatRequest(request.body);
    const requestId = payload.requestId;
    const startedAt = Date.now();

    if (!consumeRateLimit(context.token, 'chat', payload.provider, requestId, startedAt, reply)) {
      return;
    }

    try {
      const response = await orchestrator.dispatchChat({
        requestId: payload.requestId,
        callerTool: context.toolId,
        messages: payload.messages,
        provider: payload.provider,
        model: payload.model,
        temperature: payload.temperature,
        maxTokens: payload.maxTokens
      });

      const responseBody = ensureRecord(response.payload, 'Provider payload must be an object');
      const retryAfterMs = clampRetryAfter(response.retryAfterMs, logger, {
        requestId,
        endpoint: 'chat-success'
      });
      const retries = Math.max(0, (response.attempts ?? 1) - 1);
      if (retryAfterMs) {
        reply.header('Retry-After', formatRetryAfter(retryAfterMs));
      }
      const enriched = {
        ...responseBody,
        traceId: response.traceId,
        retryAfterMs
      };
      const providerName = inferProviderName(responseBody, payload.provider);
      recordRequest({
        method: 'chat',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
        provider: providerName,
        retries
      });
      logger.info({
        level: 'info',
        message: 'chat request completed',
        requestId,
        metadata: {
          provider: providerName,
          callerTool: context.toolId,
          retryAfterMs,
          retries
        }
      });
      reply.send(enriched);
    } catch (error) {
      if (isProviderError(error)) {
        const sanitizedMessage = normalizeProviderMessage(error);
        logger.error({
          level: 'error',
          message: 'Chat dispatch failed',
          requestId,
          metadata: { error: sanitizedMessage, rawError: error.message }
        });
        recordClientFailure(context.token, { endpoint: 'chat', requestId, classification: error.classification });
        recordRequest({
          method: 'chat',
          outcome: 'error',
          durationMs: Date.now() - startedAt,
          provider: payload.provider,
          classification: error.classification,
          retries: 0
        });
        sendProviderError(reply, error, logger, requestId);
        return;
      }
      logger.error({
        level: 'error',
        message: 'Chat dispatch failed',
        requestId,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      });
      throw internalError('Chat dispatch failed');
    }
  });

  fastify.post('/mcp/chatStream', async (request: FastifyRequest, reply: FastifyReply) => {
    const context = request.llmContext;
    if (!context) {
      throw internalError('Missing client context');
    }
    if (!context.allowedMethods.includes('chatStream')) {
      throw forbidden('Client not permitted to call chatStream');
    }

    const payload = validateChatRequest(request.body);
    const requestId = payload.requestId;

    const providerName = payload.provider;
    const startedAt = Date.now();

    if (!consumeRateLimit(context.token, 'chatStream', providerName, requestId, startedAt, reply)) {
      return;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    reply.raw.flushHeaders?.();
    reply.hijack();

    const stream = orchestrator.dispatchChatStream({
      requestId: payload.requestId,
      callerTool: context.toolId,
      messages: payload.messages,
      provider: payload.provider,
      model: payload.model,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens
    });

    (async () => {
      try {
        for await (const event of stream) {
          const sanitized = sanitizeStreamEvent(event, logger, {
            requestId,
            endpoint: 'chat-stream'
          });
          if (!sanitized) {
            continue;
          }
          reply.raw.write(`data: ${JSON.stringify(sanitized)}\n\n`);
        }
        reply.raw.write('data: [DONE]\n\n');
        recordRequest({
          method: 'chatStream',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
          provider: providerName,
          retries: 0
        });
        logger.info({
          level: 'info',
          message: 'chatStream completed',
          requestId,
          metadata: {
            provider: providerName,
            callerTool: context.toolId,
            retries: 0
          }
        });
      } catch (error) {
        if (isProviderError(error)) {
          const sanitizedMessage = normalizeProviderMessage(error);
          logger.error({
            level: 'error',
            message: 'Chat stream failed',
            requestId,
            metadata: { error: sanitizedMessage, rawError: error.message }
          });
          const retryAfterMs = clampRetryAfter(error.retryAfterMs, logger, {
            requestId,
            endpoint: 'chat-stream-error'
          });
          const payload = {
            error: error.classification,
            message: sanitizedMessage,
            retryAfterMs: retryAfterMs ?? undefined
          };
          reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
          recordClientFailure(context.token, {
            endpoint: 'chat-stream',
            requestId,
            classification: error.classification
          });
          recordRequest({
            method: 'chatStream',
            outcome: 'error',
            durationMs: Date.now() - startedAt,
            provider: providerName,
            classification: error.classification,
            retries: 0
          });
        } else {
          logger.error({
            level: 'error',
            message: 'Chat stream failed',
            requestId,
            metadata: { error: error instanceof Error ? error.message : String(error) }
          });
          reply.raw.write(
            `data: ${JSON.stringify({ error: 'INTERNAL_ERROR', message: 'Chat stream failed' })}\n\n`
          );
          recordRequest({
            method: 'chatStream',
            outcome: 'error',
            durationMs: Date.now() - startedAt,
            provider: providerName,
            retries: 0
          });
        }
        reply.raw.write('data: [DONE]\n\n');
      } finally {
        reply.raw.end();
      }
    })().catch((error) => {
      logger.error({
        level: 'error',
        message: 'Chat stream handler crashed',
        requestId,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      });
      recordRequest({
        method: 'chatStream',
        outcome: 'error',
        durationMs: Date.now() - startedAt,
        provider: providerName,
        retries: 0
      });
      reply.raw.end();
    });
  });

  fastify.post('/mcp/embed', async (request: FastifyRequest, reply: FastifyReply) => {
    const context = request.llmContext;
    if (!context) {
      throw internalError('Missing client context');
    }
    if (!context.allowedMethods.includes('embed')) {
      throw forbidden('Client not permitted to call embed');
    }

    const payload = validateEmbedRequest(request.body);
    const requestId = payload.requestId;

    const startedAt = Date.now();
    if (!consumeRateLimit(context.token, 'embed', payload.provider, requestId, startedAt, reply)) {
      return;
    }

    try {
      const response = await orchestrator.dispatchEmbed({
        requestId: payload.requestId,
        callerTool: context.toolId,
        inputs: payload.inputs,
        provider: payload.provider,
        model: payload.model
      });

      const responseBody = ensureRecord(response.payload, 'Embed payload must be an object');
      const retryAfterMs = clampRetryAfter(response.retryAfterMs, logger, {
        requestId,
        endpoint: 'embed-success'
      });
      const retries = Math.max(0, (response.attempts ?? 1) - 1);
      if (retryAfterMs) {
        reply.header('Retry-After', formatRetryAfter(retryAfterMs));
      }
      const enriched = {
        ...responseBody,
        traceId: response.traceId,
        retryAfterMs
      };
      const providerName = inferProviderName(responseBody, payload.provider);
      recordRequest({
        method: 'embed',
        outcome: 'success',
        durationMs: Date.now() - startedAt,
        provider: providerName,
        retries
      });
      logger.info({
        level: 'info',
        message: 'embed request completed',
        requestId,
        metadata: {
          provider: providerName,
          callerTool: context.toolId,
          retryAfterMs,
          retries
        }
      });
      reply.send(enriched);
    } catch (error) {
      if (isProviderError(error)) {
        const sanitizedMessage = normalizeProviderMessage(error);
        logger.error({
          level: 'error',
          message: 'Embed dispatch failed',
          requestId,
          metadata: { error: sanitizedMessage, rawError: error.message }
        });
        recordClientFailure(context.token, { endpoint: 'embed', requestId, classification: error.classification });
        recordRequest({
          method: 'embed',
          outcome: 'error',
          durationMs: Date.now() - startedAt,
          provider: payload.provider,
          classification: error.classification,
          retries: 0
        });
        sendProviderError(reply, error, logger, requestId);
        return;
      }
      logger.error({
        level: 'error',
        message: 'Embed dispatch failed',
        requestId,
        metadata: { error: error instanceof Error ? error.message : String(error) }
      });
      throw internalError('Embed dispatch failed');
    }
  });

  fastify.get('/mcp/models', async (request: FastifyRequest, _reply: FastifyReply) => {
    const context = request.llmContext;
    if (!context) {
      throw internalError('Missing client context');
    }
    if (!context.allowedMethods.includes('models')) {
      throw forbidden('Client not permitted to list models');
    }

    const query = (request.query ?? {}) as ModelsQuery;
    const providerKey = typeof query.provider === 'string' && query.provider.length > 0 ? query.provider : undefined;

    try {
      return await orchestrator.listModels({ provider: providerKey });
    } catch (error) {
      logger.error({
        level: 'error',
        message: 'Model discovery failed',
        metadata: {
          provider: providerKey ?? 'default',
          error: error instanceof Error ? error.message : String(error)
        }
      });
      throw internalError('Model discovery failed');
    }
  });

  fastify.get('/health', async (request: FastifyRequest) => {
    const context = request.llmContext;
    if (!context) {
      throw internalError('Missing client context');
    }
    if (!context.allowedMethods.includes('getHealth')) {
      throw forbidden('Client not permitted to call getHealth');
    }

    const timestamp = new Date().toISOString();
    const components = await buildHealthComponents(config, orchestrator, logger, timestamp);
    const status = deriveOverallStatus(components);

    return {
      status,
      timestamp,
      components
    };
  });

  fastify.setErrorHandler((error, _request, reply) => {
    if (isCallerError(error)) {
      reply.status(error.status).send({ error: error.code, message: error.message });
      return;
    }

    logger.error({
      level: 'error',
      message: 'Unhandled transport error',
      metadata: { error: error instanceof Error ? error.message : String(error) }
    });

    reply.status(500).send({ error: 'INTERNAL_ERROR', message: 'Internal Error' });
  });

  return {
    async start() {
      await fastify.listen({ host: config.host, port: config.port });
    },
    async stop() {
      await fastify.close();
    },
    instance: fastify
  };
}

function enforceLoopback(request: FastifyRequest): void {
  const ip = request.ip;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return;
  }

  throw forbidden('Loopback access only');
}

function authenticate(request: FastifyRequest, config: CallerConfig): MCPRequestContext {
  const tokenHeader = request.headers['x-llm-caller-token'];
  if (typeof tokenHeader !== 'string') {
    throw unauthorized('Missing client token');
  }

  const client = config.clients.find((entry) => entry.token === tokenHeader);
  if (!client) {
    throw forbidden('Unknown client token');
  }

  return { toolId: client.toolId, allowedMethods: client.allowedMethods, token: client.token };
}

function isCallerError(error: unknown): error is CallerError {
  return error instanceof CallerError;
}

function ensureRecord(value: unknown, message: string): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw internalError(message);
}

function sendProviderError(
  reply: FastifyReply,
  error: ProviderError,
  logger: Logger,
  requestId?: string
): void {
  const status = mapProviderErrorToStatus(error);
  const retryAfterMs = clampRetryAfter(error.retryAfterMs, logger, {
    requestId,
    endpoint: 'provider-error'
  });
  if (retryAfterMs) {
    reply.header('Retry-After', formatRetryAfter(retryAfterMs));
  }

  const sanitizedMessage = normalizeProviderMessage(error);

  reply.status(status).send({
    error: error.classification,
    message: sanitizedMessage,
    retryAfterMs,
    traceId: requestId
  });
}

function mapProviderErrorToStatus(error: ProviderError): number {
  switch (error.classification) {
    case 'RATE_LIMIT':
      return 429;
    case 'AUTH':
      return 502;
    case 'PERMANENT':
      return 422;
    case 'CONFIG':
      return 500;
    case 'TEMPORARY':
    default:
      return 503;
  }
}

function normalizeProviderMessage(error: ProviderError): string {
  switch (error.classification) {
    case 'RATE_LIMIT':
      return 'Provider rate limited the request.';
    case 'AUTH':
      return 'Provider authentication failed.';
    case 'TEMPORARY':
      return 'Provider encountered a temporary error.';
    case 'PERMANENT':
      return 'Provider rejected the request.';
    case 'CONFIG':
      return 'Provider configuration error.';
    default:
      return 'Provider error.';
  }
}

function formatRetryAfter(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1000);
  return String(seconds > 0 ? seconds : 1);
}

function clampRetryAfter(
  value: number | undefined,
  logger: Logger,
  context: { requestId?: string; endpoint: string }
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const clamped = Math.min(Math.ceil(value), MAX_RETRY_AFTER_MS);
  if (value > MAX_RETRY_AFTER_MS) {
    logger.warn({
      level: 'warn',
      message: 'Retry hint clamped',
      metadata: {
        originalRetryAfterMs: value,
        clampedRetryAfterMs: clamped,
        requestId: context.requestId,
        endpoint: context.endpoint
      }
    });
  }
  return clamped;
}

function sanitizeStreamEvent(
  event: ProviderStreamEvent,
  logger: Logger,
  context: { requestId?: string; endpoint: string }
): ProviderStreamEvent | null {
  let modified = false;
  const sanitized: ProviderStreamEvent = { ...event };

  if (!isPlainTextEvent(event)) {
    logger.warn({
      level: 'warn',
      message: 'Stream payload dropped (non-text content)',
      metadata: {
        endpoint: context.endpoint,
        requestId: context.requestId
      }
    });
    return null;
  }

  if (event.delta) {
    sanitized.delta = { ...event.delta };
    if (typeof event.delta.content === 'string') {
      const result = sanitizeContent(event.delta.content, logger, {
        ...context,
        field: 'delta.content'
      });
      sanitized.delta.content = result.value;
      modified ||= result.modified;
    }
  }

  if (event.payload) {
    sanitized.payload = { ...event.payload };
    const messageContent = event.payload.message?.content;
    if (typeof messageContent === 'string') {
      const result = sanitizeContent(messageContent, logger, {
        ...context,
        field: 'payload.message.content'
      });
      sanitized.payload.message = {
        ...event.payload.message,
        content: result.value
      };
      modified ||= result.modified;
    }
  }

  if (sanitized.delta?.content === undefined && sanitized.payload?.message?.content === undefined) {
    return sanitized;
  }

  if (modified) {
    logger.warn({
      level: 'warn',
      message: 'Stream payload sanitized',
      metadata: {
        endpoint: context.endpoint,
        requestId: context.requestId
      }
    });
  }

  return sanitized;
}

function sanitizeContent(
  value: string,
  logger: Logger,
  context: { requestId?: string; endpoint: string; field: string }
): { value: string; modified: boolean } {
  let modified = false;
  let sanitized = value.replace(CONTROL_CHARS_REGEX, () => {
    modified = true;
    return '';
  });

  if (sanitized.length > MAX_STREAM_DELTA_CHARS) {
    sanitized = sanitized.slice(0, MAX_STREAM_DELTA_CHARS);
    modified = true;
    logger.warn({
      level: 'warn',
      message: 'Stream payload truncated',
      metadata: {
        endpoint: context.endpoint,
        field: context.field,
        requestId: context.requestId,
        maxChars: MAX_STREAM_DELTA_CHARS
      }
    });
  }

  return { value: sanitized, modified };
}

function anonymizeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

function isPlainTextEvent(event: ProviderStreamEvent): boolean {
  const content = event.delta?.content ?? event.payload?.message?.content;
  if (typeof content !== 'string') {
    return false;
  }
  // Heuristic: if the content contains a high ratio of non-printable characters (after sanitation), drop it.
  const sanitized = content.replace(CONTROL_CHARS_REGEX, '');
  if (sanitized.length === 0) {
    return false;
  }
  const binaryRatio = (content.length - sanitized.length) / content.length;
  return binaryRatio < 0.2;
}

function inferProviderName(responseBody: Record<string, unknown>, fallback?: string): string | undefined {
  const providerInfo = responseBody['providerInfo'];
  if (providerInfo && typeof providerInfo === 'object' && 'name' in providerInfo) {
    const providerName = (providerInfo as Record<string, unknown>).name;
    if (typeof providerName === 'string') {
      return providerName;
    }
  }
  return fallback;
}

interface RateLimiterEntry {
  count: number;
  windowStart: number;
}

function createRateLimiter(config: RateLimitConfig) {
  const buckets = new Map<string, RateLimiterEntry>();
  const { maxRequests, intervalMs } = config;

  return {
    tryConsume(token: string | undefined): { allowed: boolean; retryAfterMs?: number } {
      if (!token) {
        return { allowed: true };
      }

      const now = Date.now();
      const bucketKey = anonymizeToken(token);
      const bucket = buckets.get(bucketKey) ?? { count: 0, windowStart: now };

      if (now - bucket.windowStart >= intervalMs) {
        bucket.count = 0;
        bucket.windowStart = now;
      }

      if (bucket.count < maxRequests) {
        bucket.count += 1;
        buckets.set(bucketKey, bucket);
        return { allowed: true };
      }

      const retryAfterMs = Math.max(0, bucket.windowStart + intervalMs - now);
      buckets.set(bucketKey, bucket);
      return { allowed: false, retryAfterMs };
    }
  };
}

interface HealthComponent {
  name: string;
  status: ProviderHealthStatus;
  timestamp: string;
  details?: string;
  capabilityCoverage?: Array<{ capability: string; status: ProviderHealthStatus }>;
}

async function buildHealthComponents(
  config: CallerConfig,
  orchestrator: Orchestrator,
  logger: Logger,
  timestamp: string
): Promise<HealthComponent[]> {
  const components: HealthComponent[] = [
    { name: 'transport', status: 'ok', timestamp },
    { name: 'orchestrator', status: 'ok', timestamp }
  ];

  for (const providerName of Object.keys(config.providers)) {
    try {
      const health = await orchestrator.checkProviderHealth(providerName);
      components.push({
        name: `provider:${providerName}`,
        status: health.status,
        timestamp,
        ...(health.details ? { details: health.details } : {}),
        ...(health.capabilityCoverage ? { capabilityCoverage: health.capabilityCoverage } : {})
      });
    } catch (error) {
      logger.error({
        level: 'error',
        message: 'Provider health check failed',
        metadata: {
          provider: providerName,
          error: error instanceof Error ? error.message : String(error)
        }
      });
      components.push({
        name: `provider:${providerName}`,
        status: 'failed',
        timestamp,
        details: 'Health probe failed'
      });
    }
  }

  return components;
}

function deriveOverallStatus(components: HealthComponent[]): ProviderHealthStatus {
  if (components.some((component) => component.status === 'failed')) {
    return 'failed';
  }
  if (components.some((component) => component.status === 'degraded')) {
    return 'degraded';
  }
  return 'ok';
}
