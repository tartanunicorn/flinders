// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WalkthroughContext } from '../src/index.js';
import { WalkthroughPlayer, type PlayerCard, type PlayableWalkthrough, type PlayerHost } from '../src/player.js';

const step = (anchor: string | null, title: string, extra: object = {}) => ({ anchor, title, body: `About **${title}**.`, missing: 'centred' as const, ...extra });
const TOUR: PlayableWalkthrough = { id: 'w1', version: 1, title: 'Add a note', mode: 'guide', steps: [step('one', 'First', { route: '/notes/:noteId' }), step('two', 'Second'), step('three', 'Third')] };

const flush = (ms = 1000) => vi.advanceTimersByTimeAsync(ms);
const card = () => document.querySelector<HTMLElement>('.driver-popover');
const title = () => card()?.querySelector('.driver-popover-title')?.textContent;
const askButton = () => [...document.querySelectorAll<HTMLButtonElement>('.driver-popover-footer button')].find((b) => b.textContent === 'Ask about this');
const next = () => card()?.querySelector<HTMLElement>('.driver-popover-next-btn')?.click();
const back = () => card()?.querySelector<HTMLElement>('.driver-popover-prev-btn')?.click();
const key = (name: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));

describe('chatting during a walkthrough', () => {
  let player: WalkthroughPlayer;
  let events: string[];

  // The player's dynamic import, resolved before the fake timers begin.
  beforeAll(() => import('driver.js'));

  function setUp(extra: Partial<PlayerHost> = {}) {
    player = new WalkthroughPlayer({ url: () => '/notes/client-smith-42', navigate: async () => true, onNavigated: () => () => undefined, ...extra });
  }
  async function play(tour = TOUR, startAt = 0) {
    void player.start(tour, { startAt, onEvent: (e) => events.push(e) });
    await flush(5000);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    document.body.innerHTML = '<div data-testid="one"><input value="Mrs Smith, 12 High St" /></div><div data-testid="two"></div><div data-testid="three"></div>';
    Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 10, left: 10, right: 110, bottom: 40, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
    setUp();
  });

  afterEach(() => {
    player.stop();
    vi.useRealTimers();
  });

  describe('the context', () => {
    it('is null with nothing on screen, then says where the person is as plain JSON', async () => {
      expect(player.context()).toBeNull();
      await play();
      const context = player.context();
      expect(context).toEqual({
        version: 1,
        walkthrough: { id: 'w1', title: 'Add a note', mode: 'guide' },
        step: { number: 1, total: 3, title: 'First', body: 'About First.', element: 'one' },
        page: '/notes/:noteId',
        done: [],
        articles: [],
      });
      expect(JSON.parse(JSON.stringify(context))).toEqual(context);
    });

    it('names the step’s articles first, then the walkthrough’s, each once, and moves on with the step', async () => {
      await play({ ...TOUR, articles: ['shared', 'whole'], steps: [step('one', 'First', { route: '/notes/:noteId', articles: ['https://help.example.com/one', 'shared'] }), step('two', 'Second')] });
      expect(player.context()?.articles).toEqual(['https://help.example.com/one', 'shared', 'whole']);
      next();
      await flush();
      expect(player.context()?.articles).toEqual(['shared', 'whole']);
      expect(player.context()?.version).toBe(1);
    });

    it('holds no field values and no ids from the address', async () => {
      await play();
      const text = JSON.stringify(player.context());
      expect(text).not.toContain('Smith');
      expect(text).not.toContain('High St');
    });

    it('leaves the page out when no step or router can name its pattern, and never falls back to the address', async () => {
      await play({ ...TOUR, steps: [step('one', 'First')] });
      expect(player.context()?.page).toBeNull();
      player.stop();
      setUp({ routePattern: () => '/notes/:noteId' });
      await play({ ...TOUR, steps: [step('one', 'First')] });
      expect(player.context()?.page).toBe('/notes/:noteId');
    });

    it('counts what is done: moving on adds a step, going back takes it away, a skip never counts', async () => {
      await play();
      next();
      await flush();
      next();
      await flush();
      expect(player.context()?.done).toEqual([{ number: 1, title: 'First' }, { number: 2, title: 'Second' }]);
      back();
      await flush();
      expect(player.context()?.done).toEqual([{ number: 1, title: 'First' }]);
      player.next('skipped');
      await flush();
      expect(player.context()?.done).toEqual([{ number: 1, title: 'First' }]);
    });

    it('picking up part-way, the steps before count as done', async () => {
      await play(TOUR, 1);
      expect(player.context()?.done).toEqual([{ number: 1, title: 'First' }]);
    });

    it('says what the card says when something blocks the step', async () => {
      document.body.innerHTML += '<div data-testid="stop"></div>';
      await play({ ...TOUR, steps: [step('one', 'First', { blocked: [{ anchor: 'stop', title: 'Connect first', body: 'Connect it.' }] })] });
      expect(player.context()?.step).toMatchObject({ title: 'Connect first', body: 'Connect it.', element: 'stop' });
    });
  });

  describe('Ask about this', () => {
    it('is off unless the product gives a handler', async () => {
      await play();
      expect(askButton()).toBeUndefined();
    });

    it('holds the walkthrough and hands over the context', async () => {
      const asked: WalkthroughContext[] = [];
      setUp({ askAbout: (context) => asked.push(context) });
      await play();
      askButton()?.click();
      expect(asked[0]?.step.title).toBe('First');
      expect(document.documentElement.classList.contains('flinders-held')).toBe(true);
      expect(events).toEqual(['started']);
    });

    it('takes the product’s label, and comes with a card the product draws itself', async () => {
      const cards: PlayerCard[] = [];
      const asked = vi.fn();
      setUp({ askAbout: asked, labels: { askAbout: 'Ask' }, renderCard: (_, c) => void cards.push(c) });
      await play();
      expect(cards[0]?.askAboutLabel).toBe('Ask');
      cards[0]?.askAbout?.();
      expect(asked).toHaveBeenCalledOnce();
    });
  });

  describe('holding', () => {
    it('stays on the step while the chat is open, and carries on there', async () => {
      await play();
      next();
      await flush();
      player.hold(true);
      expect(title()).toBe('Second');
      expect(player.context()?.step.number).toBe(2);
      player.hold(false);
      expect(document.documentElement.classList.contains('flinders-held')).toBe(false);
      expect(title()).toBe('Second');
      expect(events).toEqual(['started']);
    });

    it('leaves Esc to the chat while held; afterwards Esc ends the walkthrough as before', async () => {
      await play();
      player.hold(true);
      key('Escape');
      expect(player.context()).not.toBeNull();
      player.hold(false);
      key('Escape');
      expect(player.context()).toBeNull();
      expect(events).toEqual(['started', 'paused']);
    });

    it('keeps Driver’s Tab handler off the chat only while held', async () => {
      await play();
      const pressTab = () => {
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(pressTab()).toBe(true);
      player.hold(true);
      expect(pressTab()).toBe(false);
    });

    it('does nothing with no walkthrough, and ending one clears it', async () => {
      player.hold(true);
      expect(document.documentElement.classList.contains('flinders-held')).toBe(false);
      await play();
      player.hold(true);
      player.stop();
      expect(document.documentElement.classList.contains('flinders-held')).toBe(false);
    });
  });

  it('the stylesheet keeps marked elements clickable, above the dimmed page and under the card', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'player.css'), 'utf8');
    expect(css).toContain('.driver-active [data-flinders-keep] *');
    const card = Number(/\.driver-popover\.flinders-card \{[^}]*z-index: (\d+)/.exec(css)?.[1]);
    const keep = Number(/\[data-flinders-keep\] \{ z-index: (\d+)/.exec(css)?.[1]);
    expect(keep).toBeGreaterThan(10000);
    expect(keep).toBeLessThan(card);
  });
});
