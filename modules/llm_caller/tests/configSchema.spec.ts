import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validateClientRegistryDocument,
  validateProvidersDocument
} from '../src/config/schema.js';
import {
  persistClientRegistry,
  persistProvidersConfig
} from '../src/config/io.js';

describe('configuration schema', () => {
  it('accepts a valid providers document', () => {
    const doc = {
      providers: {
        lmstudio: {
          baseUrl: 'http://127.0.0.1:1234/v1',
          defaultModel: 'deepseek-coder-33b',
          capabilities: ['chat', 'embed'],
          defaults: {
            chat: 'deepseek-coder-33b'
          },
          scores: {
            chat: 90
          }
        }
      }
    };

    expect(validateProvidersDocument(doc)).toBe(true);
  });

  it('rejects providers without required fields', () => {
    const doc = {
      providers: {
        bad: {
          baseUrl: ''
        }
      }
    };

    expect(validateProvidersDocument(doc)).toBe(false);
  });

  it('accepts a valid client registry document', () => {
    const doc = {
      clients: [
        {
          toolId: 'sample-tool',
          token: 'abc',
          allowedMethods: ['chat', 'models']
        }
      ]
    };

    expect(validateClientRegistryDocument(doc)).toBe(true);
  });

  it('rejects client entries without allowed methods', () => {
    const doc = {
      clients: [
        {
          toolId: 'invalid',
          token: 'secret',
          allowedMethods: []
        }
      ]
    };

    expect(validateClientRegistryDocument(doc)).toBe(false);
  });
});

describe('configuration IO helpers', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-caller-config-test-'));

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes providers document with backup', async () => {
    const target = path.join(tmpDir, 'providers.json');
    const doc = {
      providers: {
        lmstudio: {
          baseUrl: 'http://127.0.0.1:1234/v1',
          defaultModel: 'deepseek',
          capabilities: ['chat']
        }
      }
    };

    await persistProvidersConfig(target, doc, validateProvidersDocument);

    const written = JSON.parse(fs.readFileSync(target, 'utf-8'));
    expect(written.providers.lmstudio.baseUrl).toBe('http://127.0.0.1:1234/v1');

    const nextDoc = {
      providers: {
        lmstudio: {
          baseUrl: 'http://127.0.0.1:1234/v1',
          defaultModel: 'mistral',
          capabilities: ['chat']
        }
      }
    };

    await persistProvidersConfig(target, nextDoc, validateProvidersDocument);

    const backups = fs.readdirSync(tmpDir).filter((file) => file.endsWith('.bak'));
    expect(backups.length).toBeGreaterThanOrEqual(1);
  });

  it('writes client registry document', async () => {
    const target = path.join(tmpDir, 'client-registry.json');
    const doc = {
      clients: [
        {
          toolId: 'sample-tool',
          token: 'secret',
          allowedMethods: ['chat', 'models']
        }
      ]
    };

    await persistClientRegistry(target, doc, validateClientRegistryDocument);

    const written = JSON.parse(fs.readFileSync(target, 'utf-8'));
    expect(written.clients).toHaveLength(1);
  });
});
