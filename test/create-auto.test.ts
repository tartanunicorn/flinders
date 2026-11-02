// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFlinders, type FlindersConfig, type FlindersHttpRequest, type FlindersRouter } from '../src/index.js';

const live = { walkthrough_id: 'w', number: 1, version: 1, slug: 's', title: 'Tour', mode: 'show', permission: null, offer_on: '/projects', reoffer_from: 1, article_slug: null, steps: [{ anchor: null, title: 'T', body: 'B', missing: 'centred' }] };

function setup(answers: Record<string, { ok?: boolean; body: unknown }> = {}) {
  const listeners = new Set<(url: string) => void>();
  let here = '/projects';
  const router: FlindersRouter = {
    url: () => here,
    navigate: async (url) => ((here = url), true),
    onNavigated: (listener) => (listeners.add(listener), () => listeners.delete(listener)),
    routePattern: (url) => url,
  };
  const go = (url: string) => {
    here = url;
    listeners.forEach((listener) => listener(url));
  };
  const calls: FlindersHttpRequest[] = [];
  const table: Record<string, { ok?: boolean; body: unknown }> = {
    listWalkthroughs: { body: { data: [live] } },
    getMyProgress: { body: { offer_walkthroughs: true, progress: {} } },
    recordEvent: { body: { offer_walkthroughs: true, progress: {} } },
    adminList: { body: { data: [] } },
    adminCreateRecordingLink: { ok: false, body: { error: { code: 'feature_off', message: 'Off.' } } },
    ...answers,
  };
  const request = async (call: FlindersHttpRequest) => {
    calls.push(call);
    const answer = table[call.route] ?? { ok: false, body: null };
    return { ok: answer.ok ?? true, body: answer.body };
  };
  const shown = vi.fn(async () => null);
  const clear = vi.fn();
  const toast = vi.fn();
  const make = (more: Partial<FlindersConfig> = {}) => createFlinders({ http: { request }, router, identity: { can: () => true }, offers: { show: shown, clear }, toast, ...more });
  return { router, go, calls, table, shown, clear, toast, make };
}

const bar = () => document.querySelector<HTMLElement>('[data-flinders-recorder]');

describe('createFlinders on its own', () => {
  let made: { destroy(): void }[];
  const track = <T extends { destroy(): void }>(flinders: T) => (made.push(flinders), flinders);

  beforeEach(() => {
    vi.useFakeTimers();
    made = [];
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });
  afterEach(() => {
    made.forEach((flinders) => flinders.destroy());
    vi.useRealTimers();
  });

  it('offers each page’s walkthrough once it has opened, and takes the last page’s offer down', async () => {
    const { go, shown, clear, make } = setup();
    track(make());
    await vi.advanceTimersByTimeAsync(700);
    expect(shown).toHaveBeenCalledOnce();
    clear.mockClear();
    go('/elsewhere');
    expect(clear).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(700);
    expect(shown).toHaveBeenCalledOnce();
  });

  it('waits for someone to be signed in', async () => {
    const { calls, shown, make } = setup();
    let signIn = () => {};
    track(make({ identity: { can: () => true, signedIn: () => new Promise<void>((resolve) => (signIn = resolve)) } }));
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toEqual([]);
    signIn();
    await vi.advanceTimersByTimeAsync(700);
    expect(shown).toHaveBeenCalledOnce();
  });

  it('offers the page again after one was taken down unanswered, with no answer from the product', async () => {
    const { go, make } = setup();
    const show = vi.fn(() => new Promise<null>(() => undefined));
    track(make({ offers: { show, clear: () => undefined } }));
    await vi.advanceTimersByTimeAsync(700);
    go('/elsewhere');
    go('/projects');
    await vi.advanceTimersByTimeAsync(700);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it('offers nothing to nobody, and loads the next person’s own progress in the same tab', async () => {
    const { calls, go, shown, make } = setup();
    let who: string | null = null;
    track(make({ identity: { can: () => true, id: () => who } }));
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toEqual([]);
    who = 'first';
    go('/projects');
    await vi.advanceTimersByTimeAsync(700);
    expect(shown).toHaveBeenCalledOnce();
    calls.length = 0;
    who = 'second';
    go('/elsewhere');
    await vi.advanceTimersByTimeAsync(700);
    expect(calls.map((c) => c.route)).toContain('getMyProgress');
  });

  it('auto: false leaves it all to the product', async () => {
    const { calls, go, make } = setup();
    track(make({ auto: false }));
    go('/projects');
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toEqual([]);
  });

  it('stops on destroy', async () => {
    const { calls, go, make } = setup();
    const flinders = make();
    await vi.advanceTimersByTimeAsync(0);
    flinders.destroy();
    go('/projects');
    await vi.advanceTimersByTimeAsync(700);
    expect(calls).toEqual([]);
  });

  it('picks up a recording link and puts the bar up by itself, saying who', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const { calls, make } = setup({ checkRecordingLink: { body: { valid: true, link: 'a.c', expires_at: new Date(Date.now() + 3e6).toISOString() } } });
    const flinders = track(make({ identity: { can: () => true, name: () => 'Sam' } }));
    expect(location.hash).toBe('');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.map((c) => c.route)).toContain('checkRecordingLink');
    expect(flinders.recorder?.view.fromLink).toBe(true);
    expect(bar()?.textContent).toContain('Ready to record as Sam');
  });

  it('says why a link was refused', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const { toast, make } = setup({ checkRecordingLink: { body: { valid: false, reason: 'expired' } } });
    track(make());
    await vi.advanceTimersByTimeAsync(0);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('expired'));
    expect(bar()).toBeNull();
  });

  it('recording.bar false draws nothing: the product draws its own', async () => {
    const { make } = setup();
    const onRecordingChange = vi.fn();
    const flinders = track(make({ recording: { bar: false }, onRecordingChange }));
    await flinders.record();
    expect(onRecordingChange.mock.lastCall?.[0]).toMatchObject({ ready: true });
    expect(bar()).toBeNull();
  });

  describe('record()', () => {
    it('without recording links, brings the bar up here; Finish saves a draft and says so', async () => {
      const { calls, toast, make } = setup({ adminUpload: { body: { walkthrough_id: 'w' } } });
      const flinders = track(make());
      expect(await flinders.record()).toBe('here');
      expect(bar()?.textContent).toContain('Ready to record');
      bar()!.querySelector<HTMLElement>('.flinders-primary')!.click();
      document.body.insertAdjacentHTML('beforeend', '<button data-testid="add">Add</button>');
      document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
      bar()!.querySelector<HTMLElement>('.flinders-primary')!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(calls.map((c) => c.route)).toContain('adminUpload');
      expect(toast).toHaveBeenCalledWith('Saved as a draft.');
      document.querySelector('[data-testid="add"]')!.remove();
    });

    it('hands Finish to the product when it has its own next step', async () => {
      const { calls, make } = setup();
      const onFinish = vi.fn();
      const flinders = track(make({ recording: { onFinish } }));
      await flinders.record();
      bar()!.querySelector<HTMLElement>('.flinders-primary')!.click();
      bar()!.querySelector<HTMLElement>('.flinders-primary')!.click();
      expect(onFinish).toHaveBeenCalledWith([]);
      expect(calls.map((c) => c.route)).not.toContain('adminUpload');
    });

    it('with a link for another site, opens the tab and hands over the draft when the person comes back', async () => {
      const { make, table } = setup({ adminCreateRecordingLink: { body: { link: 'a.b', url: 'https://app.example.test/#flinders_record=a.b', expires_at: 'x' } } });
      const open = vi.spyOn(window, 'open').mockReturnValue({ opener: 1 } as unknown as Window);
      const onDraft = vi.fn();
      const flinders = track(make({ recording: { onDraft } }));
      expect(await flinders.record()).toBe('tab');
      expect(open).toHaveBeenCalledWith('https://app.example.test/#flinders_record=a.b', '_blank');
      table['adminList'] = { body: { data: [{ walkthrough_id: 'new' }] } };
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
      expect(onDraft).toHaveBeenCalledWith({ walkthrough_id: 'new' });
      open.mockRestore();
    });

    it('says so when the browser stops the tab, and when the API says no', async () => {
      const { toast, make } = setup({ adminCreateRecordingLink: { body: { url: 'https://app.example.test/' } } });
      const open = vi.spyOn(window, 'open').mockReturnValue(null);
      expect(await track(make()).record()).toBe('blocked');
      expect(toast).toHaveBeenCalledWith(expect.stringContaining('pop-ups'));
      open.mockRestore();

      const refused = setup({ adminCreateRecordingLink: { ok: false, body: { error: { code: 'forbidden', message: 'No.' } } } });
      expect(await track(refused.make()).record()).toBe('refused');
      expect(refused.toast).toHaveBeenCalledOnce();
    });

    it('needs no router on an admin site that only opens the tab', async () => {
      const open = vi.spyOn(window, 'open').mockReturnValue({ opener: 1 } as unknown as Window);
      const { make } = setup({ adminCreateRecordingLink: { body: { url: 'https://app.example.test/' } } });
      expect(await track(make({ router: undefined })).record()).toBe('tab');
      open.mockRestore();
    });

    it('is off with no way to name a page', async () => {
      const flinders = track(createFlinders({ router: { url: () => '/', navigate: async () => true, onNavigated: () => () => undefined } }));
      expect(await flinders.record()).toBe('off');
    });
  });

  it('records with no backend at all, which is all a static page has', async () => {
    const { router } = setup();
    const onFinish = vi.fn();
    const flinders = track(createFlinders({ router, recording: { onFinish } }));
    expect(await flinders.record()).toBe('here');
    bar()!.querySelector<HTMLElement>('.flinders-primary')!.click();
    bar()!.querySelector<HTMLElement>('.flinders-primary')!.click();
    expect(onFinish).toHaveBeenCalledOnce();
  });

  it('passes the router’s page names and the anchor attribute on, and holds no offer over a running walkthrough', async () => {
    const { shown, go, make } = setup();
    document.body.insertAdjacentHTML('beforeend', '<button data-help="add">Add</button>');
    const flinders = track(make({ player: { anchorAttribute: 'data-help' } }));
    await flinders.record();
    bar()!.querySelector<HTMLElement>('.flinders-primary')!.click();
    document.querySelector<HTMLElement>('[data-help="add"]')!.click();
    expect(flinders.recorder?.view.recorder.steps[0]?.anchor).toBe('add');
    flinders.recorder?.cancel();
    flinders.recorder?.stop();
    shown.mockClear();
    vi.useRealTimers();
    expect(await flinders.start('1')).toBe(true);
    go('/projects');
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(shown).not.toHaveBeenCalled();
    expect(flinders.player && 'stop' in flinders.player).toBe(true);
    (flinders.player as { stop(): void }).stop();
    document.querySelector('[data-help="add"]')!.remove();
  });
});
