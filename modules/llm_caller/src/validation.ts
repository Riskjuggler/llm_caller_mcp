import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'node:fs';
import path from 'node:path';

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

export function loadSchema(schemaName: string): object {
  const schemaPath = path.resolve(`api/schemas/v1/${schemaName}`);
  const raw = fs.readFileSync(schemaPath, 'utf-8');
  return JSON.parse(raw);
}

export function createValidator<T>(schemaName: string): (payload: unknown) => T {
  const schema = loadSchema(schemaName);
  const validate = ajv.compile(schema);

  return (payload: unknown) => {
    if (!validate(payload)) {
      const detail = ajv.errorsText(validate.errors, { separator: '; ' });
      throw new Error(`Schema validation failed: ${detail}`);
    }

    return payload as T;
  };
}
