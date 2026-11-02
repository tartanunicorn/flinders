// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { clearRecordedWords, fillRecordedWords, RecordingTab, type WalkthroughStep } from '../src/index.js';

const step: WalkthroughStep = { anchor: 'add', title: '', body: '', missing: 'centred' };

describe('RecordingTab', () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('a normal tab is not a recording tab, and its URL is left alone', () => {
    history.replaceState(null, '', '/reports?tab=open#top');
    const tab = new RecordingTab();
    expect(tab.active).toBe(false);
    expect(tab.link).toBeNull();
    expect(location.pathname + location.search + location.hash).toBe('/reports?tab=open#top');
    expect(sessionStorage.length).toBe(0);
  });

  it('takes the link out of the URL at once, leaving the rest', () => {
    history.replaceState(null, '', '/reports?flinders_record=a.b&tab=open#top');
    const tab = new RecordingTab();
    expect(tab.active).toBe(true);
    expect(tab.link).toBe('a.b');
    expect(location.pathname + location.search + location.hash).toBe('/reports?tab=open#top');
  });

  it('reads the link after the #, leaving any other hash alone', () => {
    history.replaceState(null, '', '/reports?tab=open#flinders_record=a.b');
    expect(new RecordingTab().link).toBe('a.b');
    expect(location.pathname + location.search + location.hash).toBe('/reports?tab=open');

    sessionStorage.clear();
    history.replaceState(null, '', '/reports#top&flinders_record=c.d&more');
    expect(new RecordingTab().link).toBe('c.d');
    expect(location.hash).toBe('#top&more');
  });

  it('a used link can’t start again in this tab, even renewed; a new one can', () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    const tab = new RecordingTab();
    tab.renew('a.renewed');
    expect(tab.link).toBe('a.renewed');
    tab.finish();
    expect(tab.active).toBe(false);

    history.replaceState(null, '', '/#flinders_record=a.b');
    const again = new RecordingTab();
    expect(again.active).toBe(false);
    expect(location.hash).toBe('');

    history.replaceState(null, '', '/#flinders_record=new');
    expect(new RecordingTab().link).toBe('new');
  });

  it('cancelling doesn’t use a link up', () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    new RecordingTab().end();
    history.replaceState(null, '', '/#flinders_record=a.b');
    expect(new RecordingTab().active).toBe(true);
  });

  it('a reload keeps a renewed link', () => {
    history.replaceState(null, '', '/#flinders_record=a.b');
    new RecordingTab().renew('a.renewed');
    expect(new RecordingTab().link).toBe('a.renewed');
  });

  it('keeps it through moves and a reload, steps included', () => {
    history.replaceState(null, '', '/?flinders_record=a.b');
    const first = new RecordingTab();
    expect(first.steps).toBeNull();
    first.saveSteps([step]);
    history.replaceState(null, '', '/somewhere-else');
    const reloaded = new RecordingTab();
    expect(reloaded.active).toBe(true);
    expect(reloaded.link).toBe('a.b');
    expect(reloaded.steps).toEqual([step]);
  });

  it('a new link replaces the old one and its steps', () => {
    history.replaceState(null, '', '/?flinders_record=old');
    new RecordingTab().saveSteps([step]);
    history.replaceState(null, '', '/?flinders_record=new');
    const tab = new RecordingTab();
    expect(tab.link).toBe('new');
    expect(tab.steps).toBeNull();
  });

  it('ends: a normal tab again, after a reload too', () => {
    history.replaceState(null, '', '/?flinders_record=a.b');
    new RecordingTab().end();
    expect(new RecordingTab().active).toBe(false);
  });

  it('survives blocked storage and rubbish in it', () => {
    sessionStorage.setItem('flinders-recording', 'not json');
    expect(new RecordingTab().active).toBe(false);
    const blocked = {
      location,
      history,
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    } as unknown as Window;
    history.replaceState(null, '', '/?flinders_record=a.b');
    const tab = new RecordingTab({ window: blocked });
    expect(tab.link).toBe('a.b');
    expect(location.search).toBe('');
    tab.end();
    expect(tab.active).toBe(false);
  });
});

describe('recorded words', () => {
  it('unwritten words go blank again in the editor', () => {
    expect(clearRecordedWords(fillRecordedWords([step]) as WalkthroughStep[])).toEqual([step]);
    expect(clearRecordedWords([{ ...step, title: 'Mine', body: 'Said' }])[0]).toMatchObject({ title: 'Mine', body: 'Said' });
  });
});
