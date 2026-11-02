import { walkthroughHandle } from './logic.js';
import type { WalkthroughMode, WalkthroughStatus } from './types.js';

/**
 * What an admin screen says, with no screen: a product draws its own grid and pop-outs from these.
 */

export const STATUS_LABELS: Record<WalkthroughStatus, string> = { draft: 'Draft', live: 'Live', inactive: 'Inactive' };

/** How a status looks: a product maps these to its own badge colours. */
export type StatusTone = 'neutral' | 'ok' | 'warn' | 'danger';
export const STATUS_TONES: Record<WalkthroughStatus, StatusTone> = { draft: 'neutral', live: 'ok', inactive: 'warn' };

type Listed = { latest_status: WalkthroughStatus; latest_version: number; live_version: number | null; problems: readonly string[] };

/** "Live v3", "Live v2 · draft v3", "Draft v1", "Inactive v2"; "Needs update · Live v3" when an element or page it uses is gone. */
export function walkthroughStatusLabel(w: Listed): string {
  const base =
    w.live_version && w.latest_version !== w.live_version
      ? `Live v${w.live_version} · ${w.latest_status} v${w.latest_version}`
      : `${STATUS_LABELS[w.latest_status]} v${w.latest_version}`;
  return w.problems.length ? `Needs update · ${base}` : base;
}

export function walkthroughStatusTone(w: Listed): StatusTone {
  if (w.problems.length) return 'danger';
  return w.live_version ? 'ok' : STATUS_TONES[w.latest_status];
}

export const stepsLabel = (n: number) => (n === 1 ? '1 step' : `${n} steps`);

type Stats = { people: number; finished: number; reached: readonly number[] };

/** " · reached by 3", where anyone has started it. */
export function reachedLabel(stats: Stats | null | undefined, step: number): string {
  return stats?.people ? ` · reached by ${stats.reached[step] ?? 0}` : '';
}

/** " · 12 people, 7 finished", where anyone has started it. */
export function peopleLabel(stats: Stats | null | undefined): string {
  return stats?.people ? ` · ${stats.people} ${stats.people === 1 ? 'person' : 'people'}, ${stats.finished} finished` : '';
}

/** A version as a walkthrough file, the shape upload takes back (status left out: uploads are drafts). */
export function walkthroughFileOf<V extends { slug: string; title: string; article_slug: string | null; articles?: string[]; permission: string | null; offer_on: string | null; mode: WalkthroughMode; reoffer_from: number; steps: unknown[] }>(number: number, v: V) {
  return {
    number,
    slug: v.slug,
    title: v.title,
    article: v.article_slug,
    ...(v.articles?.length ? { articles: v.articles } : {}),
    permission: v.permission,
    offer_on: v.offer_on,
    ...(v.mode === 'guide' ? { mode: v.mode } : {}),
    reoffer_from: v.reoffer_from,
    steps: v.steps as V['steps'],
  };
}

/** `<number>-<slug>-v<n>.json`, a downloaded version's name. */
export const walkthroughFileName = (number: number, v: { slug: string; version: number }) => `${walkthroughHandle({ number, slug: v.slug })}-v${v.version}.json`;

/** Saves a value as a JSON file on the person's computer (browser only). */
export function downloadJson(name: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type UploadFile = { number?: unknown; slug?: unknown; title?: unknown; steps?: unknown };
type Existing = { number: number; slug: string; handle: string; title: string; latest_version: number };

/**
 * What an upload will do, before it does it. A walkthrough is found by its number: into a
 * walkthrough, the file's number is replaced by that walkthrough's, so it always lands there; a
 * file with a number adds a version to that walkthrough; one without is a new walkthrough with the
 * next number. A different slug renames it. Returns the file to save and the words to confirm with.
 */
export function describeUpload<F extends UploadFile>(file: F, into: Existing | null, known: readonly Existing[], fileName: string): { file: F; title: string; message: string } {
  const renumbered = into && typeof file?.number === 'number' && file.number !== into.number ? file.number : null;
  const saved = into ? { ...file, number: into.number } : file;
  const existing = into ?? (typeof saved?.number === 'number' ? (known.find((w) => w.number === saved.number) ?? null) : null);
  const renamed = existing && saved?.slug && saved.slug !== existing.slug ? (saved.slug as string) : null;
  const steps = Array.isArray(saved?.steps) ? saved.steps.length : 0;
  const notes = [
    existing && renumbered ? `The file’s number ${renumbered} is replaced by ${existing.number}.` : '',
    existing && renamed ? `It renames ${existing.handle} to ${walkthroughHandle({ number: existing.number, slug: renamed })}.` : '',
  ].filter(Boolean);
  return {
    file: saved,
    title: into ? `Upload a new version of “${into.title}”?` : `Upload “${saved?.title ?? fileName}”?`,
    message: existing
      ? `It is saved as v${existing.latest_version + 1} of walkthrough ${existing.number}, a draft with ${stepsLabel(steps)}.${notes.length ? ` ${notes.join(' ')}` : ''} People keep getting the live version until you make this one live.`
      : typeof saved?.number === 'number'
        ? `It is saved as walkthrough ${saved.number}, a new walkthrough: a draft with ${stepsLabel(steps)}. Preview it, then make it live.`
        : `It is saved as a new walkthrough with the next number, a draft with ${stepsLabel(steps)}. Preview it, then make it live.`,
  };
}

/** Make live, Make inactive, Restore: the action's name and what it will do. */
export function versionChangeWords(status: WalkthroughStatus, fromVersion: number): { action: string; message: string } {
  if (status === 'live') return { action: 'Make live', message: `People get v${fromVersion}'s steps from now on, saved as the next version. Anyone who finished an earlier version isn’t offered it again.` };
  if (status === 'inactive') return { action: 'Make inactive', message: 'Nobody is offered or can start this walkthrough until a version is made live again. Every version is kept.' };
  return { action: 'Restore', message: `v${fromVersion} is copied into the next version as a draft. Preview it, then make it live.` };
}

export const savedDraftMessage = (saved: { handle: string; version: number }) => `Saved ${saved.handle} as a draft, v${saved.version}`;

/** What Preview says once the pop-out closes, when it can't start at once. Null = it's starting. */
export function previewWaitMessage(route: string | null): string | null {
  if (!route) return 'Open any page: the preview starts there.';
  return route.includes(':') ? `Open any page like ${route}: the preview starts there.` : null;
}
