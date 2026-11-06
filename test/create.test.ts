// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFlinders, createFlindersClient, fillPath, FLINDERS_ROUTES, type FlindersHttpRequest, type FlindersRouter, type OfferAnswer } from '../src/index.js';
import type { WalkthroughPlayer } from '../src/player.js';

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

describe('createFlinders: offers and a walkthrough just started', () => {
  const live = { walkthrough_id: 'w', number: 1, version: 1, slug: 's', title: 'Home', mode: 'show', permission: null, offer_on: '/home', reoffer_from: 1, article_slug: null, steps: [{ anchor: 'late', route: '/home', title: 'Here', body: 'B', missing: 'centred' }] };

  function app(url = '/') {
    const listeners: ((url: string) => void)[] = [];
    const router: FlindersRouter = {
      url: () => url,
      navigate: async (to) => {
        url = to;
        listeners.forEach((l) => l(to));
        return true;
      },
      onNavigated: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
    };
    const shown: string[] = [];
    const clear = vi.fn();
    const { request } = backend({ listWalkthroughs: { data: [live] }, getMyProgress: { offer_walkthroughs: true, progress: {} }, recordEvent: { offer_walkthroughs: true, progress: {} } });
    const flinders = createFlinders({ http: { request }, router, identity: { can: () => true }, offers: { show: (offer) => (shown.push(offer.title), new Promise<OfferAnswer>(() => undefined)), clear } });
    return { flinders, shown, clear, url: () => url };
  }

  beforeEach(async () => {
    // Loaded once here, so the player's own import of it doesn't wait on real time.
    await import('driver.js');
    vi.useFakeTimers();
    document.body.innerHTML = '';
    Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 10, left: 10, right: 110, bottom: 40, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('offers nothing while a walkthrough just started is opening its page, even before its first card', async () => {
    const { flinders, shown, url } = app('/');
    await vi.advanceTimersByTimeAsync(1000);
    // The page is still loading (a spinner ticking), so the player waits for the element.
    document.body.innerHTML = '<p id="spinner"></p>';
    const loading = setInterval(() => document.getElementById('spinner')?.setAttribute('data-tick', String(Date.now())), 100);
    void flinders.start('1');
    // Its first page has opened, and the element is slow: well past the offer's delay, there is no card yet.
    await vi.advanceTimersByTimeAsync(2000);
    expect(url()).toBe('/home');
    expect(document.querySelector('.driver-popover')).toBeNull();
    expect(shown).toEqual([]);
    clearInterval(loading);
    document.body.innerHTML = '<button data-testid="late">Late</button>';
    await vi.advanceTimersByTimeAsync(3000);
    expect(document.querySelector('.driver-popover')).not.toBeNull();
    expect(shown).toEqual([]);
    (flinders.player as WalkthroughPlayer).stop();
    flinders.destroy();
  });

  it('takes down an offer already up when a walkthrough starts, from the player as well', async () => {
    const { flinders, shown, clear } = app('/home');
    await vi.advanceTimersByTimeAsync(1000);
    expect(shown).toEqual(['Home']);
    clear.mockClear();
    void (flinders.player as WalkthroughPlayer).start({ id: 'w', version: 1, title: 'Home', steps: live.steps as never });
    expect(clear).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    (flinders.player as WalkthroughPlayer).stop();
    flinders.destroy();
  });
});
