/**
 * Show me where: an AI's answer points at something on the page, and Flinders shows it. The product's
 * AI does the thinking. Flinders only reads which names are on screen, finds the token in an answer,
 * and shows the place: `docs/show-me-where.md`.
 */
import type { FlindersElement } from './context.js';
import { buildRoute, matchRoute, paramsFromUrl } from './routes.js';
import type { WalkthroughLabels } from './types.js';

const TOKEN = 'flindersshowme:';
const MAX_TARGETS = 5;
const MAX_ELEMENTS = 60;
/** A longer label is more likely someone's content than a button's word. */
const MAX_LABEL = 40;
const MAX_NAME = 80;

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/;
/** A route pattern from our own site: plain segments and `:ids`, never `//`, `..` or a scheme. */
const ROUTE = /^\/(?:(?:[A-Za-z0-9_~-][A-Za-z0-9_.~-]*|:[A-Za-z]+)(?:\/(?:[A-Za-z0-9_~-][A-Za-z0-9_.~-]*|:[A-Za-z]+))*\/?)?$/;
/** A name holding an id belongs to one row, not to a place on the page. */
const HOLDS_ID = /[0-9a-f]{8}-[0-9a-f]{4}|\d{4,}/i;
/** Stands where a token was while the words round it are tidied. */
const GAP = '';

/** What an answer points at. `route` when it's on another page. */
export interface ShowMeTarget {
  name: string;
  route?: string;
}

export interface ParsedShowMe {
  /** The answer without its tokens, reading as it did. */
  text: string;
  /** What to show, in order, each once. */
  show: ShowMeTarget[];
}

/** One name, or a pattern from this product's own routes. */
export const validShowMeName = (name: string) => name.length <= MAX_NAME && NAME.test(name);
export const validShowMeRoute = (route: string) => route.length <= 300 && ROUTE.test(route);

function target(body: string): ShowMeTarget | null {
  const at = body.indexOf('@');
  const name = at < 0 ? body : body.slice(0, at);
  const route = at < 0 ? undefined : body.slice(at + 1);
  if (!validShowMeName(name) || (route !== undefined && !validShowMeRoute(route))) return null;
  return route === undefined ? { name } : { name, route };
}

/**
 * Takes `flindersshowme:<name>` and `flindersshowme:<name>@<route>` out of an answer. Markdown and
 * punctuation round a token go with it; an invalid token is dropped, never shown. `streaming`: the
 * text is still arriving, so the start of a token at its end stays out of sight too.
 */
export function parseShowMe(text: string, options: { streaming?: boolean } = {}): ParsedShowMe {
  const show: ShowMeTarget[] = [];
  const add = (body: string) => {
    const found = target(body);
    if (found && show.length < MAX_TARGETS && !show.some((t) => t.name === found.name && t.route === found.route)) show.push(found);
  };
  const done = (words: string) => ({ text: options.streaming ? withoutPartial(words) : words, show });
  if (!text.toLowerCase().includes(TOKEN)) return done(text);

  const clean = text
    .replaceAll(GAP, '')
    // [the Save button](flindersshowme:save): its words stay.
    .replace(/\[([^\]]*)\]\(\s*<?flindersshowme:([^\s)>]*)>?\s*\)/gi, (_all, words: string, body: string) => {
      add(body);
      return words;
    })
    .replace(/\[([^\]]*)\]\(\s*\)/g, '$1')
    .replace(/(`+|\*+|_+|["'([{<])?flindersshowme:(\S*)/gi, (_all, _open: string | undefined, run: string) => {
      const stop = /[.,;:!?]+$/.exec(run)?.[0] ?? '';
      add(run.slice(0, run.length - stop.length).replace(/[`*_"')\]}>]+$/, ''));
      return GAP + stop;
    });
  return done(
    clean
      .replace(new RegExp(`[ \\t]*${GAP}(?=[.,;:!?)]|[ \\t]*(?:\\n|$))`, 'g'), '')
      .replace(new RegExp(`[ \\t]*${GAP}[ \\t]*`, 'g'), ' ')
      .replace(/[ \t]+$/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

/** The first letters of a token at the very end of text still arriving. */
function withoutPartial(text: string): string {
  const tail = /[^\s`*_"'([{<]*$/.exec(text)?.[0] ?? '';
  return tail && TOKEN.startsWith(tail.toLowerCase()) ? text.slice(0, text.length - tail.length).trimEnd() : text;
}

/** Everything that can show one person's or one customer's data, however it was built. */
const PRIVATE = ['tr', '[role="row"]', '[role="gridcell"]', '[role="cell"]', '[role="listbox"]', '[role="option"]', '[contenteditable]', 'input', 'textarea', 'select', '.ag-row', '[data-flinders-private]', '[data-flinders-keep]', '.driver-popover'].join(', ');
/** The words on these are a value someone chose, not what the control does. */
const VALUE_HOLDERS = '[role="combobox"], [aria-haspopup="listbox"]';
const SAYS_WHAT_IT_DOES = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"]';

export interface ReadElementsOptions {
  /** The attribute that names a place; `data-testid` by default. */
  attribute?: string;
  /** Your words for vague names, used instead of what the page says. */
  meanings?: Record<string, string>;
  /** The most names returned, labelled ones first. 60 by default. */
  max?: number;
}

/** Plain words on one line, or nothing: never an address, a token or something long enough to be content. */
function tidy(text: string | null | undefined): string {
  const words = (text ?? '').replace(/[\u0000-\u001f<>{}`]/g, ' ').replace(/\s+/g, ' ').trim();
  if (words.length > MAX_LABEL || /\S@\S+\.\S/.test(words) || words.toLowerCase().includes(TOKEN)) return '';
  return words;
}

function labelOf(element: HTMLElement): string {
  const aria = tidy(element.getAttribute('aria-label'));
  if (aria) return aria;
  return element.matches(SAYS_WHAT_IT_DOES) && !element.matches(VALUE_HOLDERS) ? tidy(element.textContent) : '';
}

function showing(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  return !element.closest('[hidden], [aria-hidden="true"], [inert]') && getComputedStyle(element).visibility !== 'hidden';
}

/**
 * The names on screen now, for the product's AI. Labels come only from buttons, links and
 * `aria-label`s; nothing inside a row, field, chat or `data-flinders-private` is read at all. While a
 * pop-out is open, only what's in it: nothing behind it can be pointed at.
 */
export function readElements(options: ReadElementsOptions = {}): FlindersElement[] {
  if (typeof document === 'undefined') return [];
  const attribute = options.attribute ?? 'data-testid';
  const popOuts = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]:not(.driver-popover)'));
  const root: ParentNode = popOuts[popOuts.length - 1] ?? document;
  const seen = new Set<string>();
  const found: FlindersElement[] = [];
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(`[${attribute}]`))) {
    const name = element.getAttribute(attribute) ?? '';
    if (seen.has(name) || !validShowMeName(name) || HOLDS_ID.test(name) || element.closest(PRIVATE) || !showing(element)) continue;
    seen.add(name);
    const meaning = options.meanings && Object.hasOwn(options.meanings, name) ? options.meanings[name] : undefined;
    found.push({ name, label: tidy(meaning) || labelOf(element) });
  }
  return [...found.filter((e) => e.label), ...found.filter((e) => !e.label)].slice(0, options.max ?? MAX_ELEMENTS);
}

export interface ShowMeOptions {
  /** The page it's on, as a route pattern, for when it isn't on this one. */
  route?: string;
  /** Plain text. */
  title?: string;
  /** Plain text with `**bold**`. */
  body?: string;
}

/** shown = it's on screen · missing = it wasn't found, and nothing is · stayed = they chose not to go. */
export type ShowMeResult = 'shown' | 'missing' | 'stayed';

/** The warning card. No `go`: there's no way there from here. */
export interface ShowMeWarning {
  title: string;
  body: string;
  stay: string;
  go?: string;
}

/** @internal */
export interface ShowMeSteps {
  url(): string;
  navigate(url: string): Promise<boolean>;
  /** False when the element isn't there. */
  point(name: string, card: { title: string; body: string }): Promise<boolean>;
  /** True when the person pressed Go. */
  warn(card: ShowMeWarning): Promise<boolean>;
  hasUnsavedWork?(): boolean;
  labels: WalkthroughLabels;
  toast(message: string): void;
}

/** What `flinders.showMe` does. Nothing navigates until the person presses Go, on a card that said what they might lose. @internal */
export async function runShowMe(steps: ShowMeSteps, name: string, options: ShowMeOptions = {}): Promise<ShowMeResult> {
  const { labels } = steps;
  const notHere = (): ShowMeResult => {
    steps.toast(labels.notOnThisPage);
    return 'missing';
  };
  if (!validShowMeName(name)) return notHere();
  const card = { title: options.title ?? labels.showMeTitle, body: options.body ?? '' };
  if (await steps.point(name, card)) return 'shown';
  const { route } = options;
  const here = steps.url();
  if (!route || !validShowMeRoute(route) || matchRoute(route, here)) return notHere();

  const url = buildRoute(route, paramsFromUrl(route, here));
  if (!url) {
    await steps.warn({ title: labels.onAnotherPage, body: labels.openItFirst, stay: labels.stay });
    return 'stayed';
  }
  const go = await steps.warn({ title: labels.onAnotherPage, body: unsaved(steps) ? labels.mayLoseWork : '', stay: labels.stay, go: labels.go });
  if (!go) return 'stayed';
  const moved = await steps.navigate(url).catch(() => false);
  if (!moved) return 'stayed';
  return (await steps.point(name, card)) ? 'shown' : notHere();
}

/** A product's check that fails counts as work to lose: saying so too often beats saying so too little. */
function unsaved(steps: ShowMeSteps): boolean {
  try {
    return !!steps.hasUnsavedWork?.();
  } catch {
    return true;
  }
}
