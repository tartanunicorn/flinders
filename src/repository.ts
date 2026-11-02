/**
 * The repository: the file format, its checks, and every read and write of the
 * two tables (sql/001_walkthroughs.sql). It never opens a connection: each call takes the product's
 * own `FlindersQuery`, so the product's tenancy, row-level security and audit stay in charge. Admin screens and
 * chats are the product's own; these return the JSON they draw from.
 */
import { z } from 'zod';

import { recordingFile, unwrittenSteps } from './editor.js';
import { walkthroughHandle, parseWalkthroughRef } from './logic.js';
import { checkRecordingLinkFor, type RecordingLinkOptions, type RecordingPerson } from './recording-link.js';
import { MAX_ARTICLE_HINTS, MAX_WALKTHROUGH_STEPS } from './types.js';
import type {
  AdminWalkthrough,
  AdminWalkthroughDetail,
  ProgressStatus,
  SavedVersion,
  StepHow,
  Walkthrough,
  WalkthroughMode,
  WalkthroughProgress,
  WalkthroughStats,
  WalkthroughStatus,
} from './types.js';

export { parseWalkthroughRef, walkthroughHandle };
export { fillRecordedWords, recordingFile } from './editor.js';
export * from './recording-link.js';
export type {
  AdminWalkthrough,
  AdminWalkthroughDetail,
  AdminWalkthroughVersion,
  SavedVersion,
  StepHow,
  Walkthrough,
  WalkthroughMode,
  WalkthroughProgress,
  WalkthroughStats,
  WalkthroughStatus,
} from './types.js';

/** Runs SQL and returns rows (a pg client's `query(...).rows`). */
export type FlindersQuery = (text: string, params?: unknown[]) => Promise<any[]>;

// ── the file format ──────────────────────────────────────────────────────────

/** An element's `data-testid` (kebab-case). */
const anchor = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80);
const side = z.enum(['top', 'bottom', 'left', 'right']);
const title = z.string().trim().min(1).max(80);
const body = z.string().trim().min(1).max(400);
/** One of the app's own pages. `//other.site` starts with a slash too, and a router would go there. */
const pagePath = z.string().regex(/^\/(?![/\\])/, 'must be a page in the app, starting with one /').max(200);

/** The articles most relevant to a walkthrough or step. Opaque: a url, an id or a slug, never fetched or checked. */
const articleHints = z.array(z.string().min(1).max(500)).max(MAX_ARTICLE_HINTS);

export const walkthroughStepSchema = z
  .object({
    /** null = a centred card with nothing highlighted. */
    anchor: anchor.nullable(),
    /** Route pattern the step is on (`/projects/:projectId/settings`); absent = wherever the last step was. */
    route: pagePath.optional(),
    title,
    body,
    side: side.optional(),
    align: z.enum(['start', 'center', 'end']).optional(),
    /** appear = wait while the page is still loading (until it settles, at most 4 s); person = wait as long as it takes for the person to act. */
    wait_for: z.enum(['appear', 'person']).optional(),
    /** The person clicks the real control to go on; a step never clicks for them. */
    advance_on_click: z.boolean().optional(),
    /** In a guide walkthrough, what moves the step on (Next is hidden). */
    done_when: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.enum(['clicked', 'filled', 'chosen']) }).strict(),
        z.object({ kind: z.literal('appears'), anchor }).strict(),
        z.object({ kind: z.literal('route'), route: pagePath }).strict(),
      ])
      .optional(),
    /** What's highlighted can be used, and the person still presses Next. */
    optional: z.boolean().optional(),
    /** Seconds before a guide step offers "Can't find it?"; 3 by default. */
    help_after: z.number().int().min(1).max(120).optional(),
    /** Things that stop a person doing this step: when one shows, the card says this instead. */
    blocked: z.array(z.object({ anchor, title: title.optional(), body }).strict()).max(5).optional(),
    /** A fork: the step applies only while this element, or any of these, is on screen. */
    only_if: z.union([anchor, z.array(anchor).min(1).max(5)]).optional(),
    /** Phones and touch screens: different element or copy, or skip the step. */
    phone: z.union([z.literal('skip'), z.object({ anchor: anchor.nullable(), title, body, side }).partial().strict()]).optional(),
    /** The articles most relevant to this step, for the product's chat. */
    articles: articleHints.optional(),
    /** When the element isn't there: another element, a centred card, or end the walkthrough. */
    missing: z.union([z.enum(['centred', 'end']), z.object({ alt: anchor.optional(), body: body.optional() }).strict()]),
  })
  .strict();

export const walkthroughStepsSchema = z.array(walkthroughStepSchema).min(1).max(MAX_WALKTHROUGH_STEPS);
export type ParsedStep = z.infer<typeof walkthroughStepSchema>;

export const walkthroughEventSchema = z
  .object({
    event: z.enum(['started', 'paused', 'completed', 'dismissed', 'step']),
    version: z.number().int().min(1),
    step: z.number().int().min(0).max(29),
    /** On a `step` event: Next, Back, by doing it, or past it. */
    how: z.enum(['next', 'back', 'done', 'skipped']).optional(),
    /** Where it was started from. */
    from: z.enum(['offer', 'article', 'checklist', 'chat', 'list', 'dev']).optional(),
  })
  .strict();
export type WalkthroughEvent = z.infer<typeof walkthroughEventSchema>;

/** The newest file format this package reads. schema/walkthrough.schema.json says the same. */
export const WALKTHROUGH_FORMAT_VERSION = 1;

/** A walkthrough as uploaded or seeded: the JSON file's shape. `permissions` is the product's list. */
export function createFileSchema(permissions?: readonly [string, ...string[]]) {
  return z
    .object({
      /**
       * Which format the file is written in; 1 when absent. Only read here, never saved. It comes
       * first so a newer file gets this message, not a complaint about a field it added.
       */
      format_version: z
        .number()
        .int()
        .min(1)
        .superRefine((version, ctx) => {
          if (version > WALKTHROUGH_FORMAT_VERSION) {
            ctx.addIssue({ code: 'custom', message: `this file is format ${version}, but this version of the package only reads up to format ${WALKTHROUGH_FORMAT_VERSION}. Update the package to use it.` });
          }
        })
        .default(1),
      /**
       * The walkthrough's number: its identity, the same on every version. A file with a number adds
       * a version to that walkthrough (a different slug or title = a rename); without one, it is a
       * new walkthrough with the next number.
       */
      number: z.number().int().min(1).max(999_999_999).optional(),
      /** Its readable name (the handle's second part). May change from one version to the next. */
      slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120),
      title: z.string().trim().min(1).max(120),
      /** show (the default): read and press Next; guide: do the real thing. */
      mode: z.enum(['show', 'guide']).optional(),
      /** The article it belongs to (Learn more). */
      article: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120).nullable().optional(),
      /** The articles most relevant to it, for the product's chat. */
      articles: articleHints.optional(),
      permission: (permissions ? z.enum(permissions) : z.string().min(1).max(120)).nullable().optional(),
      /** Route pattern where it is offered the first time (`/projects/:projectId/settings`). */
      offer_on: z.string().startsWith('/').max(200).nullable().optional(),
      /** Raise this to the new version to offer it again to people who saw an older one. */
      reoffer_from: z.number().int().min(1).optional(),
      /** Seed files say `live`; an upload is always saved as a draft first. */
      status: z.enum(['draft', 'live', 'inactive']).optional(),
      steps: walkthroughStepsSchema,
    })
    .strict();
}
export type WalkthroughFile = z.infer<ReturnType<typeof createFileSchema>>;

// ── checks ───────────────────────────────────────────────────────────────────

/** What only the product knows: what a walkthrough may point at and the words it won't use. */
export interface AppChecks {
  anchorExists(id: string): boolean;
  routeExists(route: string): boolean;
  /** Words a walkthrough won't use: a list (any case, plurals, with or without a space) or a pattern. */
  retiredWords?: RegExp | readonly string[];
}

/** The same as lists, which is how most products have it. Left out, anything is accepted. */
export interface AppLists {
  /** Every element, as `flinders-check --list` writes them: a bound one as `open-*`. */
  anchors?: readonly string[];
  /** Every page's route pattern. A `:param` here fits any value. */
  pages?: readonly string[];
  retiredWords?: RegExp | readonly string[];
}

/** Lists as checks. */
export function appChecks(lists: AppLists = {}): AppChecks {
  const { anchors, pages, retiredWords } = lists;
  const fixed = new Set(anchors?.filter((a) => !a.endsWith('*')));
  const starts = anchors?.filter((a) => a.endsWith('*')).map((a) => a.slice(0, -1)) ?? [];
  const parts = (route: string) => route.split('/').filter(Boolean);
  return {
    anchorExists: (id) => !anchors || fixed.has(id) || starts.some((start) => id.startsWith(start) && id.length > start.length),
    routeExists: (route) => {
      const want = parts(route);
      return !pages || pages.some((page) => parts(page).length === want.length && parts(page).every((seg, i) => seg.startsWith(':') || seg === want[i]));
    },
    ...(retiredWords ? { retiredWords } : {}),
  };
}

/** A list of words as the pattern `stepProblems` checks: `work order` also catches `Workorders` and `work-order`. */
function retiredPattern(words: RegExp | readonly string[] | undefined): RegExp | null {
  if (!words || words instanceof RegExp) return words ?? null;
  if (!words.length) return null;
  const each = words.map((word) => `${word.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]?')}s?`);
  return new RegExp(`\\b(${each.join('|')})\\b`, 'i');
}

/** Mouse-only actions: copy a phone or touch screen shows says "tap" instead. */
const MOUSE_WORDS = /\b(hover(s|ing)?|(right-)?click(s|ed|ing)?)\b/i;

/**
 * Everything wrong with a walkthrough's steps that its shape can't show: an element that isn't in
 * the app (a typo, or renamed since), a page that doesn't exist, a retired word, hover or click in
 * what a touch screen shows. Empty = fine. Used to refuse an upload and to mark a live walkthrough
 * "Needs update" after a deploy.
 */
export function stepProblems(steps: readonly ParsedStep[], app: AppChecks): string[] {
  const problems: string[] = [];
  const retired = retiredPattern(app.retiredWords);
  steps.forEach((s, i) => {
    const at = `step ${i + 1}`;
    const anchors = [
      ['', s.anchor],
      ['fallback ', typeof s.missing === 'object' ? s.missing.alt : null],
      ['phone ', typeof s.phone === 'object' ? s.phone.anchor : null],
      ['done-when ', s.done_when?.kind === 'appears' ? s.done_when.anchor : null],
      ...(s.blocked ?? []).map((b) => ['blocked ', b.anchor] as const),
      ...[s.only_if ?? []].flat().map((id) => ['only-if ', id] as const),
    ] as const;
    for (const [kind, id] of anchors) {
      if (id && !app.anchorExists(id)) problems.push(`${at}: no ${kind}element “${id}” in the app`);
    }
    if (s.route && !app.routeExists(s.route)) problems.push(`${at}: no page “${s.route}” in the app`);
    if (s.done_when?.kind === 'route' && !app.routeExists(s.done_when.route)) problems.push(`${at}: no page “${s.done_when.route}” in the app`);
    const copy = [s.title, s.body, typeof s.phone === 'object' ? `${s.phone.title ?? ''} ${s.phone.body ?? ''}` : '', typeof s.missing === 'object' ? (s.missing.body ?? '') : ''].join(' ');
    const word = retired?.exec(copy)?.[0];
    if (word) problems.push(`${at}: “${word}” is a retired word`);
    // Phones and touch screens show the phone copy, else the step's own: neither can hover or click.
    if (s.phone !== 'skip') {
      const touch = [s.phone?.title ?? s.title, s.phone?.body ?? s.body, typeof s.missing === 'object' ? (s.missing.body ?? '') : ''].join(' ');
      const mouse = MOUSE_WORDS.exec(touch)?.[0];
      if (mouse) problems.push(`${at}: “${mouse}” can’t be done on a touch screen: add phone copy (tap)`);
    }
  });
  return problems;
}

/** Thrown for anything a person can fix in their file (shown to them as is). */
export class WalkthroughFileError extends Error {}

/** Explains a schema failure in one line: where in the file, and what's wrong. */
export function describeSchemaError(error: z.ZodError): string {
  const first = error.issues[0];
  if (!first) return 'The walkthrough file isn’t valid.';
  const where = first.path.length ? first.path.join(' ▸ ') : 'the file';
  return `${where}: ${first.message}`;
}

// ── the tables ───────────────────────────────────────────────────────────────

export interface WalkthroughsConfig {
  /** The two tables, named as the product likes. Default: `walkthroughs` and `walkthroughs_progress`. */
  tables?: { versions: string; progress: string };
  /** The column saying who owns a walkthrough; null in it = the product's own. Default `owner_id`. */
  ownerColumn?: string;
  /** Articles as rows of the product: `article_id` is then a foreign key. Otherwise the slug stays in `definition`. */
  articles?: { table: string };
  /** Shows a person's name, not their id, in admin lists. */
  people?: { table: string; nameColumn: string };
  /** The product's permission names; any text when absent. */
  permissions?: readonly [string, ...string[]];
  /** What a walkthrough may point at: checks or plain lists. Left out, anything is accepted. */
  app?: AppChecks | AppLists;
}

/** One version's `definition` column. */
export interface WalkthroughDefinition {
  slug: string;
  title: string;
  status: WalkthroughStatus;
  /** Absent = show. */
  mode?: WalkthroughMode;
  permission: string | null;
  offer_on: string | null;
  reoffer_from: number;
  article?: string | null;
  /** Stored only when there are any, as older versions have none. */
  articles?: string[];
  steps: unknown;
}

/** JSON with object keys sorted, so jsonb's own key order never counts as a change. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Table and column names come from configuration, never from a request; still, only plain names pass. */
function name(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Not a table or column name: ${value}`);
  return value;
}

export function createWalkthroughRepository(config: WalkthroughsConfig = {}) {
  const versions = name(config.tables?.versions ?? 'walkthroughs');
  const progress = name(config.tables?.progress ?? 'walkthroughs_progress');
  const app: AppChecks = config.app && 'anchorExists' in config.app ? config.app : appChecks(config.app);
  const owner = name(config.ownerColumn ?? 'owner_id');
  const articles = config.articles ? name(config.articles.table) : null;
  const people = config.people ? { table: name(config.people.table), nameColumn: name(config.people.nameColumn) } : null;
  const fileSchema = createFileSchema(config.permissions);

  const articleJoin = (alias: string, live: boolean) =>
    articles ? `LEFT JOIN ${articles} a ON a.id = ${alias}.article_id${live ? ' AND a.deleted_at IS NULL' : ''}` : '';
  const articleSlug = (alias: string) => (articles ? 'a.slug' : `${alias}.definition->>'article'`);
  const articleTitle = articles ? 'a.title' : 'NULL::text';
  const personJoin = (alias: string) => (people ? `LEFT JOIN ${people.table} u ON u.id = ${alias}.created_by` : '');
  const personName = (alias: string) => (people ? `u.${people.nameColumn}` : `${alias}.created_by::text`);

  const problemsOf = (steps: unknown): string[] => {
    const parsed = walkthroughStepsSchema.safeParse(steps);
    return parsed.success ? stepProblems(parsed.data, app) : ['its steps no longer match the walkthrough format'];
  };

  const repository = {
    fileSchema,
    problemsOf,

    /**
     * The served version of each walkthrough: its newest non-draft row, if that row is live. A draft
     * saved after a live version doesn't replace it until it is made live (a new row again). With
     * `ownerId` (null included), only the product's own and that owner's; left out, every owner's,
     * for a product whose row-level security narrows them.
     */
    async served(q: FlindersQuery, ownerId?: string | null): Promise<Walkthrough[]> {
      const narrowed = ownerId !== undefined;
      const rows = await q(
        `SELECT * FROM (
           SELECT DISTINCT ON (w.walkthrough_id)
                  w.walkthrough_id, w.${owner} AS owner, w.number, w.version, w.definition, ${articleSlug('w')} AS article_slug
             FROM ${versions} w
             ${articleJoin('w', true)}
            WHERE w.definition->>'status' <> 'draft'${narrowed ? ` AND (w.${owner} IS NULL OR w.${owner} = $1)` : ''}
            ORDER BY w.walkthrough_id, w.version DESC
         ) current
         WHERE definition->>'status' = 'live'
         ORDER BY owner NULLS FIRST, number`,
        narrowed ? [ownerId] : [],
      );
      // A row that no longer matches the step schema is left out rather than breaking every page.
      return rows.flatMap((row) => {
        const definition = row.definition as WalkthroughDefinition;
        const steps = walkthroughStepsSchema.safeParse(definition.steps);
        if (!steps.success) return [];
        return [
          {
            walkthrough_id: row.walkthrough_id as string,
            number: row.number as number,
            handle: walkthroughHandle({ number: row.number, slug: definition.slug }),
            version: row.version as number,
            slug: definition.slug,
            title: definition.title,
            mode: definition.mode ?? 'show',
            permission: definition.permission,
            offer_on: definition.offer_on,
            reoffer_from: definition.reoffer_from,
            article_slug: row.article_slug as string | null,
            articles: definition.articles ?? [],
            steps: steps.data as Walkthrough['steps'],
          },
        ];
      });
    },

    /** The highest version of a walkthrough; null when there is no such walkthrough. With `ownerId`, it must be the product's own or that owner's. */
    async latestVersion(q: FlindersQuery, walkthroughId: string, ownerId?: string | null): Promise<number | null> {
      const rows =
        ownerId === undefined
          ? await q(`SELECT max(version) AS last FROM ${versions} WHERE walkthrough_id = $1`, [walkthroughId])
          : await q(`SELECT max(version) AS last FROM ${versions} WHERE walkthrough_id = $1 AND (${owner} IS NULL OR ${owner} = $2)`, [walkthroughId, ownerId]);
      return (rows[0]?.last as number | null | undefined) ?? null;
    },

    /** Every walkthrough of one owner (the product's own by default): its newest version and the live one. */
    async adminList(q: FlindersQuery, ownerId: string | null = null): Promise<AdminWalkthrough[]> {
      const newestServed = (column: string) =>
        `(SELECT ${column} FROM ${versions} n WHERE n.walkthrough_id = w.walkthrough_id AND n.definition->>'status' <> 'draft' ORDER BY n.version DESC LIMIT 1)`;
      const rows = await q(
        `SELECT w.walkthrough_id, w.number, w.definition, w.version AS latest_version,
                ${newestServed('n.version')} AS served_version,
                ${newestServed('n.definition')} AS served_doc,
                ${articleSlug('w')} AS article_slug, ${articleTitle} AS article_title,
                w.created_at AS updated_at, ${personName('w')} AS updated_by
           FROM (SELECT DISTINCT ON (walkthrough_id) * FROM ${versions}
                  WHERE ${owner} IS NOT DISTINCT FROM $1 ORDER BY walkthrough_id, version DESC) w
           ${articleJoin('w', false)}
           ${personJoin('w')}
          ORDER BY w.number`,
        [ownerId],
      );
      return rows.map((r) => {
        const definition = r.definition as WalkthroughDefinition;
        const served = r.served_doc as WalkthroughDefinition | null;
        const live = served?.status === 'live';
        return {
          walkthrough_id: r.walkthrough_id,
          number: r.number,
          handle: walkthroughHandle({ number: r.number, slug: definition.slug }),
          slug: definition.slug,
          title: definition.title,
          mode: definition.mode ?? 'show',
          latest_version: r.latest_version,
          latest_status: definition.status,
          live_version: live ? r.served_version : null,
          article_slug: r.article_slug,
          article_title: r.article_title,
          permission: definition.permission,
          offer_on: definition.offer_on,
          reoffer_from: definition.reoffer_from,
          steps_count: Array.isArray(definition.steps) ? definition.steps.length : 0,
          updated_at: (r.updated_at as Date).toISOString(),
          updated_by: r.updated_by,
          // Only what people get can need an update; a draft or inactive version shows its own.
          problems: live ? problemsOf(served?.steps) : [],
        };
      });
    },

    /** A reference (handle, number or original id) to one of an owner's walkthroughs (the product's own by default): its original id, or null. */
    async resolve(q: FlindersQuery, ref: string, ownerId: string | null = null): Promise<string | null> {
      const parsed = parseWalkthroughRef(ref);
      if (!parsed) return null;
      const rows = await q(
        `SELECT walkthrough_id FROM ${versions} WHERE ${owner} IS NOT DISTINCT FROM $2 AND ${'number' in parsed ? 'number' : 'walkthrough_id'} = $1 LIMIT 1`,
        ['number' in parsed ? parsed.number : parsed.id, ownerId],
      );
      return (rows[0]?.walkthrough_id as string | undefined) ?? null;
    },

    /** Every version of one of an owner's walkthroughs (the product's own by default), newest first; null when there is none. */
    async adminDetail(q: FlindersQuery, walkthroughId: string, ownerId: string | null = null): Promise<AdminWalkthroughDetail | null> {
      const rows = await q(
        `SELECT w.number, w.version, w.definition, ${articleSlug('w')} AS article_slug, w.created_at, ${personName('w')} AS created_by
           FROM ${versions} w
           ${articleJoin('w', false)}
           ${personJoin('w')}
          WHERE w.walkthrough_id = $1 AND w.${owner} IS NOT DISTINCT FROM $2
          ORDER BY w.version DESC`,
        [walkthroughId, ownerId],
      );
      const newest = rows[0];
      if (!newest) return null;
      return {
        walkthrough_id: walkthroughId,
        number: newest.number,
        handle: walkthroughHandle({ number: newest.number, slug: (newest.definition as WalkthroughDefinition).slug }),
        stats: await repository.stats(q, walkthroughId, Array.isArray((newest.definition as WalkthroughDefinition).steps) ? ((newest.definition as WalkthroughDefinition).steps as unknown[]).length : 0),
        versions: rows.map((r) => {
          const definition = r.definition as WalkthroughDefinition;
          return {
            version: r.version,
            status: definition.status,
            slug: definition.slug,
            title: definition.title,
            mode: definition.mode ?? 'show',
            article_slug: r.article_slug,
            articles: definition.articles ?? [],
            permission: definition.permission,
            offer_on: definition.offer_on,
            reoffer_from: definition.reoffer_from,
            steps: definition.steps,
            created_at: (r.created_at as Date).toISOString(),
            created_by: r.created_by,
            problems: problemsOf(definition.steps),
          };
        }),
      };
    },

    /** How far people got with one walkthrough, from their progress rows. */
    async stats(q: FlindersQuery, walkthroughId: string, steps: number): Promise<WalkthroughStats> {
      const rows = await q(`SELECT status, furthest_step, actions_done FROM ${progress} WHERE walkthrough_id = $1`, [walkthroughId]);
      return {
        people: rows.length,
        finished: rows.filter((r) => r.status === 'completed').length,
        reached: Array.from({ length: steps }, (_, i) => rows.filter((r) => (r.furthest_step as number) >= i).length),
        actions_done: rows.reduce((n, r) => n + (r.actions_done as number), 0),
      };
    },

    /**
     * Saves the next version from a file, matched by its number: a known number adds a version (a
     * different slug = a rename); a number not used yet starts a walkthrough with it; no number
     * starts one with the next number (the trigger draws it). Numbers are per owner: `owner` (the
     * product's own by default) says whose. With `skipIfSame` (a seed), nothing is saved when the
     * newest version already has this content.
     */
    async saveFile(q: FlindersQuery, input: unknown, opts: { createdBy: string | null; status?: WalkthroughStatus; skipIfSame?: boolean; owner?: string | null }): Promise<SavedVersion> {
      const parsed = fileSchema.safeParse(input);
      if (!parsed.success) throw new WalkthroughFileError(describeSchemaError(parsed.error));
      const file = parsed.data;
      const problems = stepProblems(file.steps, app);
      if (problems.length) throw new WalkthroughFileError(problems.slice(0, 5).join('; ') + (problems.length > 5 ? ` (and ${problems.length - 5} more)` : ''));
      if (file.offer_on && !app.routeExists(file.offer_on)) throw new WalkthroughFileError(`offer_on: no page “${file.offer_on}” in the app`);
      const status = opts.status ?? file.status ?? 'draft';
      const ownerId = opts.owner ?? null;

      let articleId: string | null = null;
      if (file.article && articles) {
        // The owner's own article, else the product's: a customer's walkthrough can point at either.
        const article = await q(`SELECT id FROM ${articles} WHERE (${owner} IS NULL OR ${owner} = $2) AND slug = $1 AND deleted_at IS NULL ORDER BY ${owner} NULLS LAST LIMIT 1`, [file.article, ownerId]);
        if (!article[0]) throw new WalkthroughFileError(`article: no knowledge base article "${file.article}"`);
        articleId = article[0].id as string;
      }

      const latest = file.number
        ? ((
            await q(
              `SELECT walkthrough_id, number, version, definition${articles ? ', article_id' : ''}
                 FROM ${versions}
                WHERE ${owner} IS NOT DISTINCT FROM $2 AND number = $1
                ORDER BY version DESC LIMIT 1`,
              [file.number, ownerId],
            )
          )[0] as { walkthrough_id: string; number: number; version: number; definition: WalkthroughDefinition; article_id?: string | null } | undefined)
        : undefined;

      const mode = file.mode ?? latest?.definition.mode;
      const definition: WalkthroughDefinition = {
        slug: file.slug,
        title: file.title,
        status,
        // Stored only for a guide walkthrough, as older versions have none.
        ...(mode ? { mode } : {}),
        permission: file.permission ?? null,
        offer_on: file.offer_on ?? null,
        // A file that doesn't say keeps the last version's: only raising it offers again.
        reoffer_from: file.reoffer_from ?? latest?.definition.reoffer_from ?? 1,
        ...(articles ? {} : { article: file.article ?? null }),
        ...(file.articles?.length ? { articles: file.articles } : {}),
        steps: file.steps,
      };

      if (latest && opts.skipIfSame && stable(latest.definition) === stable(definition) && (!articles || latest.article_id === articleId)) {
        return { walkthrough_id: latest.walkthrough_id, number: latest.number, handle: walkthroughHandle({ number: latest.number, slug: file.slug }), version: latest.version, status, saved: false };
      }

      const version = (latest?.version ?? 0) + 1;
      // A new walkthrough without a number gets the next one from the trigger.
      const row = (
        await q(
          `INSERT INTO ${versions} (walkthrough_id, ${owner}, number, version, definition, created_by${articles ? ', article_id' : ''})
           VALUES ($1, $2, $3, $4, $5::jsonb, $6${articles ? ', $7' : ''})
           RETURNING walkthrough_id, number`,
          [latest?.walkthrough_id ?? null, ownerId, file.number ?? null, version, JSON.stringify(definition), opts.createdBy, ...(articles ? [articleId] : [])],
        )
      )[0] as { walkthrough_id: string; number: number };
      return { walkthrough_id: row.walkthrough_id, number: row.number, handle: walkthroughHandle({ number: row.number, slug: file.slug }), version, status, saved: true };
    },

    /**
     * Make live, Make inactive and Restore: copies a version into the next, with the status asked
     * for. Null when there is no such version. A version still holding a recording's placeholder
     * words can't go live: a `WalkthroughFileError` says which steps.
     */
    async copyVersion(q: FlindersQuery, walkthroughId: string, fromVersion: number, status: WalkthroughStatus, createdBy: string | null, ownerId: string | null = null): Promise<SavedVersion | null> {
      if (status === 'live') {
        const from = await q(`SELECT definition FROM ${versions} WHERE walkthrough_id = $1 AND version = $2 AND ${owner} IS NOT DISTINCT FROM $3`, [walkthroughId, fromVersion, ownerId]);
        const unwritten = unwrittenSteps(((from[0]?.definition as WalkthroughDefinition | undefined)?.steps ?? []) as { title?: unknown; body?: unknown }[]);
        if (unwritten.length) throw new WalkthroughFileError(`This can’t go live yet: ${unwritten.length === 1 ? `step ${unwritten[0]} still has` : `steps ${unwritten.join(', ')} still have`} the placeholder words from recording. Write them first.`);
      }
      const article = articles ? ['article_id', 'f.article_id'] : null;
      const rows = await q(
        `INSERT INTO ${versions} (walkthrough_id, ${owner}, version, definition, created_by${article ? `, ${article[0]}` : ''})
         SELECT f.walkthrough_id, f.${owner},
                (SELECT max(version) + 1 FROM ${versions} WHERE walkthrough_id = f.walkthrough_id),
                jsonb_set(f.definition, '{status}', to_jsonb($3::text)), $4${article ? `, ${article[1]}` : ''}
           FROM ${versions} f
          WHERE f.walkthrough_id = $1 AND f.version = $2 AND f.${owner} IS NOT DISTINCT FROM $5
         RETURNING walkthrough_id, number, version, definition`,
        [walkthroughId, fromVersion, status, createdBy, ownerId],
      );
      const row = rows[0] as { walkthrough_id: string; number: number; version: number; definition: WalkthroughDefinition } | undefined;
      if (!row) return null;
      return { walkthrough_id: row.walkthrough_id, number: row.number, version: row.version, status: row.definition.status, handle: walkthroughHandle({ number: row.number, slug: row.definition.slug }), saved: true };
    },

    /** One person's progress, keyed by each walkthrough's original id. */
    async progressOf(q: FlindersQuery, userId: string): Promise<Record<string, WalkthroughProgress>> {
      const rows = await q(`SELECT walkthrough_id, seen_version, status, last_step, updated_at FROM ${progress} WHERE user_id = $1`, [userId]);
      return Object.fromEntries(
        rows.map((r) => [
          r.walkthrough_id as string,
          { v: r.seen_version as number, status: r.status as ProgressStatus, step: r.last_step as number, at: (r.updated_at as Date).toISOString() },
        ]),
      );
    },

    /** Saves what a person did with a walkthrough: their one row for it. Not now never takes back a finish: the row stays completed, and only remembers the version seen. */
    async saveProgress(q: FlindersQuery, userId: string, walkthroughId: string, event: { version: number; status: ProgressStatus; step: number }): Promise<void> {
      await q(
        `INSERT INTO ${progress} (user_id, walkthrough_id, seen_version, status, last_step, furthest_step)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (user_id, walkthrough_id)
         DO UPDATE SET seen_version = EXCLUDED.seen_version,
                       status = CASE WHEN ${progress}.status = 'completed' AND EXCLUDED.status = 'dismissed' THEN ${progress}.status ELSE EXCLUDED.status END,
                       last_step = CASE WHEN ${progress}.status = 'completed' AND EXCLUDED.status = 'dismissed' THEN ${progress}.last_step ELSE EXCLUDED.last_step END,
                       furthest_step = GREATEST(${progress}.furthest_step, EXCLUDED.furthest_step), updated_at = now()`,
        [userId, walkthroughId, event.version, event.status, event.step],
      );
    },

    /**
     * One event from the player, saved as the person's progress. `read` finds the walkthrough as
     * the person (your row-level security decides if they can see it); `write` saves their own row.
     * Says what went wrong rather than throwing, so your API words it. `ownerId` narrows it as `served` does.
     */
    async recordEvent(read: FlindersQuery, write: FlindersQuery, userId: string, walkthroughId: string, event: WalkthroughEvent, ownerId?: string | null): Promise<'saved' | 'not_found' | 'no_such_version'> {
      const last = await repository.latestVersion(read, walkthroughId, ownerId);
      if (!last) return 'not_found';
      if (event.version > last) return 'no_such_version';
      if (event.event === 'step') await repository.saveStep(write, userId, walkthroughId, { version: event.version, step: event.step, how: event.how ?? 'next' });
      else await repository.saveProgress(write, userId, walkthroughId, { version: event.version, status: event.event, step: event.step });
      return 'saved';
    },

    /**
     * A finished recording from another site, saved as a new draft by the person who created the
     * link, while they may still record. Never a version of an existing walkthrough and never live:
     * the link only allows a new draft to finish in the admin. `refused` says why the link was no good.
     * `owner` says whose (the product's own by default).
     */
    async saveRecording(q: FlindersQuery, link: string, person: RecordingPerson, steps: Record<string, unknown>[], options: RecordingLinkOptions & { owner?: string | null }): Promise<{ saved: SavedVersion; created_by: string } | { refused: 'invalid' | 'expired' | 'not_allowed' }> {
      const check = await checkRecordingLinkFor(link, person, options);
      if (!check.valid) return { refused: check.reason };
      const saved = await repository.saveFile(q, recordingFile(steps), { createdBy: check.created_by, status: 'draft', owner: options.owner });
      return { saved, created_by: check.created_by };
    },

    /** What a person's browser needs: their offers switch (on unless it's false) and their progress. `settings` is wherever you keep the switch. */
    async mine(q: FlindersQuery, userId: string, settings: { offer_walkthroughs?: unknown } | null | undefined): Promise<{ offer_walkthroughs: boolean; progress: Record<string, WalkthroughProgress> }> {
      const offer = typeof settings?.offer_walkthroughs === 'boolean' ? settings.offer_walkthroughs : true;
      return { offer_walkthroughs: offer, progress: await repository.progressOf(q, userId) };
    },

    /** One move through a walkthrough: how far they've got, leaving its status alone. */
    async saveStep(q: FlindersQuery, userId: string, walkthroughId: string, event: { version: number; step: number; how: StepHow }): Promise<void> {
      const did = event.how === 'done' ? 1 : 0;
      await q(
        `INSERT INTO ${progress} (user_id, walkthrough_id, seen_version, status, last_step, furthest_step, actions_done)
         VALUES ($1, $2, $3, 'started', $4, $4, $5)
         ON CONFLICT (user_id, walkthrough_id)
         DO UPDATE SET seen_version = EXCLUDED.seen_version, last_step = EXCLUDED.last_step,
                       furthest_step = GREATEST(${progress}.furthest_step, EXCLUDED.furthest_step),
                       actions_done = ${progress}.actions_done + EXCLUDED.actions_done, updated_at = now()`,
        [userId, walkthroughId, event.version, event.step, did],
      );
    },
  };
  return repository;
}

export type WalkthroughRepository = ReturnType<typeof createWalkthroughRepository>;
