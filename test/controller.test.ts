import { describe, expect, it, vi } from 'vitest';

import { WalkthroughController, WALKTHROUGH_LABELS, type OfferAnswer, type PersonWalkthroughs, type ServedWalkthrough, type WalkthroughOffer, type WalkthroughProgress } from '../src/index.js';

const STEPS = [{ anchor: null, title: 'Start', body: 'Every note starts here.', missing: 'centred' as const }];
const tick = () => new Promise((r) => setTimeout(r));

const show = (over: Partial<ServedWalkthrough> = {}): ServedWalkthrough => ({
  walkthrough_id: '0192f3a1-0000-7000-8000-000000000001',
  number: 1,
  slug: 'show',
  version: 2,
  title: 'Show',
  mode: 'show',
  permission: null,
  offer_on: '/notes',
  reoffer_from: 1,
  article_slug: null,
  steps: STEPS,
  ...over,
});
const guide = (over: Partial<ServedWalkthrough> = {}) => show({ walkthrough_id: '0192f3a1-0000-7000-8000-000000000002', number: 5, slug: 'guide', title: 'Guide', mode: 'guide', ...over });

function setup(opts: { list?: ServedWalkthrough[]; progress?: PersonWalkthroughs['progress']; progressAfter?: PersonWalkthroughs['progress']; started?: boolean; can?: boolean; paused?: boolean; offers?: boolean; learnMore?: (slug: string) => void; reofferUnfinished?: boolean; startFromHere?: boolean } = {}) {
  const mine = { offer_walkthroughs: opts.offers ?? true, progress: opts.progress ?? {} };
  const offered: { offer: WalkthroughOffer; answer: (a: OfferAnswer) => void }[] = [];
  const events: [string, string, string | undefined][] = [];
  const play = vi.fn().mockResolvedValue(opts.started ?? true);
  const toast = vi.fn();
  const clearOffer = vi.fn(() => {
    offered.shift()?.answer(null);
  });
  const list = vi.fn(async () => opts.list ?? [show()]);
  const controller = new WalkthroughController({
    api: {
      list,
      mine: async () => mine,
      setOffers: async (on) => ({ ...mine, offer_walkthroughs: on }),
      record: async (id, e) => {
        events.push([id, e.event, e.from]);
        return { ...mine, progress: opts.progressAfter ?? mine.progress };
      },
    },
    can: () => opts.can ?? true,
    play,
    showOffer: (offer) => new Promise((answer) => offered.push({ offer, answer })),
    clearOffer,
    toast,
    offersPaused: () => opts.paused ?? false,
    learnMore: opts.learnMore,
    reofferUnfinished: opts.reofferUnfinished,
    startFromHere: opts.startFromHere,
  });
  const dismissed = () => events.filter((e) => e[1] === 'dismissed').map((e) => e[0]);
  return { controller, offered, events, play, toast, clearOffer, list, dismissed };
}

describe('a page opened while the list loads', () => {
  it('still gets its offer, from one load, and the page they left gets none', async () => {
    const s = setup();
    void s.controller.offerFor('/elsewhere');
    void s.controller.offerFor('/notes');
    await tick();
    await tick();
    expect(s.offered.map((o) => o.offer.title)).toEqual(['Show']);
    expect(s.list).toHaveBeenCalledTimes(1);
  });

  it('offers nothing for a page they have already left', async () => {
    const s = setup();
    void s.controller.offerFor('/notes');
    void s.controller.offerFor('/elsewhere');
    await tick();
    await tick();
    expect(s.offered).toEqual([]);
  });
});

describe('loading', () => {
  it('a failed load leaves walkthroughs off, and asking loads again', async () => {
    let up = false;
    const s = setup();
    s.list.mockImplementation(async () => {
      if (!up) throw new Error('away');
      return [show()];
    });
    await s.controller.load();
    expect(s.controller.view.state).toBe('error');
    up = true;
    expect(await s.controller.start('1-show', 'chat')).toBe(true);
    expect(s.play).toHaveBeenCalledOnce();
  });

  it('the view says offers are on until the person says otherwise', async () => {
    const s = setup({ offers: false });
    expect(s.controller.view.offers).toBe(true);
    await s.controller.load();
    expect(s.controller.view.offers).toBe(false);
    expect(s.controller.view.mineState).toBe('loaded');
  });
});

describe('Learn more', () => {
  const played = (s: ReturnType<typeof setup>) => s.play.mock.calls[0]![0] as { learnMore?: () => void };

  it('comes from the host, with the article, only for a walkthrough that has one', async () => {
    const opened: string[] = [];
    const s = setup({ list: [show({ article_slug: 'adding-a-note' })], learnMore: (slug) => opened.push(slug) });
    await s.controller.start('1-show', 'chat');
    played(s).learnMore?.();
    expect(opened).toEqual(['adding-a-note']);
  });

  it('hands the player its article hints, with the single article last', async () => {
    const s = setup({ list: [show({ article_slug: 'adding-a-note', articles: ['first', 'second'] })] });
    await s.controller.start('1-show', 'chat');
    expect((s.play.mock.calls[0]![0] as { articles?: string[] }).articles).toEqual(['first', 'second', 'adding-a-note']);
  });

  it('is left out with no article, and when the host has nowhere to open one', async () => {
    const none = setup({ learnMore: () => undefined });
    await none.controller.start('1-show', 'chat');
    expect(played(none).learnMore).toBeUndefined();
    const noHost = setup({ list: [show({ article_slug: 'adding-a-note' })] });
    await noHost.controller.start('1-show', 'chat');
    expect(played(noHost).learnMore).toBeUndefined();
  });
});

describe('starting', () => {
  it('says so when it could not start, rather than nothing happening', async () => {
    const s = setup({ started: false });
    await s.controller.preview({ id: 'x', version: 1, title: 'T', steps: STEPS });
    expect(s.toast).toHaveBeenCalledWith(WALKTHROUGH_LABELS.couldNotStart);
  });

  it('starts from what is on screen, even when told to start over, unless the product turns it off', async () => {
    const s = setup();
    await s.controller.start('1', 'list');
    await s.controller.start('1', 'chat', { fromStart: true });
    expect(s.play.mock.calls.map((c) => c[1].fromHere)).toEqual([true, true]);

    const off = setup({ startFromHere: false });
    await off.controller.start('1', 'list');
    expect(off.play.mock.calls[0]![1].fromHere).toBeUndefined();
  });

  it('picks up a paused walkthrough where it stopped, unless told to start over', async () => {
    const s = setup({ progress: { [show().walkthrough_id]: { v: 2, status: 'paused', step: 3, at: '' } } });
    await s.controller.start('1', 'list');
    expect(s.play.mock.calls[0]![1]).toMatchObject({ startAt: 3 });
    await s.controller.start('1', 'list', { fromStart: true });
    expect(s.play.mock.calls[1]![1]).toMatchObject({ startAt: 0 });
  });

  it('records events and moves with where it was started from', async () => {
    const s = setup();
    await s.controller.start('1', 'chat');
    const opts = s.play.mock.calls[0]![1];
    opts.onEvent('completed', 0);
    opts.onStep(1, 'done');
    await tick();
    expect(s.events).toEqual([
      [show().walkthrough_id, 'completed', 'chat'],
      [show().walkthrough_id, 'step', 'chat'],
    ]);
  });
});

describe('offers', () => {
  it('Not now records it; leaving the page doesn’t, so it is offered again', async () => {
    const s = setup();
    const left = s.controller.offerFor('/notes');
    await tick();
    expect(s.offered[0]!.offer).toMatchObject({ title: 'Show', acceptLabel: 'Show me', dismissLabel: 'Not now' });
    s.controller.clearOffer();
    await left;
    expect(s.events).toEqual([]);

    const notNow = s.controller.offerFor('/notes');
    await tick();
    s.offered[0]!.answer(false);
    await notNow;
    expect(s.events).toEqual([[show().walkthrough_id, 'dismissed', 'offer']]);
  });

  it('offers nothing while the product says wait, or with the switch off, or without the permission', async () => {
    for (const opts of [{ paused: true }, { offers: false }, { can: false, list: [show({ permission: 'edit' })] }]) {
      const s = setup(opts);
      await s.controller.offerFor('/notes');
      expect(s.offered).toEqual([]);
    }
  });

  it('a walkthrough starting from elsewhere takes the offer down, and offers aren’t stuck after', async () => {
    const s = setup();
    let opened: (ok: boolean) => void = () => undefined;
    s.play.mockReturnValue(new Promise<boolean>((resolve) => (opened = resolve)));
    const pending = s.controller.offerFor('/notes');
    await tick();
    const started = s.controller.start('1', 'chat');
    await tick();
    await pending;
    expect(s.offered).toEqual([]);
    // Still opening its first page: no offer beside it.
    await s.controller.offerFor('/notes');
    expect(s.offered).toEqual([]);
    opened(true);
    await started;
    void s.controller.offerFor('/notes');
    await tick();
    expect(s.offered).toHaveLength(1);
  });

  describe('a page with both kinds', () => {
    async function answer(s: ReturnType<typeof setup>, value: boolean | 'alternative') {
      const done = s.controller.offerFor('/notes');
      await tick();
      s.offered[0]!.answer(value);
      await done;
      await tick();
    }

    it('Guide me is the main button, Show me beside it', async () => {
      const s = setup({ list: [show(), guide()] });
      void s.controller.offerFor('/notes');
      await tick();
      expect(s.offered[0]!.offer).toMatchObject({ title: 'Guide', acceptLabel: 'Guide me', alternativeLabel: 'Show me' });
    });

    it('starting one settles the other, when the person hasn’t seen it', async () => {
      const s = setup({ list: [show(), guide()] });
      await answer(s, true);
      expect(s.dismissed()).toEqual([show().walkthrough_id]);
    });

    it('the second yes starts the second kind, and settles the first', async () => {
      const s = setup({ list: [show(), guide()] });
      await answer(s, 'alternative');
      expect(s.play.mock.calls[0]![0]).toMatchObject({ id: show().walkthrough_id });
      expect(s.dismissed()).toEqual([guide().walkthrough_id]);
    });

    it('never offers a kind the person has already seen', async () => {
      const s = setup({ list: [show(), guide()], progress: { [guide().walkthrough_id]: { v: 2, status: 'completed', step: 3, at: '' } } });
      const done = s.controller.offerFor('/notes');
      await tick();
      expect(s.offered[0]!.offer.acceptLabel).toBe('Show me');
      expect(s.offered[0]!.offer.alternativeLabel).toBeUndefined();
      s.offered[0]!.answer(true);
      await done;
      expect(s.dismissed()).toEqual([]);
    });

    it('leaves the other alone when the one chosen didn’t start', async () => {
      const s = setup({ list: [show(), guide()], started: false });
      await answer(s, true);
      expect(s.dismissed()).toEqual([]);
    });

    it('Not now settles both', async () => {
      const s = setup({ list: [show(), guide()] });
      await answer(s, false);
      expect(s.dismissed().sort()).toEqual([show().walkthrough_id, guide().walkthrough_id].sort());
    });
  });
});

describe('leaving part-way', () => {
  async function leave(s: ReturnType<typeof setup>) {
    await s.controller.start('1', 'chat');
    s.play.mock.calls[0]![1].onEvent('paused', 1, 'left', { noteId: 'n1' });
    await tick();
  }

  it('resumes with the ids the run had', async () => {
    const s = setup();
    await leave(s);
    expect(s.controller.view.left?.walkthrough_id).toBe(show().walkthrough_id);
    await s.controller.continueLeft();
    expect(s.play.mock.calls[1]![1]).toMatchObject({ startParams: { noteId: 'n1' } });
    expect(s.controller.view.left).toBeNull();
  });

  it('says so when it still can’t start, and the note stays', async () => {
    const s = setup();
    await leave(s);
    s.play.mockResolvedValue(false);
    await s.controller.continueLeft();
    expect(s.toast).toHaveBeenCalledWith(WALKTHROUGH_LABELS.couldNotStart);
    expect(s.controller.view.left?.walkthrough_id).toBe(show().walkthrough_id);
  });

  it('goes once the walkthrough is finished, or when the person says not now', async () => {
    const finished = setup({ progressAfter: { [show().walkthrough_id]: { v: 2, status: 'completed', step: 0, at: '' } } });
    await leave(finished);
    expect(finished.controller.view.left).toBeNull();

    const s = setup();
    await leave(s);
    s.controller.dismissLeft();
    expect(s.controller.view.left).toBeNull();
  });
});

describe('previews', () => {
  it('opens a page it can reach, and waits for one with an id in it', async () => {
    const s = setup({ paused: true });
    const navigate = vi.fn();
    const tour = { id: 'x', version: 1, title: 'T', steps: [{ ...STEPS[0]!, route: '/notes/:noteId' }] };
    expect(s.controller.previewOnItsPage(tour, navigate)).toBe('/notes/:noteId');
    expect(navigate).not.toHaveBeenCalled();
    await s.controller.offerFor('/notes');
    expect(s.play).not.toHaveBeenCalled();
    await s.controller.offerFor('/notes/12');
    expect(s.play).toHaveBeenCalledWith(tour, undefined);
    expect(s.events).toEqual([]);
  });
});

describe('words', () => {
  it('a product can change them', async () => {
    const s = setup();
    const controller = new WalkthroughController({
      api: { list: async () => [show()], mine: async () => ({ offer_walkthroughs: true, progress: {} }), setOffers: async () => null, record: async () => null },
      can: () => true,
      play: vi.fn(),
      showOffer: (offer) => {
        s.offered.push({ offer, answer: () => undefined });
        return Promise.resolve(null);
      },
      clearOffer: () => undefined,
      toast: () => undefined,
      offersPaused: () => false,
      labels: { show: 'Watch', offerMessage: 'Have a look.', offerHint: 'Ask any time.' },
    });
    await controller.offerFor('/notes');
    expect(s.offered[0]!.offer).toMatchObject({ acceptLabel: 'Watch', message: 'Have a look.', dismissHint: 'Ask any time.' });
  });
});

describe('reofferUnfinished', () => {
  const row = (status: WalkthroughProgress['status']): WalkthroughProgress => ({ v: 2, status, step: 1, at: '2026-11-01T00:00:00Z' });

  it('offers a walkthrough left part-way again, with its other kind beside it; Done and Not now still stop it', async () => {
    const list = [show(), guide()];
    const paused = { [show().walkthrough_id]: row('paused'), [guide().walkthrough_id]: row('started') };
    const off = setup({ list, progress: paused });
    await off.controller.offerFor('/notes');
    expect(off.offered).toEqual([]);

    const on = setup({ list, progress: paused, reofferUnfinished: true });
    void on.controller.offerFor('/notes');
    await tick();
    await tick();
    expect(on.offered.map((o) => [o.offer.acceptLabel, o.offer.alternativeLabel])).toEqual([['Guide me', 'Show me']]);

    for (const status of ['completed', 'dismissed'] as const) {
      const s = setup({ list, progress: { [show().walkthrough_id]: row(status), [guide().walkthrough_id]: row(status) }, reofferUnfinished: true });
      await s.controller.offerFor('/notes');
      expect(s.offered).toEqual([]);
    }
  });

  it('only a kind not yet done or dismissed goes beside the main one', async () => {
    const s = setup({ list: [show(), guide()], progress: { [guide().walkthrough_id]: row('completed'), [show().walkthrough_id]: row('paused') }, reofferUnfinished: true });
    void s.controller.offerFor('/notes');
    await tick();
    await tick();
    expect(s.offered.map((o) => [o.offer.title, o.offer.alternativeLabel])).toEqual([['Show', undefined]]);
  });
});
