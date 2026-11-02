/**
 * The smallest backend that passes the kit: `createFlinders` from flinders/server behind `node:http`,
 * on Postgres, in a throwaway schema. It proves the contract can be met and shows how little it takes.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import { createFlinders, type FlindersHandleResponse, type FlindersPerson, type FlindersQuery } from '../../src/server.js';
import type { TestUser } from '../runner.js';

const SQL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'sql', '001_walkthroughs.sql');

/** The recording secret of this test server. */
export const REFERENCE_SECRET = 'reference-server-secret';

/** Who a bearer token signs in. The token is the user's name. */
const PEOPLE: Record<TestUser, FlindersPerson> = {
  admin: { id: 'reference-admin', admin: true, owner: null },
  person: { id: 'reference-person', owner: null },
  person2: { id: 'reference-person-2', owner: null },
  otherAdmin: { id: 'reference-other-admin', admin: true, owner: 'another-owner' },
};

export const signIn = (user: TestUser): Record<string, string> => ({ authorization: `Bearer ${user}` });

export interface ReferenceOptions {
  databaseUrl: string;
  /** Serves a route at another path: how the tests prove the kit's path map. */
  rewrite?(path: string): string;
  /** Changes an answer on its way out: how the tests prove the kit catches a backend that breaks a rule. */
  tamper?(request: { method: string; path: string; body: unknown }, response: FlindersHandleResponse): FlindersHandleResponse;
}

async function readBody(request: IncomingMessage): Promise<{ body?: unknown; bad?: boolean }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  try {
    return { body: JSON.parse(text) };
  } catch {
    return { bad: true };
  }
}

export async function startReferenceServer(options: ReferenceOptions) {
  const schema = `flinders_reference_${randomUUID().slice(0, 8)}`;
  const client = new pg.Client({ connectionString: options.databaseUrl });
  await client.connect();
  await client.query(`CREATE SCHEMA ${schema}; SET search_path = ${schema}, public;`);
  await client.query(readFileSync(SQL, 'utf8'));
  const query: FlindersQuery = async (text, params) => (await client.query(text, params as unknown[])).rows;

  const offers = new Map<string, boolean>();
  const flinders = createFlinders({
    query,
    tables: { versions: 'walkthroughs', progress: 'walkthroughs_progress' },
    app: { anchorExists: (id) => id !== 'conformance-no-such-element', routeExists: (route) => route !== '/conformance-no-such-page' },
    offers: { get: async ({ id }) => offers.get(id), set: async ({ id }, on) => void offers.set(id, on) },
    recording: { secret: REFERENCE_SECRET, webUrl: 'https://app.example.com', mayRecord: (person) => !!person.admin },
  });

  const server = createServer((request, response) => {
    void (async () => {
      const asked = (request.url ?? '/').split('?')[0]!.replace(/^\/flinders/, '');
      const path = options.rewrite?.(asked) ?? asked;
      const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] as TestUser | undefined;
      const { body, bad } = await readBody(request);
      let answer: FlindersHandleResponse = bad
        ? { status: 400, body: { error: { code: 'validation_failed', message: 'That isn’t JSON.' } } }
        : await flinders.handle({ method: request.method ?? 'GET', path, body, person: (token && PEOPLE[token]) ?? null });
      if (options.tamper) answer = options.tamper({ method: request.method ?? 'GET', path, body }, answer);
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify(answer.body));
    })().catch((err: unknown) => {
      console.error(err);
      response.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/flinders`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await client.query(`DROP SCHEMA ${schema} CASCADE`);
      await client.end();
    },
  };
}
