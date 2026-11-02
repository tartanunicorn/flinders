import 'server-only';
import pg from 'pg';
import { createFlinders, type FlindersPerson } from 'flinders/server';

import { walkthroughFiles } from './walkthroughs';

// One pool and one Flinders for the whole server, kept across hot reloads in development.
const shared = globalThis as typeof globalThis & { flinders?: { server: ReturnType<typeof createFlinders>; ready: Promise<void> } };

function start() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const server = createFlinders({ query: (text, params) => pool.query(text, params as unknown[]).then((result) => result.rows) });
  // Saved once per start; a file whose number hasn't changed saves nothing.
  const ready = server.publish(walkthroughFiles);
  return { server, ready };
}

export async function flinders() {
  shared.flinders ??= start();
  await shared.flinders.ready;
  return shared.flinders.server;
}

/** Your own sign-in goes here: read the session cookie or token and say who it is, or null. */
export async function whoIsAsking(_request: Request): Promise<FlindersPerson | null> {
  return { id: 'demo-person', admin: true };
}
