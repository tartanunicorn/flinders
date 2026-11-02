// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startRecording, watchForRecording } from '../src/index.js';

const row = (walkthrough_id: string) => ({ walkthrough_id });
const tick = () => new Promise((r) => setTimeout(r));

describe('startRecording', () => {
  afterEach(() => vi.restoreAllMocks());

  it('on this same site opens nothing', () => {
    const open = vi.spyOn(window, 'open');
    expect(startRecording(`${location.origin}/#flinders_record=a.b`)).toBe('here');
    expect(startRecording('/#flinders_record=a.b')).toBe('here');
    expect(open).not.toHaveBeenCalled();
  });

  it('on another site opens a new tab and cuts its tie to this one', () => {
    const tab = { opener: window };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    expect(startRecording('https://web.example.test/#flinders_record=a.b')).toBe('tab');
    expect(open).toHaveBeenCalledWith('https://web.example.test/#flinders_record=a.b', '_blank');
    expect(tab.opener).toBeNull();
  });

  it('says when the browser stops the tab', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    expect(startRecording('https://web.example.test/#flinders_record=a.b')).toBe('blocked');
  });
});

describe('watchForRecording', () => {
  const stops: (() => void)[] = [];
  const watch = (lists: (typeof row extends (id: string) => infer R ? R[] : never)[], known = [row('old')]) => {
    const list = vi.fn(async () => lists.shift() ?? []);
    const onDraft = vi.fn();
    const stop = watchForRecording({ known, list, onDraft });
    stops.push(stop);
    return { list, onDraft, stop };
  };
  const comeBack = async () => {
    window.dispatchEvent(new Event('focus'));
    await tick();
  };

  beforeEach(() => void vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'));
  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    vi.restoreAllMocks();
  });

  it('does nothing until the person comes back', async () => {
    const w = watch([[row('old'), row('new')]]);
    await tick();
    expect(w.list).not.toHaveBeenCalled();
  });

  it('keeps looking on each return until the new draft is there, then stops', async () => {
    const w = watch([[row('old')], [row('old'), row('new')]]);
    await comeBack();
    expect(w.onDraft).not.toHaveBeenCalled();
    await comeBack();
    expect(w.onDraft).toHaveBeenCalledExactlyOnceWith(row('new'));
    await comeBack();
    expect(w.list).toHaveBeenCalledTimes(2);
  });

  it('does not look while the tab is hidden', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const w = watch([[row('new')]]);
    await comeBack();
    expect(w.list).not.toHaveBeenCalled();
  });

  it('opens the draft once when focus lands twice during a look', async () => {
    const w = watch([[row('new')], [row('new')]]);
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    await tick();
    expect(w.list).toHaveBeenCalledTimes(1);
    expect(w.onDraft).toHaveBeenCalledTimes(1);
  });

  it('a failed look is tried again next time', async () => {
    const onDraft = vi.fn();
    const list = vi.fn<() => Promise<{ walkthrough_id: string }[]>>().mockRejectedValueOnce(new Error('away')).mockResolvedValue([row('new')]);
    stops.push(watchForRecording({ known: [], list, onDraft }));
    await comeBack();
    expect(onDraft).not.toHaveBeenCalled();
    await comeBack();
    expect(onDraft).toHaveBeenCalledWith(row('new'));
  });

  it('stopped, it looks no more, and a look under way opens nothing', async () => {
    const w = watch([[row('new')]]);
    window.dispatchEvent(new Event('focus'));
    w.stop();
    await tick();
    expect(w.onDraft).not.toHaveBeenCalled();
    await comeBack();
    expect(w.list).toHaveBeenCalledTimes(1);
  });
});
