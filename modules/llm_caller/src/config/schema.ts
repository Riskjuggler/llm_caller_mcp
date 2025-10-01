import Ajv, { type JSONSchemaType, type ValidateFunction, type ErrorObject } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

export interface ProviderDefaults {
  [capability: string]: string;
}

export interface ProviderScores {
  [capability: string]: number;
}

export interface ProviderEntry {
  baseUrl: string;
  defaultModel: string;
  capabilities: string[];
  defaults?: ProviderDefaults;
  scores?: ProviderScores;
  notes?: string;
}

export interface ProvidersDocument {
  providers: Record<string, ProviderEntry>;
}

export interface ClientEntry {
  toolId: string;
  token: string;
  allowedMethods: string[];
}

export interface ClientRegistryDocument {
  clients: ClientEntry[];
}

const providerEntrySchema: JSONSchemaType<ProviderEntry> = {
  type: 'object',
  additionalProperties: false,
  required: ['baseUrl', 'defaultModel', 'capabilities'],
  properties: {
    baseUrl: { type: 'string', minLength: 1 },
    defaultModel: { type: 'string', minLength: 1 },
    capabilities: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
      uniqueItems: true
    },
    defaults: {
      type: 'object',
      nullable: true,
      required: [],
      additionalProperties: { type: 'string', minLength: 1 }
    },
    scores: {
      type: 'object',
      nullable: true,
      required: [],
      additionalProperties: { type: 'number' }
    },
    notes: {
      type: 'string',
      nullable: true
    }
  }
};

const providersDocumentSchema: JSONSchemaType<ProvidersDocument> = {
  type: 'object',
  required: ['providers'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    providers: {
      type: 'object',
      required: [],
      additionalProperties: providerEntrySchema
    }
  }
};

const allowedMethodSchema: JSONSchemaType<string> = {
  type: 'string',
  enum: ['chat', 'chatStream', 'embed', 'getHealth', 'models']
};

const clientEntrySchema: JSONSchemaType<ClientEntry> = {
  type: 'object',
  additionalProperties: false,
  required: ['toolId', 'token', 'allowedMethods'],
  properties: {
    toolId: { type: 'string', minLength: 1 },
    token: { type: 'string', minLength: 1 },
    allowedMethods: {
      type: 'array',
      minItems: 1,
      items: allowedMethodSchema,
      uniqueItems: true
    }
  }
};

const clientRegistryDocumentSchema: JSONSchemaType<ClientRegistryDocument> = {
  type: 'object',
  required: ['clients'],
  additionalProperties: false,
  properties: {
    $schema: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    clients: {
      type: 'array',
      items: clientEntrySchema
    }
  }
};

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export const validateProvidersDocument = ajv.compile(providersDocumentSchema);
export const validateClientRegistryDocument = ajv.compile(clientRegistryDocumentSchema);

export type ProvidersValidator = ValidateFunction<ProvidersDocument>;
export type ClientRegistryValidator = ValidateFunction<ClientRegistryDocument>;
export type SchemaError = ErrorObject;
