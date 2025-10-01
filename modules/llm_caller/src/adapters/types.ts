import type { HttpClient } from './httpClient.js';
import type { SecretsProvider } from '../secrets/index.js';

export interface AdapterDependencies {
  httpClient: HttpClient;
  secretsProvider: SecretsProvider;
}
