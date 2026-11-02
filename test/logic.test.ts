import { describe, expect, it } from 'vitest';

import { checklistFor, findWalkthrough, matchWalkthroughs, missingRouteParam, parseWalkthroughRef, resumeStep, walkthroughFirstRoute, walkthroughToOffer } from '../src/index.js';
import type { ChecklistRow, Walkthrough, WalkthroughProgress } from '../src/index.js';

const step = { anchor: null, title: 'Sign off', body: 'Body.', missing: 'centred' as const };
const make = (number: number, over: Partial<Walkthrough> = {}): Walkthrough => ({
  walkthrough_id: `id-${number}`,
  number,
  handle: `${number}-w`,
  version: 3,
  slug: 'w',
  title: `Walkthrough ${number}`,
  mode: 'show',
  permission: null,
  offer_on: '/reports',
  reoffer_from: 1,
  article_slug: null,
  steps: [step],
  ...over,
});
const seen = (v: number): WalkthroughProgress => ({ v, status: 'completed', step: 0, at: '2026-10-30T00:00:00Z' });

describe('references', () => {
  it('finds by number, whatever the slug says', () => {
    expect(parseWalkthroughRef('4-old-name')).toEqual({ number: 4 });
    expect(findWalkthrough([make(4)], '4-old-name')?.number).toBe(4);
    expect(parseWalkthroughRef('nope')).toBeNull();
  });
});

describe('walkthroughToOffer', () => {
  const person = (progress: Record<string, WalkthroughProgress> = {}) => ({ progress, can: () => true });

  it('offers on its page to someone who has not seen it', () => {
    expect(walkthroughToOffer([make(1)], '/reports', person())?.number).toBe(1);
    expect(walkthroughToOffer([make(1)], '/files', person())).toBeNull();
  });

  it('a new version stays quiet until reoffer_from is raised', () => {
    expect(walkthroughToOffer([make(1)], '/reports', person({ 'id-1': seen(1) }))).toBeNull();
    expect(walkthroughToOffer([make(1, { reoffer_from: 3 })], '/reports', person({ 'id-1': seen(2) }))?.number).toBe(1);
    expect(walkthroughToOffer([make(1, { reoffer_from: 3 })], '/reports', person({ 'id-1': seen(3) }))).toBeNull();
  });

  it('respects the permission', () => {
    expect(walkthroughToOffer([make(1, { permission: 'sign_off' })], '/reports', { progress: {}, can: () => false })).toBeNull();
  });
});

describe('matchWalkthroughs', () => {
  it('returns JSON for any chat: the best match, and whether it is on this page', () => {
    const list = [make(1, { title: 'Start a report' }), make(2, { title: 'Sign off a report', offer_on: '/sign-off' })];
    const [first] = matchWalkthroughs(list, '/sign-off', 'how to sign off');
    expect(first?.walkthrough.number).toBe(2);
    expect(first?.here).toBe(true);
  });

  it('asking for a tour, like a walkthrough, picks nothing by that word', () => {
    const list = [make(1, { title: 'Tour of the map' }), make(2, { title: 'Add a note' })];
    expect(matchWalkthroughs(list, '/', 'tour add a note').map((m) => m.walkthrough.number)).toEqual([2]);
    expect(matchWalkthroughs(list, '/', 'walkthrough add a note').map((m) => m.walkthrough.number)).toEqual([2]);
  });

  it('a number names one walkthrough', () => {
    expect(matchWalkthroughs([make(1), make(4)], '/', '4').map((m) => m.walkthrough.number)).toEqual([4]);
  });
});

describe('checklistFor', () => {
  const home = '/home';
  const anyone = () => true;
  const done = (list: ChecklistRow<Walkthrough>[]) => list.map((r) => [r.options[0]!.number, r.done]);
  const onReport = { offer_on: '/reports/:reportId', steps: [{ ...step, route: '/reports/:reportId' }] };

  it('lists them by number and ticks the finished ones', () => {
    expect(done(checklistFor([make(2, { offer_on: '/files' }), make(1)], { 'id-1': seen(3) }, anyone, home))).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it('counts only finishing: Finish later and Not now stay to do', () => {
    const list = [make(1), make(2, { offer_on: '/files' })];
    const progress: Record<string, WalkthroughProgress> = {
      'id-1': { ...seen(3), status: 'paused' },
      'id-2': { ...seen(3), status: 'dismissed' },
    };
    expect(done(checklistFor(list, progress, anyone, home))).toEqual([
      [1, false],
      [2, false],
    ]);
  });

  it('a new version keeps the tick; raising reoffer_from takes it away', () => {
    const other = make(2, { offer_on: '/files' });
    expect(done(checklistFor([make(1), other], { 'id-1': seen(2) }, anyone, home))[0]).toEqual([1, true]);
    expect(done(checklistFor([make(1, { reoffer_from: 3 }), other], { 'id-1': seen(2) }, anyone, home))[0]).toEqual([1, false]);
  });

  it('leaves out what the person may not see, so it never stands in the way of finishing', () => {
    const list = [make(1), make(2, { permission: 'sign', offer_on: '/files' })];
    expect(done(checklistFor(list, {}, () => false, home))).toEqual([[1, false]]);
    expect(checklistFor(list, { 'id-1': seen(3) }, () => false, home)).toEqual([]);
    expect(checklistFor(list, {}, anyone, home)).toHaveLength(2);
  });

  it('is empty once all are finished, or there are none', () => {
    expect(checklistFor([make(1)], { 'id-1': seen(3) }, anyone, home)).toEqual([]);
    expect(checklistFor([], {}, anyone, home)).toEqual([]);
  });

  it('leaves the list it was given as it was', () => {
    const list = [make(2), make(1)];
    checklistFor(list, {}, anyone, home);
    expect(list.map((w) => w.number)).toEqual([2, 1]);
  });

  it('makes one row of a Show me and a Guide me on the same page, Guide me first, with the lower number’s title', () => {
    const rows = checklistFor([make(1, { title: 'Start a report' }), make(5, { title: 'Start a report with guidance', mode: 'guide' }), make(2, { offer_on: '/files' })], {}, anyone, home);
    expect(rows.map((r) => r.options.map((o) => o.number))).toEqual([[5, 1], [2]]);
    expect(rows[0]!.title).toBe('Start a report');
  });

  it('ticks the row when either kind is finished', () => {
    const list = [make(1), make(5, { mode: 'guide' }), make(2, { offer_on: '/files' })];
    expect(done(checklistFor(list, { 'id-1': seen(3) }, anyone, home))[0]).toEqual([5, true]);
    expect(done(checklistFor(list, { 'id-5': seen(3) }, anyone, home))[0]).toEqual([5, true]);
    expect(checklistFor([make(1), make(5, { mode: 'guide' })], { 'id-1': seen(3) }, anyone, home)).toEqual([]);
  });

  it('keeps two of the same kind on one page, and those with no page, as separate rows', () => {
    expect(checklistFor([make(1), make(2)], {}, anyone, home)).toHaveLength(2);
    expect(checklistFor([make(1, { offer_on: null }), make(2, { offer_on: null, mode: 'guide' })], {}, anyone, home)).toHaveLength(2);
  });

  it('a row holds only the kinds the person may see', () => {
    const rows = checklistFor([make(1), make(5, { mode: 'guide', permission: 'sign' })], {}, () => false, home);
    expect(rows.map((r) => r.options.map((o) => o.number))).toEqual([[1]]);
  });

  it('leaves out what cannot start from this URL, and is empty when nothing startable is left to do', () => {
    const list = [make(1), make(2, onReport)];
    expect(done(checklistFor(list, {}, anyone, home))).toEqual([[1, false]]);
    expect(checklistFor(list, { 'id-1': seen(3) }, anyone, home)).toEqual([]);
    expect(checklistFor([make(2, onReport)], {}, anyone, home)).toEqual([]);
    expect(checklistFor([make(2, onReport)], {}, anyone, '/reports/r1')).toHaveLength(1);
  });

  it('keeps one that starts anywhere', () => {
    expect(checklistFor([make(1, { offer_on: null })], {}, anyone, home)).toHaveLength(1);
  });
});

describe('starting from a page', () => {
  it('finds the first page a walkthrough needs', () => {
    expect(walkthroughFirstRoute(make(1, { steps: [step, { ...step, route: '/reports/:reportId' }] }))).toBe('/reports/:reportId');
    expect(walkthroughFirstRoute(make(1))).toBeNull();
  });

  it('names the id a page does not give', () => {
    expect(missingRouteParam('/reports/:reportId', '/home')).toBe('reportId');
    expect(missingRouteParam('/reports/:reportId/sign-off', '/reports/r1')).toBeNull();
    expect(missingRouteParam('/reports', '/home')).toBeNull();
  });
});

describe('resumeStep', () => {
  it('picks up a paused walkthrough on the same version only', () => {
    const paused: WalkthroughProgress = { v: 3, status: 'paused', step: 2, at: '2026-10-30T00:00:00Z' };
    expect(resumeStep(make(1), paused)).toBe(2);
    expect(resumeStep(make(1, { version: 4 }), paused)).toBe(0);
  });
});
