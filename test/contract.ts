/** Reads contract/openapi.yaml, and checks an answer against it with its JSON Schema. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv, type ValidateFunction } from 'ajv';
import { parse } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_ID = 'http://flinders.test/contract/openapi.yaml';
const SCHEMA_ID = 'http://flinders.test/schema/walkthrough.schema.json';

export const contract: any = parse(readFileSync(join(ROOT, 'contract', 'openapi.yaml'), 'utf8'));
const walkthroughSchema = JSON.parse(readFileSync(join(ROOT, 'schema', 'walkthrough.schema.json'), 'utf8'));

export interface Operation {
  method: string;
  path: string;
  operationId: string;
    responses: Record<string, any>;
}

export const operations: Operation[] = Object.entries<Record<string, Operation>>(contract.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, operation]) => ({ ...operation, method: method.toUpperCase(), path })),
);

const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: false });
ajv.addSchema({ ...walkthroughSchema, $id: SCHEMA_ID });
ajv.addSchema({ ...contract, $id: CONTRACT_ID });

const pointer = (parts: string[]) => parts.map((p) => p.replaceAll('~', '~0').replaceAll('/', '~1')).join('/');
const validators = new Map<string, ValidateFunction>();

/** Compiles the schema at this path of the contract. */
export function schemaAt(...parts: string[]): ValidateFunction {
  const ref = `${CONTRACT_ID}#/${pointer(parts)}`;
  let validate = validators.get(ref);
  if (!validate) {
    validate = ajv.compile({ $ref: ref });
    validators.set(ref, validate);
  }
  return validate;
}

/** What's wrong with an answer, by the contract: null when it fits. */
export function responseProblem(operationId: string, status: number, body: unknown): string | null {
  const operation = operations.find((o) => o.operationId === operationId);
  if (!operation) return `${operationId}: not in the contract`;
  const response = operation.responses[String(status)];
  if (!response) return `${operationId}: ${status} isn't a status it answers with`;
  const parts: string[] = response.$ref
    ? (response.$ref as string).slice(2).split('/')
    : ['paths', operation.path, operation.method.toLowerCase(), 'responses', String(status)];
  const validate = schemaAt(...parts, 'content', 'application/json', 'schema');
  return validate(body) ? null : `${operationId} ${status}: ${ajv.errorsText(validate.errors)}: ${JSON.stringify(body).slice(0, 300)}`;
}
