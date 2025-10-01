import fs from 'node:fs';
import path from 'node:path';

// cspell:ignore rawerror rawresponse

export interface LogRecord {
  level: 'info' | 'warn' | 'error';
  message: string;
  requestId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface Logger {
  info: (record: LogRecord) => void;
  warn: (record: LogRecord) => void;
  error: (record: LogRecord) => void;
}

export function createLogger(): Logger {
  const config = resolveConfig();
  return {
    info: (record) => emit({ ...record, level: 'info' }, config),
    warn: (record) => emit({ ...record, level: 'warn' }, config),
    error: (record) => emit({ ...record, level: 'error' }, config)
  };
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LOG_LEVELS: LogLevel[] = ['error', 'warn', 'info', 'debug'];
const SENSITIVE_KEY_PATTERNS = [
  /prompt/i,
  /content/i,
  /payload/i,
  /body/i,
  /transcript/i,
  /delta/i
];
const SENSITIVE_EXACT_KEYS = new Set(['rawerror', 'rawresponse', 'messages', 'completion']);

interface LoggerConfig {
  threshold: LogLevel;
  logPath?: string;
  maxBytes: number;
  maxFiles: number;
  debugPayloads: boolean;
}

function emit(record: LogRecord, config: LoggerConfig): void {
  if (!shouldLog(record.level, config.threshold)) {
    return;
  }

  const normalized = normalizeRecord(record, config.debugPayloads);
  if (normalized.redactedKeys.length > 0) {
    console.warn('Redacted sensitive metadata keys', normalized.redactedKeys);
  }

  console.log(JSON.stringify(normalized.record));
  if (!config.logPath) {
    return;
  }

  try {
    writeToFile(config.logPath, JSON.stringify(normalized.record), config);
  } catch (error) {
    console.error('Failed to write log file', error);
  }
}

function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) <= LOG_LEVELS.indexOf(threshold);
}

function resolveConfig(): LoggerConfig {
  const threshold = parseLogLevel(process.env.LLM_CALLER_LOG_LEVEL) ?? 'info';
  const maxBytes = parsePositiveInt(process.env.LLM_CALLER_LOG_MAX_BYTES, 5 * 1024 * 1024);
  const maxFiles = parsePositiveInt(process.env.LLM_CALLER_LOG_MAX_FILES, 100);
  const debugPayloads = parseBoolean(process.env.LLM_CALLER_LOG_DEBUG_PAYLOADS);
  const logPath = process.env.LLM_CALLER_LOG_FILE;

  if (logPath) {
    ensureLogDirectory(logPath);
  }

  return {
    threshold,
    logPath,
    maxBytes,
    maxFiles,
    debugPayloads
  };
}

function parseLogLevel(value?: string | null): LogLevel | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase() as LogLevel;
  return LOG_LEVELS.includes(normalized) ? normalized : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value?: string): boolean {
  if (!value) {
    return false;
  }
  return value === '1' || value.toLowerCase() === 'true';
}

interface NormalizedRecord {
  record: LogRecord & { timestamp: string; metadata?: Record<string, unknown> };
  redactedKeys: string[];
}

function normalizeRecord(record: LogRecord, debugPayloads: boolean): NormalizedRecord {
  const timestamp = new Date().toISOString();
  const { metadata } = record;
  const { sanitizedMetadata, redactedKeys } = sanitizeMetadata(metadata, debugPayloads);

  return {
    record: {
      ...record,
      metadata: sanitizedMetadata,
      timestamp
    },
    redactedKeys
  };
}

function sanitizeMetadata(
  metadata: Record<string, unknown> | undefined,
  debugPayloads: boolean
): { sanitizedMetadata?: Record<string, unknown>; redactedKeys: string[] } {
  if (!metadata) {
    return { sanitizedMetadata: undefined, redactedKeys: [] };
  }

  const sanitizedMetadata: Record<string, unknown> = {};
  const redactedKeys: string[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    if (debugPayloads || !isSensitiveKey(key)) {
      sanitizedMetadata[key] = value;
      continue;
    }

    sanitizedMetadata[key] = '[redacted]';
    redactedKeys.push(key);
  }

  return { sanitizedMetadata, redactedKeys };
}

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  if (SENSITIVE_EXACT_KEYS.has(lowerKey)) {
    return true;
  }
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(lowerKey));
}

function ensureLogDirectory(logPath: string): void {
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
  } catch (error) {
    console.error('Failed to initialize log file', error);
  }
}

function writeToFile(logPath: string, payload: string, config: LoggerConfig): void {
  const data = `${payload}\n`;

  if (config.maxBytes > 0) {
    rotateIfNeeded(logPath, Buffer.byteLength(data), config.maxBytes, config.maxFiles);
  }

  fs.appendFileSync(logPath, data, { encoding: 'utf-8' });
}

function rotateIfNeeded(
  logPath: string,
  nextWriteBytes: number,
  maxBytes: number,
  maxFiles: number
): void {
  try {
    const stats = fs.existsSync(logPath) ? fs.statSync(logPath) : undefined;
    if (!stats) {
      return;
    }
    if (stats.size + nextWriteBytes <= maxBytes) {
      return;
    }
  } catch (error) {
    console.error('Failed to stat log file for rotation', error);
    return;
  }

  if (maxFiles <= 0) {
    return;
  }

  try {
    const lastPath = `${logPath}.${maxFiles}`;
    if (fs.existsSync(lastPath)) {
      fs.rmSync(lastPath, { force: true });
    }
    for (let index = maxFiles - 1; index >= 1; index -= 1) {
      const source = `${logPath}.${index}`;
      if (fs.existsSync(source)) {
        fs.renameSync(source, `${logPath}.${index + 1}`);
      }
    }
    if (fs.existsSync(logPath)) {
      fs.renameSync(logPath, `${logPath}.1`);
    }
  } catch (error) {
    console.error('Failed to rotate log file', error);
  }
}
