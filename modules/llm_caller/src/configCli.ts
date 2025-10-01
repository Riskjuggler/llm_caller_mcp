#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { format } from 'node:util';

import {
  validateClientRegistryDocument,
  validateProvidersDocument,
  type ClientEntry,
  type ClientRegistryDocument,
  type ProviderEntry,
  type ProvidersDocument
} from './config/schema.js';
import {
  loadClientRegistry,
  loadProvidersConfig,
  persistClientRegistry,
  persistProvidersConfig
} from './config/io.js';
import { fetchLMStudioModels } from './config/lmStudioDiscovery.js';

type MenuChoice =
  | 'list-providers'
  | 'add-provider'
  | 'update-provider'
  | 'delete-provider'
  | 'list-clients'
  | 'add-client'
  | 'update-client'
  | 'delete-client'
  | 'save'
  | 'exit';

async function main(): Promise<void> {
  const rl = createInterface({ input, output });
  try {
    const providersLoad = loadProvidersConfig(validateProvidersDocument);
    const clientsLoad = loadClientRegistry(validateClientRegistryDocument);

    let providersDoc = providersLoad.document;
    let clientsDoc = clientsLoad.document;
    const providerPath = providersLoad.path;
    const clientPath = clientsLoad.path;
    let dirty = false;

    console.log('LLM Caller configuration assistant');
    console.log(`Providers file: ${providerPath}`);
    console.log(`Client registry: ${clientPath}`);

    while (true) {
      const choice = await promptMenu(rl, 'Main menu', [
        ['List providers', 'list-providers'],
        ['Add provider', 'add-provider'],
        ['Update provider', 'update-provider'],
        ['Delete provider', 'delete-provider'],
        ['List client configs', 'list-clients'],
        ['Add client config', 'add-client'],
        ['Update client config', 'update-client'],
        ['Delete client config', 'delete-client'],
        ['Save changes', 'save'],
        ['Exit', 'exit']
      ]);

      switch (choice) {
        case 'list-providers':
          listProviders(providersDoc);
          break;
        case 'add-provider': {
          const result = await collectProvider(rl, providersDoc);
          if (result) {
            providersDoc = { providers: { ...providersDoc.providers, [result.key]: result.entry } };
            dirty = true;
          }
          break;
        }
        case 'update-provider': {
          const updated = await updateProvider(rl, providersDoc);
          if (updated) {
            providersDoc = updated;
            dirty = true;
          }
          break;
        }
        case 'delete-provider': {
          const updated = await deleteProvider(rl, providersDoc);
          if (updated) {
            providersDoc = updated;
            dirty = true;
          }
          break;
        }
        case 'list-clients':
          listClients(clientsDoc);
          break;
        case 'add-client': {
          const result = await collectClient(rl, clientsDoc);
          if (result) {
            clientsDoc = { clients: [...clientsDoc.clients, result] };
            dirty = true;
          }
          break;
        }
        case 'update-client': {
          const updated = await updateClient(rl, clientsDoc);
          if (updated) {
            clientsDoc = updated;
            dirty = true;
          }
          break;
        }
        case 'delete-client': {
          const updated = await deleteClient(rl, clientsDoc);
          if (updated) {
            clientsDoc = updated;
            dirty = true;
          }
          break;
        }
        case 'save':
          await persistChanges(providerPath, clientPath, providersDoc, clientsDoc);
          dirty = false;
          break;
        case 'exit':
          if (dirty) {
            const confirm = await promptYesNo(rl, 'Unsaved changes detected. Save before exiting?');
            if (confirm) {
              await persistChanges(providerPath, clientPath, providersDoc, clientsDoc);
            }
          }
          console.log('Goodbye!');
          rl.close();
          return;
      }
    }
  } catch (error) {
    console.error('CLI failed:', error);
    process.exitCode = 1;
  }
}

async function persistChanges(
  providerPath: string,
  clientPath: string,
  providersDoc: ProvidersDocument,
  clientsDoc: ClientRegistryDocument
): Promise<void> {
  await persistProvidersConfig(providerPath, providersDoc, validateProvidersDocument);
  await persistClientRegistry(clientPath, clientsDoc, validateClientRegistryDocument);
  console.log('Configurations saved.');
}

function listProviders(document: ProvidersDocument): void {
  const entries = Object.entries(document.providers);
  if (entries.length === 0) {
    console.log('No providers configured.');
    return;
  }
  entries.forEach(([key, value]) => {
    console.log(`\n[${key}]`);
    console.log(`  baseUrl: ${value.baseUrl}`);
    console.log(`  defaultModel: ${value.defaultModel}`);
    console.log(`  capabilities: ${value.capabilities.join(', ')}`);
    if (value.defaults) {
      console.log(`  defaults: ${JSON.stringify(value.defaults)}`);
    }
    if (value.scores) {
      console.log(`  scores: ${JSON.stringify(value.scores)}`);
    }
    if (value.notes) {
      console.log(`  notes: ${value.notes}`);
    }
  });
  console.log();
}

function listClients(document: ClientRegistryDocument): void {
  if (document.clients.length === 0) {
    console.log('No client configurations found.');
    return;
  }
  document.clients.forEach((entry, index) => {
    console.log(`\n[${index}] ${entry.toolId}`);
    console.log(`  token: ${entry.token}`);
    console.log(`  methods: ${entry.allowedMethods.join(', ')}`);
  });
  console.log();
}

async function collectProvider(
  rl: ReturnType<typeof createInterface>,
  document: ProvidersDocument
): Promise<{ key: string; entry: ProviderEntry } | undefined> {
  const key = await promptInput(rl, 'Provider key (e.g., lmstudio, openai):', {
    validate: (value) => {
      if (!value.match(/^[a-zA-Z0-9_-]+$/)) {
        return 'Provider key must be alphanumeric with optional dashes/underscores.';
      }
      if (document.providers[value]) {
        return 'Provider key already exists.';
      }
      return true;
    }
  });
  if (!key) {
    return undefined;
  }

  const entry = await collectProviderDetails(rl, key);
  return entry ? { key, entry } : undefined;
}

async function collectProviderDetails(
  rl: ReturnType<typeof createInterface>,
  key: string,
  existing?: ProviderEntry
): Promise<ProviderEntry | undefined> {
  const type = await promptMenu(rl, 'Provider type', [
    ['LM Studio', 'lmstudio'],
    ['OpenAI', 'openai'],
    ['Anthropic', 'anthropic'],
    ['Custom', 'custom']
  ]);

  switch (type) {
    case 'lmstudio':
      return collectLMStudioProvider(rl, existing);
    case 'openai':
      return collectOpenAIProvider(rl, existing);
    case 'anthropic':
      return collectAnthropicProvider(rl, existing);
    default:
      return collectCustomProvider(rl, existing, key);
  }
}

async function collectLMStudioProvider(
  rl: ReturnType<typeof createInterface>,
  existing?: ProviderEntry
): Promise<ProviderEntry | undefined> {
  const baseUrl =
    (await promptInput(rl, 'LM Studio base URL:', { defaultValue: existing?.baseUrl ?? 'http://127.0.0.1:1234/v1' })) ??
    existing?.baseUrl;
  if (!baseUrl) {
    return undefined;
  }

  const useDiscovery = await promptYesNo(rl, 'Discover models from LM Studio now?', true);
  let models: string[] = [];
  if (useDiscovery) {
    try {
      const discovered = await fetchLMStudioModels(baseUrl);
      if (discovered.length === 0) {
        console.log('No models reported by LM Studio; continuing with manual entry.');
      } else {
        models = discovered.map((model) => model.id);
        console.log('\nAvailable models:');
        discovered.forEach((model, index) => {
          console.log(`  [${index}] ${model.id}${model.ready ? '' : ' (not ready)'}${model.description ? ` – ${model.description}` : ''}`);
        });
        console.log();
      }
    } catch (error) {
      console.warn('Failed to fetch LM Studio models:', (error as Error).message);
    }
  }

  const capabilities = await promptCapabilities(
    rl,
    existing?.capabilities ?? ['chat', 'chatStream', 'embed']
  );
  if (capabilities.length === 0) {
    console.log('Provider must have at least one capability.');
    return undefined;
  }

  const defaults: Record<string, string> = {};
  for (const capability of capabilities) {
    const defaultModel = await promptSelectModel(
      rl,
      `Default model for ${capability}:`,
      models,
      existing?.defaults?.[capability] ?? existing?.defaultModel ?? ''
    );
    if (defaultModel) {
      defaults[capability] = defaultModel;
    }
  }

  const defaultModel = defaults.chat ?? defaults.chatStream ?? defaults.embed ?? existing?.defaultModel ?? models[0] ??
    (await promptInput(rl, 'Fallback default model:', { defaultValue: existing?.defaultModel })) ??
    existing?.defaultModel;
  if (!defaultModel) {
    console.log('Provider requires a default model.');
    return undefined;
  }

  const scores: Record<string, number> = {};
  for (const capability of capabilities) {
    const current = existing?.scores?.[capability];
    const score = await promptNumber(rl, `Score (0-100) for ${capability} [optional]:`, { defaultValue: current });
    if (score !== undefined) {
      scores[capability] = score;
    }
  }

  const notes = await promptInput(rl, 'Notes [optional]:', { defaultValue: existing?.notes ?? 'LM Studio provider' , allowEmpty: true });

  return {
    baseUrl,
    defaultModel,
    capabilities,
    defaults: Object.keys(defaults).length ? defaults : undefined,
    scores: Object.keys(scores).length ? scores : undefined,
    notes: notes ?? undefined
  };
}

async function collectOpenAIProvider(
  rl: ReturnType<typeof createInterface>,
  existing?: ProviderEntry
): Promise<ProviderEntry | undefined> {
  const baseUrl =
    (await promptInput(rl, 'OpenAI base URL:', { defaultValue: existing?.baseUrl ?? 'https://api.openai.com/v1' })) ??
    existing?.baseUrl;
  if (!baseUrl) {
    return undefined;
  }

  const chatModel =
    (await promptInput(rl, 'Default chat model:', { defaultValue: existing?.defaults?.chat ?? existing?.defaultModel ?? 'gpt-4o-mini' })) ??
    existing?.defaultModel;
  if (!chatModel) {
    return undefined;
  }

  const embedModel = await promptInput(rl, 'Embedding model [optional]:', {
    defaultValue: existing?.defaults?.embed ?? 'text-embedding-3-small',
    allowEmpty: true
  });

  const capabilities = embedModel ? ['chat', 'embed'] : ['chat'];
  const defaults: Record<string, string> = { chat: chatModel };
  if (embedModel) {
    defaults.embed = embedModel;
  }

  const chatScore = await promptNumber(rl, 'Chat score (0-100) [optional]:', {
    defaultValue: existing?.scores?.chat ?? 70
  });
  const embedScore = embedModel
    ? await promptNumber(rl, 'Embed score (0-100) [optional]:', {
        defaultValue: existing?.scores?.embed ?? 85
      })
    : undefined;

  return {
    baseUrl,
    defaultModel: chatModel,
    capabilities,
    defaults,
    scores: buildScores({ chat: chatScore, embed: embedScore }),
    notes: existing?.notes
  };
}

async function collectAnthropicProvider(
  rl: ReturnType<typeof createInterface>,
  existing?: ProviderEntry
): Promise<ProviderEntry | undefined> {
  const baseUrl =
    (await promptInput(rl, 'Anthropic base URL:', { defaultValue: existing?.baseUrl ?? 'https://api.anthropic.com/v1' })) ??
    existing?.baseUrl;
  if (!baseUrl) {
    return undefined;
  }

  const chatModel =
    (await promptInput(rl, 'Default chat model:', { defaultValue: existing?.defaultModel ?? 'claude-3-sonnet' })) ??
    existing?.defaultModel;
  if (!chatModel) {
    return undefined;
  }

  const chatScore = await promptNumber(rl, 'Chat score (0-100) [optional]:', {
    defaultValue: existing?.scores?.chat ?? 80
  });

  return {
    baseUrl,
    defaultModel: chatModel,
    capabilities: ['chat'],
    defaults: { chat: chatModel },
    scores: buildScores({ chat: chatScore }),
    notes: existing?.notes
  };
}

async function collectCustomProvider(
  rl: ReturnType<typeof createInterface>,
  existing: ProviderEntry | undefined,
  key: string
): Promise<ProviderEntry | undefined> {
  const baseUrl =
    (await promptInput(rl, 'Provider base URL:', { defaultValue: existing?.baseUrl ?? '' })) ??
    existing?.baseUrl;
  if (!baseUrl) {
    return undefined;
  }

  const defaultModel =
    (await promptInput(rl, 'Default model:', { defaultValue: existing?.defaultModel ?? '' })) ??
    existing?.defaultModel;
  if (!defaultModel) {
    return undefined;
  }

  const capabilities = await promptCapabilities(rl, existing?.capabilities ?? []);
  if (capabilities.length === 0) {
    console.log('Provider must declare at least one capability.');
    return undefined;
  }

  const defaults: Record<string, string> = {};
  for (const capability of capabilities) {
    const defaultValue = await promptInput(rl, `Default model for ${capability} [optional]:`, {
      defaultValue: existing?.defaults?.[capability] ?? defaultModel,
      allowEmpty: true
    });
    if (defaultValue) {
      defaults[capability] = defaultValue;
    }
  }

  const scores: Record<string, number> = {};
  for (const capability of capabilities) {
    const score = await promptNumber(rl, `Score (0-100) for ${capability} [optional]:`, {
      defaultValue: existing?.scores?.[capability]
    });
    if (score !== undefined) {
      scores[capability] = score;
    }
  }

  const notes = await promptInput(rl, 'Notes [optional]:', {
    defaultValue: existing?.notes ?? `Custom provider ${key}`,
    allowEmpty: true
  });

  return {
    baseUrl,
    defaultModel,
    capabilities,
    defaults: Object.keys(defaults).length ? defaults : undefined,
    scores: Object.keys(scores).length ? scores : undefined,
    notes: notes ?? undefined
  };
}

async function updateProvider(
  rl: ReturnType<typeof createInterface>,
  document: ProvidersDocument
): Promise<ProvidersDocument | undefined> {
  const keys = Object.keys(document.providers);
  if (keys.length === 0) {
    console.log('No providers to update.');
    return undefined;
  }
  const key = await promptMenu(rl, 'Select provider to update', keys.map((k) => [k, k] as const));
  const current = document.providers[key];
  const updated = await collectProviderDetails(rl, key, current);
  if (!updated) {
    return undefined;
  }
  return { providers: { ...document.providers, [key]: updated } };
}

async function deleteProvider(
  rl: ReturnType<typeof createInterface>,
  document: ProvidersDocument
): Promise<ProvidersDocument | undefined> {
  const keys = Object.keys(document.providers);
  if (keys.length === 0) {
    console.log('No providers to delete.');
    return undefined;
  }
  const key = await promptMenu(rl, 'Select provider to delete', keys.map((k) => [k, k] as const));
  const confirm = await promptYesNo(rl, `Delete provider ${key}?`);
  if (!confirm) {
    return undefined;
  }
  const { [key]: _removed, ...rest } = document.providers;
  return { providers: rest };
}

async function collectClient(
  rl: ReturnType<typeof createInterface>,
  document: ClientRegistryDocument,
  existing?: ClientEntry,
  indexToReplace?: number
): Promise<ClientEntry | undefined> {
  const toolId = await promptInput(rl, 'Tool ID:', {
    defaultValue: existing?.toolId ?? '',
    validate: (value) => {
      if (!value) {
        return 'Tool ID is required.';
      }
      const duplicate = document.clients.findIndex((client) => client.toolId === value);
      if (duplicate !== -1 && duplicate !== indexToReplace) {
        return `A client with toolId "${value}" already exists.`;
      }
      return true;
    }
  });
  if (!toolId) {
    return undefined;
  }

  const token = await promptInput(rl, 'Token:', {
    defaultValue: existing?.token ?? '',
    validate: (value) => (value ? true : 'Token is required.')
  });
  if (!token) {
    return undefined;
  }

  const allowedMethods = await promptMultiChoice(
    rl,
    'Allowed methods (comma separated):',
    ['chat', 'chatStream', 'embed', 'getHealth', 'models'],
    existing?.allowedMethods ?? ['chat', 'getHealth', 'models']
  );
  if (allowedMethods.length === 0) {
    console.log('Client must allow at least one method.');
    return undefined;
  }

  return { toolId, token, allowedMethods };
}

async function updateClient(
  rl: ReturnType<typeof createInterface>,
  document: ClientRegistryDocument
): Promise<ClientRegistryDocument | undefined> {
  if (document.clients.length === 0) {
    console.log('No clients to update.');
    return undefined;
  }
  const index = await promptIndex(rl, 'Select client index to update:', document.clients.length);
  if (index === undefined) {
    return undefined;
  }
  const current = document.clients[index];
  const updated = await collectClient(rl, document, current, index);
  if (!updated) {
    return undefined;
  }
  const next = [...document.clients];
  next[index] = updated;
  return { clients: next };
}

async function deleteClient(
  rl: ReturnType<typeof createInterface>,
  document: ClientRegistryDocument
): Promise<ClientRegistryDocument | undefined> {
  if (document.clients.length === 0) {
    console.log('No clients to delete.');
    return undefined;
  }
  const index = await promptIndex(rl, 'Select client index to delete:', document.clients.length);
  if (index === undefined) {
    return undefined;
  }
  const confirm = await promptYesNo(rl, `Delete client ${document.clients[index].toolId}?`);
  if (!confirm) {
    return undefined;
  }
  const next = document.clients.filter((_, idx) => idx !== index);
  return { clients: next };
}

async function promptMenu<T extends string>(
  rl: ReturnType<typeof createInterface>,
  label: string,
  options: Array<[string, T]>
): Promise<T> {
  console.log(`\n${label}`);
  options.forEach(([text], index) => {
    console.log(`  [${index + 1}] ${text}`);
  });
  while (true) {
    const answer = (await rl.question('Select option: ')).trim();
    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= options.length) {
      return options[index - 1][1];
    }
    console.log('Invalid selection.');
  }
}

async function promptInput(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options?: {
    defaultValue?: string;
    allowEmpty?: boolean;
    validate?: (value: string) => true | string;
  }
): Promise<string | undefined> {
  while (true) {
    const prompt = options?.defaultValue ? `${question} (${options.defaultValue}): ` : `${question} `;
    const answer = (await rl.question(prompt)).trim();
    const value = answer.length ? answer : options?.defaultValue ?? '';

    if (!value && !options?.allowEmpty) {
      console.log('Value is required.');
      continue;
    }

    if (options?.validate) {
      const result = options.validate(value);
      if (result !== true) {
        console.log(result);
        continue;
      }
    }

    return value;
  }
}

async function promptYesNo(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultYes = false
): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n]' : ' [y/N]';
  const answer = (await rl.question(`${question}${suffix} `)).trim().toLowerCase();
  if (!answer) {
    return defaultYes;
  }
  return answer.startsWith('y');
}

async function promptCapabilities(
  rl: ReturnType<typeof createInterface>,
  current: string[]
): Promise<string[]> {
  const defaultValue = current.length ? current.join(',') : 'chat,chatStream,embed';
  const input = await promptInput(rl, 'Capabilities (comma separated):', {
    defaultValue,
    validate: (value) => (value.trim().length ? true : 'At least one capability required.')
  });
  if (!input) {
    return [];
  }
  return input
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function promptSelectModel(
  rl: ReturnType<typeof createInterface>,
  question: string,
  models: string[],
  defaultValue: string
): Promise<string | undefined> {
  if (models.length === 0) {
    return promptInput(rl, question, { defaultValue, allowEmpty: false });
  }
  console.log(question);
  models.forEach((model, index) => {
    console.log(`  [${index + 1}] ${model}`);
  });
  const answer = (await rl.question('Select model by number or enter custom value: ')).trim();
  const index = Number.parseInt(answer, 10);
  if (Number.isInteger(index) && index >= 1 && index <= models.length) {
    return models[index - 1];
  }
  if (answer.length > 0) {
    return answer;
  }
  return defaultValue || undefined;
}

async function promptNumber(
  rl: ReturnType<typeof createInterface>,
  question: string,
  options?: { defaultValue?: number }
): Promise<number | undefined> {
  while (true) {
    const promptLabel =
      options?.defaultValue !== undefined ? `${question} (${options.defaultValue}): ` : `${question} `;
    const answer = (await rl.question(promptLabel)).trim();
    if (!answer) {
      return options?.defaultValue;
    }
    const value = Number.parseInt(answer, 10);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      console.log('Enter a number between 0 and 100.');
      continue;
    }
    return value;
  }
}

async function promptMultiChoice(
  rl: ReturnType<typeof createInterface>,
  question: string,
  choices: string[],
  defaults: string[]
): Promise<string[]> {
  while (true) {
    const defaultValue = defaults.length ? defaults.join(',') : choices.join(',');
    const input = await promptInput(rl, question, { defaultValue, allowEmpty: false });
    if (!input) {
      continue;
    }
    const tokens = input
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    const invalid = tokens.filter((token) => !choices.includes(token));
    if (invalid.length) {
      console.log(`Unknown values: ${invalid.join(', ')}`);
      continue;
    }
    return Array.from(new Set(tokens));
  }
}

async function promptIndex(
  rl: ReturnType<typeof createInterface>,
  question: string,
  length: number
): Promise<number | undefined> {
  const answer = (await rl.question(`${question} `)).trim();
  const index = Number.parseInt(answer, 10);
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    console.log(`Enter a number between 0 and ${length - 1}.`);
    return undefined;
  }
  return index;
}

function buildScores(entries: Record<string, number | undefined>): Record<string, number> | undefined {
  const scores: Record<string, number> = {};
  for (const [key, value] of Object.entries(entries)) {
    if (value !== undefined) {
      scores[key] = value;
    }
  }
  return Object.keys(scores).length ? scores : undefined;
}

main();
