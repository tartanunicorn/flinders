// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingSession, type RecordingLinkAnswer, type RecordingSaveAnswer, type RecordingView } from '../src/index.js';

const tick = () => new Promise((r) => setTimeout(r));
const SOON = () => new Date(Date.now() + 60_000).toISOString();
const LATER = () => new Date(Date.now() + 30 * 60_000).toISOString();

function setup(checks: (RecordingLinkAnswer | null)[] = [], saves: RecordingSaveAnswer<string>[] = []) {
  const checkLink = vi.fn(async () => (checks.length > 1 ? checks.shift()! : (checks[0] ?? null)));
  const saveDraft = vi.fn(async () => saves.shift()!);
  const changes: RecordingView[] = [];
  const session = new RecordingSession<string>({ url: () => '/notes', routePattern: () => '/notes', checkLink, saveDraft, onChange: (v) => changes.push(v) });
  return { session, checkLink, saveDraft, changes };
}

function click(testId: string) {
  const button = document.createElement('button');
  button.dataset['testid'] = testId;
  document.body.append(button);
  button.click();
}

describe('RecordingSession', () => {
  beforeEach(() => {
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    sessionStorage.clear();
    history.replaceState(null, '', '/');
    document.body.innerHTML = '';
  });
  afterEach(() => vi.restoreAllMocks());

  it('a normal tab sends nothing and shows nothing', async () => {
    const s = setup();
    expect(await s.session.resumeFromLink()).toEqual({ reason: null });
    expect(s.checkLink).not.toHaveBeenCalled();
    expect(s.session.view).toMatchObject({ ready: false, fromLink: false, busy: false });
  });

  it('a reload in a link tab carries on mid-path: the same fork, still paused', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const first = setup([{ valid: true }]);
    await first.session.resumeFromLink();
    first.session.start();
    await tick();
    click('choice');
    first.session.startPaths();
    click('first');
    first.session.nextPath();

    const again = setup([{ valid: true }]);
    await again.session.resumeFromLink();
    expect(again.session.view.recorder).toMatchObject({ recording: true, paused: true, forks: [{ choice: 0, paths: [1] }] });
    click('stray');
    expect(again.session.view.recorder.steps).toHaveLength(2);
    again.session.recordPath();
    click('second');
    again.session.endPaths();
    expect(again.session.view.recorder.steps.map((s) => s.only_if)).toEqual([undefined, 'first', 'second']);
    first.session.stop();
    again.session.stop();
  });

  it.each([
    [undefined, 1],
    [false, 0],
  ] as const)('Finish with jumpBack %s closes the tab %i time(s); only a saved draft does', async (jumpBack, closes) => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const session = new RecordingSession<string>({
      url: () => '/notes',
      routePattern: () => '/notes',
      checkLink: async () => ({ valid: true }),
      saveDraft: vi.fn<() => Promise<RecordingSaveAnswer<string>>>().mockResolvedValueOnce({ error: 'no', linkRefused: false }).mockResolvedValueOnce({ saved: 'd' }),
      ...(jumpBack === false ? { jumpBack } : {}),
    });
    await session.resumeFromLink();
    session.start();
    await tick();
    click('add');
    await session.saveDraft();
    expect(window.close).not.toHaveBeenCalled();
    await session.saveDraft();
    expect(window.close).toHaveBeenCalledTimes(closes);
  });

  it('a failed save keeps the paths where they were', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const { session } = setup([{ valid: true }], [{ error: 'no', linkRefused: false }]);
    await session.resumeFromLink();
    session.start();
    await tick();
    click('choice');
    session.startPaths();
    click('first');
    await session.saveDraft();
    expect(session.view.recorder).toMatchObject({ recording: true, forks: [{ choice: 0, paths: [1] }] });
    click('more');
    expect(session.view.recorder.steps.at(-1)?.only_if).toBe('first');
    session.stop();
  });

  it('getting ready, then recording, is busy; cancel takes the bar down', () => {
    const { session } = setup();
    session.getReady();
    expect(session.view).toMatchObject({ ready: true, busy: true });
    session.start();
    expect(session.view).toMatchObject({ ready: false, busy: true });
    expect(session.view.recorder.recording).toBe(true);
    session.stop();
    expect(session.view.busy).toBe(false);
    session.getReady();
    session.cancel();
    expect(session.view.busy).toBe(false);
  });

  it('a valid link puts the bar up, and Finish saves the draft once', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const s = setup([{ valid: true, link: 'c.d', expires_at: LATER() }], [{ saved: '3-recorded' }]);
    await s.session.resumeFromLink();
    expect(s.session.view).toMatchObject({ fromLink: true, ready: true });
    s.session.start();
    click('add');
    expect(await s.session.saveDraft()).toEqual({ saved: '3-recorded' });
    expect(s.saveDraft).toHaveBeenCalledOnce();
    expect(s.saveDraft.mock.calls[0]).toEqual(['c.d', expect.any(Array)]);
    expect(s.session.view.fromLink).toBe(false);
    expect(sessionStorage.getItem('flinders-recording')).toBeNull();
  });

  it('a bad link says why and the tab goes back to normal', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const s = setup([{ valid: false, reason: 'expired' }]);
    expect(await s.session.resumeFromLink()).toEqual({ reason: 'expired' });
    expect(s.session.view.busy).toBe(false);
  });

  it('if the check can’t be made the tab keeps the link, and shows nothing', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const s = setup();
    s.checkLink.mockRejectedValueOnce(new Error('away'));
    expect(await s.session.resumeFromLink()).toEqual({ reason: null });
    expect(s.session.view.ready).toBe(false);
    s.checkLink.mockResolvedValueOnce({ valid: true });
    await s.session.resumeFromLink();
    expect(s.session.view.ready).toBe(true);
  });

  it('a reload carries on with the steps so far, and a bad link then offers them', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const first = setup([{ valid: true, expires_at: LATER() }]);
    await first.session.resumeFromLink();
    first.session.start();
    click('add');
    first.session.stop();

    const second = setup([{ valid: true, expires_at: LATER() }]);
    await second.session.resumeFromLink();
    expect(second.session.view.recorder.recording).toBe(true);
    expect(second.session.view.recorder.steps.map((x) => x.anchor)).toEqual(['add']);
    second.session.stop();

    const third = setup([{ valid: false, reason: 'not_allowed' }]);
    expect(await third.session.resumeFromLink()).toEqual({ reason: null });
    expect(third.session.view.stranded?.map((x) => x.anchor)).toEqual(['add']);
    expect(third.session.view).toMatchObject({ fromLink: true, busy: true });
  });

  it('a step added with little time left asks for more; a link gone bad strands the steps', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const s = setup([{ valid: true, expires_at: LATER() }, { valid: true, expires_at: SOON() }, { valid: false, reason: 'not_allowed' }]);
    await s.session.resumeFromLink();
    s.session.start();
    await tick();
    expect(s.checkLink).toHaveBeenCalledTimes(2);
    click('add');
    await tick();
    expect(s.checkLink).toHaveBeenCalledTimes(3);
    expect(s.session.view.recorder.recording).toBe(false);
    expect(s.session.view.stranded?.map((x) => x.anchor)).toEqual(['add']);
  });

  it('a save that fails carries on recording, to try again; a refused link strands the steps', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const s = setup([{ valid: true, expires_at: LATER() }], [{ error: 'busy', linkRefused: false }, { error: 'no', linkRefused: true }]);
    await s.session.resumeFromLink();
    s.session.start();
    click('add');
    expect(await s.session.saveDraft()).toEqual({ error: 'busy' });
    expect(s.session.view.recorder.recording).toBe(true);
    expect(await s.session.saveDraft()).toEqual({ error: 'no' });
    expect(s.session.view.stranded).toHaveLength(1);
  });

  it('with nothing recorded, Finish goes back to ready', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const s = setup([{ valid: true, expires_at: LATER() }]);
    await s.session.resumeFromLink();
    s.session.start();
    await tick();
    expect(await s.session.saveDraft()).toBeNull();
    expect(s.saveDraft).not.toHaveBeenCalled();
    expect(s.session.view.ready).toBe(true);
  });

  it('downloads stranded steps as the normal upload shape', async () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const first = setup([{ valid: true, expires_at: LATER() }]);
    await first.session.resumeFromLink();
    first.session.start();
    click('add');
    first.session.stop();

    const blobs: Blob[] = [];
    URL.createObjectURL = (b) => (blobs.push(b as Blob), 'blob:x');
    URL.revokeObjectURL = () => undefined;
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const second = setup([{ valid: false, reason: 'expired' }]);
    await second.session.resumeFromLink();
    second.session.downloadSteps();
    expect(clicked).toHaveBeenCalledOnce();
    expect(JSON.parse(await blobs[0]!.text())).toMatchObject({ slug: 'recorded-walkthrough', mode: 'guide' });
  });
});
