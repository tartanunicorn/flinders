import { describe, expect, it, vi } from 'vitest';

import { appChecks, createFlinders, FlindersError, type FlindersPerson, type FlindersQuery } from '../src/server.js';

const app = { anchorExists: () => true, routeExists: () => true };
const tables = { versions: 'walkthroughs', progress: 'walkthroughs_progress' };
const person: FlindersPerson = { id: 'p1' };
const admin: FlindersPerson = { id: 'a1', admin: true };

/** No database: enough for what's decided before a query, and to see that a query was never made. */
const noQuery: FlindersQuery = async () => {
  throw new Error('no query expected');
};

describe('createFlinders on the server', () => {
  const flinders = createFlinders({ query: noQuery, tables, app });

  it('finds routes, and answers in the contract’s error shape', async () => {
    expect(await flinders.handle({ method: 'GET', path: '/nope', person })).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
    expect(await flinders.handle({ method: 'PUT', path: '/walkthroughs', person })).toMatchObject({ status: 405, body: { error: { code: 'method_not_allowed' } } });
  });

  it('wants someone signed in, and an admin for the admin routes', async () => {
    expect(await flinders.handle({ method: 'GET', path: '/progress', person: null })).toMatchObject({ status: 401, body: { error: { code: 'unauthorized' } } });
    expect(await flinders.handle({ method: 'GET', path: '/admin/walkthroughs', person })).toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
  });

  it('says what’s wrong with a body before it touches the database', async () => {
    const event = await flinders.handle({ method: 'POST', path: '/walkthroughs/0192f3a1-0000-7000-8000-000000000001/events', person, body: { event: 'jumped', version: 1, step: 0 } });
    expect(event).toMatchObject({ status: 400, body: { error: { code: 'validation_failed' } } });
    expect((event.body as { error: { message: string } }).error.message).toMatch(/^event: /);
  });

  it('answers not found for an event on something that isn’t a walkthrough id', async () => {
    expect(await flinders.handle({ method: 'POST', path: '/walkthroughs/42/events', person, body: {} })).toMatchObject({ status: 404 });
  });

  it('takes nothing but a query: the tables have their usual names and anything may be pointed at', () => {
    expect(() => createFlinders({ query: noQuery })).not.toThrow();
  });

  it('treats a broken address as no such route, not a crash', async () => {
    const answer = await flinders.handle({ method: 'GET', path: '/admin/walkthroughs/%E0%A4%A', person: { id: 'p', admin: true } });
    expect(answer.status).toBe(404);
  });

  it('turns lists into checks: a bound element by its fixed start, a page with any value for a :param', () => {
    const checks = appChecks({ anchors: ['save', 'open-*'], pages: ['/projects/:id', '/'] });
    expect(['save', 'open-3', 'open-', 'other'].map(checks.anchorExists)).toEqual([true, true, false, false]);
    expect(['/projects/3', '/projects/:projectId', '/', '/projects', '/other/3'].map(checks.routeExists)).toEqual([true, true, true, false, false]);
    expect(appChecks().anchorExists('anything')).toBe(true);
    expect(appChecks().routeExists('/anywhere')).toBe(true);
  });

  it('says what’s off rather than failing', async () => {
    expect(await flinders.handle({ method: 'PATCH', path: '/offers', person, body: { offer_walkthroughs: false } })).toMatchObject({ status: 501, body: { error: { code: 'feature_off' } } });
    expect(await flinders.handle({ method: 'POST', path: '/admin/recording-links', person: admin })).toMatchObject({ status: 501 });
    await expect(flinders.draft({ source: { title: 'T', body: 'B' }, mode: 'show' })).rejects.toBeInstanceOf(FlindersError);
  });

  it('throws what it doesn’t recognise, for the product’s own error handling', async () => {
    await expect(flinders.handle({ method: 'GET', path: '/walkthroughs', person })).rejects.toThrow('no query expected');
  });

  it('reads as the person when they carry a query', async () => {
    const own = vi.fn<FlindersQuery>(async () => []);
    await flinders.list({ id: 'p1', query: own });
    expect(own).toHaveBeenCalledOnce();
  });

  it('tells events about a link it made, and words a refused one with the product’s words', async () => {
    const events = vi.fn();
    const withRecording = createFlinders({ query: noQuery, tables, app, events, recording: { secret: 's', webUrl: 'https://app.example.com', mayRecord: (p) => !!p.admin, refused: { invalid: 'Bad link.' } } });
    const made = await withRecording.handle({ method: 'POST', path: '/admin/recording-links', person: admin });
    expect(made.status).toBe(201);
    expect((made.body as { url: string }).url).toMatch(/^https:\/\/app\.example\.com\/#flinders_record=/);
    expect(events).toHaveBeenCalledWith({ type: 'recording_link_created', person: admin });
    const refused = await withRecording.handle({ method: 'POST', path: '/recording-links/drafts', person: admin, body: { link: 'nonsense', steps: [{}] } });
    expect(refused).toEqual({ status: 403, body: { error: { code: 'forbidden', message: 'Bad link.' } } });
  });

  it('drafts through the product’s ask, offering only the anchors it has', async () => {
    const ask = vi.fn(async () => ({ title: 'T', steps: [{ anchor: null, title: 'T', body: 'B', missing: 'centred' }] }));
    const drafting = createFlinders({ query: noQuery, tables, app: { ...app, anchors: ['save'] }, ask } as Parameters<typeof createFlinders>[0]);
    const { file } = await drafting.draft({ source: { title: 'T', body: 'B' }, mode: 'show' });
    expect(file.steps).toHaveLength(1);
    expect(JSON.stringify(ask.mock.calls[0])).toContain('save');
  });
});
