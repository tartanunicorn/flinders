import { describe, expect, it } from 'vitest';

import {
  applyStepForm,
  describeUpload,
  editedFile,
  helpAfterOf,
  peopleLabel,
  previewWaitMessage,
  reachedLabel,
  stepForm,
  versionChangeWords,
  walkthroughFileName,
  walkthroughFileOf,
  walkthroughStatusLabel,
  walkthroughStatusTone,
  type WalkthroughStep,
} from '../src/index.js';

const listed = (over: object) => ({ latest_status: 'live' as const, latest_version: 3, live_version: 3, problems: [], ...over });

describe('status', () => {
  it('says what people get, and any newer draft', () => {
    expect(walkthroughStatusLabel(listed({}))).toBe('Live v3');
    expect(walkthroughStatusLabel(listed({ latest_status: 'draft', live_version: 2 }))).toBe('Live v2 · draft v3');
    expect(walkthroughStatusLabel(listed({ latest_status: 'draft', latest_version: 1, live_version: null }))).toBe('Draft v1');
    expect(walkthroughStatusLabel(listed({ problems: ['gone'] }))).toBe('Needs update · Live v3');
  });

  it('looks like what it says', () => {
    expect(walkthroughStatusTone(listed({ problems: ['gone'] }))).toBe('danger');
    expect(walkthroughStatusTone(listed({}))).toBe('ok');
    expect(walkthroughStatusTone(listed({ latest_status: 'inactive', live_version: null }))).toBe('warn');
    expect(walkthroughStatusTone(listed({ latest_status: 'draft', live_version: null }))).toBe('neutral');
  });
});

describe('stats', () => {
  it('says nothing until someone has started it', () => {
    const none = { people: 0, finished: 0, reached: [0] };
    expect(reachedLabel(none, 0)).toBe('');
    expect(peopleLabel(none)).toBe('');
    expect(reachedLabel(undefined, 0)).toBe('');
  });

  it('counts people', () => {
    const stats = { people: 12, finished: 7, reached: [12, 9] };
    expect(reachedLabel(stats, 1)).toBe(' · reached by 9');
    expect(reachedLabel(stats, 5)).toBe(' · reached by 0');
    expect(peopleLabel(stats)).toBe(' · 12 people, 7 finished');
    expect(peopleLabel({ ...stats, people: 1 })).toBe(' · 1 person, 7 finished');
  });
});

describe('files', () => {
  const version = { slug: 'add', title: 'Add', article_slug: null, permission: null, offer_on: null, mode: 'show' as const, reoffer_from: 1, steps: [], version: 4 };

  it('a version as a file: mode only when it isn’t the default', () => {
    expect(walkthroughFileOf(2, version)).not.toHaveProperty('mode');
    expect(walkthroughFileOf(2, { ...version, mode: 'guide' })).toMatchObject({ number: 2, mode: 'guide' });
    expect(walkthroughFileName(2, version)).toBe('2-add-v4.json');
  });

  const known = { number: 4, slug: 'add', handle: '4-add', title: 'Add', latest_version: 3 };

  it('a new file with no number takes the next one', () => {
    const { title, message } = describeUpload({ title: 'New', steps: [{}] }, null, [known], 'new.json');
    expect(title).toBe('Upload “New”?');
    expect(message).toBe('It is saved as a new walkthrough with the next number, a draft with 1 step. Preview it, then make it live.');
    expect(describeUpload({}, null, [], 'new.json').title).toBe('Upload “new.json”?');
  });

  it('a number nobody has is a new walkthrough with that number', () => {
    expect(describeUpload({ number: 9, steps: [] }, null, [known], 'x').message).toMatch(/^It is saved as walkthrough 9, a new walkthrough: a draft with 0 steps/);
  });

  it('a number in use adds a version, and a new slug renames it', () => {
    const { message } = describeUpload({ number: 4, slug: 'added', steps: [] }, null, [known], 'x');
    expect(message).toBe('It is saved as v4 of walkthrough 4, a draft with 0 steps. It renames 4-add to 4-added. People keep getting the live version until you make this one live.');
  });

  it('into a walkthrough, the file’s number is replaced so it always lands there', () => {
    const { file, title, message } = describeUpload({ number: 7, slug: 'add', steps: [] }, known, [known], 'x');
    expect(file.number).toBe(4);
    expect(title).toBe('Upload a new version of “Add”?');
    expect(message).toContain('The file’s number 7 is replaced by 4.');
  });
});

describe('words for a version change and a preview', () => {
  it('names each', () => {
    expect(versionChangeWords('live', 2)).toMatchObject({ action: 'Make live' });
    expect(versionChangeWords('inactive', 2)).toMatchObject({ action: 'Make inactive' });
    expect(versionChangeWords('draft', 2)).toEqual({ action: 'Restore', message: 'v2 is copied into the next version as a draft. Preview it, then make it live.' });
  });

  it('says where a preview waits, and nothing when it can start', () => {
    expect(previewWaitMessage(null)).toBe('Open any page: the preview starts there.');
    expect(previewWaitMessage('/notes/:noteId')).toBe('Open any page like /notes/:noteId: the preview starts there.');
    expect(previewWaitMessage('/notes')).toBeNull();
  });
});

describe('a step’s edit form', () => {
  const step: WalkthroughStep = { anchor: 'add', title: 'Add', body: 'Add it.', missing: 'centred' };

  it('offers what the step can do', () => {
    expect(stepForm(step)).toEqual({ phone: '', canUse: true, doneChoices: ['clicked', 'filled', 'chosen'] });
    expect(stepForm({ ...step, anchor: null })).toEqual({ phone: '', canUse: false, doneChoices: [] });
    expect(stepForm({ ...step, anchor: null, done_when: { kind: 'appears', anchor: 'x' } }).doneChoices).toEqual(['appears']);
    expect(stepForm({ ...step, phone: { body: 'Tap it.' } }).phone).toBe('Tap it.');
  });

  it('keeps what wasn’t changed', () => {
    const done = { ...step, done_when: { kind: 'filled' as const }, help_after: 9 };
    expect(applyStepForm(done, { title: 'Add', body: 'Add it.', type: 'do', done: 'filled', helpAfter: '9' })).toEqual(done);
  });

  it('changes type, and what goes with it', () => {
    expect(applyStepForm(step, { title: 'A', body: 'B', type: 'do', done: 'chosen', helpAfter: '3' })).toEqual({ ...step, title: 'A', body: 'B', done_when: { kind: 'chosen' } });
    const done = { ...step, done_when: { kind: 'clicked' as const }, help_after: 9 };
    expect(applyStepForm(done, { title: 'Add', body: 'Add it.', type: 'read' })).toEqual(step);
  });

  it('phone words: added, removed, and `skip` left alone', () => {
    expect(applyStepForm(step, { title: 'A', body: 'B', type: 'read', phone: ' Tap it. ' }).phone).toEqual({ body: 'Tap it.' });
    expect(applyStepForm({ ...step, phone: { body: 'Tap' } }, { title: 'A', body: 'B', type: 'read', phone: '' })).not.toHaveProperty('phone');
    expect(applyStepForm({ ...step, phone: 'skip' }, { title: 'A', body: 'B', type: 'read', phone: 'x' }).phone).toBe('skip');
  });

  it('seconds: nothing for the default or for rubbish, and kept in range', () => {
    expect(helpAfterOf('do', '3')).toBeUndefined();
    expect(helpAfterOf('do', 'soon')).toBeUndefined();
    expect(helpAfterOf('read', '9')).toBeUndefined();
    expect(helpAfterOf('do', '500')).toBe(120);
  });

  it('a step editor keeps a file’s article hints, changes them, or takes them all away', () => {
    const file = { slug: 'old', articles: ['a'] };
    expect(editedFile({ file, title: 'T', mode: 'show', steps: [] }).articles).toEqual(['a']);
    expect(editedFile({ file, articles: ['b'], title: 'T', mode: 'show', steps: [] }).articles).toEqual(['b']);
    expect(editedFile({ file, articles: [], title: 'T', mode: 'show', steps: [] })).not.toHaveProperty('articles');
  });

  it('what a step editor saves: the file it came from, or a new slug from the title', () => {
    expect(editedFile({ title: 'Add a note!', mode: 'show', steps: [] })).toEqual({ slug: 'add-a-note', title: 'Add a note!', mode: 'show', steps: [] });
    expect(editedFile({ file: { slug: 'old', number: 2 }, article: 'help', title: 'New', mode: 'guide', steps: [] })).toEqual({ slug: 'old', number: 2, article: 'help', title: 'New', mode: 'guide', steps: [] });
  });
});
