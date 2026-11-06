import { matchRoute, missingRouteParam } from './routes.js';
import { WALKTHROUGH_LABELS } from './types.js';
import type { Walkthrough, WalkthroughLabels, WalkthroughMode, WalkthroughProgress } from './types.js';

/** Words that never pick a walkthrough ("show me how to add a project" → add, project). */
const STOP_WORDS = new Set(['the', 'how', 'show', 'walkthrough', 'walkthroughs', 'tour', 'guide', 'through', 'demo', 'again', 'restart', 'start', 'please', 'with', 'for', 'about', 'this', 'page', 'and', 'can', 'you']);

/** A walkthrough's handle: `<number>-<slug>` (`4-project-settings`). The number is its identity. */
export function walkthroughHandle(w: { number: number; slug: string }): string {
  return `${w.number}-${w.slug}`;
}

/**
 * What a reference to a walkthrough names: its handle (`4-project-settings`; the slug part is
 * ignored, so an old name still finds it), a bare number (`4`) or its original id. Null = none.
 */
export function parseWalkthroughRef(ref: string): { number: number } | { id: string } | null {
  const text = ref.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return { id: text.toLowerCase() };
  const m = /^(\d{1,9})(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/.exec(text);
  const number = m ? Number(m[1]) : 0;
  return number >= 1 ? { number } : null;
}

/** The walkthrough a reference names, found by its number (or original id). */
export function findWalkthrough<T extends { walkthrough_id: string; number: number }>(list: readonly T[], ref: string): T | null {
  const exact = list.find((w) => w.walkthrough_id === ref);
  if (exact) return exact;
  const parsed = parseWalkthroughRef(ref);
  if (!parsed) return null;
  return list.find((w) => ('number' in parsed ? w.number === parsed.number : w.walkthrough_id === parsed.id)) ?? null;
}

/** Every route a walkthrough visits, and where it is offered. */
export function walkthroughRoutes(w: Pick<Walkthrough, 'offer_on' | 'steps'>): string[] {
  return [w.offer_on, ...w.steps.map((s) => s.route)].filter((r): r is string => !!r);
}

/** The first page a walkthrough needs, or null when it can start anywhere. */
export function walkthroughFirstRoute(w: Pick<Walkthrough, 'steps'>): string | null {
  return w.steps.find((s) => s.route)?.route ?? null;
}

/** The walkthrough is about this page. */
export function walkthroughIsHere(w: Pick<Walkthrough, 'offer_on' | 'steps'>, url: string): boolean {
  return walkthroughRoutes(w).some((r) => !!matchRoute(r, url));
}

/**
 * The JSON a product's chat turns into its own answer. For a request ("show me", "walkthrough on
 * signing off"): those on this page first, then those whose title or article matches the words,
 * then the rest when nothing was named. A number or handle ("4") names that one walkthrough.
 * Ignores offers and what the person has seen: asking always works.
 */
export function matchWalkthroughs<T extends Pick<Walkthrough, 'walkthrough_id' | 'number' | 'offer_on' | 'steps' | 'title' | 'slug' | 'article_slug'>>(
  list: readonly T[],
  url: string,
  topic: string,
): { walkthrough: T; here: boolean }[] {
  if (/^\d/.test(topic.trim())) {
    const w = findWalkthrough(list, topic.trim().toLowerCase());
    return w ? [{ walkthrough: w, here: walkthroughIsHere(w, url) }] : [];
  }
  const words = topic.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const scored = list.map((w) => {
    // A word in the title counts double: "add project" picks Add a project, not a walkthrough
    // that merely has a step about it.
    const title = [w.title, w.slug, w.article_slug ?? ''].join(' ').toLowerCase();
    const steps = w.steps.map((s) => s.title).join(' ').toLowerCase();
    const hits = words.reduce((n, word) => {
      const stem = word.replace(/s$/, '');
      return n + (title.includes(stem) ? 2 : steps.includes(stem) ? 1 : 0);
    }, 0);
    return { walkthrough: w, here: walkthroughIsHere(w, url), hits };
  });
  return scored
    .filter((x) => (words.length > 0 ? x.hits > 0 : true))
    .sort((a, b) => b.hits - a.hits || Number(b.here) - Number(a.here) || a.walkthrough.title.localeCompare(b.walkthrough.title))
    .map(({ walkthrough, here }) => ({ walkthrough, here }));
}

/** How offers treat what a person has already done with a walkthrough. */
export interface OfferRules {
  /**
   * True: only Done and Not now stop an offer, so a walkthrough left part-way (Finish later, Esc,
   * another page) is offered again. False (the default): any progress counts as seen.
   */
  reofferUnfinished?: boolean;
}

/**
 * The person has seen this walkthrough, for offers: a row on or after its `reoffer_from` version.
 * With `reofferUnfinished`, only a finished or dismissed row counts; started and paused don't.
 */
export function offerSeen(w: Pick<Walkthrough, 'reoffer_from'>, progress: WalkthroughProgress | undefined, rules: OfferRules = {}): boolean {
  if (!progress || progress.v < w.reoffer_from) return false;
  return !rules.reofferUnfinished || progress.status === 'completed' || progress.status === 'dismissed';
}

/**
 * The walkthrough to offer on this page, if any: one with a matching `offer_on`, that the person
 * may see and hasn't seen since its `reoffer_from` version. Finished, paused or Not now all count
 * as seen; with `reofferUnfinished`, only finished and Not now do.
 */
export function walkthroughToOffer<T extends Pick<Walkthrough, 'walkthrough_id' | 'offer_on' | 'permission' | 'reoffer_from'>>(
  list: readonly T[],
  url: string,
  person: { progress: Readonly<Record<string, WalkthroughProgress>>; can: (permission: string) => boolean },
  rules: OfferRules = {},
): T | null {
  return (
    list.find(
      (w) =>
        !!w.offer_on &&
        !!matchRoute(w.offer_on, url) &&
        (!w.permission || person.can(w.permission)) &&
        !offerSeen(w, person.progress[w.walkthrough_id], rules),
    ) ?? null
  );
}

/** One task on a person's list: the walkthroughs that do it, the recommended one first. */
export interface ChecklistRow<T> {
  title: string;
  done: boolean;
  options: T[];
}

/**
 * A person's list of walkthroughs from this URL, one row per task, by number. A Show me and a
 * Guide me with the same `offer_on` are one task: one row, Guide me first, done once either was
 * finished on or after its `reoffer_from` version (Finish later and Not now aren't finished, so
 * `reofferUnfinished` changes nothing here: a row is ticked only by Done).
 * Leaves out what the person may not see and what can't start here, because its first page needs
 * an id this URL doesn't give; both are still offered on their own pages, and asking still works.
 * Empty once nothing startable is left to do, so the list goes away.
 */
export function checklistFor<T extends Pick<Walkthrough, 'walkthrough_id' | 'number' | 'title' | 'mode' | 'offer_on' | 'permission' | 'reoffer_from' | 'steps'>>(
  list: readonly T[],
  progress: Readonly<Record<string, WalkthroughProgress>>,
  can: (permission: string) => boolean,
  url: string,
): ChecklistRow<T>[] {
  const finished = (w: T) => {
    const p = progress[w.walkthrough_id];
    return p?.status === 'completed' && p.v >= w.reoffer_from;
  };
  const canStart = (w: T) => {
    const first = walkthroughFirstRoute(w);
    return !first || !missingRouteParam(first, url);
  };
  const tasks: T[][] = [];
  for (const w of list.filter((x) => !x.permission || can(x.permission)).sort((a, b) => a.number - b.number)) {
    const task = w.offer_on ? tasks.find((t) => t[0]!.offer_on === w.offer_on && t.every((x) => x.mode !== w.mode)) : undefined;
    if (task) task.push(w);
    else tasks.push([w]);
  }
  const rows = tasks.flatMap((task) => {
    const options = task.filter(canStart).sort((a, b) => Number(b.mode === 'guide') - Number(a.mode === 'guide'));
    return options[0] ? [{ title: task[0]!.title, done: task.some(finished), options }] : [];
  });
  return rows.every((r) => r.done) ? [] : rows;
}

/** The button that starts a walkthrough of this kind. */
export function modeLabel(mode: WalkthroughMode, labels: Pick<WalkthroughLabels, 'show' | 'guide'> = WALKTHROUGH_LABELS): string {
  return mode === 'guide' ? labels.guide : labels.show;
}

/**
 * Why a walkthrough with this first page can't start from this URL, or null when it can. `reasons`
 * says what to open first for each id a route needs: `{ projectId: 'Open a project first.' }`.
 */
export function openFirstReason(firstRoute: string | null, url: string, reasons: Readonly<Record<string, string>> = {}): string | null {
  const missing = firstRoute && missingRouteParam(firstRoute, url);
  return missing ? (reasons[missing] ?? 'Open the page it’s about first.') : null;
}

/** Where to pick up: the paused step of this version, else the beginning. */
export function resumeStep(w: Pick<Walkthrough, 'version'>, progress: WalkthroughProgress | undefined): number {
  return progress && progress.v === w.version && progress.status === 'paused' ? progress.step : 0;
}
