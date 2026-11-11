// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildRoute, dockClearOfControls, doneWhenMet, leaderEnds, overlapArea, paramsFromUrl, stepPlace, WalkthroughPlayer, type DockLayout, type Rect, type PlayerCard, type PlayableWalkthrough, type PlayerEvent, type PlayerHost } from '../src/player.js';
import type { StepHow } from '../src/types.js';

const step = (anchor: string | null, title: string, extra: object = {}) => ({ anchor, title, body: 'Body.', missing: 'centred' as const, ...extra });

function page(html: string): void {
  document.body.innerHTML = html;
  // jsdom has no layout: everything on the page counts as visible.
  Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 30, top: 10, left: 10, right: 110, bottom: 40, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
}

const flush = async (ms = 1000) => {
  await vi.advanceTimersByTimeAsync(ms);
};
const card = () => document.querySelector<HTMLElement>('.driver-popover');
const title = () => card()?.querySelector('.driver-popover-title')?.textContent;
const nextButton = () => card()?.querySelector<HTMLElement>('.driver-popover-next-btn');
const prevButton = () => card()?.querySelector<HTMLElement>('.driver-popover-prev-btn');

describe('WalkthroughPlayer', () => {
  let url: string;
  let moves: [number, StepHow][];
  let events: [PlayerEvent, number][];
  let player: WalkthroughPlayer;

  const host: PlayerHost = {
    url: () => url,
    navigate: async (to) => {
      url = to;
      return true;
    },
    onNavigated: () => () => undefined,
  };

  async function play(tour: PlayableWalkthrough, startAt = 0) {
    const started = player.start(tour, { startAt, onStep: (s, how) => moves.push([s, how]), onEvent: (e, s) => events.push([e, s]) });
    await flush(5000);
    return started;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    url = '/projects';
    moves = [];
    events = [];
    player = new WalkthroughPlayer(host);
  });

  afterEach(() => {
    player.stop();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const tour = (mode: 'show' | 'guide', steps: PlayableWalkthrough['steps']): PlayableWalkthrough => ({ id: 'w1', version: 1, title: 'Add a project', mode, steps });

  it('show: Next moves on and is recorded as next', async () => {
    page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
    await play(tour('show', [step('one', 'First'), step('two', 'Second')]));
    expect(title()).toBe('First');
    nextButton()!.click();
    await flush();
    expect(title()).toBe('Second');
    expect(moves).toEqual([[1, 'next']]);
  });

  it('optional: using the element doesn’t move on, Next does, and the card says so', async () => {
    page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
    await play(tour('guide', [step('one', 'First', { optional: true, advance_on_click: true }), step('two', 'Second')]));
    expect(nextButton()?.style.display).not.toBe('none');
    expect(card()?.querySelector('.driver-popover-description')?.textContent).toBe('Body. You can try it, then press Next.');
    document.querySelector<HTMLElement>('[data-testid="one"]')!.click();
    await flush();
    expect(title()).toBe('First');
    nextButton()!.click();
    await flush();
    expect(title()).toBe('Second');
    expect(moves).toEqual([[1, 'next']]);
  });

  it('optional: with the element gone, the card doesn’t offer it', async () => {
    page('<button data-testid="two">Two</button>');
    await play(tour('show', [step('one', 'First', { optional: true }), step('two', 'Second')]));
    expect(card()?.querySelector('.driver-popover-description')?.textContent).toBe('Body.');
  });

  it('guide: Next is hidden until the person does it, and their click moves it on', async () => {
    page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
    await play(tour('guide', [step('one', 'First', { done_when: { kind: 'clicked' } }), step('two', 'Second')]));
    expect(nextButton()?.style.display).toBe('none');
    document.querySelector<HTMLElement>('[data-testid="one"]')!.click();
    await flush();
    expect(title()).toBe('Second');
    expect(moves).toEqual([[1, 'done']]);
  });

  it('never turns a title or a body into markup: a walkthrough file is someone’s text, not code', async () => {
    const attack = '<img src=x onerror="window.hacked=1">';
    await play({ id: 'x', version: 1, title: 'X', steps: [step(null, attack, { body: `**Bold** ${attack}` })] });
    expect(title()).toBe(attack);
    expect(card()?.querySelector('img')).toBeNull();
    expect(card()?.querySelector('.driver-popover-description strong')?.textContent).toBe('Bold');
    player.stop();
    await flush();
  });

  it('tells a screen reader the card is all there is only when it is', async () => {
    page('<button data-testid="go">Go</button>');
    await play({ id: 'x', version: 1, title: 'X', mode: 'guide', steps: [step('go', 'Read', {}), step('go', 'Do', { done_when: { kind: 'clicked' } })] });
    expect(card()?.getAttribute('aria-modal')).toBe('true');
    nextButton()?.click();
    await flush();
    expect(title()).toBe('Do');
    expect(card()?.getAttribute('aria-modal')).toBe('false');
    player.stop();
    await flush();
  });

  it('still plays on a right-to-left page', async () => {
    document.documentElement.dir = 'rtl';
    page('<button data-testid="go">Go</button>');
    await play({ id: 'x', version: 1, title: 'X', steps: [step('go', 'One', { side: 'left', align: 'start' })] });
    expect(card()?.querySelector('.driver-popover-arrow-side-right, .driver-popover-arrow-side-left, .driver-popover-arrow-side-over')).toBeTruthy();
    player.stop();
    await flush();
    document.documentElement.dir = '';
  });

  describe('a step that waits for a click (advance_on_click)', () => {
    const clicks = [step('one', 'First', { advance_on_click: true }), step('two', 'Second')];
    const cantFind = () => [...card()!.querySelectorAll('button')].find((b) => b.textContent === 'Can’t find it?');

    it('has no Next in a Show me either: the person’s click moves it on', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      await play(tour('show', clicks));
      expect(nextButton()?.style.display).toBe('none');
      document.querySelector<HTMLElement>('[data-testid="one"]')!.click();
      await flush();
      expect(title()).toBe('Second');
      expect(moves).toEqual([[1, 'done']]);
    });

    it('offers "Can’t find it?" after help_after, and never clicks for the person', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      let clicked = 0;
      document.querySelector('[data-testid="one"]')!.addEventListener('click', () => clicked++);
      void player.start(tour('show', [{ ...clicks[0]!, help_after: 9 }, clicks[1]!]), { onStep: (s, how) => moves.push([s, how]) });
      await flush(8000);
      expect(cantFind()).toBeUndefined();
      await flush(1500);
      cantFind()!.click();
      await flush();
      expect(title()).toBe('Second');
      expect(clicked).toBe(0);
      expect(moves).toEqual([[1, 'skipped']]);
    });

    it('keeps Next when the element has gone, when Optional, and when something blocks it', async () => {
      page('<button data-testid="two">Two</button>');
      await play(tour('show', clicks));
      expect(nextButton()?.style.display).not.toBe('none');
      player.stop();

      page('<button data-testid="one">One</button>');
      await play(tour('show', [step('one', 'First', { advance_on_click: true, optional: true })]));
      expect(nextButton()?.style.display).not.toBe('none');
      player.stop();

      page('<button data-testid="one">One</button><p data-testid="stuck">Stuck</p>');
      await play(tour('show', [step('one', 'First', { advance_on_click: true, blocked: [{ anchor: 'stuck', body: 'Blocked.' }] })]));
      expect(nextButton()?.style.display).not.toBe('none');
    });
  });

  it('guide: a filled field moves it on, and the same steps in show ignore done_when', async () => {
    page('<label data-testid="name"><input /></label><button data-testid="two">Two</button>');
    const steps = [step('name', 'Name it', { done_when: { kind: 'filled' } }), step('two', 'Second')];
    await play(tour('guide', steps));
    await flush(1000);
    expect(title()).toBe('Name it');
    document.querySelector('input')!.value = 'Anything';
    await flush();
    expect(title()).toBe('Second');
    player.stop();

    page('<label data-testid="name"><input value="Already" /></label><button data-testid="two">Two</button>');
    await play(tour('show', steps));
    await flush(1000);
    expect(title()).toBe('Name it');
    expect(nextButton()?.style.display).not.toBe('none');
  });

  it('a step skipped by only_if isn’t recorded: the move reports the step it lands on, keeping how', async () => {
    page('<button data-testid="one">One</button><button data-testid="three">Three</button>');
    const steps = [step('one', 'First', { done_when: { kind: 'clicked' } }), step('two', 'Skipped', { only_if: 'two' }), step('three', 'Third')];
    await play(tour('guide', steps));
    document.querySelector<HTMLElement>('[data-testid="one"]')!.click();
    await flush(5000);
    expect(title()).toBe('Third');
    expect(moves).toEqual([[2, 'done']]);

    [...card()!.querySelectorAll('button')].find((b) => b.textContent === 'Back')!.click();
    await flush(5000);
    expect(title()).toBe('First');
    expect(moves).toEqual([[2, 'done'], [0, 'back']]);
  });

  it('a done step with only skipped steps after it still counts, on the step it was done on', async () => {
    page('<button data-testid="one">One</button>');
    await play(tour('guide', [step('one', 'First', { done_when: { kind: 'clicked' } }), step('two', 'Skipped', { only_if: 'two' })]));
    document.querySelector<HTMLElement>('[data-testid="one"]')!.click();
    await flush(5000);
    expect(card()).toBeNull();
    expect(moves).toEqual([[0, 'done']]);
    expect(events.at(-1)).toEqual(['completed', 0]);
  });

  it('show: Done on the last step is recorded', async () => {
    page('<button data-testid="one">One</button>');
    await play(tour('show', [step('one', 'Only')]));
    nextButton()!.click();
    await flush();
    expect(moves).toEqual([[0, 'next']]);
    expect(events.at(-1)).toEqual(['completed', 0]);
  });

  it('a phone: the card moves clear of the element when Can’t find it? makes it taller', async () => {
    page('<div role="dialog" aria-modal="true"><button data-testid="go">Go</button></div>');
    const width = window.innerWidth;
    window.innerWidth = 390;
    // A full-screen pop-out with the element high up, so the card sits at the bottom; it is one row taller with the offer on it.
    const original = Element.prototype.getBoundingClientRect;
    const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      if (this.matches('.driver-popover')) return rect(0, 0, 346, this.textContent?.includes('Can’t find it?') ? 230 : 200);
      if (this.matches('[role="dialog"]')) return rect(0, 0, 390, 768);
      return rect(20, 100, 370, 140);
    };
    try {
      await play(tour('guide', [{ ...step('go', 'Tap it'), done_when: { kind: 'clicked' }, help_after: 30 }]));
      const before = Number.parseInt(card()!.style.top, 10);
      await flush(30_000);
      expect(card()!.textContent).toContain('Can’t find it?');
      expect(Number.parseInt(card()!.style.top, 10)).toBeLessThan(before);
      // Its new bottom edge stays on the screen.
      expect(Number.parseInt(card()!.style.top, 10) + 230).toBeLessThanOrEqual(window.innerHeight - 8);
    } finally {
      Element.prototype.getBoundingClientRect = original;
      window.innerWidth = width;
    }
  });

  describe('Learn more', () => {
    const learnButton = () => [...document.querySelectorAll<HTMLButtonElement>('.driver-popover-footer button')].find((b) => b.textContent === 'Learn more');

    it('shows on the last card only, when there is a way to open the article', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      await play({ ...tour('show', [step('one', 'First'), step('two', 'Last')]), learnMore: () => undefined });
      expect(learnButton()).toBeUndefined();
      nextButton()!.click();
      await flush(5000);
      expect(learnButton()).toBeDefined();
      player.stop();
      await play(tour('show', [step('one', 'Only')]));
      expect(learnButton()).toBeUndefined();
    });

    it('finishes the walkthrough, as Done does, and only then opens the article', async () => {
      page('<button data-testid="one">One</button>');
      const seen: (PlayerEvent | undefined)[] = [];
      await play({ ...tour('show', [step('one', 'Only')]), learnMore: () => seen.push(events.at(-1)?.[0]) });
      learnButton()!.click();
      expect(seen).toEqual(['completed']);
      expect(moves).toEqual([[0, 'next']]);
      expect(document.querySelector('.driver-popover')).toBeNull();
    });

    it('a guide step still waiting for the person is a pause, not a finish', async () => {
      page('<button data-testid="one">One</button>');
      const open = vi.fn();
      await play({ ...tour('guide', [{ ...step('one', 'Only'), done_when: { kind: 'clicked' } }]), learnMore: open });
      learnButton()!.click();
      expect(open).toHaveBeenCalledOnce();
      expect(events.at(-1)).toEqual(['paused', 0]);
    });
  });

  it('guide: the last step done finishes the walkthrough', async () => {
    page('<button data-testid="one">One</button>');
    await play(tour('guide', [step('one', 'Only', { done_when: { kind: 'clicked' } })]));
    document.querySelector<HTMLElement>('[data-testid="one"]')!.click();
    await flush();
    expect(card()).toBeNull();
    expect(events.at(-1)).toEqual(['completed', 0]);
    expect(moves).toEqual([[0, 'done']]);
  });

  it('guide: nobody gets stuck: after a while the card offers a way on, and an element that has gone keeps Next', async () => {
    page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
    await play(tour('guide', [step('one', 'First', { done_when: { kind: 'chosen' } }), step('two', 'Second')]));
    [...card()!.querySelectorAll('button')].find((b) => b.textContent === 'Can’t find it?')!.click();
    await flush();
    expect(title()).toBe('Second');
    expect(moves).toEqual([[1, 'skipped']]);
    player.stop();

    await play(tour('guide', [step('gone', 'Gone', { done_when: { kind: 'clicked' } })]));
    expect(title()).toBe('Gone');
    expect(nextButton()?.style.display).not.toBe('none');
  });

  it('guide: "Can’t find it?" waits 3 seconds, or as long as the step says', async () => {
    page('<button data-testid="one">One</button>');
    void player.start(tour('guide', [step('one', 'First', { done_when: { kind: 'chosen' } })]));
    await flush(2000);
    expect(card()!.textContent).not.toContain('Can’t find it?');
    await flush(1500);
    expect(card()!.textContent).toContain('Can’t find it?');
    player.stop();

    await play(tour('guide', [step('one', 'First', { done_when: { kind: 'chosen' }, help_after: 30 })]));
    await flush(20000);
    expect(card()!.textContent).not.toContain('Can’t find it?');
    await flush(6000);
    expect(card()!.textContent).toContain('Can’t find it?');
  });

  it('guide: a switched-off control offers the way on at once, with Next still off', async () => {
    for (const off of ['disabled', 'aria-disabled="true"']) {
      page(`<button data-testid="one" ${off}>One</button>`);
      void player.start(tour('guide', [step('one', 'First', { done_when: { kind: 'clicked' } })]));
      await flush(1);
      expect(card()!.textContent).toContain('Can’t find it?');
      expect(nextButton()?.style.display).toBe('none');
      player.stop();
    }
  });

  it('resuming: picks up at the step, and starts again when that step’s element has gone', async () => {
    page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
    await play(tour('show', [step('one', 'First'), step('two', 'Second')]), 1);
    expect(title()).toBe('Second');
    player.stop();

    await play(tour('show', [step('one', 'First'), step('gone', 'In a closed pop-out', { wait_for: 'person' })]), 1);
    expect(title()).toBe('First');
  });

  it('resuming: a step whose element has gone but whose alternate is there stays, rather than starting again', async () => {
    page('<button data-testid="one">One</button><button data-testid="bar">Bar</button>');
    await play(tour('show', [step('one', 'First'), step('mark-ready', 'Mark ready', { missing: { alt: 'bar', body: 'It sits on this bar.' } })]), 1);
    expect(title()).toBe('Mark ready');
    expect(card()!.querySelector('.driver-popover-description')!.textContent).toBe('It sits on this bar.');
  });

  it('keeps the step’s own words when neither its element nor the alternate is there', async () => {
    page('<button data-testid="one">One</button>');
    await play(tour('show', [step('one', 'First'), step('picker', 'Pick', { body: 'Pick one.', missing: { alt: 'none-on', body: 'Nothing is on yet.' } })]));
    nextButton()!.click();
    await flush(10_000);
    expect(title()).toBe('Pick');
    expect(card()!.querySelector('.driver-popover-description')!.textContent).toBe('Pick one.');
  });

  describe('Back onto a step already done', () => {
    const steps = [step('name', 'Name it', { done_when: { kind: 'filled' } }), step('two', 'Second')];

    it('stays there and offers Next, rather than bouncing forward', async () => {
      page('<label data-testid="name"><input value="Done" /></label><button data-testid="two">Two</button>');
      await play(tour('guide', steps));
      expect(title()).toBe('Second');
      moves.length = 0;
      prevButton()!.click();
      await flush();
      expect(title()).toBe('Name it');
      expect(nextButton()?.style.display).not.toBe('none');
      expect(moves.filter(([, how]) => how === 'done')).toEqual([]);
      nextButton()!.click();
      await flush();
      expect(title()).toBe('Second');
      expect(moves.at(-1)).toEqual([1, 'next']);
    });

    it('a step not done yet still moves on by itself when the person does it', async () => {
      page('<label data-testid="name"><input /></label><button data-testid="two">Two</button>');
      await play(tour('guide', steps));
      document.querySelector('input')!.value = 'x';
      await flush();
      expect(title()).toBe('Second');
      document.querySelector('input')!.value = '';
      prevButton()!.click();
      await flush();
      expect(nextButton()?.style.display).toBe('none');
      document.querySelector('input')!.value = 'y';
      await flush();
      expect(title()).toBe('Second');
    });
  });

  describe('start', () => {
    it('is false when it stopped before showing anything (a page it has no id for)', async () => {
      page('<a data-testid="one"></a>');
      expect(await play(tour('show', [step('one', 'First', { route: '/reports/:reportId' })]))).toBe(false);
      expect(card()).toBeNull();
    });

    it('finishes when the last Do step is a link whose router moves before the player hears the click', async () => {
      let tell: (to: string) => void = () => undefined;
      const seen: string[] = [];
      player = new WalkthroughPlayer({ ...host, onNavigated: (l) => ((tell = l), () => undefined) });
      page('<a data-testid="back"></a>');
      const link = document.querySelector<HTMLElement>('[data-testid="back"]')!;
      link.addEventListener('click', () => tell('/elsewhere'));
      const started = player.start(tour('guide', [step('back', 'Back', { done_when: { kind: 'clicked' } })]), { onEvent: (e) => seen.push(e) });
      await flush();
      await started;
      link.click();
      await flush();
      expect(seen).toEqual(['started', 'completed']);
    });

    it('carries on with the ids the run had, and hands them over when the person leaves', async () => {
      let tell: (to: string) => void = () => undefined;
      const left: [string | undefined, Record<string, string> | undefined][] = [];
      player = new WalkthroughPlayer({ ...host, onNavigated: (l) => ((tell = l), () => undefined) });
      page('<a data-testid="one"></a>');
      const report = tour('show', [step('one', 'First', { route: '/reports/:reportId' })]);
      const started = player.start(report, { startParams: { reportId: 'r1' }, onEvent: (_e, _s, reason, params) => left.push([reason, params]) });
      await flush();
      expect(await started).toBe(true);
      expect(url).toBe('/reports/r1');
      url = '/files';
      tell('/files');
      expect(left.at(-1)).toEqual(['left', { reportId: 'r1' }]);
    });

    it('two starts at once leave one run, and the newest wins', async () => {
      page('<a data-testid="one"></a><a data-testid="two"></a>');
      const first = player.start(tour('show', [step('one', 'First')]));
      const second = player.start(tour('show', [step('two', 'Second')]));
      await flush();
      expect(await Promise.all([first, second])).toEqual([true, true]);
      expect(title()).toBe('Second');
      expect(document.querySelectorAll('[data-flinders-live]')).toHaveLength(1);
    });

    it('stopped by the person before anything showed isn’t a failure', async () => {
      page('<a data-testid="one"></a>');
      const started = player.start(tour('show', [step('one', 'First'), step('later', 'Later', { wait_for: 'person' })]), { startAt: 1 });
      await flush(1);
      player.stop();
      await flush();
      expect(await started).toBe(true);
    });

    it('a pause before anything showed keeps the step to pick up from', async () => {
      page('<a data-testid="one"></a>');
      const started = player.start(tour('show', [step('one', 'First'), step('later', 'Later', { route: '/reports/:reportId' })]), { startAt: 1, onEvent: (e, s) => events.push([e, s]) });
      await flush();
      await started;
      expect(events.at(-1)).toEqual(['paused', 1]);
    });
  });

  describe('blocked', () => {
    const blocked = [{ anchor: 'not-connected', title: 'Connect first', body: 'Connect it.' }];
    const steps = [step('pick', 'Pick', { done_when: { kind: 'chosen' }, blocked }), step('two', 'Second')];

    it('a blocker appearing while the step shows changes the words and brings Next', async () => {
      page('<div data-testid="pick"></div><a data-testid="two"></a>');
      await play(tour('guide', steps));
      expect(title()).toBe('Pick');
      expect(nextButton()?.style.display).toBe('none');
      document.body.insertAdjacentHTML('beforeend', '<div data-testid="not-connected"></div>');
      await flush();
      expect(title()).toBe('Connect first');
      expect(nextButton()?.style.display).not.toBe('none');
    });

    it('goes back to the step’s own words when the blocker goes', async () => {
      page('<div data-testid="pick"></div><div data-testid="not-connected"></div><a data-testid="two"></a>');
      await play(tour('guide', steps));
      expect(title()).toBe('Connect first');
      document.querySelector('[data-testid="not-connected"]')!.remove();
      await flush();
      expect(title()).toBe('Pick');
    });

    it('never waits for the person when something already blocks the step', async () => {
      page('<a data-testid="one"></a><div data-testid="not-connected"></div>');
      await play(tour('guide', [step('one', 'First'), step('later', 'Later', { wait_for: 'person', blocked })]));
      nextButton()!.click();
      await flush();
      expect(title()).toBe('Connect first');
    });
  });

  describe('leaving the page', () => {
    let tell: (to: string) => void;
    const go = (to: string) => {
      url = to;
      tell(to);
    };

    beforeEach(() => {
      player = new WalkthroughPlayer({ ...host, onNavigated: (l) => ((tell = l), () => undefined) });
      page('<a data-testid="one"></a><a data-testid="two"></a>');
    });

    it('pauses on a step with no route, from the last route the run knew', async () => {
      await play(tour('show', [step('one', 'First', { route: '/projects' }), step('two', 'Second')]));
      nextButton()!.click();
      await flush();
      go('/files');
      expect(events.at(-1)).toEqual(['paused', 1]);
      expect(card()).toBeNull();
    });

    it('pauses when no step has a route, from the page it started on', async () => {
      await play(tour('show', [step('one', 'First')]));
      go('/files');
      expect(events.at(-1)?.[0]).toBe('paused');
    });

    it('a changed query isn’t leaving', async () => {
      await play(tour('show', [step('one', 'First', { route: '/projects' }), step('two', 'Second')]));
      nextButton()!.click();
      await flush();
      go('/projects?tab=open');
      expect(title()).toBe('Second');
    });

    it('its own navigation isn’t leaving, and the new page becomes where it is', async () => {
      player = new WalkthroughPlayer({ ...host, navigate: async (to) => (go(to), true), onNavigated: (l) => ((tell = l), () => undefined) });
      await play(tour('show', [step('one', 'First'), step('two', 'Second', { route: '/files' }), step('two', 'Third')]));
      nextButton()!.click();
      await flush();
      expect(title()).toBe('Second');
      nextButton()!.click();
      await flush();
      go('/files?x=1');
      expect(title()).toBe('Third');
      go('/reports');
      expect(card()).toBeNull();
    });
  });

  describe('forks', () => {
    const fork = [
      step('source', 'Choose'),
      step('pick', 'Project', { only_if: 'project-picker' }),
      step('pick', 'Site', { only_if: ['site-picker', 'site-not-connected'] }),
      step('pick', 'File', { only_if: 'file-drop' }),
      step('end', 'Finish'),
    ];
    const screen = (path: string) => page(`<a data-testid="source"></a><div data-testid="pick"><i data-testid="${path}"></i></div><a data-testid="end"></a>`);

    it('shows only the path on screen, and Back skips the others too', async () => {
      screen('file-drop');
      await play(tour('show', fork));
      nextButton()!.click();
      await flush();
      expect(title()).toBe('File');
      card()!.querySelector<HTMLElement>('.driver-popover-prev-btn')!.click();
      await flush();
      expect(title()).toBe('Choose');
    });

    it('Back is off when no step before this one is on screen', async () => {
      screen('file-drop');
      await play(tour('show', [step('pick', 'Project', { only_if: 'project-picker' }), step('pick', 'File', { only_if: 'file-drop' }), step('end', 'Finish')]));
      expect(title()).toBe('File');
      expect(prevButton()?.hasAttribute('disabled')).toBe(true);
      nextButton()!.click();
      await flush();
      expect(prevButton()?.hasAttribute('disabled')).toBe(false);
    });

    it('a Back with nowhere to go stays on the step, and the walkthrough keeps going', async () => {
      screen('file-drop');
      await play(tour('show', [step('pick', 'Project', { only_if: 'project-picker' }), step('end', 'Finish')]));
      expect(title()).toBe('Finish');
      player.back();
      await flush();
      expect(title()).toBe('Finish');
      expect(events.map(([e]) => e)).toEqual(['started']);
    });

    it('any one of a list of elements is enough', async () => {
      screen('site-not-connected');
      await play(tour('show', fork));
      nextButton()!.click();
      await flush();
      expect(title()).toBe('Site');
    });

    it('waits for an element the last step has just opened', async () => {
      screen('nothing-yet');
      await play(tour('show', fork));
      nextButton()!.click();
      await flush(200);
      document.querySelector('[data-testid="pick"]')!.innerHTML = '<i data-testid="project-picker"></i>';
      await flush();
      expect(title()).toBe('Project');
    });

    it('waits for the page once, however many steps it skips', async () => {
      screen('nothing-yet');
      await play(tour('show', fork));
      nextButton()!.click();
      await flush(600);
      expect(title()).toBe('Finish');
    });

    it('a fork last in the walkthrough, with nothing on screen, finishes it', async () => {
      screen('nothing-yet');
      await play(tour('show', [step('source', 'Choose'), step('pick', 'Project', { only_if: 'project-picker' })]));
      nextButton()!.click();
      await flush();
      expect(card()).toBeNull();
      expect(events.at(-1)?.[0]).toBe('completed');
    });

    it('resuming on a fork whose pop-out has closed starts again', async () => {
      screen('nothing-yet');
      await play(tour('show', fork), 1);
      expect(title()).toBe('Choose');
    });

    describe('a path of several steps', () => {
      const long = [
        step('choice', 'Choose'),
        step('a1', 'A one', { only_if: 'a1' }),
        step('a2', 'A two', { only_if: 'a1', route: '/projects/:id' }),
        step('a3', 'A three', { only_if: 'a1' }),
        step('b1', 'B one', { only_if: 'b1' }),
        step('b2', 'B two', { only_if: 'b1', route: '/elsewhere' }),
        step('end', 'Finish'),
      ];
      const progress = () => card()!.querySelector('.driver-popover-progress-text')?.textContent;
      const next = async () => {
        nextButton()!.click();
        await flush();
      };
      const back = async () => {
        prevButton()!.click();
        await flush();
      };

      it('plays on though its first element has gone, numbering each step, then leaves the other path alone', async () => {
        url = '/projects/7';
        page('<a data-testid="choice"></a><a data-testid="a1"></a><a data-testid="b1"></a><a data-testid="a3"></a><a data-testid="end"></a>');
        await play(tour('show', long));
        await next();
        expect([title(), progress()]).toEqual(['A one', '2 of 5']);
        document.querySelector('[data-testid="a1"]')!.remove();
        await next();
        expect(title()).toBe('A two');
        await next();
        expect([title(), progress()]).toEqual(['A three', '4 of 5']);
        await next();
        // B's first element is on screen too, but a fork plays one path, and B's page is never visited.
        expect([title(), progress()]).toEqual(['Finish', '5 of 5']);
        expect(url).toBe('/projects/7');
      });

      it('a path that doesn’t apply is passed whole, without going to its pages', async () => {
        page('<a data-testid="choice"></a><a data-testid="b1"></a><a data-testid="b2"></a><a data-testid="end"></a>');
        await play(tour('show', long));
        await next();
        expect([title(), progress(), url]).toEqual(['B one', '2 of 5', '/projects']);
        await next();
        expect([title(), progress(), url]).toEqual(['B two', '3 of 5', '/elsewhere']);
      });

      it('Back from after the fork returns along the path taken, and past it can choose again', async () => {
        url = '/projects/7';
        page('<a data-testid="choice"></a><a data-testid="a1"></a><a data-testid="a2"></a><a data-testid="a3"></a><a data-testid="end"></a>');
        await play(tour('show', long));
        await next();
        await next();
        await next();
        document.querySelector('[data-testid="a1"]')!.remove();
        await next();
        expect(title()).toBe('Finish');
        await back();
        expect(title()).toBe('A three');
        await back();
        expect(title()).toBe('A two');
        await back();
        expect(title()).toBe('A one');
        await back();
        expect(title()).toBe('Choose');
        document.querySelector('[data-testid="end"]')!.insertAdjacentHTML('beforebegin', '<a data-testid="b1"></a>');
        await next();
        expect(title()).toBe('B one');
      });

      it('resumes part-way along a path whose first element has gone', async () => {
        url = '/projects/7';
        page('<a data-testid="a2"></a><a data-testid="a3"></a>');
        await play(tour('show', long), 2);
        expect(title()).toBe('A two');
      });

      it('walkthrough 5’s shape is unchanged: each path one step, one number', () => {
        expect([0, 1, 2, 3, 4].map((i) => stepPlace(fork, i))).toEqual([1, 2, 2, 2, 3].map((n) => ({ step: n, total: 3 })));
      });
    });

    it('counts a fork once on the card', async () => {
      screen('file-drop');
      await play(tour('show', fork));
      expect(card()!.querySelector('.driver-popover-progress-text')?.textContent).toBe('1 of 3');
      nextButton()!.click();
      await flush();
      expect(card()!.querySelector('.driver-popover-progress-text')?.textContent).toBe('2 of 3');
      nextButton()!.click();
      await flush();
      expect(card()!.querySelector('.driver-popover-progress-text')?.textContent).toBe('3 of 3');
    });

    it('stepPlace: a run of forks is one place; a step without only_if between them splits the run', () => {
      expect([0, 1, 2, 3, 4].map((i) => stepPlace(fork, i).step)).toEqual([1, 2, 2, 2, 3]);
      expect(stepPlace(fork, 0).total).toBe(3);
      expect(stepPlace([step('a', 'A', { only_if: 'a' }), step('b', 'B'), step('c', 'C', { only_if: 'c' })], 2)).toEqual({ step: 3, total: 3 });
    });

    it('stepPlace: a fork counts as its longest path, so a step on a short path jumps to what follows', () => {
      const steps = [step('c', 'C'), step('a', 'A', { only_if: 'a' }), step('a', 'A', { only_if: 'a' }), step('a', 'A', { only_if: ['a'] }), step('b', 'B', { only_if: 'b' }), step('d', 'D')];
      expect(steps.map((_, i) => stepPlace(steps, i).step)).toEqual([1, 2, 3, 4, 2, 5]);
      expect(stepPlace(steps, 0).total).toBe(5);
    });

    it('stepPlace: a step a phone skips counts only on a computer', () => {
      const steps = [step('a', 'A', { phone: 'skip' }), step('b', 'B'), step('c', 'C', { phone: 'skip' }), step('d', 'D')];
      expect(stepPlace(steps, 3)).toEqual({ step: 4, total: 4 });
      expect(stepPlace(steps, 1, true)).toEqual({ step: 1, total: 2 });
      expect(stepPlace(steps, 3, true)).toEqual({ step: 2, total: 2 });
    });

    it('stepPlace: forks either side of a skipped step are still one place', () => {
      const steps = [step('a', 'A', { only_if: 'a' }), step('b', 'B', { phone: 'skip' }), step('c', 'C', { only_if: 'c' })];
      expect(stepPlace(steps, 2)).toEqual({ step: 3, total: 3 });
      expect(stepPlace(steps, 2, true)).toEqual({ step: 1, total: 1 });
    });

    it('on a phone the card counts only the steps shown', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query })) as unknown as typeof window.matchMedia;
      await play(tour('show', [step('one', 'First'), step('skipped', 'Skipped', { phone: 'skip' }), step('two', 'Last')]));
      expect(card()!.querySelector('.driver-popover-progress-text')?.textContent).toBe('1 of 2');
      nextButton()!.click();
      await flush();
      expect(title()).toBe('Last');
      expect(card()!.querySelector('.driver-popover-progress-text')?.textContent).toBe('2 of 2');
    });

    it('on a phone, a card with only phone-skipped steps after it says Done, and Done finishes', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query })) as unknown as typeof window.matchMedia;
      await play(tour('show', [step('one', 'First'), step('two', 'Skipped', { phone: 'skip' }), step('two', 'Skipped too', { phone: 'skip' })]));
      expect(nextButton()?.textContent).toBe('Done');
      nextButton()!.click();
      await flush();
      expect(card()).toBeNull();
      expect(events.at(-1)?.[0]).toBe('completed');
    });

    it('on a computer, the same steps are still to come', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      await play(tour('show', [step('one', 'First'), step('two', 'Second', { phone: 'skip' })]));
      expect(nextButton()?.textContent).toBe('Next');
    });

    it('a card with only the fork’s other paths after it says Done', async () => {
      page('<a data-testid="empty"></a>');
      await play(tour('show', [step('empty', 'Nothing waiting', { only_if: 'empty' }), step('grid', 'Waiting', { only_if: 'grid' }), step('grid', 'Open one', { only_if: 'grid' })]));
      expect(title()).toBe('Nothing waiting');
      expect(nextButton()?.textContent).toBe('Done');
      nextButton()!.click();
      await flush();
      expect(card()).toBeNull();
      expect(events.at(-1)?.[0]).toBe('completed');
    });

    it('the last step of one path, with steps after the fork, stays Next', async () => {
      page('<a data-testid="a"></a><a data-testid="end"></a>');
      await play(tour('show', [step('a', 'A', { only_if: 'a' }), step('b', 'B', { only_if: 'b' }), step('end', 'Finish')]));
      expect(title()).toBe('A');
      expect(nextButton()?.textContent).toBe('Next');
    });

    it('a fork not reached yet stays Next: it may still show when the person gets there', async () => {
      page('<a data-testid="source"></a>');
      await play(tour('show', [step('source', 'Choose'), step('later', 'Later', { only_if: 'later' })]));
      expect(nextButton()?.textContent).toBe('Next');
    });
  });
});

describe('matching a product’s design', () => {
  const steps = [step('one', 'First'), step('two', 'Second')];
  const tour: PlayableWalkthrough = { id: 'w1', version: 1, title: 'Add a project', steps };
  const base: PlayerHost = { url: () => '/', navigate: async () => true, onNavigated: () => () => undefined };

  beforeEach(() => {
    vi.useFakeTimers();
    page('<a data-tour="one">One</a><a data-tour="two">Two</a>');
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('level 2: adds the product’s classes, drops ours when unstyled, and finds elements by its own attribute', async () => {
    const player = new WalkthroughPlayer({ ...base, unstyled: true, anchorAttribute: 'data-tour', classes: { card: 'panel shadow', primary: 'btn btn-primary' } });
    void player.start(tour);
    await flush();
    const c = card()!;
    expect(c.classList).toContain('panel');
    expect(c.classList).not.toContain('flinders-card');
    expect(nextButton()!.classList).toContain('btn-primary');
    expect(document.querySelector('.driver-active-element')?.getAttribute('data-tour')).toBe('one');
    player.stop();
  });

  it('level 3: the product draws the card from plain data, and its buttons drive the walkthrough', async () => {
    const drawn: PlayerCard[] = [];
    const player = new WalkthroughPlayer({
      ...base,
      anchorAttribute: 'data-tour',
      labels: { progress: (s, t) => `${s} / ${t}` },
      renderCard: (box, data) => {
        drawn.push(data);
        box.innerHTML = '<h1 id="mine">' + data.title + '</h1>';
      },
    });
    void player.start(tour);
    await flush();
    expect(document.getElementById('mine')?.textContent).toBe('First');
    expect(drawn[0]).toMatchObject({ step: 1, total: 2, progress: '1 / 2', canGoBack: false, showNext: true, nextLabel: 'Next' });
    drawn[0]!.next();
    await flush();
    expect(document.getElementById('mine')?.textContent).toBe('Second');
    expect(drawn.at(-1)).toMatchObject({ canGoBack: true, nextLabel: 'Done' });
    drawn.at(-1)!.finishLater();
    expect(card()).toBeNull();
  });
});

describe('WalkthroughPlayer, a guide that can’t go on or has been left', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('offers the way on at once on a switched-off control, even while the card is still moving', async () => {
    page('<button data-testid="a"></button><button data-testid="b" aria-disabled="true"></button>');
    const player = new WalkthroughPlayer({ url: () => '/', navigate: async () => true, onNavigated: () => () => undefined });
    await player.start({ id: 't', version: 1, title: 'T', mode: 'guide', steps: [step('a', 'One'), step('b', 'Two', { done_when: { kind: 'clicked' } })] });
    await flush(1000);
    player.next();
    await flush(1000);
    expect(title()).toBe('Two');
    expect(card()?.querySelector('.flinders-link')?.textContent).toBe('Can’t find it?');
    player.stop();
  });

  it('pauses when a button in a step with no route of its own leads off the page', async () => {
    page('<button data-testid="a"></button><button data-testid="b"></button>');
    let url = '/reports';
    let navigated: (to: string) => void = () => undefined;
    const events: [PlayerEvent, number][] = [];
    const player = new WalkthroughPlayer({
      url: () => url,
      navigate: async () => true,
      onNavigated: (listener) => {
        navigated = listener;
        return () => undefined;
      },
    });
    await player.start(
      { id: 't', version: 1, title: 'T', steps: [step('a', 'One', { route: '/reports' }), step('b', 'Two'), step('b', 'Three')] },
      { onEvent: (e, s) => events.push([e, s]) },
    );
    await flush(1000);
    player.next();
    await flush(1000);
    // Still on the page: nothing happens.
    navigated('/reports?panel=x');
    expect(title()).toBe('Two');
    document.querySelector('[data-testid="b"]')!.remove();
    url = '/settings/integrations';
    navigated(url);
    expect(events.at(-1)).toEqual(['paused', 1]);
    expect(card()).toBeNull();
  });
});

describe('dockClearOfControls', () => {
  const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
  // A 700 by 600 window, a pop-out nearly filling it, and a 320 by 180 card.
  const layout = (over: Partial<DockLayout>): DockLayout => ({
    card: { width: 320, height: 180 },
    element: rect(100, 300, 300, 340),
    panel: rect(20, 20, 680, 580),
    controls: [],
    head: rect(20, 20, 680, 64),
    foot: rect(20, 524, 680, 580),
    viewport: { width: 700, height: 600 },
    ...over,
  });
  const cardBox = (l: DockLayout, at: { left: number; top: number }) => rect(at.left, at.top, at.left + l.card.width, at.top + l.card.height);

  it('goes outside the pop-out when there is room, as before', () => {
    const above = layout({ panel: rect(20, 240, 680, 580), head: rect(20, 240, 680, 280), element: rect(100, 400, 300, 440) });
    expect(dockClearOfControls(above)).toMatchObject({ spot: 'above', top: 48 });
    const below = layout({ panel: rect(20, 20, 680, 360), foot: rect(20, 320, 680, 360), element: rect(100, 100, 300, 140) });
    expect(dockClearOfControls(below)).toMatchObject({ spot: 'below', top: 372 });
  });

  it('with no room outside, an element high up sends the card to the bottom end, above the action bar', () => {
    const l = layout({ element: rect(100, 100, 300, 140) });
    expect(dockClearOfControls(l)).toMatchObject({ spot: 'inside-bottom', top: 336 });
  });

  it('never covers the element, even when that means covering more controls', () => {
    const l = layout({ element: rect(100, 240, 300, 280), controls: [rect(40, 70, 300, 110), rect(320, 70, 660, 110), rect(40, 480, 660, 510)] });
    const spot = dockClearOfControls(l);
    expect(overlapArea(cardBox(l, spot), l.element)).toBe(0);
  });

  it('keeps off the button a card would otherwise hide', () => {
    // Inside the bottom would be first, but a button sits there; the top end is free.
    const button = rect(200, 380, 500, 420);
    const l = layout({ element: rect(100, 280, 300, 310), controls: [button] });
    const spot = dockClearOfControls(l);
    expect(spot.spot).toBe('inside-top');
    expect(overlapArea(cardBox(l, spot), button)).toBe(0);
  });

  it('counts a control lost whole above the edge of a wide field', () => {
    const button = rect(300, 350, 360, 380);
    const field = rect(40, 70, 660, 240);
    const l = layout({ element: rect(100, 260, 300, 290), controls: [button, field] });
    expect(dockClearOfControls(l).spot).toBe('inside-top');
  });

  it('slides right up against the element when both ends of the pop-out would cover it', () => {
    // A short window with a deep action bar: each end of the pop-out's body reaches the element.
    const l = layout({ viewport: { width: 700, height: 460 }, panel: rect(20, 10, 680, 450), head: rect(20, 10, 680, 40), foot: rect(20, 350, 680, 450), element: rect(100, 150, 300, 190) });
    const spot = dockClearOfControls(l);
    expect(spot.spot).toBe('below-element');
    expect(overlapArea(cardBox(l, spot), l.element)).toBe(0);
  });

  it('stays in the window, and is centred on the pop-out where it fits', () => {
    expect(dockClearOfControls(layout({})).left).toBe(190);
    const wide = dockClearOfControls(layout({ card: { width: 680, height: 180 }, viewport: { width: 400, height: 600 } }));
    expect(wide.left).toBe(8);
  });
});

describe('the leader line', () => {
  const card: Rect = { left: 100, top: 100, right: 300, bottom: 200 };

  it('runs from the card’s nearest edge to the element’s', () => {
    expect(leaderEnds(card, { left: 150, top: 300, right: 250, bottom: 340 })).toEqual({ x1: 200, y1: 200, x2: 200, y2: 300 });
    expect(leaderEnds(card, { left: 400, top: 130, right: 440, bottom: 170 })).toEqual({ x1: 300, y1: 150, x2: 400, y2: 150 });
  });

  it('has nothing to do when the card reaches the element', () => {
    expect(leaderEnds(card, { left: 250, top: 150, right: 350, bottom: 190 })).toBeNull();
  });

  it('draws under the card', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'player.css'), 'utf8');
    const level = (selector: string) => Number(new RegExp(`${selector} \\{[^}]*?z-index: (\\d+)`).exec(css)?.[1]);
    expect(level('\\.flinders-leader')).toBeLessThan(level('\\.driver-popover\\.flinders-card'));
  });
});

describe('doneWhenMet', () => {
  it('doesn’t take a dropdown’s search words for a choice', () => {
    page('<div id="f"><input type="search" value="River" /><button data-has-value="false"></button></div>');
    expect(doneWhenMet({ kind: 'chosen' }, document.getElementById('f'), '/')).toBe(false);
  });

  it('reads whether a field has a value, a picker’s marker, an element or a page', () => {
    page('<div id="f"><input value="x" /></div><div id="p"><button data-has-value="true"></button></div><div id="e"></div><i data-testid="shown"></i>');
    const at = (id: string) => document.getElementById(id);
    expect(doneWhenMet({ kind: 'filled' }, at('f'), '/')).toBe(true);
    expect(doneWhenMet({ kind: 'chosen' }, at('p'), '/')).toBe(true);
    expect(doneWhenMet({ kind: 'filled' }, at('e'), '/')).toBe(false);
    expect(doneWhenMet({ kind: 'filled' }, null, '/')).toBe(false);
    expect(doneWhenMet({ kind: 'appears', anchor: 'shown' }, null, '/')).toBe(true);
    expect(doneWhenMet({ kind: 'appears', anchor: 'nope' }, null, '/')).toBe(false);
    expect(doneWhenMet({ kind: 'route', route: '/projects/:id' }, null, '/projects/1')).toBe(true);
    expect(doneWhenMet({ kind: 'route', route: '/projects/:id' }, null, '/other')).toBe(false);
  });
});

describe('WalkthroughPlayer, fixes from the TabLogs rollout', () => {
  let moves: [number, StepHow][];
  let events: [PlayerEvent, number][];
  let player: WalkthroughPlayer;
  const make = (extra: Partial<PlayerHost> = {}) => new WalkthroughPlayer({ url: () => '/', navigate: async () => true, onNavigated: () => () => undefined, ...extra });
  const tour = (mode: 'show' | 'guide', steps: PlayableWalkthrough['steps']): PlayableWalkthrough => ({ id: 'w1', version: 1, title: 'T', mode, steps });
  const play = (t: PlayableWalkthrough) => player.start(t, { onStep: (s, how) => moves.push([s, how]), onEvent: (e, s) => events.push([e, s]) });
  const buttons = () => [...card()!.querySelectorAll<HTMLButtonElement>('button')];
  const button = (text: string) => buttons().find((b) => b.textContent === text);
  const description = () => card()?.querySelector('.driver-popover-description')?.textContent;
  const active = (name: string) => document.querySelector(`[data-testid="${name}"]`)!.classList.contains('driver-active-element');

  beforeEach(() => {
    vi.useFakeTimers();
    moves = [];
    events = [];
  });
  afterEach(() => {
    player?.stop();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('"Can’t find it?"', () => {
    it('cantFind: false never offers it: not after any wait, not on a switched-off control, not after the step is drawn again', async () => {
      page('<button data-testid="one">One</button><button data-testid="off" disabled>Off</button>');
      player = make({ cantFind: false });
      void play(tour('guide', [step('one', 'First', { done_when: { kind: 'chosen' } })]));
      await flush(30_000);
      expect(title()).toBe('First');
      expect(button('Can’t find it?')).toBeUndefined();
      player.stop();

      // A blocker coming and going draws the step again.
      void play(tour('guide', [step('off', 'Off', { done_when: { kind: 'clicked' }, blocked: [{ anchor: 'stuck', body: 'Blocked.' }] })]));
      await flush(1000);
      document.body.insertAdjacentHTML('beforeend', '<p data-testid="stuck">Stuck</p>');
      await flush(1000);
      expect(description()).toBe('Blocked.');
      document.querySelector('[data-testid="stuck"]')!.remove();
      await flush(10_000);
      expect(title()).toBe('Off');
      expect(card()!.querySelector('[data-flinders-cant-find]')).toBeNull();
    });

    it('by default it still skips, and is on the card once', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      player = make();
      void play(tour('guide', [step('one', 'First', { done_when: { kind: 'chosen' } }), step('two', 'Second')]));
      await flush(10_000);
      expect(card()!.querySelectorAll('[data-flinders-cant-find]')).toHaveLength(1);
      button('Can’t find it?')!.click();
      await flush();
      expect(title()).toBe('Second');
      expect(moves).toEqual([[1, 'skipped']]);
    });

    it('cantFind: help says what’s missing, with the step’s own words, and skips only on Skip this step', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      player = make({ cantFind: 'help' });
      void play(tour('guide', [step('one', 'Pick a colour', { done_when: { kind: 'chosen' }, missing: { body: 'It’s under **Settings**.' } }), step('two', 'Second')]));
      await flush(5000);
      button('Can’t find it?')!.click();
      await flush(100);
      expect(title()).toBe('Pick a colour');
      expect(description()).toBe('We can’t see “Pick a colour” on this page. It’s under Settings.');
      expect(button('Can’t find it?')).toBeUndefined();
      expect(moves).toEqual([]);
      button('Skip this step')!.click();
      await flush();
      expect(title()).toBe('Second');
      expect(moves).toEqual([[1, 'skipped']]);
    });
  });

  describe('a card drawn without its element', () => {
    const steps = [step('one', 'First'), step('late', 'Second'), step('three', 'Third')];

    it('points at the element as soon as it appears', async () => {
      page('<button data-testid="one">One</button><button data-testid="three">Three</button>');
      player = make();
      void play(tour('show', steps));
      await flush();
      nextButton()!.click();
      await flush(5000);
      expect(title()).toBe('Second');
      expect(document.querySelector('[data-testid].driver-active-element')).toBeNull();
      document.body.insertAdjacentHTML('beforeend', '<button data-testid="late">Late</button>');
      await flush(1000);
      expect(title()).toBe('Second');
      expect(active('late')).toBe(true);
      // Drawn again, it isn't a move: nothing more is recorded.
      expect(moves).toEqual([[1, 'next']]);
    });

    it('stops looking once the run has moved on, and lateElements: false keeps the old way', async () => {
      page('<button data-testid="one">One</button><button data-testid="three">Three</button>');
      player = make();
      void play(tour('show', steps));
      await flush();
      nextButton()!.click();
      await flush(5000);
      nextButton()!.click();
      await flush(1000);
      expect(title()).toBe('Third');
      document.body.insertAdjacentHTML('beforeend', '<button data-testid="late">Late</button>');
      await flush(1000);
      expect(title()).toBe('Third');
      player.stop();

      page('<button data-testid="one">One</button><button data-testid="three">Three</button>');
      player = make({ lateElements: false });
      void play(tour('show', steps));
      await flush();
      nextButton()!.click();
      await flush(5000);
      document.body.insertAdjacentHTML('beforeend', '<button data-testid="late">Late</button>');
      await flush(1000);
      expect(title()).toBe('Second');
      expect(active('late')).toBe(false);
    });

    it('says "Looking for …" while it waits, and a second Next can’t skip the step', async () => {
      page('<button data-testid="one">One</button><button data-testid="three">Three</button>');
      player = make();
      void play(tour('show', steps));
      await flush();
      nextButton()!.click();
      await flush(50);
      expect(title()).toBe('First');
      expect(card()!.querySelector('[data-flinders-looking]')?.textContent).toBe('Looking for “Second”…');
      expect(nextButton()).toHaveProperty('disabled', true);
      expect(prevButton()).toHaveProperty('disabled', true);
      nextButton()!.click();
      player.next(); // a product's own card: its Next goes to the same place, never past it
      await flush(5000);
      expect(title()).toBe('Second');
      expect(card()!.querySelector('[data-flinders-looking]')).toBeNull();
    });

    it('no note when nothing is waited for, or with lookingNote: false', async () => {
      page('<button data-testid="one">One</button><button data-testid="two">Two</button>');
      player = make();
      void play(tour('show', [step('one', 'First'), step('two', 'Second'), step('late', 'Third')]));
      await flush();
      nextButton()!.click();
      expect(card()!.querySelector('[data-flinders-looking]')).toBeNull();
      await flush();
      player.stop();

      player = make({ lookingNote: false });
      void play(tour('show', [step('one', 'First'), step('late', 'Second')]));
      await flush();
      nextButton()!.click();
      await flush(50);
      expect(card()!.querySelector('[data-flinders-looking]')).toBeNull();
      expect(nextButton()).toHaveProperty('disabled', false);
    });
  });

  it('lookAlike: a numbered anchor that isn’t there falls back to one with the same base name', async () => {
    page('<button data-testid="row-1">Row 1</button>');
    player = make();
    void play(tour('show', [step('row-3', 'A row')]));
    await flush(5000);
    expect(active('row-1')).toBe(false);
    player.stop();

    player = make({ lookAlike: true });
    void play(tour('show', [step('row-3', 'A row')]));
    await flush(5000);
    expect(active('row-1')).toBe(true);
  });

  it('settle: a new card waits, hidden, until its element stops moving, at most 3 s', async () => {
    page('<button data-testid="one">One</button>');
    const original = Element.prototype.getBoundingClientRect;
    const start = Date.now();
    let movingFor = 1000;
    Element.prototype.getBoundingClientRect = function () {
      const top = Date.now() - start < movingFor ? (Date.now() - start) % 97 : 10;
      return { width: 100, height: 30, top, left: 10, right: 110, bottom: top + 30, x: 10, y: top, toJSON: () => ({}) } as DOMRect;
    };
    try {
      player = make({ settle: true });
      void play(tour('show', [step('one', 'First')]));
      await flush(800);
      expect(card()).toBeNull();
      await flush(800);
      expect(title()).toBe('First');
      player.stop();

      movingFor = Infinity;
      void play(tour('show', [step('one', 'First')]));
      await flush(2500);
      expect(card()).toBeNull();
      await flush(800);
      expect(title()).toBe('First');
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it('is busy from the moment start() is called, and says so before the first page opens', async () => {
    page('<button data-testid="one">One</button>');
    const started: string[] = [];
    let opened: (ok: boolean) => void = () => undefined;
    player = make({ navigate: () => new Promise((resolve) => (opened = resolve)), onStart: (w) => started.push(w.id) });
    expect(player.busy).toBe(false);
    const done = play(tour('show', [{ ...step('one', 'First'), route: '/elsewhere' }]));
    expect(player.busy).toBe(true);
    expect(started).toEqual(['w1']);
    await flush(1000);
    expect(card()).toBeNull();
    expect(player.busy).toBe(true);
    opened(false);
    expect(await done).toBe(false);
    expect(player.busy).toBe(false);

    // A card on the spot isn't a walkthrough starting.
    void player.showMe('one');
    await flush(1000);
    expect(started).toEqual(['w1']);
  });
});

// A report-template walkthrough (/templates/:templateId/*) started on a Company style page must not
// fill :templateId with the reserved "company-style" segment and navigate to a broken template URL.
// The primitives below show the mechanism without reserving; the player test shows the fix in effect.
describe('reserved route params', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('without reserving, the step route is built from the Company style URL (the bug)', () => {
    const url = '/templates/company-style/versions';
    expect(paramsFromUrl('/templates/:templateId/sections', url)).toEqual({ templateId: 'company-style' });
    expect(buildRoute('/templates/:templateId/sections', paramsFromUrl('/templates/:templateId/sections', url))).toBe('/templates/company-style/sections');
  });

  it('with company-style reserved, the player never navigates to the broken template URL', async () => {
    let url = '/templates/company-style/versions';
    const navigations: string[] = [];
    const player = new WalkthroughPlayer({
      url: () => url,
      navigate: async (to) => {
        navigations.push(to);
        url = to;
        return true;
      },
      onNavigated: () => () => undefined,
      reservedParams: { templateId: ['company-style'] },
    });
    // The step's anchor isn't on the Company style page, so the player would try to navigate to find it.
    page('<main>Company style version history</main>');
    const started = player.start({ id: 'w4', version: 1, title: 'Report templates', mode: 'show', steps: [step('template-sections', 'How a section is built', { route: '/templates/:templateId/sections' })] });
    await vi.advanceTimersByTimeAsync(5000);
    expect(await started).toBe(false);
    expect(navigations).not.toContain('/templates/company-style/sections');
    expect(url).toBe('/templates/company-style/versions');
    player.stop();
  });
});
