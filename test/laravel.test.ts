import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { FLINDERS_ROUTES } from '../src/contract.js';

const LARAVEL = join(dirname(fileURLToPath(import.meta.url)), '..', 'laravel');

/** The behaviour is proved by the kit in Docker (laravel/README.md); this needs no PHP. */
describe('the Laravel package', () => {
  it('names every route of the contract, by its own name', () => {
    const routes = readFileSync(join(LARAVEL, 'routes', 'flinders.php'), 'utf8');
    const found = [...routes.matchAll(/Route::(get|post|patch)\('([^']+)', \[C::class, '(\w+)'\]\)->name\('flinders\.(\w+)'\)/g)];
    const named = Object.fromEntries(found.map((m) => [m[4]!, { method: m[1]!.toUpperCase(), path: m[2]!, handler: m[3]! }]));
    const expected = Object.fromEntries(Object.entries(FLINDERS_ROUTES).map(([name, route]) => [name, { method: route.method, path: route.path, handler: name }]));
    expect(named).toEqual(expected);
  });
});
