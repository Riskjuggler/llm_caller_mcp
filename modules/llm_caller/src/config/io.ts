import fs from 'node:fs';
import path from 'node:path';

import type { ValidateFunction } from 'ajv/dist/2020.js';

import {
  type ClientRegistryDocument,
  type ClientRegistryValidator,
  type ProvidersDocument,
  type ProvidersValidator,
  type SchemaError
} from './schema.js';

const CONFIG_DIR = resolveConfigDirectory();

export interface LoadResult<T> {
  document: T;
  path: string;
}

export function loadProvidersConfig(validate: ProvidersValidator): LoadResult<ProvidersDocument> {
  const filePath = path.join(CONFIG_DIR, 'providers.json');
  const fallback = { providers: {} } satisfies ProvidersDocument;
  const document = loadJson(filePath, fallback, validate);
  return { document, path: filePath };
}

export function loadClientRegistry(validate: ClientRegistryValidator): LoadResult<ClientRegistryDocument> {
  const filePath = path.join(CONFIG_DIR, 'client-registry.json');
  const fallback = { clients: [] } satisfies ClientRegistryDocument;
  const document = loadJson(filePath, fallback, validate);
  return { document, path: filePath };
}

export async function persistProvidersConfig(
  filePath: string,
  document: ProvidersDocument,
  validate: ProvidersValidator
): Promise<void> {
  await persistJson(filePath, document, validate);
}

export async function persistClientRegistry(
  filePath: string,
  document: ClientRegistryDocument,
  validate: ClientRegistryValidator
): Promise<void> {
  await persistJson(filePath, document, validate);
}

function loadJson<T>(filePath: string, fallback: T, validate: ValidateFunction<T>): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  if (raw.trim().length === 0) {
    return fallback;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${(error as Error).message}`);
  }

  if (!validate(parsed)) {
    const messages = collectErrors(validate.errors);
    throw new Error(`Configuration file ${filePath} is invalid:\n${messages.join('\n')}`);
  }

  return parsed;
}

async function persistJson<T>(
  filePath: string,
  document: T,
  validate: ValidateFunction<T>
): Promise<void> {
  if (!validate(document)) {
    const messages = collectErrors(validate.errors);
    throw new Error(`Attempted to write invalid configuration to ${filePath}:\n${messages.join('\n')}`);
  }

  const json = `${JSON.stringify(document, null, 2)}\n`;
  const directory = path.dirname(filePath);

  await fs.promises.mkdir(directory, { recursive: true });

  const backupPath = `${filePath}.${Date.now()}.bak`;
  if (fs.existsSync(filePath)) {
    await fs.promises.copyFile(filePath, backupPath);
  }

  const tempPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tempPath, json, 'utf-8');
  await fs.promises.rename(tempPath, filePath);
}

function collectErrors(errors: SchemaError[] | null | undefined): string[] {
  if (!errors?.length) {
    return ['Unknown validation error'];
  }
  return errors.map((err) => `${err.instancePath || '/'} ${err.message ?? ''}`.trim());
}

function resolveConfigDirectory(): string {
  const candidates = [
    path.resolve(process.cwd(), 'config'),
    path.resolve(process.cwd(), 'modules/llm_caller/config')
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) {
      return dir;
    }
  }
  // default to first candidate; callers ensure directories exist via save helpers
  return candidates[0];
}
