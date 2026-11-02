/**
 * The conformance kit: drives a Flinders backend, in any language, through every route and rule of
 * the contract (contract/openapi.yaml, docs/server-contract.md) over plain HTTP. It knows nothing of
 * how the backend is built, and imports nothing but node. Every rule adds its own walkthroughs and
 * nothing is removed, so point it at a test database.
 */
import { createHmac, randomBytes } from 'node:crypto';

/** The contract's routes. A test keeps this the same as contract/openapi.yaml. */
export const CONTRACT_ROUTES = {
  listWalkthroughs: ['GET', '/walkthroughs'],
  getMyProgress: ['GET', '/progress'],
  setOffers: ['PATCH', '/offers'],
  recordEvent: ['POST', '/walkthroughs/{walkthroughId}/events'],
  checkRecordingLink: ['POST', '/recording-links/check'],
  saveRecording: ['POST', '/recording-links/drafts'],
  adminList: ['GET', '/admin/walkthroughs'],
  adminUpload: ['POST', '/admin/walkthroughs'],
  adminDetail: ['GET', '/admin/walkthroughs/{walkthroughId}'],
  adminSaveVersion: ['POST', '/admin/walkthroughs/{walkthroughId}/versions'],
  adminStats: ['GET', '/admin/walkthroughs/{walkthroughId}/stats'],
  adminCreateRecordingLink: ['POST', '/admin/recording-links'],
} as const;

export type ContractRoute = keyof typeof CONTRACT_ROUTES;

/**
 * The test users. `admin` manages the product's own walkthroughs and may record; `person` and
 * `person2` are ordinary people of the product's own. `otherAdmin` manages another owner's: without
 * one, the rules about owners are skipped.
 */
export type TestUser = 'admin' | 'person' | 'person2' | 'otherAdmin';

export interface ConformanceOptions {
  /** The backend, base included: `http://localhost:3000/flinders`. */
  url: string;
  /** Headers that sign this user in; null = there's no such user. */
  signIn(user: TestUser): Promise<Record<string, string> | null> | Record<string, string> | null;
  /** A backend's own paths, where they differ. Null = it doesn't serve that route. */
  paths?: Partial<Record<ContractRoute, string | null>>;
  /** Signs an expired link for the expiry rule, when the backend uses the contract's link format. */
  recordingSecret?: string;
  /** Or: turns a good link into an expired one, for a backend with its own format. */
  expireLink?(link: string): string | Promise<string>;
  /** Sees every answer: for checking shapes, or logging. */
  onResponse?(route: ContractRoute, status: number, body: unknown): void;
  /** A permission the backend accepts on a walkthrough, for one that checks them against its own list. */
  permission?: string;
  /** A page the backend accepts as `offer_on`, for one that checks them against its own routes. */
  offerOn?: string;
  /** Only rules whose id starts with one of these. */
  only?: readonly string[];
}

export interface RuleResult {
  id: string;
  title: string;
  status: 'passed' | 'failed' | 'skipped';
  /** What was wrong, or why it was skipped. */
  detail?: string;
}

export interface ConformanceReport {
  ok: boolean;
  passed: number;
  failed: number;
  skipped: number;
  results: RuleResult[];
}

// The kit reads whatever a backend answers: its checks are the types here.
type Json = any;

interface Answer {
  status: number;
  body: Json;
}

class Failure extends Error {}
class Skip extends Error {}

/** An id nothing has: well-formed, for a backend that checks. */
const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000';
const NO_SUCH_NUMBER = '999999998';
/** The words a recording saves a step with. */
const UNWRITTEN_TITLE = 'Untitled step';
const UNWRITTEN_BODY = 'Say what to do here.';

function fail(message: string): never {
  throw new Failure(message);
}

function same(actual: unknown, expected: unknown, what: string): void {
  const [a, e] = [JSON.stringify(actual), JSON.stringify(expected)];
  if (a !== e) fail(`${what}: expected ${e}, got ${a}`);
}

function isTrue(value: unknown, what: string): void {
  if (!value) fail(what);
}

/** Said to a person: short, and no code in it. */
function plainWords(message: unknown, what: string): void {
  if (typeof message !== 'string' || !message.trim()) fail(`${what}: no message`);
  const text = message as string;
  if (text.length > 400 || /[{}]|\bSELECT\b|\bINSERT\b|Exception|Error:|\bat .*:\d+|stack/.test(text)) fail(`${what}: not in plain words: ${text.slice(0, 200)}`);
}

function refused(answer: Answer, status: number, code: string, what: string): void {
  if (answer.status !== status) fail(`${what}: expected ${status}, got ${answer.status} ${JSON.stringify(answer.body)?.slice(0, 200)}`);
  same(answer.body?.error?.code, code, `${what}: error code`);
  plainWords(answer.body?.error?.message, what);
}

function ok(answer: Answer, what: string, status = 200): Json {
  if (answer.status !== status) fail(`${what}: expected ${status}, got ${answer.status} ${JSON.stringify(answer.body)?.slice(0, 300)}`);
  return answer.body;
}

/** A signed link's payload with the time gone by, signed again: the contract's format. */
function expireSigned(link: string, secret: string): string {
  const [payload] = link.split('.');
  const claims = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  const late = Buffer.from(JSON.stringify({ ...claims, exp: Date.now() - 60_000 })).toString('base64url');
  return `${late}.${createHmac('sha256', secret).update(`walkthrough-recording.${late}`).digest('base64url')}`;
}

/** What each rule works with. */
class Kit {
  private readonly run = randomBytes(4).toString('hex');
  private files = 0;
  private readonly signedIn = new Map<TestUser, Record<string, string> | null>();

  constructor(readonly options: ConformanceOptions) {}

  serves(route: ContractRoute): boolean {
    return this.options.paths?.[route] !== null;
  }

  async call(headers: Record<string, string>, route: ContractRoute, input: { id?: string; body?: unknown } = {}): Promise<Answer> {
    const [method, contractPath] = CONTRACT_ROUTES[route];
    const path = this.options.paths?.[route] ?? contractPath;
    const url = `${this.options.url.replace(/\/$/, '')}${path.replace('{walkthroughId}', encodeURIComponent(input.id ?? ''))}`;
    const response = await fetch(url, {
      method,
      headers: { accept: 'application/json', ...(input.body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
    const text = await response.text();
    let body: Json = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* Not JSON: a rule's own check says so. */
    }
    this.options.onResponse?.(route, response.status, body);
    return { status: response.status, body };
  }

  private async user(user: TestUser): Promise<Record<string, string>> {
    if (!this.signedIn.has(user)) this.signedIn.set(user, await this.options.signIn(user));
    const headers = this.signedIn.get(user);
    if (!headers) throw new Skip(`needs the ${user} test user`);
    return headers;
  }

  async as(user: TestUser, route: ContractRoute, input?: { id?: string; body?: unknown }): Promise<Answer> {
    return this.call(await this.user(user), route, input);
  }

  file(over: Record<string, unknown> = {}): Record<string, unknown> {
    this.files += 1;
    return {
      slug: `conformance-${this.run}-${this.files}`,
      title: `Conformance ${this.files}`,
      steps: [1, 2, 3].map((n) => ({ anchor: null, title: `Step ${n}`, body: `Read step ${n}.`, missing: 'centred' })),
      ...over,
    };
  }

  async upload(over: Record<string, unknown> = {}, user: TestUser = 'admin'): Promise<Json> {
    return ok(await this.as(user, 'adminUpload', { body: this.file(over) }), 'upload', 201);
  }

  async copy(saved: { walkthrough_id: string }, from: number, status: string, user: TestUser = 'admin'): Promise<Json> {
    return ok(await this.as(user, 'adminSaveVersion', { id: saved.walkthrough_id, body: { from_version: from, status } }), `save v${from} as ${status}`, 201);
  }

  /** A new walkthrough with a live version: v1 draft, v2 live. */
  async live(over: Record<string, unknown> = {}, user: TestUser = 'admin'): Promise<Json> {
    return this.copy(await this.upload(over, user), 1, 'live', user);
  }

  async detail(id: string, user: TestUser = 'admin'): Promise<Json> {
    return ok(await this.as(user, 'adminDetail', { id }), 'detail');
  }

  async served(id: string, user: TestUser = 'person'): Promise<Json | undefined> {
    return (ok(await this.as(user, 'listWalkthroughs'), 'list').data as Json[]).find((w) => w.walkthrough_id === id);
  }

  async listed(id: string, user: TestUser = 'admin'): Promise<Json | undefined> {
    return (ok(await this.as(user, 'adminList'), 'admin list').data as Json[]).find((w) => w.walkthrough_id === id);
  }

  async event(user: TestUser, id: string, body: Record<string, unknown>): Promise<Json> {
    return ok(await this.as(user, 'recordEvent', { id, body }), `record ${String(body['event'])}`);
  }

  /** A fresh recording link, or a skip when this backend doesn't record. */
  async link(user: TestUser = 'admin'): Promise<Json> {
    const answer = await this.as(user, 'adminCreateRecordingLink');
    if (answer.status === 501) throw new Skip('recording isn’t set up on this backend');
    return ok(answer, 'create a recording link', 201);
  }

  /** A number above everything `user`'s owner has. */
  async freeNumber(user: TestUser = 'admin'): Promise<number> {
    const list = ok(await this.as(user, 'adminList'), 'admin list').data as { number: number }[];
    return Math.max(0, ...list.map((w) => w.number)) + 1000;
  }
}

type Rule = [id: string, title: string, run: (kit: Kit) => Promise<void>];

/** One step as a recording saves it: no words yet. */
const recordedSteps = [{ anchor: null, missing: 'centred' }];

/** Every rule, in the order docs/server-contract.md lists them. */
export const RULES: readonly Rule[] = [
  // ── Sign-in ──────────────────────────────────────────────────────────────
  ['auth.signed-in', 'Every route wants someone signed in', async (kit) => {
    for (const route of Object.keys(CONTRACT_ROUTES) as ContractRoute[]) {
      if (kit.serves(route)) refused(await kit.call({}, route, { id: NO_SUCH_ID, ...(CONTRACT_ROUTES[route][0] === 'GET' ? {} : { body: {} }) }), 401, 'unauthorized', route);
    }
  }],
  ['auth.admin-only', 'An ordinary person can’t use the admin routes', async (kit) => {
    for (const route of Object.keys(CONTRACT_ROUTES) as ContractRoute[]) {
      if (route.startsWith('admin') && kit.serves(route)) refused(await kit.as('person', route, { id: '1', ...(CONTRACT_ROUTES[route][0] === 'GET' ? {} : { body: {} }) }), 403, 'forbidden', route);
    }
  }],

  // ── Numbering ────────────────────────────────────────────────────────────
  ['numbering.next', 'A file with no number gets the owner’s next one', async (kit) => {
    const first = await kit.upload();
    const second = await kit.upload();
    same(second.number, first.number + 1, 'next number');
    same([first.version, second.version], [1, 1], 'versions');
    isTrue(first.walkthrough_id !== second.walkthrough_id, 'two walkthroughs share an id');
  }],
  ['numbering.same-number', 'A file with a known number adds a version to that walkthrough', async (kit) => {
    const first = await kit.upload();
    const second = await kit.upload({ number: first.number });
    same([second.walkthrough_id, second.number, second.version], [first.walkthrough_id, first.number, 2], 'second version');
    same(second.saved, true, 'saved');
  }],
  ['numbering.new-number', 'A file with an unused number starts a walkthrough with it', async (kit) => {
    const number = await kit.freeNumber();
    const saved = await kit.upload({ number });
    same([saved.number, saved.version], [number, 1], 'number and version');
  }],
  ['numbering.rename', 'A new slug renames it, and the old handle still finds it', async (kit) => {
    const first = await kit.upload();
    const renamed = await kit.upload({ number: first.number, slug: `renamed-${first.number}` });
    same(renamed.handle, `${first.number}-renamed-${first.number}`, 'handle');
    same(ok(await kit.as('admin', 'adminDetail', { id: first.handle }), 'old handle').walkthrough_id, first.walkthrough_id, 'found by the old handle');
  }],
  ['numbering.per-owner', 'Numbers are per owner: two owners can each have the same one', async (kit) => {
    const theirs = await kit.upload({}, 'otherAdmin');
    const number = await kit.freeNumber();
    const mine = await kit.upload({ number });
    same(mine.number, number, 'our number');
    const same_number = await kit.upload({ number }, 'otherAdmin');
    same([same_number.number, same_number.version], [number, 1], 'their first with that number');
    isTrue(same_number.walkthrough_id !== mine.walkthrough_id, 'the same number joined two owners’ walkthroughs');
    const next = await kit.upload({}, 'otherAdmin');
    same(next.number, number + 1, 'their numbering follows their own walkthroughs');
    isTrue(theirs.number < number, 'their numbering reached ours');
  }],
  ['owners.no-leak', 'One owner’s walkthroughs never reach another’s people', async (kit) => {
    const theirs = await kit.live({}, 'otherAdmin');
    isTrue(!(await kit.served(theirs.walkthrough_id, 'person')), 'another owner’s live walkthrough is in this person’s list');
    isTrue(!(await kit.listed(theirs.walkthrough_id)), 'another owner’s walkthrough is in this admin’s list');
    refused(await kit.as('admin', 'adminDetail', { id: theirs.walkthrough_id }), 404, 'not_found', 'another owner’s detail');
    refused(await kit.as('admin', 'adminSaveVersion', { id: theirs.walkthrough_id, body: { from_version: 1, status: 'live' } }), 404, 'not_found', 'another owner’s version');
    refused(await kit.as('person', 'recordEvent', { id: theirs.walkthrough_id, body: { event: 'started', version: 1, step: 0 } }), 404, 'not_found', 'an event on another owner’s walkthrough');
  }],

  // ── Versions ─────────────────────────────────────────────────────────────
  ['upload.always-draft', 'An upload is a draft, whatever the file says', async (kit) => {
    const saved = await kit.upload({ status: 'live' });
    same(saved.status, 'draft', 'status');
    isTrue(!(await kit.served(saved.walkthrough_id)), 'an upload reached people');
    same((await kit.listed(saved.walkthrough_id)).live_version, null, 'live version');
  }],
  ['versions.next', 'Each save is the next version, with the status asked for', async (kit) => {
    const saved = await kit.upload();
    same((await kit.copy(saved, 1, 'live')).version, 2, 'make live');
    same((await kit.copy(saved, 2, 'inactive')).version, 3, 'make inactive');
    const last = await kit.copy(saved, 1, 'draft');
    same([last.version, last.status], [4, 'draft'], 'restore');
  }],
  ['versions.never-edited', 'A version is never edited: later saves leave it exactly as it was', async (kit) => {
    const saved = await kit.upload({ title: 'The first title' });
    const before = (await kit.detail(saved.walkthrough_id)).versions.find((v: Json) => v.version === 1);
    await kit.upload({ number: saved.number, title: 'The second title' });
    await kit.copy(saved, 2, 'live');
    const detail = await kit.detail(saved.walkthrough_id);
    same(detail.versions.map((v: Json) => v.version), [3, 2, 1], 'versions, newest first');
    same(detail.versions[2], before, 'version 1');
  }],
  ['versions.draft-behind-live', 'A later draft doesn’t replace what’s live', async (kit) => {
    const live = await kit.live({ title: 'The live title' });
    await kit.upload({ number: live.number, title: 'A newer draft' });
    const served = await kit.served(live.walkthrough_id);
    same([served?.version, served?.title], [2, 'The live title'], 'what people get');
    const row = await kit.listed(live.walkthrough_id);
    same([row.live_version, row.latest_version, row.latest_status], [2, 3, 'draft'], 'the admin row');
  }],
  ['versions.restore', 'Restore copies an old version forward, and people get it once it’s live', async (kit) => {
    const live = await kit.live({ title: 'The original' });
    await kit.upload({ number: live.number, title: 'The change' });
    await kit.copy(live, 3, 'live');
    same((await kit.served(live.walkthrough_id))?.title, 'The change', 'before restoring');
    const restored = await kit.copy(live, 1, 'draft');
    same((await kit.served(live.walkthrough_id))?.title, 'The change', 'a restored draft isn’t live');
    await kit.copy(live, restored.version, 'live');
    const served = await kit.served(live.walkthrough_id);
    same([served?.title, served?.version], ['The original', restored.version + 1], 'after making it live');
  }],
  ['versions.inactive', 'Inactive takes it away from people; every version stays', async (kit) => {
    const live = await kit.live();
    await kit.copy(live, live.version, 'inactive');
    isTrue(!(await kit.served(live.walkthrough_id)), 'an inactive walkthrough is still served');
    same((await kit.listed(live.walkthrough_id)).live_version, null, 'live version');
    same((await kit.detail(live.walkthrough_id)).versions.length, 3, 'versions kept');
    await kit.copy(live, 1, 'live');
    isTrue(await kit.served(live.walkthrough_id), 'making it live again didn’t bring it back');
  }],
  ['versions.not-found', 'No such walkthrough or version is a not found', async (kit) => {
    const saved = await kit.upload();
    refused(await kit.as('admin', 'adminSaveVersion', { id: saved.walkthrough_id, body: { from_version: 99, status: 'live' } }), 404, 'not_found', 'no such version');
    refused(await kit.as('admin', 'adminDetail', { id: NO_SUCH_NUMBER }), 404, 'not_found', 'no such number');
    refused(await kit.as('admin', 'adminDetail', { id: 'not-a-reference!' }), 404, 'not_found', 'no such reference');
  }],
  ['versions.references', 'A walkthrough is found by its id, number or handle', async (kit) => {
    const saved = await kit.upload();
    for (const id of [saved.walkthrough_id, String(saved.number), saved.handle]) same((await kit.detail(id)).walkthrough_id, saved.walkthrough_id, `found by ${id}`);
  }],

  // ── What people get ──────────────────────────────────────────────────────
  ['list.fields', 'A served walkthrough has everything the browser reads', async (kit) => {
    const offerOn = kit.options.offerOn ?? '/';
    const permission = kit.options.permission ?? 'some-permission';
    const live = await kit.live({ mode: 'guide', offer_on: offerOn, permission, title: 'All the fields' });
    const served = await kit.served(live.walkthrough_id);
    isTrue(served, 'a live walkthrough isn’t in the list');
    same(
      [served.number, served.handle, served.version, served.title, served.mode, served.offer_on, served.permission, served.reoffer_from, served.article_slug, served.steps.length],
      [live.number, live.handle, 2, 'All the fields', 'guide', offerOn, permission, 1, null, 3],
      'fields',
    );
  }],

  ['list.articles', 'Article hints are kept as written, on a walkthrough and its steps, and nothing checks them', async (kit) => {
    const hints = ['https://help.example.com/a?b=1', 'an-id', 'Not A Slug'];
    const step = { anchor: null, title: 'One', body: 'Read this.', missing: 'centred' };
    same((await kit.detail((await kit.upload()).walkthrough_id)).versions[0].articles, [], 'none');
    const live = await kit.live({ articles: hints, steps: [{ ...step, articles: ['step-one'] }, step] });
    const served = await kit.served(live.walkthrough_id);
    same([served.articles, served.steps[0].articles], [hints, ['step-one']], 'served');
    same((await kit.detail(live.walkthrough_id)).versions[0].articles, hints, 'a version');
    refused(await kit.as('admin', 'adminUpload', { body: kit.file({ articles: ['1', '2', '3', '4', '5', '6'] }) }), 400, 'validation_failed', 'six articles');
    refused(await kit.as('admin', 'adminUpload', { body: kit.file({ steps: [{ ...step, articles: [''] }] }) }), 400, 'validation_failed', 'a blank article');
  }],

  // ── Progress ─────────────────────────────────────────────────────────────
  ['progress.one-row', 'One row per person per walkthrough', async (kit) => {
    const live = await kit.live();
    const id = live.walkthrough_id;
    await kit.event('person', id, { event: 'started', version: 2, step: 0, from: 'list' });
    await kit.event('person', id, { event: 'step', version: 2, step: 1, how: 'next' });
    await kit.event('person', id, { event: 'paused', version: 2, step: 1 });
    const mine = await kit.event('person', id, { event: 'completed', version: 2, step: 2 });
    same([mine.progress[id].v, mine.progress[id].status, mine.progress[id].step], [2, 'completed', 2], 'the row');
    isTrue(!Number.isNaN(Date.parse(mine.progress[id].at)), '`at` isn’t a time');
    same((await kit.detail(id)).stats.people, 1, 'people');
    same(ok(await kit.as('person', 'getMyProgress'), 'progress').progress[id]?.status, 'completed', 'read back');
  }],
  ['progress.own', 'A person sees and changes only their own', async (kit) => {
    const live = await kit.live();
    await kit.event('person', live.walkthrough_id, { event: 'completed', version: 2, step: 2 });
    isTrue(!ok(await kit.as('person2', 'getMyProgress'), 'progress').progress[live.walkthrough_id], 'another person’s row came back');
    await kit.event('person2', live.walkthrough_id, { event: 'dismissed', version: 2, step: 0 });
    same(ok(await kit.as('person', 'getMyProgress'), 'progress').progress[live.walkthrough_id].status, 'completed', 'the first person’s row');
  }],
  ['progress.completed-stays', '`completed` never becomes `dismissed`', async (kit) => {
    const live = await kit.live();
    const id = live.walkthrough_id;
    await kit.event('person', id, { event: 'completed', version: 2, step: 2 });
    const mine = await kit.event('person', id, { event: 'dismissed', version: 2, step: 0 });
    same([mine.progress[id].status, mine.progress[id].step], ['completed', 2], 'after Not now');
  }],
  ['progress.dismissed-to-started', 'Anything else moves on: a dismissed walkthrough can be started', async (kit) => {
    const live = await kit.live();
    const id = live.walkthrough_id;
    await kit.event('person', id, { event: 'dismissed', version: 2, step: 0 });
    same((await kit.event('person', id, { event: 'started', version: 2, step: 0 })).progress[id].status, 'started', 'status');
    await kit.event('person', id, { event: 'completed', version: 2, step: 2 });
    same((await kit.event('person', id, { event: 'started', version: 2, step: 0 })).progress[id].status, 'started', 'status after finishing and starting again');
  }],
  ['progress.step-keeps-status', 'A `step` event moves the place and leaves the status alone', async (kit) => {
    const live = await kit.live();
    const id = live.walkthrough_id;
    await kit.event('person', id, { event: 'paused', version: 2, step: 0 });
    const mine = await kit.event('person', id, { event: 'step', version: 2, step: 2, how: 'back' });
    same([mine.progress[id].status, mine.progress[id].step], ['paused', 2], 'the row');
  }],
  ['progress.refused', 'An event on nothing is refused', async (kit) => {
    const live = await kit.live();
    refused(await kit.as('person', 'recordEvent', { id: live.walkthrough_id, body: { event: 'started', version: 99, step: 0 } }), 400, 'validation_failed', 'a version that doesn’t exist');
    refused(await kit.as('person', 'recordEvent', { id: NO_SUCH_ID, body: { event: 'started', version: 1, step: 0 } }), 404, 'not_found', 'a walkthrough that doesn’t exist');
  }],

  // ── Offering again ───────────────────────────────────────────────────────
  ['reoffer.keeps', '`reoffer_from` is 1 at first, carries forward, and only a file raises it', async (kit) => {
    const first = await kit.upload();
    same((await kit.detail(first.walkthrough_id)).versions[0].reoffer_from, 1, 'at first');
    await kit.upload({ number: first.number, reoffer_from: 2 });
    await kit.upload({ number: first.number });
    same((await kit.detail(first.walkthrough_id)).versions[0].reoffer_from, 2, 'a file that doesn’t say');
    await kit.copy(first, 3, 'live');
    same((await kit.served(first.walkthrough_id))?.reoffer_from, 2, 'served');
  }],

  // ── Words ────────────────────────────────────────────────────────────────
  ['placeholders.not-live', 'A version with a recording’s placeholder words can’t go live', async (kit) => {
    const steps = [
      { anchor: null, title: 'Written', body: 'All written.', missing: 'centred' },
      { anchor: null, title: UNWRITTEN_TITLE, body: 'Words here.', missing: 'centred' },
      { anchor: null, title: 'Written too', body: UNWRITTEN_BODY, missing: 'centred' },
    ];
    const saved = await kit.upload({ steps });
    const answer = await kit.as('admin', 'adminSaveVersion', { id: saved.walkthrough_id, body: { from_version: 1, status: 'live' } });
    refused(answer, 400, 'validation_failed', 'making it live');
    isTrue(/\b2\b/.test(answer.body.error.message) && /\b3\b/.test(answer.body.error.message), `the message doesn’t name steps 2 and 3: ${answer.body.error.message}`);
    isTrue(!(await kit.served(saved.walkthrough_id)), 'it went live anyway');
    same((await kit.copy(saved, 1, 'inactive')).status, 'inactive', 'other statuses still save');
  }],

  // ── Recording links ──────────────────────────────────────────────────────
  ['recording.link', 'A link comes with its address and when it runs out', async (kit) => {
    const made = await kit.link();
    isTrue(typeof made.link === 'string' && made.link.length > 0, 'no link');
    isTrue(String(made.url).includes(`#flinders_record=${made.link}`), 'the address must hold the link after the #');
    const minutes = (Date.parse(made.expires_at) - Date.now()) / 60_000;
    isTrue(minutes > 28 && minutes <= 31, `a link lasts 30 minutes, this one ${minutes.toFixed(1)}`);
  }],
  ['recording.check', 'A good link is good for its creator, and comes back fresh', async (kit) => {
    const made = await kit.link();
    const check = ok(await kit.as('admin', 'checkRecordingLink', { body: { link: made.link } }), 'check');
    same(check.valid, true, 'valid');
    isTrue(typeof check.created_by === 'string' && !!check.created_by, 'no created_by');
    isTrue(typeof check.link === 'string' && !!check.link, 'no fresh link');
    same(ok(await kit.as('admin', 'checkRecordingLink', { body: { link: check.link } }), 'check the fresh link').valid, true, 'the fresh link');
  }],
  ['recording.creator-only', 'A link works only for the person who created it', async (kit) => {
    const made = await kit.link();
    const check = ok(await kit.as('person', 'checkRecordingLink', { body: { link: made.link } }), 'check as someone else');
    same([check.valid, check.reason], [false, 'not_allowed'], 'someone else’s check');
    refused(await kit.as('person', 'saveRecording', { body: { link: made.link, steps: recordedSteps } }), 403, 'forbidden', 'saving as someone else');
  }],
  ['recording.invalid', 'A forged or tampered link is invalid', async (kit) => {
    const made = await kit.link();
    const tampered = `${made.link.slice(0, -2)}${made.link.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const link of ['nonsense', tampered]) {
      const check = ok(await kit.as('admin', 'checkRecordingLink', { body: { link } }), 'check');
      same([check.valid, check.reason], [false, 'invalid'], link);
    }
    refused(await kit.as('admin', 'saveRecording', { body: { link: 'nonsense', steps: recordedSteps } }), 403, 'forbidden', 'saving with a bad link');
  }],
  ['recording.expired', 'An expired link is refused, and saves nothing', async (kit) => {
    const { recordingSecret, expireLink } = kit.options;
    if (!recordingSecret && !expireLink) throw new Skip('needs recordingSecret or expireLink');
    const made = await kit.link();
    const late = expireLink ? await expireLink(made.link) : expireSigned(made.link, recordingSecret!);
    const check = ok(await kit.as('admin', 'checkRecordingLink', { body: { link: late } }), 'check');
    same([check.valid, check.reason], [false, 'expired'], 'an expired link');
    refused(await kit.as('admin', 'saveRecording', { body: { link: late, steps: recordedSteps } }), 403, 'forbidden', 'saving with an expired link');
  }],
  ['recording.saves-a-draft', 'A recording saves a new draft, never a version of another, and can’t go live unwritten', async (kit) => {
    const made = await kit.link();
    const saved = ok(await kit.as('admin', 'saveRecording', { body: { link: made.link, steps: recordedSteps } }), 'save', 201);
    same([saved.version, saved.status], [1, 'draft'], 'what was saved');
    const detail = await kit.detail(saved.walkthrough_id);
    same(detail.versions[0].steps[0].title, UNWRITTEN_TITLE, 'placeholder words');
    isTrue(detail.versions[0].created_by, 'no created_by');
    isTrue(!(await kit.served(saved.walkthrough_id)), 'a recording reached people');
    refused(await kit.as('admin', 'adminSaveVersion', { id: saved.walkthrough_id, body: { from_version: 1, status: 'live' } }), 400, 'validation_failed', 'making it live unwritten');
  }],

  // ── Stats ────────────────────────────────────────────────────────────────
  ['stats.counts', 'Stats count people, finishers, how far each got, and steps they did', async (kit) => {
    const live = await kit.live();
    const id = live.walkthrough_id;
    await kit.event('person', id, { event: 'started', version: 2, step: 0 });
    await kit.event('person', id, { event: 'step', version: 2, step: 1, how: 'done' });
    await kit.event('person', id, { event: 'step', version: 2, step: 2, how: 'next' });
    await kit.event('person', id, { event: 'step', version: 2, step: 0, how: 'back' });
    await kit.event('person', id, { event: 'completed', version: 2, step: 2 });
    await kit.event('person2', id, { event: 'started', version: 2, step: 0 });
    await kit.event('person2', id, { event: 'step', version: 2, step: 1, how: 'skipped' });
    await kit.event('person2', id, { event: 'dismissed', version: 2, step: 0 });
    const expected = { people: 2, finished: 1, reached: [2, 2, 1], actions_done: 1 };
    same((await kit.detail(id)).stats, expected, 'the detail’s stats');
    if (kit.serves('adminStats')) same(ok(await kit.as('admin', 'adminStats', { id: live.handle }), 'stats'), expected, 'the stats route');
  }],

  // ── The offers switch ────────────────────────────────────────────────────
  ['offers.switch', 'The switch is the person’s own, and asking still works with it off', async (kit) => {
    const live = await kit.live();
    await kit.event('person', live.walkthrough_id, { event: 'paused', version: 2, step: 0 });
    const first = await kit.as('person', 'setOffers', { body: { offer_walkthroughs: false } });
    if (first.status === 501) throw new Skip('the offers switch isn’t set up on this backend');
    const off = ok(first, 'turn off');
    same(off.offer_walkthroughs, false, 'off');
    isTrue(off.progress[live.walkthrough_id], 'the answer must hold the person’s progress');
    same(ok(await kit.as('person', 'getMyProgress'), 'read back').offer_walkthroughs, false, 'read back');
    isTrue(await kit.served(live.walkthrough_id), 'the switch changed what’s served');
    same(ok(await kit.as('person', 'setOffers', { body: { offer_walkthroughs: true } }), 'turn on').offer_walkthroughs, true, 'on');
  }],

  // ── Validation ───────────────────────────────────────────────────────────
  ['validation.file', 'A bad file is refused in plain words that say where', async (kit) => {
    const cases: [Record<string, unknown>, string][] = [
      [{ slug: 'Not A Slug' }, 'slug'],
      [{ steps: [] }, 'steps'],
      [{ steps: [{ anchor: null, title: 'T', body: 'B' }] }, 'missing'],
      [{ number: 0 }, 'number'],
    ];
    // One at a time: a request still in flight when a check fails would die with the server.
    for (const [over, where] of cases) {
      const answered = await kit.as('admin', 'adminUpload', { body: kit.file(over) });
      refused(answered, 400, 'validation_failed', where);
      isTrue(String(answered.body.error.message).includes(where), `“${answered.body.error.message}” doesn’t say ${where}`);
    }
    refused(await kit.as('admin', 'adminUpload', { body: { ...kit.file(), surprise: true } }), 400, 'validation_failed', 'an unknown field');
  }],
  ['validation.app', 'A step pointing at something that isn’t in the app is refused, by name', async (kit) => {
    const step = { anchor: null, title: 'T', body: 'B', missing: 'centred' };
    const element = await kit.as('admin', 'adminUpload', { body: kit.file({ steps: [{ ...step, anchor: 'conformance-no-such-element' }] }) });
    refused(element, 400, 'validation_failed', 'an unknown element');
    isTrue(String(element.body.error.message).includes('conformance-no-such-element'), 'the message must name the element');
    const page = await kit.as('admin', 'adminUpload', { body: kit.file({ steps: [{ ...step, route: '/conformance-no-such-page' }] }) });
    refused(page, 400, 'validation_failed', 'an unknown page');
    isTrue(String(page.body.error.message).includes('/conformance-no-such-page'), 'the message must name the page');
  }],
  ['validation.requests', 'A bad request body is refused in plain words', async (kit) => {
    const live = await kit.live();
    const id = live.walkthrough_id;
    refused(await kit.as('person', 'recordEvent', { id, body: { event: 'jumped', version: 2, step: 0 } }), 400, 'validation_failed', 'an unknown event');
    refused(await kit.as('person', 'recordEvent', { id, body: { event: 'started', version: 2, step: 30 } }), 400, 'validation_failed', 'a step past the end');
    refused(await kit.as('admin', 'adminSaveVersion', { id, body: { from_version: 1, status: 'published' } }), 400, 'validation_failed', 'an unknown status');
    const offers = await kit.as('person', 'setOffers', { body: { offer_walkthroughs: 'yes' } });
    if (offers.status !== 501) refused(offers, 400, 'validation_failed', 'a switch that isn’t true or false');
  }],
  ['format.newer', 'A file newer than the supported format is refused, and says so', async (kit) => {
    for (const body of [kit.file({ format_version: 2 }), kit.file({ format_version: 99, a_later_field: true })]) {
      const answer = await kit.as('admin', 'adminUpload', { body });
      refused(answer, 400, 'validation_failed', 'a newer file');
      isTrue(/format/.test(answer.body.error.message) && /[Uu]pdate/.test(answer.body.error.message), `the message must say to update: ${answer.body.error.message}`);
    }
  }],
  ['format.current', 'The supported format is taken, and isn’t saved with the walkthrough', async (kit) => {
    const saved = await kit.upload({ format_version: 1 });
    isTrue(!('format_version' in (await kit.detail(saved.walkthrough_id)).versions[0]), 'format_version was saved');
  }],
];

/** Runs every rule. A rule that throws counts as failed; the rest still run. */
export async function runConformance(options: ConformanceOptions): Promise<ConformanceReport> {
  const kit = new Kit(options);
  const results: RuleResult[] = [];
  const chosen = RULES.filter(([id]) => !options.only || options.only.some((prefix) => id.startsWith(prefix)));
  for (const [id, title, run] of chosen) {
    try {
      await run(kit);
      results.push({ id, title, status: 'passed' });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      results.push({ id, title, status: err instanceof Skip ? 'skipped' : 'failed', detail });
    }
  }
  const count = (status: RuleResult['status']) => results.filter((r) => r.status === status).length;
  return { ok: count('failed') === 0, passed: count('passed'), failed: count('failed'), skipped: count('skipped'), results };
}
