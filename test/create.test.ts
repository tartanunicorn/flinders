// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { createFlinders, createFlindersClient, fillPath, FLINDERS_ROUTES, type FlindersHttpRequest, type FlindersRouter } from '../src/index.js';

const router: FlindersRouter = { url: () => '/', navigate: async () => true, onNavigated: () => () => undefined, routePattern: (url) => url };

/** A backend that answers each route from a table and remembers what it was asked. */
function backend(answers: Record<string, unknown> = {}) {
  const calls: FlindersHttpRequest[] = [];
  const request = async (call: FlindersHttpRequest) => {
    calls.push(call);
    return call.route in answers ? { ok: true, body: answers[call.route] } : { ok: false, body: { error: { code: 'forbidden', message: 'No.' } } };
  };
  return { calls, request };
}

describe('the client', () => {
  it('calls the contract’s routes under the base, and a product’s own path where it has one', async () => {
    const { calls, request } = backend({ recordEvent: { offer_walkthroughs: true, progress: {} }, listWalkthroughs: { data: [] } });
    const client = createFlindersClient({ baseUrl: '/api/help/', paths: { listWalkthroughs: '/tours' }, request });
    await client.list();
    await client.record('id 1', { event: 'started', version: 1, step: 0, from: 'list' });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', '/api/help/tours'],
      ['POST', '/api/help/walkthroughs/id%201/events'],
    ]);
    expect(calls[1]).toMatchObject({ path: FLINDERS_ROUTES.recordEvent.path, params: { walkthroughId: 'id 1' } });
  });

  it('answers null for a refusal and hands a thrown error on, as the controller expects', async () => {
    const down = createFlindersClient({ request: () => Promise.reject(new Error('away')) });
    await expect(down.mine()).rejects.toThrow('away');
    expect(await createFlindersClient({ request: backend().request }).mine()).toBeNull();
  });

  it('says when a link is what stopped a recording saving', async () => {
    const client = createFlindersClient({ request: backend().request });
    expect(await client.saveDraft('link', [])).toEqual({ error: { error: { code: 'forbidden', message: 'No.' } }, linkRefused: true });
  });

  it('reads stats from the detail on a backend without the stats route', async () => {
    const stats = { people: 1, finished: 0, reached: [1], actions_done: 0 };
    const { calls, request } = backend({ adminDetail: { stats } });
    const client = createFlindersClient({ paths: { adminStats: null }, request });
    expect(client.serves('adminStats')).toBe(false);
    expect(await client.admin.stats('1')).toEqual({ ok: true, data: stats });
    expect(calls[0]?.route).toBe('adminDetail');
  });

  it('uses fetch with JSON and the product’s headers by default', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ offer_walkthroughs: false, progress: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const mine = await createFlindersClient({ baseUrl: '/help', headers: () => ({ authorization: 'Bearer t' }) }).setOffers(false);
    vi.unstubAllGlobals();
    expect(mine?.offer_walkthroughs).toBe(false);
    expect(fetchMock.mock.calls[0]).toEqual([
      '/help/offers',
      { method: 'PATCH', headers: { accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer t' }, body: '{"offer_walkthroughs":false}' },
    ]);
  });

  it('fills a path’s params', () => {
    expect(fillPath('/a/{walkthroughId}/b', { walkthroughId: 'x/y' })).toBe('/a/x%2Fy/b');
  });
});

describe('createFlinders', () => {
  it('turns off what’s left out, and says so', async () => {
    const none = createFlinders({});
    expect(none).toMatchObject({ player: null, controller: null, recorder: null, api: null });
    expect(none.features).toEqual({ play: false, load: false, offers: false, recording: false, recordingLinks: false, events: false, messages: false });
    expect(none.off).toContain('Playing is off: no router connector.');
    expect(none.off).toHaveLength(8);
  });

  it('gives everything when everything is connected', () => {
    const f = createFlinders({ http: { request: backend().request }, router, identity: { can: () => true }, events: () => undefined, offers: { show: async () => null, clear: () => undefined }, toast: () => undefined });
    expect(f.features).toEqual({ play: true, load: true, offers: true, recording: true, recordingLinks: true, events: true, messages: true });
    expect(f.off).toEqual([]);
  });

  it('has no recording when the router can’t name a page, and no links when the backend doesn’t serve them', () => {
    const { routePattern: _unused, ...plainRouter } = router;
    expect(createFlinders({ http: { request: backend().request }, router: plainRouter }).recorder).toBeNull();
    const noLinks = createFlinders({ http: { request: backend().request, paths: { saveRecording: null } }, router });
    expect(noLinks.features).toMatchObject({ recording: true, recordingLinks: false });
  });

  it('sends cookies to another site when asked', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createFlindersClient({ credentials: 'include' }).mine();
    expect(fetchMock.mock.calls[0]).toMatchObject([expect.anything(), { credentials: 'include' }]);
    vi.unstubAllGlobals();
  });

  it('uses the product’s own player when it passes one', async () => {
    const start = vi.fn(async () => true);
    const tour = { id: 'a', version: 1, title: 'T', steps: [] };
    const f = createFlinders({ http: { request: backend().request }, player: { start } });
    expect(f.player).toEqual({ start });
    await f.controller?.preview(tour);
    expect(start).toHaveBeenCalledWith(tour, undefined);
  });

  it('says it couldn’t start, with no player', async () => {
    const toast = vi.fn();
    const f = createFlinders({ http: { request: backend().request }, toast });
    await f.controller?.preview({ id: 'a', version: 1, title: 'T', steps: [] });
    expect(toast).toHaveBeenCalledOnce();
  });

  it('hides what’s behind a permission without identity, and offers nothing without an offers connector', async () => {
    const live = { walkthrough_id: 'w', number: 1, version: 1, slug: 's', title: 'T', mode: 'show', permission: 'x', offer_on: '/', reoffer_from: 1, article_slug: null, steps: [{ anchor: null, title: 'T', body: 'B', missing: 'centred' }] };
    const { calls, request } = backend({ listWalkthroughs: { data: [live] }, getMyProgress: { offer_walkthroughs: true, progress: {} } });
    const show = vi.fn(async () => null);
    await createFlinders({ http: { request }, offers: { show, clear: () => undefined } }).controller?.offerFor('/');
    expect(calls.length).toBe(2);
    expect(show).not.toHaveBeenCalled();
    const open = createFlinders({ http: { request }, identity: { can: () => true }, offers: { show, clear: () => undefined } });
    await open.controller?.offerFor('/');
    expect(show).toHaveBeenCalledOnce();
    const silent = backend();
    await createFlinders({ http: { request: silent.request } }).controller?.offerFor('/');
    expect(silent.calls).toEqual([]);
  });

  it('sends events to the connector, and one that throws never stops the save', async () => {
    const live = { walkthrough_id: 'w', number: 1, version: 2, slug: 's', title: 'T', mode: 'show', permission: null, offer_on: null, reoffer_from: 1, article_slug: null, steps: [{ anchor: null, title: 'T', body: 'B', missing: 'centred' }] };
    const { calls, request } = backend({ listWalkthroughs: { data: [live] }, getMyProgress: { offer_walkthroughs: true, progress: {} }, recordEvent: { offer_walkthroughs: true, progress: {} } });
    const events = vi.fn(() => {
      throw new Error('analytics is down');
    });
    const start = vi.fn(async (_tour, options) => {
      options?.onEvent?.('started', 0);
      return true;
    });
    await createFlinders({ http: { request }, events, player: { start } }).controller?.start('1', 'list');
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'walkthrough', walkthrough_id: 'w', event: 'started', version: 2, from: 'list' }));
    expect(calls.some((c) => c.route === 'recordEvent')).toBe(true);
  });
});
