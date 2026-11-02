/**
 * The repository against real Postgres, on the starter tables in a throwaway schema. Needs
 * FLINDERS_TEST_DATABASE_URL; without it these are skipped.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRecordingLink, createWalkthroughRepository, fillRecordedWords, WalkthroughFileError, type FlindersQuery } from '../src/server.js';

const url = process.env['FLINDERS_TEST_DATABASE_URL'];
const SQL = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'sql', '001_walkthroughs.sql'), 'utf8');
const schema = `wt_test_${randomUUID().slice(0, 8)}`;

const repo = createWalkthroughRepository({
  tables: { versions: 'walkthroughs', progress: 'walkthroughs_progress' },
  app: { anchorExists: (id) => id !== 'gone', routeExists: (route) => route.startsWith('/') },
});
const file = (over: object = {}) => ({
  slug: 'add-a-project',
  title: 'Add a project',
  offer_on: '/projects',
  status: 'live',
  steps: [
    { anchor: 'add', title: 'Add', body: 'Tap add.', missing: 'centred' },
    { anchor: 'name', title: 'Name', body: 'Type a name.', missing: 'centred' },
  ],
  ...over,
});

describe.skipIf(!url)('repository on Postgres', () => {
  let client: pg.Client;
  let q: FlindersQuery;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}; SET search_path = ${schema}, public;`);
    await client.query(SQL);
    q = async (text, params) => (await client.query(text, params as unknown[])).rows;
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA ${schema} CASCADE`);
    await client.end();
  });

  it('numbers walkthroughs, serves the newest non-draft, and leaves a later draft behind it', async () => {
    const first = await repo.saveFile(q, file(), { createdBy: 'person-1' });
    expect(first).toMatchObject({ number: 1, version: 1, handle: '1-add-a-project', saved: true });
    await repo.saveFile(q, file({ number: 1, title: 'Add a project, edited' }), { createdBy: 'person-1', status: 'draft' });
    const [served] = await repo.served(q);
    expect(served).toMatchObject({ version: 1, title: 'Add a project', mode: 'show', reoffer_from: 1 });
  });

  it('keeps every version: Make live and Restore copy one forward, and rows can’t be edited', async () => {
    const id = (await repo.resolve(q, '1-old-name'))!;
    const copied = await repo.copyVersion(q, id, 2, 'live', 'person-1');
    expect(copied).toMatchObject({ version: 3, status: 'live' });
    expect((await repo.served(q))[0]).toMatchObject({ version: 3, title: 'Add a project, edited' });
    const detail = await repo.adminDetail(q, id);
    expect(detail!.versions.map((v) => [v.version, v.status])).toEqual([[3, 'live'], [2, 'draft'], [1, 'live']]);
    await expect(q(`UPDATE walkthroughs SET version = 9 WHERE walkthrough_id = $1`, [id])).rejects.toThrow(/append-only/);
  });

  it('won’t make a version live while it holds a recording’s placeholder words, and says which steps', async () => {
    const steps = [
      { anchor: 'add', title: 'Add', body: 'Tap add.', missing: 'centred' },
      ...fillRecordedWords([{ anchor: 'name', missing: 'centred' }, { anchor: 'add', title: 'Written', missing: 'centred' }]),
    ];
    const draft = await repo.saveFile(q, file({ slug: 'recorded', status: 'draft', steps }), { createdBy: null });
    const live = repo.copyVersion(q, draft.walkthrough_id, 1, 'live', null);
    await expect(live).rejects.toThrow(WalkthroughFileError);
    await expect(live).rejects.toThrow('steps 2, 3 still have the placeholder words from recording');
    expect((await repo.adminDetail(q, draft.walkthrough_id))!.versions).toHaveLength(1);

    // Only live is refused, and a version with its words written goes live.
    expect(await repo.copyVersion(q, draft.walkthrough_id, 1, 'inactive', null)).toMatchObject({ version: 2, status: 'inactive' });
    const written = await repo.saveFile(q, file({ number: draft.number, slug: 'recorded', status: 'draft' }), { createdBy: null });
    expect(await repo.copyVersion(q, draft.walkthrough_id, written.version, 'live', null)).toMatchObject({ status: 'live' });
  });

  it('carries mode and reoffer_from forward, and a seed run with nothing new saves nothing', async () => {
    const hinted = await repo.saveFile(q, file({ number: 6, slug: 'hinted', status: 'live', articles: ['https://help.example.com/a'] }), { createdBy: null });
    expect((await repo.served(q)).find((w) => w.number === hinted.number)?.articles).toEqual(['https://help.example.com/a']);
    expect((await repo.saveFile(q, file({ number: 6, slug: 'hinted', status: 'live', articles: ['https://help.example.com/a'] }), { createdBy: null, skipIfSame: true })).saved).toBe(false);
    expect((await repo.adminDetail(q, hinted.walkthrough_id))?.versions[0]?.articles).toEqual(['https://help.example.com/a']);
    const saved = await repo.saveFile(q, file({ number: 7, slug: 'guided', mode: 'guide', reoffer_from: 1 }), { createdBy: null });
    const next = await repo.saveFile(q, file({ number: 7, slug: 'guided', title: 'Edited' }), { createdBy: null });
    expect(next.version).toBe(saved.version + 1);
    const again = await repo.saveFile(q, file({ number: 7, slug: 'guided', title: 'Edited' }), { createdBy: null, skipIfSame: true });
    expect(again.saved).toBe(false);
    expect((await repo.adminDetail(q, saved.walkthrough_id))!.versions[0]).toMatchObject({ mode: 'guide' });
  });

  it('refuses what the product says isn’t there', async () => {
    await expect(repo.saveFile(q, file({ steps: [{ anchor: 'gone', title: 'Gone', body: 'Gone.', missing: 'centred' }] }), { createdBy: null })).rejects.toThrow(WalkthroughFileError);
    await expect(
      repo.saveFile(q, file({ steps: [{ anchor: 'add', title: 'Add', body: 'Add.', done_when: { kind: 'appears', anchor: 'gone' }, missing: 'centred' }] }), { createdBy: null }),
    ).rejects.toThrow(/done-when element/);
  });

  it('keeps one progress row per person, how far they got, and what they did', async () => {
    const id = (await repo.resolve(q, '1'))!;
    await repo.saveProgress(q, 'person-1', id, { version: 3, status: 'started', step: 0 });
    await repo.saveStep(q, 'person-1', id, { version: 3, step: 1, how: 'done' });
    await repo.saveStep(q, 'person-1', id, { version: 3, step: 0, how: 'back' });
    await repo.saveProgress(q, 'person-1', id, { version: 3, status: 'paused', step: 0 });
    await repo.saveProgress(q, 'person-2', id, { version: 3, status: 'completed', step: 1 });

    expect(await repo.progressOf(q, 'person-1')).toMatchObject({ [id]: { v: 3, status: 'paused', step: 0 } });
    expect(await repo.stats(q, id, 2)).toEqual({ people: 2, finished: 1, reached: [2, 2], actions_done: 1 });
    expect(await q(`SELECT 1 FROM walkthroughs_progress WHERE user_id = 'person-1'`)).toHaveLength(1);
  });

  it('records an event: progress or a step, and says when there is no such walkthrough or version', async () => {
    const id = (await repo.resolve(q, '1'))!;
    const event = (over: object) => ({ event: 'started' as const, version: 3, step: 0, ...over });
    expect(await repo.recordEvent(q, q, 'person-5', randomUUID(), event({}))).toBe('not_found');
    expect(await repo.recordEvent(q, q, 'person-5', id, event({ version: 999 }))).toBe('no_such_version');
    expect(await repo.progressOf(q, 'person-5')).toEqual({});
    expect(await repo.recordEvent(q, q, 'person-5', id, event({}))).toBe('saved');
    expect(await repo.recordEvent(q, q, 'person-5', id, event({ event: 'step', step: 1 }))).toBe('saved');
    expect((await repo.progressOf(q, 'person-5'))[id]).toMatchObject({ status: 'started', step: 1 });
  });

  it('a person’s own: the switch is on unless it’s false', async () => {
    expect(await repo.mine(q, 'nobody', null)).toEqual({ offer_walkthroughs: true, progress: {} });
    expect((await repo.mine(q, 'nobody', { offer_walkthroughs: 'no' })).offer_walkthroughs).toBe(true);
    expect((await repo.mine(q, 'nobody', { offer_walkthroughs: false })).offer_walkthroughs).toBe(false);
  });

  it('a recording saves a new draft for the link’s creator, and a bad link saves nothing', async () => {
    const secret = 'test-secret';
    const { link } = createRecordingLink('person-6', { secret });
    const steps = [{ anchor: 'add', title: '', body: '', missing: 'centred' }];
    const yes = { id: 'person-6', mayRecord: () => true };
    const before = (await repo.adminList(q)).length;
    expect(await repo.saveRecording(q, link, { id: 'person-7', mayRecord: () => true }, steps, { secret })).toEqual({ refused: 'not_allowed' });
    expect(await repo.saveRecording(q, 'bad.link', yes, steps, { secret })).toEqual({ refused: 'invalid' });
    expect(await repo.adminList(q)).toHaveLength(before);
    const result = await repo.saveRecording(q, link, yes, steps, { secret });
    expect(result).toMatchObject({ created_by: 'person-6', saved: { version: 1 } });
    expect((await repo.adminList(q)).find((w) => 'saved' in result && w.walkthrough_id === result.saved.walkthrough_id)).toMatchObject({ latest_status: 'draft' });
  });

  it('Not now never takes back a finish, and still remembers the version seen', async () => {
    const id = (await repo.resolve(q, '1'))!;
    await repo.saveProgress(q, 'person-3', id, { version: 2, status: 'completed', step: 1 });
    await repo.saveProgress(q, 'person-3', id, { version: 3, status: 'dismissed', step: 0 });
    expect(await repo.progressOf(q, 'person-3')).toMatchObject({ [id]: { v: 3, status: 'completed', step: 1 } });

    await repo.saveProgress(q, 'person-3', id, { version: 3, status: 'paused', step: 0 });
    expect(await repo.progressOf(q, 'person-3')).toMatchObject({ [id]: { status: 'paused', step: 0 } });
    await repo.saveProgress(q, 'person-3', id, { version: 3, status: 'dismissed', step: 0 });
    expect(await repo.progressOf(q, 'person-3')).toMatchObject({ [id]: { status: 'dismissed' } });
  });

  describe('owners', () => {
    it('lets two owners use the same number, each drawing their own next one', async () => {
      const a = await repo.saveFile(q, file({ slug: 'a-first' }), { createdBy: null, owner: 'owner-a' });
      const b = await repo.saveFile(q, file({ slug: 'b-first' }), { createdBy: null, owner: 'owner-b' });
      expect(a).toMatchObject({ number: 1, version: 1, handle: '1-a-first' });
      expect(b).toMatchObject({ number: 1, version: 1, handle: '1-b-first' });
      expect(b.walkthrough_id).not.toBe(a.walkthrough_id);
      expect(await repo.resolve(q, '1', 'owner-a')).toBe(a.walkthrough_id);
      expect(await repo.resolve(q, '1', 'owner-b')).toBe(b.walkthrough_id);

      const explicit = await repo.saveFile(q, file({ number: 40, slug: 'a-forty' }), { createdBy: null, owner: 'owner-a' });
      expect(explicit.number).toBe(40);
      expect((await repo.saveFile(q, file({ slug: 'a-next' }), { createdBy: null, owner: 'owner-a' })).number).toBe(41);
      expect((await repo.saveFile(q, file({ slug: 'b-next' }), { createdBy: null, owner: 'owner-b' })).number).toBe(2);
    });

    it('never shows one owner the other’s, nor the product’s, and the default stays the product’s own', async () => {
      const slugs = async (owner?: string) => (await repo.adminList(q, owner)).map((w) => w.slug);
      expect(await slugs('owner-a')).toEqual(['a-first', 'a-forty', 'a-next']);
      expect(await slugs('owner-b')).toEqual(['b-first', 'b-next']);
      expect(await slugs('owner-nobody')).toEqual([]);
      const own = await slugs();
      expect(own).toContain('guided');
      expect(own.filter((slug) => /^[ab]-/.test(slug))).toEqual([]);

      const a = (await repo.resolve(q, '1', 'owner-a'))!;
      const product = (await repo.resolve(q, '1'))!;
      expect(a).not.toBe(product);
      expect(await repo.resolve(q, a, 'owner-b')).toBeNull();
      expect(await repo.resolve(q, a)).toBeNull();
      expect(await repo.resolve(q, product, 'owner-a')).toBeNull();
      expect(await repo.adminDetail(q, a, 'owner-b')).toBeNull();
      expect(await repo.adminDetail(q, a)).toBeNull();
      expect((await repo.adminDetail(q, a, 'owner-a'))!.number).toBe(1);
      expect(await repo.copyVersion(q, a, 1, 'inactive', null, 'owner-b')).toBeNull();
      expect(await repo.copyVersion(q, a, 1, 'inactive', null)).toBeNull();
    });

    it('saves a number’s next version inside its owner, keeping the owner on every copy', async () => {
      const a = (await repo.resolve(q, '1', 'owner-a'))!;
      const b = (await repo.resolve(q, '1', 'owner-b'))!;
      const next = await repo.saveFile(q, file({ number: 1, slug: 'a-renamed' }), { createdBy: 'person-1', status: 'draft', owner: 'owner-a' });
      expect(next).toMatchObject({ walkthrough_id: a, number: 1, version: 2, handle: '1-a-renamed' });
      expect((await repo.adminDetail(q, b, 'owner-b'))!.versions).toHaveLength(1);

      const copied = await repo.copyVersion(q, a, 2, 'live', 'person-1', 'owner-a');
      expect(copied).toMatchObject({ walkthrough_id: a, number: 1, version: 3, status: 'live' });
      expect((await repo.adminDetail(q, a, 'owner-a'))!.versions.map((v) => [v.version, v.status])).toEqual([[3, 'live'], [2, 'draft'], [1, 'live']]);
      expect((await q(`SELECT DISTINCT owner_id FROM walkthroughs WHERE walkthrough_id = $1`, [a])).map((r) => r.owner_id)).toEqual(['owner-a']);
      expect((await repo.adminList(q, 'owner-a'))[0]).toMatchObject({ handle: '1-a-renamed', live_version: 3 });

      // A number another owner uses, new to this one, starts a walkthrough here.
      const fresh = await repo.saveFile(q, file({ number: 40, slug: 'b-forty' }), { createdBy: null, owner: 'owner-b' });
      expect(fresh).toMatchObject({ number: 40, version: 1 });
      expect(fresh.walkthrough_id).not.toBe(await repo.resolve(q, '40', 'owner-a'));
    });

    it('refuses a second walkthrough with an owner’s number, but only that owner’s', async () => {
      await expect(q(`INSERT INTO walkthroughs (owner_id, number, version, definition) VALUES ('owner-a', 1, 1, '{"status":"draft"}')`)).rejects.toThrow(/walkthroughs_number_key/);
      await expect(q(`INSERT INTO walkthroughs (owner_id, number, version, definition) VALUES (NULL, 1, 1, '{"status":"draft"}')`)).rejects.toThrow(/walkthroughs_number_key/);
      await q(`INSERT INTO walkthroughs (owner_id, number, version, definition) VALUES ('owner-c', 1, 1, '{"status":"draft"}')`);
    });

    it('treats the owner column as text: an empty owner is not the product’s own', async () => {
      const empty = await repo.saveFile(q, file({ slug: 'empty-owner' }), { createdBy: null, owner: '' });
      expect(empty).toMatchObject({ number: 1, version: 1 });
      expect(empty.walkthrough_id).not.toBe(await repo.resolve(q, '1'));
      expect((await repo.adminList(q, '')).map((w) => w.slug)).toEqual(['empty-owner']);
      expect((await repo.adminList(q)).map((w) => w.slug)).not.toContain('empty-owner');
    });

    it('finds an owner’s own article first, then the product’s, and never another owner’s', async () => {
      await q(`CREATE TABLE articles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text, slug text NOT NULL, title text NOT NULL, deleted_at timestamptz)`);
      await q(`ALTER TABLE walkthroughs ADD COLUMN article_id uuid REFERENCES articles(id)`);
      const product = (await q(`INSERT INTO articles (owner_id, slug, title) VALUES (NULL, 'shared', 'Product') RETURNING id`))[0].id as string;
      const own = (await q(`INSERT INTO articles (owner_id, slug, title) VALUES ('owner-a', 'shared', 'Own') RETURNING id`))[0].id as string;
      await q(`INSERT INTO articles (owner_id, slug, title) VALUES ('owner-a', 'only-a', 'Only a')`);
      const withArticles = createWalkthroughRepository({
        tables: { versions: 'walkthroughs', progress: 'walkthroughs_progress' },
        articles: { table: 'articles' },
        app: { anchorExists: () => true, routeExists: () => true },
      });
      const article = async (id: string) => (await q(`SELECT article_id FROM walkthroughs WHERE id = $1`, [id]))[0].article_id as string;

      const a = await withArticles.saveFile(q, file({ slug: 'a-article', article: 'shared' }), { createdBy: null, owner: 'owner-a' });
      const b = await withArticles.saveFile(q, file({ slug: 'b-article', article: 'shared' }), { createdBy: null, owner: 'owner-b' });
      const mine = await withArticles.saveFile(q, file({ slug: 'product-article', article: 'shared' }), { createdBy: null });
      expect(await article(a.walkthrough_id)).toBe(own);
      expect(await article(b.walkthrough_id)).toBe(product);
      expect(await article(mine.walkthrough_id)).toBe(product);
      await expect(withArticles.saveFile(q, file({ article: 'only-a' }), { createdBy: null, owner: 'owner-b' })).rejects.toThrow(WalkthroughFileError);
      await expect(withArticles.saveFile(q, file({ article: 'only-a' }), { createdBy: null })).rejects.toThrow(WalkthroughFileError);
    });
  });
});
