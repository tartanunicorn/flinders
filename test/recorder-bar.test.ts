// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RecordingSession, type RecordingSaveAnswer } from '../src/recording-session.js';
import { mountRecorderBar } from '../src/recorder-bar.js';

const bar = () => document.querySelector<HTMLElement>('[data-flinders-recorder]');
const buttons = () => Array.from(bar()?.querySelectorAll('button') ?? []).map((b) => b.textContent);
const press = (label: string) => Array.from(bar()!.querySelectorAll('button')).find((b) => b.textContent === label)!.click();
const status = () => bar()?.querySelector('[role="status"]')?.textContent;

describe('mountRecorderBar', () => {
  let recorder: RecordingSession;
  let removes: (() => void)[];
  const mount = (...args: Parameters<typeof mountRecorderBar>) => {
    const remove = mountRecorderBar(...args);
    removes.push(remove);
    args[0].getReady();
    return remove;
  };

  beforeEach(() => {
    vi.spyOn(window, 'close').mockImplementation(() => undefined);
    document.body.innerHTML = '<button data-testid="add">Add</button><button id="plain">No test id</button>';
    sessionStorage.clear();
    removes = [];
    recorder = new RecordingSession({ url: () => '/projects', routePattern: (u) => u });
  });

  afterEach(() => {
    recorder.stop();
    removes.forEach((remove) => remove());
  });

  it('starts ready, capturing nothing until Start recording', () => {
    mount(recorder);
    expect(status()).toContain('Ready to record');
    expect(buttons()).toEqual(['Cancel', 'Start recording']);
    document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
    expect(recorder.view.recorder.recording).toBe(false);
    expect(recorder.view.recorder.steps).toEqual([]);
  });

  it('Start recording captures clicks; the bar shows the count and none of its own clicks are steps', () => {
    mount(recorder);
    press('Start recording');
    expect(recorder.view.recorder.recording).toBe(true);
    expect(buttons()).toEqual(['Undo last', 'This has paths', 'Finish']);
    expect(status()).toContain('Recording · 0 steps');
    expect(document.activeElement?.textContent).toBe('Finish');

    document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
    expect(status()).toContain('Recording · 1 step');
    expect(status()).not.toContain('1 steps');
    press('Undo last');
    expect(status()).toContain('0 steps');
    expect(recorder.view.recorder.steps).toEqual([]);
  });

  it('walks through paths: the buttons follow, the bar says which path, and it pauses between them', () => {
    mount(recorder);
    press('Start recording');
    press('This has paths');
    expect(status()).toContain('Record the step that makes the choice');

    document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
    press('This has paths');
    expect(buttons()).toEqual(['Undo last', 'Next path', 'End paths', 'Finish']);
    expect(status()).toContain('path 1');

    document.body.insertAdjacentHTML('beforeend', '<button data-testid="first">One</button><button data-testid="second">Two</button>');
    document.querySelector<HTMLElement>('[data-testid="first"]')!.click();
    press('Next path');
    expect(buttons()).toEqual(['Undo last', 'End paths', 'Finish', 'Record path']);
    expect(status()).toContain('Paused · 2 steps');
    expect(status()).toContain('switch the choice');

    press('Record path');
    expect(status()).toContain('Recording · 2 steps · path 2');
    document.querySelector<HTMLElement>('[data-testid="second"]')!.click();
    press('End paths');
    expect(buttons()).toEqual(['Undo last', 'This has paths', 'Finish']);
    expect(status()).not.toContain('path 2');
    expect(recorder.view.recorder.steps.map((s) => s.only_if)).toEqual([undefined, 'first', 'second']);
  });

  it('shows the warning in place of the hint', () => {
    mount(recorder);
    press('Start recording');
    document.querySelector<HTMLElement>('#plain')!.click();
    expect(bar()!.querySelector('.flinders-recorder-warning')?.textContent).toMatch(/can’t be pointed at/);
    expect(bar()!.querySelector('.flinders-recorder-hint')).toBeNull();
    document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
    expect(bar()!.querySelector('.flinders-recorder-warning')).toBeNull();
  });

  it('Finish stops the recorder, hands over the steps and takes the bar down', () => {
    const onFinish = vi.fn();
    mount(recorder, { onFinish });
    press('Start recording');
    document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
    press('Finish');
    expect(recorder.view.recorder.recording).toBe(false);
    expect(onFinish).toHaveBeenCalledOnce();
    expect(onFinish.mock.calls[0]![0]).toHaveLength(1);
    expect(bar()).toBeNull();
  });

  it('Cancel takes the bar down with nothing recorded', () => {
    const onCancel = vi.fn();
    mount(recorder, { onCancel });
    press('Cancel');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(recorder.view.recorder.recording).toBe(false);
    expect(bar()).toBeNull();
  });

  it('goes straight to recording when the recorder already is, and goes when it is stopped elsewhere', () => {
    recorder.start();
    const onFinish = vi.fn();
    removes.push(mountRecorderBar(recorder, { onFinish }));
    expect(buttons()).toEqual(['Undo last', 'This has paths', 'Finish']);
    recorder.stop();
    expect(bar()).toBeNull();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('removing it stops updates and leaves the recording to the product', () => {
    const remove = mount(recorder);
    press('Start recording');
    remove();
    expect(bar()).toBeNull();
    expect(recorder.view.recorder.recording).toBe(true);
    expect(() => remove()).not.toThrow();
  });

  it('takes a container, labels, classes and unstyled', () => {
    const box = document.createElement('section');
    document.body.append(box);
    mount(recorder, { container: box, unstyled: true, labels: { start: 'Go', steps: (n) => `${n} clicks` }, classes: { card: 'panel flat', primary: 'btn btn-primary', secondary: 'btn' } });
    expect(box.contains(bar())).toBe(true);
    expect(bar()!.className).toBe('flinders-recorder panel flat');
    expect(bar()!.querySelector('button:last-child')!.className).toBe('flinders-button flinders-primary btn btn-primary');
    press('Go');
    expect(status()).toContain('0 clicks');
    expect(bar()!.querySelector('button')!.className).toBe('flinders-button flinders-secondary btn');
  });

  it('stays down until the session is busy, and comes back for the next recording', () => {
    removes.push(mountRecorderBar(recorder));
    expect(bar()).toBeNull();
    recorder.getReady();
    press('Cancel');
    expect(bar()).toBeNull();
    recorder.getReady();
    expect(buttons()).toEqual(['Cancel', 'Start recording']);
  });

  it('says what the bar is, and keeps focus on the bar when the pressed button goes', () => {
    mount(recorder);
    expect(bar()!.getAttribute('role')).toBe('region');
    expect(bar()!.getAttribute('aria-label')).toBe('Recording a walkthrough');
    press('Start recording');
    document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
    Array.from(bar()!.querySelectorAll('button')).find((b) => b.textContent === 'This has paths')!.focus();
    press('This has paths');
    expect(document.activeElement?.textContent).toBe('Finish');
  });

  describe('in a tab holding a recording link', () => {
    const linked = (saveDraft: () => Promise<RecordingSaveAnswer<unknown>> = vi.fn(async () => ({ saved: 'draft' }))) => {
      history.replaceState(null, '', '/#flinders_record=a.b');
      const session = new RecordingSession({ url: () => '/projects', routePattern: (u) => u, checkLink: async () => ({ valid: true, link: 'a.c' }), saveDraft });
      return { session, saveDraft };
    };

    it('comes up ready once the link is checked, says who, and Finish saves the draft', async () => {
      const { session, saveDraft } = linked();
      const onSaved = vi.fn();
      removes.push(mountRecorderBar(session, { who: () => 'Sam', onSaved }));
      expect(bar()).toBeNull();
      await session.resumeFromLink();
      expect(status()).toContain('Ready to record as Sam');
      press('Start recording');
      expect(status()).toContain('Recording as Sam');
      document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
      press('Finish');
      await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith({ saved: 'draft' }));
      expect(saveDraft).toHaveBeenCalledOnce();
      expect(bar()).toBeNull();
    });

    it('offers the steps when the link stops working, and goes on Cancel', async () => {
      const { session } = linked(vi.fn(async () => ({ error: 'no', linkRefused: true })));
      const onSaved = vi.fn();
      removes.push(mountRecorderBar(session, { onSaved }));
      await session.resumeFromLink();
      press('Start recording');
      document.querySelector<HTMLElement>('[data-testid="add"]')!.click();
      press('Finish');
      await vi.waitFor(() => expect(status()).toContain('Recording stopped · 1 step'));
      expect(buttons()).toEqual(['Cancel', 'Download steps']);
      expect(onSaved).toHaveBeenCalledWith({ error: 'no' });
      press('Cancel');
      expect(bar()).toBeNull();
    });
  });

  it('keeps our look by default', () => {
    mount(recorder);
    expect(bar()!.classList.contains('flinders-recorder-styled')).toBe(true);
  });
});
