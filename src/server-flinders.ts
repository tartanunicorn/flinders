import { z } from 'zod';

import { FLINDERS_ROUTES, type FlindersErrorBody, type FlindersRouteName } from './contract.js';
import { draftWalkthrough, type AskForDraft, type CheckedDraft, type DraftApp, type DraftSource } from './draft.js';
import { parseWalkthroughRef } from './logic.js';
import { checkAndRenewRecordingLink, createRecordingLink, recordingLinkUrl, type RecordingLinkCheck, type RecordingPerson } from './recording-link.js';
import { appChecks, createWalkthroughRepository, describeSchemaError, walkthroughEventSchema, WalkthroughFileError, type AppChecks, type AppLists, type FlindersQuery, type WalkthroughEvent, type WalkthroughsConfig } from './repository.js';
import type { AdminWalkthrough, AdminWalkthroughDetail, SavedVersion, Walkthrough, WalkthroughMode, WalkthroughProgress, WalkthroughStats, WalkthroughStatus } from './types.js';

/** Who's asking. A product's own type can hold more, and gets it back in `events`. */
export interface FlindersPerson {
  id: string;
  /** May use the admin routes (`handle` checks; a product with its own guards can leave it out). */
  admin?: boolean;
  /** The owner they belong to: null = the product's own. Left out = the product's own for admin, and row-level security narrows the rest. */
  owner?: string | null;
  /** Reads as this person, so row-level security applies. Default: `query`. */
  query?: FlindersQuery;
}

export interface FlindersRecording<P> {
  /** A server-side secret of your own. Never send it to a browser. */
  secret: string;
  /** The app's address, where a recording tab opens. */
  webUrl: string;
  /** Your own check, made on every use of a link. */
  mayRecord(person: P): boolean | Promise<boolean>;
  /** What's said when the link is refused. */
  refused?: Partial<Record<'invalid' | 'expired' | 'not_allowed', string>>;
}

/** What happened, for your audit or analytics. Ids and step numbers only. */
export type FlindersServerEvent<P> = { person: P } & (
  | { type: 'event'; walkthrough_id: string; event: WalkthroughEvent }
  | { type: 'recording_link_created' }
  | { type: 'recording_saved'; saved: SavedVersion; created_by: string; steps: number }
);

export interface FlindersServerConfig<P extends FlindersPerson = FlindersPerson> extends WalkthroughsConfig {
  /** Your own database call. Everything goes through it, or through `person.query`. */
  query: FlindersQuery;
  /** Where a person's offers switch lives. Without it, offers are on and the switch can't be changed. */
  offers?: { get(person: P): Promise<boolean | undefined>; set(person: P, on: boolean): Promise<void> };
  /** Recording links. Without it, those routes answer `feature_off`. */
  recording?: FlindersRecording<P>;
  /** Told what happened. A failure here fails the request: an audit that can't save should say so. */
  events?(event: FlindersServerEvent<P>): void | Promise<void>;
  /** Your call to your own AI service. Without it, `draft` answers `feature_off`. */
  ask?: AskForDraft;
}

/** A refusal: `status` and `code` for the response, `message` in plain words. */
export class FlindersError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const notFound = (message = 'Walkthrough not found.') => new FlindersError(404, 'not_found', message);
const invalid = (message: string) => new FlindersError(400, 'validation_failed', message);
const featureOff = (what: string) => new FlindersError(501, 'feature_off', `${what} isn’t set up on this server.`);

/** What the routes take, past the walkthrough file and the event. */
const offersBody = z.object({ offer_walkthroughs: z.boolean() }).strict();
const versionBody = z.object({ from_version: z.number().int().min(1), status: z.enum(['draft', 'live', 'inactive']) }).strict();
const link = z.string().min(1).max(1024);
const checkBody = z.object({ link }).strict();
/** The steps themselves are checked when they are saved, as any walkthrough file's are. */
const recordingBody = z.object({ link, steps: z.array(z.record(z.string(), z.unknown())).min(1).max(30) }).strict();

function read<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw invalid(describeSchemaError(parsed.error));
  return parsed.data;
}

const LINK_REFUSED = { invalid: 'This recording link isn’t valid.', expired: 'This recording link has expired.', not_allowed: 'This recording link only works for the person who made it.' };

export interface FlindersHandleRequest<P> {
  method: string;
  /** The path under your base: `/walkthroughs`. */
  path: string;
  /** Parsed JSON. */
  body?: unknown;
  /** The person your sign-in found; null = nobody. */
  person: P | null;
}

export interface FlindersHandleResponse {
  status: number;
  body: unknown;
}

/** Matches a request path to a route of the contract, with its `{params}`. */
function matchPath(template: string, path: string): Record<string, string> | null {
  const want = template.split('/');
  const have = path.replace(/\/$/, '').split('/');
  if (want.length !== have.length) return null;
  const params: Record<string, string> = {};
  for (const [i, part] of want.entries()) {
    const value = have[i]!;
    if (part.startsWith('{')) {
      try {
        params[part.slice(1, -1)] = decodeURIComponent(value);
      } catch {
        return null; // Broken escapes (`%E0%A4%A`) match no route.
      }
    } else if (part !== value) return null;
  }
  return params;
}

/**
 * The server side in one object: `query`, table names and app checks in, and one function per route
 * of the contract out, each returning its JSON or throwing a `FlindersError`. `handle` is those
 * functions behind one HTTP entry, for any framework. A product with its own guards and routes calls
 * the functions straight from them.
 */
export function createFlinders<P extends FlindersPerson = FlindersPerson>(config: FlindersServerConfig<P>) {
  const repository = createWalkthroughRepository(config);
  const { query, recording } = config;

  const reads = (person: P): FlindersQuery => person.query ?? query;
  const ownerOf = (person: P): string | null => person.owner ?? null;
  const tell = async (event: FlindersServerEvent<P>) => void (await config.events?.(event));

  const mine = async (person: P) => {
    const on = await config.offers?.get(person);
    return repository.mine(query, person.id, { offer_walkthroughs: on });
  };

  /** A file's refusals come as a `FlindersError` like every other. */
  const checked = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      if (err instanceof WalkthroughFileError) throw invalid(err.message);
      throw err;
    }
  };

  const resolve = async (person: P, ref: string): Promise<string> => {
    const id = await repository.resolve(query, ref, ownerOf(person));
    if (!id) throw notFound();
    return id;
  };

  const recordingOf = (): FlindersRecording<P> => {
    if (!recording) throw featureOff('Recording');
    return recording;
  };
  const recorder = (person: P, setup: FlindersRecording<P>): RecordingPerson => ({ id: person.id, mayRecord: () => setup.mayRecord(person) });

  const flinders = {
    repository,

    /** Saves the product's own walkthrough files as live, on every start: a file with a number that hasn't changed saves nothing. */
    async publish(files: readonly unknown[]): Promise<void> {
      for (const file of files) await repository.saveFile(query, file, { createdBy: null, status: 'live', skipIfSame: true });
    },

    /** `listWalkthroughs`: every live walkthrough this person can read. */
    list: (person: P): Promise<Walkthrough[]> => repository.served(reads(person), person.owner),
    /** `getMyProgress` */
    mine,
    /** `setOffers` */
    async setOffers(person: P, body: unknown): Promise<{ offer_walkthroughs: boolean; progress: Record<string, WalkthroughProgress> }> {
      const { offer_walkthroughs } = read(offersBody, body);
      if (!config.offers) throw featureOff('The offers switch');
      await config.offers.set(person, offer_walkthroughs);
      return mine(person);
    },
    /** `recordEvent`: saved as the person's own one row, then told to `events`. */
    async record(person: P, walkthroughId: string, body: unknown) {
      const parsed = parseWalkthroughRef(walkthroughId);
      if (!parsed || !('id' in parsed)) throw notFound();
      const event = read(walkthroughEventSchema, body);
      const result = await repository.recordEvent(reads(person), query, person.id, parsed.id, event, person.owner);
      if (result === 'not_found') throw notFound();
      if (result === 'no_such_version') throw invalid('That version of the walkthrough doesn’t exist.');
      await tell({ type: 'event', person, walkthrough_id: parsed.id, event });
      return mine(person);
    },

    /** `adminList`: every walkthrough of the person's owner. */
    adminList: (person: P): Promise<AdminWalkthrough[]> => repository.adminList(query, ownerOf(person)),
    /** `adminDetail`, by handle, number or original id. */
    async adminDetail(person: P, ref: string): Promise<AdminWalkthroughDetail> {
      const detail = await repository.adminDetail(query, await resolve(person, ref), ownerOf(person));
      if (!detail) throw notFound();
      return detail;
    },
    /** `adminStats` */
    adminStats: async (person: P, ref: string): Promise<WalkthroughStats> => (await flinders.adminDetail(person, ref)).stats,
    /** `adminUpload`: a walkthrough file, always saved as a draft. */
    adminUpload: (person: P, file: unknown): Promise<SavedVersion> => checked(() => repository.saveFile(query, file, { createdBy: person.id, status: 'draft', owner: ownerOf(person) })),
    /** `adminSaveVersion`: Make live, Make inactive, Restore. */
    async adminSaveVersion(person: P, ref: string, body: unknown): Promise<SavedVersion> {
      const { from_version, status } = read(versionBody, body);
      const id = await resolve(person, ref);
      const saved = await checked(() => repository.copyVersion(query, id, from_version, status as WalkthroughStatus, person.id, ownerOf(person)));
      if (!saved) throw notFound('That version of the walkthrough doesn’t exist.');
      return saved;
    },

    /** `adminCreateRecordingLink` */
    async createRecordingLink(person: P): Promise<{ link: string; url: string; expires_at: string }> {
      const setup = recordingOf();
      const made = createRecordingLink(person.id, { secret: setup.secret });
      await tell({ type: 'recording_link_created', person });
      return { ...made, url: recordingLinkUrl(setup.webUrl, made.link) };
    },
    /** `checkRecordingLink`: for the person who created it, while they may record. A good link comes back fresh. */
    checkRecordingLink(person: P, body: unknown): Promise<RecordingLinkCheck & { link?: string }> {
      const setup = recordingOf();
      return checkAndRenewRecordingLink(read(checkBody, body).link, recorder(person, setup), { secret: setup.secret });
    },
    /** `saveRecording`: a new draft, by the person who created the link. */
    async saveRecording(person: P, body: unknown): Promise<SavedVersion> {
      const setup = recordingOf();
      const { link: given, steps } = read(recordingBody, body);
      const result = await checked(() => repository.saveRecording(query, given, recorder(person, setup), steps, { secret: setup.secret, owner: ownerOf(person) }));
      if ('refused' in result) throw new FlindersError(403, 'forbidden', setup.refused?.[result.refused] ?? LINK_REFUSED[result.refused]);
      await tell({ type: 'recording_saved', person, saved: result.saved, created_by: result.created_by, steps: steps.length });
      return result.saved;
    },

    /** An AI first draft, for a person to edit. Saves nothing. */
    async draft(input: { source: DraftSource; mode: WalkthroughMode; instructions?: string; article?: string }): Promise<CheckedDraft> {
      if (!config.ask) throw featureOff('AI drafting');
      const lists = (config.app ?? {}) as Partial<DraftApp> & AppLists;
      const app = 'anchorExists' in lists ? (lists as AppChecks) : appChecks(lists);
      return draftWalkthrough({ ...input, app: { ...lists, ...app, anchors: lists.anchors ?? [], ...(lists.pages && !lists.routes ? { routes: lists.pages } : {}) }, ask: config.ask });
    },

    /**
     * The whole contract behind one call: finds the route, checks who's asking and answers with a
     * status and JSON. Anything unexpected is thrown, for your own error handling to log.
     */
    async handle(request: FlindersHandleRequest<P>): Promise<FlindersHandleResponse> {
      const failure = (status: number, code: string, message: string) => ({ status, body: { error: { code, message } } satisfies FlindersErrorBody });
      const found = (Object.keys(FLINDERS_ROUTES) as FlindersRouteName[]).flatMap((route) => {
        const params = matchPath(FLINDERS_ROUTES[route].path, request.path);
        return params ? [{ route, params }] : [];
      });
      const match = found.find(({ route }) => FLINDERS_ROUTES[route].method === request.method.toUpperCase());
      if (!match) return found.length ? failure(405, 'method_not_allowed', 'That route doesn’t take this method.') : failure(404, 'not_found', 'No such route.');
      const person = request.person;
      if (!person) return failure(401, 'unauthorized', 'Sign in first.');
      if (match.route.startsWith('admin') && !person.admin) return failure(403, 'forbidden', 'This is for admins.');
      const ref = match.params['walkthroughId'] ?? '';
      const answers: Record<FlindersRouteName, () => Promise<{ status?: number; body: unknown }>> = {
        listWalkthroughs: async () => ({ body: { data: await flinders.list(person) } }),
        getMyProgress: async () => ({ body: await flinders.mine(person) }),
        setOffers: async () => ({ body: await flinders.setOffers(person, request.body) }),
        recordEvent: async () => ({ body: await flinders.record(person, ref, request.body) }),
        checkRecordingLink: async () => ({ body: await flinders.checkRecordingLink(person, request.body) }),
        saveRecording: async () => ({ status: 201, body: await flinders.saveRecording(person, request.body) }),
        adminList: async () => ({ body: { data: await flinders.adminList(person) } }),
        adminUpload: async () => ({ status: 201, body: await flinders.adminUpload(person, request.body) }),
        adminDetail: async () => ({ body: await flinders.adminDetail(person, ref) }),
        adminSaveVersion: async () => ({ status: 201, body: await flinders.adminSaveVersion(person, ref, request.body) }),
        adminStats: async () => ({ body: await flinders.adminStats(person, ref) }),
        adminCreateRecordingLink: async () => ({ status: 201, body: await flinders.createRecordingLink(person) }),
      };
      try {
        const { status, body } = await answers[match.route]();
        return { status: status ?? 200, body };
      } catch (err) {
        if (err instanceof FlindersError) return failure(err.status, err.code, err.message);
        throw err;
      }
    },
  };
  return flinders;
}

export type FlindersServer<P extends FlindersPerson = FlindersPerson> = ReturnType<typeof createFlinders<P>>;
