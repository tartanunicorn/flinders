import { describe, expect, it } from 'vitest';

import { CONTRACT_ROUTES } from '../conformance/runner.js';
import { FLINDERS_ROUTES } from '../src/contract.js';
import { contract, operations, responseProblem, schemaAt } from './contract.js';

describe('the HTTP contract', () => {
  it('holds exactly the routes the browser client and the server use', () => {
    const inFile = operations.map((o) => [o.operationId, o.method, o.path]).sort();
    expect(Object.entries(FLINDERS_ROUTES).map(([name, route]) => [name, route.method, route.path]).sort()).toEqual(inFile);
  });

  it('holds exactly the routes the conformance kit drives', () => {
    expect(CONTRACT_ROUTES).toEqual(Object.fromEntries(Object.entries(FLINDERS_ROUTES).map(([name, route]) => [name, [route.method, route.path]])));
  });

  it('gives every route an answer for nobody signed in', () => {
    expect(operations.filter((o) => !o.responses['401']).map((o) => o.operationId)).toEqual([]);
    expect(operations.filter((o) => o.path.startsWith('/admin') && !o.responses['403']).map((o) => o.operationId)).toEqual([]);
  });

  it('every schema compiles, with the file format reused from schema/', () => {
    for (const name of Object.keys(contract.components.schemas)) expect(() => schemaAt('components', 'schemas', name), name).not.toThrow();
    const upload = schemaAt('paths', '/admin/walkthroughs', 'post', 'requestBody', 'content', 'application/json', 'schema');
    expect(upload({ slug: 'a', title: 'T', steps: [{ anchor: null, title: 'T', body: 'B', missing: 'end' }] })).toBe(true);
    expect(upload({ slug: 'Not A Slug', title: 'T', steps: [] })).toBe(false);
  });

  it('checks answers: a wrong shape or a status it doesn’t list is a problem', () => {
    expect(responseProblem('getMyProgress', 200, { offer_walkthroughs: true, progress: {} })).toBeNull();
    expect(responseProblem('getMyProgress', 200, { progress: {} })).toContain('offer_walkthroughs');
    expect(responseProblem('getMyProgress', 418, {})).toContain('418');
  });
});
