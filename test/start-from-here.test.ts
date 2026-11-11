// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { placeOnScreen, WalkthroughPlayer, type PlayableWalkthrough, type PlayerHost } from '../src/player.js';
import type { WalkthroughStep } from '../src/types.js';

/** A person part-way through a walkthrough's work is never sent back to its first page. */

const step = (anchor: string | null, title: string, extra: Partial<WalkthroughStep> = {}): WalkthroughStep => ({ anchor, title, body: 'Body.', missing: 'centred', ...extra });

function page(html: string): void {
  document.body.innerHTML = html;
  // jsdom has no layout: everything on the page counts as visible.
  Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 10, left: 10, right: 110, bottom: 40, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
}

const dialog = (inner: string) => `<div role="dialog" aria-modal="true">${inner}</div>`;

/** Two pages: a list with a New button opening a pop-out (name, kind, Create), then the new item's page. */
const NEW_ITEM: WalkthroughStep[] = [
  step('new-btn', 'Press New', { route: '/items', advance_on_click: true }),
  step('name', 'Name it', { done_when: { kind: 'filled' } }),
  step('kind', 'Pick a kind'),
  step('create', 'Create it', { done_when: { kind: 'route', route: '/items/:itemId' } }),
  step('item-header', 'Your item'),
  step('item-share', 'Share it'),
];

describe('placeOnScreen', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('on the first page with nothing open or done: the first step', () => {
    page('<button data-testid="new-btn">New</button>');
    expect(placeOnScreen(NEW_ITEM, '/items')).toBe(0);
  });

  it('on none of its pages: null, so it starts as before', () => {
    page('<p data-testid="other">Other</p>');
    expect(placeOnScreen(NEW_ITEM, '/settings')).toBeNull();
  });

  it('with the pop-out open: its first step in the pop-out, not the button under it', () => {
    page(`<button data-testid="new-btn">New</button>${dialog('<label data-testid="name"><input></label><p data-testid="kind">Kind</p><button data-testid="create">Create</button>')}`);
    expect(placeOnScreen(NEW_ITEM, '/items')).toBe(1);
  });

  it('with a step in the pop-out already done: the step after it', () => {
    page(`<button data-testid="new-btn">New</button>${dialog('<label data-testid="name"><input value="Bridge"></label><p data-testid="kind">Kind</p><button data-testid="create">Create</button>')}`);
    expect(placeOnScreen(NEW_ITEM, '/items')).toBe(2);
  });

  it('on a later page (reached through a done_when route): the first step there', () => {
    page('<h1 data-testid="item-header">Item</h1><button data-testid="item-share">Share</button>');
    expect(placeOnScreen(NEW_ITEM, '/items/42')).toBe(4);
  });

  it('on a later page whose element is still loading: still that page’s first step', () => {
    page('<p>Loading…</p>');
    expect(placeOnScreen(NEW_ITEM, '/items/42')).toBe(4);
  });

  it('a fork’s path counts only when its only_if is on screen', () => {
    const steps = [step('start', 'Start', { route: '/a' }), step('pick-a', 'Path A', { only_if: 'path-a' }), step('pick-b', 'Path B', { only_if: 'path-b' }), step('end', 'End')];
    page(dialog('<p data-testid="path-b"></p><p data-testid="pick-a"></p><p data-testid="pick-b"></p><p data-testid="end"></p>'));
    expect(placeOnScreen(steps, '/a')).toBe(2);
  });
});

describe('starting from here', () => {
  let url: string;
  let navigated: string[];
  let player: WalkthroughPlayer;
  const host: PlayerHost = {
    url: () => url,
    navigate: async (to) => {
      navigated.push(to);
      url = to;
      return true;
    },
    onNavigated: () => () => undefined,
  };
  const tour: PlayableWalkthrough = { id: 'w1', version: 1, title: 'New item', mode: 'guide', steps: NEW_ITEM };
  const title = () => document.querySelector('.driver-popover-title')?.textContent;
  const flush = (ms = 5000) => vi.advanceTimersByTimeAsync(ms);

  beforeAll(async () => {
    await import('driver.js');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    navigated = [];
    player = new WalkthroughPlayer(host);
  });

  afterEach(() => {
    player.stop();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('on the item’s page, starts there and never goes back to the list', async () => {
    url = '/items/42';
    page('<h1 data-testid="item-header">Item</h1><button data-testid="item-share">Share</button>');
    const events: [string, number][] = [];
    void player.start(tour, { fromHere: true, onEvent: (e, s) => events.push([e, s]) });
    await flush();
    expect(title()).toBe('Your item');
    expect(navigated).toEqual([]);
    expect(events).toEqual([['started', 4]]);
  });

  it('in the pop-out with the name filled, starts at the next step', async () => {
    url = '/items';
    page(`<button data-testid="new-btn">New</button>${dialog('<label data-testid="name"><input value="Bridge"></label><p data-testid="kind">Kind</p><button data-testid="create">Create</button>')}`);
    void player.start(tour, { fromHere: true });
    await flush();
    expect(title()).toBe('Pick a kind');
  });

  it('beats where the person paused when they are somewhere else in it now', async () => {
    url = '/items/42';
    page('<h1 data-testid="item-header">Item</h1>');
    void player.start(tour, { fromHere: true, startAt: 2 });
    await flush();
    expect(title()).toBe('Your item');
    expect(navigated).toEqual([]);
  });

  it('on its first page with nothing done, where the person paused still stands', async () => {
    url = '/items';
    page('<button data-testid="new-btn">New</button><p data-testid="kind">Kind</p>');
    void player.start(tour, { fromHere: true, startAt: 2 });
    await flush();
    expect(title()).toBe('Pick a kind');
  });

  it('with its element still loading, shows that step rather than starting again from the first page', async () => {
    url = '/items/42';
    page('<p>Loading…</p>');
    void player.start(tour, { fromHere: true });
    await flush(6000);
    expect(title()).toBe('Your item');
    expect(navigated).toEqual([]);
  });

  it('without fromHere, starts at the first step as before', async () => {
    url = '/items/42';
    page('<h1 data-testid="item-header">Item</h1><button data-testid="new-btn">New</button>');
    void player.start(tour);
    await flush();
    expect(navigated).toEqual(['/items']);
    expect(title()).toBe('Press New');
  });
});
