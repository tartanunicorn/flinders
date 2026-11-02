import { describe, expect, it } from 'vitest';

import { openFirstReason, optionIsHere, parseWalkthroughRequest, walkthroughAnswer, type Walkthrough } from '../src/index.js';

describe('parseWalkthroughRequest', () => {
  const w = (topic: string) => ({ topic });

  it('reads a request', () => {
    expect(parseWalkthroughRequest('show me')).toEqual(w(''));
    expect(parseWalkthroughRequest('Walkthroughs?')).toEqual(w(''));
    expect(parseWalkthroughRequest('restart the walkthrough')).toEqual(w(''));
    expect(parseWalkthroughRequest('demo')).toEqual(w(''));
    expect(parseWalkthroughRequest('walkthrough on  adding a note')).toEqual(w('adding a note'));
    expect(parseWalkthroughRequest('show me how to add a note.')).toEqual(w('add a note'));
  });

  it('by number or handle', () => {
    expect(parseWalkthroughRequest('walkthrough 4')).toEqual(w('4'));
    expect(parseWalkthroughRequest('Start walkthrough #2?')).toEqual(w('2'));
    expect(parseWalkthroughRequest('show me walkthrough 4-add-a-note')).toEqual(w('4-add-a-note'));
  });

  it('"guide me" asks for the doing kind', () => {
    expect(parseWalkthroughRequest('guide me')).toEqual({ topic: '', mode: 'guide' });
    expect(parseWalkthroughRequest('please guide me through adding a note')).toEqual({ topic: 'adding a note', mode: 'guide' });
  });

  it('leaves everything else alone', () => {
    expect(parseWalkthroughRequest('what is a note?')).toBeNull();
    expect(parseWalkthroughRequest('show me the notes page')).toBeNull();
    expect(parseWalkthroughRequest('show me the tour again')).toEqual({ topic: '' });
    expect(parseWalkthroughRequest('')).toBeNull();
  });
});

describe('walkthroughAnswer', () => {
  const w = (over: Partial<Walkthrough> = {}) => ({ handle: '1-add', title: 'Add a note', mode: 'show' as const, offer_on: '/notes', steps: [], ...over });
  const show = { walkthrough: w(), here: true };
  const guide = { walkthrough: w({ handle: '2-add', mode: 'guide' }), here: false };

  it('says so when nothing matches', () => {
    expect(walkthroughAnswer([], { topic: 'a dog' })).toEqual({ text: 'There’s no walkthrough about “a dog” yet. Say “show me” to see them all.', options: [] });
    expect(walkthroughAnswer([], { topic: '' }).text).toBe('There are no walkthroughs yet.');
  });

  it('gives one button per walkthrough, with what it needs to work out here and now', () => {
    const { options, text } = walkthroughAnswer([show], { topic: '' });
    expect(text).toBe('Here’s the walkthrough. It starts from the beginning.');
    expect(options).toEqual([{ id: '1-add', title: 'Add a note', label: 'Show me', routes: ['/notes'], firstRoute: null }]);
    expect(optionIsHere(options[0]!, '/notes')).toBe(true);
    expect(optionIsHere(options[0]!, '/people')).toBe(false);
  });

  it('words the list by what was asked', () => {
    expect(walkthroughAnswer([show, guide], { topic: 'add' }).text).toMatch(/^Best match first/);
    expect(walkthroughAnswer([show, guide], { topic: '' }).text).toMatch(/^This page’s walkthrough first/);
    expect(walkthroughAnswer([{ ...show, here: false }, guide], { topic: '' }).text).toMatch(/^Here they are/);
  });

  it('"guide me" takes the doing kind, and the reading kind only when there is none', () => {
    expect(walkthroughAnswer([show, guide], { topic: '', mode: 'guide' }).options.map((o) => o.label)).toEqual(['Guide me']);
    expect(walkthroughAnswer([show], { topic: '', mode: 'guide' }).options.map((o) => o.label)).toEqual(['Show me']);
  });
});

describe('openFirstReason', () => {
  it('says what to open first, from the product’s own words, else in general', () => {
    expect(openFirstReason('/notes/:noteId', '/people', { noteId: 'Open a note first.' })).toBe('Open a note first.');
    expect(openFirstReason('/notes/:noteId', '/people')).toBe('Open the page it’s about first.');
    expect(openFirstReason('/notes/:noteId', '/notes/12', { noteId: 'Open a note first.' })).toBeNull();
    expect(openFirstReason(null, '/people')).toBeNull();
  });
});
