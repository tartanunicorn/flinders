import { errorCode, fillPath, FLINDERS_ROUTES, type FlindersPaths, type FlindersRouteName } from './contract.js';
import type { PersonWalkthroughs, WalkthroughEventBody } from './controller.js';
import type { RecordingLinkAnswer, RecordingSaveAnswer } from './recording-session.js';
import type { AdminWalkthrough, AdminWalkthroughDetail, SavedVersion, Walkthrough, WalkthroughStats, WalkthroughStatus } from './types.js';

/** One call on the contract. `url` is ready to fetch; `path` and `params` suit a typed client. */
export interface FlindersHttpRequest {
  route: FlindersRouteName;
  method: 'GET' | 'POST' | 'PATCH';
  url: string;
  /** The route's path with its `{params}` still in it. */
  path: string;
  params: Record<string, string>;
  body?: unknown;
}

/** `ok` = a 2xx; `body` = the parsed JSON, a success or the error envelope. */
export interface FlindersHttpResponse {
  ok: boolean;
  body: unknown;
}

/** The product's own request function. Throwing = the backend couldn't be reached. */
export type FlindersRequest = (request: FlindersHttpRequest) => Promise<FlindersHttpResponse>;

export interface FlindersHttp {
  /** Where the routes live (`/api/help`). Empty by default. */
  baseUrl?: string;
  /** A product's own paths, where they differ from the contract's. */
  paths?: FlindersPaths;
  /** Your own request function. Default: `fetch`, with JSON and `headers`. */
  request?: FlindersRequest;
  /** Sent with every call by the default request: a token, say. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Sent by the default request: `include` when your API is on another site and signs in with cookies. */
  credentials?: RequestCredentials;
}

/** A product's own types for what the routes return, where it has them. */
export interface FlindersTypes {
  walkthrough: Pick<Walkthrough, 'walkthrough_id' | 'number' | 'version' | 'slug' | 'title' | 'mode' | 'permission' | 'offer_on' | 'reoffer_from' | 'article_slug' | 'steps'>;
  adminWalkthrough: unknown;
  adminDetail: unknown;
  saved: unknown;
  recordingLink: unknown;
}

export interface DefaultFlindersTypes extends FlindersTypes {
  walkthrough: Walkthrough;
  adminWalkthrough: AdminWalkthrough;
  adminDetail: AdminWalkthroughDetail;
  saved: SavedVersion;
  recordingLink: { link: string; url: string; expires_at: string };
}

/** An answer an admin screen words itself: `error` is the backend's error body, or the thrown error. */
export type FlindersResult<D> = { ok: true; data: D } | { ok: false; error: unknown };

/** Every route, as a call. */
export interface FlindersClient<T extends FlindersTypes = DefaultFlindersTypes> {
  /** Null = the backend answered with no data. Throwing = it couldn't be reached. */
  list(): Promise<T['walkthrough'][] | null>;
  mine(): Promise<PersonWalkthroughs | null>;
  setOffers(on: boolean): Promise<PersonWalkthroughs | null>;
  record(walkthroughId: string, event: WalkthroughEventBody): Promise<PersonWalkthroughs | null>;
  checkLink(link: string): Promise<RecordingLinkAnswer | null>;
  /** Finish in a tab with a link. A `forbidden` means the link is what's wrong. */
  saveDraft(link: string, steps: unknown[]): Promise<RecordingSaveAnswer<T['saved']>>;
  admin: {
    list(): Promise<FlindersResult<T['adminWalkthrough'][]>>;
    detail(ref: string): Promise<FlindersResult<T['adminDetail']>>;
    upload(file: unknown): Promise<FlindersResult<T['saved']>>;
    saveVersion(ref: string, fromVersion: number, status: WalkthroughStatus): Promise<FlindersResult<T['saved']>>;
    /** From the stats route or, on a backend without it, the detail. */
    stats(ref: string): Promise<FlindersResult<WalkthroughStats>>;
    recordingLink(): Promise<FlindersResult<T['recordingLink']>>;
  };
  /** Whether the backend serves a route. */
  serves(route: FlindersRouteName): boolean;
}

/** JSON over `fetch`. Anything that isn't JSON counts as no body. */
const fetchRequest =
  ({ headers, credentials }: FlindersHttp): FlindersRequest =>
  async ({ method, url, body }) => {
    const response = await fetch(url, {
      method,
      ...(credentials ? { credentials } : {}),
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(await headers?.()) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { ok: response.ok, body: await response.json().catch(() => null) };
  };

/** A client for a backend on the contract: `http` says where it is and how to call it. */
export function createFlindersClient<T extends FlindersTypes = DefaultFlindersTypes>(http: FlindersHttp = {}): FlindersClient<T> {
  const request = http.request ?? fetchRequest(http);
  const base = (http.baseUrl ?? '').replace(/\/$/, '');
  const pathOf = (route: FlindersRouteName) => {
    const own = http.paths?.[route];
    return own === undefined ? FLINDERS_ROUTES[route].path : own;
  };

  const call = (route: FlindersRouteName, options: { params?: Record<string, string>; body?: unknown } = {}): Promise<FlindersHttpResponse> => {
    const path = pathOf(route);
    if (path === null) return Promise.resolve({ ok: false, body: { error: { code: 'feature_off', message: 'This backend doesn’t serve that.' } } });
    const params = options.params ?? {};
    return request({ route, method: FLINDERS_ROUTES[route].method, url: `${base}${fillPath(path, params)}`, path, params, ...('body' in options ? { body: options.body } : {}) });
  };
  /** The body of a success, or null. */
  const data = async <D>(answer: Promise<FlindersHttpResponse>): Promise<D | null> => {
    const { ok, body } = await answer;
    return ok ? ((body ?? null) as D | null) : null;
  };
  const result = async <D>(answer: Promise<FlindersHttpResponse>, read: (body: unknown) => D = (body) => body as D): Promise<FlindersResult<D>> => {
    const { ok, body } = await answer;
    return ok ? { ok: true, data: read(body) } : { ok: false, error: body };
  };

  const client: FlindersClient<T> = {
    list: async () => (await data<{ data: T['walkthrough'][] }>(call('listWalkthroughs')))?.data ?? null,
    mine: () => data(call('getMyProgress')),
    setOffers: (on) => data(call('setOffers', { body: { offer_walkthroughs: on } })),
    record: (walkthroughId, event) => data(call('recordEvent', { params: { walkthroughId }, body: event })),
    checkLink: (link) => data(call('checkRecordingLink', { body: { link } })),
    saveDraft: async (link, steps) => {
      const { ok, body } = await call('saveRecording', { body: { link, steps } });
      return ok ? { saved: body as T['saved'] } : { error: body, linkRefused: errorCode(body) === 'forbidden' };
    },
    admin: {
      list: () => result(call('adminList'), (body) => (body as { data: T['adminWalkthrough'][] }).data),
      detail: (ref) => result(call('adminDetail', { params: { walkthroughId: ref } })),
      upload: (file) => result(call('adminUpload', { body: file })),
      saveVersion: (ref, fromVersion, status) => result(call('adminSaveVersion', { params: { walkthroughId: ref }, body: { from_version: fromVersion, status } })),
      stats: async (ref) =>
        client.serves('adminStats')
          ? result(call('adminStats', { params: { walkthroughId: ref } }))
          : result(call('adminDetail', { params: { walkthroughId: ref } }), (body) => (body as { stats: WalkthroughStats }).stats),
      recordingLink: () => result(call('adminCreateRecordingLink')),
    },
    serves: (route) => pathOf(route) !== null,
  };
  return client;
}
