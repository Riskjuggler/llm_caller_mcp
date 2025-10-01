import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createLogger } from '../src/logger.js';

const TEMP_PREFIX = 'llm-caller-logs-';

async function readLogLines(filePath: string): Promise<string[]> {
  await delay(10);
  const contents = fs.readFileSync(filePath, 'utf-8').trim();
  return contents.length === 0 ? [] : contents.split('\n');
}

describe('logger', () => {
  let tmpDir: string;
  let logFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
    logFile = path.join(tmpDir, 'mcp.log');
    process.env.LLM_CALLER_LOG_FILE = logFile;
  });

  afterEach(() => {
    delete process.env.LLM_CALLER_LOG_FILE;
    delete process.env.LLM_CALLER_LOG_LEVEL;
    delete process.env.LLM_CALLER_LOG_MAX_BYTES;
    delete process.env.LLM_CALLER_LOG_MAX_FILES;
    delete process.env.LLM_CALLER_LOG_DEBUG_PAYLOADS;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors in tests
    }
  });

  it('writes log records to a file when configured', async () => {
    const logger = createLogger();

    logger.info({ level: 'info', message: 'hello world', metadata: { test: true } });

    const lines = await readLogLines(logFile);
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]);
    expect(payload.message).toBe('hello world');
    expect(payload.metadata).toEqual({ test: true });
    expect(payload.level).toBe('info');
  });

  it('falls back to stdout when no file is configured', () => {
    delete process.env.LLM_CALLER_LOG_FILE;
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const logger = createLogger();
    logger.warn({ level: 'warn', message: 'stdout only' });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(logSpy.mock.calls[0][0] as string);
    expect(payload.message).toBe('stdout only');
    expect(payload.level).toBe('warn');

    logSpy.mockRestore();
  });

  it('logs an error when initialization fails but still emits to stdout', () => {
    const failurePath = path.join(tmpDir, 'nested', 'mcp.log');
    process.env.LLM_CALLER_LOG_FILE = failurePath;

    const appendSpy = jest
      .spyOn(fs, 'appendFileSync')
      .mockImplementation(() => {
        throw new Error('disk full');
      });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const logger = createLogger();

    logger.error({ level: 'error', message: 'still logging' });
    expect(logSpy).toHaveBeenCalled();
    const payload = JSON.parse(logSpy.mock.calls[logSpy.mock.calls.length - 1][0] as string);
    expect(payload.message).toBe('still logging');
    expect(payload.level).toBe('error');
    expect(errorSpy).toHaveBeenCalledWith('Failed to write log file', expect.any(Error));

    appendSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('appends multiple log entries without clobbering previous lines', async () => {
    const logger = createLogger();

    logger.info({ level: 'info', message: 'first message' });
    logger.info({ level: 'info', message: 'second message' });

    const lines = await readLogLines(logFile);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(first.message).toBe('first message');
    expect(second.message).toBe('second message');
  });

  it('filters out messages below the configured log level', async () => {
    process.env.LLM_CALLER_LOG_LEVEL = 'error';
    const logger = createLogger();

    logger.info({ level: 'info', message: 'should skip' });
    logger.warn({ level: 'warn', message: 'also skip' });
    logger.error({ level: 'error', message: 'keep me' });

    const lines = await readLogLines(logFile);
    expect(lines).toHaveLength(1);
    const payload = JSON.parse(lines[0]);
    expect(payload.message).toBe('keep me');
    expect(payload.level).toBe('error');
  });

  it('redacts disallowed metadata keys and emits a warning', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createLogger();

    logger.info({
      level: 'info',
      message: 'contains sensitive data',
      metadata: {
        provider: 'openai',
        prompt: 'secret prompt'
      }
    });

    const lines = await readLogLines(logFile);
    const payload = JSON.parse(lines[0]);
    expect(payload.metadata.provider).toBe('openai');
    expect(payload.metadata.prompt).toBe('[redacted]');
    expect(warnSpy).toHaveBeenCalledWith(
      'Redacted sensitive metadata keys',
      expect.arrayContaining(['prompt'])
    );

    warnSpy.mockRestore();
  });

  it('allows sensitive metadata when debug payloads flag enabled', async () => {
    process.env.LLM_CALLER_LOG_DEBUG_PAYLOADS = 'true';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createLogger();

    logger.info({
      level: 'info',
      message: 'debug allowed',
      metadata: {
        prompt: 'secret prompt'
      }
    });

    const lines = await readLogLines(logFile);
    const payload = JSON.parse(lines[0]);
    expect(payload.metadata.prompt).toBe('secret prompt');
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('rotates log files when size exceeds the configured maximum', async () => {
    process.env.LLM_CALLER_LOG_MAX_BYTES = '150';
    process.env.LLM_CALLER_LOG_MAX_FILES = '2';
    const logger = createLogger();

    for (let index = 0; index < 20; index += 1) {
      logger.info({ level: 'info', message: `entry-${index}`, metadata: { index } });
    }

    const baseLines = await readLogLines(logFile);
    expect(baseLines.length).toBeGreaterThan(0);
    const rotatedPath = `${logFile}.1`;
    expect(fs.existsSync(rotatedPath)).toBe(true);
    const rotatedLines = await readLogLines(rotatedPath);
    expect(rotatedLines.length).toBeGreaterThan(0);
  });

  it('redacts nested sensitive metadata by default and restores warnings when the flag is disabled', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createLogger();

    logger.error({
      level: 'error',
      message: 'nested sensitive metadata',
      metadata: {
        provider: 'anthropic',
        content: { text: 'private data' },
        rawError: { reason: 'secret' }
      }
    });

    const lines = await readLogLines(logFile);
    const payload = JSON.parse(lines[0]);
    expect(payload.metadata.content).toBe('[redacted]');
    expect(payload.metadata.rawError).toBe('[redacted]');
    expect(payload.metadata.provider).toBe('anthropic');
    expect(warnSpy).toHaveBeenCalledWith(
      'Redacted sensitive metadata keys',
      expect.arrayContaining(['content', 'rawError'])
    );

    warnSpy.mockRestore();
  });

  it('suppresses redaction warnings when debug payloads flag is enabled', async () => {
    process.env.LLM_CALLER_LOG_DEBUG_PAYLOADS = 'true';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = createLogger();

    logger.error({
      level: 'error',
      message: 'debug metadata allowed',
      metadata: {
        content: 'raw output',
        rawResponse: { body: 'full payload' }
      }
    });

    const lines = await readLogLines(logFile);
    const payload = JSON.parse(lines[0]);
    expect(payload.metadata.content).toBe('raw output');
    expect(payload.metadata.rawResponse).toEqual({ body: 'full payload' });
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('limits rotation to the configured number of files during stress conditions', async () => {
    process.env.LLM_CALLER_LOG_MAX_BYTES = '200';
    process.env.LLM_CALLER_LOG_MAX_FILES = '3';
    const logger = createLogger();

    const payload = 'x'.repeat(120);
    for (let index = 0; index < 120; index += 1) {
      logger.info({ level: 'info', message: `entry-${index}`, metadata: { payload } });
    }

    const files = fs
      .readdirSync(tmpDir)
      .filter((file) => file.startsWith('mcp.log'))
      .sort();
    expect(files.length).toBeLessThanOrEqual(4); // base file plus maxFiles rotations

    for (const file of files) {
      const stats = fs.statSync(path.join(tmpDir, file));
      expect(stats.size).toBeLessThanOrEqual(220); // accommodates newline overhead
    }
  });

  it('reads log lines within an expected time budget', async () => {
    const logger = createLogger();
    logger.info({ level: 'info', message: 'timing probe' });

    const start = Date.now();
    await readLogLines(logFile);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
