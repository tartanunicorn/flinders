import { flinders, whoIsAsking } from '@/lib/flinders-server';

const BASE = '/api/flinders';

// Every Flinders route, behind one catch-all: /api/flinders/walkthroughs, /api/flinders/admin/…
async function handle(request: Request) {
  const path = new URL(request.url).pathname.slice(BASE.length); // Still escaped: Flinders decodes ids itself.
  const body = request.method === 'GET' ? undefined : await request.json().catch(() => undefined);
  const server = await flinders();
  const answer = await server.handle({ method: request.method, path, body, person: await whoIsAsking(request) });
  return Response.json(answer.body, { status: answer.status });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
