import { describe, expect, it } from 'vitest';

import { checklistFor, findWalkthrough, matchRoute, matchWalkthroughs, missingRouteParam, offerSeen, optionIsHere, paramsFromUrl, parseWalkthroughRef, resumeStep, walkthroughFirstRoute, walkthroughIsHere, walkthroughOption, walkthroughToOffer } from '../src/index.js';
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
  it('reofferUnfinished: a walkthrough left part-way is offered again; Done and Not now still stop it', () => {
    const row = (status: WalkthroughProgress['status'], v = 1): Record<string, WalkthroughProgress> => ({ 'id-1': { ...seen(v), status } });
    const on = { reofferUnfinished: true };
    expect(walkthroughToOffer([make(1)], '/reports', person(row('paused')))).toBeNull();
    expect(walkthroughToOffer([make(1)], '/reports', person(row('started')))).toBeNull();
    expect(walkthroughToOffer([make(1)], '/reports', person(row('paused')), on)?.number).toBe(1);
    expect(walkthroughToOffer([make(1)], '/reports', person(row('started')), on)?.number).toBe(1);
    expect(walkthroughToOffer([make(1)], '/reports', person(row('completed')), on)).toBeNull();
    expect(walkthroughToOffer([make(1)], '/reports', person(row('dismissed')), on)).toBeNull();
    // An older version's Done still counts for nothing once reoffer_from is raised.
    expect(walkthroughToOffer([make(1, { reoffer_from: 3 })], '/reports', person(row('completed', 2)), on)?.number).toBe(1);
    expect(offerSeen(make(1), undefined, on)).toBe(false);
  });

  it('reofferUnfinished changes nothing on the checklist: only Done ticks a row', () => {
    const list = [make(1), make(2, { offer_on: '/files' })];
    const progress: Record<string, WalkthroughProgress> = { 'id-1': { ...seen(3), status: 'paused' }, 'id-2': seen(3) };
    expect(checklistFor(list, progress, () => true, '/home').map((r) => r.done)).toEqual([false, true]);
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

// A product can reserve values a `:param` must never capture, so a route never matches a page that
// owns that segment: `/templates/company-style/*` is its own page, not a `/templates/:templateId/*`
// template, so without reserving "company-style" a report-template walkthrough is offered and breaks there.
describe('reserved route params', () => {
  const reserved = { templateId: ['company-style'] };

  it('matchRoute: a :param never captures a reserved value, but real ids still match', () => {
    expect(matchRoute('/templates/:templateId/versions', '/templates/company-style/versions', reserved)).toBeNull();
    expect(matchRoute('/templates/:templateId/versions', '/templates/dsi-interpretive/versions', reserved)).toEqual({ templateId: 'dsi-interpretive' });
    // A literal segment is unaffected; and with nothing reserved it matches as before.
    expect(matchRoute('/templates/company-style/:tab', '/templates/company-style/versions', reserved)).toEqual({ tab: 'versions' });
    expect(matchRoute('/templates/:templateId/versions', '/templates/company-style/versions')).toEqual({ templateId: 'company-style' });
  });

  it('paramsFromUrl / missingRouteParam: a reserved value is not a usable id', () => {
    expect(paramsFromUrl('/templates/:templateId/sections', '/templates/company-style/versions', reserved)).toEqual({});
    expect(missingRouteParam('/templates/:templateId/sections', '/templates/company-style/versions', reserved)).toBe('templateId');
    expect(missingRouteParam('/templates/:templateId/sections', '/templates/dsi/sections', reserved)).toBeNull();
  });

  // The real bug: walkthrough 4 (Report templates, Show me) has a step route /templates/:templateId/versions,
  // which collides with Company style's own Version history tab at /templates/company-style/versions.
  const reportTemplates = make(4, { title: 'Report templates', offer_on: '/templates/:templateId/sections', steps: [{ ...step, route: '/templates/:templateId/versions' }] });
  const companyStyle = make(7, { title: 'Set up Company style', mode: 'guide', offer_on: '/templates/company-style/voice', steps: [{ ...step, route: '/templates/company-style/voice' }] });

  it('walkthroughIsHere: a report-template walkthrough is not "here" on a Company style tab', () => {
    const url = '/templates/company-style/versions';
    expect(walkthroughIsHere(reportTemplates, url)).toBe(true); // the bug, without reserving
    expect(walkthroughIsHere(reportTemplates, url, reserved)).toBe(false); // fixed
    expect(walkthroughIsHere(reportTemplates, '/templates/dsi/versions', reserved)).toBe(true); // a real template still is
  });

  it('matchWalkthroughs: the Company style page does not treat the report-template tour as this page\'s', () => {
    const url = '/templates/company-style/versions';
    expect(matchWalkthroughs([reportTemplates, companyStyle], url, '', reserved).find((m) => m.walkthrough.number === 4)?.here).toBe(false);
  });

  it('walkthroughToOffer and checklistFor respect reserved params', () => {
    // offer_on /templates/:templateId/sections would otherwise fire on /templates/company-style/sections
    const onSections = make(4, { offer_on: '/templates/:templateId/sections', steps: [{ ...step, route: '/templates/:templateId/sections' }] });
    const person = { progress: {}, can: () => true };
    expect(walkthroughToOffer([onSections], '/templates/company-style/sections', person, { reservedParams: reserved })).toBeNull();
    expect(walkthroughToOffer([onSections], '/templates/dsi/sections', person, { reservedParams: reserved })?.number).toBe(4);
    // checklistFor can't "start here" when the only route needs a reserved value as its id
    const list = checklistFor([onSections], {}, () => true, '/templates/company-style/sections', reserved);
    expect(list).toEqual([]);
  });

  it('optionIsHere respects reserved params', () => {
    const option = walkthroughOption(reportTemplates);
    expect(optionIsHere(option, '/templates/company-style/versions')).toBe(true); // without reserving
    expect(optionIsHere(option, '/templates/company-style/versions', reserved)).toBe(false); // fixed
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
